// Painéis analíticos: quem vê o quê e o que sai da API para o serviço analítico.
import exemplo from "@lord/ficha/exemplos/ficha-inicial.exemplo.json" with { type: "json" };
import { beforeAll, describe, expect, it } from "vitest";
import { analiticoHttp, type FichaSerie, type ServicoAnalitico } from "../src/rotas/analise";
import { type UsuarioTeste, chamar, criarUsuario, pacienteExemplo, usarContexto } from "./ajuda";

const enviadas: FichaSerie[][] = [];
const servico: ServicoAnalitico = {
  coorte: async () => ({ pacientes: 150 }),
  qualidade: async () => ({ completude: [] }),
  exportacao: async () => "pseudo_id,icd\nab12,50\ncd34,30\n",
  evolucao: async (fichas) => {
    enviadas.push(fichas);
    return { consultas: [...fichas].sort((a, b) => a.dias - b.dias).map((f) => ({ dias: f.dias, tipo_ficha: f.tipo_ficha, icd: 10 })) };
  },
};

const ctx = usarContexto({ analitico: servico });
let aluno: UsuarioTeste, outroAluno: UsuarioTeste, professor: UsuarioTeste, pesquisador: UsuarioTeste, admin: UsuarioTeste;

async function fichaAprovada(pacienteId: string, dados: object, data: string, tipo = "primeira_consulta") {
  const at = (await chamar(ctx, aluno, "POST", `/pacientes/${pacienteId}/atendimentos`, { tipo, data })).corpo;
  await chamar(ctx, aluno, "PUT", `/fichas/${at.ficha.id}`, { dados });
  await chamar(ctx, aluno, "POST", `/fichas/${at.ficha.id}/enviar`);
  await chamar(ctx, professor, "POST", `/fichas/${at.ficha.id}/aprovar`);
  return at.ficha.id as string;
}

beforeAll(async () => {
  [aluno, outroAluno, professor, pesquisador, admin] = await Promise.all(
    (["aluno", "aluno", "professor", "pesquisador", "admin"] as const).map((p) => criarUsuario(ctx, p)),
  );
});

describe("painéis de coorte e de qualidade", () => {
  it("coorte: só professor e pesquisador", async () => {
    expect((await chamar(ctx, pesquisador, "GET", "/analise/coorte")).corpo).toEqual({ pacientes: 150 });
    expect((await chamar(ctx, professor, "GET", "/analise/coorte")).status).toBe(200);
    for (const u of [aluno, admin]) expect((await chamar(ctx, u, "GET", "/analise/coorte")).status).toBe(403);
    expect((await chamar(ctx, null, "GET", "/analise/coorte")).status).toBe(401);
  });

  it("exportação CSV: professor e pesquisador, como anexo, registrada na auditoria", async () => {
    const r = await ctx.app.inject({ method: "GET", url: "/analise/exportacao.csv", headers: { cookie: pesquisador.cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toMatch(/^text\/csv/);
    expect(r.headers["content-disposition"]).toMatch(/^attachment; filename="lord-pseudonimizado-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(r.body).toBe("pseudo_id,icd\nab12,50\ncd34,30\n");
    for (const u of [aluno, admin]) expect((await chamar(ctx, u, "GET", "/analise/exportacao.csv")).status).toBe(403);
    const [evento] = await ctx.admin`
      select detalhes from auditoria where usuario_id = ${pesquisador.id} and acao = 'exportar_dados_pseudonimizados'`;
    expect(evento.detalhes).toEqual({ linhas: 2 });
  });

  it("qualidade: professor, pesquisador e administrador", async () => {
    for (const u of [professor, pesquisador, admin]) expect((await chamar(ctx, u, "GET", "/analise/qualidade")).status).toBe(200);
    expect((await chamar(ctx, aluno, "GET", "/analise/qualidade")).status).toBe(403);
  });
});

describe("evolução do paciente", () => {
  let pacienteId: string, nome: string;

  beforeAll(async () => {
    const p = (await chamar(ctx, aluno, "POST", "/pacientes", pacienteExemplo())).corpo;
    [pacienteId, nome] = [p.id, p.nome];
    await fichaAprovada(pacienteId, exemplo, "2026-06-01");
    await fichaAprovada(pacienteId, {
      dor: { q16_dor_atual: 2, q17_pior_dor: 3, q18_dor_media: 2 },
      exame: { q44_palpacao_muscular: { masseter_corpo: { direito: 1, esquerdo: 0 } } },
      acompanhamento: { relato_paciente: "Diz que melhorou depois da viagem." },
    }, "2026-07-01", "retorno");
    // retorno ainda em rascunho: não entra
    await chamar(ctx, aluno, "POST", `/pacientes/${pacienteId}/atendimentos`, { tipo: "retorno", data: "2026-08-01" });
    await chamar(ctx, aluno, "POST", `/pacientes/${pacienteId}/tratamentos`, { categoria: "placa_oclusal", inicio: "2026-06-01" });
  });

  it("devolve os indicadores por consulta aprovada, com data, palpação e tratamentos", async () => {
    const r = await chamar(ctx, aluno, "GET", `/pacientes/${pacienteId}/evolucao`);
    expect(r.status).toBe(200);
    expect(r.corpo.consultas.map((c: any) => [c.dias, c.tipo_ficha, c.icd])).toEqual([[0, "ficha-inicial", 10], [30, "ficha-retorno", 10]]);
    expect(r.corpo.consultas[1].palpacao.q44_palpacao_muscular).toEqual({ masseter_corpo: { direito: 1, esquerdo: 0 } });
    expect(r.corpo.tratamentos).toEqual([expect.objectContaining({ categoria: "placa_oclusal" })]);
    expect((await chamar(ctx, professor, "GET", `/pacientes/${pacienteId}/evolucao`)).status).toBe(200);
  });

  it("envia ao serviço analítico só as seções dos indicadores: nada de identificação ou texto livre", async () => {
    await chamar(ctx, aluno, "GET", `/pacientes/${pacienteId}/evolucao`);
    const serie = enviadas.at(-1)!;
    expect(serie.map((f) => Object.keys(f.dados).sort())).toEqual([["exame_dtm", "questionario_dtm"], ["dor", "exame"]]);
    const texto = JSON.stringify(serie);
    for (const proibido of [nome, pacienteId, "Dipirona", "melhorou depois da viagem", "2026-06-01"]) expect(texto).not.toContain(proibido);
  });

  it("respeita a RLS e os papéis", async () => {
    expect((await chamar(ctx, outroAluno, "GET", `/pacientes/${pacienteId}/evolucao`)).status).toBe(404);
    for (const u of [pesquisador, admin]) expect((await chamar(ctx, u, "GET", `/pacientes/${pacienteId}/evolucao`)).status).toBe(403);
  });

  it("registra a leitura na auditoria", async () => {
    const [evento] = await ctx.admin`
      select acao, entidade_id from auditoria where usuario_id = ${aluno.id} and acao = 'ler_evolucao' limit 1`;
    expect(evento).toEqual({ acao: "ler_evolucao", entidade_id: pacienteId });
  });

  it("paciente sem ficha aprovada: série vazia, sem chamar o serviço", async () => {
    const p = (await chamar(ctx, aluno, "POST", "/pacientes", pacienteExemplo())).corpo;
    const antes = enviadas.length;
    expect((await chamar(ctx, aluno, "GET", `/pacientes/${p.id}/evolucao`)).corpo).toEqual({ consultas: [], tratamentos: [] });
    expect(enviadas.length).toBe(antes);
  });
});

it("serviço analítico fora do ar vira 502", async () => {
  await expect(analiticoHttp("http://127.0.0.1:1").coorte()).rejects.toMatchObject({ statusCode: 502 });
});
