#!/usr/bin/env node
/**
 * Analisa dashboard Kirvano — login + screenshots + tokens CSS.
 * Uso: node scripts/analisar-kirvano.js email senha
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const EMAIL = process.argv[2] || process.env.KIRVANO_EMAIL;
const SENHA = process.argv[3] || process.env.KIRVANO_SENHA;
const OUT = path.join(__dirname, '..', 'docs', 'kirvano-audit');

async function extrairTokens(page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const keys = [
      '--background', '--foreground', '--primary', '--secondary', '--muted',
      '--accent', '--border', '--card', '--card-foreground', '--radius',
      '--bg', '--color-primary', '--color-background'
    ];
    const vars = {};
    for (const k of keys) {
      const v = root.getPropertyValue(k).trim();
      if (v) vars[k] = v;
    }
    const body = getComputedStyle(document.body);
    const sample = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        bg: s.backgroundColor,
        color: s.color,
        border: s.border,
        radius: s.borderRadius,
        padding: s.padding,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        boxShadow: s.boxShadow,
        fontFamily: s.fontFamily
      };
    };
    return {
      cssVars: vars,
      body: { bg: body.backgroundColor, color: body.color, fontFamily: body.fontFamily },
      samples: {
        h1: sample('h1'),
        card: sample('[class*="card" i], [class*="Card"]'),
        sidebar: sample('aside, nav, [class*="sidebar" i], [class*="Sidebar"]'),
        button: sample('button[type="submit"], button'),
        kpi: sample('[class*="metric" i], [class*="balance" i], [class*="saldo" i]')
      },
      title: document.title,
      url: location.href,
      classes: [...new Set(
        [...document.querySelectorAll('[class]')]
          .slice(0, 200)
          .flatMap((el) => el.className.toString().split(/\s+/))
          .filter((c) => c && c.length < 40)
      )].slice(0, 80)
    };
  });
}

async function main() {
  if (!EMAIL || !SENHA) {
    console.error('Uso: node scripts/analisar-kirvano.js email senha');
    process.exit(1);
  }

  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'pt-BR',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();

  console.log('[kirvano] Abrindo app...');
  await page.goto('https://app.kirvano.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });

  // Cloudflare Turnstile — espera até 90s
  console.log('[kirvano] Aguardando Cloudflare...');
  try {
    const frame = page.frameLocator('iframe[src*="challenges.cloudflare"], iframe[title*="Widget"]').first();
    await frame.locator('body').click({ timeout: 5000 }).catch(() => {});
  } catch { /* ok */ }
  await page.waitForFunction(() => {
    const t = document.title.toLowerCase();
    const body = document.body?.innerText || '';
    return !t.includes('momento') && !body.includes('verificação de segurança') && !body.includes('Executando verificação');
  }, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const url = page.url();
  console.log('[kirvano] URL:', url);

  // Login form
  const emailSel = 'input[type="email"], input[name="email"], input[placeholder*="mail" i], input[autocomplete="username"]';
  const passSel = 'input[type="password"], input[name="password"]';

  try {
    await page.waitForSelector(emailSel, { timeout: 30000 });
    await page.fill(emailSel, EMAIL);
    await page.fill(passSel, SENHA);

    const submit = page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Acessar"), button:has-text("Login")').first();
    await submit.click();
    console.log('[kirvano] Login enviado...');
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, '00-pre-login.png'), fullPage: true });
    console.error('[kirvano] Falha no login form:', e.message);
    fs.writeFileSync(path.join(OUT, 'page.html'), await page.content());
    await browser.close();
    process.exit(1);
  }

  await page.waitForTimeout(6000);
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});

  console.log('[kirvano] Pós-login URL:', page.url());
  await page.screenshot({ path: path.join(OUT, '01-dashboard.png'), fullPage: true });

  const tokens = await extrairTokens(page);
  fs.writeFileSync(path.join(OUT, 'tokens.json'), JSON.stringify(tokens, null, 2));

  // Scroll e capturas extras
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, '02-dashboard-scroll.png'), fullPage: false });

  fs.writeFileSync(path.join(OUT, 'page.html'), await page.content());

  console.log('[kirvano] Audit salvo em', OUT);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
