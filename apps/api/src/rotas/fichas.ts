import { ESQUEMAS, completude, validar, type TipoDocumento } from "@lord/ficha";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PendingQuery, Row, Sql } from "postgres";
import { auditar } from "../auditoria";
import { exigir, usuarioDe } from "../autenticacao";
import { comUsuario, type Transacao } from "../banco";
import { ErroHttp, conflito, naoEncontrado } from "../erros";

type TipoFicha = "ficha-inicial" | "ficha-retorno";

const TIPO_FICHA_POR_ATENDIMENTO: Record<string, TipoFicha> = {
  primeira_consulta: "ficha-inicial",
  retorno: "ficha-retorno",
};

const COLUNAS_FICHA = `
  f.id, f.atendimento_id, f.tipo, f.schema_versao, f.versao, f.ficha_anterior_id, f.dados, f.status,
  f.completude, f.comentario_revisao, f.preenchido_por, f.aprovado_por, f.aprovado_em, f.criado_em, f.atualizado_em`;

function validarDocumento(tipo: TipoDocumento, dados: unknown) {
  const r = validar(tipo, dados);
  if (!r.valido) throw new ErroHttp(400, "dados não conformes ao esquema", r.erros);
}

export function rotasFichas(app: FastifyInstance, sql: Sql): void {
  const clinicos = { preValidation: exigir("aluno", "professor") };
  const somenteProfessor = { preValidation: exigir("professor") };
  const executar = <T>(req: FastifyRequest, fn: (tx: Transacao) => Promise<T>) =>
    comUsuario(sql, usuarioDe(req).id, fn);

  async function buscarFicha(tx: Transacao, id: string) {
    const [ficha] = await tx.unsafe(`select ${COLUNAS_FICHA} from ficha f where f.id = $1`, [id]);
    if (!ficha) throw naoEncontrado("ficha não encontrada");
    return ficha;
  }

  // --------------------------------------------------------------------------
  // Atendimentos
  // --------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>("/pacientes/:id/atendimentos", clinicos, async (req) =>
    executar(req, (tx) => tx`
      select a.id, a.data, a.tipo, a.aluno_id, al.nome as aluno, a.professor_id, pr.nome as professor,
             coalesce(json_agg(json_build_object(
               'id', f.id, 'tipo', f.tipo, 'versao', f.versao, 'status', f.status, 'completude', f.completude)
               order by f.versao) filter (where f.id is not null), '[]') as fichas
      from atendimento a
      join usuario al on al.id = a.aluno_id
      left join usuario pr on pr.id = a.professor_id
      left join ficha f on f.atendimento_id = a.id
      where a.paciente_id = ${req.params.id}
      group by a.id, al.nome, pr.nome
      order by a.data desc, a.criado_em desc`),
  );

  app.post<{ Params: { id: string }; Body: { data?: string; tipo: string; professor_id?: string; aluno_id?: string } }>(
    "/pacientes/:id/atendimentos",
    {
      ...clinicos,
      schema: {
        body: {
          type: "object",
          required: ["tipo"],
          additionalProperties: false,
          properties: {
            data: { type: "string", format: "date" },
            tipo: { enum: ["primeira_consulta", "retorno"] },
            professor_id: { type: "string", format: "uuid" },
            aluno_id: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (req, resposta) => {
      const eu = usuarioDe(req);
      // O aluno sempre abre atendimentos em seu próprio nome; o professor indica o aluno
      const alunoId = eu.papel === "aluno" ? eu.id : req.body.aluno_id;
      if (!alunoId) throw new ErroHttp(400, "informe o aluno responsável pelo atendimento");
      const professorId = eu.papel === "professor" ? eu.id : (req.body.professor_id ?? null);
      const tipoFicha = TIPO_FICHA_POR_ATENDIMENTO[req.body.tipo];

      const criado = await executar(req, async (tx) => {
        const [atendimento] = await tx`
          insert into atendimento (paciente_id, data, tipo, aluno_id, professor_id)
          values (${req.params.id}, coalesce(${req.body.data ?? null}::date, current_date), ${req.body.tipo},
                  ${alunoId}, ${professorId})
          returning id, paciente_id, data, tipo, aluno_id, professor_id`;
        const [ficha] = await tx`
          insert into ficha (atendimento_id, tipo, schema_versao, preenchido_por, completude)
          values (${atendimento.id}, ${tipoFicha}, ${ESQUEMAS[tipoFicha].$id as string}, ${eu.id}, 0)
          returning id, tipo, versao, status`;
        await auditar(tx, { usuarioId: eu.id, acao: "abrir_atendimento", entidade: "atendimento", entidadeId: atendimento.id, detalhes: { tipo: atendimento.tipo }, ip: req.ip });
        return { ...atendimento, ficha };
      });
      return resposta.code(201).send(criado);
    },
  );

  app.get<{ Params: { id: string } }>("/atendimentos/:id/odontograma", clinicos, async (req) =>
    executar(req, async (tx) => {
      const [o] = await tx`select dados, atualizado_em from odontograma where atendimento_id = ${req.params.id}`;
      return o ?? { dados: {}, atualizado_em: null };
    }),
  );

  app.put<{ Params: { id: string }; Body: { dados: unknown } }>(
    "/atendimentos/:id/odontograma",
    { ...clinicos, schema: { body: { type: "object", required: ["dados"], properties: { dados: { type: "object" } } } } },
    async (req) => {
      validarDocumento("odontograma", req.body.dados);
      const eu = usuarioDe(req);
      return executar(req, async (tx) => {
        const [o] = await tx`
          insert into odontograma (atendimento_id, dados, atualizado_por)
          values (${req.params.id}, ${tx.json(req.body.dados as never)}, ${eu.id})
          on conflict (atendimento_id) do update set dados = excluded.dados,
            atualizado_por = excluded.atualizado_por, atualizado_em = now()
          returning dados, atualizado_em`;
        await auditar(tx, { usuarioId: eu.id, acao: "alterar_odontograma", entidade: "atendimento", entidadeId: req.params.id, ip: req.ip });
        return o;
      });
    },
  );

  // --------------------------------------------------------------------------
  // Fichas
  // --------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>("/fichas/:id", clinicos, async (req) =>
    executar(req, async (tx) => {
      const ficha = await buscarFicha(tx, req.params.id);
      const [atendimento] = await tx`
        select a.id, a.data, a.tipo, a.paciente_id, p.nome as paciente, al.nome as aluno, pr.nome as professor
        from atendimento a
        join paciente p on p.id = a.paciente_id
        join usuario al on al.id = a.aluno_id
        left join usuario pr on pr.id = a.professor_id
        where a.id = ${ficha.atendimento_id}`;
      await auditar(tx, { usuarioId: usuarioDe(req).id, acao: "ler_ficha", entidade: "ficha", entidadeId: ficha.id, ip: req.ip });
      return { ...ficha, atendimento, completude_detalhada: completude(ficha.tipo, ficha.dados) };
    }),
  );

  app.get<{ Params: { id: string } }>("/fichas/:id/versoes", clinicos, async (req) =>
    executar(req, async (tx) => {
      const ficha = await buscarFicha(tx, req.params.id);
      return tx`
        select id, versao, status, aprovado_em, criado_em from ficha
        where atendimento_id = ${ficha.atendimento_id} and tipo = ${ficha.tipo}
        order by versao`;
    }),
  );

  app.put<{ Params: { id: string }; Body: { dados: Record<string, unknown> } }>(
    "/fichas/:id",
    { ...clinicos, schema: { body: { type: "object", required: ["dados"], properties: { dados: { type: "object" } } } } },
    async (req) =>
      executar(req, async (tx) => {
        const ficha = await buscarFicha(tx, req.params.id);
        if (ficha.status !== "rascunho") throw conflito(`a ficha está "${ficha.status}" e não pode ser editada`);
        validarDocumento(ficha.tipo, req.body.dados);
        const c = completude(ficha.tipo, req.body.dados);
        const [atualizada] = await tx.unsafe(
          `update ficha f set dados = $2, completude = $3 where f.id = $1 returning ${COLUNAS_FICHA}`,
          [ficha.id, tx.json(req.body.dados as never), c.fracao],
        );
        const anterior = ficha.dados as Record<string, unknown>;
        const secoesAlteradas = [...new Set([...Object.keys(anterior), ...Object.keys(req.body.dados)])].filter(
          (s) => JSON.stringify(anterior[s]) !== JSON.stringify(req.body.dados[s]),
        );
        await auditar(tx, { usuarioId: usuarioDe(req).id, acao: "alterar_ficha", entidade: "ficha", entidadeId: ficha.id, detalhes: { secoes: secoesAlteradas }, ip: req.ip });
        return { ...atualizada, completude_detalhada: c };
      }),
  );

  /** Transição de status atômica: só altera se a ficha ainda estiver no status esperado. */
  async function transicionar(
    req: FastifyRequest<{ Params: { id: string } }>,
    de: string,
    para: string,
    acao: string,
    camposExtras?: (tx: Transacao) => PendingQuery<Row[]>,
  ) {
    return executar(req, async (tx) => {
      const ficha = await buscarFicha(tx, req.params.id);
      if (ficha.status !== de) throw conflito(`a ficha está "${ficha.status}"; esperado "${de}"`);
      const [atualizada] = await tx`
        update ficha set status = ${para} ${camposExtras ? tx`, ${camposExtras(tx)}` : tx``}
        where id = ${ficha.id} and status = ${de}
        returning id, status, versao, completude, comentario_revisao, aprovado_por, aprovado_em`;
      if (!atualizada) throw conflito("a ficha foi alterada por outra pessoa; recarregue");
      await auditar(tx, { usuarioId: usuarioDe(req).id, acao, entidade: "ficha", entidadeId: ficha.id, ip: req.ip });
      return atualizada;
    });
  }

  app.post<{ Params: { id: string } }>("/fichas/:id/enviar", clinicos, async (req) =>
    transicionar(req, "rascunho", "em_revisao", "enviar_ficha_revisao"),
  );

  app.post<{ Params: { id: string }; Body: { comentario: string } }>(
    "/fichas/:id/devolver",
    {
      ...somenteProfessor,
      schema: {
        body: {
          type: "object",
          required: ["comentario"],
          additionalProperties: false,
          properties: { comentario: { type: "string", minLength: 3, maxLength: 2000 } },
        },
      },
    },
    async (req) =>
      transicionar(req, "em_revisao", "rascunho", "devolver_ficha", (tx) => tx`comentario_revisao = ${req.body.comentario}`),
  );

  app.post<{ Params: { id: string } }>("/fichas/:id/aprovar", somenteProfessor, async (req) =>
    transicionar(req, "em_revisao", "aprovada", "aprovar_ficha",
      (tx) => tx`aprovado_por = ${usuarioDe(req).id}, aprovado_em = now(), comentario_revisao = null`),
  );

  app.post<{ Params: { id: string } }>("/fichas/:id/adendo", clinicos, async (req, resposta) => {
    const eu = usuarioDe(req);
    const adendo = await executar(req, async (tx) => {
      const ficha = await buscarFicha(tx, req.params.id);
      if (ficha.status !== "aprovada") throw conflito("adendos só podem ser feitos sobre fichas aprovadas");
      const [aberta] = await tx`
        select id from ficha
        where atendimento_id = ${ficha.atendimento_id} and tipo = ${ficha.tipo} and status <> 'aprovada'`;
      if (aberta) throw conflito("já existe uma versão em edição desta ficha");
      const [{ proxima }] = await tx`
        select max(versao) + 1 as proxima from ficha
        where atendimento_id = ${ficha.atendimento_id} and tipo = ${ficha.tipo}`;
      const [nova] = await tx.unsafe(
        `insert into ficha (atendimento_id, tipo, schema_versao, versao, ficha_anterior_id, dados, completude, preenchido_por)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning id, atendimento_id, tipo, versao, ficha_anterior_id, status`,
        [ficha.atendimento_id, ficha.tipo, ficha.schema_versao, proxima, ficha.id, tx.json(ficha.dados), ficha.completude, eu.id],
      );
      await auditar(tx, { usuarioId: eu.id, acao: "criar_adendo", entidade: "ficha", entidadeId: nova.id, detalhes: { ficha_anterior: ficha.id }, ip: req.ip });
      return nova;
    });
    return resposta.code(201).send(adendo);
  });

  // Fila de revisão do professor
  app.get("/revisao", somenteProfessor, async (req) =>
    executar(req, (tx) => tx`
      select f.id, f.tipo, f.versao, f.completude, f.atualizado_em, a.data, a.paciente_id, p.nome as paciente,
             u.nome as aluno
      from ficha f
      join atendimento a on a.id = f.atendimento_id
      join paciente p on p.id = a.paciente_id
      join usuario u on u.id = a.aluno_id
      where f.status = 'em_revisao'
      order by f.atualizado_em`),
  );
}
