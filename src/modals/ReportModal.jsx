import { useState } from "react";
import { DAY_NAMES, addDaysStr, fmtMoney } from "../lib/dates.js";
import { api } from "../lib/api.js";

const DENOM_LABELS = { transaction: "per customer", drink: "per drink", matching_item: "per item sold" };

export default function ReportModal({ weekData, weekLabel, storeName, vendors, odekoData, monday, onClose }) {
  const [building, setBuilding] = useState(false);
  const totalSold    = weekData.reduce((a,s) => a+s.totalSold, 0);
  const totalOrdered = weekData.reduce((a,s) => a+s.totalOrdered, 0);
  const overallEff   = totalOrdered > 0 ? Math.round((totalSold/totalOrdered)*100) : 0;
  const soldOutItems = weekData.filter(s => s.soldOutCount > 0).length;

  const handlePrint = async () => {
    setBuilding(true);
    // Expense data for the report week — failures degrade to a report without
    // the expense sections rather than blocking the report entirely
    let expenses = null, expenseAlerts = [], consumables = [];
    try {
      const weekEnd = addDaysStr(monday, 6);
      const [s, a, c] = await Promise.all([
        api.get(`/api/expenses/summary?from=${monday}&to=${weekEnd}`),
        api.get(`/api/price-alerts?from=${monday}&to=${weekEnd}`),
        api.get("/api/consumables"),
      ]);
      expenses = s;
      expenseAlerts = a.alerts || [];
      consumables = (c.consumables || []).filter(x => x.active);
    } catch { /* expense sections omitted */ }
    setBuilding(false);

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

    // "Needs Attention" — items that sold out before 10am (180 mins after 7am open)
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

    // Odeko section
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
          ${DAY_NAMES.map((_, di) => `<td class="num">${s.byDate?.[addDaysStr(monday, di)] || 0}</td>`).join("")}
          <td class="num eff green"><strong>${s.total}</strong></td>
        </tr>
      `).join("")}
      <tr style="border-top:2px solid #e8d5b0;font-weight:700">
        <td>Total</td>
        ${DAY_NAMES.map((_, di) => `<td class="num">${odekoData.reduce((a,s)=>a+(s.byDate?.[addDaysStr(monday, di)]||0),0)}</td>`).join("")}
        <td class="num">${odekoData.reduce((a,s)=>a+s.total,0)}</td>
      </tr>
    </tbody>
  </table>
  </div>` : "";

    // Vendor summary rows
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

    // ── Expense sections (§9.5) ──────────────────────────────────────────────
    const expenseSection = expenses && (expenses.by_vendor.length > 0 || expenses.total_spend > 0) ? `
  <div class="section">
  <h2>💵 Expenses — Spend by Vendor</h2>
  <table>
    <thead><tr><th>Vendor</th><th class="num">Invoices</th><th class="num">Spend</th></tr></thead>
    <tbody>
      ${expenses.by_vendor.map(v => `
        <tr>
          <td>${v.vendor}</td>
          <td class="num">${v.invoices}</td>
          <td class="num"><strong>${fmtMoney(v.total)}</strong></td>
        </tr>
      `).join("")}
      <tr style="border-top:2px solid #e8d5b0;font-weight:700">
        <td>Total</td>
        <td class="num">${expenses.invoice_count}</td>
        <td class="num">${fmtMoney(expenses.total_spend)}</td>
      </tr>
    </tbody>
  </table>
  <p style="font-size:11px;color:#a08060;margin-top:8px">Confirmed invoices dated within this week.${expenses.pending_review_count > 0 ? ` ${expenses.pending_review_count} invoice(s) still pending review are not included.` : ""}</p>
  </div>` : "";

    const priceChangeSection = expenseAlerts.length > 0 ? `
  <div class="section">
  <h2>Price Changes Detected This Week</h2>
  <table>
    <thead><tr><th>Item</th><th>Vendor</th><th class="num">Old</th><th class="num">New</th><th class="num">Change</th></tr></thead>
    <tbody>
      ${expenseAlerts.map(a => `
        <tr>
          <td>${a.sku_key}</td>
          <td class="vendor">${a.vendor_name}</td>
          <td class="num">${a.kind === "unit_change" ? `${fmtMoney(a.old_price)}/${a.old_unit || "?"}` : fmtMoney(a.old_price)}</td>
          <td class="num">${a.kind === "unit_change" ? `${fmtMoney(a.new_price)}/${a.new_unit || "?"}` : fmtMoney(a.new_price)}</td>
          <td class="num ${a.kind === "unit_change" ? "gold" : a.pct_change > 0 ? "red" : "green"}">
            ${a.kind === "unit_change" ? "unit changed — review" : `${a.pct_change > 0 ? "+" : ""}${a.pct_change.toFixed(1)}%`}
          </td>
        </tr>
      `).join("")}
    </tbody>
  </table>
  </div>` : "";

    const usableConsumables = consumables.filter(c => c.baseline && c.baseline.confidence !== "insufficient");
    const consumableSection = usableConsumables.length > 0 ? `
  <div class="section">
  <h2>Consumable Cost per Customer</h2>
  <table>
    <thead><tr><th>Consumable</th><th>Basis</th><th class="num">Current</th><th class="num">Prior Window</th><th class="num">Change</th></tr></thead>
    <tbody>
      ${usableConsumables.map(c => {
        const b = c.baseline, p = c.previous_baseline;
        const trend = p && p.cost_per_denominator > 0
          ? ((b.cost_per_denominator - p.cost_per_denominator) / p.cost_per_denominator) * 100 : null;
        return `
        <tr>
          <td>${c.name}${b.confidence === "low" ? " ⚠" : ""}</td>
          <td class="vendor">${DENOM_LABELS[c.denominator] || c.denominator}${c.method === "statistical" ? " (drift only)" : ""}</td>
          <td class="num"><strong>${fmtMoney(b.cost_per_denominator, 3)}</strong></td>
          <td class="num">${p ? fmtMoney(p.cost_per_denominator, 3) : "—"}</td>
          <td class="num ${trend == null ? "" : trend > 1 ? "red" : trend < -1 ? "green" : ""}">${trend == null ? "—" : `${trend > 0 ? "+" : ""}${trend.toFixed(1)}%`}</td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>
  <p style="font-size:11px;color:#a08060;margin-top:8px">Items without enough purchase history are omitted rather than shown with unreliable rates.</p>
  </div>` : "";

    const varianceRows = consumables.filter(c =>
      c.method === "rule" && c.baseline && c.baseline.confidence !== "insufficient" &&
      c.baseline.variance_pct != null && Math.abs(c.baseline.variance_pct) >= 0.10);
    const varianceSection = varianceRows.length > 0 ? `
  <div class="section">
  <h2>⚠ Usage Variance Flags</h2>
  <table>
    <thead><tr><th>Consumable</th><th class="num">Bought</th><th class="num">Expected from Sales</th><th class="num">Unaccounted</th></tr></thead>
    <tbody>
      ${varianceRows.map(c => {
        const b = c.baseline;
        return `
        <tr>
          <td><strong>${c.name}</strong> <span class="vendor">(${b.window_start} → ${b.window_end})</span></td>
          <td class="num">${Math.round(b.units_purchased).toLocaleString()}</td>
          <td class="num">${Math.round(b.expected_units).toLocaleString()}</td>
          <td class="num red"><strong>${Math.round(b.variance_units).toLocaleString()} (${b.variance_pct > 0 ? "+" : ""}${Math.round(b.variance_pct*100)}%)</strong></td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>
  <p style="font-size:11px;color:#a08060;margin-top:8px">Purchased more than sales imply — waste, breakage, theft, or a wrong usage rule.</p>
  </div>` : "";

    const htmlContent = `<!DOCTYPE html>
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
      <div class="stat-label">${expenses ? "Weekly Spend" : "Sold-Out Items"}</div>
      <div class="stat-value">${expenses ? fmtMoney(expenses.total_spend) : soldOutItems}</div>
      <div class="stat-sub">${expenses ? `${expenses.invoice_count} confirmed invoices` : "had &ge;1 sell-out day"}</div>
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
  ${expenseSection}
  ${priceChangeSection}
  ${consumableSection}
  ${varianceSection}

  <div class="footer">
    <span>Crumbs &middot; Pastry Analytics &amp; Expenses</span>
    <span>${weekLabel}</span>
    <span>Generated ${now}</span>
  </div>
</body>
</html>`;
    // Use Blob URL instead of document.write — avoids blank page in modern browsers
    const blob = new Blob([htmlContent], { type: "text/html" });
    const url  = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, backdropFilter:"blur(4px)" }}>
      <div style={{ background:"#1a1008", border:"1px solid #5a3a1a", borderRadius:16, padding:40, width:500, maxWidth:"90vw" }}>
        <h2 style={{ fontFamily:"'Playfair Display', serif", color:"#e8c99a", marginBottom:8, fontSize:22 }}>Weekly Report</h2>
        <p style={{ color:"#5a3a1a", fontSize:13, marginBottom:24, lineHeight:1.6 }}>
          Generates a print-ready PDF report for <span style={{ color:"#c9a87c" }}>{weekLabel}</span> including summary stats,
          daily performance, item breakdown, expenses, price changes, and consumable costs.
        </p>
        <div style={{ background:"#120d06", border:"1px solid #2a1f14", borderRadius:10, padding:"14px 18px", marginBottom:24, fontSize:12, color:"#5a3a1a", lineHeight:1.8 }}>
          <div>📊 {weekData.length} items · {vendors.join(", ")}</div>
          <div>📅 {weekLabel}</div>
          <div style={{ marginTop:6, color:"#a08060" }}>A new tab will open — click "Save as PDF / Print" then choose "Save as PDF" in your print dialog.</div>
        </div>
        <div style={{ display:"flex", gap:12, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{ padding:"10px 22px", background:"transparent", border:"1px solid #5a3a1a", borderRadius:8, color:"#c9a87c", cursor:"pointer", fontSize:14 }}>Cancel</button>
          <button onClick={handlePrint} disabled={building} style={{ padding:"10px 22px", background:"#c9a87c", border:"none", borderRadius:8, color:"#0d0904", cursor:"pointer", fontSize:14, fontWeight:700 }}>
            {building ? "Building…" : "Generate Report"}
          </button>
        </div>
      </div>
    </div>
  );
}
