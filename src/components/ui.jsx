import { THEMES } from "../themes.js";

export const VENDOR_COLORS = ["#c9a87c","#7ec87e","#7ca8c8","#c87ca8"];

export function effColor(v, T) {
  return v == null ? T.DIM : v >= 85 ? T.GREEN : v >= 60 ? T.GOLD : T.RED;
}

export function MiniBar({ value, color, T }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      <div style={{ flex:1, height:7, background:T.BORDER, borderRadius:4, overflow:"hidden" }}>
        <div style={{ width:`${Math.min(100,value||0)}%`, height:"100%", background:color, borderRadius:4, transition:"width 0.5s" }} />
      </div>
      <span style={{ fontSize:11, color:T.GOLD, minWidth:32, textAlign:"right" }}>{value != null ? `${value}%` : "—"}</span>
    </div>
  );
}

export function CTooltip({ active, payload, label, T }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:8, padding:"8px 12px", fontSize:12 }}>
      <div style={{ color:T.GOLD, marginBottom:4 }}>{label}</div>
      {payload.map(p => <div key={p.name} style={{ color:p.color||T.GOLD }}>{p.name}: {p.value}</div>)}
    </div>
  );
}

export function VendorBadge({ vendor, vendors }) {
  const idx   = vendors.indexOf(vendor);
  const color = VENDOR_COLORS[idx % VENDOR_COLORS.length];
  return (
    <span style={{ padding:"2px 8px", borderRadius:10, fontSize:10, fontWeight:600, letterSpacing:0.5,
      background:`${color}22`, border:`1px solid ${color}55`, color }}>
      {vendor}
    </span>
  );
}

export function StatCard({ label, value, unit, color, onClick, T }) {
  return (
    <div onClick={onClick}
      style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:12, padding:"20px 22px",
        cursor:onClick?"pointer":"default" }}>
      <div style={{ color:T.DIM, fontSize:11, letterSpacing:2, textTransform:"uppercase", marginBottom:8 }}>{label}</div>
      <div style={{ fontFamily:"'Playfair Display', serif", fontSize:30, fontWeight:700, lineHeight:1, color:color||T.TEXT }}>{value}</div>
      <div style={{ color:T.DIM, fontSize:12, marginTop:4 }}>{unit}</div>
    </div>
  );
}

export function Pill({ children, color, T }) {
  return (
    <span style={{ padding:"2px 10px", borderRadius:20, fontSize:11,
      background:`${color}22`, color, fontWeight:600 }}>
      {children}
    </span>
  );
}

export function ThemeSwitcher({ current, onChange, T }) {
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

// Shared modal chrome
export function ModalShell({ onClose, width = 680, children, T }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.78)", display:"flex", alignItems:"center",
      justifyContent:"center", zIndex:200, backdropFilter:"blur(4px)" }}
      onClick={e => e.target === e.currentTarget && onClose?.()}>
      <div style={{ background:T.CARD, border:`1px solid ${T.BORDER}`, borderRadius:16, width, maxWidth:"94vw",
        maxHeight:"88vh", display:"flex", flexDirection:"column", overflow:"hidden" }}>
        {children}
      </div>
    </div>
  );
}

export const inputStyle = (T) => ({
  padding:"8px 12px", background:T.BG, border:`1px solid ${T.BORDER}`, borderRadius:8,
  color:T.TEXT, fontSize:13, outline:"none",
});

export const btnPrimary = (T, disabled) => ({
  padding:"10px 22px", background:disabled?T.BORDER:T.ACCENT, border:"none", borderRadius:8,
  color:disabled?T.DIM:T.BG, cursor:disabled?"not-allowed":"pointer", fontSize:14, fontWeight:700,
});

export const btnGhost = (T) => ({
  padding:"10px 22px", background:"transparent", border:`1px solid ${T.BORDER}`, borderRadius:8,
  color:T.GOLD, cursor:"pointer", fontSize:14,
});
