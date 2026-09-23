import { lerCaminho, listarCampos, type TipoDocumento } from "./esquemas";

export interface Completude {
  preenchidos: number;
  total: number;
  /** Proporção de 0 a 1. */
  fracao: number;
  faltantes: string[];
}

function preenchido(valor: unknown): boolean {
  if (valor === null || valor === undefined) return false;
  if (typeof valor === "string") return valor.trim() !== "";
  if (Array.isArray(valor)) return valor.length > 0;
  return true;
}

/**
 * Indicador de qualidade dos dados (seção 4.8.3 do TCC): proporção dos campos
 * marcados com x-obrigatorio que estão preenchidos.
 */
export function completude(tipo: TipoDocumento, documento: unknown): Completude {
  const obrigatorios = listarCampos(tipo).filter((c) => c.obrigatorio);
  const faltantes = obrigatorios.filter((c) => !preenchido(lerCaminho(documento, c.caminho))).map((c) => c.caminho);
  const total = obrigatorios.length;
  const preenchidos = total - faltantes.length;
  return { preenchidos, total, fracao: total ? preenchidos / total : 1, faltantes };
}
