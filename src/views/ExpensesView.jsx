import { useState, useEffect, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { api } from "../lib/api.js";
import { fmtMoney, laDateStr, addDaysStr } from "../lib/dates.js";
import { StatCard, CTooltip, Pill } from "../components/ui.jsx";

const PERIODS = [
  { key: "7",  label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
];

const DENOM_LABELS = { transaction: "per customer", drink: "per drink", matching_item: "per item sold" };

function confidenceMark(confidence, T) {
  if (confidence === "good") return null;
  if (confidence === "low") return <span title="Only 2 purchases in window — treat with caution" style={{ color:T.GOLD, marginLeft:6 }}>⚠</span>;
  return null;
}

export default function ExpensesView({ onOpenInvoices, T }) {
  const [periodDays, setPeriodDays] = useState("30");
  const [summary, setSummary] = useState(null);
  const [consumables, setConsumables] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [recomputing, setRecomputing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const to = laDateStr();
      const from = addDaysStr(to, -(Number(periodDays) - 1));
      const [s, c, a] = await Promise.all([
        api.get(`/api/expenses/summary?from=${from}&to=${to}`),
        api.get("/api/consumables"),
        api.get("/api/price-alerts?acknowledged=0"),
      ]);
      setSummary(s);
      setConsumables((c.consumables || []).filter(x => x.active));
      setAlerts(a.alerts || []);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [periodDays]);

  useEffect(() => { load(); }, [load]);

  const recompute = async () => {
    setRecomputing(true);
    try { await api.post("/api/consumables/recompute", {}); await load(); }
    catch (err) { setError(err.message); }
    finally { setRecomputing(false); }
  };

  const ackAlert = async (id) => {
    try { await api.patch(`/api/price-alerts/${id}/acknowledge`, {}); setAlerts(al => al.filter(a => a.id !== id)); }
    catch (err) { setError(err.message); }
  };

  if (loading && !summary) return <div style={{ padding:"60px 0", textAlign:"center", color:T.DIM }}>Loading expenses…</div>;
  if (error && !summary) return <div style={{ padding:"20px", color:T.RED }}>Error: {error}</div>;

  // Combined cost per customer — transaction-denominated consumables with a
  // usable rate; other denominators are shown per-row instead
  const perCustomer = consumables
    .filter(c => c.denominator === "transaction" && c.baseline && c.baseline.confidence !== "insufficient")
    .reduce((a, c) => a + (c.baseline.cost_per_denominator || 0), 0);

  // Variance callouts — rule-based items with meaningful variance and enough history
  const varianceFlags = consumables.filter(c =>
    c.method === "rule" && c.baseline &&
    c.baseline.confidence !== "insufficient" &&
    c.baseline.variance_pct != null && Math.abs(c.baseline.variance_pct) >= 0.10
  );

  // Spend by vendor, current vs prior period
  const vendorChart = (() => {
    const names = new Set([...(summary?.by_vendor||[]).map(v=>v.vendor), ...(summary?.by_vendor_prev||[]).map(v=>v.vendor)]);
    return [...names].map(name => ({
      vendor: name,
      "This period": Math.round((summary.by_vendor.find(v=>v.vendor===name)?.total || 0) * 100) / 100,
      "Prior period": Math.round((summary.by_vendor_prev.find(v=>v.vendor===name)?.total || 0) * 100) / 100,
    })).sort((a,b) => b["This period"] - a["This period"]);
  })();

  const mkTooltip = (props) => <CTooltip {...props} T={T} />;

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", marginBottom:22, gap:12 }}>
        <div style={{ color:T.DIM, fontSize:13 }}>
          💵 <span style={{ color:T.GOLD }}>{summary.from} → {summary.to}</span> · confirmed invoices only
        </div>
        <div style={{ marginLeft:"auto", display:"flex", gap:6 }}>
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriodDays(p.key)}
              style={{ padding:"6px 14px", borderRadius:8, fontSize:12, cursor:"pointer",
                background: periodDays===p.key ? T.ACCENT : "transparent",
                color: periodDays===p.key ? T.BG : T.DIM,
                border:`1px solid ${periodDays===p.key ? T.ACCENT : T.BORDER}` }}>
              {p.label}
            </button>
          ))}
          <button onClick={recompute} disabled={recomputing}
            style={{ padding:"6px 14px", borderRadius:8, fontSize:12, cursor:"pointer",
              background:"transparent", color:T.GOLD, border:`1px solid ${T.BORDER}` }}>
            {recomputing ? "Recomputing…" : "↻ Recompute"}
          </button>
        </div>
      </div>

      {error && <div style={{ marginBottom:16, color:T.RED, fontSize:13 }}>{error}</div>}

      {/* Stat cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:16, marginBottom:28 }}>
        <StatCard label="Total Spend" value={fmtMoney(summary.total_spend)} unit={`${summary.invoice_count} confirmed invoices`} T={T} />
        <StatCard label="Cost per Customer" value={perCustomer > 0 ? fmtMoney(perCustomer, 3) : "—"}
          unit="per-customer consumables combined" T={T} />
        <StatCard label="Open Price Alerts" value={summary.open_alert_count}
          color={summary.open_alert_count > 0 ? T.RED : T.TEXT}
          unit={summary.open_alert_count > 0 ? "needs review below" : "all clear"} T={T} />
        <StatCard label="Pending Invoices" value={summary.pending_review_count}
          color={summary.pending_review_count > 0 ? T.GOLD : T.TEXT}
          unit={summary.pending_review_count > 0 ? "click to review" : "inbox clear"}
          onClick={summary.pending_review_count > 0 ? onOpenInvoices : undefined} T={T} />
      </div>

      {/* Variance callouts — the headline output */}
      {varianceFlags.length > 0 && (
        <div style={{ background:T.CARD, border:`1px solid ${T.RED}55`, borderRadius:12, padding:24, marginBottom:20 }}>
          <div style={{ color:T.RED, fontSize:11, letterSpacing:2, textTransform:"uppercase", marginBottom:14 }}>⚠ Usage Variance</div>
          {varianceFlags.map(c => {
            const b = c.baseline;
            const over = b.variance_units > 0;
            return (
              <div key={c.id} style={{ fontSize:14, color:T.TEXT, marginBottom:10, lineHeight:1.5 }}>
                <strong>{c.name}:</strong> bought {Math.round(b.units_purchased).toLocaleString()} units,
                expected {Math.round(b.expected_units).toLocaleString()} from sales.{" "}
                <span style={{ color: over ? T.RED : T.GOLD, fontWeight:700 }}>
                  {Math.abs(Math.round(b.variance_units)).toLocaleString()} {over ? "unaccounted for" : "fewer than expected"} ({Math.round(Math.abs(b.variance_pct)*100)}%)
                </span>
                <span style={{ color:T.DIM, fontSize:12 }}> · window {b.window_start} → {b.window_end}</span>
              </div>
            );
          })}
          <div style={{ color:T.DIM, fontSize:12, marginTop:6 }}>
            Variance is waste, breakage, theft — or a wrong usage rule. Check the rule first if a number looks impossible.
          </div>
        </div>
      )}

      {/* Consumables table */}
      <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:12, overflow:"hidden", marginBottom:20 }}>
        <div style={{ padding:"16px 24px", borderBottom:`1px solid ${T.BORDER}`, display:"flex", justifyContent:"space-between" }}>
          <div style={{ color:T.DIM, fontSize:11, letterSpacing:2, textTransform:"uppercase" }}>Consumables · {consumables.length}</div>
          <div style={{ color:T.DIM, fontSize:11 }}>configure in Settings → Consumables</div>
        </div>
        {consumables.length === 0 ? (
          <div style={{ padding:40, textAlign:"center", color:T.DIM, fontSize:13 }}>
            No consumables configured yet. Add them in Settings → Consumables (e.g. 12oz Hot Cup, Sugar).
          </div>
        ) : (
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead>
              <tr>
                {["Consumable","Method","Cost","Trend","Variance","Window"].map(h => (
                  <th key={h} style={{ textAlign:h==="Consumable"||h==="Method"?"left":"right", padding:"10px 20px",
                    color:T.DIM, fontSize:10, textTransform:"uppercase", letterSpacing:1, fontWeight:400,
                    borderBottom:`1px solid ${T.BORDER}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {consumables.map((c, i) => {
                const b = c.baseline, p = c.previous_baseline;
                const insufficient = !b || b.confidence === "insufficient";
                const trend = !insufficient && p && p.cost_per_denominator > 0
                  ? ((b.cost_per_denominator - p.cost_per_denominator) / p.cost_per_denominator) * 100
                  : null;
                return (
                  <tr key={c.id} style={{ borderBottom:`1px solid ${T.BG}`, background:i%2===0?"transparent":`${T.BORDER}20` }}>
                    <td style={{ padding:"12px 20px", fontWeight:600, color:T.TEXT }}>
                      {c.name}{b && confidenceMark(b.confidence, T)}
                      <div style={{ color:T.DIM, fontSize:11, fontWeight:400 }}>{DENOM_LABELS[c.denominator]}</div>
                    </td>
                    <td style={{ padding:"12px 20px" }}>
                      <Pill color={c.method === "rule" ? T.GREEN : "#7ca8c8"} T={T}>{c.method === "rule" ? "rule" : "statistical"}</Pill>
                      {c.method === "statistical" && (
                        <div style={{ color:T.DIM, fontSize:10, marginTop:3 }} title="Rate is derived from spend, so spend always matches it — only drift over time is visible">
                          drift only — no variance check
                        </div>
                      )}
                    </td>
                    <td style={{ padding:"12px 20px", textAlign:"right", fontWeight:700,
                      color: insufficient ? T.DIM : T.TEXT }}>
                      {insufficient
                        ? <span style={{ fontWeight:400, fontSize:12 }}>not enough purchase history</span>
                        : fmtMoney(b.cost_per_denominator, 3)}
                    </td>
                    <td style={{ padding:"12px 20px", textAlign:"right",
                      color: trend == null ? T.DIM : trend > 1 ? T.RED : trend < -1 ? T.GREEN : T.DIM }}>
                      {trend == null ? "—" : `${trend > 0 ? "+" : ""}${trend.toFixed(1)}%`}
                    </td>
                    <td style={{ padding:"12px 20px", textAlign:"right",
                      color: c.method !== "rule" || insufficient || b.variance_pct == null ? T.DIM
                        : Math.abs(b.variance_pct) >= 0.10 ? T.RED : T.GREEN }}>
                      {c.method !== "rule" ? "" :
                        insufficient || b.variance_pct == null ? "—" :
                        `${b.variance_pct > 0 ? "+" : ""}${Math.round(b.variance_pct * 100)}%`}
                    </td>
                    <td style={{ padding:"12px 20px", textAlign:"right", color:T.DIM, fontSize:12 }}>
                      {c.rolling_window_days ? `${c.rolling_window_days}d${c.window_auto ? " auto" : ""}` : "—"}
                      {b && <div style={{ fontSize:10 }}>{b.purchase_events} purchase{b.purchase_events===1?"":"s"}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
        {/* Spend by vendor */}
        <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:12, padding:24 }}>
          <div style={{ color:T.DIM, fontSize:11, letterSpacing:2, textTransform:"uppercase", marginBottom:20 }}>Spend by Vendor</div>
          {vendorChart.length === 0 ? (
            <div style={{ height:220, display:"flex", alignItems:"center", justifyContent:"center", color:T.DIM, fontSize:13 }}>
              No confirmed invoices in this period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={vendorChart} barGap={3}>
                <CartesianGrid stroke={T.BORDER} strokeDasharray="4 4" vertical={false} />
                <XAxis dataKey="vendor" stroke={T.DIM} tick={{ fill:T.DIM, fontSize:11 }} tickLine={false} axisLine={false} />
                <YAxis stroke={T.DIM} tick={{ fill:T.DIM, fontSize:11 }} tickLine={false} axisLine={false} />
                <Tooltip content={mkTooltip} cursor={{ fill:`${T.BORDER}80` }} />
                <Legend wrapperStyle={{ fontSize:11 }} />
                <Bar dataKey="Prior period" fill={T.CHART_ORDERED} radius={[3,3,0,0]} />
                <Bar dataKey="This period"  fill={T.CHART_SOLD}    radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Open price alerts */}
        <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:12, padding:24 }}>
          <div style={{ color:T.DIM, fontSize:11, letterSpacing:2, textTransform:"uppercase", marginBottom:20 }}>Open Price Alerts</div>
          {alerts.length === 0 ? (
            <div style={{ height:220, display:"flex", alignItems:"center", justifyContent:"center", color:T.DIM, fontSize:13 }}>
              No unacknowledged alerts
            </div>
          ) : (
            <div style={{ maxHeight:220, overflow:"auto" }}>
              {alerts.map(a => (
                <div key={a.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0",
                  borderBottom:`1px solid ${T.BG}` }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:600, color:T.TEXT }}>{a.sku_key}</div>
                    <div style={{ fontSize:11, color:T.DIM }}>
                      {a.vendor_name} · {a.old_date} → {a.new_date}
                      {a.kind === "unit_change" && ` · unit changed: ${a.old_unit || "?"} → ${a.new_unit || "?"}`}
                    </div>
                  </div>
                  {a.kind === "unit_change" ? (
                    <Pill color={T.GOLD} T={T}>unit change</Pill>
                  ) : (
                    <span style={{ fontWeight:700, color: a.pct_change > 0 ? T.RED : T.GREEN, fontSize:13 }}>
                      {fmtMoney(a.old_price)} → {fmtMoney(a.new_price)} ({a.pct_change > 0 ? "+" : ""}{a.pct_change.toFixed(1)}%)
                    </span>
                  )}
                  <button onClick={() => ackAlert(a.id)}
                    style={{ padding:"4px 10px", background:"transparent", border:`1px solid ${T.BORDER}`,
                      borderRadius:6, color:T.DIM, cursor:"pointer", fontSize:11 }}>
                    Dismiss
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
