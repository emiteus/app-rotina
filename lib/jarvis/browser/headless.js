/**
 * Browser headless (Playwright) — opt-in.
 * Env: JARVIS_BROWSER_HEADLESS=1 + playwright instalado no host.
 * Sessões por userId (TTL 5 min).
 */
const { assertSafeUrl } = require('../tools/handlers/research');

const sessions = new Map();
const TTL_MS = 5 * 60 * 1000;

function headlessEnabled() {
  return String(process.env.JARVIS_BROWSER_HEADLESS || '').trim() === '1';
}

async function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const err = new Error(
      'Playwright não instalado. No host: npm i playwright && npx playwright install chromium. Ou JARVIS_BROWSER_HEADLESS=0.'
    );
    err.code = 'NO_PLAYWRIGHT';
    throw err;
  }
}

function touch(session) {
  session.at = Date.now();
  return session;
}

async function getSession(userId, { create = false } = {}) {
  const now = Date.now();
  for (const [k, s] of sessions) {
    if (now - s.at > TTL_MS) {
      try {
        await s.browser.close();
      } catch {
        /* ignore */
      }
      sessions.delete(k);
    }
  }
  let s = sessions.get(userId);
  if (s) return touch(s);
  if (!create) return null;
  if (!headlessEnabled()) {
    const err = new Error('Headless off — set JARVIS_BROWSER_HEADLESS=1');
    err.code = 'HEADLESS_OFF';
    throw err;
  }
  const pw = await loadPlaywright();
  const browser = await pw.chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  s = { browser, page, url: null, at: now };
  sessions.set(userId, s);
  return s;
}

async function closeSession(userId) {
  const s = sessions.get(userId);
  if (!s) return;
  sessions.delete(userId);
  try {
    await s.browser.close();
  } catch {
    /* ignore */
  }
}

async function navigate(userId, urlStr) {
  const u = await assertSafeUrl(urlStr);
  const s = await getSession(userId, { create: true });
  await s.page.goto(u.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  s.url = s.page.url();
  touch(s);
  const title = await s.page.title().catch(() => null);
  const text = await s.page
    .locator('body')
    .innerText({ timeout: 5000 })
    .catch(() => '');
  return {
    url: s.url,
    title,
    text: String(text || '').slice(0, 4000)
  };
}

async function click(userId, { selector, text } = {}) {
  const s = await getSession(userId);
  if (!s) {
    const err = new Error('Sem sessão — use browser_open com headless:true antes');
    err.code = 'NO_SESSION';
    throw err;
  }
  if (selector) {
    await s.page.click(String(selector), { timeout: 15000 });
  } else if (text) {
    await s.page.getByText(String(text), { exact: false }).first().click({ timeout: 15000 });
  } else {
    throw new Error('Informe selector ou text');
  }
  touch(s);
  s.url = s.page.url();
  const title = await s.page.title().catch(() => null);
  return { url: s.url, title, ok: true };
}

async function type(userId, { selector, text, clear = true } = {}) {
  const s = await getSession(userId);
  if (!s) {
    const err = new Error('Sem sessão — use browser_open com headless:true antes');
    err.code = 'NO_SESSION';
    throw err;
  }
  if (!selector) throw new Error('selector obrigatório');
  const loc = s.page.locator(String(selector)).first();
  if (clear) await loc.fill('');
  await loc.fill(String(text ?? ''), { timeout: 15000 });
  touch(s);
  return { ok: true, url: s.page.url() };
}

async function snapshot(userId, { maxChars = 4000 } = {}) {
  const s = await getSession(userId);
  if (!s) {
    const err = new Error('Sem sessão — use browser_open com headless:true antes');
    err.code = 'NO_SESSION';
    throw err;
  }
  const title = await s.page.title().catch(() => null);
  const text = await s.page
    .locator('body')
    .innerText({ timeout: 5000 })
    .catch(() => '');
  return {
    url: s.page.url(),
    title,
    text: String(text || '').slice(0, maxChars)
  };
}

module.exports = {
  headlessEnabled,
  navigate,
  click,
  type,
  snapshot,
  closeSession
};
