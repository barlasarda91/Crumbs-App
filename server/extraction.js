import fs from "fs";
import { db } from "./db.js";
import { nowISO } from "./dates.js";

// ─── Claude PDF extraction ────────────────────────────────────────────────────
// Server-side call to the Anthropic API (never from the browser). The raw
// response is stored regardless of parse success; a failed parse degrades to
// manual entry in the review UI — never to data loss.

const EXTRACTION_PROMPT = `You are extracting structured data from a vendor invoice PDF for a café's expense tracking system.

Return ONLY a JSON object — no prose, no markdown fences. Schema:

{
  "vendor_name": "string",
  "invoice_number": "string|null",
  "invoice_date": "YYYY-MM-DD|null",
  "subtotal": 0.0,
  "tax": 0.0,
  "total": 0.0,
  "line_items": [
    {
      "sku": "string|null",
      "description": "string",
      "qty": 0.0,
      "unit": "string|null",
      "units_per_pack": 0.0,
      "unit_price": 0.0,
      "line_total": 0.0
    }
  ]
}

Rules:
- If a field is not present on the invoice, return null rather than guessing.
- "unit_price" must be the price for one "unit" as invoiced (e.g. price per case), NOT the price per individual item inside the pack.
- "units_per_pack" is the number of individual items in one invoiced unit, inferred from the description ONLY where stated (e.g. "12OZ CUP 1000/CS" means 1000). Return null if not stated.
- "unit" is the invoiced unit of measure as printed, e.g. "case", "ea", "lb", "sleeve". Null if not shown.
- Include every line item on the invoice. Do not invent rows.`;

export async function extractInvoicePdf(pdfPath) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const pdfBase64 = fs.readFileSync(pdfPath).toString("base64");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
          { type: "text", text: EXTRACTION_PROMPT },
        ],
      }],
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `Anthropic API error ${response.status}`);

  const raw = data.content?.find(b => b.type === "text")?.text || "";
  let parsed = null, error = null;
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    const match = clean.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : clean);
  } catch (err) {
    error = `Could not parse extraction response: ${err.message}`;
  }
  return { raw, parsed, error };
}

// Run extraction for an invoice row and store the results. Fills header fields
// and line items; matches vendor_name against known vendors if the invoice has
// no vendor yet (manual uploads, unmatched senders).
export async function extractAndStoreInvoice(invoiceId) {
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId);
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
  if (!invoice.pdf_path || !fs.existsSync(invoice.pdf_path)) throw new Error(`PDF missing for invoice ${invoiceId}`);

  let result;
  try {
    result = await extractInvoicePdf(invoice.pdf_path);
  } catch (err) {
    db.prepare("UPDATE invoices SET extraction_error = ?, extracted_at = ? WHERE id = ?")
      .run(err.message, nowISO(), invoiceId);
    throw err;
  }

  const { raw, parsed, error } = result;

  const store = db.transaction(() => {
    db.prepare("UPDATE invoices SET extraction_raw = ?, extraction_error = ?, extracted_at = ? WHERE id = ?")
      .run(raw, error, nowISO(), invoiceId);
    if (!parsed) return;

    let vendorId = invoice.vendor_id;
    if (!vendorId && parsed.vendor_name) {
      const match = db.prepare(
        "SELECT id FROM vendors WHERE ? LIKE '%' || name || '%' COLLATE NOCASE OR name LIKE '%' || ? || '%' COLLATE NOCASE"
      ).get(parsed.vendor_name, parsed.vendor_name);
      if (match) vendorId = match.id;
    }

    db.prepare(`
      UPDATE invoices SET vendor_id = ?, invoice_number = ?, invoice_date = ?, subtotal = ?, tax = ?, total = ?
      WHERE id = ?
    `).run(
      vendorId ?? null,
      parsed.invoice_number ?? null,
      parsed.invoice_date ?? null,
      numOrNull(parsed.subtotal),
      numOrNull(parsed.tax),
      numOrNull(parsed.total),
      invoiceId
    );

    db.prepare("DELETE FROM invoice_line_items WHERE invoice_id = ?").run(invoiceId);
    const insert = db.prepare(`
      INSERT INTO invoice_line_items (invoice_id, sku, description, qty, unit, units_per_pack, unit_price, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const li of parsed.line_items || []) {
      if (!li || !li.description) continue;
      insert.run(
        invoiceId,
        li.sku ?? null,
        String(li.description),
        numOrNull(li.qty) ?? 0,
        li.unit ?? null,
        numOrNull(li.units_per_pack),
        numOrNull(li.unit_price) ?? 0,
        numOrNull(li.line_total) ?? 0
      );
    }
  });
  store();
  return { parsed: !!parsed, error };
}

function numOrNull(v) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}
