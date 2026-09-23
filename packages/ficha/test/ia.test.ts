import { describe, expect, it } from "vitest";
import {
  SecaoNaoPermitidaParaIA,
  esquemaParaIA,
  extrairSugestoes,
  secoesPermitidasParaIA,
  validarContra,
} from "../src";

const temChave = (no: unknown, predicado: (chave: string) => boolean): boolean => {
  if (Array.isArray(no)) return no.some((x) => temChave(x, predicado));
  if (no === null || typeof no !== "object") return false;
  return Object.entries(no).some(([k, v]) => predicado(k) || temChave(v, predicado));
};

describe("esquema derivado para a IA", () => {
  const esquema = esquemaParaIA("historia_medica");

  it("é autocontido e sem metadados internos", () => {
    expect(temChave(esquema, (k) => k === "$ref")).toBe(false);
    expect(temChave(esquema, (k) => k.startsWith("x-"))).toBe(false);
  });

  it("transforma cada campo em { valor, evidencia } e exige todas as chaves", () => {
    const props = esquema.properties as Record<string, any>;
    expect(esquema.required).toEqual(Object.keys(props));
    expect(props.q3_alergias.required).toEqual(["valor", "evidencia"]);
    expect(props.q3_alergias.description).toBe("Histórico de alergias");
    expect(props.q1_sistemas.properties.valor.type).toEqual(["array", "null"]);
  });

  it("aceita a resposta esperada do modelo e rejeita campos inventados", () => {
    const campos = Object.keys(esquema.properties as object);
    const resposta: Record<string, unknown> = Object.fromEntries(campos.map((c) => [c, { valor: null, evidencia: null }]));
    resposta.q3_alergias = { valor: "dipirona", evidencia: "tem alergia a dipirona" };
    expect(validarContra(esquema, resposta).valido).toBe(true);

    expect(validarContra(esquema, { ...resposta, diagnostico: { valor: "DTM", evidencia: "x" } }).valido).toBe(false);
  });

  it("recusa seções de decisão clínica", () => {
    for (const secao of ["diagnostico_eixo1", "plano_tratamento", "rdc_caracteristicas_relatadas", "condicao_dtm"]) {
      expect(() => esquemaParaIA(secao)).toThrow(SecaoNaoPermitidaParaIA);
    }
  });

  it("recusa as escalas de dor autorrelatadas", () => {
    expect(() => esquemaParaIA("questionario_dtm")).toThrow(SecaoNaoPermitidaParaIA);
  });

  it("lista apenas seções que admitem ditado", () => {
    const permitidas = secoesPermitidasParaIA();
    expect(permitidas).toContain("historia_medica");
    expect(permitidas).toContain("exame_dtm");
    expect(permitidas).not.toContain("diagnostico_eixo1");
    expect(permitidas).not.toContain("questionario_dtm");
  });

  it("expande as estruturas aninhadas do exame de palpação", () => {
    const exame = esquemaParaIA("exame_dtm").properties as Record<string, any>;
    const masseter = exame.q44_palpacao_muscular.properties.masseter_corpo.properties.direito;
    expect(masseter.properties.valor.enum).toEqual([0, 1, 2, 3, null]);
  });
});

describe("extração das sugestões", () => {
  it("descarta valores sem evidência e ignora campos não mencionados", () => {
    const saida = {
      q3_alergias: { valor: "dipirona", evidencia: "tem alergia a dipirona, deu mancha" },
      q4_usa_medicamento: { valor: true, evidencia: "   " },
      q2_historico_cirurgico: { valor: null, evidencia: null },
      q1_sistemas: { valor: [], evidencia: null },
    };
    const r = extrairSugestoes(saida, "historia_medica");
    expect(r.sugestoes).toEqual([
      { caminho: "historia_medica.q3_alergias", valor: "dipirona", evidencia: "tem alergia a dipirona, deu mancha" },
    ]);
    expect(r.descartados).toEqual([{ caminho: "historia_medica.q4_usa_medicamento", valor: true }]);
  });

  it("percorre estruturas aninhadas", () => {
    const saida = {
      q44_palpacao_muscular: { masseter_corpo: { direito: { valor: 3, evidencia: "masseter direito dor severa" } } },
    };
    expect(extrairSugestoes(saida, "exame_dtm").sugestoes[0].caminho).toBe(
      "exame_dtm.q44_palpacao_muscular.masseter_corpo.direito",
    );
  });
});
