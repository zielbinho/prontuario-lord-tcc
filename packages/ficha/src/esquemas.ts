import comum from "../schemas/comum.v1.schema.json" with { type: "json" };
import fichaInicial from "../schemas/ficha-inicial.v1.schema.json" with { type: "json" };
import fichaRetorno from "../schemas/ficha-retorno.v1.schema.json" with { type: "json" };
import odontograma from "../schemas/odontograma.v1.schema.json" with { type: "json" };
import paciente from "../schemas/paciente.v1.schema.json" with { type: "json" };

/** Nó de JSON Schema. Mantido genérico: os esquemas são dados, não tipos. */
export type Esquema = { [chave: string]: unknown };

export const ESQUEMAS = {
  comum: comum as Esquema,
  "ficha-inicial": fichaInicial as Esquema,
  "ficha-retorno": fichaRetorno as Esquema,
  odontograma: odontograma as Esquema,
  paciente: paciente as Esquema,
} as const;

export type TipoDocumento = Exclude<keyof typeof ESQUEMAS, "comum">;

/** Palavras-chave próprias usadas nos esquemas (prefixo x-). */
export const PALAVRAS_CHAVE_PROPRIAS = [
  "x-questao",
  "x-captacao",
  "x-somente-humano",
  "x-obrigatorio",
  "x-cifrado",
] as const;

export type FormaCaptacao = "formulario" | "visual" | "ditado";

const porId = new Map<string, Esquema>(
  Object.values(ESQUEMAS).map((e) => [e.$id as string, e]),
);

function resolverPonteiro(documento: Esquema, ponteiro: string): Esquema {
  let atual: unknown = documento;
  for (const parte of ponteiro.split("/").filter(Boolean)) {
    atual = (atual as Esquema)[parte.replace(/~1/g, "/").replace(/~0/g, "~")];
    if (atual === undefined) throw new Error(`Ponteiro inexistente: ${ponteiro}`);
  }
  return atual as Esquema;
}

/**
 * Devolve uma cópia do esquema com todas as referências ($ref) substituídas pelo
 * conteúdo referenciado. Palavras-chave vizinhas ao $ref (title, x-questao etc.)
 * prevalecem sobre as do alvo. Necessário porque o esquema enviado ao modelo de
 * linguagem precisa ser autocontido.
 */
export function resolverReferencias(no: unknown, base: Esquema): unknown {
  if (Array.isArray(no)) return no.map((item) => resolverReferencias(item, base));
  if (no === null || typeof no !== "object") return no;

  const objeto = no as Esquema;
  if (typeof objeto.$ref === "string") {
    const [uri, ponteiro = ""] = objeto.$ref.split("#");
    const documento = uri ? porId.get(uri) : base;
    if (!documento) throw new Error(`Esquema não encontrado: ${uri}`);
    const alvo = resolverReferencias(resolverPonteiro(documento, ponteiro), documento) as Esquema;
    const { $ref: _ignorado, ...vizinhos } = objeto;
    return { ...alvo, ...(resolverReferencias(vizinhos, base) as Esquema) };
  }

  const resultado: Esquema = {};
  for (const [chave, valor] of Object.entries(objeto)) {
    if (chave === "$defs") continue;
    resultado[chave] = resolverReferencias(valor, base);
  }
  return resultado;
}

/** Esquema de um tipo de documento com todas as referências resolvidas. */
export function esquemaResolvido(tipo: TipoDocumento): Esquema {
  const esquema = ESQUEMAS[tipo];
  return resolverReferencias(esquema, esquema) as Esquema;
}

export interface CampoFicha {
  /** Caminho do campo no documento, ex.: "exame_dtm.q44_palpacao_muscular.masseter_corpo.direito" */
  caminho: string;
  secao: string;
  titulo: string;
  questao?: string;
  obrigatorio: boolean;
  somenteHumano: boolean;
  captacao: FormaCaptacao[];
  esquema: Esquema;
}

function ehObjetoComPropriedades(no: Esquema): boolean {
  return typeof no.properties === "object" && no.properties !== null;
}

/**
 * Lista todos os campos-folha de um documento. Serve à interface (montagem do
 * formulário), ao módulo analítico (achatamento em colunas) e aos testes de
 * cobertura da ficha.
 */
export function listarCampos(tipo: TipoDocumento): CampoFicha[] {
  const raiz = esquemaResolvido(tipo);
  const campos: CampoFicha[] = [];
  const secoes = (raiz.properties ?? {}) as Record<string, Esquema>;

  for (const [secao, esquemaSecao] of Object.entries(secoes)) {
    const somenteHumano = esquemaSecao["x-somente-humano"] === true;
    const captacao = (esquemaSecao["x-captacao"] ?? []) as FormaCaptacao[];

    // titulos: títulos dos objetos intermediários (sem o da seção), ex.: ["Dor muscular...", "Masseter no corpo"]
    const visitar = (no: Esquema, caminho: string, titulos: string[], questaoPai?: string) => {
      const questao = (no["x-questao"] as string | undefined) ?? questaoPai;
      const tituloProprio = (no.title as string | undefined) ?? caminho.split(".").pop()!;
      if (ehObjetoComPropriedades(no)) {
        const titulosFilhos = no === esquemaSecao ? titulos : [...titulos, tituloProprio];
        for (const [chave, filho] of Object.entries(no.properties as Record<string, Esquema>)) {
          visitar(filho, `${caminho}.${chave}`, titulosFilhos, questao);
        }
        return;
      }
      campos.push({
        caminho,
        secao,
        titulo: [...titulos, tituloProprio].join(" / "),
        questao,
        obrigatorio: no["x-obrigatorio"] === true,
        somenteHumano,
        captacao,
        esquema: no,
      });
    };
    visitar(esquemaSecao, secao, []);
  }
  return campos;
}

/** Lê um valor pelo caminho com pontos; devolve undefined se algum nível não existir. */
export function lerCaminho(documento: unknown, caminho: string): unknown {
  let atual: unknown = documento;
  for (const parte of caminho.split(".")) {
    if (atual === null || typeof atual !== "object") return undefined;
    atual = (atual as Record<string, unknown>)[parte];
  }
  return atual;
}
