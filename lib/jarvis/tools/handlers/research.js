/**
 * Research tools — web search, fetch URL (SSRF-safe), write report (Gap Map trilho A).
 */
const dns = require('dns').promises;
const net = require('net');
const { URL } = require('url');

const TYPES = new Set([
  'research_web_search',
  'research_fetch_url',
  'research_write_report'
]);

const DEFAULT_ALLOW = [
  'wikipedia.org',
  'en.wikipedia.org',
  'pt.wikipedia.org',
  'github.com',
  'raw.githubusercontent.com',
  'docs.railway.com',
  'railway.com',
  'npmjs.com',
  'www.npmjs.com',
  'developer.mozilla.org',
  'stackoverflow.com',
  'medium.com',
  'dev.to',
  'arxiv.org',
  'news.ycombinator.com',
  'reddit.com',
  'www.reddit.com',
  'linkedin.com',
  'www.linkedin.com',
  'techcrunch.com',
  'theverge.com',
  'bbc.com',
  'bbc.co.uk',
  'cnn.com',
  'globo.com',
  'g1.globo.com',
  'folha.uol.com.br',
  'estadao.com.br',
  'uol.com.br'
];

function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripHtml(html) {
  return decodeHtml(String(html || ''))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPrivateIp(ip) {
  if (!ip || !net.isIP(ip)) return true;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (ip.startsWith('169.254.')) return true;
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true;
  return false;
}

function hostAllowed(hostname) {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/\.$/, '');
  const raw = String(process.env.RESEARCH_FETCH_ALLOWLIST || '').trim();
  const list = raw
    ? raw.split(/[,;\s]+/).map((h) => h.toLowerCase().replace(/^\*\./, ''))
    : DEFAULT_ALLOW;
  const open = process.env.RESEARCH_FETCH_OPEN === '1';
  if (open) return true;
  return list.some((h) => host === h || host.endsWith('.' + h));
}

async function assertSafeUrl(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error('URL inválida');
  }
  if (!/^https?:$/i.test(u.protocol)) {
    throw new Error('Só http/https');
  }
  if (u.username || u.password) {
    throw new Error('URL com credenciais bloqueada');
  }
  const host = u.hostname;
  if (!hostAllowed(host)) {
    throw new Error(
      `Host não allowlist: ${host}. Seta RESEARCH_FETCH_ALLOWLIST ou RESEARCH_FETCH_OPEN=1`
    );
  }
  let ips = [];
  try {
    const r = await dns.lookup(host, { all: true, verbatim: true });
    ips = (r || []).map((x) => x.address);
  } catch (e) {
    throw new Error(`DNS fail: ${e.message}`);
  }
  if (!ips.length || ips.some(isPrivateIp)) {
    throw new Error('IP privado / metadata bloqueado (SSRF)');
  }
  return u;
}

async function searchBrave(query, limit) {
  const key = String(process.env.BRAVE_SEARCH_API_KEY || '').trim();
  if (!key) return null;
  const u = new URL('https://api.search.brave.com/res/v1/web/search');
  u.searchParams.set('q', query);
  u.searchParams.set('count', String(limit));
  const res = await fetch(u, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const data = await res.json();
  const rows = (data.web?.results || []).slice(0, limit).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.description || ''
  }));
  return { provider: 'brave', results: rows };
}

async function searchSerper(query, limit) {
  const key = String(process.env.SERPER_API_KEY || '').trim();
  if (!key) return null;
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
    body: JSON.stringify({ q: query, num: limit }),
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);
  const data = await res.json();
  const rows = (data.organic || []).slice(0, limit).map((r) => ({
    title: r.title || '',
    url: r.link || '',
    snippet: r.snippet || ''
  }));
  return { provider: 'serper', results: rows };
}

async function searchDuckDuckGo(query, limit) {
  const results = [];
  // Instant Answer API (gratuita, limitada)
  try {
    const u = new URL('https://api.duckduckgo.com/');
    u.searchParams.set('q', query);
    u.searchParams.set('format', 'json');
    u.searchParams.set('no_redirect', '1');
    u.searchParams.set('no_html', '1');
    const res = await fetch(u, {
      headers: { 'User-Agent': 'JarvisResearch/0.9.9' },
      signal: AbortSignal.timeout(10000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.AbstractText) {
        results.push({
          title: data.Heading || query,
          url: data.AbstractURL || data.AbstractSource || '',
          snippet: data.AbstractText
        });
      }
      for (const t of data.RelatedTopics || []) {
        if (t.Text && t.FirstURL) {
          results.push({
            title: t.Text.slice(0, 80),
            url: t.FirstURL,
            snippet: t.Text
          });
        } else if (Array.isArray(t.Topics)) {
          for (const x of t.Topics) {
            if (x.Text && x.FirstURL) {
              results.push({
                title: x.Text.slice(0, 80),
                url: x.FirstURL,
                snippet: x.Text
              });
            }
          }
        }
        if (results.length >= limit) break;
      }
    }
  } catch (_) {
    /* fall through */
  }

  if (results.length >= Math.min(3, limit)) {
    return { provider: 'duckduckgo', results: results.slice(0, limit) };
  }

  // HTML lite scrape (best-effort, no key)
  try {
    const u = new URL('https://html.duckduckgo.com/html/');
    u.searchParams.set('q', query);
    const res = await fetch(u, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; JarvisResearch/0.9.9)',
        Accept: 'text/html'
      },
      signal: AbortSignal.timeout(12000)
    });
    if (res.ok) {
      const html = await res.text();
      const blocks = html.split(/class="result__body"|class="result results_/i);
      for (const block of blocks) {
        if (results.length >= limit) break;
        const am = block.match(
          /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
        );
        if (!am) continue;
        let href = decodeHtml(am[1]);
        const uddg = href.match(/[?&]uddg=([^&]+)/);
        if (uddg) {
          try {
            href = decodeURIComponent(uddg[1]);
          } catch (_) {
            /* keep */
          }
        }
        const title = stripHtml(am[2]).slice(0, 160);
        const sm =
          block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div|span)>/i) ||
          block.match(/class="result__snippet"[^>]*>([\s\S]*?)</i);
        const snippet = stripHtml((sm && sm[1]) || '').slice(0, 280);
        if (href && title && /^https?:\/\//i.test(href)) {
          // dedupe
          if (results.some((r) => r.url === href)) continue;
          results.push({ title, url: href, snippet });
        }
      }
    }
  } catch (_) {
    /* ignore */
  }

  return { provider: 'duckduckgo', results: results.slice(0, limit) };
}

/** Se snippet vazio, puxa trecho da página (SSRF-safe; host já veio da busca). */
async function enrichHits(hits, maxFetch = 3) {
  const out = [];
  let fetched = 0;
  for (const h of hits || []) {
    const hit = { ...h, snippet: String(h.snippet || '').trim() };
    if (!hit.snippet && hit.url && fetched < maxFetch) {
      try {
        const u = await assertSafeUrlAllowHit(hit.url);
        const res = await fetch(u.href, {
          redirect: 'follow',
          headers: {
            'User-Agent': 'JarvisResearch/0.9.9',
            Accept: 'text/html,text/plain;q=0.9,*/*;q=0.8'
          },
          signal: AbortSignal.timeout(10000)
        });
        if (res.ok) {
          const html = (await res.text()).slice(0, 120_000);
          const tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          if (!hit.title && tm) hit.title = stripHtml(tm[1]).slice(0, 160);
          const meta =
            html.match(
              /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
            ) ||
            html.match(
              /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i
            );
          hit.snippet = stripHtml((meta && meta[1]) || html)
            .slice(0, 280);
          fetched += 1;
        }
      } catch (_) {
        /* keep empty snippet */
      }
    }
    out.push(hit);
  }
  return out;
}

/** Como assertSafeUrl, mas libera host do hit da busca (ainda bloqueia IP privado). */
async function assertSafeUrlAllowHit(urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error('URL inválida');
  }
  if (!/^https?:$/i.test(u.protocol)) throw new Error('Só http/https');
  if (u.username || u.password) throw new Error('URL com credenciais bloqueada');
  let ips = [];
  try {
    const r = await dns.lookup(u.hostname, { all: true, verbatim: true });
    ips = (r || []).map((x) => x.address);
  } catch (e) {
    throw new Error(`DNS fail: ${e.message}`);
  }
  if (!ips.length || ips.some(isPrivateIp)) {
    throw new Error('IP privado / metadata bloqueado (SSRF)');
  }
  return u;
}

async function handleWebSearch(acao) {
  const query = String(acao.query || acao.q || acao.tema || '').trim();
  if (!query) {
    return { tipo: 'research_web_search', ok: false, erro: 'Informe query' };
  }
  const limit = Math.min(Number(acao.limit || 6) || 6, 10);
  try {
    let out =
      (await searchBrave(query, limit)) ||
      (await searchSerper(query, limit)) ||
      (await searchDuckDuckGo(query, limit));
    if (!out || !out.results.length) {
      return {
        tipo: 'research_web_search',
        ok: false,
        erro: 'Sem resultados',
        hint: 'Opcional: BRAVE_SEARCH_API_KEY ou SERPER_API_KEY no app-rotina'
      };
    }
    const enriched = await enrichHits(out.results, 3);
    if (acao && acao._ctx) {
      acao._ctx._researchHits = [
        ...(acao._ctx._researchHits || []),
        ...enriched
      ].slice(0, 20);
    }
    return {
      tipo: 'research_web_search',
      ok: true,
      query,
      provider: out.provider,
      results: enriched,
      count: enriched.length
    };
  } catch (e) {
    return { tipo: 'research_web_search', ok: false, erro: e.message };
  }
}

async function handleFetchUrl(acao) {
  const url = String(acao.url || acao.link || '').trim();
  if (!url) {
    return { tipo: 'research_fetch_url', ok: false, erro: 'Informe url' };
  }
  const max = Math.min(Number(acao.max_chars || 8000) || 8000, 20000);
  try {
    const u = await assertSafeUrl(url);
    const res = await fetch(u.href, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'JarvisResearch/0.9.9 (+https://github.com/emiteus/jarvis-os)',
        Accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) {
      return { tipo: 'research_fetch_url', ok: false, erro: `HTTP ${res.status}`, url: u.href };
    }
    // Re-check final URL after redirects
    if (res.url && res.url !== u.href) {
      await assertSafeUrl(res.url);
    }
    const ctype = String(res.headers.get('content-type') || '');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 500_000) {
      return {
        tipo: 'research_fetch_url',
        ok: false,
        erro: 'Resposta grande demais (>500KB)',
        url: res.url || u.href
      };
    }
    let text;
    let title = '';
    if (/json/i.test(ctype)) {
      text = buf.toString('utf8').slice(0, max);
    } else if (/html/i.test(ctype) || buf.toString('utf8', 0, 200).includes('<')) {
      const html = buf.toString('utf8');
      const tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      title = tm ? stripHtml(tm[1]).slice(0, 200) : '';
      text = stripHtml(html).slice(0, max);
    } else {
      text = buf.toString('utf8').slice(0, max);
    }
    return {
      tipo: 'research_fetch_url',
      ok: true,
      url: res.url || u.href,
      title: title || null,
      content_type: ctype.split(';')[0] || null,
      truncated: buf.length > max || text.length >= max,
      chars: text.length,
      text
    };
  } catch (e) {
    return { tipo: 'research_fetch_url', ok: false, erro: e.message, url };
  }
}

async function handleWriteReport(acao, ctx) {
  const title = String(acao.title || acao.titulo || 'Relatório').trim().slice(0, 120);
  let body = String(
    acao.body || acao.texto || acao.content || acao.markdown || ''
  ).trim();
  let findings = Array.isArray(acao.findings) ? acao.findings : [];
  let sources = Array.isArray(acao.sources)
    ? acao.sources
    : Array.isArray(acao.fontes)
      ? acao.fontes
      : [];

  const detailed =
    acao.detailed === true ||
    acao.completo === true ||
    acao.com_fontes === true ||
    /fontes|detalh|completo|links/i.test(String(acao.mode || ''));

  // Prefere hits reais da busca neste turno (anti-alucinação)
  const hits = (ctx && ctx._researchHits) || [];
  if (hits.length) {
    const top = hits.slice(0, detailed ? 8 : 5);
    // Resumo curto: título + 1 frase (se houver)
    findings = top.map((h) => {
      const sn = String(h.snippet || '').trim().slice(0, detailed ? 160 : 90);
      return sn ? `${h.title || 'fonte'} — ${sn}` : h.title || h.url || 'fonte';
    });
    sources = top
      .filter((h) => h.url)
      .map((h) => ({ title: h.title || h.url, url: h.url }));
    if (!body) {
      body = top
        .map((h, i) => {
          const sn = String(h.snippet || '').trim().slice(0, 90);
          return sn
            ? `${i + 1}. **${h.title || 'sem título'}** — ${sn}`
            : `${i + 1}. **${h.title || 'sem título'}**`;
        })
        .join('\n');
    }
  }

  let md;
  if (detailed) {
    md = `## ${title}\n\n`;
    if (body) md += `${body}\n\n`;
    if (findings.length) {
      md += '### Achados\n';
      for (const f of findings.slice(0, 12)) {
        if (typeof f === 'string') md += `- ${f}\n`;
        else if (f && (f.text || f.achado)) md += `- ${f.text || f.achado}\n`;
      }
      md += '\n';
    }
    if (sources.length) {
      md += '### Fontes\n';
      for (const s of sources.slice(0, 10)) {
        if (typeof s === 'string') md += `- ${s}\n`;
        else if (s && (s.url || s.link)) {
          md += `- ${s.title || s.url}: ${s.url || s.link}\n`;
        }
      }
    }
  } else {
    // Padrão WA: curto e legível
    const bullets = (findings.length ? findings : body.split('\n').filter(Boolean))
      .slice(0, 5)
      .map((f) => {
        const t = typeof f === 'string' ? f : f.text || f.achado || '';
        return `• ${String(t).replace(/\*\*/g, '').slice(0, 140)}`;
      });
    md = `*${title}*\n\n${bullets.join('\n') || 'Sem achados úteis.'}\n\n_Quer fontes ou mais detalhe?_`;
  }
  md = md.trim();
  if (md.length < 12) {
    return {
      tipo: 'research_write_report',
      ok: false,
      erro: 'Relatório vazio — passe body/findings/sources'
    };
  }

  const texto = md.slice(0, detailed ? 3500 : 1200);
  let saved = false;
  const projectId = acao.project || acao.project_id || acao.projeto || null;
  if (projectId && ctx?.userId) {
    try {
      const { upsertProjectMemory } = require('../../memory/projects');
      await upsertProjectMemory(ctx.userId, {
        project_id: String(projectId),
        nota: `Research: ${title}`.slice(0, 200),
        extras: {
          last_research_report: {
            title,
            at: new Date().toISOString(),
            preview: texto.slice(0, 500)
          }
        }
      });
      saved = true;
    } catch (_) {
      /* optional */
    }
  }

  return {
    tipo: 'research_write_report',
    ok: true,
    title,
    texto,
    chars: texto.length,
    saved,
    project: projectId || null
  };
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
      tag: 'jarvis.research',
      event: 'tool',
      tipo,
      query: acao.query || acao.q || null,
      url: acao.url || null,
      userId: ctx.userId
    })
  );

  if (tipo === 'research_web_search') {
    acao._ctx = ctx;
    return handleWebSearch(acao);
  }
  if (tipo === 'research_fetch_url') return handleFetchUrl(acao);
  if (tipo === 'research_write_report') return handleWriteReport(acao, ctx);
  return null;
}

module.exports = { handle, TYPES };
