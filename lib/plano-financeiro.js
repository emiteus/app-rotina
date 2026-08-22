// Plano financeiro real — renda é PISO; variável (cortes/infoproduto) não entra no comprometido.
const PLANO_VERSAO = 3;

const rendaFixa = [
  { nome: 'Laranjeira', valor: 3500, dia: 5 },
  { nome: 'Lucas Tylty', valor: 1000, dia: 10 }
];

const despesas = [
  { titulo: 'Academia', valor: 85.0, dia: 5, categoria: 'saude' },
  { titulo: 'Internet', valor: 75.0, dia: 10, categoria: 'contas_fixas' },
  { titulo: 'Consórcio', valor: 410.04, dia: 10, categoria: 'contas_fixas' },
  { titulo: 'TIM', valor: 43.0, dia: null, categoria: 'assinaturas', aliases: ['Tim', 'TIM Brasil'] },
  { titulo: 'Discord', valor: 24.99, dia: null, categoria: 'assinaturas', aliases: ['Discord Nitro', 'Nitromonthly'] },
  { titulo: 'Twitch', valor: 9.99, dia: null, categoria: 'assinaturas' },
  { titulo: 'Crunchyroll', valor: 19.9, dia: null, categoria: 'assinaturas', aliases: ['Ebn Crunchyroll'] },
  { titulo: 'Netflix', valor: 20.9, dia: null, categoria: 'assinaturas', aliases: ['Netflix.Com'] },
  { titulo: 'Spotify', valor: 23.9, dia: null, categoria: 'assinaturas', aliases: ['Dm Spotify'] },
  { titulo: 'MrPoubel', valor: 53.9, dia: null, categoria: 'assinaturas' },
  { titulo: 'DAS', valor: 85.0, dia: 20, categoria: 'contas_fixas' },
  { titulo: 'Railway', valor: 50.0, dia: null, categoria: 'assinaturas' },
  { titulo: 'Supabase', valor: 180.0, dia: null, categoria: 'assinaturas' },
  { titulo: 'Cursor', valor: 120.0, dia: null, categoria: 'assinaturas', aliases: ['Cursor Ai', 'Ai Powered Ide'] },
  { titulo: 'Google Drive', valor: 9.9, dia: null, categoria: 'assinaturas', aliases: ['Google One'] },
  { titulo: 'Google Drive adicional', valor: 12.5, dia: null, categoria: 'assinaturas', aliases: ['Google One'] },
  { titulo: 'Hetzner', valor: 103.38, dia: null, categoria: 'assinaturas' },
  {
    titulo: 'Empréstimo 10k',
    valor: 1188.65,
    dia: 24,
    categoria: 'contas_fixas',
    aliases: ['Empréstimo']
  },
  { titulo: 'Empréstimo 1.5k', valor: 585.3, dia: 27, categoria: 'contas_fixas' }
];

const cancelados = [
  'Meli+',
  'Água (média)',
  'Água',
  'Assinaturas',
  'Projetos (hospedagem)',
  'Projetos (Discloud/Railway)',
  'Pilates'
];

const emprestimos = [
  { titulo: 'Empréstimo 10k', valor: 1188.65, dia: 24, total: 12, pagas: 2 },
  { titulo: 'Empréstimo 1.5k', valor: 585.3, dia: 27, total: 3, pagas: 0 }
];

const extrasPorMes = {
  '2026-08': [
    { titulo: 'Cartão da mãe', valor: 395.3, dia: 5, categoria: 'outros', pago: true },
    { titulo: 'Fatura cartão', valor: 88.48, dia: 17, categoria: 'outros', aliases: ['Saldo em rotativo', 'Fatura'] },
    { titulo: 'Fatura Inter', valor: 441.02, dia: 18, categoria: 'outros', aliases: ['Pagamento Fatura Inter', 'Fatura Cartão Inter'] }
  ],
  '2026-09': [
    { titulo: 'Cartão da mãe', valor: 506.4, dia: 5, categoria: 'outros' }
  ]
};

const pagosPorMes = {
  '2026-08': ['Academia', 'Consórcio', 'Cartão da mãe']
};

const rendaPiso = rendaFixa.reduce((s, r) => s + r.valor, 0);

function itensDoMes(ym) {
  return [...despesas, ...(extrasPorMes[ym] || [])];
}

function comprometidoMensal() {
  return Math.round(despesas.reduce((s, d) => s + d.valor, 0) * 100) / 100;
}

module.exports = {
  PLANO_VERSAO,
  rendaFixa,
  rendaPiso,
  despesas,
  cancelados,
  emprestimos,
  extrasPorMes,
  pagosPorMes,
  itensDoMes,
  comprometidoMensal
};
