/** Nome amigável do banco (nunca "MeuPluggy" na UI). */
function nomeBancoDisplay({ apelido, connector_nome, pessoa, contasNomes } = {}) {
  const atual = String(apelido || '').trim();
  if (atual && !/meu\s*pluggy/i.test(atual)) return atual;

  const conn = String(connector_nome || '');
  const contas = Array.isArray(contasNomes) ? contasNomes.join(' ') : String(contasNomes || '');
  const blob = `${conn} ${contas}`.toLowerCase();
  const ehPJ = pessoa === 'PJ';

  if (/nu pagamentos|nubank|\bgold\b/.test(blob) || /nu|nubank/i.test(conn)) {
    return 'Nubank';
  }
  if (/inter/i.test(conn) || /inter/i.test(atual)) {
    return ehPJ ? 'Inter empresas' : 'Inter';
  }
  if (/meu\s*pluggy/i.test(conn) || /meu\s*pluggy/i.test(atual)) {
    // MeuPluggy: infere pelo nome das contas
    if (/nu pagamentos|nubank|\bgold\b/.test(blob)) return 'Nubank';
    return ehPJ ? 'Inter empresas' : 'Inter';
  }
  if (conn) return ehPJ ? `${conn} · PJ` : conn;
  return ehPJ ? 'Empresa (PJ)' : 'Banco';
}

function labelContaExtrato(c) {
  const banco = c.banco || nomeBancoDisplay(c);
  if (c.tipo === 'CREDIT') return `${banco} · Cartão`;
  if (c.pessoa === 'PJ' && !/empresas|\bpj\b/i.test(banco)) return `${banco} · PJ`;
  return banco;
}

module.exports = { nomeBancoDisplay, labelContaExtrato };
