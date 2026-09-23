import { ESQUEMAS, type TipoDocumento } from "@lord/ficha";
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { exigir, usuarioDe } from "../autenticacao";
import { comUsuario } from "../banco";
import { naoEncontrado } from "../erros";

export function rotasAuditoria(app: FastifyInstance, sql: Sql): void {
  // A política de RLS da tabela também restringe a leitura ao administrador
  app.get<{ Querystring: { entidade_id?: string; usuario_id?: string; limite?: number } }>(
    "/auditoria",
    {
      preHandler: exigir("admin"),
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            entidade_id: { type: "string", format: "uuid" },
            usuario_id: { type: "string", format: "uuid" },
            limite: { type: "integer", minimum: 1, maximum: 1000, default: 200 },
          },
        },
      },
    },
    async (req) =>
      comUsuario(sql, usuarioDe(req).id, (tx) => {
        const { entidade_id, usuario_id, limite = 200 } = req.query;
        return tx`
          select a.id, a.em, a.usuario_id, u.nome as usuario, a.acao, a.entidade, a.entidade_id, a.detalhes, a.ip
          from auditoria a left join usuario u on u.id = a.usuario_id
          where (${entidade_id ?? null}::uuid is null or a.entidade_id = ${entidade_id ?? null}::uuid)
            and (${usuario_id ?? null}::uuid is null or a.usuario_id = ${usuario_id ?? null}::uuid)
          order by a.id desc
          limit ${limite}`;
      }),
  );
}

export function rotasEsquemas(app: FastifyInstance): void {
  // A interface monta os formulários a partir dos mesmos esquemas usados na validação
  app.get<{ Params: { tipo: string } }>("/esquemas/:tipo", { preHandler: exigir() }, async (req) => {
    const tipo = req.params.tipo as TipoDocumento | "comum";
    if (!(tipo in ESQUEMAS)) throw naoEncontrado("esquema não encontrado");
    return ESQUEMAS[tipo];
  });
}
