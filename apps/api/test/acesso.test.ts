// Matriz de controle de acesso (Apêndice C do TCC), verificada na API e no próprio banco (RLS).
import { beforeAll, describe, expect, it } from "vitest";
import { type UsuarioTeste, chamar, criarUsuario, pacienteExemplo, usarContexto } from "./ajuda";
import { comUsuario, conectar } from "../src/banco";

const ctx = usarContexto();

let alunoA: UsuarioTeste, alunoB: UsuarioTeste, professor: UsuarioTeste, admin: UsuarioTeste, pesquisador: UsuarioTeste;
let pacienteDeA: string;

beforeAll(async () => {
  [alunoA, alunoB, professor, admin, pesquisador] = await Promise.all([
    criarUsuario(ctx, "aluno"), criarUsuario(ctx, "aluno"), criarUsuario(ctx, "professor"),
    criarUsuario(ctx, "admin"), criarUsuario(ctx, "pesquisador"),
  ]);
  pacienteDeA = (await chamar(ctx, alunoA, "POST", "/pacientes", pacienteExemplo())).corpo.id;
});

describe("controle de acesso na API", () => {
  it("sem sessão, tudo exige autenticação", async () => {
    for (const url of ["/pacientes", `/pacientes/${pacienteDeA}`, "/usuarios", "/auditoria", "/esquemas/ficha-inicial"]) {
      expect((await chamar(ctx, null, "GET", url)).status, url).toBe(401);
    }
  });

  it("administrador e pesquisador não acessam dados clínicos identificados", async () => {
    for (const u of [admin, pesquisador]) {
      expect((await chamar(ctx, u, "GET", "/pacientes")).status).toBe(403);
      expect((await chamar(ctx, u, "GET", `/pacientes/${pacienteDeA}`)).status).toBe(403);
      expect((await chamar(ctx, u, "POST", "/pacientes", pacienteExemplo())).status).toBe(403);
    }
  });

  it("só o administrador gerencia usuários e consulta a auditoria", async () => {
    for (const u of [alunoA, professor, pesquisador]) {
      expect((await chamar(ctx, u, "GET", "/usuarios")).status).toBe(403);
      expect((await chamar(ctx, u, "GET", "/auditoria")).status).toBe(403);
    }
    expect((await chamar(ctx, admin, "GET", "/usuarios")).status).toBe(200);
    expect((await chamar(ctx, admin, "GET", "/auditoria")).status).toBe(200);
  });

  it("aluno só enxerga os próprios pacientes; professor enxerga todos", async () => {
    expect((await chamar(ctx, alunoB, "GET", `/pacientes/${pacienteDeA}`)).status).toBe(404);
    const listaB = (await chamar(ctx, alunoB, "GET", "/pacientes")).corpo as { id: string }[];
    expect(listaB.map((p) => p.id)).not.toContain(pacienteDeA);

    expect((await chamar(ctx, alunoA, "GET", `/pacientes/${pacienteDeA}`)).status).toBe(200);
    expect((await chamar(ctx, professor, "GET", `/pacientes/${pacienteDeA}`)).status).toBe(200);
  });

  it("aluno passa a ver o paciente quando o professor lhe atribui um atendimento", async () => {
    const r = await chamar(ctx, professor, "POST", `/pacientes/${pacienteDeA}/atendimentos`, {
      tipo: "retorno", aluno_id: alunoB.id,
    });
    expect(r.status).toBe(201);
    expect((await chamar(ctx, alunoB, "GET", `/pacientes/${pacienteDeA}`)).status).toBe(200);
  });

  it("aluno não consegue alterar paciente nem abrir atendimento de paciente alheio", async () => {
    const outro = (await chamar(ctx, alunoA, "POST", "/pacientes", pacienteExemplo())).corpo.id;
    expect((await chamar(ctx, alunoB, "PUT", `/pacientes/${outro}`, pacienteExemplo())).status).toBe(404);
    expect((await chamar(ctx, alunoB, "POST", `/pacientes/${outro}/atendimentos`, { tipo: "primeira_consulta" })).status).toBe(403);
  });
});

describe("Row-Level Security no banco (independente da API)", () => {
  it("o papel lord_app sem usuário na sessão não vê nenhuma linha clínica", async () => {
    const sqlApp = conectar(ctx.config.urlBanco, { max: 1 });
    try {
      expect(await sqlApp`select id from paciente`).toHaveLength(0);
      expect(await sqlApp`select id from ficha`).toHaveLength(0);
      expect(await sqlApp`select id from auditoria`).toHaveLength(0);
    } finally {
      await sqlApp.end();
    }
  });

  it("administrador, mesmo consultando o banco diretamente pelo papel da aplicação, não vê pacientes", async () => {
    const sqlApp = conectar(ctx.config.urlBanco, { max: 1 });
    try {
      const linhas = await comUsuario(sqlApp, admin.id, (tx) => tx`select id from paciente`);
      expect(linhas).toHaveLength(0);
      const auditoria = await comUsuario(sqlApp, admin.id, (tx) => tx`select id from auditoria limit 1`);
      expect(auditoria).toHaveLength(1);
    } finally {
      await sqlApp.end();
    }
  });

  it("o papel da aplicação não pode apagar pacientes nem alterar a auditoria", async () => {
    const sqlApp = conectar(ctx.config.urlBanco, { max: 1 });
    try {
      await expect(comUsuario(sqlApp, professor.id, (tx) => tx`delete from paciente where id = ${pacienteDeA}`))
        .rejects.toThrow(/permission denied/);
      await expect(comUsuario(sqlApp, admin.id, (tx) => tx`update auditoria set acao = 'x'`))
        .rejects.toThrow(/permission denied/);
    } finally {
      await sqlApp.end();
    }
  });
});
