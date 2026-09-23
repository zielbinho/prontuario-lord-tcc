import { describe, expect, it } from "vitest";
import { SENHA_PADRAO, chamar, criarUsuario, usarContexto } from "./ajuda";

const ctx = usarContexto();

describe("autenticação", () => {
  it("login correto devolve cookie HttpOnly e SameSite=Strict, e /auth/eu identifica o usuário", async () => {
    const u = await criarUsuario(ctx, "aluno", { login: false });
    const r = await ctx.app.inject({ method: "POST", url: "/auth/login", payload: { email: u.email, senha: SENHA_PADRAO } });
    expect(r.statusCode).toBe(200);
    const cookie = r.cookies.find((c) => c.name === "lord_sessao")!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Strict");

    const eu = await chamar(ctx, { ...u, cookie: `lord_sessao=${cookie.value}` }, "GET", "/auth/eu");
    expect(eu.corpo).toMatchObject({ id: u.id, papel: "aluno" });
  });

  it("o e-mail não diferencia maiúsculas", async () => {
    const u = await criarUsuario(ctx, "professor", { login: false });
    const r = await chamar(ctx, null, "POST", "/auth/login", { email: u.email.toUpperCase(), senha: SENHA_PADRAO });
    expect(r.status).toBe(200);
  });

  it("senha errada e e-mail inexistente recebem a mesma resposta", async () => {
    const u = await criarUsuario(ctx, "aluno", { login: false });
    const senhaErrada = await chamar(ctx, null, "POST", "/auth/login", { email: u.email, senha: "errada" });
    const inexistente = await chamar(ctx, null, "POST", "/auth/login", { email: "ninguem@teste.uepg.br", senha: "x" });
    expect(senhaErrada.status).toBe(401);
    expect(inexistente.status).toBe(401);
    expect(senhaErrada.corpo).toEqual(inexistente.corpo);
  });

  it("bloqueia a conta após 5 tentativas erradas, mesmo com a senha correta em seguida", async () => {
    const u = await criarUsuario(ctx, "aluno", { login: false });
    for (let i = 0; i < 5; i++) {
      expect((await chamar(ctx, null, "POST", "/auth/login", { email: u.email, senha: "errada" })).status).toBe(401);
    }
    const r = await chamar(ctx, null, "POST", "/auth/login", { email: u.email, senha: SENHA_PADRAO });
    expect(r.status).toBe(423);

    await ctx.admin`update usuario set bloqueado_ate = now() - interval '1 second' where id = ${u.id}`;
    expect((await chamar(ctx, null, "POST", "/auth/login", { email: u.email, senha: SENHA_PADRAO })).status).toBe(200);
  });

  it("logout invalida a sessão no servidor", async () => {
    const u = await criarUsuario(ctx, "aluno");
    expect((await chamar(ctx, u, "POST", "/auth/logout")).status).toBe(204);
    expect((await chamar(ctx, u, "GET", "/auth/eu")).status).toBe(401);
  });

  it("usuário desativado perde a sessão e não consegue entrar", async () => {
    const admin = await criarUsuario(ctx, "admin");
    const u = await criarUsuario(ctx, "aluno");
    expect((await chamar(ctx, admin, "PATCH", `/usuarios/${u.id}`, { ativo: false })).status).toBe(200);
    expect((await chamar(ctx, u, "GET", "/auth/eu")).status).toBe(401);
    expect((await chamar(ctx, null, "POST", "/auth/login", { email: u.email, senha: SENHA_PADRAO })).status).toBe(401);
  });

  it("o token não é guardado em texto no banco e a senha é Argon2id", async () => {
    const u = await criarUsuario(ctx, "aluno");
    const token = u.cookie.split("=")[1];
    const [sessao] = await ctx.admin`select encode(token_hash, 'hex') as h from sessao where usuario_id = ${u.id}`;
    expect(sessao.h).not.toContain(token);
    const [usuario] = await ctx.admin`select senha_hash from usuario where id = ${u.id}`;
    expect(usuario.senha_hash).toMatch(/^\$argon2id\$/);
  });

  it("registra login, falha e logout na auditoria", async () => {
    const u = await criarUsuario(ctx, "aluno");
    await chamar(ctx, null, "POST", "/auth/login", { email: u.email, senha: "errada" });
    await chamar(ctx, u, "POST", "/auth/logout");
    const acoes = (await ctx.admin`select acao from auditoria where usuario_id = ${u.id} order by id`).map((a) => a.acao);
    expect(acoes).toEqual(["login", "login_falhou", "logout"]);
  });

  it("respostas não podem ser guardadas em cache", async () => {
    const u = await criarUsuario(ctx, "aluno");
    const r = await chamar(ctx, u, "GET", "/auth/eu");
    expect(r.cabecalhos["cache-control"]).toBe("no-store");
  });
});
