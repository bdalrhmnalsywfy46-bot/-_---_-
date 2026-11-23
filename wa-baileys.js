// واتساب مباشرة بدون WAHA (بيشتغل على Termux في الأندرويد)
// مكتبة Baileys غير رسمية: استخدم رقم مخصص للشغل ده
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'wa-auth');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (m, k) => m[k] ?? m.default?.[k];

let sock = null;
let starting = null;
let state = 'STOPPED'; // STOPPED | STARTING | SCAN_QR_CODE | WORKING | FAILED

export const status = () => state;
export const hasSession = () => fs.existsSync(path.join(AUTH_DIR, 'creds.json'));

export async function start() {
  if (sock || starting) return starting;
  starting = (async () => {
    state = 'STARTING';
    const b = await import('@whiskeysockets/baileys');
    const pino = (await import('pino')).default;
    const makeWASocket = typeof b.default === 'function' ? b.default : b.default?.default ?? b.makeWASocket;
    const useMultiFileAuthState = pick(b, 'useMultiFileAuthState');
    const fetchLatestBaileysVersion = pick(b, 'fetchLatestBaileysVersion');
    const DisconnectReason = pick(b, 'DisconnectReason');

    fs.mkdirSync(AUTH_DIR, { recursive: true });
    const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch {}

    const s = makeWASocket({
      ...(version ? { version } : {}),
      auth,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['Clinic Leads', 'Chrome', '1.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    sock = s;

    s.ev.on('creds.update', saveCreds);
    s.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) state = 'SCAN_QR_CODE';
      if (connection === 'open') state = 'WORKING';
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        sock = null;
        starting = null;
        if (code === DisconnectReason.loggedOut) {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          state = 'STOPPED';
        } else {
          state = 'STARTING';
          setTimeout(() => start().catch((e) => console.error('wa restart', e.message)), 3000);
        }
      }
    });
  })().catch((e) => {
    sock = null;
    starting = null;
    state = 'FAILED';
    throw e;
  });
  return starting;
}

// ربط الرقم بكود (من نفس التليفون، من غير QR)
export async function requestPairing(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (/^0\d{10}$/.test(d)) d = '20' + d.slice(1); // 010... -> 2010...
  if (d.length < 8) throw new Error('اكتب الرقم بالكود الدولي، مثلًا 201012345678');
  await start();
  for (let i = 0; i < 40 && state !== 'SCAN_QR_CODE' && state !== 'WORKING'; i++) await sleep(500);
  if (state === 'WORKING') throw new Error('واتساب متوصل بالفعل');
  if (!sock) throw new Error('حاول تاني بعد ثواني');
  const code = await sock.requestPairingCode(d);
  return String(code).replace(/(.{4})(?=.)/g, '$1-');
}

export async function groups() {
  if (!sock || state !== 'WORKING') throw new Error('واتساب مش متوصل');
  const g = await sock.groupFetchAllParticipating();
  return Object.values(g).map((x) => ({ id: x.id, name: x.subject }));
}

export async function sendText(jid, text) {
  if (!sock || state !== 'WORKING') throw new Error('واتساب مش متوصل دلوقتي');
  await sock.sendMessage(jid, { text });
}
