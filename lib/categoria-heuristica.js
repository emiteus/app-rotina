/**
 * Heurísticas óbvias de categoria a partir da descrição do extrato.
 * Usado no sync Open Finance e no backfill de "outros".
 */
const HEURISTICAS = [
  { cat: 'contas_fixas', teste: /hs\s*administradora|consorcio|consórcio/i },
  { cat: 'faturas', teste: /pagamento\s+fatura|fatura\s+cart[aã]o|fatura\s+inter|d[eé]bito\s+autom[aá]tico\s+fatura|saldo\s+em\s+rotativo|credsystem/i },
  { cat: 'saude', teste: /hiperdental|dental|dentista|farmacia|farmácia|drogaria|supley\s+laboratorio|academia\s+saude|saude\s+em\s+movimento/i },
  { cat: 'assinaturas', teste: /apple\.com\/bill|apple\s+com\s+bill|bitwarden|spotify|netflix|crunchyroll|discord|twitch|dm\s*\*?spotify/i },
  { cat: 'projetos', teste: /\bcursor\b|ai\s+powered\s+ide|hetzner|supabase|railway|decodo/i },
  { cat: 'compras', teste: /mercadolivre|mercado\*mercadol|natura\s+co|pagueveloz/i },
  { cat: 'lazer', teste: /bytedance|tiktok|legacy\s+gaming/i },
  { cat: 'iof', teste: /\biof\b/i }
];

function categoriaObvia(descricao) {
  const d = String(descricao || '');
  if (!d) return null;
  for (const h of HEURISTICAS) {
    if (h.teste.test(d)) return h.cat;
  }
  return null;
}

function chaveDeDescricao(desc) {
  return String(desc || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 40) || 'semchave';
}

module.exports = { HEURISTICAS, categoriaObvia, chaveDeDescricao };
