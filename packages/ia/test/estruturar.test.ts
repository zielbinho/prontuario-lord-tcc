import { SecaoNaoPermitidaParaIA } from "@lord/ficha";
import { describe, expect, it } from "vitest";
import { clienteOllama, ErroModelo, estruturar, esquemaDeSaida, montarMensagens, type ClienteModelo } from "../src";

/** Cliente falso: devolve a resposta fornecida e guarda o pedido recebido. */
function clienteFalso(resposta: unknown) {
  const pedidos: Parameters<ClienteModelo["gerar"]>[0][] = [];
  const cliente: ClienteModelo = {
    async gerar(pedido) {
      pedidos.push(pedido);
      return { conteudo: typeof resposta === "string" ? resposta : JSON.stringify(resposta), tokensGerados: 10, duracaoMs: 5 };
    },
  };
  return { cliente, pedidos };
}

function respostaVazia(secao: string): Record<string, unknown> {
  const props = (esquemaDeSaida([secao]).properties ?? {}) as Record<string, unknown>;
  return Object.fromEntries(Object.keys(props).map((k) => [k, { valor: null, evidencia: null }]));
}

const RELATO = "Paciente relata alergia a dipirona. Toma losartana faz uns dois anos. O trânsito estava horrível.";

describe("prompt", () => {
  it("proíbe diagnóstico, exige evidência literal e lista os códigos com rótulos", () => {
    const [sistema, usuario] = montarMensagens(["historia_medica"], RELATO);
    expect(sistema.content).toMatch(/Não faça diagnóstico/);
    expect(sistema.content).toMatch(/COPIADO LITERALMENTE/);
    expect(usuario.content).toContain("q1_sistemas");
    expect(usuario.content).toContain("cardiaca (Cardíaca)");
    expect(usuario.content).toContain('Somente se o paciente negar ter alergias, registrar "Nega.".');
    expect(usuario.content).toContain(RELATO);
  });

  it("não inclui campos de seções exclusivamente humanas", () => {
    const [, usuario] = montarMensagens(["historia_medica", "protese"], RELATO);
    expect(usuario.content).not.toMatch(/diagnostico|grupo1_muscular|plano_tratamento/);
  });
});

describe("estruturar", () => {
  it("devolve só as sugestões com evidência presente no relato", async () => {
    const resposta = {
      ...respostaVazia("historia_medica"),
      q3_alergias: { valor: "Dipirona.", evidencia: "alergia a dipirona" },
      q4_usa_medicamento: { valor: true, evidencia: "Toma losartana" },
      q5_substancias: { valor: "Fuma", evidencia: "fuma um maço por dia" }, // não está no relato
      q5_sono: { valor: "Dorme mal", evidencia: null }, // sem evidência
    };
    const { cliente, pedidos } = clienteFalso(resposta);
    const r = await estruturar(cliente, { secoes: ["historia_medica"], relato: RELATO, modelo: "fake" });

    expect(r.sugestoes.map((s) => [s.caminho, s.valor])).toEqual([
      ["historia_medica.q3_alergias", "Dipirona."],
      ["historia_medica.q4_usa_medicamento", true],
    ]);
    const motivos = Object.fromEntries(r.descartados.map((d) => [d.caminho, d.motivo]));
    expect(motivos).toEqual({
      "historia_medica.q5_sono": "sem_evidencia",
      "historia_medica.q5_substancias": "evidencia_nao_encontrada",
    });
    expect(r).toMatchObject({ modelo: "fake", versaoPrompt: "v2", tokensGerados: 10 });
    expect(pedidos[0].formato).toEqual(esquemaDeSaida(["historia_medica"]));
  });

  it("estratégia 'ficha inteira': uma chamada, sugestões de várias seções", async () => {
    const resposta = {
      historia_medica: { ...respostaVazia("historia_medica"), q3_alergias: { valor: "Dipirona.", evidencia: "alergia a dipirona" } },
      protese: respostaVazia("protese"),
    };
    const { cliente, pedidos } = clienteFalso(resposta);
    const r = await estruturar(cliente, { secoes: ["historia_medica", "protese"], relato: RELATO, modelo: "fake" });
    expect(pedidos).toHaveLength(1);
    expect(r.sugestoes.map((s) => s.caminho)).toEqual(["historia_medica.q3_alergias"]);
  });

  it("recusa seções de decisão clínica antes de chamar o modelo", async () => {
    const { cliente, pedidos } = clienteFalso({});
    await expect(estruturar(cliente, { secoes: ["diagnostico_eixo1"], relato: RELATO, modelo: "fake" }))
      .rejects.toThrow(SecaoNaoPermitidaParaIA);
    await expect(estruturar(cliente, { secoes: ["historia_medica", "plano_tratamento"], relato: RELATO, modelo: "fake" }))
      .rejects.toThrow(SecaoNaoPermitidaParaIA);
    expect(pedidos).toHaveLength(0);
  });

  it("rejeita JSON inválido, saída fora do esquema e relato vazio", async () => {
    await expect(estruturar(clienteFalso("não é json").cliente, { secoes: ["historia_medica"], relato: RELATO, modelo: "f" }))
      .rejects.toThrow(ErroModelo);
    const foraDoEsquema = { ...respostaVazia("historia_medica"), diagnostico: { valor: "DTM", evidencia: "x" } };
    await expect(estruturar(clienteFalso(foraDoEsquema).cliente, { secoes: ["historia_medica"], relato: RELATO, modelo: "f" }))
      .rejects.toThrow(/não respeita o esquema/);
    await expect(estruturar(clienteFalso({}).cliente, { secoes: ["historia_medica"], relato: "  ", modelo: "f" }))
      .rejects.toThrow(/vazio/);
  });
});

// Teste com o modelo real (lento em CPU): OLLAMA=1 npx vitest run
describe.runIf(process.env.OLLAMA === "1")("com o Ollama local", () => {
  it("estrutura um relato curto de história médica", { timeout: 300_000 }, async () => {
    const r = await estruturar(clienteOllama(), { secoes: ["historia_medica"], relato: RELATO, modelo: "qwen2.5:3b" });
    const alergia = r.sugestoes.find((s) => s.caminho === "historia_medica.q3_alergias");
    expect(String(alergia?.valor).toLowerCase()).toContain("dipirona");
    // nenhuma sugestão aprovada pelas salvaguardas pode citar algo fora do relato
    expect(r.sugestoes.every((s) => s.evidencia.length > 0)).toBe(true);
    console.log(JSON.stringify({ sugestoes: r.sugestoes, descartados: r.descartados, latenciaMs: r.latenciaMs }, null, 1));
  });
});
