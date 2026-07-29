CRUMBS — Deployment Guide (Railway)
=====================================

Pastry sell-through analytics + expense tracking for BOXX Coffee Roasters.
Standing orders, invoices, price history and cost baselines are stored
server-side in SQLite (survives redeploys via a Railway volume).

LOCAL DEVELOPMENT
------------------
1. npm install
2. Copy .env.example to .env and add your keys
3. Run two terminals:
   Terminal 1: node server.js        (API + SQLite at ./data/crumbs.db)
   Terminal 2: npm run dev
4. Open http://localhost:5173

RAILWAY SETUP
----------------------------------
1. Deploy from the GitHub repo (Dockerfile build, node:20-slim).

2. Attach a VOLUME to the service, mounted at /data
   (Railway → service → Volumes). Without it, invoice/expense data is
   lost on every redeploy.

3. Variables tab — set:
   SQUARE_API_KEY        = your Square production key
   ANTHROPIC_API_KEY     = for invoice PDF extraction + events feature
   GOOGLE_CLIENT_ID      = from Google Cloud Console (see below)
   GOOGLE_CLIENT_SECRET  = from Google Cloud Console
   GOOGLE_REDIRECT_URI   = https://<your-domain>/api/gmail/callback
   DB_PATH               = /data/crumbs.db
   INVOICE_DIR           = /data/invoices
   TZ                    = America/Los_Angeles

GOOGLE OAUTH (Gmail invoice ingestion)
----------------------------------
Both accounts are on the boxxcoffee Workspace domain, so:
1. Google Cloud Console → new project → enable the Gmail API
2. OAuth consent screen → User type: INTERNAL (no verification needed,
   refresh tokens don't expire on the 7-day testing schedule)
3. Credentials → OAuth client ID → Web application
   Authorized redirect URI: https://<your-domain>/api/gmail/callback
4. Scope used: gmail.readonly only
5. Put client ID/secret in Railway variables, redeploy, then
   Settings → Gmail → Connect in the app.

AFTER FIRST DEPLOY
----------------------------------
1. Re-upload the two vendor .xlsx standing order files (they now save
   to the server, not the browser).
2. Settings → Vendors: fill in each supply vendor's email pattern from
   a real invoice email (e.g. @shorelinesupply.com).
3. Settings → Consumables: configure items (cups, sugar, ...).
4. Settings → Alerts & Drinks: define which Square categories count as
   a drink; set the price alert threshold (default 3%).
5. Settings → Gmail: Connect, then run a 90-day backfill sync.
6. Review and confirm the staged invoices under Invoices.

Every Monday 6:00am PT the app syncs Square metrics, pulls new invoice
emails, and recomputes baselines. New invoices always wait for manual
review — nothing is auto-confirmed.

UPDATING THE APP
-----------------
Push to GitHub → Railway auto-redeploys in ~2 minutes.
