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
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
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

module.exports = { TZ, hojeStr, ymAtual, diaDoMes, diaSemana, addDias, ymdDe, dataResetSql, horaAtual };
