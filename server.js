// Code Blossom server
// Express serves the website (public/index.html) and a small JSON API.
// PostgreSQL stores everything. Read top to bottom: it is arranged in the order things happen.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const express = require('express');
const { Pool } = require('pg');

// ---------------------------------------------------------------------------
// 1. Settings (read from environment variables, see .env.example)
// ---------------------------------------------------------------------------
const { DATABASE_URL, APP_PASSWORD, SESSION_SECRET } = process.env;
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const missing = ['DATABASE_URL', 'APP_PASSWORD', 'SESSION_SECRET'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error('Missing settings: ' + missing.join(', '));
  console.error('Copy .env.example to .env and fill them in (or add them in your host\'s dashboard).');
  process.exit(1);
}
if (SESSION_SECRET.length < 16) {
  console.error('SESSION_SECRET is too short. Use at least 16 random characters (32+ is better).');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Database connection
// ---------------------------------------------------------------------------
const pool = new Pool({
  connectionString: DATABASE_URL,
  // If your connection string already has "sslmode=require" the pg library handles SSL for you.
  // DATABASE_SSL=true is for hosts that need SSL but don't put it in the string.
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});
pool.on('error', (err) => console.error('Database connection error:', err.message));

async function setUpDatabase() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

// ---------------------------------------------------------------------------
// 3. Login: one password, a signed cookie that lasts 30 days
// ---------------------------------------------------------------------------
const COOKIE_NAME = 'cb_session';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const sign = (value) => crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');

function makeToken() {
  const expires = String(Date.now() + THIRTY_DAYS_MS);
  return expires + '.' + sign(expires);
}

function tokenIsValid(token) {
  if (!token) return false;
  const [expires, signature] = token.split('.');
  if (!expires || !signature) return false;
  const expected = Buffer.from(sign(expires));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return false;
  return Number(expires) > Date.now();
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

function passwordMatches(input) {
  // Hash both sides so they have equal length, then compare in constant time.
  const a = crypto.createHash('sha256').update(String(input)).digest();
  const b = crypto.createHash('sha256').update(APP_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function requireLogin(req, res, next) {
  if (tokenIsValid(readCookie(req, COOKIE_NAME))) return next();
  res.status(401).json({ error: 'Please sign in.' });
}

// Slow down password guessing: 8 wrong tries per 10 minutes per IP address.
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) return false;
  return entry.count >= 8;
}
function recordFailedAttempt(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) attempts.set(ip, { count: 1, resetAt: now + 10 * 60 * 1000 });
  else entry.count += 1;
}

// ---------------------------------------------------------------------------
// 4. Cleaning what the browser sends. Never trust it: check type and length.
// ---------------------------------------------------------------------------
const ID_PATTERN = /^[A-Za-z0-9]{1,40}$/;
const str = (v, max) => String(v == null ? '' : v).slice(0, max);
const int = (v, min, max, fallback) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const millis = (v) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? n : Date.now();
};
function cleanTags(v) {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  const out = [];
  for (const t of v) {
    const tag = str(t, 24).replace(/^#+/, '').replace(/\s+/g, ' ').trim();
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      out.push(tag);
    }
  }
  return out.slice(0, 20);
}
function cleanUrl(v) {
  try {
    const u = new URL(String(v).trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href.slice(0, 2000);
  } catch (e) {
    return '';
  }
}

// One entry per kind of thing we store. "clean" turns browser data into safe column values.
// "valid" decides whether the row is worth saving at all.
const MODELS = {
  languages: {
    table: 'languages',
    clean: (d) => ({ name: str(d.name, 40).trim(), goal: str(d.goal, 120), stage: int(d.stage, 1, 4, 1), added: millis(d.added) }),
    valid: (c) => c.name.length > 0,
  },
  docs: {
    table: 'docs',
    clean: (d) => ({
      title: str(d.title, 200),
      kind: ['learning', 'app', 'notes'].includes(d.kind) ? d.kind : 'notes',
      lang: str(d.lang, 40),
      tags: JSON.stringify(cleanTags(d.tags)),
      body: str(d.body, 200000),
      created: millis(d.created),
      updated: millis(d.updated),
    }),
    valid: () => true,
  },
  snippets: {
    table: 'snippets',
    clean: (d) => ({
      title: str(d.title, 80) || 'Untitled snippet',
      lang: str(d.lang, 40),
      code: str(d.code, 100000),
      note: str(d.note, 160),
      created: millis(d.created),
      updated: millis(d.updated),
    }),
    valid: (c) => c.code.trim().length > 0,
  },
  links: {
    table: 'links',
    clean: (d) => ({
      url: cleanUrl(d.url),
      title: str(d.title, 80),
      topic: str(d.topic, 40),
      note: str(d.note, 160),
      created: millis(d.created),
      updated: millis(d.updated),
    }),
    valid: (c) => c.url.length > 0,
  },
};
const STEP_IDS = new Set(['htmlcss', 'js', 'git', 'react', 'node', 'sql', 'deploy']);

// ---------------------------------------------------------------------------
// 5. The web app
// ---------------------------------------------------------------------------
const app = express();
app.set('trust proxy', 1); // hosts like Render put a proxy in front of your app
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '5mb' }));

// Every request that changes something must say it is JSON. Together with SameSite cookies,
// this stops other websites from sending requests on your behalf.
app.use('/api', (req, res, next) => {
  const hasBody = Number(req.headers['content-length']) > 0;
  if (req.method !== 'GET' && hasBody && !req.is('application/json')) return res.status(415).json({ error: 'Send JSON.' });
  next();
});

// Small helper so a thrown error inside an async route reaches the error handler.
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

app.get('/api/health', wrap(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
}));

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (tooManyAttempts(ip)) return res.status(429).json({ error: 'Too many tries. Wait a few minutes.' });
  if (!passwordMatches((req.body && req.body.password) || '')) {
    recordFailedAttempt(ip);
    return res.status(401).json({ error: 'That password did not match.' });
  }
  attempts.delete(ip);
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${makeToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${THIRTY_DAYS_MS / 1000}${IS_PROD ? '; Secure' : ''}`
  );
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${IS_PROD ? '; Secure' : ''}`);
  res.json({ ok: true });
});

// Everything the page needs on load, in one request.
app.get('/api/bootstrap', requireLogin, wrap(async (req, res) => {
  const [langs, docs, snippets, links, steps, days, theme] = await Promise.all([
    pool.query('SELECT * FROM languages ORDER BY added DESC'),
    pool.query('SELECT * FROM docs ORDER BY updated DESC'),
    pool.query('SELECT * FROM snippets ORDER BY created DESC'),
    pool.query('SELECT * FROM links ORDER BY created DESC'),
    pool.query('SELECT id, done FROM steps'),
    pool.query('SELECT day FROM days ORDER BY day'),
    pool.query("SELECT value FROM settings WHERE key = 'theme'"),
  ]);
  const stepMap = {};
  steps.rows.forEach((r) => { stepMap[r.id] = r.done; });
  res.json({
    langs: langs.rows.map((r) => ({ id: r.id, name: r.name, goal: r.goal, stage: r.stage, added: Number(r.added) })),
    docs: docs.rows.map((r) => ({
      id: r.id, title: r.title, kind: r.kind, lang: r.lang, tags: r.tags, body: r.body,
      created: Number(r.created), updated: Number(r.updated),
    })),
    snippets: snippets.rows.map((r) => ({
      id: r.id, title: r.title, lang: r.lang, code: r.code, note: r.note,
      created: Number(r.created), updated: Number(r.updated),
    })),
    links: links.rows.map((r) => ({
      id: r.id, url: r.url, title: r.title, topic: r.topic, note: r.note,
      created: Number(r.created), updated: Number(r.updated),
    })),
    steps: stepMap,
    days: days.rows.map((r) => r.day),
    theme: theme.rows[0] ? theme.rows[0].value : '',
  });
}));

// The page sends only what changed since the last save: new or edited items, deleted items,
// ticked steps, new check-in days, and the theme. All of it is saved in one transaction,
// so you either get all of it or none of it.
app.post('/api/sync', requireLogin, wrap(async (req, res) => {
  const body = req.body || {};
  const upserts = Array.isArray(body.upserts) ? body.upserts : [];
  const deletes = Array.isArray(body.deletes) ? body.deletes : [];
  const days = Array.isArray(body.days) ? body.days : [];
  if (upserts.length + deletes.length + days.length > 3000) {
    return res.status(413).json({ error: 'Too many changes at once.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const u of upserts) {
      const model = u && MODELS[u.kind];
      if (!model || !u.data || !ID_PATTERN.test(String(u.id))) continue;
      const cols = model.clean(u.data);
      if (!model.valid(cols)) continue;
      const names = Object.keys(cols);
      const params = [String(u.id), ...names.map((n) => cols[n])];
      const placeholders = params.map((_, i) => '$' + (i + 1)).join(', ');
      const updates = names.map((n) => `${n} = EXCLUDED.${n}`).join(', ');
      // Table and column names come from the MODELS list above, never from the browser.
      await client.query(
        `INSERT INTO ${model.table} (id, ${names.join(', ')}) VALUES (${placeholders})
         ON CONFLICT (id) DO UPDATE SET ${updates}`,
        params
      );
    }

    for (const d of deletes) {
      const model = d && MODELS[d.kind];
      if (!model || !ID_PATTERN.test(String(d.id))) continue;
      await client.query(`DELETE FROM ${model.table} WHERE id = $1`, [String(d.id)]);
    }

    for (const [id, done] of Object.entries(body.steps || {})) {
      if (!STEP_IDS.has(id)) continue;
      await client.query(
        'INSERT INTO steps (id, done) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET done = EXCLUDED.done',
        [id, done === true]
      );
    }

    for (const day of days) {
      if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
        await client.query('INSERT INTO days (day) VALUES ($1) ON CONFLICT DO NOTHING', [day]);
      }
    }

    if (['', 'light', 'dark'].includes(body.theme)) {
      await client.query(
        "INSERT INTO settings (key, value) VALUES ('theme', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        [body.theme]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}));

// ---------------------------------------------------------------------------
// 6. Link checker: "does this link actually work, and what is it called?"
// The server visits the address for you. Because that makes the server fetch
// whatever address it is given, it refuses private and internal addresses.
// ---------------------------------------------------------------------------
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    return l === '::' || l === '::1' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('::ffff:');
  }
  return true;
}

async function assertPublicUrl(urlString) {
  const u = new URL(urlString);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https links can be checked.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('That address is not a public website.');
    return u;
  }
  const found = await dns.lookup(host, { all: true });
  if (!found.length || found.some((a) => isPrivateAddress(a.address))) {
    throw new Error('That address is not a public website.');
  }
  return u;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
}

// Read just enough of the page to find <title>, and stop after 256 KB.
async function readTitle(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (bytes < 262144) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      text += decoder.decode(value, { stream: true });
      const m = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (m) return decodeEntities(m[1]).replace(/\s+/g, ' ').trim().slice(0, 120);
    }
  } catch (e) {
    // ignore: a missing title is fine
  } finally {
    reader.cancel().catch(() => {});
  }
  return '';
}

async function checkLink(startUrl) {
  let current = startUrl;
  for (let hop = 0; hop < 4; hop++) {
    const u = await assertPublicUrl(current);
    const response = await fetch(u, {
      redirect: 'manual', // we follow redirects ourselves so every hop is checked
      signal: AbortSignal.timeout(7000),
      headers: { 'User-Agent': 'CodeBlossomLinkChecker/1.0', Accept: 'text/html,*/*;q=0.5' },
    });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, u).href;
      if (response.body) response.body.cancel().catch(() => {});
      continue;
    }
    let title = '';
    const type = response.headers.get('content-type') || '';
    if (response.ok && /text\/html|application\/xhtml/i.test(type) && response.body) title = await readTitle(response);
    else if (response.body) response.body.cancel().catch(() => {});
    return { ok: response.ok, status: response.status, finalUrl: current, title };
  }
  return { ok: false, status: 0, error: 'That link redirects too many times.' };
}

app.post('/api/check-link', requireLogin, wrap(async (req, res) => {
  const url = cleanUrl(req.body && req.body.url);
  if (!url) return res.status(400).json({ ok: false, error: 'That does not look like a web address.' });
  try {
    res.json(await checkLink(url));
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    const notFound = err && err.cause && err.cause.code === 'ENOTFOUND';
    let message = 'Could not reach that address.';
    if (timedOut) message = 'The site took too long to answer.';
    else if (notFound || (err && err.code === 'ENOTFOUND')) message = 'That website name does not exist. Check the spelling.';
    else if (err && /public website|http and https/.test(err.message)) message = err.message;
    res.json({ ok: false, status: 0, error: message });
  }
}));

// ---------------------------------------------------------------------------
// 7. Serve the website, handle errors, start
// ---------------------------------------------------------------------------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad JSON.' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'That is too large to save.' });
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

setUpDatabase()
  .then(() => {
    app.listen(PORT, () => console.log(`Code Blossom is running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('Could not set up the database. Check DATABASE_URL.');
    console.error(err.message);
    process.exit(1);
  });
