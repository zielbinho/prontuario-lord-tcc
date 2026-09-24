// Formatos de string usados nos esquemas da ficha. Ficam aqui (e não no ajv-formats) porque os
// validadores pré-compilados (src/gerado) importam este módulo diretamente.

/** Data no formato AAAA-MM-DD, existente no calendário (rejeita 2026-02-30). */
function data(valor: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
  const dias = [31, bissexto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return dia <= dias[mes - 1];
}

export const formatos = { date: data };
