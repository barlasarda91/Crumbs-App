import { useState, useEffect } from "react";
import { DAY_NAMES, minsToLabel } from "../lib/dates.js";
import { MiniBar, VendorBadge, effColor } from "../components/ui.jsx";

export default function ItemsView({ weekData, vendorFilter, vendors, T }) {
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
