import { google } from "googleapis";
import path from "path";
import fs from "fs";
import { db, INVOICE_DIR, logJob } from "./db.js";
import { nowISO } from "./dates.js";
import { extractAndStoreInvoice } from "./extraction.js";

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export function gmailConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

function newOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getStoredTokens() {
  return db.prepare("SELECT * FROM oauth_tokens WHERE provider = 'gmail'").get() || null;
}

function saveTokens({ access_token, refresh_token, expiry_date, scope, account_email }) {
  const existing = getStoredTokens();
  db.prepare(`
    INSERT INTO oauth_tokens (provider, account_email, access_token, refresh_token, expires_at, scope, updated_at)
    VALUES ('gmail', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET
      account_email = COALESCE(excluded.account_email, oauth_tokens.account_email),
      access_token  = COALESCE(excluded.access_token, oauth_tokens.access_token),
      refresh_token = COALESCE(excluded.refresh_token, oauth_tokens.refresh_token),
      expires_at    = COALESCE(excluded.expires_at, oauth_tokens.expires_at),
      scope         = COALESCE(excluded.scope, oauth_tokens.scope),
      updated_at    = excluded.updated_at
  `).run(
    account_email ?? existing?.account_email ?? null,
    access_token ?? null,
    refresh_token ?? null,
    expiry_date ? new Date(expiry_date).toISOString() : null,
    scope ?? null,
    nowISO()
  );
}

export function getAuthUrl() {
  return newOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",           // force refresh_token issuance on reconnect
    scope: [SCOPE],
  });
}

export async function handleOAuthCallback(code) {
  const client = newOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  let email = null;
  try {
    const gmail = google.gmail({ version: "v1", auth: client });
    const profile = await gmail.users.getProfile({ userId: "me" });
    email = profile.data.emailAddress;
  } catch {}
  saveTokens({ ...tokens, account_email: email });
  return email;
}

export function disconnectGmail() {
  db.prepare("DELETE FROM oauth_tokens WHERE provider = 'gmail'").run();
}

function getAuthedClient() {
  const stored = getStoredTokens();
  if (!stored?.refresh_token) throw new Error("Gmail not connected");
  const client = newOAuthClient();
  client.setCredentials({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
    expiry_date: stored.expires_at ? new Date(stored.expires_at).getTime() : null,
  });
  // Persist refreshed access tokens so redeploys keep a valid token set
  client.on("tokens", tokens => saveTokens(tokens));
  return client;
}

// ─── Sync ─────────────────────────────────────────────────────────────────────
// Finds vendor invoice emails with PDF attachments, downloads each PDF, creates
// one pending_review invoice per attachment, then runs extraction. Idempotent:
// (gmail_message_id, gmail_attachment_id) is unique, so re-runs skip existing.

function safeFilename(name) {
  return (name || "invoice.pdf").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function* pdfParts(payload, prefix = "") {
  if (!payload) return;
  const parts = payload.parts || [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const filename = part.filename || "";
    if (part.body?.attachmentId && filename.toLowerCase().endsWith(".pdf")) {
      yield { part, key: `${prefix}${i}:${filename}` };
    }
    if (part.parts) yield* pdfParts(part, `${prefix}${i}.`);
  }
}

export async function runGmailSync({ days = 14, extract = true } = {}) {
  const client = getAuthedClient();
  const gmail = google.gmail({ version: "v1", auth: client });

  const vendors = db.prepare(
    "SELECT * FROM vendors WHERE active = 1 AND email_pattern IS NOT NULL AND email_pattern != ''"
  ).all();
  if (vendors.length === 0) {
    return { message: "No vendors have an email pattern configured — set them in Settings → Vendors", items: 0, found: 0, created: 0 };
  }

  const fromClause = vendors.map(v => v.email_pattern.trim()).join(" OR ");
  const q = `from:(${fromClause}) has:attachment filename:pdf newer_than:${days}d`;

  let messageIds = [], pageToken = null;
  do {
    const res = await gmail.users.messages.list({ userId: "me", q, maxResults: 100, pageToken });
    messageIds = messageIds.concat((res.data.messages || []).map(m => m.id));
    pageToken = res.data.nextPageToken || null;
  } while (pageToken);

  const exists = db.prepare(
    "SELECT id FROM invoices WHERE gmail_message_id = ? AND gmail_attachment_id = ?"
  );
  const insert = db.prepare(`
    INSERT INTO invoices (vendor_id, source, gmail_message_id, gmail_attachment_id, pdf_path, status, created_at)
    VALUES (?, 'gmail', ?, ?, ?, 'pending_review', ?)
  `);

  let created = 0, skipped = 0;
  const errors = [];
  const createdIds = [];

  for (const msgId of messageIds) {
    try {
      const msg = await gmail.users.messages.get({ userId: "me", id: msgId, format: "full" });
      const headersArr = msg.data.payload?.headers || [];
      const fromHeader = (headersArr.find(h => h.name.toLowerCase() === "from")?.value || "").toLowerCase();
      const vendor = vendors.find(v => fromHeader.includes(v.email_pattern.trim().toLowerCase())) || null;

      for (const { part, key } of pdfParts(msg.data.payload)) {
        if (exists.get(msgId, key)) { skipped++; continue; }
        const att = await gmail.users.messages.attachments.get({
          userId: "me", messageId: msgId, id: part.body.attachmentId,
        });
        const buf = Buffer.from(att.data.data, "base64url");
        const filename = `gm_${msgId}_${safeFilename(part.filename)}`;
        const pdfPath = path.join(INVOICE_DIR, filename);
        fs.writeFileSync(pdfPath, buf);

        const { lastInsertRowid: invoiceId } = insert.run(
          vendor?.id ?? null, msgId, key, pdfPath, nowISO()
        );
        created++;
        createdIds.push(invoiceId);
      }
    } catch (err) {
      errors.push(`msg ${msgId}: ${err.message}`);
    }
  }

  // Extraction after the download loop so one bad PDF never blocks ingestion
  let extracted = 0;
  if (extract) {
    for (const invoiceId of createdIds) {
      try {
        await extractAndStoreInvoice(invoiceId);
        extracted++;
      } catch (err) {
        errors.push(`extract invoice ${invoiceId}: ${err.message}`);
      }
    }
  }

  const message = `${messageIds.length} emails matched, ${created} invoices staged, ${skipped} already known, ${extracted} extracted`
    + (errors.length ? ` — ${errors.length} errors: ${errors.slice(0, 3).join("; ")}` : "");
  return { message, items: created, found: messageIds.length, created, skipped, extracted, errors };
}

export function runGmailSyncLogged(opts) {
  return logJob("gmail_sync", () => runGmailSync(opts));
}
