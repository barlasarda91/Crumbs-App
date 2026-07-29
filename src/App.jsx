import { useState, useEffect, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { THEMES } from "./themes.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const DAY_NAMES    = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const STORE_OPEN_H = 7;
const VENDOR_COLORS = ["#c9a87c","#7ec87e","#7ca8c8","#c87ca8"];

// ─── Date helpers ─────────────────────────────────────────────────────────────
function getLastCompletedMonday() {
  const today = new Date();
  const dow   = today.getDay();
  const daysSinceMon = dow === 0 ? 6 : dow - 1;
  const mon = new Date(today);
  mon.setDate(today.getDate() - daysSinceMon - 7);
  mon.setHours(0,0,0,0);
  return mon;
}
function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate()+n); return d; }
function toISODate(d)      { return d.toISOString().split("T")[0]; }
function formatWeekLabel(monday) {
  const sunday = addDays(monday, 6);
  const fmt = d => `${d.getMonth()+1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
  return `Week of ${fmt(monday)} – ${fmt(sunday)}`;
}
function formatTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  let h = d.getHours(), m = d.getMinutes();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2,"0")} ${ap}`;
}
function minutesFromOpen(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return (d.getHours() - STORE_OPEN_H) * 60 + d.getMinutes();
}
function minsToLabel(m) {
  if (m == null) return "—";
  const h = Math.floor(m/60), min = m%60;
  return h > 0 ? `${h}h ${min}m after open` : `${min}m after open`;
}

// ─── API (via Vite proxy → local Express server) ──────────────────────────────
async function proxyPost(path, body) {
  const res = await fetch(`/${path}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.errors?.[0]?.detail || `Error ${res.status}`);
  }
  return res.json();
}

async function squareFetchOrders(monday) {
  // Store hours 7am–6pm PST (UTC-8). 7am PST = 15:00 UTC. 6pm PST = 02:00 UTC next day.
  // Fetch Mon 15:00 UTC → following Mon 02:00 UTC to capture the full Sun 6pm PST close.
  const startISO = `${toISODate(monday)}T15:00:00.000Z`;
  const endISO   = `${toISODate(addDays(monday,7))}T02:00:00.000Z`;
  let allOrders = [], cursor = null;
  do {
    const body = {
      query: {
        filter: {
          date_time_filter: { created_at: { start_at: startISO, end_at: endISO } },
          state_filter: { states: ["COMPLETED"] },
        },
        sort: { sort_field: "CREATED_AT", sort_order: "ASC" },
      },
      limit: 500,
      ...(cursor ? { cursor } : {}),
    };
    const data = await proxyPost("api/orders", body);
    allOrders  = allOrders.concat(data.orders || []);
    cursor     = data.cursor || null;
  } while (cursor);
  return allOrders;
}

async function checkProxy() {
  try {
    const res = await fetch("/health", { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch { return false; }
}

// ─── XLSX parser ──────────────────────────────────────────────────────────────
function parseVendorXLSX(arrayBuffer, vendorName) {
  const wb   = XLSX.read(new Uint8Array(arrayBuffer), { type:"array" });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval:"" });
  const items = {};
  rows.forEach(row => {
    const name = (row["Product"] || row["Item"] || row["product"] || "").toString().trim();
    if (!name || name.toLowerCase().startsWith("total")) return;
    const daily = {};
    DAY_NAMES.forEach(day => { daily[day] = parseFloat(row[day]) || 0; });
    items[toTitleCase(name)] = { vendor: vendorName, daily };
  });
  return items;
}

// ─── Square → Internal name mapping ──────────────────────────────────────────
// Keys are Square POS names (name + variation combined), values are internal names
const SQUARE_TO_INTERNAL = {
  // Sam Robinson — item name only
  "Sunny Side Up Gallette":                   "Sunny-Side up Galette",
  "Brioche: Savory":                          "Mushroom, Parm, Chive Brioche",
  "Berry Bostock":                            "Berry Almond Bostok",
  "Muffin : Banana Chocolate":               "Banana Chocolate Muffin",
  "Seasonal Coffee Cake":                     "Blueberry Coffee Cake",
  "Mochi":                                    "Lemon Glazed Mochi",
  "Cookie: Chocolate Chunk (Sam)":            "Chocolate Chunk Cookie",
  "Cookie: Lemon Matcha (Sam)":               "Lemon Sugar Cookie",
  // Oh La La — name (variation) combined
  "Croissant (Butter)":                       "Croissant",
  "Croissant (Almond)":                       "Almond Croissant",
  "Croissant (Chocolate Almond)":             "Chocolate Almond Croissant",
  "Croissant (Ham, Cheese & Bechamel)":       "Ham & Cheese",
  "Croissant (Mushroom Bechamel)":            "Mushroom & Bechamel",
  "Croissant (Pain Au Chocalat)":             "Pain Au Chocolat",
  "Croissant (Pain au Raisin et Orange)":     "Pain Au Raisin Et Orange",
  "Kouign Amann":                             "Kouign Amann",
  "Monkey Bread":                             "Monkey Bread",
  "Chocalate Chip Cookie (Oh La La)":         "Chocolate Chip Cookie",
};

// Title-case a string (capitalize first letter of each word)
function toTitleCase(str) {
  const minors = new Set(["a","an","the","and","but","or","for","nor","on","at","to","by","in","of","up"]);
  return str.trim().split(/\s+/).map((word, i) => {
    const lower = word.toLowerCase();
    if (i === 0 || !minors.has(lower)) {
      // Also capitalize after hyphens
      return lower.replace(/(^|-)([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
    }
    return lower;
  }).join(" ");
}

function normalizeSquareName(name) {
  return SQUARE_TO_INTERNAL[name] || name;
}

// ─── Flatten orders ───────────────────────────────────────────────────────────
function flattenOrders(orders) {
  const result = {};
  orders.forEach(order => {
    const createdAt = order.created_at; if (!createdAt) return;
    const date = createdAt.split("T")[0];
    (order.line_items || []).forEach(li => {
      const baseName      = (li.name || "Unknown").trim();
      const variationName = li.variation_name?.trim();
      // Combine name + variation when variation exists and isn't generic
      const genericVariations = new Set(["regular","standard","default","n/a"]);
      const combined = variationName && !genericVariations.has(variationName.toLowerCase())
        ? `${baseName} (${variationName})`
        : baseName;
      const name = normalizeSquareName(combined);
      const qty  = parseFloat(li.quantity || 1);
      if (!result[date]) result[date] = {};
      if (!result[date][name]) result[date][name] = { sold:0, lastSaleAt:null };
      result[date][name].sold += qty;
      if (!result[date][name].lastSaleAt || createdAt > result[date][name].lastSaleAt)
        result[date][name].lastSaleAt = createdAt;
    });
  });
  return result;
}

// ─── Analysis ─────────────────────────────────────────────────────────────────
// ─── Standing order history helpers ──────────────────────────────────────────
// History stored as: [{ effectiveDate: "YYYY-MM-DD", orders: {...} }, ...]
// Returns the active standing order for a specific date (not just week start)
function getActiveOrdersForDate(history, dateStr) {
  if (!history || history.length === 0) return null;
  const sorted = [...history].sort((a,b) => b.effectiveDate.localeCompare(a.effectiveDate));
  const active = sorted.find(v => v.effectiveDate <= dateStr);
  return active ? active.orders : sorted[sorted.length - 1].orders;
}

// Kept for compatibility — returns active orders for a whole week (uses monday date)
function getActiveOrders(history, mondayDate) {
  const dateStr = typeof mondayDate === "string" ? mondayDate : toISODate(mondayDate);
  return getActiveOrdersForDate(history, dateStr) || {};
}

function analyzeWeek(standingOrders, txByDate, monday, history) {
  // Collect all items that appear in any version active during this week
  const allItems = new Set();
  DAY_NAMES.forEach((_, i) => {
    const date   = toISODate(addDays(monday, i));
    const orders = history?.length ? (getActiveOrdersForDate(history, date) || standingOrders) : standingOrders;
    Object.keys(orders).forEach(item => allItems.add(item));
  });

  return [...allItems].map(item => {
    let vendor = standingOrders[item]?.vendor;
    const dayResults = DAY_NAMES.map((dayName, i) => {
      const date       = toISODate(addDays(monday, i));
      // Pick the standing order version active on this specific day
      const orders     = history?.length ? (getActiveOrdersForDate(history, date) || standingOrders) : standingOrders;
      const itemData   = orders[item];
      if (!vendor && itemData?.vendor) vendor = itemData.vendor;
      const ordered    = itemData?.daily?.[dayName] || 0;
      const txDay      = txByDate[date]?.[item];
      const sold       = txDay?.sold || 0;
      const soldOut    = ordered > 0 && sold >= ordered && sold === ordered;
      const oversold   = ordered > 0 && sold > ordered;
      const lastSaleAt = (soldOut || oversold) ? txDay?.lastSaleAt : null;
      const efficiency = ordered > 0 ? Math.min(100, Math.round((sold/ordered)*100)) : null;
      return { dayName, date, ordered, sold, soldOut, oversold,
               sellOutTime: formatTime(lastSaleAt),
               minsFromOpen: minutesFromOpen(lastSaleAt), efficiency };
    });
    const effs      = dayResults.filter(d => d.efficiency != null).map(d => d.efficiency);
    const soldOutDs = dayResults.filter(d => d.soldOut && d.minsFromOpen != null);
    return {
      item, vendor, dayResults,
      soldOutCount:   dayResults.filter(d => d.soldOut || d.oversold).length,
      oversoldCount:  dayResults.filter(d => d.oversold).length,
      totalSold:      dayResults.reduce((a,d) => a+d.sold, 0),
      totalOrdered:   dayResults.reduce((a,d) => a+d.ordered, 0),
      avgEff:         effs.length ? Math.round(effs.reduce((a,b)=>a+b,0)/effs.length) : null,
      avgSellOutMins: soldOutDs.length ? Math.round(soldOutDs.reduce((a,d)=>a+d.minsFromOpen,0)/soldOutDs.length) : null,
    };
  });
}

// ─── Local storage persistence ────────────────────────────────────────────────
function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ─── Shared UI components ─────────────────────────────────────────────────────
function MiniBar({ value, color, T }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      <div style={{ flex:1, height:7, background:T.BORDER, borderRadius:4, overflow:"hidden" }}>
        <div style={{ width:`${Math.min(100,value||0)}%`, height:"100%", background:color, borderRadius:4, transition:"width 0.5s" }} />
      </div>
      <span style={{ fontSize:11, color:T.GOLD, minWidth:32, textAlign:"right" }}>{value != null ? `${value}%` : "—"}</span>
    </div>
  );
}

function CTooltip({ active, payload, label, T }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:8, padding:"8px 12px", fontSize:12 }}>
      <div style={{ color:T.GOLD, marginBottom:4 }}>{label}</div>
      {payload.map(p => <div key={p.name} style={{ color:p.color||T.GOLD }}>{p.name}: {p.value}</div>)}
    </div>
  );
}

function VendorBadge({ vendor, vendors }) {
  const idx   = vendors.indexOf(vendor);
  const color = VENDOR_COLORS[idx % VENDOR_COLORS.length];
  return (
    <span style={{ padding:"2px 8px", borderRadius:10, fontSize:10, fontWeight:600, letterSpacing:0.5,
      background:`${color}22`, border:`1px solid ${color}55`, color }}>
      {vendor}
    </span>
  );
}

function effColor(v, T) {
  return v == null ? T.DIM : v >= 85 ? T.GREEN : v >= 60 ? T.GOLD : T.RED;
}

// ─── Theme switcher ───────────────────────────────────────────────────────────
function ThemeSwitcher({ current, onChange, T }) {
  return (
    <div style={{ display:"flex", gap:6, padding:"10px 14px" }}>
      {Object.entries(THEMES).map(([key, theme]) => (
        <button key={key} onClick={() => onChange(key)}
          title={theme.name}
          style={{ width:20, height:20, borderRadius:"50%", border:`2px solid ${current===key ? T.ACCENT : "transparent"}`,
            background: theme.ACCENT, cursor:"pointer", padding:0, transition:"border 0.2s" }} />
      ))}
    </div>
  );
}

// ─── Vendor Upload Modal ──────────────────────────────────────────────────────
function VendorUploadModal({ existingOrders, onSave, onClose, T, ordersHistory }) {
  const existingVendors = [...new Set(Object.values(existingOrders).map(v => v.vendor))];

  // Default effective date = next Monday
  const getNextMonday = () => {
    const d = new Date();
    const day = d.getDay();
    const daysUntilMon = day === 0 ? 1 : 8 - day;
    d.setDate(d.getDate() + daysUntilMon);
    return d.toISOString().split("T")[0];
  };

  const [vendors, setVendors] = useState([
    { name: existingVendors[0] || "", file:null, parsed:null, error:null },
    { name: existingVendors[1] || "", file:null, parsed:null, error:null },
  ]);
  const [effectiveDate, setEffectiveDate] = useState(getNextMonday);
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

  const handleSave = () => {
    const merged = {};
    vendors.forEach(v => {
      if (v.parsed) Object.entries(v.parsed).forEach(([item, data]) => {
        merged[item] = { ...data, vendor: v.name.trim() || "Vendor" };
      });
    });
    if (Object.keys(merged).length === 0) return;
    onSave(merged, effectiveDate);
    onClose();
  };

  const totalItems = vendors.reduce((a,v) => a + (v.parsed ? Object.keys(v.parsed).length : 0), 0);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.82)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, backdropFilter:"blur(4px)" }}>
      <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:16, padding:40, width:620, maxWidth:"92vw" }}>
        <h2 style={{ fontFamily:"'Playfair Display', serif", color:T.TEXT, marginBottom:6, fontSize:22 }}>Upload Vendor Standing Orders</h2>
        <p style={{ color:T.DIM, fontSize:13, marginBottom:20 }}>
          One .xlsx file per vendor — needs a <strong style={{ color:T.GOLD }}>Product</strong> column and <strong style={{ color:T.GOLD }}>Monday–Sunday</strong> quantity columns.
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
                Orders will apply to weeks starting on or after this date
              </div>
            </div>
          </div>
          {ordersHistory && ordersHistory.length > 0 && (
            <div style={{ marginTop:14, borderTop:`1px solid ${T.BORDER}`, paddingTop:12 }}>
              <div style={{ color:T.DIM, fontSize:11, letterSpacing:1.5, textTransform:"uppercase", marginBottom:8 }}>Version History</div>
              {[...ordersHistory].reverse().slice(0,4).map((v,i) => (
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
            <button onClick={handleSave} disabled={totalItems===0}
              style={{ padding:"10px 22px", background:totalItems>0?T.ACCENT:T.BORDER, border:"none", borderRadius:8,
                color:totalItems>0?T.BG:T.DIM, cursor:totalItems>0?"pointer":"not-allowed", fontSize:14, fontWeight:700 }}>
              Save Standing Orders
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Settings Modal ───────────────────────────────────────────────────────────
function SettingsModal({ settings, onSave, onClose, T }) {
  const [local, setLocal] = useState(settings);
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, backdropFilter:"blur(4px)" }}>
      <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:16, padding:40, width:480, maxWidth:"90vw" }}>
        <h2 style={{ fontFamily:"'Playfair Display', serif", color:T.TEXT, marginBottom:24, fontSize:22 }}>Settings</h2>
        <label style={{ display:"block", marginBottom:20 }}>
          <div style={{ color:T.GOLD, fontSize:12, letterSpacing:2, marginBottom:8, textTransform:"uppercase" }}>Store Name</div>
          <input value={local.storeName} onChange={e => setLocal({...local,storeName:e.target.value})} placeholder="My Bakery"
            style={{ width:"100%", padding:"10px 14px", background:T.BG, border:`1px solid ${T.BORDER}`, borderRadius:8, color:T.TEXT, fontSize:14, outline:"none" }} />
        </label>
        <div style={{ background:T.BG, border:`1px solid ${T.BORDER}`, borderRadius:8, padding:"12px 16px", marginBottom:20, fontSize:12, color:T.DIM }}>
          API key is stored in your <code style={{ background:T.BORDER, padding:"1px 5px", borderRadius:4 }}>.env</code> file on the proxy server — not in the browser.
        </div>
        <div style={{ display:"flex", gap:12, justifyContent:"flex-end" }}>
          <button onClick={onClose}
            style={{ padding:"10px 24px", background:"transparent", border:`1px solid ${T.BORDER}`, borderRadius:8, color:T.GOLD, cursor:"pointer", fontSize:14 }}>
            Cancel
          </button>
          <button onClick={() => { onSave(local); onClose(); }}
            style={{ padding:"10px 24px", background:T.ACCENT, border:"none", borderRadius:8, color:T.BG, cursor:"pointer", fontSize:14, fontWeight:700 }}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard View ───────────────────────────────────────────────────────────
function DayDrillModal({ dayName, dayIndex, weekData, vendorFilter, monday, onClose, T }) {
  const filtered = vendorFilter==="all" ? weekData : weekData.filter(s => s.vendor===vendorFilter);
  const date     = toISODate(addDays(monday, dayIndex));
  const items    = filtered.map(s => ({ ...s, day: s.dayResults[dayIndex] }))
                           .filter(s => s.day.ordered > 0 || s.day.sold > 0)
                           .sort((a,b) => (b.day.sold||0) - (a.day.sold||0));
  const totalSold    = items.reduce((a,s) => a+(s.day.sold||0), 0);
  const totalOrdered = items.reduce((a,s) => a+(s.day.ordered||0), 0);
  const eff          = totalOrdered > 0 ? Math.round((totalSold/totalOrdered)*100) : null;
  const soldOuts     = items.filter(s => s.day.soldOut).length;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center",
      justifyContent:"center", zIndex:200, backdropFilter:"blur(4px)" }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:16, width:680, maxWidth:"94vw",
        maxHeight:"85vh", display:"flex", flexDirection:"column", overflow:"hidden" }}>

        {/* Header */}
        <div style={{ padding:"22px 28px", borderBottom:`1px solid ${T.BORDER}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontFamily:"'Playfair Display', serif", fontSize:22, fontWeight:700, color:T.TEXT }}>{dayName}</div>
            <div style={{ color:T.DIM, fontSize:12, marginTop:3 }}>{date}</div>
          </div>
          <div style={{ display:"flex", gap:24, alignItems:"center" }}>
            {[
              { label:"Sold", value:totalSold },
              { label:"Ordered", value:totalOrdered },
              { label:"Efficiency", value:eff!=null?`${eff}%`:"—", color:effColor(eff,T) },
              { label:"Sold Out", value:soldOuts },
            ].map(s => (
              <div key={s.label} style={{ textAlign:"center" }}>
                <div style={{ fontFamily:"'Playfair Display', serif", fontSize:22, fontWeight:700, color:s.color||T.TEXT }}>{s.value}</div>
                <div style={{ color:T.DIM, fontSize:10, letterSpacing:1.5, textTransform:"uppercase" }}>{s.label}</div>
              </div>
            ))}
            <button onClick={onClose} style={{ background:"transparent", border:`1px solid ${T.BORDER}`,
              borderRadius:8, color:T.DIM, cursor:"pointer", padding:"6px 12px", fontSize:13 }}>✕</button>
          </div>
        </div>

        {/* Table */}
        <div style={{ overflow:"auto", flex:1 }}>
          {items.length === 0 ? (
            <div style={{ padding:40, textAlign:"center", color:T.DIM }}>No items ordered or sold on this day</div>
          ) : (
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ position:"sticky", top:0, background:T.SIDEBAR }}>
                  {["Item","Vendor","Ordered","Sold","Efficiency","Last Sale","Status"].map(h => (
                    <th key={h} style={{ textAlign:h==="Item"||h==="Vendor"?"left":"right", padding:"10px 16px",
                      color:T.DIM, fontSize:10, textTransform:"uppercase", letterSpacing:1, fontWeight:400,
                      borderBottom:`1px solid ${T.BORDER}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((s,i) => (
                  <tr key={s.item} style={{ borderBottom:`1px solid ${T.BG}`, background:i%2===0?"transparent":`${T.BORDER}20` }}>
                    <td style={{ padding:"10px 16px", fontWeight:600, color:T.TEXT }}>{s.item}</td>
                    <td style={{ padding:"10px 16px" }}><VendorBadge vendor={s.vendor} vendors={[s.vendor]} /></td>
                    <td style={{ padding:"10px 16px", textAlign:"right", color:T.DIM }}>{s.day.ordered}</td>
                    <td style={{ padding:"10px 16px", textAlign:"right", color:T.TEXT, fontWeight:600 }}>{s.day.sold}</td>
                    <td style={{ padding:"10px 16px", textAlign:"right", color:effColor(s.day.efficiency,T), fontWeight:700 }}>
                      {s.day.efficiency!=null ? `${s.day.efficiency}%` : "—"}
                    </td>
                    <td style={{ padding:"10px 16px", textAlign:"right", color:s.day.sellOutTime?T.GREEN:T.DIM, fontSize:12 }}>
                      {s.day.sellOutTime||"—"}
                    </td>
                    <td style={{ padding:"10px 16px", textAlign:"right" }}>
                      {s.day.ordered===0
                        ? <span style={{ padding:"2px 10px", borderRadius:20, fontSize:11, background:T.BORDER, color:T.DIM }}>Not Ordered</span>
                        : s.day.oversold
                        ? <span style={{ padding:"2px 10px", borderRadius:20, fontSize:11, background:"#ff000022", color:"#ff4444", fontWeight:700 }}>⚠ Oversold</span>
                        : s.day.soldOut
                        ? <span style={{ padding:"2px 10px", borderRadius:20, fontSize:11, background:`${T.GREEN}22`, color:T.GREEN }}>Sold Out</span>
                        : s.day.sold>0
                        ? <span style={{ padding:"2px 10px", borderRadius:20, fontSize:11, background:`${T.RED}22`, color:T.RED }}>Remainder</span>
                        : <span style={{ padding:"2px 10px", borderRadius:20, fontSize:11, background:T.BORDER, color:T.DIM }}>No Sales</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function DashboardView({ weekData, weekLabel, vendorFilter, vendors, monday, T }) {
  const filtered     = vendorFilter==="all" ? weekData : weekData.filter(s => s.vendor===vendorFilter);
  const totalSold    = filtered.reduce((a,s) => a+s.totalSold, 0);
  const totalOrdered = filtered.reduce((a,s) => a+s.totalOrdered, 0);
  const overallEff   = totalOrdered>0 ? Math.round((totalSold/totalOrdered)*100) : null;
  const soldOutItems = filtered.filter(s => s.soldOutCount>0).length;
  const [drillDay,   setDrillDay]   = useState(null); // index 0-6

  const dailyTotals = DAY_NAMES.map((day,i) => ({
    day: day.slice(0,3),
    dayIndex: i,
    Sold:    filtered.reduce((a,s) => a+(s.dayResults[i]?.sold    ||0), 0),
    Ordered: filtered.reduce((a,s) => a+(s.dayResults[i]?.ordered ||0), 0),
  }));

  const sellOutFreq = [...filtered].filter(s=>s.soldOutCount>0)
    .sort((a,b)=>b.soldOutCount-a.soldOutCount)
    .map(s=>({ name:s.item.length>18?s.item.slice(0,17)+"…":s.item, "Days Sold Out":s.soldOutCount }));

  const best  = [...filtered].sort((a,b)=>b.totalSold-a.totalSold).slice(0,3);
  const worst = [...filtered].filter(s=>s.avgEff!=null).sort((a,b)=>a.avgEff-b.avgEff).slice(0,3);

  const mkTooltip = (props) => <CTooltip {...props} T={T} />;

  return (
    <div>
      {drillDay !== null && (
        <DayDrillModal
          dayName={DAY_NAMES[drillDay]} dayIndex={drillDay}
          weekData={weekData} vendorFilter={vendorFilter}
          monday={monday} onClose={() => setDrillDay(null)} T={T} />
      )}
      <div style={{ marginBottom:22, color:T.DIM, fontSize:13 }}>
        📅 <span style={{ color:T.GOLD }}>{weekLabel}</span> · Square transactions
        {vendorFilter!=="all" && <span style={{ marginLeft:10, padding:"2px 10px", borderRadius:10, fontSize:11, background:T.BORDER, color:T.GOLD }}>{vendorFilter}</span>}
      </div>

      {/* Stat cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:16, marginBottom:28 }}>
        {[
          { label:"Items Tracked",      value:filtered.length,                         unit:vendorFilter==="all"?"all vendors":vendorFilter },
          { label:"Total Sold",         value:totalSold,                               unit:`of ${totalOrdered} ordered` },
          { label:"Overall Efficiency", value:overallEff!=null?`${overallEff}%`:"—",   unit:"sell-through" },
          { label:"Sold-Out Items",     value:soldOutItems,                            unit:"≥1 day sold out" },
        ].map(c => (
          <div key={c.label} style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:12, padding:"20px 22px" }}>
            <div style={{ color:T.DIM, fontSize:11, letterSpacing:2, textTransform:"uppercase", marginBottom:8 }}>{c.label}</div>
            <div style={{ fontFamily:"'Playfair Display', serif", fontSize:30, fontWeight:700, lineHeight:1, color:T.TEXT }}>{c.value}</div>
            <div style={{ color:T.DIM, fontSize:12, marginTop:4 }}>{c.unit}</div>
          </div>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, marginBottom:20 }}>
        {/* Daily chart */}
        <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:12, padding:24 }}>
          <div style={{ color:T.DIM, fontSize:11, letterSpacing:2, textTransform:"uppercase", marginBottom:20 }}>Daily Sold vs Ordered</div>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={dailyTotals} barGap={3} style={{ cursor:"pointer" }}
              onClick={e => e?.activePayload && setDrillDay(e.activePayload[0]?.payload?.dayIndex ?? null)}>
              <CartesianGrid stroke={T.BORDER} strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="day" stroke={T.DIM} tick={{ fill:T.DIM, fontSize:11 }} tickLine={false} axisLine={false} />
              <YAxis stroke={T.DIM} tick={{ fill:T.DIM, fontSize:11 }} tickLine={false} axisLine={false} />
              <Tooltip content={mkTooltip} cursor={{ fill:`${T.BORDER}80` }} />
              <Bar dataKey="Ordered" fill={T.CHART_ORDERED} radius={[3,3,0,0]} />
              <Bar dataKey="Sold"    fill={T.CHART_SOLD}    radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ display:"flex", gap:16, marginTop:10, fontSize:11, color:T.DIM }}>
            <span><span style={{ display:"inline-block",width:10,height:10,background:T.CHART_ORDERED,borderRadius:2,marginRight:5 }}/>Ordered</span>
            <span><span style={{ display:"inline-block",width:10,height:10,background:T.CHART_SOLD,borderRadius:2,marginRight:5 }}/>Sold</span>
            <span style={{ marginLeft:"auto", color:T.BORDER }}>Click a day for details</span>
          </div>
        </div>

        {/* Sell-out frequency */}
        <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:12, padding:24 }}>
          <div style={{ color:T.DIM, fontSize:11, letterSpacing:2, textTransform:"uppercase", marginBottom:20 }}>Sell-Out Frequency</div>
          {sellOutFreq.length>0 ? (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={sellOutFreq} layout="vertical">
                <XAxis type="number" domain={[0,7]} ticks={[0,1,2,3,4,5,6,7]} stroke={T.DIM} tick={{ fill:T.DIM,fontSize:11 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" stroke={T.DIM} tick={{ fill:T.GOLD,fontSize:11 }} tickLine={false} axisLine={false} width={120} />
                <Tooltip content={mkTooltip} cursor={{ fill:`${T.BORDER}80` }} />
                <Bar dataKey="Days Sold Out" fill={T.GREEN} radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height:210, display:"flex", alignItems:"center", justifyContent:"center", color:T.DIM, fontSize:13 }}>No sell-outs recorded</div>
          )}
        </div>
      </div>

      {/* Vendor comparison */}
      {vendorFilter==="all" && vendors.length>1 && (
        <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:12, padding:24, marginBottom:20 }}>
          <div style={{ color:T.DIM, fontSize:11, letterSpacing:2, textTransform:"uppercase", marginBottom:20 }}>Vendor Comparison</div>
          <div style={{ display:"grid", gridTemplateColumns:`repeat(${vendors.length},1fr)`, gap:16 }}>
            {vendors.map((vendor, vi) => {
              const vItems = weekData.filter(s=>s.vendor===vendor);
              const vSold  = vItems.reduce((a,s)=>a+s.totalSold,0);
              const vOrd   = vItems.reduce((a,s)=>a+s.totalOrdered,0);
              const vEff   = vOrd>0 ? Math.round((vSold/vOrd)*100) : null;
              const color  = VENDOR_COLORS[vi%VENDOR_COLORS.length];
              return (
                <div key={vendor} style={{ background:T.BG, border:`1px solid ${color}44`, borderRadius:10, padding:20 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
                    <div style={{ width:8, height:8, borderRadius:"50%", background:color }} />
                    <span style={{ fontWeight:600, fontSize:14, color:T.TEXT }}>{vendor}</span>
                  </div>
                  {[
                    { label:"Items",          value:vItems.length },
                    { label:"Sold / Ordered", value:`${vSold} / ${vOrd}` },
                    { label:"Efficiency",     value:vEff!=null?`${vEff}%`:"—" },
                    { label:"Sold-Out Items", value:vItems.filter(s=>s.soldOutCount>0).length },
                  ].map(r => (
                    <div key={r.label} style={{ display:"flex", justifyContent:"space-between", marginBottom:8, fontSize:13 }}>
                      <span style={{ color:T.DIM }}>{r.label}</span>
                      <span style={{ color:T.GOLD, fontWeight:600 }}>{r.value}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Best & Worst */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
        {[
          { label:"🏆 Top Sellers",       items:best,  vk:"totalSold", suffix:" units", color:T.GREEN },
          { label:"📉 Lowest Efficiency", items:worst, vk:"avgEff",    suffix:"%",      color:T.RED   },
        ].map(({ label, items, vk, suffix, color }) => (
          <div key={label} style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:12, padding:24 }}>
            <div style={{ color:T.DIM, fontSize:11, letterSpacing:2, textTransform:"uppercase", marginBottom:20 }}>{label}</div>
            {items.length===0 && <div style={{ color:T.DIM, fontSize:13 }}>Not enough data</div>}
            {items.map((s,i) => (
              <div key={s.item} style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
                <div style={{ fontFamily:"'Playfair Display', serif", fontSize:20, color:T.BORDER, fontWeight:700, minWidth:20 }}>{i+1}</div>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                    <span style={{ fontSize:13, fontWeight:600, color:T.TEXT }}>{s.item}</span>
                    <VendorBadge vendor={s.vendor} vendors={vendors} />
                  </div>
                  <MiniBar value={s.avgEff} color={effColor(s.avgEff,T)} T={T} />
                </div>
                <div style={{ fontFamily:"'Playfair Display', serif", fontSize:20, fontWeight:700, color }}>{s[vk]}{suffix}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Items View ───────────────────────────────────────────────────────────────
function ItemsView({ weekData, vendorFilter, vendors, T }) {
  const filtered    = vendorFilter==="all" ? weekData : weekData.filter(s=>s.vendor===vendorFilter);
  const [activeItem, setActiveItem] = useState(filtered[0]?.item ?? null);
  const active = weekData.find(s=>s.item===activeItem);
  useEffect(() => { if (!filtered.find(s=>s.item===activeItem)) setActiveItem(filtered[0]?.item??null); }, [vendorFilter]);

  return (
    <div style={{ display:"grid", gridTemplateColumns:"280px 1fr", gap:24 }}>
      {/* Item list */}
      <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:12, overflow:"hidden" }}>
        <div style={{ padding:"16px 20px", borderBottom:`1px solid ${T.BORDER}` }}>
          <div style={{ color:T.DIM, fontSize:11, letterSpacing:2, textTransform:"uppercase" }}>Pastries · {filtered.length}</div>
        </div>
        <div style={{ overflow:"auto", maxHeight:600 }}>
          {filtered.map(s => (
            <div key={s.item} onClick={()=>setActiveItem(s.item)}
              style={{ padding:"13px 20px", cursor:"pointer", borderBottom:`1px solid ${T.BG}`,
                background:activeItem===s.item?T.BORDER:"transparent", transition:"background 0.15s" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, marginBottom:3, color:T.TEXT }}>{s.item}</div>
                  <VendorBadge vendor={s.vendor} vendors={vendors} />
                </div>
                <span style={{ fontSize:17, color:effColor(s.avgEff,T), fontFamily:"'Playfair Display', serif", fontWeight:700 }}>
                  {s.avgEff!=null?`${s.avgEff}%`:"—"}
                </span>
              </div>
              <MiniBar value={s.avgEff} color={effColor(s.avgEff,T)} T={T} />
              <div style={{ color:T.DIM, fontSize:11, marginTop:5 }}>
                {s.soldOutCount>0?`Sold out ${s.soldOutCount}/${DAY_NAMES.length} days · avg ${minsToLabel(s.avgSellOutMins)}`:"No sell-outs this week"}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail panel */}
      {active && (
        <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:12, overflow:"hidden" }}>
          <div style={{ padding:"20px 28px", borderBottom:`1px solid ${T.BORDER}`, display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
                <div style={{ fontFamily:"'Playfair Display', serif", fontSize:22, fontWeight:700, color:T.TEXT }}>{active.item}</div>
                <VendorBadge vendor={active.vendor} vendors={vendors} />
              </div>
              <div style={{ color:T.DIM, fontSize:12 }}>
                {active.soldOutCount} sell-out day{active.soldOutCount!==1?"s":""} · {active.totalSold} sold of {active.totalOrdered} ordered
                {active.avgSellOutMins!=null && ` · avg ${minsToLabel(active.avgSellOutMins)}`}
              </div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontFamily:"'Playfair Display', serif", fontSize:34, fontWeight:700, color:effColor(active.avgEff,T) }}>
                {active.avgEff!=null?`${active.avgEff}%`:"—"}
              </div>
              <div style={{ color:T.DIM, fontSize:11 }}>weekly efficiency</div>
            </div>
          </div>

          <div style={{ padding:"20px 28px" }}>
            <div style={{ color:T.DIM, fontSize:11, letterSpacing:2, textTransform:"uppercase", marginBottom:16 }}>Day-by-Day Breakdown</div>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr>
                  {["Day","Date","Ordered","Sold","Efficiency","Last Sale","Status"].map(h => (
                    <th key={h} style={{ textAlign:"left", paddingBottom:10, paddingRight:14, color:T.DIM,
                      fontSize:11, textTransform:"uppercase", letterSpacing:1, fontWeight:400, borderBottom:`1px solid ${T.BORDER}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.dayResults.map(d => (
                  <tr key={d.dayName} style={{ borderBottom:`1px solid ${T.BG}` }}>
                    <td style={{ padding:"10px 14px 10px 0", fontWeight:600, color:T.TEXT }}>{d.dayName.slice(0,3)}</td>
                    <td style={{ padding:"10px 14px 10px 0", color:T.GOLD, fontSize:12 }}>{d.date}</td>
                    <td style={{ padding:"10px 14px 10px 0", color:T.DIM }}>{d.ordered}</td>
                    <td style={{ padding:"10px 14px 10px 0", color:T.TEXT }}>{d.sold}</td>
                    <td style={{ padding:"10px 14px 10px 0", color:effColor(d.efficiency,T) }}>{d.efficiency!=null?`${d.efficiency}%`:"—"}</td>
                    <td style={{ padding:"10px 14px 10px 0", color:d.sellOutTime?T.GREEN:T.DIM, fontSize:12 }}>{d.sellOutTime||"—"}</td>
                    <td style={{ padding:"10px 0" }}>
                      {d.ordered===0
                        ? <span style={{ padding:"2px 10px", borderRadius:20, fontSize:11, background:`${T.BORDER}`, color:T.DIM }}>Not Ordered</span>
                        : d.soldOut
                        ? <span style={{ padding:"2px 10px", borderRadius:20, fontSize:11, background:`${T.GREEN}22`, color:T.GREEN }}>Sold Out</span>
                        : d.sold>0
                        ? <span style={{ padding:"2px 10px", borderRadius:20, fontSize:11, background:`${T.RED}22`, color:T.RED }}>Remainder</span>
                        : <span style={{ padding:"2px 10px", borderRadius:20, fontSize:11, background:T.BORDER, color:T.DIM }}>No Sales</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Nav ──────────────────────────────────────────────────────────────────────
const NAV = [
  { id:"dashboard", label:"Dashboard", icon:"▦" },
  { id:"items",     label:"Item Detail", icon:"≡" },
  { id:"odeko",     label:"Odeko",       icon:"🛒" },
];

const ODEKO_CATEGORY = "Dis Burrito";

// ─── App ──────────────────────────────────────────────────────────────────────

// ─── Report Modal ─────────────────────────────────────────────────────────────
function ReportModal({ weekData, weekLabel, storeName, vendors, odekoData, onClose }) {
  const totalSold    = weekData.reduce((a,s) => a+s.totalSold, 0);
  const totalOrdered = weekData.reduce((a,s) => a+s.totalOrdered, 0);
  const overallEff   = totalOrdered > 0 ? Math.round((totalSold/totalOrdered)*100) : 0;
  const soldOutItems = weekData.filter(s => s.soldOutCount > 0).length;

  const handlePrint = () => {
    let htmlContent = "";
    const now = new Date().toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" });

    // Build per-item rows
    const itemRows = [...weekData]
      .filter(s => s.totalOrdered > 0)
      .sort((a,b) => (b.avgEff||0) - (a.avgEff||0))
      .map(s => `
        <tr>
          <td>${s.item}</td>
          <td class="vendor">${s.vendor}</td>
          <td class="num">${s.totalOrdered}</td>
          <td class="num">${s.totalSold}</td>
          <td class="num eff ${s.avgEff>=85?"green":s.avgEff>=60?"gold":"red"}">${s.avgEff!=null?s.avgEff+"%":"—"}</td>
          <td class="num">${s.soldOutCount} / 7</td>
          <td class="num">${s.avgSellOutMins!=null ? (Math.floor(s.avgSellOutMins/60)+"h "+(s.avgSellOutMins%60)+"m") : "—"}</td>
        </tr>
      `).join("");

    // Build "Needs Attention" — items that sold out before 10am on any day
    // 10am = 3h after 7am open = 180 mins from open
    const EARLY_MINS = 180;
    const attentionRows = [];
    weekData.filter(s => s.totalOrdered > 0).forEach(s => {
      s.dayResults.forEach(d => {
        if ((d.soldOut || d.oversold) && d.minsFromOpen != null && d.minsFromOpen < EARLY_MINS) {
          attentionRows.push({ item: s.item, vendor: s.vendor, day: d.dayName, time: d.sellOutTime, ordered: d.ordered, sold: d.sold });
        }
      });
    });
    const attentionSection = attentionRows.length > 0 ? `
  <div class="section">
  <h2>⚡ Needs Attention — Sold Out Before 10am</h2>
  <table>
    <thead><tr><th>Item</th><th>Vendor</th><th>Day</th><th class="num">Ordered</th><th class="num">Sold</th><th class="num">Sold Out At</th></tr></thead>
    <tbody>
      ${attentionRows.map(r => `
        <tr>
          <td><strong>${r.item}</strong></td>
          <td class="vendor">${r.vendor}</td>
          <td>${r.day}</td>
          <td class="num">${r.ordered}</td>
          <td class="num">${r.sold}</td>
          <td class="num red"><strong>${r.time}</strong></td>
        </tr>
      `).join("")}
    </tbody>
  </table>
  <p style="font-size:11px;color:#a08060;margin-top:8px">These items ran out before 10am — consider increasing the standing order quantity on these days.</p>
  </div>` : "";

    // Build Odeko section
    const odekoSection = odekoData && odekoData.length > 0 ? `
  <div class="section">
  <h2>Odeko — Dis Burrito Sales</h2>
  <table>
    <thead>
      <tr>
        <th>Variation</th>
        <th class="num">Mon</th><th class="num">Tue</th><th class="num">Wed</th>
        <th class="num">Thu</th><th class="num">Fri</th><th class="num">Sat</th><th class="num">Sun</th>
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>
      ${odekoData.map(s => `
        <tr>
          <td>${s.item}</td>
          ${["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map(d => `<td class="num">${s.byDate?.[d] || 0}</td>`).join("")}
          <td class="num eff green"><strong>${s.total}</strong></td>
        </tr>
      `).join("")}
      <tr style="border-top:2px solid #e8d5b0;font-weight:700">
        <td>Total</td>
        ${["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map(d => `<td class="num">${odekoData.reduce((a,s)=>a+(s.byDate?.[d]||0),0)}</td>`).join("")}
        <td class="num">${odekoData.reduce((a,s)=>a+s.total,0)}</td>
      </tr>
    </tbody>
  </table>
  </div>` : "";

    // Build vendor summary rows
    const vendorRows = vendors.map(vendor => {
      const vItems = weekData.filter(s=>s.vendor===vendor);
      const vSold  = vItems.reduce((a,s)=>a+s.totalSold,0);
      const vOrd   = vItems.reduce((a,s)=>a+s.totalOrdered,0);
      const vEff   = vOrd>0 ? Math.round((vSold/vOrd)*100) : 0;
      const vSO    = vItems.filter(s=>s.soldOutCount>0).length;
      return `
        <tr>
          <td>${vendor}</td>
          <td class="num">${vItems.length}</td>
          <td class="num">${vSold} / ${vOrd}</td>
          <td class="num eff ${vEff>=85?"green":vEff>=60?"gold":"red"}">${vEff}%</td>
          <td class="num">${vSO}</td>
        </tr>
      `;
    }).join("");

    // Daily totals for simple text chart
    const dailyRows = DAY_NAMES.map((day, i) => {
      const sold    = weekData.reduce((a,s) => a+(s.dayResults[i]?.sold||0), 0);
      const ordered = weekData.reduce((a,s) => a+(s.dayResults[i]?.ordered||0), 0);
      const eff     = ordered > 0 ? Math.round((sold/ordered)*100) : 0;
      const barFill = Math.min(10, Math.max(0, Math.round(eff/10)));
      const bar     = "&#9608;".repeat(barFill) + "&#9617;".repeat(10-barFill);
      return `
        <tr>
          <td>${day.slice(0,3)}</td>
          <td class="num">${ordered}</td>
          <td class="num">${sold}</td>
          <td class="num eff ${eff>=85?"green":eff>=60?"gold":"red"}">${eff}%</td>
          <td class="bar">${bar}</td>
        </tr>
      `;
    }).join("");

    htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Crumbs Weekly Report — ${weekLabel}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Lato:wght@300;400;700&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Lato',sans-serif; color:#1a1008; background:#fff; padding:32px 48px; font-size:13px; }
    @page { margin: 12mm 10mm; }
    @media print {
      body { padding:0; margin:0; }
      .no-print { display:none !important; }

      /* Never break inside these elements */
      table, tr, td, th { page-break-inside:avoid; }
      thead { display:table-header-group; }

      /* Sections: keep header with its content, avoid orphaned headings */
      h2 { page-break-after:avoid; page-break-before:auto; }
      .section { page-break-inside:avoid; }

      /* Stat cards stay together */
      .stats { page-break-inside:avoid; }

      /* Each table row stays intact */
      tr { page-break-inside:avoid; page-break-after:auto; }

      /* Vendor comparison cards */
      .vendor-cards { page-break-inside:avoid; }

      /* Item breakdown table — allow page breaks between rows but not within */
      .item-table tr { page-break-inside:avoid; }
    }

    /* Header */
    .header { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:3px solid #c9a87c; padding-bottom:16px; margin-bottom:28px; }
    .header h1 { font-family:'Playfair Display',serif; font-size:32px; color:#1a1008; }
    .header .meta { text-align:right; color:#5a3a1a; font-size:12px; line-height:1.8; }
    .header .week { font-size:15px; font-weight:700; color:#c9a87c; }

    /* Stat cards */
    .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:32px; }
    .stat { border:1px solid #e8d5b0; border-radius:10px; padding:16px 18px; background:#fffdf7; }
    .stat-label { font-size:10px; letter-spacing:2px; text-transform:uppercase; color:#a08060; margin-bottom:6px; }
    .stat-value { font-family:'Playfair Display',serif; font-size:28px; font-weight:700; color:#1a1008; line-height:1; }
    .stat-sub { font-size:11px; color:#a08060; margin-top:4px; }

    /* Section headers */
    h2 { font-family:'Playfair Display',serif; font-size:16px; color:#1a1008; margin:28px 0 12px; border-bottom:1px solid #e8d5b0; padding-bottom:6px; }

    /* Tables */
    table { width:100%; border-collapse:collapse; margin-bottom:8px; }
    th { text-align:left; font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:#a08060; padding:8px 10px; border-bottom:2px solid #e8d5b0; font-weight:400; }
    td { padding:8px 10px; border-bottom:1px solid #f0e8d8; font-size:12px; }
    tr:last-child td { border-bottom:none; }
    tr:hover { background:#fdf8f0; }
    .num { text-align:right; font-variant-numeric:tabular-nums; }
    .vendor { font-size:11px; color:#a08060; }
    .bar { font-family:monospace; font-size:11px; color:#c9a87c; letter-spacing:-1px; }
    .eff { font-weight:700; }
    .green { color:#3a7a3a; }
    .gold  { color:#8a6020; }
    .red   { color:#a03020; }

    /* Footer */
    .footer { margin-top:40px; padding-top:16px; border-top:1px solid #e8d5b0; display:flex; justify-content:space-between; color:#a08060; font-size:11px; }

    /* Print button */
    .print-btn { display:inline-block; margin-bottom:24px; padding:10px 24px; background:#c9a87c; color:#fff; border:none; border-radius:8px; font-size:14px; font-family:'Lato',sans-serif; cursor:pointer; font-weight:700; }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom:20px"><button class="print-btn" onclick="window.print()">⬇ Save as PDF / Print</button></div>

  <div class="header">
    <div>
      <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#a08060;margin-bottom:4px">Weekly Report</div>
      <h1>${storeName}</h1>
    </div>
    <div class="meta">
      <div class="week">${weekLabel}</div>
      <div>Generated ${now}</div>
      <div>${weekData.length} items tracked &middot; ${vendors.join(", ")}</div>
    </div>
  </div>

  <!-- Summary Stats -->
  <div class="stats">
    <div class="stat">
      <div class="stat-label">Items Tracked</div>
      <div class="stat-value">${weekData.length}</div>
      <div class="stat-sub">across ${vendors.length} vendor${vendors.length!==1?"s":""}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Total Sold</div>
      <div class="stat-value">${totalSold}</div>
      <div class="stat-sub">of ${totalOrdered} ordered</div>
    </div>
    <div class="stat">
      <div class="stat-label">Overall Efficiency</div>
      <div class="stat-value eff ${overallEff>=85?"green":overallEff>=60?"gold":"red"}">${overallEff}%</div>
      <div class="stat-sub">sell-through rate</div>
    </div>
    <div class="stat">
      <div class="stat-label">Sold-Out Items</div>
      <div class="stat-value">${soldOutItems}</div>
      <div class="stat-sub">had &ge;1 sell-out day</div>
    </div>
  </div>

  <!-- Daily breakdown -->
  <div class="section">
  <h2>Daily Performance</h2>
  <table>
    <thead><tr><th>Day</th><th class="num">Ordered</th><th class="num">Sold</th><th class="num">Efficiency</th><th>Visual</th></tr></thead>
    <tbody>${dailyRows}</tbody>
  </table>
  </div>

  ${vendors.length > 1 ? `
  <!-- Vendor comparison -->
  <div class="section">
  <h2>Vendor Comparison</h2>
  <table class="vendor-cards">
    <thead><tr><th>Vendor</th><th class="num">Items</th><th class="num">Sold / Ordered</th><th class="num">Efficiency</th><th class="num">Sell-Out Items</th></tr></thead>
    <tbody>${vendorRows}</tbody>
  </table>
  </div>` : ""}

  <!-- Per-item table -->
  <div class="section">
  <h2>Item Breakdown</h2>
  <table class="item-table">
    <thead>
      <tr>
        <th>Item</th>
        <th>Vendor</th>
        <th class="num">Ordered</th>
        <th class="num">Sold</th>
        <th class="num">Efficiency</th>
        <th class="num">Sold-Out Days</th>
        <th class="num">Avg Sell-Out Time</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  </div><!-- end item breakdown section -->

  ${attentionSection}
  ${odekoSection}

  <div class="footer">
    <span>Crumbs &middot; Pastry Analytics</span>
    <span>${weekLabel}</span>
    <span>Generated ${now}</span>
  </div>
</body>
</html>`;
    // Use Blob URL instead of document.write — avoids blank page in modern browsers
    const blob = new Blob([htmlContent], { type: "text/html" });
    const url  = URL.createObjectURL(blob);
    const win  = window.open(url, "_blank");
    // Revoke after a delay to allow the page to load
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, backdropFilter:"blur(4px)" }}>
      <div style={{ background:"#1a1008", border:"1px solid #5a3a1a", borderRadius:16, padding:40, width:500, maxWidth:"90vw" }}>
        <h2 style={{ fontFamily:"'Playfair Display', serif", color:"#e8c99a", marginBottom:8, fontSize:22 }}>Weekly Report</h2>
        <p style={{ color:"#5a3a1a", fontSize:13, marginBottom:24, lineHeight:1.6 }}>
          Generates a print-ready PDF report for <span style={{ color:"#c9a87c" }}>{weekLabel}</span> including summary stats, daily performance, and full item breakdown.
        </p>
        <div style={{ background:"#120d06", border:"1px solid #2a1f14", borderRadius:10, padding:"14px 18px", marginBottom:24, fontSize:12, color:"#5a3a1a", lineHeight:1.8 }}>
          <div>📊 {weekData.length} items · {vendors.join(", ")}</div>
          <div>📅 {weekLabel}</div>
          <div style={{ marginTop:6, color:"#a08060" }}>A new tab will open — click "Save as PDF / Print" then choose "Save as PDF" in your print dialog.</div>
        </div>
        <div style={{ display:"flex", gap:12, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{ padding:"10px 22px", background:"transparent", border:"1px solid #5a3a1a", borderRadius:8, color:"#c9a87c", cursor:"pointer", fontSize:14 }}>Cancel</button>
          <button onClick={handlePrint} style={{ padding:"10px 22px", background:"#c9a87c", border:"none", borderRadius:8, color:"#0d0904", cursor:"pointer", fontSize:14, fontWeight:700 }}>Generate Report</button>
        </div>
      </div>
    </div>
  );
}


// ─── Odeko View ───────────────────────────────────────────────────────────────
function OdekoView({ odekoData, weekLabel, monday, T }) {
  const totalSold = odekoData.reduce((a,s) => a+s.total, 0);

  return (
    <div>
      <div style={{ marginBottom:22, color:T.DIM, fontSize:13 }}>
        📅 <span style={{ color:T.GOLD }}>{weekLabel}</span> · Dis Burrito (Odeko) — sales by variation
      </div>

      {/* Stat cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, marginBottom:28 }}>
        {[
          { label:"Unique Items",  value:odekoData.length,  unit:"sold this week" },
          { label:"Total Units",   value:totalSold,          unit:"across all items" },
          { label:"Avg per Item",  value:odekoData.length>0?Math.round(totalSold/odekoData.length):"—", unit:"units/item" },
        ].map(c => (
          <div key={c.label} style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:12, padding:"20px 22px" }}>
            <div style={{ color:T.DIM, fontSize:11, letterSpacing:2, textTransform:"uppercase", marginBottom:8 }}>{c.label}</div>
            <div style={{ fontFamily:"'Playfair Display', serif", fontSize:30, fontWeight:700, lineHeight:1, color:T.TEXT }}>{c.value}</div>
            <div style={{ color:T.DIM, fontSize:12, marginTop:4 }}>{c.unit}</div>
          </div>
        ))}
      </div>

      {odekoData.length === 0 ? (
        <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:12, padding:40, textAlign:"center" }}>
          <div style={{ fontFamily:"'Playfair Display', serif", fontSize:24, color:T.BORDER, marginBottom:8 }}>No untracked items found</div>
          <div style={{ color:T.DIM, fontSize:13 }}>All items this week matched standing order items</div>
        </div>
      ) : (
        <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:12, overflow:"hidden" }}>
          <div style={{ padding:"16px 24px", borderBottom:`1px solid ${T.BORDER}` }}>
            <div style={{ color:T.DIM, fontSize:11, letterSpacing:2, textTransform:"uppercase" }}>Item Sales · {odekoData.length} items</div>
          </div>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead>
              <tr>
                {["Item", ...DAY_NAMES.map(d=>d.slice(0,3)), "Total"].map(h => (
                  <th key={h} style={{ textAlign:h==="Item"?"left":"right", padding:"10px 16px", color:T.DIM,
                    fontSize:10, textTransform:"uppercase", letterSpacing:1, fontWeight:400,
                    borderBottom:`1px solid ${T.BORDER}`, background:T.SIDEBAR }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {odekoData.map((s, i) => (
                <tr key={s.item} style={{ borderBottom:`1px solid ${T.BG}`, background:i%2===0?"transparent":`${T.BORDER}30` }}>
                  <td style={{ padding:"11px 16px", fontWeight:600, color:T.TEXT, maxWidth:220 }}>{s.item}</td>
                  {DAY_NAMES.map((day, di) => {
                    const date = toISODate(addDays(monday || new Date(), di));
                    const qty  = s.byDate[date] || 0;
                    return (
                      <td key={day} style={{ padding:"11px 16px", textAlign:"right",
                        color: qty>0 ? T.GOLD : T.BORDER, fontVariantNumeric:"tabular-nums" }}>
                        {qty > 0 ? qty : "—"}
                      </td>
                    );
                  })}
                  <td style={{ padding:"11px 16px", textAlign:"right", fontFamily:"'Playfair Display', serif",
                    fontSize:16, fontWeight:700, color:T.TEXT }}>{s.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ─── Events Modal ─────────────────────────────────────────────────────────────
const SHOP_ADDRESS = "950 E 3rd St, Los Angeles CA 90013 (Arts District)";
const SHOP_AREA    = "Arts District, Los Angeles";

function EventsModal({ onClose, T }) {
  const [events,   setEvents]   = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [fetched,  setFetched]  = useState(false);

  const fetchEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      // Search from today through the next 10 days so current week + upcoming week are both covered
      const today     = new Date();
      const rangeEnd  = new Date(today.getTime() + 10*24*60*60*1000);
      const weekStart = today.toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" });
      const weekEnd   = rangeEnd.toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" });

      const prompt = `You are a local events researcher for a coffee shop and bakery in the Arts District of Los Angeles (near ${SHOP_ADDRESS}).

Search the web and find upcoming festivals, markets, and community events happening near the Arts District LA between ${weekStart} and ${weekEnd}.

Focus on:
- Farmers markets and food markets
- Street fairs and festivals
- Art walks and gallery events (Arts District is an art hub)
- Community gatherings that would bring foot traffic
- Any major events within 2 miles that could affect café traffic

After searching, respond ONLY with a valid JSON array. No markdown, no preamble, just the raw JSON array.
Each object must have exactly these fields:
{
  "name": "Event name",
  "date": "Day, Month Date (e.g. Saturday, March 8)",
  "time": "Time or 'All day'",
  "location": "Venue or street name",
  "distance": "e.g. 0.3 miles, walkable",
  "type": "market|festival|art|community",
  "notes": "One sentence about why this matters for the café"
}

Include recurring weekly events known to happen in that area. Only include real, verified events. Return 4-8 events.`;

      // Multi-turn loop to handle tool use
      const messages = [{ role: "user", content: prompt }];
      let finalText = "";
      let iterations = 0;

      while (iterations < 5) {
        iterations++;
        const res  = await fetch("/api/claude", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 1500,
            tools: [{ type: "web_search_20250305", name: "web_search" }],
            messages,
          })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message || "API error");

        // Append assistant response to messages
        messages.push({ role: "assistant", content: data.content });

        if (data.stop_reason === "end_turn") {
          // Extract final text block
          const textBlock = data.content?.find(b => b.type === "text");
          finalText = textBlock?.text || "";
          break;
        }

        if (data.stop_reason === "tool_use") {
          // Build tool results and continue
          const toolResults = data.content
            .filter(b => b.type === "tool_use")
            .map(b => ({ type: "tool_result", tool_use_id: b.id, content: "Search completed." }));
          messages.push({ role: "user", content: toolResults });
          continue;
        }

        // Fallback: grab any text we have
        const textBlock = data.content?.find(b => b.type === "text");
        if (textBlock?.text) { finalText = textBlock.text; break; }
        break;
      }

      // Parse JSON — strip any accidental markdown fences
      const clean = finalText.replace(/```json|```/g, "").trim();
      const jsonMatch = clean.match(/\[[\s\S]*\]/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : clean);
      setEvents(Array.isArray(parsed) ? parsed : []);
      setFetched(true);
    } catch(err) {
      setError("Could not load events: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const typeIcon = t => ({ market:"🛍", festival:"🎪", art:"🎨", community:"🤝" }[t] || "📍");
  const typeColor = (t, T) => ({ market:T.GOLD, festival:T.GREEN, art:"#9b7ec8", community:T.TEXT }[t] || T.DIM);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex",
      alignItems:"center", justifyContent:"center", zIndex:200, backdropFilter:"blur(4px)" }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:16,
        width:680, maxWidth:"94vw", maxHeight:"85vh", display:"flex", flexDirection:"column", overflow:"hidden" }}>

        {/* Header */}
        <div style={{ padding:"22px 28px", borderBottom:`1px solid ${T.BORDER}`,
          display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontFamily:"'Playfair Display', serif", fontSize:22, fontWeight:700, color:T.TEXT }}>
              Upcoming Events
            </div>
            <div style={{ color:T.DIM, fontSize:12, marginTop:3 }}>
              📍 {SHOP_AREA} · Next week
            </div>
          </div>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            {!loading && (
              <button onClick={fetchEvents}
                style={{ padding:"8px 18px", background:T.GOLD, color:"#1a1008", border:"none",
                  borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"'Lato',sans-serif" }}>
                {fetched ? "↻ Refresh" : "Search Events"}
              </button>
            )}
            <button onClick={onClose}
              style={{ background:"transparent", border:`1px solid ${T.BORDER}`, borderRadius:8,
                color:T.DIM, cursor:"pointer", padding:"7px 13px", fontSize:13 }}>✕</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ overflow:"auto", flex:1, padding:"20px 28px" }}>
          {!fetched && !loading && (
            <div style={{ textAlign:"center", padding:"60px 0" }}>
              <div style={{ fontSize:40, marginBottom:16 }}>🗓</div>
              <div style={{ fontFamily:"'Playfair Display', serif", fontSize:20, color:T.BORDER, marginBottom:8 }}>
                Discover what's happening nearby
              </div>
              <div style={{ color:T.DIM, fontSize:13, marginBottom:24 }}>
                Claude will search for festivals, markets and community events<br/>near the Arts District for next week.
              </div>
              <button onClick={fetchEvents}
                style={{ padding:"10px 28px", background:T.GOLD, color:"#1a1008", border:"none",
                  borderRadius:8, fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"'Lato',sans-serif" }}>
                Search Events
              </button>
            </div>
          )}

          {loading && (
            <div style={{ textAlign:"center", padding:"60px 0" }}>
              <div style={{ fontSize:32, marginBottom:16, animation:"pulse 1s infinite" }}>🔍</div>
              <div style={{ color:T.DIM, fontSize:13 }}>Searching for upcoming events…</div>
            </div>
          )}

          {error && (
            <div style={{ color:"#ff4444", background:"#ff000011", border:"1px solid #ff000033",
              borderRadius:10, padding:"16px 20px", fontSize:13 }}>{error}</div>
          )}

          {fetched && !loading && events.length === 0 && (
            <div style={{ textAlign:"center", padding:"40px 0", color:T.DIM }}>
              No events found for next week. Try refreshing.
            </div>
          )}

          {events.map((ev, i) => (
            <div key={i} style={{ background:T.BG, border:`1px solid ${T.BORDER}`, borderRadius:12,
              padding:"16px 20px", marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:20 }}>{typeIcon(ev.type)}</span>
                  <div>
                    <div style={{ fontWeight:700, color:T.TEXT, fontSize:14 }}>{ev.name}</div>
                    <div style={{ color:T.DIM, fontSize:12, marginTop:2 }}>
                      {ev.date} · {ev.time} · {ev.location}
                    </div>
                  </div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
                  <span style={{ padding:"2px 10px", borderRadius:20, fontSize:10, fontWeight:700,
                    textTransform:"uppercase", letterSpacing:1,
                    background:`${typeColor(ev.type, T)}22`, color:typeColor(ev.type, T) }}>
                    {ev.type}
                  </span>
                  <span style={{ color:T.DIM, fontSize:11 }}>📍 {ev.distance}</span>
                </div>
              </div>
              {ev.notes && (
                <div style={{ color:T.DIM, fontSize:12, borderTop:`1px solid ${T.BORDER}`,
                  paddingTop:8, marginTop:4, fontStyle:"italic" }}>
                  {ev.notes}
                </div>
              )}
            </div>
          ))}

          {fetched && events.length > 0 && (
            <div style={{ color:T.DIM, fontSize:11, textAlign:"center", marginTop:8 }}>
              Powered by Claude AI · Always verify event details before planning
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [themeKey,       setThemeKey]            = useState(() => lsGet("crumbs:theme", "warm"));
  const [settings,       setSettingsState]       = useState(() => lsGet("crumbs:settings", { storeName:"Crumbs" }));
  const [standingOrders, setStandingOrdersState] = useState(() => lsGet("crumbs:standingOrders", {}));
  const [ordersHistory,  setOrdersHistoryState]  = useState(() => lsGet("crumbs:ordersHistory", []));
  const [weekData,       setWeekData]            = useState([]);
  const [weekLabel,      setWeekLabel]           = useState(null);
  const [activeNav,      setActiveNav]           = useState("dashboard");
  const [vendorFilter,   setVendorFilter]        = useState("all");
  const [showSettings,   setShowSettings]        = useState(false);
  const [showVendors,    setShowVendors]         = useState(false);
  const [syncStatus,     setSyncStatus]          = useState(null);
  const [syncing,        setSyncing]             = useState(false);
  const [proxyUp,        setProxyUp]             = useState(null);
  const [showReport,     setShowReport]          = useState(false);
  const [showEvents,     setShowEvents]          = useState(false);
  const [odekoData,      setOdekoData]           = useState([]);

  const T       = THEMES[themeKey] || THEMES.warm;
  const vendors = [...new Set(Object.values(standingOrders).map(v=>v.vendor))].filter(Boolean);

  const pullFromSquare = useCallback(async (orders) => {
    setSyncing(true);
    setSyncStatus({ type:"info", msg:"Pulling last week's transactions from Square…" });
    try {
      const monday    = getLastCompletedMonday();
      const label     = formatWeekLabel(monday);
      const rawOrders  = await squareFetchOrders(monday);
      const txByDate   = flattenOrders(rawOrders);
      // Use history-aware order selection if history exists
      const history    = lsGet("crumbs:ordersHistory", []);
      const activeOrds = history.length > 0 ? getActiveOrders(history, monday) : orders;
      const result     = analyzeWeek(activeOrds, txByDate, monday, history);
      setWeekData(result);
      setWeekLabel(label);

      // Extract Odeko sales — match by item base name "Dis Burrito"
      try {
        const odekoResult = [];
        rawOrders.forEach(order => {
          const createdAt = order.created_at; if (!createdAt) return;
          const date = createdAt.split("T")[0];
          (order.line_items || []).forEach(li => {
            const baseName = (li.name || "").trim();
            if (baseName.toLowerCase() !== ODEKO_CATEGORY.toLowerCase()) return;
            const varName  = li.variation_name?.trim();
            const genericV = new Set(["regular","standard","default","n/a",""]);
            const label    = varName && !genericV.has(varName.toLowerCase()) ? varName : baseName;
            const existing = odekoResult.find(o => o.item === label);
            if (existing) {
              existing.byDate[date] = (existing.byDate[date] || 0) + parseFloat(li.quantity || 1);
              existing.total += parseFloat(li.quantity || 1);
            } else {
              odekoResult.push({ item: label, byDate: { [date]: parseFloat(li.quantity || 1) }, total: parseFloat(li.quantity || 1) });
            }
          });
        });
        setOdekoData(odekoResult.sort((a,b) => b.total - a.total));
      } catch(odekoErr) {
        console.error("Odeko fetch error:", odekoErr.message);
      }

      setSyncStatus({ type:"success", msg:`✓ ${rawOrders.length} orders synced for ${label}` });
    } catch(err) {
      setSyncStatus({ type:"error", msg:`Error: ${err.message}` });
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    checkProxy().then(up => {
      setProxyUp(up);
      if (!up) { setSyncStatus({ type:"warn", msg:"Proxy not reachable. Make sure server.js is running." }); return; }
      if (Object.keys(standingOrders).length===0) { setSyncStatus({ type:"warn", msg:"Upload vendor standing orders to define daily item targets." }); return; }
      pullFromSquare(standingOrders);
    });
  }, []);

  const handleSaveSettings = s => { setSettingsState(s); lsSet("crumbs:settings", s); };
  const handleSaveOrders = (o, effectiveDate) => {
    // Always update current standing orders (used as fallback)
    setStandingOrdersState(o); lsSet("crumbs:standingOrders", o);
    // Add to history
    const newEntry  = { effectiveDate, orders: o, savedAt: new Date().toISOString() };
    const existing  = lsGet("crumbs:ordersHistory", []);
    // Replace if same effective date, otherwise append
    const updated   = existing.filter(e => e.effectiveDate !== effectiveDate).concat(newEntry)
                        .sort((a,b) => a.effectiveDate.localeCompare(b.effectiveDate));
    setOrdersHistoryState(updated);
    lsSet("crumbs:ordersHistory", updated);
    if (proxyUp) pullFromSquare(o);
  };
  const handleThemeChange = k => { setThemeKey(k); lsSet("crumbs:theme", k); };

  const hasData   = weekData.length > 0;
  const hasOrders = Object.keys(standingOrders).length > 0;

  const SC = {
    info:    { bg: themeKey==="parchment"?"#f5f0d0":"#1a1400", bo:"#a08030", co:T.GOLD },
    warn:    { bg: themeKey==="parchment"?"#fff4e0":"#1a1200", bo:"#c08040", co: themeKey==="parchment"?"#8a5010":"#e8a050" },
    error:   { bg: themeKey==="parchment"?"#fff0f0":"#2a1008", bo:"#c06060", co:T.RED },
    success: { bg: themeKey==="parchment"?"#f0fff0":"#0e1f0e", bo:"#50a050", co:T.GREEN },
  };

  return (
    <div style={{ display:"flex", minHeight:"100vh", background:T.BG, color:T.TEXT, fontFamily:"'Lato', sans-serif" }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}} * { box-sizing: border-box; }`}</style>

      {/* Sidebar */}
      <aside style={{ width:224, background:T.SIDEBAR, borderRight:`1px solid ${T.BORDER}`, display:"flex", flexDirection:"column", flexShrink:0 }}>
        <div style={{ padding:"26px 22px 20px", borderBottom:`1px solid ${T.BORDER}` }}>
          <div style={{ fontFamily:"'Playfair Display', serif", fontSize:22, fontWeight:700, color:T.TEXT }}>🥐 Crumbs</div>
          <div style={{ color:T.DIM, fontSize:11, letterSpacing:2, textTransform:"uppercase", marginTop:4 }}>{settings.storeName}</div>
        </div>

        {/* POS badge */}
        <div style={{ padding:"12px 16px", borderBottom:`1px solid ${T.BORDER}` }}>
          <div style={{ display:"flex", alignItems:"center", gap:7, padding:"6px 12px", borderRadius:20,
            background:proxyUp?`${T.GREEN}18`:T.CARD, border:`1px solid ${proxyUp?T.GREEN:T.BORDER}`,
            fontSize:11, color:proxyUp?T.GREEN:T.DIM }}>
            <div style={{ width:6, height:6, borderRadius:"50%",
              background:proxyUp===null?T.DIM:proxyUp?T.GREEN:T.BORDER,
              boxShadow:proxyUp?`0 0 5px ${T.GREEN}`:"none",
              animation:syncing?"pulse 1s infinite":"none" }} />
            {proxyUp===null?"Checking…":syncing?"Syncing…":proxyUp?"Connected to POS":"POS Not Connected"}
          </div>
        </div>

        {weekLabel && (
          <div style={{ padding:"10px 16px", borderBottom:`1px solid ${T.BORDER}` }}>
            <div style={{ color:T.DIM, fontSize:10, letterSpacing:1.5, textTransform:"uppercase", marginBottom:3 }}>Active Week</div>
            <div style={{ color:T.GOLD, fontSize:11, lineHeight:1.5 }}>{weekLabel}</div>
          </div>
        )}

        {/* Vendor filter */}
        {vendors.length>0 && (
          <div style={{ padding:"12px 16px", borderBottom:`1px solid ${T.BORDER}` }}>
            <div style={{ color:T.DIM, fontSize:10, letterSpacing:1.5, textTransform:"uppercase", marginBottom:8 }}>Filter by Vendor</div>
            {["all",...vendors].map((v,vi) => (
              <div key={v} onClick={()=>setVendorFilter(v)}
                style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px", borderRadius:8, cursor:"pointer", marginBottom:3,
                  background:vendorFilter===v?T.BORDER:"transparent", transition:"background 0.15s" }}>
                <div style={{ width:6, height:6, borderRadius:"50%", background:v==="all"?T.DIM:VENDOR_COLORS[(vi-1)%VENDOR_COLORS.length] }} />
                <span style={{ fontSize:12, color:vendorFilter===v?T.GOLD:T.DIM }}>{v==="all"?"All Vendors":v}</span>
              </div>
            ))}
          </div>
        )}

        <nav style={{ flex:1, padding:"12px 10px" }}>
          {NAV.map(({ id, label, icon }) => (
            <div key={id} onClick={()=>setActiveNav(id)}
              style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 14px", borderRadius:8, cursor:"pointer", marginBottom:4,
                background:activeNav===id?T.BORDER:"transparent",
                color:activeNav===id?T.GOLD:T.DIM, fontSize:14, fontWeight:activeNav===id?600:400,
                borderLeft:activeNav===id?`2px solid ${T.ACCENT}`:"2px solid transparent", transition:"all 0.15s" }}>
              <span>{icon}</span>{label}
            </div>
          ))}
        </nav>

        <div style={{ padding:"12px 10px", borderTop:`1px solid ${T.BORDER}`, display:"flex", flexDirection:"column", gap:2 }}>
          <div onClick={()=>setShowVendors(true)}
            style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:8, cursor:"pointer", color:T.DIM, fontSize:13 }}>
            <span>📦</span> Vendor Orders
            {!hasOrders && <span style={{ fontSize:10, background:T.RED, color:"#fff", borderRadius:10, padding:"1px 6px", marginLeft:"auto" }}>!</span>}
          </div>
          <div onClick={()=>setShowSettings(true)}
            style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:8, cursor:"pointer", color:T.DIM, fontSize:13 }}>
            <span>⚙</span> Settings
          </div>
          {proxyUp && hasOrders && (
            <div onClick={()=>!syncing&&pullFromSquare(standingOrders)}
              style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:8, cursor:syncing?"default":"pointer", color:syncing?T.DIM:T.GOLD, fontSize:13 }}>
              <span style={{ animation:syncing?"pulse 1s infinite":"none" }}>↻</span> {syncing?"Syncing…":"Refresh"}
            </div>
          )}
          <div onClick={()=>setShowEvents(true)}
            style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:8, cursor:"pointer", color:T.DIM, fontSize:13 }}>
            <span>🗓</span> Upcoming Events
          </div>
          {hasData && (
            <div onClick={()=>setShowReport(true)}
              style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:8, cursor:"pointer", color:T.DIM, fontSize:13 }}>
              <span>📄</span> Weekly Report
            </div>
          )}
          {/* Theme switcher */}
          <div style={{ borderTop:`1px solid ${T.BORDER}`, marginTop:4, paddingTop:4 }}>
            <div style={{ color:T.DIM, fontSize:10, letterSpacing:1.5, textTransform:"uppercase", padding:"6px 14px" }}>Theme</div>
            <ThemeSwitcher current={themeKey} onChange={handleThemeChange} T={T} />
          </div>
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div style={{ borderBottom:`1px solid ${T.BORDER}`, padding:"0 36px", height:60,
          display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0, background:T.CARD }}>
          <div style={{ fontFamily:"'Playfair Display', serif", fontSize:18, fontWeight:700, color:T.TEXT }}>
            {NAV.find(n=>n.id===activeNav)?.label}
          </div>
          {weekLabel && <div style={{ color:T.DIM, fontSize:12 }}>{weekLabel}</div>}
        </div>

        <div style={{ flex:1, overflow:"auto", padding:36 }}>
          {syncStatus && syncStatus.type !== "success" && (
            <div style={{ marginBottom:24, padding:"11px 18px", borderRadius:10, fontSize:13,
              background:SC[syncStatus.type]?.bg, border:`1px solid ${SC[syncStatus.type]?.bo}`, color:SC[syncStatus.type]?.co }}>
              {syncStatus.msg}
            </div>
          )}

          {activeNav==="dashboard" && (
            hasData
              ? <DashboardView weekData={weekData} weekLabel={weekLabel} vendorFilter={vendorFilter} vendors={vendors} monday={getLastCompletedMonday()} T={T} />
              : <div style={{ textAlign:"center", padding:"80px 0", color:T.DIM }}>
                  <div style={{ fontFamily:"'Playfair Display', serif", fontSize:38, marginBottom:14, color:T.BORDER }}>
                    {!proxyUp?"Start the proxy server":!hasOrders?"Upload vendor orders to begin":"Pulling data…"}
                  </div>
                  <div style={{ fontSize:14, color:T.DIM, marginBottom:24 }}>
                    {!proxyUp?"Run node server.js in your terminal":!hasOrders?"Click Vendor Orders in the sidebar":"This should only take a moment"}
                  </div>
                  {proxyUp && !hasOrders &&
                    <button onClick={()=>setShowVendors(true)}
                      style={{ padding:"11px 28px", background:T.ACCENT, border:"none", borderRadius:8, color:T.BG, cursor:"pointer", fontSize:14, fontWeight:700 }}>
                      Upload Vendor Orders
                    </button>}
                </div>
          )}

          {activeNav==="items" && (
            hasData
              ? <ItemsView weekData={weekData} vendorFilter={vendorFilter} vendors={vendors} T={T} />
              : <div style={{ textAlign:"center", padding:"80px 0" }}>
                  <div style={{ fontFamily:"'Playfair Display', serif", fontSize:38, color:T.BORDER }}>No data yet</div>
                </div>
          )}

          {activeNav==="odeko" && (
            weekLabel
              ? <OdekoView odekoData={odekoData} weekLabel={weekLabel} monday={getLastCompletedMonday()} T={T} />
              : <div style={{ textAlign:"center", padding:"80px 0" }}>
                  <div style={{ fontFamily:"'Playfair Display', serif", fontSize:38, color:T.BORDER }}>No data yet</div>
                </div>
          )}
        </div>
      </div>

      {showSettings && <SettingsModal settings={settings} onSave={handleSaveSettings} onClose={()=>setShowSettings(false)} T={T} />}
      {showVendors  && <VendorUploadModal existingOrders={standingOrders} onSave={handleSaveOrders} onClose={()=>setShowVendors(false)} T={T} ordersHistory={ordersHistory} />}
      {showEvents   && <EventsModal onClose={()=>setShowEvents(false)} T={T} />}
      {showReport   && <ReportModal weekData={weekData} weekLabel={weekLabel} storeName={settings.storeName} vendors={vendors} odekoData={odekoData} onClose={()=>setShowReport(false)} />}
    </div>
  );
}
