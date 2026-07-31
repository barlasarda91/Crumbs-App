import { Router } from "express";
import { db, getAllSettings, setSetting } from "../db.js";
import { nowISO, laDateStr, addDaysStr } from "../dates.js";
import { computeBaseline, latestBaseline, previousBaseline, recomputeAll } from "../baselines.js";
import { syncSquareMetricsLogged } from "../square.js";

export const expensesRouter = Router();

// Refill the square_daily_metrics cache (denominators for baselines).
// Body: { days } — use 90 for the initial backfill; the Monday cron
// keeps the trailing 14 days fresh after that.
expensesRouter.post("/api/square/sync", async (req, res) => {
  try {
    const days = Math.min(180, Math.max(1, parseInt(req.body?.days) || 14));
    const result = await syncSquareMetricsLogged({ days });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Vendors ──────────────────────────────────────────────────────────────────
expensesRouter.get("/api/vendors", (_req, res) => {
  res.json({ vendors: db.prepare("SELECT * FROM vendors ORDER BY active DESC, name").all() });
});

expensesRouter.post("/api/vendors", (req, res) => {
  const { name, kind, email_pattern } = req.body || {};
  if (!name || !kind) return res.status(400).json({ error: "name and kind are required" });
  try {
    const { lastInsertRowid: id } = db.prepare(
      "INSERT INTO vendors (name, kind, email_pattern, created_at) VALUES (?, ?, ?, ?)"
    ).run(name.trim(), kind, email_pattern || null, nowISO());
    res.json({ vendor: db.prepare("SELECT * FROM vendors WHERE id = ?").get(id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

expensesRouter.patch("/api/vendors/:id", (req, res) => {
  const vendor = db.prepare("SELECT * FROM vendors WHERE id = ?").get(req.params.id);
  if (!vendor) return res.status(404).json({ error: "Vendor not found" });
  const allowed = ["name", "kind", "email_pattern", "active"];
  const sets = [], params = [];
  for (const key of allowed) {
    if (key in (req.body || {})) { sets.push(`${key} = ?`); params.push(req.body[key]); }
  }
  if (sets.length === 0) return res.status(400).json({ error: "No editable fields provided" });
  db.prepare(`UPDATE vendors SET ${sets.join(", ")} WHERE id = ?`).run(...params, vendor.id);
  res.json({ vendor: db.prepare("SELECT * FROM vendors WHERE id = ?").get(vendor.id) });
});

// ─── Consumables ──────────────────────────────────────────────────────────────
function consumableFull(id) {
  const c = db.prepare("SELECT * FROM consumables WHERE id = ?").get(id);
  if (!c) return null;
  c.patterns = db.prepare("SELECT * FROM consumable_sku_patterns WHERE consumable_id = ?").all(id);
  c.rules = db.prepare("SELECT * FROM consumable_rules WHERE consumable_id = ?").all(id);
  c.baseline = latestBaseline(id);
  c.previous_baseline = previousBaseline(id);
  return c;
}

expensesRouter.get("/api/consumables", (_req, res) => {
  const ids = db.prepare("SELECT id FROM consumables ORDER BY active DESC, name").all();
  res.json({ consumables: ids.map(r => consumableFull(r.id)) });
});

function writePatternsAndRules(consumableId, patterns, rules) {
  if (Array.isArray(patterns)) {
    db.prepare("DELETE FROM consumable_sku_patterns WHERE consumable_id = ?").run(consumableId);
    const ins = db.prepare(
      "INSERT INTO consumable_sku_patterns (consumable_id, vendor_id, pattern, units_per_pack_override) VALUES (?, ?, ?, ?)"
    );
    for (const p of patterns) {
      if (!p.pattern) continue;
      ins.run(consumableId, p.vendor_id ?? null, p.pattern,
        p.units_per_pack_override != null && p.units_per_pack_override !== "" ? Number(p.units_per_pack_override) : null);
    }
  }
  if (Array.isArray(rules)) {
    db.prepare("DELETE FROM consumable_rules WHERE consumable_id = ?").run(consumableId);
    const ins = db.prepare(
      "INSERT INTO consumable_rules (consumable_id, match_type, match_value, units_per_match) VALUES (?, ?, ?, ?)"
    );
    for (const r of rules) {
      if (!r.match_type || !r.match_value) continue;
      ins.run(consumableId, r.match_type, r.match_value, Number(r.units_per_match) || 1);
    }
  }
}

expensesRouter.post("/api/consumables", (req, res) => {
  const { name, method, denominator, rolling_window_days, window_auto, patterns, rules } = req.body || {};
  if (!name || !method || !denominator) return res.status(400).json({ error: "name, method and denominator are required" });
  if (!["rule", "statistical"].includes(method)) return res.status(400).json({ error: "method must be 'rule' or 'statistical'" });
  if (!["transaction", "drink", "matching_item"].includes(denominator)) return res.status(400).json({ error: "invalid denominator" });
  try {
    const create = db.transaction(() => {
      const { lastInsertRowid: id } = db.prepare(`
        INSERT INTO consumables (name, method, denominator, rolling_window_days, window_auto, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(name.trim(), method, denominator,
        rolling_window_days || null, window_auto === 0 || window_auto === false ? 0 : 1, nowISO());
      writePatternsAndRules(id, patterns, rules);
      return id;
    });
    const id = create();
    try { computeBaseline(id); } catch {}
    res.json({ consumable: consumableFull(id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

expensesRouter.patch("/api/consumables/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM consumables WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Consumable not found" });
  const { patterns, rules, ...fields } = req.body || {};
  const allowed = ["name", "method", "denominator", "rolling_window_days", "window_auto", "active"];
  const update = db.transaction(() => {
    const sets = [], params = [];
    for (const key of allowed) {
      if (key in fields) { sets.push(`${key} = ?`); params.push(fields[key]); }
    }
    if (sets.length) db.prepare(`UPDATE consumables SET ${sets.join(", ")} WHERE id = ?`).run(...params, existing.id);
    writePatternsAndRules(existing.id, patterns, rules);
  });
  update();
  try { computeBaseline(existing.id); } catch {}
  res.json({ consumable: consumableFull(existing.id) });
});

expensesRouter.delete("/api/consumables/:id", (req, res) => {
  const result = db.prepare("UPDATE consumables SET active = 0 WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Consumable not found" });
  res.json({ ok: true });
});

expensesRouter.get("/api/consumables/:id/baseline", (req, res) => {
  const baseline = latestBaseline(Number(req.params.id));
  if (!baseline) return res.status(404).json({ error: "No baseline computed yet" });
  res.json({ baseline, previous: previousBaseline(Number(req.params.id)) });
});

expensesRouter.post("/api/consumables/recompute", (req, res) => {
  try {
    if (req.body?.consumable_id) {
      const baseline = computeBaseline(Number(req.body.consumable_id));
      return res.json({ baseline });
    }
    res.json(recomputeAll());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Expenses summary ─────────────────────────────────────────────────────────
expensesRouter.get("/api/expenses/summary", (req, res) => {
  const to = req.query.to || laDateStr();
  const from = req.query.from || addDaysStr(to, -29);
  const spanDays = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  const prevTo = addDaysStr(from, -1);
  const prevFrom = addDaysStr(prevTo, -(spanDays - 1));

  const vendorSpend = (a, b) => db.prepare(`
    SELECT v.id AS vendor_id, v.name AS vendor, v.kind, SUM(i.total) AS total, COUNT(*) AS invoices
    FROM invoices i JOIN vendors v ON v.id = i.vendor_id
    WHERE i.status = 'confirmed' AND i.invoice_date >= ? AND i.invoice_date <= ?
    GROUP BY v.id ORDER BY total DESC
  `).all(a, b);

  const byConsumable = db.prepare(`
    SELECT c.id AS consumable_id, c.name AS consumable, SUM(ili.line_total) AS total, COUNT(DISTINCT i.id) AS invoices
    FROM invoice_line_items ili
    JOIN invoices i ON i.id = ili.invoice_id
    JOIN consumables c ON c.id = ili.consumable_id
    WHERE i.status = 'confirmed' AND i.invoice_date >= ? AND i.invoice_date <= ?
    GROUP BY c.id ORDER BY total DESC
  `).all(from, to);

  const totals = db.prepare(`
    SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS invoices
    FROM invoices WHERE status = 'confirmed' AND invoice_date >= ? AND invoice_date <= ?
  `).get(from, to);

  const pending = db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE status = 'pending_review'").get().n;
  const openAlerts = db.prepare("SELECT COUNT(*) AS n FROM price_alerts WHERE acknowledged = 0").get().n;

  // Combined cost-per-customer: sum of latest cost_per_denominator across
  // consumables whose denominator is 'transaction' plus per-transaction
  // equivalents are not derivable for other denominators, so report the
  // transaction-based sum and per-denominator detail separately in the UI.
  res.json({
    from, to, prev_from: prevFrom, prev_to: prevTo,
    total_spend: totals.total, invoice_count: totals.invoices,
    by_vendor: vendorSpend(from, to),
    by_vendor_prev: vendorSpend(prevFrom, prevTo),
    by_consumable: byConsumable,
    pending_review_count: pending,
    open_alert_count: openAlerts,
  });
});

// ─── Price alerts ─────────────────────────────────────────────────────────────
expensesRouter.get("/api/price-alerts", (req, res) => {
  const clauses = [], params = [];
  if (req.query.acknowledged != null) { clauses.push("a.acknowledged = ?"); params.push(Number(req.query.acknowledged)); }
  if (req.query.from) { clauses.push("a.created_at >= ?"); params.push(req.query.from); }
  if (req.query.to)   { clauses.push("a.created_at <= ?"); params.push(req.query.to + "T23:59:59Z"); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const alerts = db.prepare(`
    SELECT a.*, v.name AS vendor_name FROM price_alerts a
    JOIN vendors v ON v.id = a.vendor_id ${where}
    ORDER BY a.created_at DESC LIMIT 200
  `).all(...params);
  res.json({ alerts });
});

expensesRouter.patch("/api/price-alerts/:id/acknowledge", (req, res) => {
  const result = db.prepare("UPDATE price_alerts SET acknowledged = 1 WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Alert not found" });
  res.json({ ok: true });
});

// ─── Sync log & settings ──────────────────────────────────────────────────────
expensesRouter.get("/api/sync-log", (req, res) => {
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  res.json({ log: db.prepare("SELECT * FROM sync_log ORDER BY id DESC LIMIT ?").all(limit) });
});

expensesRouter.get("/api/settings", (_req, res) => {
  res.json({ settings: getAllSettings() });
});

expensesRouter.patch("/api/settings", (req, res) => {
  const allowed = ["price_alert_threshold_pct", "drink_categories", "drink_items"];
  for (const key of allowed) {
    if (key in (req.body || {})) setSetting(key, req.body[key]);
  }
  res.json({ settings: getAllSettings() });
});
