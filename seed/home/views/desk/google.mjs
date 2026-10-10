// Google accounts (Connections → Gmail): any number, each signed in one of two ways:
//   app-password  the address plus a Gmail app password (the default: no Google Cloud setup)
//   google        "Sign in with Google" through the owner's own OAuth client (the fallback when an
//                 account can't make app passwords, e.g. some Workspace accounts); keeps a refresh token
// Both reach Gmail over IMAP (the token kind with XOAUTH2), so Mail and agents read every account
// the same way. Stored in ~/.config/springroll/google.json (mode 600); values never leave this module.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

const HOME = os.homedir();
const CONF = path.join(HOME, '.config', 'springroll');
const FILE = path.join(CONF, 'google.json');
const LEGACY = path.join(CONF, 'gmail'); // the single-account file Mail used before (address, app password)
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function readGoogle() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  // First use: carry over the old single account.
  try {
    const [email, password] = fs.readFileSync(LEGACY, 'utf8').split('\n').map((l) => l.trim());
    if (email && password) { const d = { accounts: [{ email, method: 'app-password', password, added: fs.statSync(LEGACY).mtimeMs }] }; writeGoogle(d); return d; }
  } catch {}
  return { accounts: [] };
}
function writeGoogle(d) {
  fs.mkdirSync(CONF, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(FILE, 0o600);
}

// What the page sees: no passwords, tokens or the client secret.
export function listGoogle() {
  const d = readGoogle();
  return {
    accounts: d.accounts.map((a) => ({ email: a.email, method: a.method, added: a.added || null, lastTest: a.lastTest || null })),
    client: d.client?.id ? { id: d.client.id } : null,
    policy: { send: d.policy?.send === 'ask' ? 'ask' : 'auto' },
  };
}

// What agents may do with these accounts (bin/gmail reads it). Default: reply, send and archive freely;
// "ask": sending needs the owner's yes in the chat first.
export function setPolicy({ send }) {
  const d = readGoogle();
  d.policy = { ...(d.policy || {}), send: send === 'ask' ? 'ask' : 'auto' };
  writeGoogle(d);
  return { ok: true, policy: d.policy };
}

async function accessToken(a, client) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client.id, client_secret: client.secret, refresh_token: a.refresh_token, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(j.error_description || j.error || `Google said ${r.status}`);
  return j.access_token;
}

// Sign in to Gmail's IMAP as this account (read-only check: nothing is changed).
const IMAP_TEST = `
import imaplib, os
m = imaplib.IMAP4_SSL('imap.gmail.com', timeout=30)
e = os.environ['G_EMAIL']
if os.environ.get('G_TOKEN'):
    m.authenticate('XOAUTH2', lambda _: ('user=%s\\x01auth=Bearer %s\\x01\\x01' % (e, os.environ['G_TOKEN'])).encode())
else:
    m.login(e, os.environ['G_PASS'])
typ, d = m.select('INBOX', readonly=True)
print('Signed in as %s (%s in the inbox)' % (e, d[0].decode()))
m.logout()
`;
async function testAccount(a, client) {
  const env = { ...process.env, G_EMAIL: a.email };
  if (a.method === 'google') env.G_TOKEN = await accessToken(a, client); else env.G_PASS = a.password;
  return new Promise((resolve) => execFile('python3', ['-c', IMAP_TEST], { env, timeout: 40000 }, (err, out, errOut) => {
    const msg = (out || '').trim() || (errOut || '').trim().split('\n').pop() || (err ? err.message : '');
    resolve({ ok: !err, output: err ? explain(msg) : msg });
  }));
}
function explain(msg) {
  if (/AUTHENTICATIONFAILED|Invalid credentials|Application-specific password/i.test(msg)) return 'Gmail refused the sign-in. Check the address and app password (made at myaccount.google.com/apppasswords, with 2-Step Verification on).';
  if (/Lookup failed|IMAP access is disabled/i.test(msg)) return "Gmail couldn't find this account, or IMAP is off for it (Gmail settings → Forwarding and POP/IMAP → Enable IMAP).";
  return msg.slice(0, 300);
}

function upsert(d, account) {
  d.accounts = [...d.accounts.filter((a) => a.email.toLowerCase() !== account.email.toLowerCase()), account];
  writeGoogle(d);
}

export async function addAppPassword({ email, password }) {
  email = String(email || '').trim(); password = String(password || '').replace(/\s+/g, '');
  if (!EMAIL_RE.test(email)) throw new Error('Enter the Gmail address');
  if (password.length < 8) throw new Error('Paste the 16-letter app password');
  const account = { email, method: 'app-password', password, added: Date.now() };
  const t = await testAccount(account);
  if (!t.ok) return t;
  account.lastTest = { ok: true, at: Date.now(), output: t.output };
  upsert(readGoogle(), account);
  return t;
}

export async function retest(email) {
  const d = readGoogle(), a = d.accounts.find((x) => x.email === email);
  if (!a) throw new Error('No such account');
  const t = await testAccount(a, d.client).catch((e) => ({ ok: false, output: e.message }));
  a.lastTest = { ok: t.ok, at: Date.now(), output: t.output };
  writeGoogle(d);
  return t;
}

export function removeAccount(email) {
  const d = readGoogle();
  const n = d.accounts.length;
  d.accounts = d.accounts.filter((a) => a.email !== email);
  if (d.accounts.length === n) throw new Error('No such account');
  writeGoogle(d);
  try { if (!d.accounts.some((a) => a.method === 'app-password')) fs.rmSync(LEGACY, { force: true }); } catch {}
  return { ok: true };
}

// ---------- Sign in with Google (the fallback) ----------

export function setClient({ id, secret }) {
  id = String(id || '').trim(); secret = String(secret || '').trim();
  if (!/\.apps\.googleusercontent\.com$/.test(id)) throw new Error('The client ID ends in .apps.googleusercontent.com');
  if (secret.length < 10) throw new Error('Paste the client secret');
  const d = readGoogle();
  d.client = { id, secret };
  writeGoogle(d);
  return { ok: true };
}

const pending = new Map(); // state -> { redirect, at }
export function startSignin(origin) {
  const d = readGoogle();
  if (!d.client?.id) throw new Error('Add your Google sign-in client first');
  if (!/^https:\/\/[^/]+$/.test(origin || '')) throw new Error('Open Springroll at its https address to sign in with Google');
  const state = crypto.randomBytes(16).toString('hex');
  const redirect = `${origin}/api/google/callback`;
  pending.set(state, { redirect, at: Date.now() });
  for (const [k, v] of pending) if (Date.now() - v.at > 15 * 60000) pending.delete(k);
  const q = new URLSearchParams({ client_id: d.client.id, redirect_uri: redirect, response_type: 'code', scope: 'https://mail.google.com/ openid email', access_type: 'offline', prompt: 'consent select_account', state });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` };
}

export async function finishSignin({ code, state, error }) {
  if (error) throw new Error(error === 'access_denied' ? 'Sign-in was cancelled' : error);
  const p = pending.get(state);
  if (!p) throw new Error('This sign-in expired. Start it again from Connections.');
  pending.delete(state);
  const d = readGoogle();
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: d.client.id, client_secret: d.client.secret, redirect_uri: p.redirect, grant_type: 'authorization_code' }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || `Google said ${r.status}`);
  if (!j.refresh_token) throw new Error('Google sent no refresh token. Remove Springroll at myaccount.google.com/permissions and sign in again.');
  const email = JSON.parse(Buffer.from(String(j.id_token || '').split('.')[1] || '', 'base64url').toString() || '{}').email;
  if (!email) throw new Error('Google didn\'t say which account this is');
  const account = { email, method: 'google', refresh_token: j.refresh_token, added: Date.now() };
  const t = await testAccount(account, d.client).catch((e) => ({ ok: false, output: e.message }));
  account.lastTest = { ok: t.ok, at: Date.now(), output: t.output };
  upsert(readGoogle(), account);
  return { email, ...t };
}
