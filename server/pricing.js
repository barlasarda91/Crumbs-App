import { db, getSetting } from "./db.js";
import { nowISO } from "./dates.js";

// sku_key: normalized sku if present, else normalized description
// (lowercase, strip punctuation, collapse whitespace)
export function normalizeSkuKey(sku, description) {
  const src = (sku && String(sku).trim()) || String(description || "").trim();
  return src.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

// Called on invoice confirm — the only path that moves price baselines.
// For each line: write a price_observation, compare against the most recent
// prior observation, and raise an alert when the change clears the threshold.
// A unit change (case → ea) is flagged as kind 'unit_change' instead of being
// treated as a price move.
export function recordPricesForInvoice(invoiceId) {
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId);
  if (!invoice || !invoice.vendor_id || !invoice.invoice_date) return { observations: 0, alerts: 0 };

  const lines = db.prepare("SELECT * FROM invoice_line_items WHERE invoice_id = ?").all(invoiceId);
  const thresholdPct = Number(getSetting("price_alert_threshold_pct")) || 3;

  const findPrior = db.prepare(`
    SELECT * FROM price_observations
    WHERE vendor_id = ? AND sku_key = ? AND observed_date < ?
    ORDER BY observed_date DESC, id DESC LIMIT 1
  `);
  const insertObs = db.prepare(`
    INSERT INTO price_observations (vendor_id, sku_key, observed_date, unit_price, unit, invoice_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertAlert = db.prepare(`
    INSERT INTO price_alerts (vendor_id, sku_key, kind, old_price, new_price, pct_change, old_unit, new_unit, old_date, new_date, invoice_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let observations = 0, alerts = 0;
  const run = db.transaction(() => {
    for (const line of lines) {
      if (!(line.unit_price > 0)) continue;
      const skuKey = normalizeSkuKey(line.sku, line.description);
      if (!skuKey) continue;

      const prior = findPrior.get(invoice.vendor_id, skuKey, invoice.invoice_date);
      insertObs.run(invoice.vendor_id, skuKey, invoice.invoice_date, line.unit_price, line.unit ?? null, invoiceId);
      observations++;

      if (!prior) continue;
      const unitChanged = (prior.unit || "").toLowerCase() !== (line.unit || "").toLowerCase();
      const pctChange = ((line.unit_price - prior.unit_price) / prior.unit_price) * 100;

      if (unitChanged) {
        insertAlert.run(invoice.vendor_id, skuKey, "unit_change", prior.unit_price, line.unit_price,
          pctChange, prior.unit, line.unit ?? null, prior.observed_date, invoice.invoice_date, invoiceId, nowISO());
        alerts++;
      } else if (Math.abs(pctChange) >= thresholdPct) {
        insertAlert.run(invoice.vendor_id, skuKey, "price", prior.unit_price, line.unit_price,
          pctChange, prior.unit, line.unit ?? null, prior.observed_date, invoice.invoice_date, invoiceId, nowISO());
        alerts++;
      }
    }
  });
  run();
  return { observations, alerts };
}

// Suggest a consumable for an invoice line from consumable_sku_patterns
// (case-insensitive substring match on sku or description).
export function suggestConsumable(vendorId, sku, description) {
  const patterns = db.prepare(`
    SELECT p.*, c.name AS consumable_name FROM consumable_sku_patterns p
    JOIN consumables c ON c.id = p.consumable_id
    WHERE c.active = 1 AND (p.vendor_id IS NULL OR p.vendor_id = ?)
  `).all(vendorId ?? -1);
  const haystack = `${sku || ""} ${description || ""}`.toLowerCase();
  for (const p of patterns) {
    if (haystack.includes(p.pattern.toLowerCase())) {
      return { consumable_id: p.consumable_id, consumable_name: p.consumable_name, units_per_pack_override: p.units_per_pack_override };
    }
  }
  return null;
}
