/**
 * Cérebro do Jarvis (06/10/2026): quanto ele já aprendeu, por área. Alimenta o cérebro dourado do app do PC
 * (orbe, janela e tela cheia): cada área cresce com o aprendizado real daquela categoria.
 * Só contagens — nenhum conteúdo sai daqui.
 */
const { get } = require('../host').requireLib('db');

// Peso de cada aprendizado (o mesmo do protótipo aprovado pelo Mateus)
const AREAS = [
  { id: 'pessoal', nome: 'Memória pessoal' },
  { id: 'experiencia', nome: 'Experiência' },
  { id: 'projetos', nome: 'Projetos' },
  { id: 'habilidades', nome: 'Habilidades' },
  { id: 'conversas', nome: 'Conversas' },
  { id: 'confianca', nome: 'Confiança' }
];

const CACHE_MS = 30 * 1000;
const cache = new Map(); // userId -> { at, valor }

/** Conta com um SELECT; tabela que ainda não existe (feature nunca usada) conta 0. */
async function contar(sql, params) {
  try {
    const r = await get(sql, params);
    return Number((r && r.n) || 0);
  } catch {
    return 0;
  }
}

async function medir(userId) {
  const [fatos, notas, licoesOk, licoesAbertas, projetos, mensagens, regras] = await Promise.all([
    contar(`SELECT count(*)::int n FROM jarvis_facts WHERE user_id = $1 AND ativo = true`, [userId]),
    contar(
      `SELECT COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(extras->'notas') = 'array' THEN extras->'notas' END), 0)::int n
         FROM jarvis_prefs WHERE user_id = $1`,
      [userId]
    ),
    contar(`SELECT count(*)::int n FROM jarvis_lessons WHERE user_id = $1 AND resolved_at IS NOT NULL AND ignored = false`, [userId]),
    contar(`SELECT count(*)::int n FROM jarvis_lessons WHERE user_id = $1 AND resolved_at IS NULL AND ignored = false`, [userId]),
    contar(`SELECT count(*)::int n FROM jarvis_project_memory WHERE user_id = $1`, [userId]),
    contar(
      `SELECT count(*)::int n FROM assist_mensagens m JOIN assist_conversas c ON c.id = m.conversa_id WHERE c.user_id = $1`,
      [userId]
    ),
    contar(`SELECT count(*)::int n FROM jarvis_approval_rules WHERE user_id = $1 AND ativo = true`, [userId])
  ]);
  const ferramentas = Object.keys(require('../tools/definitions').TOOL_DEFS).length;
  const valor = {
    pessoal: fatos * 6 + notas * 4,
    experiencia: licoesOk * 10 + licoesAbertas * 2,
    projetos: projetos * 8,
    habilidades: ferramentas,
    conversas: Math.floor(mensagens / 10),
    confianca: regras * 3
  };
  const detalhe = {
    pessoal: `${fatos} fatos aprendidos sozinho + ${notas} "lembra que"`,
    experiencia: `${licoesOk} lições resolvidas + ${licoesAbertas} erros em estudo`,
    projetos: `${projetos} memórias de projeto`,
    habilidades: `${ferramentas} ferramentas que ele sabe usar`,
    conversas: `${mensagens} mensagens trocadas`,
    confianca: regras ? `${regras} regras "sempre sim / não"` : 'nenhuma regra "sempre sim / não" ainda'
  };
  const areas = AREAS.map((a) => ({ id: a.id, nome: a.nome, valor: valor[a.id], detalhe: detalhe[a.id] }));
  return { areas, total: areas.reduce((s, a) => s + a.valor, 0), em: new Date().toISOString() };
}

/** @returns {Promise<{ areas: Array<{id,nome,valor,detalhe}>, total: number, em: string }>} */
async function cerebroDoUsuario(userId, { agora = Date.now() } = {}) {
  if (!userId) throw new Error('sem usuário');
  const c = cache.get(userId);
  if (c && agora - c.at < CACHE_MS) return c.valor;
  const valor = await medir(userId);
  cache.set(userId, { at: agora, valor });
  return valor;
}

module.exports = { cerebroDoUsuario, AREAS, _limpar: () => cache.clear() };
