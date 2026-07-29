import { Router } from "express";
import { db } from "../db.js";
import {
  gmailConfigured, getAuthUrl, handleOAuthCallback,
  getStoredTokens, disconnectGmail, runGmailSyncLogged,
} from "../gmail.js";

export const gmailRouter = Router();

gmailRouter.get("/api/gmail/auth", (_req, res) => {
  if (!gmailConfigured()) {
    return res.status(500).send("Google OAuth is not configured — set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.");
  }
  res.redirect(getAuthUrl());
});

gmailRouter.get("/api/gmail/callback", async (req, res) => {
  try {
    if (!req.query.code) throw new Error(req.query.error || "No authorization code returned");
    const email = await handleOAuthCallback(req.query.code);
    res.send(`<html><body style="font-family:sans-serif;padding:40px;text-align:center">
      <h2>✅ Gmail connected${email ? ` as ${email}` : ""}</h2>
      <p>You can close this tab and return to Crumbs.</p>
      <script>setTimeout(() => { window.location = "/"; }, 2500)</script>
    </body></html>`);
  } catch (err) {
    res.status(500).send(`<html><body style="font-family:sans-serif;padding:40px;text-align:center">
      <h2>❌ Gmail connection failed</h2><p>${err.message}</p>
    </body></html>`);
  }
});

gmailRouter.get("/api/gmail/status", (_req, res) => {
  const tokens = getStoredTokens();
  const lastSync = db.prepare(
    "SELECT * FROM sync_log WHERE job_type = 'gmail_sync' ORDER BY id DESC LIMIT 1"
  ).get();
  res.json({
    configured: gmailConfigured(),
    connected: !!tokens?.refresh_token,
    account_email: tokens?.account_email || null,
    last_sync: lastSync?.finished_at || lastSync?.started_at || null,
    last_status: lastSync?.status || null,
    last_message: lastSync?.message || null,
  });
});

gmailRouter.post("/api/gmail/sync", async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, parseInt(req.body?.days) || 14));
    const result = await runGmailSyncLogged({ days });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

gmailRouter.post("/api/gmail/disconnect", (_req, res) => {
  disconnectGmail();
  res.json({ ok: true });
});
