import { rotulo } from "@lord/ficha";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type GrupoTratamento, type Qualidade, type ResumoCoorte } from "../api";
import { useUsuario } from "../autenticacao";
import { BarrasHorizontais, Boxplot } from "../componentes/graficos";
import { Cartao, Carregando, MensagemErro, Vazio, classes } from "../componentes/ui";

// a cor segue o tratamento (entidade), nunca a posição: um filtro não repinta os grupos
const COR_TRATAMENTO: Record<string, string> = {
  placa_oclusal: "var(--color-serie-1)",
  laser_baixa_intensidade: "var(--color-serie-2)",
  orientacoes_autocuidado: "var(--color-serie-3)",
};
const corDe = (grupo: string) => COR_TRATAMENTO[grupo] ?? "var(--color-suave)";
// ordem fixa dos grupos (a mesma das cores); outras categorias vêm depois, em ordem alfabética
const ordemGrupo = (g: string) => { const i = Object.keys(COR_TRATAMENTO).indexOf(g); return i < 0 ? 99 : i; };
const SECOES: Record<string, string> = {
  queixa_principal: "Queixa principal", historia_medica: "História médica", historia_odontologica: "História odontológica",
  protese: "Prótese", observacoes: "Observações",
};

const CARACTERISTICAS: Record<string, string> = {
  estalido: "Estalido", crepitacao: "Crepitação", apertamento_rangido_noturno: "Apertamento noturno",
  apertamento_rangido_diurno: "Apertamento diurno", mordida_desconfortavel: "Mordida desconfortável",
  rigidez_pela_manha: "Rigidez matinal", zumbido: "Zumbido", cefaleia_6m: "Cefaleia (6 meses)",
};
const DIAGNOSTICOS: Record<string, string> = {
  grupo1_muscular: "Grupo I (muscular)", grupo2_disco_direita: "Grupo II, lado direito", grupo2_disco_esquerda: "Grupo II, lado esquerdo",
  grupo3_articular_direita: "Grupo III, lado direito", grupo3_articular_esquerda: "Grupo III, lado esquerdo",
};
const MEDIDAS: Record<string, string> = {
  icd: "Intensidade da dor", sitios_dolorosos: "Sítios dolorosos", atividades_limitadas: "Atividades limitadas",
  escore_incapacidade: "Escore de incapacidade", abertura_max_mm: "Abertura máxima",
};

const num = (v: number | null | undefined, casas = 1) =>
  v === null || v === undefined ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const valorP = (p: number | null) => (p === null ? "—" : p < 0.001 ? "< 0,001" : num(p, 3));

function Numero({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-lg border border-borda bg-superficie px-4 py-3">
      <p className="text-xs text-suave">{titulo}</p>
      <p className="text-2xl font-semibold tabular-nums">{valor}</p>
    </div>
  );
}

function Marcador({ grupo }: { grupo: string }) {
  return <span className="mr-2 inline-block size-2.5 rounded-sm align-middle" style={{ background: corDe(grupo) }} aria-hidden="true" />;
}

function TabelaTratamentos({ grupos, abandono }: { grupos: GrupoTratamento[]; abandono: ResumoCoorte["abandono"] }) {
  const aband = Object.fromEntries(abandono.map((a) => [a.grupo, a.abandono_pct]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Variação da intensidade da dor por tratamento</caption>
        <thead className="text-left text-xs text-suave">
          <tr>
            <th className="pb-2 font-medium">Tratamento</th><th className="pb-2 text-right font-medium">n</th>
            <th className="pb-2 text-right font-medium">ICD inicial → final (mediana)</th>
            <th className="pb-2 text-right font-medium">Redução média (IC 95%)</th>
            <th className="pb-2 text-right font-medium">≥ 30%</th><th className="pb-2 text-right font-medium">≥ 50%</th>
            <th className="pb-2 text-right font-medium">p (Wilcoxon)</th><th className="pb-2 text-right font-medium">r</th>
            <th className="pb-2 text-right font-medium">Abandono</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-borda tabular-nums">
          {grupos.map((g) => (
            <tr key={g.grupo}>
              <td className="py-2"><Marcador grupo={g.grupo} />{rotulo(g.grupo)}</td>
              <td className="py-2 text-right">{g.n}</td>
              <td className="py-2 text-right">{num(g.base_mediana, 0)} → {num(g.final_mediana, 0)}</td>
              <td className="py-2 text-right">{num(g.reducao_media_pct)}% ({num(g.reducao_ic95[0])} a {num(g.reducao_ic95[1])})</td>
              <td className="py-2 text-right">{num(g.respondedores_30_pct, 0)}%</td>
              <td className="py-2 text-right">{num(g.respondedores_50_pct, 0)}%</td>
              <td className="py-2 text-right">{valorP(g.wilcoxon_p)}</td>
              <td className="py-2 text-right">{num(g.efeito_rank_biserial, 2)}</td>
              <td className="py-2 text-right">{num(aband[g.grupo], 0)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PainelCoorte() {
  const coorte = useQuery({ queryKey: ["analise", "coorte"], queryFn: () => api.get<ResumoCoorte>("/analise/coorte") });
  const [somenteConcluintes, setSomenteConcluintes] = useState(true);

  if (coorte.isPending) return <Cartao><Carregando /></Cartao>;
  if (coorte.isError) return <Cartao><MensagemErro erro={coorte.error} /></Cartao>;
  const d = coorte.data;
  const comparacao = somenteConcluintes ? d.tratamentos_concluintes : d.tratamentos;
  const grupos = [...comparacao.grupos].sort((a, b) => ordemGrupo(a.grupo) - ordemGrupo(b.grupo) || a.grupo.localeCompare(b.grupo));
  if (!grupos.length) return <Cartao titulo="Coorte"><Vazio>Ainda não há pacientes com tratamento e retorno aprovados.</Vazio></Cartao>;
  const variacoes = d.variacoes.filter((v) => !somenteConcluintes || v.concluiu);
  const entre = comparacao.entre_grupos;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Numero titulo="Pacientes" valor={String(d.pacientes)} />
        <Numero titulo="Fichas iniciais aprovadas" valor={String(d.fichas["ficha-inicial"] ?? 0)} />
        <Numero titulo="Fichas de retorno aprovadas" valor={String(d.fichas["ficha-retorno"] ?? 0)} />
      </div>

      <Cartao titulo="Variação da dor por tratamento"
        acoes={
          <div role="radiogroup" aria-label="Pacientes considerados" className="flex rounded-lg border border-borda p-0.5 text-sm">
            {[[true, "Concluíram o tratamento"], [false, "Todos com retorno"]].map(([valor, texto]) => (
              <button key={String(valor)} type="button" role="radio" aria-checked={somenteConcluintes === valor}
                onClick={() => setSomenteConcluintes(valor as boolean)}
                className={classes("min-h-8 rounded-md px-3", somenteConcluintes === valor ? "bg-marca-50 font-medium text-destaque" : "text-suave hover:text-texto")}>
                {texto as string}
              </button>
            ))}
          </div>
        }>
        <div className="space-y-4">
          <Boxplot rotuloY="Redução da intensidade da dor" referencia={{ valor: 30, rotulo: "melhora de 30% (IMMPACT)" }}
            grupos={grupos.map((g) => ({
              chave: g.grupo, nome: rotulo(g.grupo), cor: corDe(g.grupo),
              valores: variacoes.filter((v) => v.grupo === g.grupo).map((v) => v.variacao_rel),
            }))} />
          <TabelaTratamentos grupos={grupos} abandono={d.abandono} />
          <p className="text-xs text-suave">
            Redução relativa da intensidade característica da dor (ICD) entre a primeira consulta e o último retorno aprovado.
            Wilcoxon pareado por grupo, com correlação rank-bisserial (r); entre grupos, Kruskal-Wallis:
            H = {num(entre.h, 2)}, p {valorP(entre.p).startsWith("<") ? valorP(entre.p) : `= ${valorP(entre.p)}`}, ε² = {num(entre.epsilon2, 3)}.
            Abandono: tratamento em aberto e sem retorno há mais de 60 dias.
          </p>
        </div>
      </Cartao>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Cartao titulo="Características relatadas na primeira consulta">
          <BarrasHorizontais itens={d.prevalencias.filter((p) => p.prevalencia_pct !== null).sort((a, b) => b.prevalencia_pct! - a.prevalencia_pct!)
            .map((p) => ({ rotulo: CARACTERISTICAS[p.caracteristica] ?? p.caracteristica, valor: p.prevalencia_pct!, detalhe: `${p.n} pacientes com resposta` }))} />
        </Cartao>
        <Cartao titulo="Diagnósticos do Eixo I (registrados pelos professores)">
          <dl className="space-y-3 text-sm">
            {Object.entries(d.diagnosticos).map(([grupo, contagem]) => (
              <div key={grupo}>
                <dt className="text-xs text-suave">{DIAGNOSTICOS[grupo] ?? grupo}</dt>
                <dd className="flex flex-wrap gap-x-4 tabular-nums">
                  {Object.entries(contagem).sort((a, b) => b[1] - a[1]).map(([codigo, n]) => <span key={codigo}>{rotulo(codigo)}: {n}</span>)}
                </dd>
              </div>
            ))}
          </dl>
        </Cartao>
      </div>

      <Cartao titulo="Correlações na primeira consulta (Spearman)">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-suave">
            <tr><th className="pb-2 font-medium">Medidas</th><th className="pb-2 text-right font-medium">n</th><th className="pb-2 text-right font-medium">ρ</th><th className="pb-2 text-right font-medium">p</th></tr>
          </thead>
          <tbody className="divide-y divide-borda tabular-nums">
            {d.correlacoes.map((c) => (
              <tr key={`${c.x}-${c.y}`}>
                <td className="py-1.5">{MEDIDAS[c.x]} × {MEDIDAS[c.y]}</td>
                <td className="py-1.5 text-right">{c.n}</td><td className="py-1.5 text-right">{num(c.rho, 2)}</td><td className="py-1.5 text-right">{valorP(c.p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Cartao>
    </div>
  );
}

function PainelQualidade() {
  const q = useQuery({ queryKey: ["analise", "qualidade"], queryFn: () => api.get<Qualidade>("/analise/qualidade") });
  if (q.isPending) return <Cartao><Carregando /></Cartao>;
  if (q.isError) return <Cartao><MensagemErro erro={q.error} /></Cartao>;
  const total = q.data.aceitacao_ia.total[0];
  const status = { rascunho: "Rascunho", em_revisao: "Em revisão", aprovada: "Aprovada" };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Cartao titulo="Completude das fichas">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-suave">
            <tr><th className="pb-2 font-medium">Ficha</th><th className="pb-2 font-medium">Status</th><th className="pb-2 text-right font-medium">Fichas</th><th className="pb-2 text-right font-medium">Completude média</th></tr>
          </thead>
          <tbody className="divide-y divide-borda tabular-nums">
            {q.data.completude.map((c) => (
              <tr key={`${c.tipo_ficha}-${c.status}`}>
                <td className="py-1.5">{c.tipo_ficha === "ficha-inicial" ? "Inicial" : "Retorno"}</td>
                <td className="py-1.5">{status[c.status]}</td>
                <td className="py-1.5 text-right">{c.fichas}</td>
                <td className="py-1.5 text-right">{num(c.completude_media_pct)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Cartao>
      <Cartao titulo="Sugestões da IA: decisões dos acadêmicos">
        {!total ? <Vazio>Nenhuma sugestão da IA foi decidida ainda.</Vazio> : (
          <div className="space-y-3 text-sm">
            <p>
              <span className="text-2xl font-semibold tabular-nums">{num(total.taxa_aceitacao_pct)}%</span>{" "}
              <span className="text-suave">aceitas ({total.aceitas} sem alteração, {total.editadas} editadas, {total.rejeitadas} rejeitadas de {total.decisoes})</span>
            </p>
            <table className="w-full">
              <thead className="text-left text-xs text-suave">
                <tr><th className="pb-2 font-medium">Seção / versão do prompt</th><th className="pb-2 text-right font-medium">Decisões</th><th className="pb-2 text-right font-medium">Aceitação</th></tr>
              </thead>
              <tbody className="divide-y divide-borda tabular-nums">
                {[...q.data.aceitacao_ia.por_secao.map((a) => ({ ...a, nome: SECOES[a.grupo] ?? a.grupo })),
                  ...q.data.aceitacao_ia.por_versao_prompt.map((a) => ({ ...a, nome: `Prompt ${a.grupo}` }))].map((a) => (
                  <tr key={a.nome}><td className="py-1.5">{a.nome}</td><td className="py-1.5 text-right">{a.decisoes}</td><td className="py-1.5 text-right">{num(a.taxa_aceitacao_pct)}%</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
    </div>
  );
}

/** Painéis de coorte (professor, pesquisador) e de qualidade dos dados (também administrador). */
export default function Painel() {
  const usuario = useUsuario();
  const veCoorte = usuario.papel !== "admin";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{veCoorte ? "Painel da coorte" : "Qualidade dos dados"}</h1>
          <p className="text-sm text-suave">
            Dados pseudonimizados das fichas aprovadas: sem nome, documentos, datas exatas ou textos livres.
            Os indicadores descrevem a Liga; não constituem diagnóstico nem avaliação individual.
          </p>
        </div>
        {veCoorte && (
          <a href="/api/analise/exportacao.csv" download
            className="flex min-h-10 shrink-0 items-center rounded-lg border border-borda bg-superficie px-4 text-sm font-medium hover:border-marca-500">
            Exportar dados (CSV)
          </a>
        )}
      </div>
      {veCoorte && <PainelCoorte />}
      <section className="space-y-3">
        {veCoorte && <h2 className="text-lg font-semibold">Qualidade dos dados</h2>}
        <PainelQualidade />
      </section>
    </div>
  );
}
