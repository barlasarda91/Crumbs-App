import { useState, useEffect, useCallback } from "react";
import { THEMES } from "./themes.js";
import { getLastCompletedMonday, formatWeekLabel } from "./lib/dates.js";
import { api, checkProxy } from "./lib/api.js";
import { squareFetchOrders, flattenOrders, extractOdeko } from "./lib/square.js";
import { analyzeWeek, getActiveOrders } from "./lib/orders.js";
import { ThemeSwitcher, VENDOR_COLORS } from "./components/ui.jsx";
import DashboardView from "./views/DashboardView.jsx";
import ItemsView from "./views/ItemsView.jsx";
import OdekoView from "./views/OdekoView.jsx";
import ExpensesView from "./views/ExpensesView.jsx";
import InvoicesView from "./views/InvoicesView.jsx";
import VendorUploadModal from "./modals/VendorUploadModal.jsx";
import SettingsModal from "./modals/SettingsModal.jsx";
import EventsModal from "./modals/EventsModal.jsx";
import ReportModal from "./modals/ReportModal.jsx";

// ─── Local storage — UI preferences only ──────────────────────────────────────
// Standing orders and all business data live server-side in SQLite.
function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

const NAV = [
  { id:"dashboard", label:"Dashboard",   icon:"▦" },
  { id:"items",     label:"Item Detail", icon:"≡" },
  { id:"odeko",     label:"Odeko",       icon:"🛒" },
  { id:"expenses",  label:"Expenses",    icon:"💵" },
  { id:"invoices",  label:"Invoices",    icon:"📄" },
];

const ODEKO_CATEGORY = "Dis Burrito";

export default function App() {
  const [themeKey,       setThemeKey]            = useState(() => lsGet("crumbs:theme", "warm"));
  const [settings,       setSettingsState]       = useState(() => lsGet("crumbs:settings", { storeName:"Crumbs" }));
  const [standingOrders, setStandingOrdersState] = useState({});
  const [ordersHistory,  setOrdersHistoryState]  = useState([]);
  const [ordersLoaded,   setOrdersLoaded]        = useState(false);
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
  const [pendingInvoices, setPendingInvoices]    = useState(0);

  const T       = THEMES[themeKey] || THEMES.warm;
  const monday  = getLastCompletedMonday();
  const vendors = [...new Set(Object.values(standingOrders).map(v=>v.vendor))].filter(Boolean);

  // Standing orders now live server-side
  const loadStandingOrders = useCallback(async () => {
    const data = await api.get("/api/standing-orders/history");
    const history = (data.versions || []).map(v => ({ effectiveDate: v.effectiveDate, orders: v.orders }));
    setOrdersHistoryState(history);
    const active = getActiveOrders(history, monday) || {};
    // Fall back to newest version so vendors/items render even before it takes effect
    const current = Object.keys(active).length ? active : (history[0]?.orders || {});
    setStandingOrdersState(current);
    setOrdersLoaded(true);
    return { history, current };
  }, [monday]);

  const refreshPendingCount = useCallback(async () => {
    try {
      const data = await api.get("/api/invoices?status=pending_review");
      setPendingInvoices((data.invoices || []).length);
    } catch {}
  }, []);

  const pullFromSquare = useCallback(async (orders, history) => {
    setSyncing(true);
    setSyncStatus({ type:"info", msg:"Pulling last week's transactions from Square…" });
    try {
      const label      = formatWeekLabel(monday);
      const rawOrders  = await squareFetchOrders(monday);
      const txByDate   = flattenOrders(rawOrders);
      const activeOrds = history.length > 0 ? getActiveOrders(history, monday) : orders;
      const result     = analyzeWeek(activeOrds, txByDate, monday, history);
      setWeekData(result);
      setWeekLabel(label);

      try {
        setOdekoData(extractOdeko(rawOrders, ODEKO_CATEGORY));
      } catch(odekoErr) {
        console.error("Odeko fetch error:", odekoErr.message);
      }

      setSyncStatus({ type:"success", msg:`✓ ${rawOrders.length} orders synced for ${label}` });
    } catch(err) {
      setSyncStatus({ type:"error", msg:`Error: ${err.message}` });
    } finally {
      setSyncing(false);
    }
  }, [monday]);

  useEffect(() => {
    (async () => {
      const up = await checkProxy();
      setProxyUp(up);
      if (!up) { setSyncStatus({ type:"warn", msg:"Proxy not reachable. Make sure server.js is running." }); return; }
      refreshPendingCount();
      let loaded;
      try {
        loaded = await loadStandingOrders();
      } catch (err) {
        setSyncStatus({ type:"error", msg:`Could not load standing orders: ${err.message}` });
        return;
      }
      if (Object.keys(loaded.current).length === 0) {
        setSyncStatus({ type:"warn", msg:"Upload vendor standing orders to define daily item targets." });
        return;
      }
      pullFromSquare(loaded.current, loaded.history);
    })();
  }, []);

  const handleSaveSettings = s => { setSettingsState(s); lsSet("crumbs:settings", s); };

  const handleSaveOrders = async (orders, effectiveDate) => {
    await api.post("/api/standing-orders", { effective_date: effectiveDate, orders });
    const loaded = await loadStandingOrders();
    if (proxyUp) pullFromSquare(loaded.current, loaded.history);
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
            <div key={id} onClick={()=>{ setActiveNav(id); if (id === "invoices" || id === "expenses") refreshPendingCount(); }}
              style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 14px", borderRadius:8, cursor:"pointer", marginBottom:4,
                background:activeNav===id?T.BORDER:"transparent",
                color:activeNav===id?T.GOLD:T.DIM, fontSize:14, fontWeight:activeNav===id?600:400,
                borderLeft:activeNav===id?`2px solid ${T.ACCENT}`:"2px solid transparent", transition:"all 0.15s" }}>
              <span>{icon}</span>{label}
              {id==="invoices" && pendingInvoices > 0 && (
                <span style={{ marginLeft:"auto", fontSize:10, background:T.RED, color:"#fff", borderRadius:10, padding:"1px 6px" }}>
                  {pendingInvoices}
                </span>
              )}
            </div>
          ))}
        </nav>

        <div style={{ padding:"12px 10px", borderTop:`1px solid ${T.BORDER}`, display:"flex", flexDirection:"column", gap:2 }}>
          <div onClick={()=>setShowVendors(true)}
            style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:8, cursor:"pointer", color:T.DIM, fontSize:13 }}>
            <span>📦</span> Vendor Orders
            {ordersLoaded && !hasOrders && <span style={{ fontSize:10, background:T.RED, color:"#fff", borderRadius:10, padding:"1px 6px", marginLeft:"auto" }}>!</span>}
          </div>
          <div onClick={()=>setShowSettings(true)}
            style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:8, cursor:"pointer", color:T.DIM, fontSize:13 }}>
            <span>⚙</span> Settings
          </div>
          {proxyUp && hasOrders && (
            <div onClick={()=>!syncing&&pullFromSquare(standingOrders, ordersHistory)}
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
          {syncStatus && syncStatus.type !== "success" && activeNav !== "expenses" && activeNav !== "invoices" && (
            <div style={{ marginBottom:24, padding:"11px 18px", borderRadius:10, fontSize:13,
              background:SC[syncStatus.type]?.bg, border:`1px solid ${SC[syncStatus.type]?.bo}`, color:SC[syncStatus.type]?.co }}>
              {syncStatus.msg}
            </div>
          )}

          {activeNav==="dashboard" && (
            hasData
              ? <DashboardView weekData={weekData} weekLabel={weekLabel} vendorFilter={vendorFilter} vendors={vendors} monday={monday} T={T} />
              : <div style={{ textAlign:"center", padding:"80px 0", color:T.DIM }}>
                  <div style={{ fontFamily:"'Playfair Display', serif", fontSize:38, marginBottom:14, color:T.BORDER }}>
                    {!proxyUp?"Start the proxy server":!hasOrders?"Upload vendor orders to begin":"Pulling data…"}
                  </div>
                  <div style={{ fontSize:14, color:T.DIM, marginBottom:24 }}>
                    {!proxyUp?"Run node server.js in your terminal":!hasOrders?"Click Vendor Orders in the sidebar":"This should only take a moment"}
                  </div>
                  {proxyUp && ordersLoaded && !hasOrders &&
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
              ? <OdekoView odekoData={odekoData} weekLabel={weekLabel} monday={monday} T={T} />
              : <div style={{ textAlign:"center", padding:"80px 0" }}>
                  <div style={{ fontFamily:"'Playfair Display', serif", fontSize:38, color:T.BORDER }}>No data yet</div>
                </div>
          )}

          {activeNav==="expenses" && (
            proxyUp
              ? <ExpensesView onOpenInvoices={() => setActiveNav("invoices")} T={T} />
              : <div style={{ textAlign:"center", padding:"80px 0" }}>
                  <div style={{ fontFamily:"'Playfair Display', serif", fontSize:38, color:T.BORDER }}>Server not reachable</div>
                </div>
          )}

          {activeNav==="invoices" && (
            proxyUp
              ? <InvoicesView T={T} />
              : <div style={{ textAlign:"center", padding:"80px 0" }}>
                  <div style={{ fontFamily:"'Playfair Display', serif", fontSize:38, color:T.BORDER }}>Server not reachable</div>
                </div>
          )}
        </div>
      </div>

      {showSettings && <SettingsModal settings={settings} onSave={handleSaveSettings} onClose={()=>{ setShowSettings(false); refreshPendingCount(); }} T={T} />}
      {showVendors  && <VendorUploadModal existingOrders={standingOrders} onSave={handleSaveOrders} onClose={()=>setShowVendors(false)} T={T} ordersHistory={ordersHistory} />}
      {showEvents   && <EventsModal onClose={()=>setShowEvents(false)} T={T} />}
      {showReport   && <ReportModal weekData={weekData} weekLabel={weekLabel} storeName={settings.storeName} vendors={vendors} odekoData={odekoData} monday={monday} onClose={()=>setShowReport(false)} />}
    </div>
  );
}
