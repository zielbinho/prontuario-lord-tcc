import { esquemaResolvido, type Esquema, type FormaCaptacao, type TipoDocumento } from "./esquemas";

/**
 * Salvaguardas do módulo de IA (Capítulo 4 do TCC):
 *  1. seções marcadas com x-somente-humano nunca são convertidas nem enviadas ao modelo;
 *  2. só seções que admitem captação por ditado podem receber sugestões;
 *  3. cada campo sugerido precisa vir acompanhado do trecho da fala que o justifica
 *     (evidência); valores sem evidência são descartados antes de chegar à tela de revisão.
 */
export class SecaoNaoPermitidaParaIA extends Error {
  constructor(secao: string, motivo: string) {
    super(`A seção "${secao}" não pode ser preenchida pela IA: ${motivo}`);
    this.name = "SecaoNaoPermitidaParaIA";
  }
}

const PALAVRAS_MANTIDAS = new Set([
  "type", "enum", "minimum", "maximum", "maxLength", "minLength", "items", "uniqueItems", "pattern", "description",
]);

/** Remove metadados (x-*, title, $id...) e deixa apenas o que restringe o valor. */
function limparFolha(no: Esquema): Esquema {
  const limpo: Esquema = {};
  for (const [chave, valor] of Object.entries(no)) {
    if (PALAVRAS_MANTIDAS.has(chave)) limpo[chave] = valor;
  }
  // "não mencionado" precisa ser representável em qualquer campo
  if (limpo.type === "array") limpo.type = ["array", "null"];
  return limpo;
}

function converter(no: Esquema): Esquema | undefined {
  if (no["x-somente-humano"] === true) return undefined;

  if (no.type === "object" && no.properties) {
    const propriedades: Record<string, Esquema> = {};
    for (const [chave, filho] of Object.entries(no.properties as Record<string, Esquema>)) {
      const convertido = converter(filho);
      if (convertido) propriedades[chave] = convertido;
    }
    return {
      type: "object",
      additionalProperties: false,
      properties: propriedades,
      required: Object.keys(propriedades),
    };
  }

  const titulo = (no.title as string | undefined) ?? "";
  return {
    type: "object",
    additionalProperties: false,
    ...(titulo ? { description: titulo } : {}),
    properties: {
      valor: limparFolha(no),
      evidencia: {
        type: ["string", "null"],
        description: "Trecho literal da transcrição que justifica o valor; null se não mencionado.",
      },
    },
    required: ["valor", "evidencia"],
  };
}

/**
 * Deriva, a partir do esquema da ficha, o esquema de saída que restringe o modelo
 * de linguagem para uma seção. O resultado é autocontido (sem $ref) e cada campo
 * vira { valor, evidencia }.
 */
export function esquemaParaIA(secao: string, tipo: TipoDocumento = "ficha-inicial"): Esquema {
  const raiz = esquemaResolvido(tipo);
  const esquemaSecao = (raiz.properties as Record<string, Esquema> | undefined)?.[secao];
  if (!esquemaSecao) throw new Error(`Seção inexistente em ${tipo}: ${secao}`);
  if (esquemaSecao["x-somente-humano"] === true) {
    throw new SecaoNaoPermitidaParaIA(secao, "seção de decisão clínica, exclusivamente humana");
  }
  const captacao = (esquemaSecao["x-captacao"] ?? []) as FormaCaptacao[];
  if (!captacao.includes("ditado")) {
    throw new SecaoNaoPermitidaParaIA(secao, "a seção não admite captação por ditado");
  }
  return converter(esquemaSecao)!;
}

/** Seções que podem receber sugestões da IA. */
export function secoesPermitidasParaIA(tipo: TipoDocumento = "ficha-inicial"): string[] {
  const raiz = esquemaResolvido(tipo);
  return Object.entries(raiz.properties as Record<string, Esquema>)
    .filter(([, s]) => s["x-somente-humano"] !== true && ((s["x-captacao"] ?? []) as string[]).includes("ditado"))
    .map(([nome]) => nome);
}

export interface CampoSugerido {
  caminho: string;
  valor: unknown;
  evidencia: string;
}

export interface ResultadoSugestao {
  /** Sugestões aptas a ir para a tela de revisão humana. */
  sugestoes: CampoSugerido[];
  /** Valores descartados por não terem trecho de evidência. */
  descartados: { caminho: string; valor: unknown }[];
}

function ehFolhaSugerida(no: unknown): no is { valor: unknown; evidencia: unknown } {
  return (
    no !== null && typeof no === "object" && "valor" in no && "evidencia" in no && Object.keys(no).length === 2
  );
}

function vazio(valor: unknown): boolean {
  return valor === null || valor === undefined || (Array.isArray(valor) && valor.length === 0) || valor === "";
}

/**
 * Converte a saída do modelo ({campo: {valor, evidencia}}) em uma lista de sugestões.
 * Campos não mencionados (valor nulo) são ignorados; valores sem evidência, descartados.
 * Nada aqui grava na ficha: a gravação só ocorre após o aceite humano na interface.
 */
export function extrairSugestoes(saidaModelo: unknown, secao: string): ResultadoSugestao {
  const resultado: ResultadoSugestao = { sugestoes: [], descartados: [] };

  const visitar = (no: unknown, caminho: string) => {
    if (ehFolhaSugerida(no)) {
      if (vazio(no.valor)) return;
      const evidencia = typeof no.evidencia === "string" ? no.evidencia.trim() : "";
      if (evidencia) resultado.sugestoes.push({ caminho, valor: no.valor, evidencia });
      else resultado.descartados.push({ caminho, valor: no.valor });
      return;
    }
    if (no !== null && typeof no === "object") {
      for (const [chave, filho] of Object.entries(no)) visitar(filho, `${caminho}.${chave}`);
    }
  };
  visitar(saidaModelo, secao);
  return resultado;
}
