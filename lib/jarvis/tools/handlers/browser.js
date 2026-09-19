/**
 * Browser v1 — page snapshot + links (HTTP fetch, SSRF-safe).
 * Sem headless/Playwright — connection-first. Reusa allowlist do research.
 */
const { assertSafeUrl, stripHtml, decodeHtml } = require('./research');

const TYPES = new Set(['browser_open', 'browser_links']);

function extractMeta(html, name) {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
    'i'
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`,
    'i'
  );
  const m = html.match(re) || html.match(re2);
  return m ? decodeHtml(m[1]).trim().slice(0, 300) : null;
}

function extractTitle(html) {
  const tm = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return tm ? stripHtml(tm[1]).slice(0, 200) : null;
}

function extractHeadings(html, limit = 12) {
  const out = [];
  const re = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < limit) {
    const text = stripHtml(m[2]).slice(0, 160);
    if (text.length >= 2) out.push({ level: Number(m[1]), text });
  }
  return out;
}

function extractLinks(html, baseUrl, limit = 30) {
  const out = [];
  const seen = new Set();
  const re = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    base = null;
  }
  while ((m = re.exec(html)) && out.length < limit) {
    let href = decodeHtml(m[1]).trim();
    if (!href || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;
    try {
      const abs = base ? new URL(href, base).href : href;
      if (seen.has(abs)) continue;
      seen.add(abs);
      const label = stripHtml(m[2]).slice(0, 100) || abs;
      out.push({ url: abs.slice(0, 500), label });
    } catch {
      /* skip bad href */
    }
  }
  return out;
}

async function fetchPage(urlStr, { maxBytes = 500_000 } = {}) {
  const u = await assertSafeUrl(urlStr);
  const res = await fetch(u.href, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'JarvisBrowser/0.9.24 (+https://github.com/emiteus/jarvis-os)',
      Accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8'
    },
    signal: AbortSignal.timeout(20000)
  });
  const finalUrl = res.url || u.href;
  if (finalUrl !== u.href) await assertSafeUrl(finalUrl);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.url = finalUrl;
    throw err;
  }
  const ctype = String(res.headers.get('content-type') || '');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) {
    throw new Error(`Resposta grande demais (>${Math.round(maxBytes / 1000)}KB)`);
  }
  return { url: finalUrl, ctype, buf, html: buf.toString('utf8') };
}

async function handleOpen(acao) {
  const url = String(acao.url || acao.link || acao.href || '').trim();
  if (!url) return { tipo: 'browser_open', ok: false, erro: 'Informe url' };
  const maxChars = Math.min(Number(acao.max_chars || 4000) || 4000, 12000);

  try {
    const page = await fetchPage(url);
    const { html, ctype, url: finalUrl } = page;

    if (/json/i.test(ctype)) {
      const text = page.buf.toString('utf8').slice(0, maxChars);
      return {
        tipo: 'browser_open',
        ok: true,
        url: finalUrl,
        kind: 'json',
        chars: text.length,
        text,
        texto: `*Browser* \`${finalUrl}\` (JSON)\n\`\`\`json\n${text.slice(0, 2500)}\n\`\`\``
      };
    }

    const title = extractTitle(html) || extractMeta(html, 'og:title');
    const description =
      extractMeta(html, 'description') || extractMeta(html, 'og:description');
    const headings = extractHeadings(html);
    const links = extractLinks(html, finalUrl, 12);
    const text = stripHtml(html).slice(0, maxChars);

    const lines = [
      `*Browser* \`${finalUrl}\``,
      title ? `**${title}**` : null,
      description ? `_${description.slice(0, 220)}_` : null,
      headings.length
        ? headings.map((h) => `${'#'.repeat(h.level)} ${h.text}`).join('\n')
        : null,
      text ? `\`\`\`\n${text.slice(0, 2200)}\n\`\`\`` : null,
      links.length
        ? `Links:\n${links
            .slice(0, 8)
            .map((l) => `· [${l.label.slice(0, 40)}](${l.url})`)
            .join('\n')}`
        : null
    ].filter(Boolean);

    return {
      tipo: 'browser_open',
      ok: true,
      url: finalUrl,
      kind: 'html',
      title,
      description,
      headings,
      links,
      chars: text.length,
      text,
      texto: lines.join('\n')
    };
  } catch (e) {
    return {
      tipo: 'browser_open',
      ok: false,
      erro: e.message,
      url,
      hint: 'Allowlist: RESEARCH_FETCH_ALLOWLIST ou RESEARCH_FETCH_OPEN=1'
    };
  }
}

async function handleLinks(acao) {
  const url = String(acao.url || acao.link || acao.href || '').trim();
  if (!url) return { tipo: 'browser_links', ok: false, erro: 'Informe url' };
  const limit = Math.min(Number(acao.limit || 25) || 25, 50);

  try {
    const page = await fetchPage(url);
    const links = extractLinks(page.html, page.url, limit);
    const list = links.map((l) => `· ${l.label.slice(0, 50)} — ${l.url}`).join('\n');
    return {
      tipo: 'browser_links',
      ok: true,
      url: page.url,
      count: links.length,
      links,
      texto: `*Links* \`${page.url}\` (${links.length})\n${list || '(nenhum)'}`
    };
  } catch (e) {
    return {
      tipo: 'browser_links',
      ok: false,
      erro: e.message,
      url,
      hint: 'Allowlist: RESEARCH_FETCH_ALLOWLIST ou RESEARCH_FETCH_OPEN=1'
    };
  }
}

async function handle(acao, ctx) {
  const tipo = acao && acao.tipo;
  if (!TYPES.has(tipo)) return null;

  const { requireLib } = require('../../host');
  const { isPlanoOwnerUserId } = requireLib('plano-owner');
  if (!(await isPlanoOwnerUserId(ctx.userId))) {
    return { tipo, ok: false, erro: 'só owner' };
  }

  console.log(
    JSON.stringify({
      tag: 'jarvis.browser',
      event: 'tool',
      tipo,
      url: acao.url || acao.link || null,
      userId: ctx.userId
    })
  );

  if (tipo === 'browser_open') return handleOpen(acao);
  if (tipo === 'browser_links') return handleLinks(acao);
  return null;
}

module.exports = { TYPES, handle };
