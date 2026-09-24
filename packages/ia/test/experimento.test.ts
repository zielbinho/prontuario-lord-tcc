import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aplicarSalvaguardas, calcularMetricas, compararCampo, lerExecucoes, similaridadeTexto } from "../scripts/experimento-a";

describe("comparação de campos do Experimento A", () => {
  it("classifica acerto, alucinação, omissão e valor errado", () => {
    expect(compararCampo("a", false, true, true).classe).toBe("VP");
    expect(compararCampo("a", false, null, null).classe).toBe("VN");
    expect(compararCampo("a", false, [], null).classe).toBe("VN");
    expect(compararCampo("a", false, null, "dura").classe).toBe("FP"); // alucinação
    expect(compararCampo("a", false, true, null).classe).toBe("FN"); // omissão
    expect(compararCampo("a", false, true, false).classe).toBe("ERRO_VALOR");
  });

  it("listas são comparadas como conjuntos", () => {
    expect(compararCampo("a", false, ["cardiaca", "neurologica"], ["neurologica", "cardiaca"]).classe).toBe("VP");
    expect(compararCampo("a", false, ["cardiaca"], ["cardiaca", "respiratoria"]).classe).toBe("ERRO_VALOR");
  });

  it("texto usa similaridade de palavras, sem acento e sem maiúsculas", () => {
    expect(similaridadeTexto("Losartana 50 mg, há dois anos.", "losartana 50 mg ha dois anos")).toBe(1);
    expect(compararCampo("a", true, "Dipirona.", "dipirona").classe).toBe("VP");
    expect(compararCampo("a", true, "Apendicectomia em 2015.", "Tirou o apêndice em 2015").classe).toBe("ERRO_VALOR");
  });
});

describe("métricas", () => {
  it("valor errado conta contra precisão e revocação; alucinação e omissão têm denominadores próprios", () => {
    const m = calcularMetricas([
      compararCampo("1", false, true, true), // VP
      compararCampo("2", false, true, true), // VP
      compararCampo("3", false, true, false), // erro de valor
      compararCampo("4", false, true, null), // FN
      compararCampo("5", false, null, "x"), // FP
      compararCampo("6", false, null, null), // VN
      compararCampo("7", false, null, null), // VN
    ]);
    expect(m).toMatchObject({ vp: 2, erroValor: 1, fn: 1, fp: 1, vn: 2 });
    expect(m.precisao).toBe(0.5); // 2 / (2 + 1 + 1)
    expect(m.revocacao).toBe(0.5); // 2 / (2 + 1 + 1)
    expect(m.f1).toBe(0.5);
    expect(m.alucinacao).toBe(0.3333); // 1 FP entre 3 campos com gabarito vazio
    expect(m.omissao).toBe(0.25); // 1 FN entre 4 campos com valor
  });
});

describe("retomada do Experimento A", () => {
  const execucao = (versao: string) => JSON.stringify({
    caso: "caso_009", modelo: "m", estrategia: "secao", repeticao: 1, versao_prompt: versao,
    latencia_s: 1, tokens: 1, saidas_invalidas: 0, bruto: {}, salvaguardas: {},
  });

  it("lê as execuções gravadas e recusa misturar versões de prompt", () => {
    const pasta = mkdtempSync(join(tmpdir(), "exp-a-"));
    const arquivo = join(pasta, "execucoes.jsonl");
    expect(lerExecucoes(arquivo, "v2")).toEqual([]);
    writeFileSync(arquivo, execucao("v2") + "\n");
    expect(lerExecucoes(arquivo, "v2")).toHaveLength(1);
    expect(() => lerExecucoes(arquivo, "v3")).toThrow(/prompt v2/);
  });

  it("recalcula a saída bruta e a saída após as salvaguardas a partir da saída crua", () => {
    const saidas = {
      historia_medica: {
        q3_alergias: { valor: "Dipirona.", evidencia: "alergia a dipirona" },
        q5_trabalho: { valor: "Motorista", evidencia: "trabalha como motorista" }, // evidência inventada
      },
    };
    const r = aplicarSalvaguardas(saidas, "Tem alergia a dipirona.");
    expect(r.bruto).toEqual({ historia_medica: { q3_alergias: "Dipirona.", q5_trabalho: "Motorista" } });
    expect(r.salvaguardas).toEqual({ historia_medica: { q3_alergias: "Dipirona." } });
    expect(r.descartados.map((d) => d.motivo)).toEqual(["evidencia_nao_encontrada"]);
  });
});
