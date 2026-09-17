/** Dump recent Jarvis/WhatsApp chat history for review. */
require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  const sessoes = await pool.query(`
    SELECT phone, user_id, conversa_id, atualizado_em
    FROM whatsapp_sessoes
    ORDER BY atualizado_em DESC NULLS LAST
    LIMIT 20
  `).catch((e) => ({ rows: [], error: e.message }));

  console.log('=== WHATSAPP SESSOES ===');
  console.log(JSON.stringify(sessoes.rows || sessoes, null, 2));
  if (sessoes.error) console.log('err', sessoes.error);

  const conversas = await pool.query(`
    SELECT id, user_id, titulo, criado_em, atualizado_em
    FROM assist_conversas
    ORDER BY atualizado_em DESC NULLS LAST
    LIMIT 15
  `);
  console.log('\n=== CONVERSAS RECENTES ===');
  for (const c of conversas.rows) {
    console.log(`\n--- ${c.id.slice(0, 8)} | ${c.titulo || '(sem título)'} | ${c.atualizado_em} ---`);
    const msgs = await pool.query(`
      SELECT role, content, criado_em
      FROM assist_mensagens
      WHERE conversa_id = $1 AND role IN ('user','assistant')
      ORDER BY criado_em ASC, id ASC
      LIMIT 40
    `, [c.id]);
    for (const m of msgs.rows) {
      const t = String(m.content || '').replace(/\s+/g, ' ').trim();
      console.log(`[${m.role}] ${t.slice(0, 500)}`);
    }
  }

  const waConvIds = (sessoes.rows || []).map((s) => s.conversa_id).filter(Boolean);
  if (waConvIds.length) {
    console.log('\n=== SO WHATSAPP (últimas msgs) ===');
    const msgs = await pool.query(`
      SELECT m.role, m.content, m.criado_em, m.conversa_id
      FROM assist_mensagens m
      WHERE m.conversa_id = ANY($1::text[])
        AND m.role IN ('user','assistant')
      ORDER BY m.criado_em DESC
      LIMIT 80
    `, [waConvIds]);
    for (const m of msgs.rows.reverse()) {
      const t = String(m.content || '').replace(/\s+/g, ' ').trim();
      console.log(`${m.criado_em} [${m.role}] ${t.slice(0, 400)}`);
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
