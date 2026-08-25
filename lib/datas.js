const TZ = process.env.TZ || 'America/Sao_Paulo';

function hojeStr(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: TZ });
}

function ymAtual(date = new Date()) {
  return hojeStr(date).slice(0, 7);
}

function diaDoMes(date = new Date()) {
  return Number(hojeStr(date).slice(8, 10));
}

function diaSemana(date = new Date()) {
  const nome = date.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' });
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[nome] ?? date.getDay();
}

function addDias(n, date = new Date()) {
  return hojeStr(new Date(date.getTime() + n * 86400000));
}

function ymdDe(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-CA', { timeZone: TZ });
    }
    return String(value).slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // node-pg DATE: em geral midnight UTC (00:00Z). Com timezone SP no parse, 03:00Z.
    // UTC midnight → calendário UTC; senão → calendário de São Paulo.
    if (value.getUTCHours() === 0 && value.getUTCMinutes() === 0) {
      return value.toISOString().slice(0, 10);
    }
    return value.toLocaleDateString('en-CA', { timeZone: TZ });
  }
  return String(value).slice(0, 10);
}

/** Data civil de uma transação Pluggy (sempre America/Sao_Paulo). */
function dataTxPluggy(t, fallback = null) {
  const raw = (t && (t.date || t.datePosted)) || '';
  if (!raw) return fallback || hojeStr();
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : (fallback || hojeStr());
  }
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

// Meio-dia evita DATE() virar o dia anterior em UTC ou BRT
function dataResetSql(ymd) {
  const dia = ymdDe(ymd) || hojeStr();
  return `${dia} 12:00:00`;
}

function horaAtual(date = new Date()) {
  return date.toLocaleTimeString('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

module.exports = { TZ, hojeStr, ymAtual, diaDoMes, diaSemana, addDias, ymdDe, dataTxPluggy, dataResetSql, horaAtual };
