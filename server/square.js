import { db, getSetting, logJob } from "./db.js";
import { laToUtcISO, laDateStr, addDaysStr, nowISO } from "./dates.js";

const SQUARE_BASE = "https://connect.squareup.com";
const SQUARE_VERSION = "2024-01-17";

const headers = () => ({
  "Authorization": `Bearer ${process.env.SQUARE_API_KEY}`,
  "Content-Type": "application/json",
  "Square-Version": SQUARE_VERSION,
});

export let locationIds = [];

export async function loadLocations() {
  if (!process.env.SQUARE_API_KEY) return;
  try {
    const res = await fetch(`${SQUARE_BASE}/v2/locations`, { headers: headers() });
    const data = await res.json();
    locationIds = (data.locations || []).map(l => l.id);
    console.log(`📍 Locations: ${locationIds.join(", ")}`);
  } catch (err) {
    console.error("Locations error:", err.message);
  }
}

export async function squareSearchOrders(body) {
  const res = await fetch(`${SQUARE_BASE}/v2/orders/search`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ ...body, location_ids: locationIds }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.errors?.[0]?.detail || `Square error ${res.status}`);
  return data;
}

async function fetchCompletedOrders(startISO, endISO) {
  let all = [], cursor = null;
  do {
    const data = await squareSearchOrders({
      query: {
        filter: {
          date_time_filter: { created_at: { start_at: startISO, end_at: endISO } },
          state_filter: { states: ["COMPLETED"] },
        },
        sort: { sort_field: "CREATED_AT", sort_order: "ASC" },
      },
      limit: 500,
      ...(cursor ? { cursor } : {}),
    });
    all = all.concat(data.orders || []);
    cursor = data.cursor || null;
  } while (cursor);
  return all;
}

// ─── Catalog: variation/item id → category name ───────────────────────────────
async function buildCategoryIndex() {
  let objects = [], cursor = null;
  do {
    const url = new URL(`${SQUARE_BASE}/v2/catalog/list`);
    url.searchParams.set("types", "ITEM,CATEGORY");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: headers() });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.errors?.[0]?.detail || `Square catalog error ${res.status}`);
    objects = objects.concat(data.objects || []);
    cursor = data.cursor || null;
  } while (cursor);

  const categoryNames = {};
  for (const o of objects) {
    if (o.type === "CATEGORY") categoryNames[o.id] = o.category_data?.name || "";
  }
  const byCatalogId = {};
  for (const o of objects) {
    if (o.type !== "ITEM") continue;
    const item = o.item_data;
    if (!item) continue;
    const catId = item.category_id
      || item.reporting_category?.id
      || item.categories?.[0]?.id
      || null;
    const catName = item.category?.name || (catId ? categoryNames[catId] : "") || "";
    byCatalogId[o.id] = catName;
    for (const v of item.variations || []) byCatalogId[v.id] = catName;
  }
  return byCatalogId;
}

// ─── Daily metrics sync ───────────────────────────────────────────────────────
// Buckets orders by LA calendar date and caches counts used as denominators.
// One Square fetch per call covering the whole range, bucketed locally.

export async function syncSquareMetrics({ days = 14, from, to } = {}) {
  if (!process.env.SQUARE_API_KEY) throw new Error("SQUARE_API_KEY not configured");
  if (locationIds.length === 0) await loadLocations();

  const endDate = to || laDateStr();
  const startDate = from || addDaysStr(endDate, -(days - 1));
  const startISO = laToUtcISO(startDate, 0, 0);
  const endISO = laToUtcISO(addDaysStr(endDate, 1), 0, 0);

  const [orders, categoryIndex] = await Promise.all([
    fetchCompletedOrders(startISO, endISO),
    buildCategoryIndex().catch(err => {
      console.error("Catalog index error:", err.message);
      return {};
    }),
  ]);

  const drinkCategories = (getSetting("drink_categories") || []).map(s => s.toLowerCase());
  const drinkItems = (getSetting("drink_items") || []).map(s => s.toLowerCase());
  const generic = new Set(["regular", "standard", "default", "n/a", ""]);

  const perDay = {};
  for (const order of orders) {
    if (!order.created_at) continue;
    const date = laDateStr(order.created_at);
    if (date < startDate || date > endDate) continue;
    if (!perDay[date]) perDay[date] = { transactions: 0, drinks: 0, items: {}, categories: {} };
    const day = perDay[date];
    day.transactions += 1;
    for (const li of order.line_items || []) {
      const baseName = (li.name || "Unknown").trim();
      const varName = li.variation_name?.trim();
      const combined = varName && !generic.has(varName.toLowerCase())
        ? `${baseName} (${varName})` : baseName;
      const qty = parseFloat(li.quantity || 1);
      day.items[combined] = (day.items[combined] || 0) + qty;
      const category = categoryIndex[li.catalog_object_id] || "";
      if (category) day.categories[category] = (day.categories[category] || 0) + qty;
      const isDrink = (category && drinkCategories.includes(category.toLowerCase()))
        || drinkItems.includes(baseName.toLowerCase());
      if (isDrink) day.drinks += qty;
    }
  }

  const upsert = db.prepare(`
    INSERT INTO square_daily_metrics (date, transaction_count, drink_count, item_counts, category_counts, synced_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      transaction_count = excluded.transaction_count,
      drink_count = excluded.drink_count,
      item_counts = excluded.item_counts,
      category_counts = excluded.category_counts,
      synced_at = excluded.synced_at
  `);

  let daysWritten = 0;
  const writeAll = db.transaction(() => {
    for (let d = startDate; d <= endDate; d = addDaysStr(d, 1)) {
      const day = perDay[d] || { transactions: 0, drinks: 0, items: {}, categories: {} };
      upsert.run(d, day.transactions, day.drinks, JSON.stringify(day.items), JSON.stringify(day.categories), nowISO());
      daysWritten++;
    }
  });
  writeAll();

  return { message: `${orders.length} orders across ${daysWritten} days (${startDate}..${endDate})`, items: daysWritten };
}

export function syncSquareMetricsLogged(opts) {
  return logJob("square_sync", () => syncSquareMetrics(opts));
}
