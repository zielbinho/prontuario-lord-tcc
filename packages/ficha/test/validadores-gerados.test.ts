import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import exemplo from "../exemplos/ficha-inicial.exemplo.json" with { type: "json" };
import { ARQUIVO, gerarCodigo } from "../scripts/gerar-validadores";
import { criarAjv, ESQUEMAS, validar } from "../src";
import { formatos } from "../src/formatos";

describe("validadores pré-compilados (sem new Function, para a CSP da interface)", () => {
  it("o arquivo gerado está atualizado em relação aos esquemas", () => {
    expect(readFileSync(ARQUIVO, "utf-8").replace(/\r\n/g, "\n")).toBe(gerarCodigo());
  });

  it("o código gerado não depende de require nem de avaliação de strings", () => {
    const codigo = readFileSync(ARQUIVO, "utf-8");
    expect(codigo).not.toMatch(/require\(|new Function|\beval\(/);
  });

  it("dão o mesmo resultado que o Ajv de tempo de execução", () => {
    const ajv = criarAjv();
    const invalida = structuredClone(exemplo) as Record<string, any>;
    invalida.questionario_dtm.q16_dor_atual = 11;
    invalida.inventado = true;
    for (const dados of [exemplo, invalida, {}, null]) {
      const referencia = ajv.getSchema(ESQUEMAS["ficha-inicial"].$id as string)!;
      const esperado = referencia(dados) as boolean;
      const r = validar("ficha-inicial", dados);
      expect(r.valido).toBe(esperado);
      expect(r.erros.length).toBe(esperado ? 0 : (referencia.errors ?? []).length);
    }
  });

  it("formato de data confere o calendário", () => {
    expect(["2026-02-28", "2024-02-29", "2000-02-29", "2026-12-31"].every(formatos.date)).toBe(true);
    expect(["2026-02-29", "1900-02-29", "2026-13-01", "2026-04-31", "26-01-01", "2026-1-1"].some(formatos.date)).toBe(false);
  });
});
