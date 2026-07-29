import { useState, useRef } from "react";
import { parseVendorXLSX } from "../lib/orders.js";
import { laDateStr, addDaysStr } from "../lib/dates.js";
import { VENDOR_COLORS } from "../components/ui.jsx";

export default function VendorUploadModal({ existingOrders, onSave, onClose, T, ordersHistory }) {
  const existingVendors = [...new Set(Object.values(existingOrders).map(v => v.vendor))];

  // Default effective date = next Monday (LA calendar)
  const getNextMonday = () => {
    const today = laDateStr();
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
    const daysUntilMon = dow === 0 ? 1 : 8 - dow;
    return addDaysStr(today, daysUntilMon);
  };

  const [vendors, setVendors] = useState([
    { name: existingVendors[0] || "", file:null, parsed:null, error:null },
    { name: existingVendors[1] || "", file:null, parsed:null, error:null },
  ]);
  const [effectiveDate, setEffectiveDate] = useState(getNextMonday);
  const [saving, setSaving] = useState(false);
  const fileRefs = [useRef(), useRef()];

  const handleFile = (i, file) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const vName  = vendors[i].name.trim() || `Vendor ${i+1}`;
        const parsed = parseVendorXLSX(e.target.result, vName);
        const count  = Object.keys(parsed).length;
        if (count === 0) {
          setVendors(v => v.map((vd,idx) => idx===i ? {...vd, error:"No items found — check the file has a 'Product' column and Monday–Sunday columns.", parsed:null, file:null} : vd));
        } else {
          setVendors(v => v.map((vd,idx) => idx===i ? {...vd, parsed, file:file.name, error:null} : vd));
        }
      } catch(err) {
        setVendors(v => v.map((vd,idx) => idx===i ? {...vd, error:`Parse error: ${err.message}`, parsed:null} : vd));
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleSave = async () => {
    const merged = {};
    vendors.forEach(v => {
      if (v.parsed) Object.entries(v.parsed).forEach(([item, data]) => {
        merged[item] = { ...data, vendor: v.name.trim() || "Vendor" };
      });
    });
    if (Object.keys(merged).length === 0) return;
    setSaving(true);
    try {
      await onSave(merged, effectiveDate);
      onClose();
    } catch (err) {
      setVendors(v => v.map((vd, idx) => idx === 0 ? { ...vd, error: `Save failed: ${err.message}` } : vd));
    } finally {
      setSaving(false);
    }
  };

  const totalItems = vendors.reduce((a,v) => a + (v.parsed ? Object.keys(v.parsed).length : 0), 0);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.82)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, backdropFilter:"blur(4px)" }}>
      <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:16, padding:40, width:620, maxWidth:"92vw", maxHeight:"90vh", overflow:"auto" }}>
        <h2 style={{ fontFamily:"'Playfair Display', serif", color:T.TEXT, marginBottom:6, fontSize:22 }}>Upload Vendor Standing Orders</h2>
        <p style={{ color:T.DIM, fontSize:13, marginBottom:20 }}>
          One .xlsx file per vendor — needs a <strong style={{ color:T.GOLD }}>Product</strong> column and <strong style={{ color:T.GOLD }}>Monday–Sunday</strong> quantity columns. Saved to the server, not this browser.
        </p>

        {/* Effective date picker */}
        <div style={{ background:T.BG, border:`1px solid ${T.BORDER}`, borderRadius:10, padding:"16px 20px", marginBottom:20 }}>
          <div style={{ display:"flex", alignItems:"center", gap:16 }}>
            <div style={{ flex:1 }}>
              <div style={{ color:T.GOLD, fontSize:11, letterSpacing:2, textTransform:"uppercase", marginBottom:6 }}>Effective Date</div>
              <input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)}
                style={{ padding:"8px 12px", background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:8,
                  color:T.TEXT, fontSize:14, outline:"none", width:"100%" }} />
              <div style={{ color:T.DIM, fontSize:11, marginTop:5 }}>
                Orders will apply to days on or after this date
              </div>
            </div>
          </div>
          {ordersHistory && ordersHistory.length > 0 && (
            <div style={{ marginTop:14, borderTop:`1px solid ${T.BORDER}`, paddingTop:12 }}>
              <div style={{ color:T.DIM, fontSize:11, letterSpacing:1.5, textTransform:"uppercase", marginBottom:8 }}>Version History</div>
              {[...ordersHistory].sort((a,b) => b.effectiveDate.localeCompare(a.effectiveDate)).slice(0,4).map((v,i) => (
                <div key={v.effectiveDate} style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:4 }}>
                  <span style={{ color: i===0 ? T.GREEN : T.DIM }}>
                    {i===0 ? "● " : "○ "}Effective {v.effectiveDate}
                  </span>
                  <span style={{ color:T.DIM }}>{Object.keys(v.orders).length} items</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {vendors.map((v, i) => (
          <div key={i} style={{ background:T.BG, border:`1px solid ${T.BORDER}`, borderRadius:12, padding:22, marginBottom:16 }}>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:VENDOR_COLORS[i], flexShrink:0 }} />
              <input value={v.name}
                onChange={e => setVendors(vs => vs.map((vd,idx) => idx===i ? {...vd,name:e.target.value} : vd))}
                placeholder={`Vendor ${i+1} name`}
                style={{ flex:1, padding:"8px 12px", background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:8, color:T.TEXT, fontSize:14, outline:"none" }} />
            </div>

            <div onClick={() => fileRefs[i].current.click()}
              style={{ border:`2px dashed ${v.parsed?T.GREEN:v.error?T.RED:T.BORDER}`, borderRadius:10, padding:"20px 24px",
                textAlign:"center", cursor:"pointer", transition:"all 0.2s" }}>
              <input ref={fileRefs[i]} type="file" accept=".xlsx,.xls,.csv" style={{ display:"none" }}
                onChange={e => e.target.files[0] && handleFile(i, e.target.files[0])} />
              {v.parsed ? (
                <div>
                  <div style={{ color:T.GREEN, fontSize:14, marginBottom:3 }}>✓ {v.file}</div>
                  <div style={{ color:T.DIM, fontSize:12 }}>{Object.keys(v.parsed).length} items detected</div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:10, justifyContent:"center" }}>
                    {Object.keys(v.parsed).slice(0,6).map(name => (
                      <span key={name} style={{ padding:"2px 8px", background:T.BORDER, borderRadius:10, fontSize:11, color:T.GOLD }}>{name}</span>
                    ))}
                    {Object.keys(v.parsed).length > 6 && <span style={{ fontSize:11, color:T.DIM }}>+{Object.keys(v.parsed).length-6} more</span>}
                  </div>
                </div>
              ) : v.error ? (
                <div style={{ color:T.RED, fontSize:13 }}>{v.error}</div>
              ) : (
                <div>
                  <div style={{ fontSize:28, marginBottom:6 }}>📄</div>
                  <div style={{ color:T.DIM, fontSize:13 }}>Click to upload Vendor {i+1} file</div>
                  <div style={{ color:T.DIM, fontSize:11, marginTop:3 }}>.xlsx or .csv · Product + Mon–Sun columns</div>
                </div>
              )}
            </div>
          </div>
        ))}

        <div style={{ display:"flex", gap:12, justifyContent:"space-between", alignItems:"center", marginTop:8 }}>
          <div style={{ color:T.DIM, fontSize:13 }}>
            {totalItems > 0 && <span style={{ color:T.GOLD }}>{totalItems} total items ready</span>}
          </div>
          <div style={{ display:"flex", gap:12 }}>
            <button onClick={onClose}
              style={{ padding:"10px 22px", background:"transparent", border:`1px solid ${T.BORDER}`, borderRadius:8, color:T.GOLD, cursor:"pointer", fontSize:14 }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={totalItems===0 || saving}
              style={{ padding:"10px 22px", background:totalItems>0&&!saving?T.ACCENT:T.BORDER, border:"none", borderRadius:8,
                color:totalItems>0&&!saving?T.BG:T.DIM, cursor:totalItems>0&&!saving?"pointer":"not-allowed", fontSize:14, fontWeight:700 }}>
              {saving ? "Saving…" : "Save Standing Orders"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
