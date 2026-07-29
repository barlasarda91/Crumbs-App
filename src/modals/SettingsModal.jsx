import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api.js";
import { inputStyle, btnPrimary, btnGhost, Pill } from "../components/ui.jsx";

const TABS = ["General", "Gmail", "Vendors", "Consumables", "Alerts & Drinks"];

// ─── Gmail tab ────────────────────────────────────────────────────────────────
function GmailTab({ T }) {
  const [status, setStatus] = useState(null);
  const [syncDays, setSyncDays] = useState(14);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(() => api.get("/api/gmail/status").then(setStatus).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const runSync = async () => {
    setSyncing(true); setMessage(null);
    try {
      const r = await api.post("/api/gmail/sync", { days: Number(syncDays) });
      setMessage(r.message || "Sync complete");
      load();
    } catch (err) { setMessage(`Sync failed: ${err.message}`); }
    finally { setSyncing(false); }
  };

  const disconnect = async () => {
    await api.post("/api/gmail/disconnect");
    load();
  };

  if (!status) return <div style={{ color:T.DIM, fontSize:13 }}>Loading…</div>;

  return (
    <div>
      {!status.configured && (
        <div style={{ padding:"12px 16px", background:"#ffa50011", border:"1px solid #ffa50033", borderRadius:8,
          color:"#e8a050", fontSize:13, marginBottom:16 }}>
          Google OAuth is not configured on the server. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and
          GOOGLE_REDIRECT_URI in Railway, then redeploy.
        </div>
      )}

      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:18 }}>
        <div style={{ width:10, height:10, borderRadius:"50%", background: status.connected ? T.GREEN : T.BORDER,
          boxShadow: status.connected ? `0 0 6px ${T.GREEN}` : "none" }} />
        <div style={{ flex:1 }}>
          <div style={{ color:T.TEXT, fontSize:14, fontWeight:600 }}>
            {status.connected ? `Connected as ${status.account_email || "unknown account"}` : "Not connected"}
          </div>
          {status.last_sync && (
            <div style={{ color:T.DIM, fontSize:12 }}>
              Last sync: {new Date(status.last_sync).toLocaleString()} · {status.last_status}
            </div>
          )}
        </div>
        {status.connected
          ? <button onClick={disconnect} style={{ ...btnGhost(T), color:T.RED, borderColor:`${T.RED}55` }}>Disconnect</button>
          : <a href="/api/gmail/auth" style={{ ...btnPrimary(T, !status.configured), textDecoration:"none", display:"inline-block" }}>Connect Gmail</a>}
      </div>

      {status.connected && (
        <div style={{ background:T.BG, border:`1px solid ${T.BORDER}`, borderRadius:10, padding:"16px 18px" }}>
          <div style={{ color:T.DIM, fontSize:11, letterSpacing:1.5, textTransform:"uppercase", marginBottom:10 }}>Manual Sync</div>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <label style={{ color:T.DIM, fontSize:13 }}>Look back
              <select value={syncDays} onChange={e => setSyncDays(e.target.value)}
                style={{ ...inputStyle(T), marginLeft:8 }}>
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days (backfill)</option>
              </select>
            </label>
            <button onClick={runSync} disabled={syncing} style={btnPrimary(T, syncing)}>
              {syncing ? "Syncing…" : "Sync Now"}
            </button>
          </div>
          {message && <div style={{ color:T.GOLD, fontSize:12, marginTop:10 }}>{message}</div>}
          <div style={{ color:T.DIM, fontSize:11, marginTop:10 }}>
            Emails matching vendor patterns with PDF attachments are staged as pending invoices — nothing is confirmed automatically.
            The Monday 6am job does this with a 14-day window.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Vendors tab ──────────────────────────────────────────────────────────────
function VendorsTab({ T }) {
  const [vendors, setVendors] = useState([]);
  const [draft, setDraft] = useState({ name:"", kind:"supply", email_pattern:"" });
  const [error, setError] = useState(null);

  const load = useCallback(() => api.get("/api/vendors").then(d => setVendors(d.vendors)).catch(e => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const patch = async (id, fields) => {
    try { await api.patch(`/api/vendors/${id}`, fields); load(); }
    catch (err) { setError(err.message); }
  };

  const add = async () => {
    if (!draft.name.trim()) return;
    try {
      await api.post("/api/vendors", { ...draft, email_pattern: draft.email_pattern || null });
      setDraft({ name:"", kind:"supply", email_pattern:"" });
      load();
    } catch (err) { setError(err.message); }
  };

  return (
    <div>
      {error && <div style={{ color:T.RED, fontSize:12, marginBottom:10 }}>{error}</div>}
      <div style={{ color:T.DIM, fontSize:12, marginBottom:14 }}>
        The <strong style={{ color:T.GOLD }}>email pattern</strong> is matched against the From address of incoming
        invoices (e.g. <code style={{ background:T.BORDER, padding:"1px 5px", borderRadius:4 }}>@shorelinesupply.com</code>).
        Copy it from a real invoice email — Gmail sync only searches vendors that have one.
      </div>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, marginBottom:16 }}>
        <thead>
          <tr>
            {["Vendor","Kind","Email pattern","Active"].map(h => (
              <th key={h} style={{ textAlign:"left", padding:"8px 8px", color:T.DIM, fontSize:10,
                textTransform:"uppercase", letterSpacing:1, fontWeight:400, borderBottom:`1px solid ${T.BORDER}` }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {vendors.map(v => (
            <tr key={v.id} style={{ borderBottom:`1px solid ${T.BG}`, opacity: v.active ? 1 : 0.5 }}>
              <td style={{ padding:"8px 8px", fontWeight:600, color:T.TEXT }}>{v.name}</td>
              <td style={{ padding:"8px 8px" }}>
                <Pill color={v.kind === "supply" ? "#7ca8c8" : T.GOLD} T={T}>{v.kind}</Pill>
              </td>
              <td style={{ padding:"8px 8px" }}>
                <input defaultValue={v.email_pattern || ""} placeholder="not set"
                  onBlur={e => e.target.value !== (v.email_pattern || "") && patch(v.id, { email_pattern: e.target.value || null })}
                  style={{ ...inputStyle(T), width:"100%", fontSize:12 }} />
              </td>
              <td style={{ padding:"8px 8px" }}>
                <input type="checkbox" checked={!!v.active} onChange={e => patch(v.id, { active: e.target.checked ? 1 : 0 })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display:"flex", gap:8 }}>
        <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
          placeholder="New vendor name" style={{ ...inputStyle(T), flex:1 }} />
        <select value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value }))} style={inputStyle(T)}>
          <option value="supply">supply</option>
          <option value="pastry">pastry</option>
        </select>
        <input value={draft.email_pattern} onChange={e => setDraft(d => ({ ...d, email_pattern: e.target.value }))}
          placeholder="email pattern (optional)" style={{ ...inputStyle(T), flex:1 }} />
        <button onClick={add} style={btnPrimary(T, !draft.name.trim())}>Add</button>
      </div>
    </div>
  );
}

// ─── Consumables tab ──────────────────────────────────────────────────────────
function ConsumableEditor({ consumable, vendors, onSave, onCancel, T }) {
  const [c, setC] = useState(() => ({
    name: consumable?.name || "",
    method: consumable?.method || "rule",
    denominator: consumable?.denominator || "matching_item",
    rolling_window_days: consumable?.rolling_window_days || "",
    window_auto: consumable ? consumable.window_auto : 1,
    patterns: consumable?.patterns?.map(p => ({ ...p })) || [],
    rules: consumable?.rules?.map(r => ({ ...r })) || [],
  }));
  const set = (k, v) => setC(prev => ({ ...prev, [k]: v }));

  const setPattern = (i, k, v) => set("patterns", c.patterns.map((p, idx) => idx === i ? { ...p, [k]: v } : p));
  const setRule = (i, k, v) => set("rules", c.rules.map((r, idx) => idx === i ? { ...r, [k]: v } : r));

  return (
    <div style={{ background:T.BG, border:`1px solid ${T.BORDER}`, borderRadius:10, padding:18, marginBottom:14 }}>
      <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr", gap:10, marginBottom:12 }}>
        <label style={{ fontSize:11, color:T.DIM }}>Name
          <input value={c.name} onChange={e => set("name", e.target.value)} placeholder="12oz Hot Cup"
            style={{ ...inputStyle(T), width:"100%", marginTop:4 }} />
        </label>
        <label style={{ fontSize:11, color:T.DIM }}>Method
          <select value={c.method} onChange={e => set("method", e.target.value)} style={{ ...inputStyle(T), width:"100%", marginTop:4 }}>
            <option value="rule">rule — usage derived from sales</option>
            <option value="statistical">statistical — spend ÷ volume</option>
          </select>
        </label>
        <label style={{ fontSize:11, color:T.DIM }}>Cost shown per
          <select value={c.denominator} onChange={e => set("denominator", e.target.value)} style={{ ...inputStyle(T), width:"100%", marginTop:4 }}>
            <option value="transaction">customer (transaction)</option>
            <option value="drink">drink</option>
            <option value="matching_item">matching item sold</option>
          </select>
        </label>
      </div>

      <div style={{ display:"flex", gap:14, alignItems:"center", marginBottom:14, fontSize:12, color:T.DIM }}>
        <label style={{ display:"flex", gap:6, alignItems:"center" }}>
          <input type="checkbox" checked={!!c.window_auto} onChange={e => set("window_auto", e.target.checked ? 1 : 0)} />
          Auto window (3× median purchase gap)
        </label>
        {!c.window_auto && (
          <label>Window days
            <input type="number" min="7" max="365" value={c.rolling_window_days}
              onChange={e => set("rolling_window_days", e.target.value)}
              style={{ ...inputStyle(T), width:70, marginLeft:8 }} />
          </label>
        )}
      </div>

      {/* SKU patterns */}
      <div style={{ color:T.DIM, fontSize:11, letterSpacing:1.5, textTransform:"uppercase", marginBottom:8 }}>
        Invoice match patterns <span style={{ textTransform:"none", letterSpacing:0 }}>(substring of SKU or description)</span>
      </div>
      {c.patterns.map((p, i) => (
        <div key={i} style={{ display:"flex", gap:8, marginBottom:6 }}>
          <input value={p.pattern} onChange={e => setPattern(i, "pattern", e.target.value)}
            placeholder="12 OZ HOT CUP" style={{ ...inputStyle(T), flex:2 }} />
          <select value={p.vendor_id || ""} onChange={e => setPattern(i, "vendor_id", e.target.value ? Number(e.target.value) : null)}
            style={{ ...inputStyle(T), flex:1 }}>
            <option value="">any vendor</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <input type="number" step="any" value={p.units_per_pack_override ?? ""}
            onChange={e => setPattern(i, "units_per_pack_override", e.target.value)}
            placeholder="units/pack override" style={{ ...inputStyle(T), width:150 }} />
          <button onClick={() => set("patterns", c.patterns.filter((_, idx) => idx !== i))}
            style={{ background:"transparent", border:"none", color:T.RED, cursor:"pointer" }}>✕</button>
        </div>
      ))}
      <button onClick={() => set("patterns", [...c.patterns, { pattern:"", vendor_id:null, units_per_pack_override:"" }])}
        style={{ padding:"4px 12px", background:"transparent", border:`1px dashed ${T.BORDER}`, borderRadius:8,
          color:T.GOLD, cursor:"pointer", fontSize:12, marginBottom:14 }}>+ pattern</button>

      {/* Rules (rule method only) */}
      {c.method === "rule" && (
        <>
          <div style={{ color:T.DIM, fontSize:11, letterSpacing:1.5, textTransform:"uppercase", marginBottom:8 }}>
            Usage rules <span style={{ textTransform:"none", letterSpacing:0 }}>(which Square sales use this item, and how many each)</span>
          </div>
          {c.rules.map((r, i) => (
            <div key={i} style={{ display:"flex", gap:8, marginBottom:6 }}>
              <select value={r.match_type} onChange={e => setRule(i, "match_type", e.target.value)} style={{ ...inputStyle(T), width:130 }}>
                <option value="category">category</option>
                <option value="item_name">item name</option>
                <option value="variation">variation</option>
              </select>
              <input value={r.match_value} onChange={e => setRule(i, "match_value", e.target.value)}
                placeholder="Hot Drinks" style={{ ...inputStyle(T), flex:1 }} />
              <label style={{ fontSize:12, color:T.DIM, display:"flex", alignItems:"center", gap:6 }}>
                units each
                <input type="number" step="any" value={r.units_per_match}
                  onChange={e => setRule(i, "units_per_match", e.target.value)}
                  style={{ ...inputStyle(T), width:70 }} />
              </label>
              <button onClick={() => set("rules", c.rules.filter((_, idx) => idx !== i))}
                style={{ background:"transparent", border:"none", color:T.RED, cursor:"pointer" }}>✕</button>
            </div>
          ))}
          <button onClick={() => set("rules", [...c.rules, { match_type:"category", match_value:"", units_per_match:1 }])}
            style={{ padding:"4px 12px", background:"transparent", border:`1px dashed ${T.BORDER}`, borderRadius:8,
              color:T.GOLD, cursor:"pointer", fontSize:12, marginBottom:14 }}>+ rule</button>
          <div style={{ color:T.DIM, fontSize:11, marginBottom:12 }}>
            Example: category "Hot Drinks" × 2 units each = every hot drink sold uses 2 cups (double-cupping).
          </div>
        </>
      )}
      {c.method === "statistical" && (
        <div style={{ color:T.DIM, fontSize:11, marginBottom:12 }}>
          Statistical items can't show a variance check — the rate comes from spend itself. They show drift over time only.
        </div>
      )}

      <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
        <button onClick={onCancel} style={btnGhost(T)}>Cancel</button>
        <button onClick={() => onSave(c)} disabled={!c.name.trim()} style={btnPrimary(T, !c.name.trim())}>Save</button>
      </div>
    </div>
  );
}

function ConsumablesTab({ T }) {
  const [consumables, setConsumables] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [editing, setEditing] = useState(null);   // null | "new" | consumable object
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [c, v] = await Promise.all([api.get("/api/consumables"), api.get("/api/vendors")]);
      setConsumables(c.consumables || []);
      setVendors((v.vendors || []).filter(x => x.active));
    } catch (err) { setError(err.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (data) => {
    try {
      const body = {
        ...data,
        rolling_window_days: data.rolling_window_days ? Number(data.rolling_window_days) : null,
      };
      if (editing === "new") await api.post("/api/consumables", body);
      else await api.patch(`/api/consumables/${editing.id}`, body);
      setEditing(null);
      load();
    } catch (err) { setError(err.message); }
  };

  const deactivate = async (id) => {
    try { await api.del(`/api/consumables/${id}`); load(); }
    catch (err) { setError(err.message); }
  };

  return (
    <div>
      {error && <div style={{ color:T.RED, fontSize:12, marginBottom:10 }}>{error}</div>}

      {editing != null && (
        <ConsumableEditor consumable={editing === "new" ? null : editing} vendors={vendors}
          onSave={save} onCancel={() => setEditing(null)} T={T} />
      )}

      {editing == null && (
        <>
          {consumables.filter(c => c.active).map(c => (
            <div key={c.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 0",
              borderBottom:`1px solid ${T.BG}` }}>
              <div style={{ flex:1 }}>
                <span style={{ fontWeight:600, color:T.TEXT, fontSize:14 }}>{c.name}</span>
                <span style={{ marginLeft:10 }}>
                  <Pill color={c.method === "rule" ? T.GREEN : "#7ca8c8"} T={T}>{c.method}</Pill>
                </span>
                <div style={{ color:T.DIM, fontSize:11, marginTop:2 }}>
                  {c.patterns.length} pattern{c.patterns.length!==1?"s":""} · {c.rules.length} rule{c.rules.length!==1?"s":""}
                  · window {c.rolling_window_days || "?"}d{c.window_auto ? " (auto)" : ""}
                </div>
              </div>
              <button onClick={() => setEditing(c)} style={{ ...btnGhost(T), padding:"6px 14px", fontSize:12 }}>Edit</button>
              <button onClick={() => deactivate(c.id)} style={{ ...btnGhost(T), padding:"6px 14px", fontSize:12, color:T.RED, borderColor:`${T.RED}44` }}>Deactivate</button>
            </div>
          ))}
          <button onClick={() => setEditing("new")} style={{ ...btnPrimary(T, false), marginTop:14 }}>+ New Consumable</button>
        </>
      )}
    </div>
  );
}

// ─── Alerts & Drinks tab ──────────────────────────────────────────────────────
function AlertsTab({ T }) {
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get("/api/settings").then(d => setSettings({
      price_alert_threshold_pct: d.settings.price_alert_threshold_pct,
      drink_categories: (d.settings.drink_categories || []).join(", "),
      drink_items: (d.settings.drink_items || []).join(", "),
    })).catch(e => setError(e.message));
  }, []);

  if (!settings) return <div style={{ color:T.DIM, fontSize:13 }}>Loading…</div>;

  const save = async () => {
    try {
      await api.patch("/api/settings", {
        price_alert_threshold_pct: Number(settings.price_alert_threshold_pct) || 3,
        drink_categories: settings.drink_categories.split(",").map(s => s.trim()).filter(Boolean),
        drink_items: settings.drink_items.split(",").map(s => s.trim()).filter(Boolean),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) { setError(err.message); }
  };

  return (
    <div>
      {error && <div style={{ color:T.RED, fontSize:12, marginBottom:10 }}>{error}</div>}
      <label style={{ display:"block", marginBottom:18 }}>
        <div style={{ color:T.GOLD, fontSize:12, letterSpacing:2, marginBottom:6, textTransform:"uppercase" }}>Price alert threshold</div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <input type="number" min="0.5" max="50" step="0.5" value={settings.price_alert_threshold_pct}
            onChange={e => setSettings(s => ({ ...s, price_alert_threshold_pct: e.target.value }))}
            style={{ ...inputStyle(T), width:80 }} />
          <span style={{ color:T.DIM, fontSize:13 }}>% — smaller changes are treated as rounding / pack-size noise</span>
        </div>
      </label>

      <label style={{ display:"block", marginBottom:14 }}>
        <div style={{ color:T.GOLD, fontSize:12, letterSpacing:2, marginBottom:6, textTransform:"uppercase" }}>Drink categories</div>
        <input value={settings.drink_categories}
          onChange={e => setSettings(s => ({ ...s, drink_categories: e.target.value }))}
          placeholder="Hot Drinks, Cold Drinks"
          style={{ ...inputStyle(T), width:"100%" }} />
        <div style={{ color:T.DIM, fontSize:11, marginTop:5 }}>
          Square category names that count as a "drink", comma-separated. Used as the denominator for per-drink consumables (sugar, lids).
        </div>
      </label>

      <label style={{ display:"block", marginBottom:18 }}>
        <div style={{ color:T.GOLD, fontSize:12, letterSpacing:2, marginBottom:6, textTransform:"uppercase" }}>Drink item names (optional)</div>
        <input value={settings.drink_items}
          onChange={e => setSettings(s => ({ ...s, drink_items: e.target.value }))}
          placeholder="Latte, Cappuccino"
          style={{ ...inputStyle(T), width:"100%" }} />
        <div style={{ color:T.DIM, fontSize:11, marginTop:5 }}>
          Extra item names counted as drinks even if their category isn't listed above.
        </div>
      </label>

      <button onClick={save} style={btnPrimary(T, false)}>{saved ? "✓ Saved" : "Save"}</button>
      <div style={{ color:T.DIM, fontSize:11, marginTop:10 }}>
        Changing the drink definition applies from the next Square metrics sync.
      </div>
    </div>
  );
}

// ─── Modal shell ──────────────────────────────────────────────────────────────
export default function SettingsModal({ settings, onSave, onClose, T }) {
  const [tab, setTab] = useState("General");
  const [local, setLocal] = useState(settings);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, backdropFilter:"blur(4px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:16, width:760, maxWidth:"94vw",
        maxHeight:"88vh", display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div style={{ padding:"20px 28px 0", borderBottom:`1px solid ${T.BORDER}` }}>
          <h2 style={{ fontFamily:"'Playfair Display', serif", color:T.TEXT, marginBottom:14, fontSize:22 }}>Settings</h2>
          <div style={{ display:"flex", gap:4 }}>
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{ padding:"8px 16px", background:"transparent", border:"none", cursor:"pointer", fontSize:13,
                  color: tab===t ? T.GOLD : T.DIM, fontWeight: tab===t ? 700 : 400,
                  borderBottom: tab===t ? `2px solid ${T.ACCENT}` : "2px solid transparent" }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding:"24px 28px", overflow:"auto", flex:1 }}>
          {tab === "General" && (
            <div>
              <label style={{ display:"block", marginBottom:20 }}>
                <div style={{ color:T.GOLD, fontSize:12, letterSpacing:2, marginBottom:8, textTransform:"uppercase" }}>Store Name</div>
                <input value={local.storeName} onChange={e => setLocal({...local, storeName:e.target.value})} placeholder="My Bakery"
                  style={{ width:"100%", padding:"10px 14px", background:T.BG, border:`1px solid ${T.BORDER}`, borderRadius:8, color:T.TEXT, fontSize:14, outline:"none" }} />
              </label>
              <div style={{ background:T.BG, border:`1px solid ${T.BORDER}`, borderRadius:8, padding:"12px 16px", marginBottom:20, fontSize:12, color:T.DIM }}>
                API keys live in Railway environment variables on the server — never in the browser.
                Standing orders, invoices and expense data are stored in the server database and survive redeploys.
              </div>
              <div style={{ display:"flex", gap:12, justifyContent:"flex-end" }}>
                <button onClick={onClose} style={btnGhost(T)}>Cancel</button>
                <button onClick={() => { onSave(local); onClose(); }} style={btnPrimary(T, false)}>Save</button>
              </div>
            </div>
          )}
          {tab === "Gmail" && <GmailTab T={T} />}
          {tab === "Vendors" && <VendorsTab T={T} />}
          {tab === "Consumables" && <ConsumablesTab T={T} />}
          {tab === "Alerts & Drinks" && <AlertsTab T={T} />}
        </div>

        {tab !== "General" && (
          <div style={{ padding:"14px 28px", borderTop:`1px solid ${T.BORDER}`, display:"flex", justifyContent:"flex-end" }}>
            <button onClick={onClose} style={btnGhost(T)}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
