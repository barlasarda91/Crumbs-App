import { Router } from "express";
import { db } from "../db.js";
import { nowISO, laDateStr } from "../dates.js";

const DAY_NAMES = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

export const standingOrdersRouter = Router();

// Assemble a version's items into the client shape:
// { "<Item Name>": { vendor: "Sam Robinson", daily: { Monday: 4, ... } } }
function assembleOrders(versionId) {
  const rows = db.prepare(`
    SELECT soi.item_name, soi.day_of_week, soi.qty, v.name AS vendor
    FROM standing_order_items soi
    LEFT JOIN vendors v ON v.id = soi.vendor_id
    WHERE soi.version_id = ?
  `).all(versionId);
  const orders = {};
  for (const r of rows) {
    if (!orders[r.item_name]) {
      orders[r.item_name] = { vendor: r.vendor || "Vendor", daily: Object.fromEntries(DAY_NAMES.map(d => [d, 0])) };
    }
    orders[r.item_name].daily[r.day_of_week] = r.qty;
  }
  return orders;
}

function versionSummary(v) {
  return {
    id: v.id,
    effectiveDate: v.effective_date,
    createdAt: v.created_at,
    note: v.note,
    orders: assembleOrders(v.id),
  };
}

// Active version for a date = most recent version with effective_date <= date
standingOrdersRouter.get("/api/standing-orders", (req, res) => {
  const date = req.query.date || laDateStr();
  const v = db.prepare(
    "SELECT * FROM standing_order_versions WHERE effective_date <= ? ORDER BY effective_date DESC, id DESC LIMIT 1"
  ).get(date);
  if (!v) return res.json({ version: null, orders: {} });
  res.json({ version: versionSummary(v) });
});

standingOrdersRouter.get("/api/standing-orders/history", (_req, res) => {
  const versions = db.prepare(
    "SELECT * FROM standing_order_versions ORDER BY effective_date DESC, id DESC"
  ).all();
  res.json({ versions: versions.map(versionSummary) });
});

// Body: { effective_date, note?, orders: { item: { vendor, daily } } }
// or    { effective_date, note?, items: [{ item_name, vendor, day_of_week, qty }] }
standingOrdersRouter.post("/api/standing-orders", (req, res) => {
  const { effective_date, note } = req.body || {};
  if (!effective_date || !/^\d{4}-\d{2}-\d{2}$/.test(effective_date)) {
    return res.status(400).json({ error: "effective_date (YYYY-MM-DD) is required" });
  }

  let items = req.body.items;
  if (!items && req.body.orders) {
    items = [];
    for (const [itemName, data] of Object.entries(req.body.orders)) {
      for (const day of DAY_NAMES) {
        const qty = data.daily?.[day] || 0;
        if (qty > 0) items.push({ item_name: itemName, vendor: data.vendor, day_of_week: day, qty });
      }
    }
  }
  if (!items || items.length === 0) return res.status(400).json({ error: "No items provided" });

  const getVendor = db.prepare("SELECT id FROM vendors WHERE name = ? COLLATE NOCASE");
  const addVendor = db.prepare("INSERT INTO vendors (name, kind, created_at) VALUES (?, 'pastry', ?)");
  const vendorId = (name) => {
    if (!name) return null;
    const existing = getVendor.get(name);
    if (existing) return existing.id;
    return addVendor.run(name, nowISO()).lastInsertRowid;
  };

  const save = db.transaction(() => {
    // Replace an existing version with the same effective date
    const prior = db.prepare("SELECT id FROM standing_order_versions WHERE effective_date = ?").all(effective_date);
    for (const p of prior) db.prepare("DELETE FROM standing_order_versions WHERE id = ?").run(p.id);

    const { lastInsertRowid: versionId } = db.prepare(
      "INSERT INTO standing_order_versions (effective_date, created_at, note) VALUES (?, ?, ?)"
    ).run(effective_date, nowISO(), note || null);

    const insertItem = db.prepare(
      "INSERT INTO standing_order_items (version_id, item_name, vendor_id, day_of_week, qty) VALUES (?, ?, ?, ?, ?)"
    );
    for (const it of items) {
      if (!it.item_name || !DAY_NAMES.includes(it.day_of_week)) continue;
      insertItem.run(versionId, it.item_name, vendorId(it.vendor), it.day_of_week, it.qty || 0);
    }
    return versionId;
  });

  const versionId = save();
  const v = db.prepare("SELECT * FROM standing_order_versions WHERE id = ?").get(versionId);
  res.json({ version: versionSummary(v) });
});

standingOrdersRouter.delete("/api/standing-orders/:versionId", (req, res) => {
  const result = db.prepare("DELETE FROM standing_order_versions WHERE id = ?").run(req.params.versionId);
  if (result.changes === 0) return res.status(404).json({ error: "Version not found" });
  res.json({ ok: true });
});
