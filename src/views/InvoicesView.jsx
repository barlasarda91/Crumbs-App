import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api.js";
import { fmtMoney } from "../lib/dates.js";
import { Pill, inputStyle, btnPrimary, btnGhost } from "../components/ui.jsx";

const STATUS_META = {
  pending_review: { label: "Needs Review", color: "#e8a050" },
  confirmed:      { label: "Confirmed",    colorKey: "GREEN" },
  rejected:       { label: "Rejected",     colorKey: "RED" },
};

function statusColor(status, T) {
  const meta = STATUS_META[status] || {};
  return meta.colorKey ? T[meta.colorKey] : (meta.color || T.DIM);
}

const EMPTY_LINE = { sku: "", description: "", qty: 1, unit: "", units_per_pack: "", unit_price: 0, line_total: 0, consumable_id: null, edited: 1 };

// ─── Review panel: PDF left, editable extraction right ────────────────────────
function ReviewPanel({ invoiceId, vendors, consumables, onDone, onError, T }) {
  const [invoice, setInvoice] = useState(null);
  const [lines, setLines] = useState([]);
  const [warning, setWarning] = useState(null);
  const [saving, setSaving] = useState(false);
  const readOnly = invoice && invoice.status !== "pending_review";

  const load = useCallback(async () => {
    try {
      const data = await api.get(`/api/invoices/${invoiceId}`);
      setInvoice(data.invoice);
      setWarning(data.arithmetic_warning);
      setLines(data.line_items.map(li => ({
        ...li,
        consumable_id: li.consumable_id ?? li.suggested?.consumable_id ?? null,
        _suggested: !li.consumable_id && !!li.suggested,
      })));
    } catch (err) { onError(err.message); }
  }, [invoiceId]);
  useEffect(() => { load(); }, [load]);

  if (!invoice) return <div style={{ padding:40, color:T.DIM, textAlign:"center" }}>Loading invoice…</div>;

  const setHeader = (k, v) => setInvoice(inv => ({ ...inv, [k]: v }));
  const setLine = (i, k, v) => setLines(ls => ls.map((l, idx) => idx === i ? { ...l, [k]: v, edited: 1 } : l));
  const removeLine = (i) => setLines(ls => ls.filter((_, idx) => idx !== i));
  const addLine = () => setLines(ls => [...ls, { ...EMPTY_LINE }]);

  const lineSum = lines.reduce((a, l) => a + (Number(l.line_total) || 0), 0);

  const saveAll = async () => {
    await api.patch(`/api/invoices/${invoice.id}`, {
      vendor_id: invoice.vendor_id ? Number(invoice.vendor_id) : null,
      invoice_number: invoice.invoice_number || null,
      invoice_date: invoice.invoice_date || null,
      subtotal: invoice.subtotal != null && invoice.subtotal !== "" ? Number(invoice.subtotal) : null,
      tax: invoice.tax != null && invoice.tax !== "" ? Number(invoice.tax) : null,
      total: invoice.total != null && invoice.total !== "" ? Number(invoice.total) : null,
    });
    await api.patch(`/api/invoices/${invoice.id}/line-items`, { line_items: lines });
  };

  const doConfirm = async () => {
    setSaving(true);
    try {
      await saveAll();
      await api.post(`/api/invoices/${invoice.id}/confirm`);
      onDone("confirmed");
    } catch (err) { onError(err.message); }
    finally { setSaving(false); }
  };

  const doReject = async () => {
    setSaving(true);
    try {
      await api.post(`/api/invoices/${invoice.id}/reject`);
      onDone("rejected");
    } catch (err) { onError(err.message); }
    finally { setSaving(false); }
  };

  const doSave = async () => {
    setSaving(true);
    try { await saveAll(); await load(); onError(null); }
    catch (err) { onError(err.message); }
    finally { setSaving(false); }
  };

  const cellInput = (props) => ({
    ...inputStyle(T), padding:"5px 8px", fontSize:12, width:"100%", ...props,
  });

  return (
    <div style={{ display:"grid", gridTemplateColumns:"minmax(320px, 42%) 1fr", gap:20, alignItems:"start" }}>
      {/* PDF */}
      <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:12, overflow:"hidden", position:"sticky", top:0 }}>
        <div style={{ padding:"12px 18px", borderBottom:`1px solid ${T.BORDER}`, color:T.DIM, fontSize:11, letterSpacing:2, textTransform:"uppercase" }}>
          Original PDF
        </div>
        <iframe title="Invoice PDF" src={`/api/invoices/${invoice.id}/pdf`}
          style={{ width:"100%", height:"70vh", border:"none", background:"#fff" }} />
      </div>

      {/* Extracted data */}
      <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:12, overflow:"hidden" }}>
        <div style={{ padding:"14px 20px", borderBottom:`1px solid ${T.BORDER}`, display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ color:T.DIM, fontSize:11, letterSpacing:2, textTransform:"uppercase" }}>Extracted Data</div>
          <Pill color={statusColor(invoice.status, T)} T={T}>{STATUS_META[invoice.status]?.label || invoice.status}</Pill>
          {invoice.source === "gmail" ? <span title="From Gmail" style={{ fontSize:13 }}>✉️</span> : <span title="Manual upload" style={{ fontSize:13 }}>📤</span>}
          <button onClick={() => onDone(null)} style={{ marginLeft:"auto", background:"transparent",
            border:`1px solid ${T.BORDER}`, borderRadius:8, color:T.DIM, cursor:"pointer", padding:"5px 11px", fontSize:12 }}>
            ← Back to list
          </button>
        </div>

        <div style={{ padding:"16px 20px" }}>
          {invoice.extraction_error && (
            <div style={{ marginBottom:14, padding:"10px 14px", borderRadius:8, fontSize:12,
              background:"#ff000011", border:"1px solid #ff000033", color:T.RED }}>
              Extraction failed: {invoice.extraction_error} — enter the invoice manually below. The PDF is safe.
            </div>
          )}
          {warning && (
            <div style={{ marginBottom:14, padding:"10px 14px", borderRadius:8, fontSize:12,
              background:"#ffa50011", border:"1px solid #ffa50033", color:"#e8a050" }}>
              ⚠ {warning}
            </div>
          )}

          {/* Header fields */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:6 }}>
            <label style={{ fontSize:11, color:T.DIM }}>Vendor
              <select disabled={readOnly} value={invoice.vendor_id || ""} onChange={e => setHeader("vendor_id", e.target.value || null)}
                style={{ ...cellInput(), marginTop:4 }}>
                <option value="">— select —</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label style={{ fontSize:11, color:T.DIM }}>Invoice #
              <input disabled={readOnly} value={invoice.invoice_number || ""} onChange={e => setHeader("invoice_number", e.target.value)}
                style={{ ...cellInput(), marginTop:4 }} />
            </label>
            <label style={{ fontSize:11, color:T.DIM }}>Date
              <input disabled={readOnly} type="date" value={invoice.invoice_date || ""} onChange={e => setHeader("invoice_date", e.target.value)}
                style={{ ...cellInput(), marginTop:4 }} />
            </label>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:14 }}>
            {["subtotal","tax","total"].map(k => (
              <label key={k} style={{ fontSize:11, color:T.DIM, textTransform:"capitalize" }}>{k}
                <input disabled={readOnly} type="number" step="0.01" value={invoice[k] ?? ""} onChange={e => setHeader(k, e.target.value)}
                  style={{ ...cellInput(), marginTop:4 }} />
              </label>
            ))}
          </div>

          {/* Line items */}
          <div style={{ color:T.DIM, fontSize:11, letterSpacing:1.5, textTransform:"uppercase", margin:"8px 0" }}>
            Line Items · {lines.length} <span style={{ textTransform:"none", letterSpacing:0 }}>(sum {fmtMoney(lineSum)})</span>
          </div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr>
                  {["SKU","Description","Qty","Unit","Per Pack","Unit $","Total $","Consumable",""].map(h => (
                    <th key={h} style={{ textAlign:"left", padding:"6px 6px", color:T.DIM, fontSize:10,
                      textTransform:"uppercase", letterSpacing:1, fontWeight:400, borderBottom:`1px solid ${T.BORDER}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} style={{ borderBottom:`1px solid ${T.BG}` }}>
                    <td style={{ padding:4, width:80 }}><input disabled={readOnly} value={l.sku || ""} onChange={e => setLine(i,"sku",e.target.value)} style={cellInput()} /></td>
                    <td style={{ padding:4, minWidth:140 }}><input disabled={readOnly} value={l.description || ""} onChange={e => setLine(i,"description",e.target.value)} style={cellInput()} /></td>
                    <td style={{ padding:4, width:56 }}><input disabled={readOnly} type="number" step="any" value={l.qty} onChange={e => setLine(i,"qty",e.target.value)} style={cellInput()} /></td>
                    <td style={{ padding:4, width:60 }}><input disabled={readOnly} value={l.unit || ""} onChange={e => setLine(i,"unit",e.target.value)} placeholder="case" style={cellInput()} /></td>
                    <td style={{ padding:4, width:64 }}><input disabled={readOnly} type="number" step="any" value={l.units_per_pack ?? ""} onChange={e => setLine(i,"units_per_pack",e.target.value)} style={cellInput()} /></td>
                    <td style={{ padding:4, width:72 }}><input disabled={readOnly} type="number" step="0.01" value={l.unit_price} onChange={e => setLine(i,"unit_price",e.target.value)} style={cellInput()} /></td>
                    <td style={{ padding:4, width:76 }}><input disabled={readOnly} type="number" step="0.01" value={l.line_total} onChange={e => setLine(i,"line_total",e.target.value)} style={cellInput()} /></td>
                    <td style={{ padding:4, width:120 }}>
                      <select disabled={readOnly} value={l.consumable_id || ""} onChange={e => setLine(i,"consumable_id", e.target.value ? Number(e.target.value) : null)}
                        style={{ ...cellInput(), borderColor: l._suggested && l.consumable_id ? T.GREEN : T.BORDER }}
                        title={l._suggested ? "Suggested from SKU patterns" : ""}>
                        <option value="">—</option>
                        {consumables.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td style={{ padding:4 }}>
                      {!readOnly && (
                        <button onClick={() => removeLine(i)} title="Delete row"
                          style={{ background:"transparent", border:"none", color:T.RED, cursor:"pointer", fontSize:14 }}>✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!readOnly && (
            <>
              <button onClick={addLine} style={{ marginTop:10, padding:"6px 14px", background:"transparent",
                border:`1px dashed ${T.BORDER}`, borderRadius:8, color:T.GOLD, cursor:"pointer", fontSize:12 }}>
                + Add row
              </button>

              <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:18, paddingTop:16, borderTop:`1px solid ${T.BORDER}` }}>
                <button onClick={doReject} disabled={saving}
                  style={{ ...btnGhost(T), color:T.RED, borderColor:`${T.RED}55` }}>Reject</button>
                <button onClick={doSave} disabled={saving} style={btnGhost(T)}>Save Draft</button>
                <button onClick={doConfirm} disabled={saving} style={btnPrimary(T, saving)}>
                  {saving ? "Working…" : "Confirm Invoice"}
                </button>
              </div>
              <div style={{ color:T.DIM, fontSize:11, marginTop:8, textAlign:"right" }}>
                Confirming writes price history and updates cost baselines — check the numbers against the PDF first.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main invoices view ───────────────────────────────────────────────────────
export default function InvoicesView({ T }) {
  const [invoices, setInvoices] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [consumables, setConsumables] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [reviewId, setReviewId] = useState(null);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  const load = useCallback(async () => {
    try {
      const [inv, ven, con] = await Promise.all([
        api.get(statusFilter === "all" ? "/api/invoices" : `/api/invoices?status=${statusFilter}`),
        api.get("/api/vendors"),
        api.get("/api/consumables"),
      ]);
      setInvoices(inv.invoices || []);
      setVendors((ven.vendors || []).filter(v => v.active));
      setConsumables((con.consumables || []).filter(c => c.active));
    } catch (err) { setError(err.message); }
  }, [statusFilter]);
  useEffect(() => { load(); }, [load]);

  const handleUpload = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) { setError("Only PDF files are accepted"); return; }
    setUploading(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("pdf", file);
      const data = await api.upload("/api/invoices/upload", fd);
      await load();
      setReviewId(data.invoice.id);
    } catch (err) { setError(err.message); }
    finally { setUploading(false); }
  };

  if (reviewId != null) {
    return (
      <div>
        {error && <div style={{ marginBottom:14, color:T.RED, fontSize:13 }}>{error}</div>}
        <ReviewPanel invoiceId={reviewId} vendors={vendors} consumables={consumables}
          onDone={() => { setReviewId(null); load(); }}
          onError={setError} T={T} />
      </div>
    );
  }

  const pending = invoices.filter(i => i.status === "pending_review");

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20 }}>
        {["all","pending_review","confirmed","rejected"].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            style={{ padding:"6px 14px", borderRadius:8, fontSize:12, cursor:"pointer",
              background: statusFilter===s ? T.ACCENT : "transparent",
              color: statusFilter===s ? T.BG : T.DIM,
              border:`1px solid ${statusFilter===s ? T.ACCENT : T.BORDER}` }}>
            {s === "all" ? "All" : STATUS_META[s]?.label || s}
            {s === "pending_review" && pending.length > 0 && statusFilter !== s &&
              <span style={{ marginLeft:6, background:T.RED, color:"#fff", borderRadius:10, padding:"1px 6px", fontSize:10 }}>{pending.length}</span>}
          </button>
        ))}
        <div style={{ marginLeft:"auto" }}>
          <input ref={fileRef} type="file" accept=".pdf" style={{ display:"none" }}
            onChange={e => { handleUpload(e.target.files[0]); e.target.value = ""; }} />
          <button onClick={() => fileRef.current.click()} disabled={uploading} style={btnPrimary(T, uploading)}>
            {uploading ? "Extracting…" : "⬆ Upload PDF"}
          </button>
        </div>
      </div>

      {error && <div style={{ marginBottom:14, color:T.RED, fontSize:13 }}>{error}</div>}

      {/* Drag-drop zone (matches the vendor .xlsx upload interaction) */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files[0]); }}
        style={{ border:`2px dashed ${dragOver ? T.GREEN : T.BORDER}`, borderRadius:10, padding:"14px 20px",
          textAlign:"center", color:T.DIM, fontSize:12, marginBottom:20, transition:"border 0.2s" }}>
        {uploading ? "Uploading and extracting…" : "Drag a vendor invoice PDF here to add it manually"}
      </div>

      {invoices.length === 0 ? (
        <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:12, padding:50, textAlign:"center" }}>
          <div style={{ fontFamily:"'Playfair Display', serif", fontSize:26, color:T.BORDER, marginBottom:10 }}>No invoices yet</div>
          <div style={{ color:T.DIM, fontSize:13 }}>
            Connect Gmail in Settings and run a sync, or upload a PDF above.
          </div>
        </div>
      ) : (
        <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:12, overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead>
              <tr>
                {["Date","Vendor","Invoice #","Total","Status","Source",""].map(h => (
                  <th key={h} style={{ textAlign:h==="Total"?"right":"left", padding:"10px 20px", color:T.DIM,
                    fontSize:10, textTransform:"uppercase", letterSpacing:1, fontWeight:400,
                    borderBottom:`1px solid ${T.BORDER}`, background:T.SIDEBAR }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv, i) => (
                <tr key={inv.id} onClick={() => setReviewId(inv.id)}
                  style={{ borderBottom:`1px solid ${T.BG}`, cursor:"pointer",
                    background: inv.status === "pending_review" ? `${T.GOLD}0d` : i%2===0 ? "transparent" : `${T.BORDER}20` }}>
                  <td style={{ padding:"12px 20px", color:T.GOLD, fontSize:12 }}>{inv.invoice_date || "—"}</td>
                  <td style={{ padding:"12px 20px", fontWeight:600, color:T.TEXT }}>{inv.vendor_name || <span style={{ color:T.RED }}>unassigned</span>}</td>
                  <td style={{ padding:"12px 20px", color:T.DIM }}>{inv.invoice_number || "—"}</td>
                  <td style={{ padding:"12px 20px", textAlign:"right", fontWeight:700, color:T.TEXT }}>{fmtMoney(inv.total)}</td>
                  <td style={{ padding:"12px 20px" }}>
                    <Pill color={statusColor(inv.status, T)} T={T}>{STATUS_META[inv.status]?.label || inv.status}</Pill>
                    {inv.extraction_error && <span title="Extraction failed — manual entry needed" style={{ marginLeft:6 }}>⚠️</span>}
                  </td>
                  <td style={{ padding:"12px 20px", fontSize:15 }} title={inv.source === "gmail" ? "From Gmail" : "Manual upload"}>
                    {inv.source === "gmail" ? "✉️" : "📤"}
                  </td>
                  <td style={{ padding:"12px 20px", color:T.DIM, fontSize:12 }}>
                    {inv.status === "pending_review" ? "Review →" : "View →"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
