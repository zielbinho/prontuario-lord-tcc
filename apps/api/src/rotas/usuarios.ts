import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { auditar } from "../auditoria";
import { exigir, gerarHashSenha, usuarioDe } from "../autenticacao";
import { comUsuario } from "../banco";
import { naoEncontrado } from "../erros";

const PAPEIS = ["aluno", "professor", "pesquisador", "admin"];

export function rotasUsuarios(app: FastifyInstance, sql: Sql): void {
  const somenteAdmin = { preValidation: exigir("admin") };

  app.get("/usuarios", somenteAdmin, async () =>
    sql`select id, nome, email, papel, ativo, criado_em from usuario order by nome`);

  // Professores podem ser escolhidos como supervisores ao abrir um atendimento
  app.get("/usuarios/professores", { preValidation: exigir("aluno", "professor") }, async () =>
    sql`select id, nome from usuario where papel = 'professor' and ativo order by nome`);

  // O professor escolhe o aluno responsável ao abrir um atendimento
  app.get("/usuarios/alunos", { preValidation: exigir("professor") }, async () =>
    sql`select id, nome from usuario where papel = 'aluno' and ativo order by nome`);

  app.post<{ Body: { nome: string; email: string; senha: string; papel: string } }>(
    "/usuarios",
    {
      ...somenteAdmin,
      schema: {
        body: {
          type: "object",
          required: ["nome", "email", "senha", "papel"],
          additionalProperties: false,
          properties: {
            nome: { type: "string", minLength: 2, maxLength: 200 },
            email: { type: "string", format: "email", maxLength: 200 },
            senha: { type: "string", minLength: 10, maxLength: 200 },
            papel: { enum: PAPEIS },
          },
        },
      },
    },
    async (req, resposta) => {
      const { nome, email, senha, papel } = req.body;
      const senhaHash = await gerarHashSenha(senha);
      const usuario = await comUsuario(sql, usuarioDe(req).id, async (tx) => {
        const [novo] = await tx`
          insert into usuario (nome, email, senha_hash, papel)
          values (${nome}, ${email}, ${senhaHash}, ${papel})
          returning id, nome, email, papel, ativo`;
        await auditar(tx, { usuarioId: usuarioDe(req).id, acao: "criar_usuario", entidade: "usuario", entidadeId: novo.id, detalhes: { papel }, ip: req.ip });
        return novo;
      });
      return resposta.code(201).send(usuario);
    },
  );

  app.patch<{ Params: { id: string }; Body: { ativo?: boolean; papel?: string } }>(
    "/usuarios/:id",
    {
      ...somenteAdmin,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: { ativo: { type: "boolean" }, papel: { enum: PAPEIS } },
        },
      },
    },
    async (req) =>
      comUsuario(sql, usuarioDe(req).id, async (tx) => {
        const { ativo, papel } = req.body;
        const [alterado] = await tx`
          update usuario set
            ativo = coalesce(${ativo ?? null}::boolean, ativo),
            papel = coalesce(${papel ?? null}::text, papel)
          where id = ${req.params.id}
          returning id, nome, email, papel, ativo`;
        if (!alterado) throw naoEncontrado("usuário não encontrado");
        if (ativo === false) await tx`delete from sessao where usuario_id = ${req.params.id}`;
        await auditar(tx, { usuarioId: usuarioDe(req).id, acao: "alterar_usuario", entidade: "usuario", entidadeId: alterado.id, detalhes: req.body, ip: req.ip });
        return alterado;
      }),
  );
}
