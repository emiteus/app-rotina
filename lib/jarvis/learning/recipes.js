/**
 * Receitas (Fase 1 MCU) — missão concluída sem erro vira sequência reutilizável
 * de tools que já existem (nunca código novo). Objetivo parecido + mesmos projetos
 * → o planner monta a missão pela receita. Nada executa sem "executa missão".
 */
const crypto = require('crypto');
const { get, run, all } = require('../host').requireLib('db');

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = (async () => {
      await run(`
        CREATE TABLE IF NOT EXISTS jarvis_recipes (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          name TEXT NOT NULL,
          goal TEXT NOT NULL,
          projects TEXT[] NOT NULL DEFAULT '{}',
          steps JSONB NOT NULL,
          uses INT NOT NULL DEFAULT 1,
          source_mission_id TEXT,
          criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (user_id, fingerprint)
        )
      `);
    })().catch((e) => {
      tableReady = null;
      throw e;
    });
  }
  return tableReady;
}

const STOP = new Set([
  'de', 'do', 'da', 'dos', 'das', 'o', 'a', 'os', 'as', 'um', 'uma', 'e', 'em', 'no', 'na',
  'nos', 'nas', 'pra', 'pro', 'para', 'por', 'com', 'que', 'meu', 'minha', 'me', 'se',
  'jarvis', 'missao', 'plano', 'pfv', 'favor', 'agora', 'hoje'
]);

function goalTokens(goal) {
  return [
    ...new Set(
      String(goal || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3 && !STOP.has(t))
    )
  ].sort();
}

function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

function projectsOf(goal) {
  try {
    return [...new Set(require('../projects/registry').resolveProjectsFromMessage(goal) || [])].sort();
  } catch {
    return [];
  }
}

/** Passos reutilizáveis: só tool steps, sem resultado/estado da execução anterior. */
function stepsFromMission(mission) {
  return (mission.steps || [])
    .filter((s) => s && s.tipo)
    .map((s) => {
      const args = { ...(s.args || {}) };
      delete args.description;
      delete args._ctx;
      return { tipo: s.tipo, description: s.description || s.tipo, args };
    });
}

function fingerprintOf(steps, projects, tokens) {
  return crypto
    .createHash('sha1')
    .update(`${steps.map((s) => s.tipo).join('>')}|${projects.join(',')}|${tokens.join(' ')}`)
    .digest('hex')
    .slice(0, 16);
}

/** Missão concluída 100% ok → receita (ou +1 uso se já existe). */
async function saveRecipeFromMission(userId, mission) {
  if (!userId || !mission || mission.status !== 'done') return null;
  const all_ = mission.steps || [];
  if (!all_.length || all_.some((s) => s.status !== 'done')) return null;
  // passo que "concluiu" via SIM de outro pedido/erro incerto não conta como caminho provado
  if (all_.some((s) => s.result && (s.result.uncertain || s.result.ok === false))) return null;
  const steps = stepsFromMission(mission);
  if (!steps.length) return null;

  await ensureTable();
  const projects = projectsOf(mission.goal);
  const tokens = goalTokens(mission.goal);
  const fp = fingerprintOf(steps, projects, tokens);
  const row = await get(
    `INSERT INTO jarvis_recipes (id, user_id, fingerprint, name, goal, projects, steps, source_mission_id)
     VALUES ($1,$2,$3,$4,$5,$6::text[],$7::jsonb,$8)
     ON CONFLICT (user_id, fingerprint) DO UPDATE SET
       uses = jarvis_recipes.uses + 1,
       steps = EXCLUDED.steps,
       last_used = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      fp,
      userId,
      fp,
      String(mission.goal || '').slice(0, 60),
      String(mission.goal || '').slice(0, 300),
      projects,
      JSON.stringify(steps),
      mission.id || null
    ]
  );
  console.log(
    JSON.stringify({ tag: 'jarvis.recipe', event: 'saved', userId, id: fp, uses: row && row.uses })
  );
  return row ? hydrate(row) : null;
}

function hydrate(row) {
  const steps = Array.isArray(row.steps) ? row.steps : JSON.parse(row.steps || '[]');
  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    projects: row.projects || [],
    steps,
    uses: Number(row.uses) || 1,
    last_used: row.last_used
  };
}

/**
 * Receita pra um objetivo novo: mesmos projetos (senão os args apontariam pro projeto errado)
 * e palavras do objetivo parecidas (Jaccard ≥ 0.5).
 */
async function findRecipeForGoal(userId, goal, { minScore = 0.5 } = {}) {
  if (!userId || !goal) return null;
  await ensureTable();
  const projects = projectsOf(goal);
  const tokens = goalTokens(goal);
  if (!tokens.length) return null;
  const rows = await all(
    `SELECT * FROM jarvis_recipes WHERE user_id = $1 ORDER BY last_used DESC LIMIT 50`,
    [userId]
  );
  let best = null;
  for (const r of (rows || []).map(hydrate)) {
    if ([...r.projects].sort().join(',') !== projects.join(',')) continue;
    const score = jaccard(tokens, goalTokens(r.goal));
    if (score < minScore) continue;
    if (!best || score > best.score || (score === best.score && r.uses > best.recipe.uses)) {
      best = { recipe: r, score };
    }
  }
  return best ? { ...best.recipe, score: Math.round(best.score * 100) / 100 } : null;
}

async function listRecipes(userId, limit = 10) {
  await ensureTable();
  const rows = await all(
    `SELECT * FROM jarvis_recipes WHERE user_id = $1 ORDER BY uses DESC, last_used DESC LIMIT $2`,
    [userId, limit]
  );
  return (rows || []).map(hydrate);
}

async function deleteRecipe(userId, idPrefix) {
  await ensureTable();
  const prefix = String(idPrefix || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  if (prefix.length < 4) return null;
  const row = await get(
    `DELETE FROM jarvis_recipes
     WHERE id = (SELECT id FROM jarvis_recipes WHERE user_id = $1 AND id LIKE $2 ORDER BY last_used DESC LIMIT 1)
     RETURNING *`,
    [userId, `${prefix}%`]
  );
  return row ? hydrate(row) : null;
}

module.exports = {
  ensureTable,
  goalTokens,
  jaccard,
  stepsFromMission,
  saveRecipeFromMission,
  findRecipeForGoal,
  listRecipes,
  deleteRecipe
};
