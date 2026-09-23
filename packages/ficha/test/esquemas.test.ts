import { describe, expect, it } from "vitest";
import exemplo from "../exemplos/ficha-inicial.exemplo.json" with { type: "json" };
import { ESQUEMAS, completude, listarCampos, validar } from "../src";

const clonar = <T>(x: T): T => structuredClone(x);

describe("esquemas", () => {
  it("todos os esquemas compilam em modo estrito", () => {
    for (const tipo of ["ficha-inicial", "ficha-retorno", "odontograma", "paciente"] as const) {
      expect(() => validar(tipo, {})).not.toThrow();
    }
  });

  it("o exemplo completo da ficha inicial é válido", () => {
    expect(validar("ficha-inicial", exemplo)).toEqual({ valido: true, erros: [] });
  });

  it("uma ficha vazia (rascunho recém-criado) é válida", () => {
    expect(validar("ficha-inicial", {}).valido).toBe(true);
  });

  it("rejeita escala de dor fora de 0 a 10", () => {
    const ficha = clonar(exemplo);
    ficha.questionario_dtm.q16_dor_atual = 11;
    const r = validar("ficha-inicial", ficha);
    expect(r.valido).toBe(false);
    expect(r.erros[0].caminho).toBe("/questionario_dtm/q16_dor_atual");
  });

  it("rejeita campos que não existem na ficha", () => {
    const ficha = clonar(exemplo) as Record<string, unknown>;
    (ficha.historia_medica as Record<string, unknown>).tipo_sanguineo = "O+";
    const r = validar("ficha-inicial", ficha);
    expect(r.valido).toBe(false);
    expect(r.erros[0].mensagem).toContain("tipo_sanguineo");
  });

  it("rejeita valor fora das opções e palpação fora de 0 a 3", () => {
    const ficha = clonar(exemplo) as any;
    ficha.exame_extraoral.q56_forma_face = "redonda";
    ficha.exame_dtm.q44_palpacao_muscular.masseter_corpo.direito = 4;
    expect(validar("ficha-inicial", ficha).erros).toHaveLength(2);
  });
});

describe("cobertura da ficha em papel", () => {
  const campos = listarCampos("ficha-inicial");
  const questoes = new Set(campos.map((c) => c.questao));

  it("tem 144 campos em 15 seções (números citados no TCC; atualize o texto se mudar)", () => {
    expect(campos).toHaveLength(144);
    expect(new Set(campos.map((c) => c.secao)).size).toBe(15);
    expect(campos.filter((c) => c.somenteHumano)).toHaveLength(15);
    expect(campos.filter((c) => !c.somenteHumano && c.captacao.includes("ditado"))).toHaveLength(103);
  });

  it("todas as questões numeradas de 1 a 75 estão no esquema (43 é a legenda da escala de palpação)", () => {
    const faltando = Array.from({ length: 75 }, (_, i) => String(i + 1))
      .filter((q) => q !== "43")
      .filter((q) => !questoes.has(q));
    expect(faltando).toEqual([]);
  });

  it("inclui os blocos não numerados da ficha", () => {
    for (const bloco of ["QP", "CDTM", "RDC", "EIXO1", "TM", "PERIO", "OBS", "PLANO"]) {
      expect(questoes.has(bloco)).toBe(true);
    }
  });

  it("toda seção declara como é captada ou é exclusivamente humana", () => {
    const raiz = ESQUEMAS["ficha-inicial"].properties as Record<string, Record<string, unknown>>;
    for (const [nome, secao] of Object.entries(raiz)) {
      const temCaptacao = Array.isArray(secao["x-captacao"]);
      const humano = secao["x-somente-humano"] === true;
      expect(temCaptacao !== humano, nome).toBe(true);
    }
  });

  it("as escalas de dor (16 a 22) nunca admitem ditado", () => {
    for (const c of campos.filter((c) => ["16", "17", "18", "19", "20", "21", "22"].includes(c.questao ?? ""))) {
      expect(c.captacao).not.toContain("ditado");
    }
  });

  it("lista os sítios de palpação como campos individuais com título composto", () => {
    const campo = campos.find((c) => c.caminho === "exame_dtm.q44_palpacao_muscular.masseter_corpo.direito");
    expect(campo?.questao).toBe("44");
    expect(campo?.titulo).toBe("Dor muscular extraoral à palpação / Masseter no corpo / direito");
  });
});

describe("demais esquemas", () => {
  it("odontograma aceita apenas numeração FDI de dentes permanentes", () => {
    expect(validar("odontograma", { "36": { faces: { O: "restauracao" } }, "48": { ausente: true } }).valido).toBe(true);
    expect(validar("odontograma", { "19": { ausente: true } }).valido).toBe(false);
    expect(validar("odontograma", { "36": { faces: { X: "carie" } } }).valido).toBe(false);
  });

  it("paciente exige nome e data de nascimento e valida o CPF", () => {
    expect(validar("paciente", { nome: "Paciente Teste", data_nascimento: "1990-05-10", cpf: "12345678901" }).valido).toBe(true);
    expect(validar("paciente", { nome: "Paciente Teste" }).valido).toBe(false);
    expect(validar("paciente", { nome: "Paciente Teste", data_nascimento: "1990-05-10", cpf: "123.456.789-01" }).valido).toBe(false);
    expect(validar("paciente", { nome: "Paciente Teste", data_nascimento: "10/05/1990" }).valido).toBe(false);
  });

  it("ficha de retorno aceita as medidas de acompanhamento", () => {
    const retorno = {
      dor: { q16_dor_atual: 2, q17_pior_dor: 5, q18_dor_media: 3 },
      exame: { q39b_abertura_maxima_sem_auxilio_mm: 45, q44_palpacao_muscular: { masseter_corpo: { direito: 1, esquerdo: 0 } } },
      acompanhamento: { adesao_tratamento: "total" },
    };
    expect(validar("ficha-retorno", retorno).valido).toBe(true);
  });
});

describe("completude", () => {
  it("o exemplo completo tem todos os campos obrigatórios preenchidos", () => {
    const c = completude("ficha-inicial", exemplo);
    expect(c.faltantes).toEqual([]);
    expect(c.fracao).toBe(1);
  });

  it("aponta os campos obrigatórios que faltam", () => {
    const ficha = clonar(exemplo) as any;
    ficha.queixa_principal.texto = "  ";
    delete ficha.plano_tratamento;
    const c = completude("ficha-inicial", ficha);
    expect(c.faltantes).toEqual(["queixa_principal.texto", "plano_tratamento.texto"]);
    expect(c.preenchidos).toBe(c.total - 2);
  });
});
