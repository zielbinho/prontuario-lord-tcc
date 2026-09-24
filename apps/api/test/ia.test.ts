// Rotas de IA com modelo e transcritor falsos (determinísticos). O comportamento com o modelo
// real é avaliado no Experimento A (packages/ia/scripts), não aqui.
import { esquemaDeSaida, ErroModelo, VERSAO_PROMPT, type ClienteModelo } from "@lord/ia";
import { beforeAll, describe, expect, it } from "vitest";
import type { ServicosIA } from "../src/rotas/ia";
import { type UsuarioTeste, chamar, criarUsuario, pacienteExemplo, usarContexto } from "./ajuda";

const RELATO = "Paciente relata alergia a dipirona. Toma losartana faz uns dois anos.";

let proximaResposta: unknown;
let falharModelo = false;
const pedidosAoModelo: string[] = [];

const cliente: ClienteModelo = {
  async gerar({ mensagens }) {
    pedidosAoModelo.push(mensagens[1].content);
    if (falharModelo) throw new ErroModelo("Ollama fora do ar");
    return { conteudo: JSON.stringify(proximaResposta), tokensGerados: 42, duracaoMs: 1234 };
  },
};

const servicos: ServicosIA = {
  cliente,
  modelo: "modelo-falso",
  transcrever: async (audio, tipo) => ({
    texto: `recebidos ${audio.length} bytes de ${tipo}`,
    duracao_audio_s: 3.2,
    tempo_processamento_s: 0.1,
    modelo: "whisper-falso",
  }),
};

function respostaHistoriaMedica(extra: Record<string, unknown> = {}) {
  const campos = Object.keys(esquemaDeSaida(["historia_medica"]).properties as object);
  return { ...Object.fromEntries(campos.map((c) => [c, { valor: null, evidencia: null }])), ...extra };
}

const ctx = usarContexto({ ia: servicos });
let aluno: UsuarioTeste, outroAluno: UsuarioTeste, professor: UsuarioTeste;
let fichaId: string;

beforeAll(async () => {
  [aluno, outroAluno, professor] = await Promise.all([criarUsuario(ctx, "aluno"), criarUsuario(ctx, "aluno"), criarUsuario(ctx, "professor")]);
  const paciente = (await chamar(ctx, aluno, "POST", "/pacientes", pacienteExemplo())).corpo;
  fichaId = (await chamar(ctx, aluno, "POST", `/pacientes/${paciente.id}/atendimentos`, { tipo: "primeira_consulta" })).corpo.ficha.id;
});

describe("sugestões da IA", () => {
  it("gera sugestões com evidência, registra a sugestão e audita só contagens", async () => {
    proximaResposta = respostaHistoriaMedica({
      q3_alergias: { valor: "Dipirona.", evidencia: "alergia a dipirona" },
      q4_usa_medicamento: { valor: true, evidencia: "Toma losartana" },
      q5_substancias: { valor: "Fuma", evidencia: "fuma um maço" }, // não está no relato
    });
    const r = await chamar(ctx, aluno, "POST", `/fichas/${fichaId}/sugestoes`, { secao: "historia_medica", relato: RELATO });
    expect(r.status).toBe(201);
    expect(r.corpo.sugestoes.map((s: { caminho: string }) => s.caminho)).toEqual([
      "historia_medica.q3_alergias", "historia_medica.q4_usa_medicamento",
    ]);
    expect(r.corpo.descartados).toEqual([
      { caminho: "historia_medica.q5_substancias", valor: "Fuma", evidencia: "fuma um maço", motivo: "evidencia_nao_encontrada" },
    ]);
    expect(r.corpo).toMatchObject({ modelo: "modelo-falso", versao_prompt: VERSAO_PROMPT, latencia_ms: 1234 });

    const [registro] = await ctx.admin`select secao, origem, transcricao, modelo, criado_por from sugestao_ia where id = ${r.corpo.id}`;
    expect(registro).toEqual({ secao: "historia_medica", origem: "texto", transcricao: RELATO, modelo: "modelo-falso", criado_por: aluno.id });

    const [evento] = await ctx.admin`select detalhes::text from auditoria where acao = 'gerar_sugestoes_ia' and entidade_id = ${fichaId}`;
    expect(evento.detalhes).not.toMatch(/dipirona|losartana/i);
    expect(JSON.parse(evento.detalhes)).toMatchObject({ secao: "historia_medica", sugestoes: 2, descartados: 1 });
  });

  it("recusa seções de decisão clínica e as escalas de dor sem chamar o modelo", async () => {
    const antes = pedidosAoModelo.length;
    for (const secao of ["diagnostico_eixo1", "plano_tratamento", "questionario_dtm", "secao_que_nao_existe"]) {
      const r = await chamar(ctx, aluno, "POST", `/fichas/${fichaId}/sugestoes`, { secao, relato: RELATO });
      expect(r.status, secao).toBe(400);
    }
    expect(pedidosAoModelo.length).toBe(antes);
  });

  it("respeita o acesso à ficha e o status de rascunho", async () => {
    expect((await chamar(ctx, outroAluno, "POST", `/fichas/${fichaId}/sugestoes`, { secao: "historia_medica", relato: RELATO })).status).toBe(404);

    const paciente = (await chamar(ctx, aluno, "POST", "/pacientes", pacienteExemplo())).corpo;
    const outra = (await chamar(ctx, aluno, "POST", `/pacientes/${paciente.id}/atendimentos`, { tipo: "primeira_consulta" })).corpo.ficha.id;
    await chamar(ctx, aluno, "POST", `/fichas/${outra}/enviar`);
    expect((await chamar(ctx, aluno, "POST", `/fichas/${outra}/sugestoes`, { secao: "historia_medica", relato: RELATO })).status).toBe(409);
  });

  it("falha do modelo vira 502 com mensagem clara", async () => {
    falharModelo = true;
    try {
      const r = await chamar(ctx, aluno, "POST", `/fichas/${fichaId}/sugestoes`, { secao: "historia_medica", relato: RELATO });
      expect(r.status).toBe(502);
      expect(r.corpo.erro).toMatch(/Ollama fora do ar/);
    } finally {
      falharModelo = false;
    }
  });

  it("registra a decisão humana sobre cada sugestão", async () => {
    proximaResposta = respostaHistoriaMedica({ q3_alergias: { valor: "Dipirona.", evidencia: "alergia a dipirona" } });
    const { corpo } = await chamar(ctx, aluno, "POST", `/fichas/${fichaId}/sugestoes`, { secao: "historia_medica", relato: RELATO });
    const r1 = await chamar(ctx, aluno, "POST", `/sugestoes/${corpo.id}/decisoes`, { decisoes: { "historia_medica.q3_alergias": "aceita" } });
    expect(r1.corpo.decisoes).toEqual({ "historia_medica.q3_alergias": "aceita" });
    const r2 = await chamar(ctx, aluno, "POST", `/sugestoes/${corpo.id}/decisoes`, { decisoes: { "historia_medica.q4_usa_medicamento": "rejeitada" } });
    expect(r2.corpo.decisoes).toEqual({ "historia_medica.q3_alergias": "aceita", "historia_medica.q4_usa_medicamento": "rejeitada" });

    expect((await chamar(ctx, aluno, "POST", `/sugestoes/${corpo.id}/decisoes`, { decisoes: { x: "talvez" } })).status).toBe(400);
    expect((await chamar(ctx, outroAluno, "POST", `/sugestoes/${corpo.id}/decisoes`, { decisoes: { x: "aceita" } })).status).toBe(404);
  });
});

describe("transcrição", () => {
  it("repassa o áudio ao serviço e devolve o texto, auditando só a duração", async () => {
    const r = await ctx.app.inject({
      method: "POST", url: "/transcricoes", payload: Buffer.alloc(2048, 1),
      headers: { cookie: aluno.cookie, "content-type": "audio/webm" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ texto: "recebidos 2048 bytes de audio/webm", duracao_audio_s: 3.2 });
    const [evento] = await ctx.admin`
      select detalhes from auditoria where acao = 'transcrever_audio' and usuario_id = ${aluno.id} order by id desc limit 1`;
    expect(evento.detalhes).toEqual({ duracao_audio_s: 3.2 });
  });

  it("exige áudio e usuário clínico", async () => {
    const texto = await ctx.app.inject({
      method: "POST", url: "/transcricoes", payload: { a: 1 }, headers: { cookie: aluno.cookie },
    });
    expect(texto.statusCode).toBe(415);
    const admin = await criarUsuario(ctx, "admin");
    const r = await ctx.app.inject({
      method: "POST", url: "/transcricoes", payload: Buffer.alloc(10), headers: { cookie: admin.cookie, "content-type": "audio/webm" },
    });
    expect(r.statusCode).toBe(403);
    expect(professor.papel).toBe("professor");
  });
});
