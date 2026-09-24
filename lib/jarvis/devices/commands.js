/**
 * Comandos NL de dispositivos (Fase 2 e 5.5):
 * "parear pc" · "parear celular" · "meus dispositivos" · "desconecta o dispositivo ab12"
 */
const store = require('./store');

// Página do Jarvis no celular (servida pelo host)
const PHONE_URL = `${String(process.env.JARVIS_PUBLIC_URL || 'https://app-rotina-production-f84e.up.railway.app').replace(/\/+$/, '')}/jarvis/`;

function parseDeviceCommand(mensagem) {
  const t = String(mensagem || '').trim();
  if (/^(parear|pareia|conectar|conecta|liga[r]?)\s+(o\s+|um\s+|meu\s+)?(pc|computador|desktop|notebook)\s*[!.]*$/i.test(t)) {
    return { cmd: 'pair' };
  }
  if (/^(parear|pareia|conectar|conecta|liga[r]?)\s+(o\s+|um\s+|meu\s+)?(celular|iphone|telefone|smartphone|cel)\s*[!.]*$/i.test(t)) {
    return { cmd: 'pair', phone: true };
  }
  if (/^(lista(r)?\s+)?(meus\s+)?(dispositivos|aparelhos|pcs)\s*[?!.]*$/i.test(t)) {
    return { cmd: 'list' };
  }
  const m = t.match(/^(desconecta|revoga|remove|desparear)\s+(o\s+)?(dispositivo|aparelho|pc|celular)\s+#?((?:dev_)?[a-f0-9]{4,10})\s*[!.]*$/i);
  if (m) return { cmd: 'revoke', id: m[4] };
  return null;
}

async function tryHandleDeviceCommand(userId, mensagem) {
  const parsed = parseDeviceCommand(mensagem);
  if (!parsed) return null;

  if (parsed.cmd === 'pair') {
    const { code } = await store.createPairCode(userId);
    if (parsed.phone) {
      return {
        handled: true,
        resposta:
          `Código pro celular: **${code}**\n` +
          `1. Abre ${PHONE_URL} no Safari do iPhone.\n` +
          `2. Compartilhar → **Adicionar à Tela de Início** e abre o Jarvis por lá.\n` +
          `3. Digita esse código. Vale por 10 minutos e só uma vez.`
      };
    }
    return {
      handled: true,
      resposta:
        `Código de pareamento: **${code}**\n` +
        `Vale por 10 minutos e só uma vez. Abre o Jarvis Desktop no PC e digita esse código.\n` +
        `Pedir outro código cancela este.`
    };
  }

  if (parsed.cmd === 'list') {
    const list = await store.listDevices(userId);
    let online = [];
    try {
      online = require('./gateway').onlineDeviceIds(userId);
    } catch (_) {
      /* gateway não carregado (worker/teste) */
    }
    if (!list.length) {
      return { handled: true, resposta: 'Nenhum dispositivo pareado. Manda **parear pc** ou **parear celular** pra conectar um.' };
    }
    const lines = list.map(
      (d) =>
        `• \`${d.id.replace(/^dev_/, '')}\` **${d.name}** (${d.kind === 'phone' ? 'celular' : 'PC'}) — ${online.includes(d.id) ? 'online' : 'offline'}`
    );
    return {
      handled: true,
      resposta: `Dispositivos:\n${lines.join('\n')}\n\nPra tirar o acesso: **desconecta o dispositivo <id>**.`
    };
  }

  if (parsed.cmd === 'revoke') {
    const d = await store.revokeDevice(userId, parsed.id);
    if (!d) return { handled: true, resposta: `Não achei dispositivo **${parsed.id}**.` };
    try {
      require('./gateway').disconnectDevice(d.id);
    } catch (_) {
      /* ignore */
    }
    return {
      handled: true,
      resposta: `Pronto: **${d.name}** perdeu o acesso e foi desconectado. Pra usar de novo, precisa parear.`
    };
  }
  return null;
}

module.exports = { parseDeviceCommand, tryHandleDeviceCommand };
