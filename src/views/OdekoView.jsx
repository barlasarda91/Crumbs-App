import { DAY_NAMES, addDaysStr } from "../lib/dates.js";
import { StatCard } from "../components/ui.jsx";

export default function OdekoView({ odekoData, weekLabel, monday, T }) {
  const totalSold = odekoData.reduce((a,s) => a+s.total, 0);

  return (
    <div>
      <div style={{ marginBottom:22, color:T.DIM, fontSize:13 }}>
        📅 <span style={{ color:T.GOLD }}>{weekLabel}</span> · Dis Burrito (Odeko) — sales by variation
      </div>

      {/* Stat cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, marginBottom:28 }}>
        <StatCard label="Unique Items" value={odekoData.length} unit="sold this week" T={T} />
        <StatCard label="Total Units" value={totalSold} unit="across all items" T={T} />
        <StatCard label="Avg per Item" value={odekoData.length>0?Math.round(totalSold/odekoData.length):"—"} unit="units/item" T={T} />
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
                    const date = addDaysStr(monday, di);
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
