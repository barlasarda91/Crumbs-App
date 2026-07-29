import { laDateStr, laToUtcISO, addDaysStr } from "./dates.js";
import { api } from "./api.js";

// ─── Square → Internal name mapping ──────────────────────────────────────────
// Keys are Square POS names (name + variation combined), values are internal names
export const SQUARE_TO_INTERNAL = {
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

export function normalizeSquareName(name) {
  return SQUARE_TO_INTERNAL[name] || name;
}

// ─── Fetch a week of completed orders ─────────────────────────────────────────
// Store hours 7am–6pm LA. Bounds derived from the actual date's UTC offset so
// PST and PDT both work (spec §11.1) — no hardcoded "7am = 15:00Z".
export async function squareFetchOrders(mondayStr) {
  const startISO = laToUtcISO(mondayStr, 7, 0);                 // Monday 7:00am LA
  const endISO   = laToUtcISO(addDaysStr(mondayStr, 6), 18, 0); // Sunday 6:00pm LA
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
    const data = await api.post("/api/orders", body);
    allOrders  = allOrders.concat(data.orders || []);
    cursor     = data.cursor || null;
  } while (cursor);
  return allOrders;
}

// ─── Flatten orders into per-LA-date item tallies ─────────────────────────────
// Buckets by the LA calendar date (spec §11.2) — a 5:30pm PDT sale is 00:30Z
// the next day and must not land in tomorrow's bucket.
export function flattenOrders(orders) {
  const result = {};
  orders.forEach(order => {
    const createdAt = order.created_at; if (!createdAt) return;
    const date = laDateStr(createdAt);
    (order.line_items || []).forEach(li => {
      const baseName      = (li.name || "Unknown").trim();
      const variationName = li.variation_name?.trim();
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

// ─── Odeko ("Dis Burrito") extraction, bucketed by LA date ────────────────────
export function extractOdeko(rawOrders, odekoItemName) {
  const odekoResult = [];
  rawOrders.forEach(order => {
    const createdAt = order.created_at; if (!createdAt) return;
    const date = laDateStr(createdAt);
    (order.line_items || []).forEach(li => {
      const baseName = (li.name || "").trim();
      if (baseName.toLowerCase() !== odekoItemName.toLowerCase()) return;
      const varName  = li.variation_name?.trim();
      const genericV = new Set(["regular","standard","default","n/a",""]);
      const label    = varName && !genericV.has(varName.toLowerCase()) ? varName : baseName;
      const qty      = parseFloat(li.quantity || 1);
      const existing = odekoResult.find(o => o.item === label);
      if (existing) {
        existing.byDate[date] = (existing.byDate[date] || 0) + qty;
        existing.total += qty;
      } else {
        odekoResult.push({ item: label, byDate: { [date]: qty }, total: qty });
      }
    });
  });
  return odekoResult.sort((a, b) => b.total - a.total);
}
