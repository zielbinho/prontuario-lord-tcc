import { SecaoNaoPermitidaParaIA } from "@lord/ficha";
import { ErroModelo, estruturar, type ClienteModelo } from "@lord/ia";
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { auditar } from "../auditoria";
import { exigir, usuarioDe } from "../autenticacao";
import { comUsuario } from "../banco";
import { ErroHttp, conflito, naoEncontrado } from "../erros";

export interface ResultadoTranscricao {
  texto: string;
  duracao_audio_s: number;
  tempo_processamento_s: number;
  modelo: string;
}

/** Dependências de IA; nos testes são substituídas por versões falsas e determinísticas. */
export interface ServicosIA {
  cliente: ClienteModelo;
  modelo: string;
  transcrever: (audio: Buffer, tipoConteudo: string) => Promise<ResultadoTranscricao>;
}

/** Transcrição pelo serviço Python local (services/transcricao). O áudio não é guardado em lugar nenhum. */
export function transcritorHttp(url: string): ServicosIA["transcrever"] {
  return async (audio, tipoConteudo) => {
    let resposta: Response;
    try {
      resposta = await fetch(`${url}/transcrever`, {
        method: "POST",
        headers: { "Content-Type": tipoConteudo },
        body: new Uint8Array(audio),
        signal: AbortSignal.timeout(300_000),
      });
    } catch (e) {
      throw new ErroHttp(502, `serviço de transcrição indisponível: ${(e as Error).message}`);
    }
    if (!resposta.ok) throw new ErroHttp(resposta.status === 422 ? 422 : 502, "não foi possível transcrever o áudio");
    return (await resposta.json()) as ResultadoTranscricao;
  };
}

const DECISOES = ["aceita", "editada", "rejeitada"];
export const TAMANHO_MAXIMO_AUDIO = 25 * 1024 * 1024;

export function rotasIA(app: FastifyInstance, sql: Sql, ia: ServicosIA): void {
  const clinicos = { preValidation: exigir("aluno", "professor") };

  // O corpo de /transcricoes é o próprio áudio (audio/webm, audio/wav, ...)
  app.addContentTypeParser(/^audio\//, { parseAs: "buffer", bodyLimit: TAMANHO_MAXIMO_AUDIO }, (_req, corpo, feito) =>
    feito(null, corpo),
  );

  app.post("/transcricoes", clinicos, async (req) => {
    const tipo = req.headers["content-type"] ?? "";
    if (!tipo.startsWith("audio/") || !Buffer.isBuffer(req.body)) throw new ErroHttp(415, "envie o áudio com Content-Type audio/*");
    const resultado = await ia.transcrever(req.body, tipo);
    // a auditoria registra só a duração: nem o áudio nem o texto
    await auditar(sql, {
      usuarioId: usuarioDe(req).id, acao: "transcrever_audio",
      detalhes: { duracao_audio_s: resultado.duracao_audio_s }, ip: req.ip,
    });
    return resultado;
  });

  app.post<{ Params: { id: string }; Body: { secao: string; relato: string; origem?: "texto" | "audio" } }>(
    "/fichas/:id/sugestoes",
    {
      ...clinicos,
      schema: {
        body: {
          type: "object",
          required: ["secao", "relato"],
          additionalProperties: false,
          properties: {
            secao: { type: "string", maxLength: 100 },
            relato: { type: "string", minLength: 1, maxLength: 20000 },
            origem: { enum: ["texto", "audio"] },
          },
        },
      },
    },
    async (req, resposta) => {
      const eu = usuarioDe(req);
      const { secao, relato, origem = "texto" } = req.body;

      // confere acesso (RLS) e status antes de gastar tempo com o modelo
      const ficha = await comUsuario(sql, eu.id, async (tx) => {
        const [f] = await tx`select id, tipo, status from ficha where id = ${req.params.id}`;
        return f;
      });
      if (!ficha) throw naoEncontrado("ficha não encontrada");
      if (ficha.status !== "rascunho") throw conflito("sugestões só podem ser geradas para fichas em rascunho");
      if (ficha.tipo !== "ficha-inicial") throw new ErroHttp(400, "a estruturação por IA está disponível para a ficha inicial");

      let resultado;
      try {
        resultado = await estruturar(ia.cliente, { secoes: [secao], relato, modelo: ia.modelo });
      } catch (e) {
        if (e instanceof SecaoNaoPermitidaParaIA) throw new ErroHttp(400, e.message);
        if (e instanceof ErroModelo) throw new ErroHttp(502, `falha no modelo de linguagem: ${e.message}`);
        if (e instanceof Error && e.message.startsWith("Seção inexistente")) throw new ErroHttp(400, e.message);
        throw e;
      }

      const registro = await comUsuario(sql, eu.id, async (tx) => {
        const [s] = await tx`
          insert into sugestao_ia (ficha_id, secao, origem, transcricao, modelo, versao_prompt, saida, latencia_ms, criado_por)
          values (${ficha.id}, ${secao}, ${origem}, ${relato}, ${resultado.modelo}, ${resultado.versaoPrompt},
                  ${tx.json(resultado.saida as never)}, ${resultado.latenciaMs}, ${eu.id})
          returning id`;
        // a auditoria guarda apenas contagens: o relato e os valores ficam na tabela protegida por RLS
        await auditar(tx, {
          usuarioId: eu.id, acao: "gerar_sugestoes_ia", entidade: "ficha", entidadeId: ficha.id,
          detalhes: { secao, origem, sugestoes: resultado.sugestoes.length, descartados: resultado.descartados.length, modelo: resultado.modelo },
          ip: req.ip,
        });
        return s;
      });

      return resposta.code(201).send({
        id: registro.id,
        secao,
        sugestoes: resultado.sugestoes,
        descartados: resultado.descartados,
        modelo: resultado.modelo,
        versao_prompt: resultado.versaoPrompt,
        latencia_ms: resultado.latenciaMs,
      });
    },
  );

  // Decisão humana sobre cada sugestão: base da "taxa de aceitação" do TCC
  app.post<{ Params: { id: string }; Body: { decisoes: Record<string, string> } }>(
    "/sugestoes/:id/decisoes",
    {
      ...clinicos,
      schema: {
        body: {
          type: "object",
          required: ["decisoes"],
          additionalProperties: false,
          properties: {
            decisoes: { type: "object", minProperties: 1, maxProperties: 200, additionalProperties: { enum: DECISOES } },
          },
        },
      },
    },
    async (req) =>
      comUsuario(sql, usuarioDe(req).id, async (tx) => {
        const [s] = await tx`
          update sugestao_ia set decisoes = decisoes || ${tx.json(req.body.decisoes)}
          where id = ${req.params.id}
          returning id, decisoes`;
        if (!s) throw naoEncontrado("sugestão não encontrada");
        const contagem = Object.values(req.body.decisoes).reduce<Record<string, number>>((acc, d) => ({ ...acc, [d]: (acc[d] ?? 0) + 1 }), {});
        await auditar(tx, { usuarioId: usuarioDe(req).id, acao: "decidir_sugestoes_ia", entidade: "sugestao_ia", entidadeId: s.id, detalhes: contagem, ip: req.ip });
        return s;
      }),
  );
}
