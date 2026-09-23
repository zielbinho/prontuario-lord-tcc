import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { ESQUEMAS, PALAVRAS_CHAVE_PROPRIAS, type Esquema, type TipoDocumento } from "./esquemas";

// ajv-formats é CommonJS; conforme o empacotador, o default vem aninhado
const addFormats = ((addFormatsImport as unknown as { default?: unknown }).default ??
  addFormatsImport) as (ajv: Ajv2020) => Ajv2020;

export interface ResultadoValidacao {
  valido: boolean;
  erros: { caminho: string; mensagem: string }[];
}

/** Cria uma instância do Ajv em modo estrito com todos os esquemas da ficha registrados. */
export function criarAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  addFormats(ajv);
  for (const palavra of PALAVRAS_CHAVE_PROPRIAS) ajv.addKeyword({ keyword: palavra, schemaType: ["string", "boolean", "array"] });
  for (const esquema of Object.values(ESQUEMAS)) ajv.addSchema(esquema);
  return ajv;
}

const ajvPadrao = criarAjv();
const cache = new Map<TipoDocumento, ValidateFunction>();

function traduzirErros(erros: ErrorObject[] | null | undefined): ResultadoValidacao["erros"] {
  return (erros ?? []).map((e) => ({
    caminho: e.instancePath || "/",
    mensagem:
      e.keyword === "additionalProperties"
        ? `campo não previsto na ficha: ${(e.params as { additionalProperty: string }).additionalProperty}`
        : (e.message ?? e.keyword),
  }));
}

export function validar(tipo: TipoDocumento, dados: unknown): ResultadoValidacao {
  let validador = cache.get(tipo);
  if (!validador) {
    validador = ajvPadrao.getSchema(ESQUEMAS[tipo].$id as string)!;
    cache.set(tipo, validador);
  }
  const valido = validador(dados) as boolean;
  return { valido, erros: valido ? [] : traduzirErros(validador.errors) };
}

/** Valida dados contra um esquema avulso (usado para o esquema derivado enviado à IA). */
export function validarContra(esquema: Esquema, dados: unknown): ResultadoValidacao {
  const validador = ajvPadrao.compile(esquema);
  const valido = validador(dados) as boolean;
  return { valido, erros: valido ? [] : traduzirErros(validador.errors) };
}
