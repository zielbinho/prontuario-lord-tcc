import { describe, expect, it } from "vitest";
import {
  SecaoNaoPermitidaParaIA,
  evidenciaPresente,
  esquemaParaIA,
  extrairSugestoes,
  localizarEvidencia,
  secoesPermitidasParaIA,
  validarContra,
  valorCoerente,
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
    expect(r.descartados).toEqual([{ caminho: "historia_medica.q4_usa_medicamento", valor: true, motivo: "sem_evidencia" }]);
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

describe("evidência precisa estar no relato", () => {
  const relato = "A paciente conta que tem alergia a Dipirona, deu mancha na pele. Toma losartana faz uns dois anos.";

  it("aceita citação literal, ignorando maiúsculas e pontuação", () => {
    expect(evidenciaPresente("alergia a dipirona", relato)).toBe(true);
    expect(evidenciaPresente("Toma losartana, faz uns dois anos!", relato)).toBe(true);
  });

  it("tolera pequenas variações, mas não evidências inventadas", () => {
    expect(evidenciaPresente("tem alergia a dipirona deu mancha pele", relato)).toBe(true);
    expect(evidenciaPresente("usa escova dura", relato)).toBe(false);
    expect(evidenciaPresente("", relato)).toBe(false);
  });

  it("descarta a sugestão cuja evidência não aparece no relato", () => {
    const saida = {
      q3_alergias: { valor: "dipirona", evidencia: "alergia a Dipirona" },
      q5_substancias: { valor: "Fuma", evidencia: "fuma dez cigarros por dia" },
    };
    const r = extrairSugestoes(saida, "historia_medica", relato);
    expect(r.sugestoes.map((s) => s.caminho)).toEqual(["historia_medica.q3_alergias"]);
    expect(r.descartados).toEqual([
      { caminho: "historia_medica.q5_substancias", valor: "Fuma", evidencia: "fuma dez cigarros por dia", motivo: "evidencia_nao_encontrada" },
    ]);
  });

  it("remove rótulo e aspas que o modelo põe em volta da citação, sem aceitar citação inventada", () => {
    expect(localizarEvidencia("Relato do acadêmico: 'Toma losartana faz uns dois anos.'", relato)).toBe("Toma losartana faz uns dois anos");
    expect(localizarEvidencia("“alergia a Dipirona”", relato)).toBe("alergia a Dipirona");
    expect(localizarEvidencia("alergia a Dipirona", relato)).toBe("alergia a Dipirona");
    expect(localizarEvidencia("Relato do acadêmico: 'fuma dez cigarros'", relato)).toBeNull();
    const r = extrairSugestoes({ q4_usa_medicamento: { valor: true, evidencia: "Relato: \"Toma losartana\"" } }, "historia_medica", relato);
    expect(r.sugestoes).toEqual([{ caminho: "historia_medica.q4_usa_medicamento", valor: true, evidencia: "Toma losartana" }]);
  });

  it("trata o texto \"null\" como campo não mencionado", () => {
    const r = extrairSugestoes(
      { q5_vida_pessoal: { valor: "null", evidencia: "null" }, q1_outras: { valor: "Nenhuma", evidencia: "None" } },
      "historia_medica",
      relato,
    );
    expect(r.sugestoes).toEqual([]);
    expect(r.descartados).toEqual([{ caminho: "historia_medica.q1_outras", valor: "Nenhuma", motivo: "sem_evidencia" }]);
  });
});

describe("coerência entre valor e evidência", () => {
  it("valor em texto precisa estar apoiado no trecho citado", () => {
    expect(valorCoerente("Dipirona", "tem alergia a dipirona")).toBe(true);
    expect(valorCoerente("Losartana 50 mg, há dois anos", "toma losartana faz uns dois anos")).toBe(true);
    expect(valorCoerente("Fuma", "o trânsito estava horrível")).toBe(false);
    expect(valorCoerente("2x", "escova duas vezes")).toBe(true); // sem palavra significativa: fica para o humano
    expect(valorCoerente("Hipotireoidismo", "toma losartana")).toBe(false);
  });

  it("ignora plural e gênero ao comparar valor e evidência", () => {
    expect(valorCoerente("Respiratória", "Tem um problema respiratório.")).toBe(true);
    expect(valorCoerente("Alergias a camarão", "alergia a camarão")).toBe(true);
    expect(valorCoerente("Dipirona.", "Alergia a camarão.")).toBe(false);
  });

  it("negação exige negação na evidência", () => {
    expect(valorCoerente("Nega.", "nega alergias")).toBe(true);
    expect(valorCoerente("nega", "não tem alergia a nada")).toBe(true);
    expect(valorCoerente("nega", "Paciente relata alergia a dipirona.")).toBe(false);
  });

  it("valores não textuais ficam para a revisão humana", () => {
    expect(valorCoerente(true, "toma losartana")).toBe(true);
    expect(valorCoerente(["respiratoria"], "toma losartana")).toBe(true);
  });

  it("extrairSugestoes descarta o valor incoerente", () => {
    const r = extrairSugestoes(
      { q3_alergias: { valor: "nega", evidencia: "Paciente relata alergia a dipirona." } },
      "historia_medica",
      "Paciente relata alergia a dipirona.",
    );
    expect(r.sugestoes).toEqual([]);
    expect(r.descartados[0].motivo).toBe("valor_incoerente_com_evidencia");
  });
});
