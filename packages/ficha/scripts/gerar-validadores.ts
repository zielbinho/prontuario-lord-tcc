// Gera os validadores pré-compilados dos esquemas (src/gerado/validadores.ts).
//
// O Ajv, por padrão, compila cada esquema em tempo de execução com new Function. No navegador,
// a Content-Security-Policy da implantação (script-src 'self') proíbe isso, com razão; por isso a
// interface usa estes validadores, gerados em código comum. Rode depois de alterar um esquema:
//   npx tsx scripts/gerar-validadores.ts        (em packages/ficha)
// Um teste falha se o arquivo gerado estiver desatualizado.
import { _ } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import standaloneImport from "ajv/dist/standalone/index.js";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESQUEMAS, PALAVRAS_CHAVE_PROPRIAS } from "../src/esquemas";
import { formatos } from "../src/formatos";

const standaloneCode = ((standaloneImport as unknown as { default?: unknown }).default ?? standaloneImport) as (
  ajv: Ajv2020, refs: Record<string, string>) => string;

export const ARQUIVO = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "gerado", "validadores.ts");

/** Nome exportado de cada tipo de documento (ex.: "ficha-inicial" → ficha_inicial). */
export const nomeExportado = (tipo: string) => tipo.replace(/-/g, "_");

export function gerarCodigo(): string {
  const ajv = new Ajv2020({
    allErrors: true, strict: true, allowUnionTypes: true,
    // o código gerado referencia "formatosLord", importado no cabeçalho abaixo
    code: { source: true, esm: true, formats: _`formatosLord` },
  });
  for (const [nome, validar] of Object.entries(formatos)) ajv.addFormat(nome, validar);
  for (const palavra of PALAVRAS_CHAVE_PROPRIAS) ajv.addKeyword({ keyword: palavra, schemaType: ["string", "boolean", "array", "object"] });
  for (const esquema of Object.values(ESQUEMAS)) ajv.addSchema(esquema);
  const refs = Object.fromEntries(Object.entries(ESQUEMAS).map(([tipo, e]) => [nomeExportado(tipo), e.$id as string]));
  let codigo = standaloneCode(ajv, refs);
  // Mesmo com esm: true, o Ajv referencia suas funções auxiliares com require(); no navegador
  // não existe require, então cada uma vira um import (com a interoperabilidade CommonJS).
  const auxiliares = [...new Set([...codigo.matchAll(/require\("ajv\/dist\/runtime\/(\w+)"\)\.default/g)].map((m) => m[1]))];
  const importacoes = auxiliares.flatMap((nome) => [
    `import * as ${nome}Modulo from "ajv/dist/runtime/${nome}.js";`,
    `const ${nome}Aux = ${nome}Modulo.default?.default ?? ${nome}Modulo.default ?? ${nome}Modulo;`,
  ]);
  for (const nome of auxiliares) codigo = codigo.replaceAll(`require("ajv/dist/runtime/${nome}").default`, `${nome}Aux`);
  if (codigo.includes("require(")) throw new Error("o código gerado ainda usa require()");
  return [
    "// @ts-nocheck",
    "// GERADO por scripts/gerar-validadores.ts a partir de schemas/*.json. Não edite à mão.",
    'import { formatos as formatosLord } from "../formatos";',
    ...importacoes,
    codigo,
  ].join("\n") + "\n";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(ARQUIVO, gerarCodigo(), "utf-8");
  console.log(`Validadores gerados em ${ARQUIVO}`);
}
