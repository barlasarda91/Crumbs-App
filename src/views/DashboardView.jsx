import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { DAY_NAMES, addDaysStr } from "../lib/dates.js";
import { MiniBar, CTooltip, VendorBadge, StatCard, effColor, VENDOR_COLORS } from "../components/ui.jsx";

function DayDrillModal({ dayName, dayIndex, weekData, vendorFilter, monday, onClose, T }) {
  const filtered = vendorFilter==="all" ? weekData : weekData.filter(s => s.vendor===vendorFilter);
  const date     = addDaysStr(monday, dayIndex);
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

export default function DashboardView({ weekData, weekLabel, vendorFilter, vendors, monday, T }) {
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
        <StatCard label="Items Tracked" value={filtered.length} unit={vendorFilter==="all"?"all vendors":vendorFilter} T={T} />
        <StatCard label="Total Sold" value={totalSold} unit={`of ${totalOrdered} ordered`} T={T} />
        <StatCard label="Overall Efficiency" value={overallEff!=null?`${overallEff}%`:"—"} unit="sell-through" T={T} />
        <StatCard label="Sold-Out Items" value={soldOutItems} unit="≥1 day sold out" T={T} />
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
