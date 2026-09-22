/**
 * Marca projetos com patch local ainda não testado.
 * dev_run_tests executa código do projeto — depois de um dev_apply_patch_local,
 * rodar teste = rodar o patch, então pede SIM de novo (inclusive WA).
 * Arquivo em tmpdir porque as tools rodam em worker (fork) — memória não é compartilhada.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function marksFile() {
  return process.env.JARVIS_PATCH_MARKS_FILE || path.join(os.tmpdir(), 'jarvis-patch-marks.json');
}

function readMarks() {
  try {
    const obj = JSON.parse(fs.readFileSync(marksFile(), 'utf8'));
    return obj && typeof obj === 'object' ? obj : {};
  } catch (_) {
    return {};
  }
}

function writeMarks(marks) {
  try {
    fs.writeFileSync(marksFile(), JSON.stringify(marks), 'utf8');
  } catch (e) {
    console.error('[jarvis.patch-marks] write:', e.message);
  }
}

function markLocalPatch(projectKey) {
  const marks = readMarks();
  marks[String(projectKey)] = Date.now();
  writeMarks(marks);
}

function clearLocalPatch(projectKey) {
  const marks = readMarks();
  if (!(String(projectKey) in marks)) return;
  delete marks[String(projectKey)];
  writeMarks(marks);
}

function hasUntestedLocalPatch(projectKey) {
  return String(projectKey) in readMarks();
}

/** dev_run_tests de projeto com patch local pendente → precisa SIM. */
function runTestsNeedsApproval(acao) {
  if (!acao || acao.tipo !== 'dev_run_tests') return false;
  const { resolveProjectKey } = require('../tools/handlers/dev');
  return hasUntestedLocalPatch(resolveProjectKey(acao) || 'jarvis');
}

module.exports = {
  markLocalPatch,
  clearLocalPatch,
  hasUntestedLocalPatch,
  runTestsNeedsApproval
};
