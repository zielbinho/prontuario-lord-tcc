// Verificações de segurança orientadas ao OWASP Top 10 (A01 controle de acesso, A03 injeção,
// A05 configuração, A07 autenticação). Complementam os testes de autenticação, RBAC e RLS.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { type UsuarioTeste, chamar, criarUsuario, pacienteExemplo, usarContexto } from "./ajuda";

const ctx = usarContexto();
let aluno: UsuarioTeste, outroAluno: UsuarioTeste;
let pacienteDoOutro: { id: string; nome: string };

beforeAll(async () => {
  [aluno, outroAluno] = await Promise.all([criarUsuario(ctx, "aluno"), criarUsuario(ctx, "aluno")]);
  await chamar(ctx, aluno, "POST", "/pacientes", pacienteExemplo());
  pacienteDoOutro = (await chamar(ctx, outroAluno, "POST", "/pacientes", pacienteExemplo())).corpo;
});

describe("A07: toda rota de dados exige sessão", () => {
  const id = randomUUID();
  const rotas: [string, string][] = [
    ["GET", "/auth/eu"], ["GET", "/pacientes"], ["POST", "/pacientes"], ["GET", `/pacientes/${id}`], ["PUT", `/pacientes/${id}`],
    ["POST", `/pacientes/${id}/consentimentos`], ["POST", `/pacientes/${id}/tratamentos`], ["GET", `/pacientes/${id}/atendimentos`],
    ["POST", `/pacientes/${id}/atendimentos`], ["GET", `/pacientes/${id}/evolucao`], ["GET", `/fichas/${id}`], ["PUT", `/fichas/${id}`],
    ["GET", `/fichas/${id}/versoes`], ["POST", `/fichas/${id}/enviar`], ["POST", `/fichas/${id}/devolver`], ["POST", `/fichas/${id}/aprovar`],
    ["POST", `/fichas/${id}/adendo`], ["GET", "/revisao"], ["GET", `/atendimentos/${id}/odontograma`], ["PUT", `/atendimentos/${id}/odontograma`],
    ["POST", "/transcricoes"], ["POST", `/fichas/${id}/sugestoes`], ["POST", `/sugestoes/${id}/decisoes`], ["GET", "/usuarios"],
    ["POST", "/usuarios"], ["GET", "/auditoria"], ["GET", "/analise/coorte"], ["GET", "/analise/qualidade"], ["GET", "/analise/exportacao.csv"],
  ];
  it.each(rotas)("%s %s sem cookie → 401", async (metodo, url) => {
    const r = await ctx.app.inject({ method: metodo as "GET", url, payload: metodo === "GET" ? undefined : {} });
    expect(r.statusCode).toBe(401);
  });

  it("cookie forjado ou expirado não abre sessão", async () => {
    const r = await ctx.app.inject({ method: "GET", url: "/pacientes", headers: { cookie: `lord_sessao=${"a".repeat(64)}` } });
    expect(r.statusCode).toBe(401);
  });
});

describe("A03: injeção", () => {
  it("SQL na busca de pacientes é tratado como texto e não vaza pacientes de outro aluno", async () => {
    for (const busca of ["' OR 1=1 --", "%' OR '1'='1", "'; drop table paciente; --"]) {
      const r = await chamar(ctx, aluno, "GET", `/pacientes?busca=${encodeURIComponent(busca)}`);
      expect(r.status).toBe(200);
      expect(JSON.stringify(r.corpo)).not.toContain(pacienteDoOutro.nome);
    }
    const [{ existe }] = await ctx.admin`select to_regclass('public.paciente') is not null as existe`;
    expect(existe).toBe(true);
  });

  it("SQL no login responde como credencial inválida, sem erro interno", async () => {
    const r = await chamar(ctx, null, "POST", "/auth/login", { email: "' OR '1'='1' --@x.com", senha: "' OR '1'='1" });
    expect([400, 401]).toContain(r.status);
  });

  it("texto com HTML/script é guardado como dado e devolvido como JSON, nunca como página", async () => {
    const r = await chamar(ctx, aluno, "POST", "/pacientes", { ...pacienteExemplo(), profissao: "<script>alert(1)</script>" });
    expect(r.status).toBe(201);
    expect(r.cabecalhos["content-type"]).toMatch(/^application\/json/);
    expect(r.cabecalhos["x-content-type-options"]).toBe("nosniff");
  });
});

describe("A01/A05: acesso a objetos e mensagens de erro", () => {
  it("identificador de outro aluno não revela se o paciente existe (404, não 403)", async () => {
    expect((await chamar(ctx, aluno, "GET", `/pacientes/${pacienteDoOutro.id}`)).status).toBe(404);
  });

  it("identificador malformado vira 400 sem detalhes do banco", async () => {
    const r = await chamar(ctx, aluno, "GET", "/pacientes/nao-e-um-uuid");
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.corpo)).not.toMatch(/syntax|postgres|22P02|stack|at .*\.ts/i);
  });

  it("corpo acima do limite é recusado (413)", async () => {
    const r = await ctx.app.inject({
      method: "POST", url: "/pacientes", headers: { cookie: aluno.cookie, "content-type": "application/json" },
      payload: JSON.stringify({ ...pacienteExemplo(), profissao: "x".repeat(1_100_000) }),
    });
    expect(r.statusCode).toBe(413);
  });

  it("respostas não podem ficar em cache nem identificar o servidor", async () => {
    const r = await chamar(ctx, aluno, "GET", "/pacientes");
    expect(r.cabecalhos["cache-control"]).toBe("no-store");
    expect(r.cabecalhos["x-powered-by"]).toBeUndefined();
  });
});
