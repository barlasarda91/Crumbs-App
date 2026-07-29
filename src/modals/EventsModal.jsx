import { useState } from "react";

const SHOP_ADDRESS = "950 E 3rd St, Los Angeles CA 90013 (Arts District)";
const SHOP_AREA    = "Arts District, Los Angeles";

export default function EventsModal({ onClose, T }) {
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

        messages.push({ role: "assistant", content: data.content });

        if (data.stop_reason === "end_turn") {
          const textBlock = data.content?.find(b => b.type === "text");
          finalText = textBlock?.text || "";
          break;
        }

        if (data.stop_reason === "tool_use") {
          const toolResults = data.content
            .filter(b => b.type === "tool_use")
            .map(b => ({ type: "tool_result", tool_use_id: b.id, content: "Search completed." }));
          messages.push({ role: "user", content: toolResults });
          continue;
        }

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
