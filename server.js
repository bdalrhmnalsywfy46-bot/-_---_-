import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractPhones, waLink } from './phone.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const PORT = env.PORT || 3000;
const WAHA_URL = (env.WAHA_URL || 'http://localhost:3001').replace(/\/$/, '');
const WAHA_SESSION = env.WAHA_SESSION || 'default';
const CLAUDE_MODEL = env.CLAUDE_MODEL || 'claude-haiku-5-5';
const DATA_DIR = env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'leads.json');

const GRAPH = 'https://graph.facebook.com/v21.0';
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

/* ---------- الإعدادات (بتتظبط من الداشبورد) ----------
   القيم في .env بتتاخد كبداية بس، وبعد كده الداشبورد هو اللي بيتحكم. */
let seedPages = [];
try {
  seedPages = JSON.parse(env.PAGES || '[]').map((p) => ({ ...p, id: String(p.id), enabled: true }));
} catch {
  console.error('PAGES مش JSON صح');
}
let settings = { groupId: env.WHATSAPP_GROUP_ID || '', groupName: '', pages: seedPages };
try {
  settings = { ...settings, ...JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8')) };
} catch {}

const activePage = (id) => settings.pages.find((p) => String(p.id) === String(id) && p.enabled);

/* ---------- التخزين ---------- */
let leads = [];
try {
  leads = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
} catch {
  leads = [];
}
let writing = Promise.resolve();
function persist(file, getData) {
  writing = writing
    .then(async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const tmp = file + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(getData(), null, 2));
      await fs.rename(tmp, file);
    })
    .catch((e) => console.error('save failed', e));
  return writing;
}
const save = () => persist(DATA_FILE, () => leads);
const saveSettings = () => persist(SETTINGS_FILE, () => settings);

/* ---------- واتساب (WAHA) ---------- */
function wahaHeaders() {
  return {
    'Content-Type': 'application/json',
    ...(env.WAHA_API_KEY ? { 'X-Api-Key': env.WAHA_API_KEY } : {}),
  };
}

function formatMessage(l) {
  return [
    '🩺 *عميل جديد من الماسنجر*',
    `العيادة: ${l.clinic}`,
    `الاسم: ${l.name}`,
    `الرقم: ${l.phone}`,
    `واتساب: ${waLink(l.phone)}`,
  ].join('\n');
}

async function sendText(text) {
  if (!settings.groupId) throw new Error('لسه ما اخترتش جروب الواتساب من الإعدادات');
  const r = await fetch(`${WAHA_URL}/api/sendText`, {
    method: 'POST',
    headers: wahaHeaders(),
    body: JSON.stringify({ session: WAHA_SESSION, chatId: settings.groupId, text }),
  });
  if (!r.ok) throw new Error(`WAHA ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
const sendToGroup = (lead) => sendText(formatMessage(lead));

async function deliver(lead) {
  try {
    await sendToGroup(lead);
    lead.status = 'sent';
    lead.error = null;
    lead.sentAt = new Date().toISOString();
  } catch (e) {
    lead.status = 'failed';
    lead.error = String(e.message || e);
    console.error('send failed:', lead.error);
  }
  await save();
}

/* ---------- Claude: للأرقام المكتوبة بالحروف ---------- */
const NUMBER_WORDS = /(صفر|واحد|اتنين|اثنين|تلات|ثلاث|اربع|أربع|خمس|ست|سبع|تمان|ثمان|تسع)/;

async function extractWithClaude(text) {
  if (!env.ANTHROPIC_API_KEY || text.length > 400 || !NUMBER_WORDS.test(text)) return [];
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 150,
        system:
          'استخرج أرقام الموبايل من رسالة مريض، حتى لو مكتوبة بالحروف (مثال: صفر واحد صفر...). ' +
          'رجّع JSON بس بالشكل {"phones":["01012345678"]} وبأرقام لاتينية. لو مفيش رقم رجّع {"phones":[]}.',
        messages: [{ role: 'user', content: text }],
      }),
    });
    const data = await r.json();
    const out = (data.content || []).map((c) => c.text || '').join('');
    const parsed = JSON.parse(out.replace(/```json|```/g, '').trim());
    // نمرّرها على نفس الفلتر عشان نضمن إنها أرقام صحيحة
    return extractPhones((parsed.phones || []).join(' '));
  } catch (e) {
    console.error('claude extract failed', e.message);
    return [];
  }
}

/* ---------- اسم المريض ---------- */
const nameCache = new Map();
async function getName(psid, token) {
  if (nameCache.has(psid)) return nameCache.get(psid);
  if (!token) return 'غير معروف';
  try {
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${psid}?fields=name&access_token=${encodeURIComponent(token)}`
    );
    const j = await r.json();
    const name = j.name || 'غير معروف';
    nameCache.set(psid, name);
    return name;
  } catch {
    return 'غير معروف';
  }
}

/* ---------- المعالجة الأساسية ---------- */
async function processText({ text, clinic, pageId = '', psid = '', name = 'غير معروف' }) {
  let phones = extractPhones(text);
  if (!phones.length) phones = await extractWithClaude(text);

  const created = [];
  for (const phone of phones) {
    // نفس الرقم لنفس الصفحة ما يتبعتش مرتين
    if (leads.some((l) => l.phone === phone && l.pageId === pageId)) continue;
    const lead = {
      id: crypto.randomUUID(),
      clinic,
      pageId,
      psid,
      name,
      phone,
      message: text.slice(0, 500),
      createdAt: new Date().toISOString(),
      status: 'pending',
      error: null,
      sentAt: null,
    };
    leads.unshift(lead);
    await save();
    await deliver(lead);
    created.push(lead);
  }
  return created;
}

/* ---------- السيرفر ---------- */
const app = express();
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => (req.rawBody = buf),
  })
);

app.get('/healthz', (_req, res) => res.send('ok'));

// تحقق ميتا من الـ Webhook
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === env.VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

function validSignature(req) {
  if (!env.APP_SECRET) return true;
  const sig = req.get('x-hub-signature-256') || '';
  const expected =
    'sha256=' + crypto.createHmac('sha256', env.APP_SECRET).update(req.rawBody || '').digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.post('/webhook', (req, res) => {
  if (!validSignature(req)) return res.sendStatus(401);
  res.sendStatus(200); // لازم نرد بسرعة، والشغل يكمل في الخلفية
  if (req.body.object !== 'page') return;

  (async () => {
    for (const entry of req.body.entry || []) {
      for (const ev of entry.messaging || []) {
        const text = ev.message?.text;
        if (!text || ev.message.is_echo) continue; // تجاهل رسايل الصفحة نفسها
        const page = activePage(entry.id);
        if (!page) continue; // صفحة مش مختارة من الإعدادات
        const psid = ev.sender.id;
        const name = await getName(psid, page.token);
        await processText({ text, clinic: page.name, pageId: String(entry.id), psid, name });
      }
    }
  })().catch((e) => console.error('webhook error', e));
});

/* ---------- حماية الداشبورد ---------- */
app.use((req, res, next) => {
  if (!env.DASHBOARD_PASSWORD) {
    return res.status(503).send('حط DASHBOARD_PASSWORD في ملف .env الأول');
  }
  const [scheme, encoded] = (req.get('authorization') || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const [u, ...rest] = Buffer.from(encoded, 'base64').toString().split(':');
    const p = rest.join(':');
    if (u === (env.DASHBOARD_USER || 'admin') && p === env.DASHBOARD_PASSWORD) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Clinic Leads", charset="UTF-8"');
  res.status(401).send('مطلوب تسجيل دخول');
});

app.use(express.static(path.join(__dirname, 'public')));

/* ---------- API الداشبورد ---------- */
app.get('/api/leads', (_req, res) => {
  res.json({
    leads: leads.map((l) => ({ ...l, wa: waLink(l.phone) })),
    groupConfigured: Boolean(settings.groupId),
    pagesCount: settings.pages.filter((p) => p.enabled).length,
  });
});

app.post('/api/leads/:id/resend', async (req, res) => {
  const lead = leads.find((l) => l.id === req.params.id);
  if (!lead) return res.sendStatus(404);
  await deliver(lead);
  res.json(lead);
});

app.get('/api/groups', async (_req, res) => {
  try {
    const r = await fetch(`${WAHA_URL}/api/${WAHA_SESSION}/groups`, { headers: wahaHeaders() });
    const j = await r.json();
    res.json((Array.isArray(j) ? j : []).map((g) => ({
      id: g.id?._serialized || g.id,
      name: g.name || g.subject,
    })));
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// تجربة من الداشبورد: معاينة الاستخراج أو إرسال فعلي
app.post('/api/simulate', async (req, res) => {
  const { text = '', clinic = 'تجربة', name = 'مريض تجريبي', send = false } = req.body || {};
  if (!send) {
    let phones = extractPhones(text);
    if (!phones.length) phones = await extractWithClaude(text);
    return res.json({ phones });
  }
  const created = await processText({ text, clinic, name, pageId: 'test' });
  res.json({ phones: created.map((l) => l.phone), created });
});

/* ---------- API الإعدادات ---------- */
const enc = encodeURIComponent;

async function setSubscription(page, on) {
  const url = `${GRAPH}/${page.id}/subscribed_apps`;
  const r = on
    ? await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ subscribed_fields: 'messages', access_token: page.token }),
      })
    : await fetch(`${url}?access_token=${enc(page.token)}`, { method: 'DELETE' });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
}

app.get('/api/settings', (_req, res) => {
  res.json({
    groupId: settings.groupId,
    groupName: settings.groupName,
    pages: settings.pages.map(({ token, ...p }) => ({ ...p, hasToken: Boolean(token) })),
  });
});

// حالة واتساب (WAHA) + الـ QR
app.get('/api/waha/status', async (_req, res) => {
  try {
    const r = await fetch(`${WAHA_URL}/api/sessions/${WAHA_SESSION}`, { headers: wahaHeaders() });
    const j = await r.json();
    res.json({ status: j.status || 'UNKNOWN' });
  } catch {
    res.json({ status: 'UNREACHABLE' });
  }
});

app.post('/api/waha/start', async (_req, res) => {
  try {
    await fetch(`${WAHA_URL}/api/sessions/${WAHA_SESSION}/start`, { method: 'POST', headers: wahaHeaders() });
  } catch {}
  res.json({ ok: true });
});

app.get('/api/waha/qr', async (_req, res) => {
  try {
    const r = await fetch(`${WAHA_URL}/api/${WAHA_SESSION}/auth/qr`, {
      headers: { ...wahaHeaders(), Accept: 'application/json' },
    });
    if (!r.ok) return res.status(404).json({ error: 'مفيش QR دلوقتي' });
    const j = await r.json();
    res.json({ image: `data:${j.mimetype || 'image/png'};base64,${j.data}` });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.put('/api/settings/group', async (req, res) => {
  const { id, name = '' } = req.body || {};
  if (!/@g\.us$/.test(id || '')) return res.status(400).json({ error: 'ده مش id جروب صح' });
  settings.groupId = id;
  settings.groupName = name;
  await saveSettings();
  res.json({ ok: true });
});

app.post('/api/settings/test-group', async (_req, res) => {
  try {
    await sendText('✅ تجربة: الجروب ده متوصل بنظام أرقام المرضي.');
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// صفحات الماسنجر: بنجيب الصفحات من حساب فيسبوك، والتوكنات بتفضل على السيرفر
let candidates = new Map();

app.post('/api/fb/pages', async (req, res) => {
  try {
    let token = String(req.body?.userToken || '').trim();
    if (!token) return res.status(400).json({ error: 'الصق التوكن الأول' });

    // لو APP_ID و APP_SECRET موجودين، نحوّل التوكن لتوكن طويل عشان توكنات الصفحات ما تنتهيش
    if (env.APP_ID && env.APP_SECRET) {
      const x = await fetch(
        `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${enc(env.APP_ID)}` +
          `&client_secret=${enc(env.APP_SECRET)}&fb_exchange_token=${enc(token)}`
      );
      const xj = await x.json();
      if (xj.access_token) token = xj.access_token;
    }

    const r = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&limit=100&access_token=${enc(token)}`);
    const j = await r.json();
    if (j.error) return res.status(400).json({ error: j.error.message });

    candidates = new Map(j.data.map((p) => [p.id, { id: p.id, name: p.name, token: p.access_token }]));
    res.json({
      pages: j.data.map((p) => ({
        id: p.id,
        name: p.name,
        selected: settings.pages.some((x) => x.id === p.id && x.enabled),
      })),
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.post('/api/settings/pages', async (req, res) => {
  const ids = new Set((req.body?.ids || []).map(String));
  const results = [];
  for (const c of candidates.values()) {
    const existing = settings.pages.find((p) => p.id === c.id);
    try {
      if (ids.has(c.id)) {
        const page = existing || { id: c.id, name: c.name };
        Object.assign(page, { token: c.token, enabled: true });
        await setSubscription(page, true);
        if (!existing) settings.pages.push(page);
        results.push({ id: c.id, name: c.name, ok: true });
      } else if (existing?.enabled) {
        existing.enabled = false;
        await setSubscription({ ...existing, token: c.token }, false).catch(() => {});
      }
    } catch (e) {
      if (existing) existing.enabled = false;
      results.push({ id: c.id, name: c.name, ok: false, error: String(e.message || e) });
    }
  }
  await saveSettings();
  res.json({ results });
});

app.patch('/api/settings/pages/:id', async (req, res) => {
  const page = settings.pages.find((p) => p.id === req.params.id);
  if (!page) return res.sendStatus(404);
  try {
    if (typeof req.body?.name === 'string' && req.body.name.trim()) page.name = req.body.name.trim();
    if (typeof req.body?.enabled === 'boolean' && req.body.enabled !== page.enabled) {
      await setSubscription(page, req.body.enabled);
      page.enabled = req.body.enabled;
    }
    await saveSettings();
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.delete('/api/settings/pages/:id', async (req, res) => {
  const page = settings.pages.find((p) => p.id === req.params.id);
  if (!page) return res.sendStatus(404);
  await setSubscription(page, false).catch(() => {});
  settings.pages = settings.pages.filter((p) => p !== page);
  await saveSettings();
  res.json({ ok: true });
});

app.get('/api/export.csv', (_req, res) => {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['العيادة', 'الاسم', 'الرقم', 'الحالة', 'الوقت'].map(q).join(',')];
  for (const l of leads) {
    rows.push([q(l.clinic), q(l.name), `"=""${l.phone}"""`, q(l.status), q(l.createdAt)].join(','));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="leads.csv"');
  res.send('\uFEFF' + rows.join('\n'));
});

/* ---------- إعادة المحاولة التلقائية ----------
   أي رقم اتسجل ومااتبعتش (النت فاصل) بيتبعت لوحده أول ما النت يرجع.
   بنبعت الأقدم الأول، ومعاه فاصل 3 ثواني عشان واتساب ما يشكّش. */
let retrying = false;
async function retryPending() {
  if (retrying) return;
  retrying = true;
  try {
    const queue = leads
      .filter((l) => l.status === 'failed' || (l.status === 'pending' && Date.now() - new Date(l.createdAt) > 60000))
      .reverse();
    for (const l of queue) {
      await deliver(l);
      if (l.status === 'failed') break; // لسه مفيش نت، نحاول في الدورة الجاية
      await new Promise((r) => setTimeout(r, 3000));
    }
  } finally {
    retrying = false;
  }
}
setInterval(retryPending, 30000);
retryPending();

app.listen(PORT, () => console.log(`Clinic Leads شغال على بورت ${PORT}`));
