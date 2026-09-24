import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { auditar } from "../auditoria";
import { exigir, usuarioDe } from "../autenticacao";
import { comUsuario } from "../banco";
import { ErroHttp, naoEncontrado } from "../erros";

/** Uma ficha da série de um paciente, só com as seções usadas nos indicadores (sem texto livre). */
export interface FichaSerie {
  dias: number;
  tipo_ficha: string;
  dados: Record<string, unknown>;
}

/** Serviço analítico (services/analitico); nos testes é substituído por uma versão falsa. */
export interface ServicoAnalitico {
  coorte(): Promise<unknown>;
  qualidade(): Promise<unknown>;
  /** CSV pseudonimizado, uma linha por ficha aprovada */
  exportacao(): Promise<string>;
  evolucao(fichas: FichaSerie[]): Promise<{ consultas: Record<string, unknown>[] }>;
}

export function analiticoHttp(url: string): ServicoAnalitico {
  const chamar = async (caminho: string, corpo?: unknown, comoTexto = false) => {
    let resposta: Response;
    try {
      resposta = await fetch(`${url}${caminho}`, {
        method: corpo ? "POST" : "GET",
        headers: corpo ? { "Content-Type": "application/json" } : undefined,
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      throw new ErroHttp(502, `serviço analítico indisponível: ${(e as Error).message}`);
    }
    if (!resposta.ok) throw new ErroHttp(502, `serviço analítico respondeu ${resposta.status}`);
    return comoTexto ? resposta.text() : resposta.json();
  };
  return {
    coorte: () => chamar("/coorte"),
    qualidade: () => chamar("/qualidade"),
    exportacao: () => chamar("/exportacao", undefined, true),
    evolucao: (fichas) => chamar("/evolucao", { fichas }),
  };
}

// seções que os indicadores individuais usam; o resto da ficha não sai da API
const SECOES_INDICADORES = ["questionario_dtm", "exame_dtm", "dor", "exame"];

export function rotasAnalise(app: FastifyInstance, sql: Sql, analitico: ServicoAnalitico): void {
  // Painéis de coorte: dados agregados e pseudonimizados, para quem acompanha ou pesquisa a Liga
  app.get("/analise/coorte", { preValidation: exigir("professor", "pesquisador") }, async (req) => {
    const resultado = await analitico.coorte();
    await auditar(sql, { usuarioId: usuarioDe(req).id, acao: "ler_painel_coorte", ip: req.ip });
    return resultado;
  });

  app.get("/analise/qualidade", { preValidation: exigir("professor", "pesquisador", "admin") }, async (req) => {
    const resultado = await analitico.qualidade();
    await auditar(sql, { usuarioId: usuarioDe(req).id, acao: "ler_painel_qualidade", ip: req.ip });
    return resultado;
  });

  // Exportação para análises externas: os mesmos dados pseudonimizados dos painéis, em CSV
  app.get("/analise/exportacao.csv", { preValidation: exigir("professor", "pesquisador") }, async (req, resposta) => {
    const csv = await analitico.exportacao();
    await auditar(sql, {
      usuarioId: usuarioDe(req).id, acao: "exportar_dados_pseudonimizados",
      detalhes: { linhas: Math.max(0, csv.trim().split("\n").length - 1) }, ip: req.ip,
    });
    const data = new Date().toISOString().slice(0, 10);
    return resposta
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="lord-pseudonimizado-${data}.csv"`)
      .send(csv);
  });

  // Painel do paciente: a RLS decide se o usuário pode ver o paciente (aluno só vê os seus)
  app.get<{ Params: { id: string } }>("/pacientes/:id/evolucao", { preValidation: exigir("aluno", "professor") }, async (req) => {
    const eu = usuarioDe(req);
    const { fichas, tratamentos } = await comUsuario(sql, eu.id, async (tx) => {
      const [paciente] = await tx`select id from paciente where id = ${req.params.id}`;
      if (!paciente) throw naoEncontrado("paciente não encontrado");
      // fichas aprovadas, na versão vigente (um adendo aprovado substitui a versão anterior)
      const fichas = await tx`
        select f.id, f.tipo, a.data, f.dados
        from ficha f join atendimento a on a.id = f.atendimento_id
        where a.paciente_id = ${req.params.id} and f.status = 'aprovada'
          and not exists (select 1 from ficha g where g.ficha_anterior_id = f.id and g.status = 'aprovada')
        order by a.data, f.criado_em`;
      const tratamentos = await tx`
        select categoria, inicio, fim from tratamento where paciente_id = ${req.params.id} order by inicio`;
      await auditar(tx, { usuarioId: eu.id, acao: "ler_evolucao", entidade: "paciente", entidadeId: req.params.id, ip: req.ip });
      return { fichas, tratamentos };
    });
    if (fichas.length === 0) return { consultas: [], tratamentos };

    const inicio = new Date(fichas[0].data).getTime();
    const dias = (d: Date) => Math.round((new Date(d).getTime() - inicio) / 86_400_000);
    const serie: FichaSerie[] = fichas.map((f) => ({
      dias: dias(f.data),
      tipo_ficha: f.tipo,
      dados: Object.fromEntries(SECOES_INDICADORES.filter((s) => s in f.dados).map((s) => [s, f.dados[s]])),
    }));
    const { consultas } = await analitico.evolucao(serie);
    if (consultas.length !== fichas.length) throw new ErroHttp(502, "resposta inesperada do serviço analítico");
    // a série já vai em ordem de data e o serviço ordena de forma estável: a posição identifica a ficha.
    // A data real e a palpação ficam do lado da API (uso clínico, com a RLS já aplicada).
    return {
      consultas: consultas.map((c, i) => {
        const f = fichas[i];
        const exame = (f.dados.exame_dtm ?? f.dados.exame ?? {}) as Record<string, unknown>;
        return {
          ...c, ficha_id: f.id, data: f.data,
          palpacao: { q44_palpacao_muscular: exame.q44_palpacao_muscular ?? null, q45_palpacao_articular: exame.q45_palpacao_articular ?? null },
        };
      }),
      tratamentos,
    };
  });
}
