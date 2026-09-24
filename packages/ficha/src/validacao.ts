import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import localizarPtBrImport from "ajv-i18n/localize/pt-BR";
import { ESQUEMAS, PALAVRAS_CHAVE_PROPRIAS, type Esquema, type TipoDocumento } from "./esquemas";
import * as precompilados from "./gerado/validadores";

// ajv-formats é CommonJS; conforme o empacotador, o default vem aninhado
const addFormats = ((addFormatsImport as unknown as { default?: unknown }).default ??
  addFormatsImport) as (ajv: Ajv2020) => Ajv2020;
const localizarPtBr = ((localizarPtBrImport as unknown as { default?: unknown }).default ??
  localizarPtBrImport) as (erros: ErrorObject[]) => void;

export interface ResultadoValidacao {
  valido: boolean;
  erros: { caminho: string; mensagem: string }[];
}

/** Cria uma instância do Ajv em modo estrito com todos os esquemas da ficha registrados. */
export function criarAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  addFormats(ajv);
  for (const palavra of PALAVRAS_CHAVE_PROPRIAS) ajv.addKeyword({ keyword: palavra, schemaType: ["string", "boolean", "array", "object"] });
  for (const esquema of Object.values(ESQUEMAS)) ajv.addSchema(esquema);
  return ajv;
}

// O Ajv de tempo de execução compila esquemas com new Function, o que a CSP da interface proíbe.
// Por isso ele só é criado quando necessário (validarContra, usado apenas no servidor), e os
// esquemas fixos da ficha usam os validadores pré-compilados de src/gerado.
let ajvPadrao: Ajv2020 | undefined;
const ajv = () => (ajvPadrao ??= criarAjv());

function traduzirErros(erros: ErrorObject[] | null | undefined): ResultadoValidacao["erros"] {
  const lista = (erros ?? []).map((e) => ({ ...e }));
  localizarPtBr(lista); // traduz as mensagens do Ajv (ex.: "deve ser <= 10")
  return lista.map((e) => ({
    caminho: e.instancePath || "/",
    mensagem:
      e.keyword === "additionalProperties"
        ? `campo não previsto na ficha: ${(e.params as { additionalProperty: string }).additionalProperty}`
        : (e.message ?? e.keyword),
  }));
}

export function validar(tipo: TipoDocumento, dados: unknown): ResultadoValidacao {
  const validador = (precompilados as unknown as Record<string, ValidateFunction>)[tipo.replace(/-/g, "_")];
  if (!validador) throw new Error(`sem validador pré-compilado para ${tipo}: rode scripts/gerar-validadores.ts`);
  const valido = validador(dados) as boolean;
  return { valido, erros: valido ? [] : traduzirErros(validador.errors) };
}

/** Valida dados contra um esquema avulso (usado para o esquema derivado enviado à IA). */
export function validarContra(esquema: Esquema, dados: unknown): ResultadoValidacao {
  const validador = ajv().compile(esquema);
  const valido = validador(dados) as boolean;
  return { valido, erros: valido ? [] : traduzirErros(validador.errors) };
}
