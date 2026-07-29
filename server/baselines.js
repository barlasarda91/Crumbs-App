import { db, logJob } from "./db.js";
import { nowISO, laDateStr, addDaysStr } from "./dates.js";

// ─── Consumable baselines ─────────────────────────────────────────────────────
// method 'rule':        expected usage derived from Square sales via rules;
//                       produces a variance figure (the headline output).
// method 'statistical': cost = spend / denominator over the window; can only
//                       show drift, never variance — spend defines the rate.

// Confirmed invoice lines mapped to this consumable, with invoice dates
function purchaseLines(consumableId, from, to) {
  return db.prepare(`
    SELECT ili.*, i.invoice_date, i.vendor_id
    FROM invoice_line_items ili
    JOIN invoices i ON i.id = ili.invoice_id
    WHERE ili.consumable_id = ? AND i.status = 'confirmed'
      AND i.invoice_date IS NOT NULL
      AND (? IS NULL OR i.invoice_date >= ?)
      AND (? IS NULL OR i.invoice_date <= ?)
    ORDER BY i.invoice_date
  `).all(consumableId, from ?? null, from ?? null, to ?? null, to ?? null);
}

// Effective units per pack: pattern override → line value → 1 (unit == item)
function effectiveUnitsPerPack(line, overrides) {
  for (const o of overrides) {
    const haystack = `${line.sku || ""} ${line.description || ""}`.toLowerCase();
    if (o.units_per_pack_override && haystack.includes(o.pattern.toLowerCase())) {
      return o.units_per_pack_override;
    }
  }
  return line.units_per_pack || 1;
}

// 3 × median purchase gap, clamped to [28, 180]; 60 when history is too thin
export function deriveWindowDays(consumableId) {
  const dates = [...new Set(purchaseLines(consumableId, null, null).map(l => l.invoice_date))].sort();
  if (dates.length < 3) return 60;
  const gaps = [];
  for (let i = 1; i < dates.length; i++) {
    const gap = (new Date(dates[i]) - new Date(dates[i - 1])) / 86400000;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return 60;
  gaps.sort((a, b) => a - b);
  const median = gaps.length % 2 ? gaps[(gaps.length - 1) / 2]
    : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2;
  return Math.round(Math.min(180, Math.max(28, 3 * median)));
}

// Count of Square sales matching this consumable's rules on one metrics day.
// Returns { matches, units } — matches feed the 'matching_item' denominator,
// units include units_per_match (e.g. double-cupping).
function matchesForDay(rules, metricsRow) {
  let matches = 0, units = 0;
  const items = JSON.parse(metricsRow.item_counts || "{}");
  const categories = JSON.parse(metricsRow.category_counts || "{}");
  for (const rule of rules) {
    const value = rule.match_value.toLowerCase();
    let qty = 0;
    if (rule.match_type === "category") {
      for (const [cat, count] of Object.entries(categories)) {
        if (cat.toLowerCase() === value) qty += count;
      }
    } else {
      // item_name: exact or substring on the combined "Item (Variation)" key;
      // variation: substring only
      for (const [name, count] of Object.entries(items)) {
        const lower = name.toLowerCase();
        const hit = rule.match_type === "item_name"
          ? (lower === value || lower.includes(value))
          : lower.includes(value);
        if (hit) qty += count;
      }
    }
    matches += qty;
    units += qty * rule.units_per_match;
  }
  return { matches, units };
}

export function computeBaseline(consumableId) {
  const consumable = db.prepare("SELECT * FROM consumables WHERE id = ?").get(consumableId);
  if (!consumable) throw new Error(`Consumable ${consumableId} not found`);

  // Auto-derive the window unless the manager overrode it
  let windowDays = consumable.rolling_window_days;
  if (consumable.window_auto || !windowDays) {
    windowDays = deriveWindowDays(consumableId);
    db.prepare("UPDATE consumables SET rolling_window_days = ? WHERE id = ? AND window_auto = 1")
      .run(windowDays, consumableId);
  }

  const windowEnd = laDateStr();
  const windowStart = addDaysStr(windowEnd, -(windowDays - 1));

  const lines = purchaseLines(consumableId, windowStart, windowEnd);
  const overrides = db.prepare(
    "SELECT pattern, units_per_pack_override FROM consumable_sku_patterns WHERE consumable_id = ?"
  ).all(consumableId);

  const totalSpend = lines.reduce((a, l) => a + (l.line_total || 0), 0);
  const unitsPurchased = lines.reduce((a, l) => a + (l.qty || 0) * effectiveUnitsPerPack(l, overrides), 0);
  const purchaseEvents = new Set(lines.map(l => l.invoice_id)).size;

  const metricsRows = db.prepare(
    "SELECT * FROM square_daily_metrics WHERE date >= ? AND date <= ?"
  ).all(windowStart, windowEnd);

  const rules = db.prepare("SELECT * FROM consumable_rules WHERE consumable_id = ?").all(consumableId);
  let matchedItems = 0, expectedUnits = 0;
  for (const row of metricsRows) {
    const { matches, units } = matchesForDay(rules, row);
    matchedItems += matches;
    expectedUnits += units;
  }

  let denominatorCount = 0;
  if (consumable.denominator === "transaction") {
    denominatorCount = metricsRows.reduce((a, r) => a + r.transaction_count, 0);
  } else if (consumable.denominator === "drink") {
    denominatorCount = metricsRows.reduce((a, r) => a + r.drink_count, 0);
  } else { // matching_item
    denominatorCount = matchedItems;
  }

  const confidence = purchaseEvents >= 3 ? "good" : purchaseEvents === 2 ? "low" : "insufficient";

  let costPerDenominator = 0, unitsPerDenominator = null;
  let varianceUnits = null, variancePct = null;

  if (consumable.method === "rule") {
    // Blended per-unit cost from window spend; expected usage priced out
    const unitCost = unitsPurchased > 0 ? totalSpend / unitsPurchased : 0;
    costPerDenominator = denominatorCount > 0 ? (expectedUnits * unitCost) / denominatorCount : 0;
    unitsPerDenominator = denominatorCount > 0 ? expectedUnits / denominatorCount : null;
    if (expectedUnits > 0) {
      varianceUnits = unitsPurchased - expectedUnits;
      variancePct = varianceUnits / expectedUnits;
    }
  } else {
    costPerDenominator = denominatorCount > 0 ? totalSpend / denominatorCount : 0;
    unitsPerDenominator = denominatorCount > 0 && unitsPurchased > 0 ? unitsPurchased / denominatorCount : null;
  }

  db.prepare(`
    INSERT INTO consumable_baselines
      (consumable_id, computed_at, window_start, window_end, denominator_count, units_purchased,
       total_spend, cost_per_denominator, units_per_denominator, purchase_events, confidence,
       expected_units, variance_units, variance_pct)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    consumableId, nowISO(), windowStart, windowEnd, denominatorCount, unitsPurchased,
    totalSpend, costPerDenominator, unitsPerDenominator, purchaseEvents, confidence,
    consumable.method === "rule" ? expectedUnits : null, varianceUnits, variancePct
  );

  return latestBaseline(consumableId);
}

export function latestBaseline(consumableId) {
  return db.prepare(
    "SELECT * FROM consumable_baselines WHERE consumable_id = ? ORDER BY computed_at DESC, id DESC LIMIT 1"
  ).get(consumableId) || null;
}

export function previousBaseline(consumableId) {
  return db.prepare(
    "SELECT * FROM consumable_baselines WHERE consumable_id = ? ORDER BY computed_at DESC, id DESC LIMIT 1 OFFSET 1"
  ).get(consumableId) || null;
}

export function recomputeAll() {
  const consumables = db.prepare("SELECT id FROM consumables WHERE active = 1").all();
  let done = 0;
  for (const c of consumables) {
    try { computeBaseline(c.id); done++; }
    catch (err) { console.error(`Baseline error for consumable ${c.id}:`, err.message); }
  }
  return { message: `${done}/${consumables.length} baselines recomputed`, items: done };
}

export function recomputeAllLogged() {
  return logJob("baseline_recompute", () => recomputeAll());
}

// After confirming an invoice, recompute only the consumables it touched
export function recomputeForInvoice(invoiceId) {
  const ids = db.prepare(
    "SELECT DISTINCT consumable_id FROM invoice_line_items WHERE invoice_id = ? AND consumable_id IS NOT NULL"
  ).all(invoiceId).map(r => r.consumable_id);
  for (const id of ids) {
    try { computeBaseline(id); }
    catch (err) { console.error(`Baseline error for consumable ${id}:`, err.message); }
  }
  return ids.length;
}
