import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db, INVOICE_DIR } from "../db.js";
import { nowISO } from "../dates.js";
import { extractAndStoreInvoice } from "../extraction.js";
import { recordPricesForInvoice, suggestConsumable } from "../pricing.js";
import { recomputeForInvoice } from "../baselines.js";

export const invoicesRouter = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: INVOICE_DIR,
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
      cb(null, `manual_${Date.now()}_${safe}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf");
    cb(ok ? null : new Error("Only PDF files are accepted"), ok);
  },
});

const invoiceWithVendor = `
  SELECT i.*, v.name AS vendor_name, v.kind AS vendor_kind
  FROM invoices i LEFT JOIN vendors v ON v.id = i.vendor_id
`;

invoicesRouter.get("/api/invoices", (req, res) => {
  const clauses = [], params = [];
  if (req.query.status)    { clauses.push("i.status = ?");        params.push(req.query.status); }
  if (req.query.vendor_id) { clauses.push("i.vendor_id = ?");     params.push(req.query.vendor_id); }
  if (req.query.from)      { clauses.push("i.invoice_date >= ?"); params.push(req.query.from); }
  if (req.query.to)        { clauses.push("i.invoice_date <= ?"); params.push(req.query.to); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`
    ${invoiceWithVendor} ${where}
    ORDER BY CASE i.status WHEN 'pending_review' THEN 0 ELSE 1 END,
             COALESCE(i.invoice_date, i.created_at) DESC, i.id DESC
    LIMIT 500
  `).all(...params);
  res.json({ invoices: rows });
});

invoicesRouter.get("/api/invoices/:id(\\d+)", (req, res) => {
  const invoice = db.prepare(`${invoiceWithVendor} WHERE i.id = ?`).get(req.params.id);
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  const lines = db.prepare("SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY id").all(invoice.id);
  for (const line of lines) {
    if (!line.consumable_id) line.suggested = suggestConsumable(invoice.vendor_id, line.sku, line.description);
  }
  // Arithmetic sanity: sum(line_total) ≈ subtotal, surfaced as a warning only
  let arithmetic_warning = null;
  if (invoice.subtotal != null && lines.length > 0) {
    const sum = lines.reduce((a, l) => a + (l.line_total || 0), 0);
    if (Math.abs(sum - invoice.subtotal) > Math.max(0.05, invoice.subtotal * 0.005)) {
      arithmetic_warning = `Line items sum to $${sum.toFixed(2)} but subtotal is $${invoice.subtotal.toFixed(2)} — check for missed or misread rows.`;
    }
  }
  res.json({ invoice, line_items: lines, arithmetic_warning });
});

invoicesRouter.post("/api/invoices/upload", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No PDF uploaded" });
    const vendorId = req.body.vendor_id ? Number(req.body.vendor_id) : null;
    const { lastInsertRowid: invoiceId } = db.prepare(`
      INSERT INTO invoices (vendor_id, source, pdf_path, status, created_at)
      VALUES (?, 'manual', ?, 'pending_review', ?)
    `).run(vendorId, req.file.path, nowISO());

    try {
      await extractAndStoreInvoice(invoiceId);
    } catch (err) {
      // Extraction failure degrades to manual entry — the invoice row and PDF are kept
      console.error(`Extraction failed for manual upload ${invoiceId}:`, err.message);
    }
    const invoice = db.prepare(`${invoiceWithVendor} WHERE i.id = ?`).get(invoiceId);
    const lines = db.prepare("SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY id").all(invoiceId);
    res.json({ invoice, line_items: lines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

invoicesRouter.post("/api/invoices/:id(\\d+)/reextract", async (req, res) => {
  try {
    const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    if (invoice.status !== "pending_review") return res.status(400).json({ error: "Only pending invoices can be re-extracted" });
    await extractAndStoreInvoice(invoice.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

invoicesRouter.patch("/api/invoices/:id(\\d+)", (req, res) => {
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  const allowed = ["vendor_id", "invoice_number", "invoice_date", "subtotal", "tax", "total"];
  const sets = [], params = [];
  for (const key of allowed) {
    if (key in (req.body || {})) { sets.push(`${key} = ?`); params.push(req.body[key]); }
  }
  if (sets.length === 0) return res.status(400).json({ error: "No editable fields provided" });
  db.prepare(`UPDATE invoices SET ${sets.join(", ")} WHERE id = ?`).run(...params, invoice.id);
  res.json({ invoice: db.prepare(`${invoiceWithVendor} WHERE i.id = ?`).get(invoice.id) });
});

// Bulk replace line items. Body: { line_items: [{ sku, description, qty, unit,
// units_per_pack, unit_price, line_total, consumable_id, edited }] }
invoicesRouter.patch("/api/invoices/:id(\\d+)/line-items", (req, res) => {
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  const items = req.body?.line_items;
  if (!Array.isArray(items)) return res.status(400).json({ error: "line_items array required" });

  const replace = db.transaction(() => {
    db.prepare("DELETE FROM invoice_line_items WHERE invoice_id = ?").run(invoice.id);
    const insert = db.prepare(`
      INSERT INTO invoice_line_items (invoice_id, sku, description, qty, unit, units_per_pack, unit_price, line_total, consumable_id, edited)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const li of items) {
      if (!li.description) continue;
      insert.run(
        invoice.id, li.sku ?? null, String(li.description),
        Number(li.qty) || 0, li.unit ?? null,
        li.units_per_pack != null && li.units_per_pack !== "" ? Number(li.units_per_pack) : null,
        Number(li.unit_price) || 0, Number(li.line_total) || 0,
        li.consumable_id ?? null, li.edited ? 1 : 0
      );
    }
  });
  replace();
  const lines = db.prepare("SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY id").all(invoice.id);
  res.json({ line_items: lines });
});

// Confirm: the only path that writes price observations, evaluates alerts,
// and triggers baseline recompute. Nothing auto-confirms.
invoicesRouter.post("/api/invoices/:id(\\d+)/confirm", (req, res) => {
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  if (invoice.status !== "pending_review") return res.status(400).json({ error: `Invoice is ${invoice.status}, not pending_review` });
  if (!invoice.vendor_id) return res.status(400).json({ error: "Assign a vendor before confirming" });
  if (!invoice.invoice_date) return res.status(400).json({ error: "Set the invoice date before confirming" });

  db.prepare("UPDATE invoices SET status = 'confirmed', confirmed_at = ? WHERE id = ?").run(nowISO(), invoice.id);
  const prices = recordPricesForInvoice(invoice.id);
  const recomputed = recomputeForInvoice(invoice.id);
  res.json({ ok: true, ...prices, consumables_recomputed: recomputed });
});

invoicesRouter.post("/api/invoices/:id(\\d+)/reject", (req, res) => {
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  if (invoice.status !== "pending_review") return res.status(400).json({ error: `Invoice is ${invoice.status}, not pending_review` });
  db.prepare("UPDATE invoices SET status = 'rejected' WHERE id = ?").run(invoice.id);
  res.json({ ok: true });
});

invoicesRouter.get("/api/invoices/:id(\\d+)/pdf", (req, res) => {
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
  if (!invoice?.pdf_path || !fs.existsSync(invoice.pdf_path)) {
    return res.status(404).json({ error: "PDF not found" });
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${path.basename(invoice.pdf_path)}"`);
  fs.createReadStream(invoice.pdf_path).pipe(res);
});
