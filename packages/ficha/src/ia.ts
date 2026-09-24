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

export type MotivoDescarte = "sem_evidencia" | "evidencia_nao_encontrada" | "valor_incoerente_com_evidencia";

export interface ResultadoSugestao {
  /** Sugestões aptas a ir para a tela de revisão humana. */
  sugestoes: CampoSugerido[];
  /** Valores descartados antes da revisão humana, com o motivo. */
  descartados: { caminho: string; valor: unknown; evidencia?: string; motivo: MotivoDescarte }[];
}

function ehFolhaSugerida(no: unknown): no is { valor: unknown; evidencia: unknown } {
  return (
    no !== null && typeof no === "object" && "valor" in no && "evidencia" in no && Object.keys(no).length === 2
  );
}

function vazio(valor: unknown): boolean {
  if (typeof valor === "string") return /^\s*(null|none|n\/a)?\s*$/i.test(valor); // modelos às vezes escrevem "null" como texto
  return valor === null || valor === undefined || (Array.isArray(valor) && valor.length === 0);
}

/** Minúsculas, sem pontuação e com espaços simples: base da comparação entre evidência e relato. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * A evidência está no relato? Aceita a citação literal (após normalização) ou, para tolerar
 * pequenas variações do modelo, que ao menos 90% das palavras significativas estejam no relato.
 */
export function evidenciaPresente(evidencia: string, textoFonte: string): boolean {
  const e = normalizar(evidencia);
  const t = normalizar(textoFonte);
  if (!e) return false;
  if (t.includes(e)) return true;
  const palavrasTexto = new Set(t.split(" "));
  const significativas = e.split(" ").filter((p) => p.length > 2);
  if (significativas.length === 0) return false;
  const presentes = significativas.filter((p) => palavrasTexto.has(p)).length;
  return presentes / significativas.length >= 0.9;
}

/**
 * Localiza a evidência no relato e devolve a forma encontrada, ou null. Modelos pequenos às vezes
 * embrulham a citação ("Relato do acadêmico: 'toma losartana'"); o rótulo e as aspas são removidos
 * antes de uma segunda tentativa. A citação continua precisando estar no relato.
 */
export function localizarEvidencia(evidencia: string, textoFonte: string): string | null {
  const semAspas = (t: string) => t.trim().replace(/^["'“”‘’]+|["'“”‘’]+[.]?$/gu, "").trim();
  const citada = semAspas(evidencia);
  if (evidenciaPresente(citada, textoFonte)) return citada;
  const semRotulo = semAspas(citada.replace(/^[\p{L}\s]{1,40}:\s*/u, "")).replace(/\.$/, "");
  return semRotulo && semRotulo !== citada && evidenciaPresente(semRotulo, textoFonte) ? semRotulo : null;
}

const NEGACOES = ["nega", "negou", "nao", "nunca", "sem", "nenhum", "nenhuma"];
const semAcentos = (texto: string) => texto.normalize("NFD").replace(/\p{M}/gu, "");
/** Radical aproximado: ignora plural e gênero ("respiratória" ~ "respiratório", "alergias" ~ "alergia"). */
const radical = (palavra: string) => palavra.replace(/s$/, "").replace(/[aoe]$/, "");

/**
 * Para valores em texto, o conteúdo sugerido precisa estar apoiado na evidência: alguma palavra
 * significativa do valor deve aparecer no trecho citado. Um valor de negação ("Nega.") exige que a
 * evidência contenha uma negação. Evita, por exemplo, "nega" com a evidência "alergia a dipirona".
 * Valores não textuais (opções, números, sim/não) ficam para a revisão humana.
 */
export function valorCoerente(valor: unknown, evidencia: string): boolean {
  if (typeof valor !== "string") return true;
  const palavrasValor = semAcentos(normalizar(valor)).split(" ").filter(Boolean);
  const palavrasEvidencia = semAcentos(normalizar(evidencia)).split(" ");
  if (palavrasValor[0] && NEGACOES.includes(palavrasValor[0]) && palavrasValor.length <= 2) {
    return NEGACOES.some((n) => palavrasEvidencia.includes(n));
  }
  const radicaisEvidencia = new Set(palavrasEvidencia.map(radical));
  const significativas = palavrasValor.filter((p) => p.length > 3 && !NEGACOES.includes(p));
  if (significativas.length === 0) return true;
  return significativas.some((p) => radicaisEvidencia.has(radical(p)));
}

/**
 * Converte a saída do modelo ({campo: {valor, evidencia}}) em uma lista de sugestões.
 * Campos não mencionados (valor nulo) são ignorados. São descartados os valores sem evidência
 * e, quando o texto de origem é informado, aqueles cuja evidência não aparece no relato.
 * A sugestão leva a evidência na forma localizada no relato (sem rótulo nem aspas).
 * Nada aqui grava na ficha: a gravação só ocorre após o aceite humano na interface.
 */
export function extrairSugestoes(saidaModelo: unknown, secao: string, textoFonte?: string): ResultadoSugestao {
  const resultado: ResultadoSugestao = { sugestoes: [], descartados: [] };

  const visitar = (no: unknown, caminho: string) => {
    if (ehFolhaSugerida(no)) {
      if (vazio(no.valor)) return;
      const citada = typeof no.evidencia === "string" && !vazio(no.evidencia) ? no.evidencia.trim() : "";
      if (!citada) {
        resultado.descartados.push({ caminho, valor: no.valor, motivo: "sem_evidencia" });
        return;
      }
      const evidencia = textoFonte === undefined ? citada : localizarEvidencia(citada, textoFonte);
      if (!evidencia)
        resultado.descartados.push({ caminho, valor: no.valor, evidencia: citada, motivo: "evidencia_nao_encontrada" });
      else if (!valorCoerente(no.valor, evidencia))
        resultado.descartados.push({ caminho, valor: no.valor, evidencia, motivo: "valor_incoerente_com_evidencia" });
      else resultado.sugestoes.push({ caminho, valor: no.valor, evidencia });
      return;
    }
    if (no !== null && typeof no === "object") {
      for (const [chave, filho] of Object.entries(no)) visitar(filho, `${caminho}.${chave}`);
    }
  };
  visitar(saidaModelo, secao);
  return resultado;
}
