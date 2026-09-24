import { esquemaResolvido, lerCaminho, listarCampos, validar, type Esquema } from "@lord/ficha";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router";
import { api, type Ficha as TipoFicha } from "../api";
import { useUsuario } from "../autenticacao";
import {
  BarraCompletude, Botao, Carregando, EtiquetaStatus, MensagemErro, classes, formatarData,
} from "../componentes/ui";
import { limparOdontograma, Odontograma, type DadosOdontograma } from "../ficha/Odontograma";
import { PainelIA } from "../ficha/PainelIA";
import { RenderizadorSecao, type ValoresSecao } from "../ficha/RenderizadorSecao";

interface FichaCompleta extends TipoFicha {
  atendimento: { id: string; data: string; tipo: string; paciente_id: string; paciente: string; aluno: string; professor: string | null };
}

const ODONTOGRAMA = "odontograma";

/** Cópia do documento com o valor gravado no caminho com pontos (ex.: "exame_dtm.q44_palpacao_muscular.cervical.direito"). */
export function definirCaminho(documento: Record<string, unknown>, caminho: string, valor: unknown): Record<string, unknown> {
  const [primeiro, ...resto] = caminho.split(".");
  if (resto.length === 0) return { ...documento, [primeiro]: valor };
  const filho = (documento[primeiro] ?? {}) as Record<string, unknown>;
  return { ...documento, [primeiro]: definirCaminho(filho, resto.join("."), valor) };
}

function preenchido(v: unknown) {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export default function Ficha() {
  const { id = "" } = useParams();
  const usuario = useUsuario();
  const navegar = useNavigate();
  const cliente = useQueryClient();

  const consulta = useQuery({ queryKey: ["ficha", id], queryFn: () => api.get<FichaCompleta>(`/fichas/${id}`) });
  const ficha = consulta.data;
  const atendimentoId = ficha?.atendimento_id;
  const temOdontograma = ficha?.tipo === "ficha-inicial";
  const consultaOdonto = useQuery({
    queryKey: ["odontograma", atendimentoId],
    queryFn: () => api.get<{ dados: DadosOdontograma }>(`/atendimentos/${atendimentoId}/odontograma`),
    enabled: !!atendimentoId && temOdontograma,
  });

  const [dados, setDados] = useState<Record<string, ValoresSecao>>({});
  const [odonto, setOdonto] = useState<DadosOdontograma>({});
  const [sujo, setSujo] = useState(false);
  const [secaoAtiva, setSecaoAtiva] = useState<string | null>(null);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [devolvendo, setDevolvendo] = useState(false);
  const [comentario, setComentario] = useState("");

  // carrega o documento do servidor quando a ficha muda (e não há edição pendente)
  useEffect(() => {
    if (ficha && !sujo) setDados(ficha.dados ?? {});
  }, [ficha]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (consultaOdonto.data && !sujo) setOdonto(consultaOdonto.data.dados ?? {});
  }, [consultaOdonto.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const esquema = useMemo(() => (ficha ? esquemaResolvido(ficha.tipo) : null), [ficha?.tipo]); // eslint-disable-line react-hooks/exhaustive-deps
  const campos = useMemo(() => (ficha ? listarCampos(ficha.tipo) : []), [ficha?.tipo]); // eslint-disable-line react-hooks/exhaustive-deps
  const secoes = esquema ? (esquema.properties as Record<string, Esquema>) : {};
  const nomesSecoes = Object.keys(secoes);
  const atual = secaoAtiva ?? nomesSecoes[0];

  const editavel = ficha?.status === "rascunho";
  const ehProfessor = usuario.papel === "professor";

  // aviso ao sair com alterações não salvas
  const bloqueio = useBlocker(({ currentLocation, nextLocation }) => sujo && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (bloqueio.state === "blocked") {
      if (window.confirm("Há alterações não salvas nesta ficha. Sair mesmo assim?")) bloqueio.proceed();
      else bloqueio.reset();
    }
  }, [bloqueio]);
  useEffect(() => {
    const aviso = (e: BeforeUnloadEvent) => {
      if (sujo) e.preventDefault();
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sujo]);

  const invalidar = () => {
    cliente.invalidateQueries({ queryKey: ["ficha", id] });
    if (ficha) cliente.invalidateQueries({ queryKey: ["atendimentos", ficha.atendimento.paciente_id] });
    cliente.invalidateQueries({ queryKey: ["revisao"] });
  };

  const salvar = useMutation({
    mutationFn: async () => {
      if (!ficha) return;
      const r = validar(ficha.tipo, dados);
      if (!r.valido) {
        setErros(Object.fromEntries(r.erros.map((e) => [e.caminho.replace(/^\//, "").replace(/\//g, "."), e.mensagem])));
        throw new Error(`Há ${r.erros.length} campo(s) com valor inválido, destacados em vermelho.`);
      }
      setErros({});
      await api.put(`/fichas/${id}`, { dados });
      if (temOdontograma) await api.put(`/atendimentos/${ficha.atendimento_id}/odontograma`, { dados: limparOdontograma(odonto) });
    },
    onSuccess: () => {
      setSujo(false);
      invalidar();
    },
  });

  const acao = useMutation({
    mutationFn: async (tipo: "enviar" | "aprovar" | "devolver" | "adendo") => {
      if (tipo === "enviar" && sujo) await salvar.mutateAsync();
      if (tipo === "devolver") return api.post<{ id: string }>(`/fichas/${id}/devolver`, { comentario });
      return api.post<{ id: string }>(`/fichas/${id}/${tipo}`);
    },
    onSuccess: (resposta, tipo) => {
      invalidar();
      setDevolvendo(false);
      setComentario("");
      if (tipo === "adendo" && resposta) navegar(`/fichas/${resposta.id}`);
      if (tipo === "aprovar" || tipo === "devolver") navegar("/revisao");
    },
  });

  // Ctrl+S salva o rascunho
  useEffect(() => {
    const atalho = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (editavel && sujo && !salvar.isPending) salvar.mutate();
      }
    };
    window.addEventListener("keydown", atalho);
    return () => window.removeEventListener("keydown", atalho);
  });

  if (consulta.isPending) return <Carregando texto="Carregando ficha…" />;
  if (consulta.error || !ficha || !esquema) return <MensagemErro erro={consulta.error ?? "Ficha não encontrada"} />;

  const contagem = (secao: string) => {
    const daSecao = campos.filter((c) => c.secao === secao);
    return { preenchidos: daSecao.filter((c) => preenchido(lerCaminho(dados, c.caminho))).length, total: daSecao.length };
  };
  const errosPorSecao = (secao: string) => Object.keys(erros).some((c) => c.startsWith(`${secao}.`));

  const alterarSecao = (secao: string, valores: ValoresSecao) => {
    setDados((d) => ({ ...d, [secao]: valores }));
    setSujo(true);
  };

  const esquemaAtual = secoes[atual];
  const titulo = ficha.tipo === "ficha-inicial" ? "Ficha clínica inicial" : "Ficha de retorno";

  return (
    <div className="space-y-4">
      {/* cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to={`/pacientes/${ficha.atendimento.paciente_id}`} className="text-sm text-destaque hover:underline">
            ← {ficha.atendimento.paciente}
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold">
            {titulo}
            {ficha.versao > 1 && <span className="text-base font-normal text-suave">adendo · versão {ficha.versao}</span>}
            <EtiquetaStatus status={ficha.status} />
          </h1>
          <p className="mt-1 text-sm text-suave">
            Atendimento de {formatarData(ficha.atendimento.data)} · aluno(a) {ficha.atendimento.aluno}
            {ficha.atendimento.professor && <> · supervisão {ficha.atendimento.professor}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <BarraCompletude fracao={ficha.completude} />
          {editavel && (
            <>
              <Botao variante="secundario" onClick={() => salvar.mutate()} carregando={salvar.isPending} disabled={!sujo}>
                {sujo ? "Salvar rascunho" : "Salvo"}
              </Botao>
              <Botao onClick={() => acao.mutate("enviar")} carregando={acao.isPending && acao.variables === "enviar"}>
                Enviar para revisão
              </Botao>
            </>
          )}
          {ficha.status === "em_revisao" && ehProfessor && (
            <>
              <Botao variante="secundario" onClick={() => setDevolvendo(true)}>Devolver ao aluno</Botao>
              <Botao onClick={() => acao.mutate("aprovar")} carregando={acao.isPending && acao.variables === "aprovar"}>
                Aprovar ficha
              </Botao>
            </>
          )}
          {ficha.status === "aprovada" && (
            <Botao variante="secundario" onClick={() => acao.mutate("adendo")} carregando={acao.isPending}>
              Registrar adendo
            </Botao>
          )}
        </div>
      </div>

      <MensagemErro erro={salvar.error ?? acao.error} />

      {ficha.status === "rascunho" && ficha.comentario_revisao && (
        <div className="rounded-lg border border-rascunho/30 bg-rascunho-fundo px-4 py-3 text-sm">
          <strong>Devolvida pelo professor:</strong> {ficha.comentario_revisao}
        </div>
      )}
      {ficha.status === "em_revisao" && !ehProfessor && (
        <div className="rounded-lg border border-revisao/30 bg-revisao-fundo px-4 py-3 text-sm text-revisao">
          Ficha enviada para revisão. Ela volta a ser editável se o professor a devolver.
        </div>
      )}
      {ficha.status === "aprovada" && (
        <div className="rounded-lg border border-aprovada/30 bg-aprovada-fundo px-4 py-3 text-sm text-aprovada">
          Ficha aprovada em {formatarData(ficha.aprovado_em)}. Ela não pode mais ser alterada; correções são feitas por adendo.
        </div>
      )}

      {devolvendo && (
        <div className="rounded-xl border border-borda bg-superficie p-4">
          <label htmlFor="comentario" className="mb-2 block text-sm font-medium">O que o aluno precisa corrigir?</label>
          <textarea id="comentario" rows={3} value={comentario} onChange={(e) => setComentario(e.target.value)}
            className="w-full rounded-lg border border-borda bg-superficie px-3 py-2 text-sm" autoFocus />
          <div className="mt-3 flex justify-end gap-2">
            <Botao variante="fantasma" onClick={() => setDevolvendo(false)}>Cancelar</Botao>
            <Botao onClick={() => acao.mutate("devolver")} disabled={comentario.trim().length < 3}
              carregando={acao.isPending && acao.variables === "devolver"}>
              Devolver com comentário
            </Botao>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[17rem_1fr]">
        {/* navegação por seção */}
        <nav aria-label="Seções da ficha" className="lg:sticky lg:top-4 lg:self-start">
          <ol className="flex gap-1 overflow-x-auto rounded-xl border border-borda bg-superficie p-2 lg:flex-col lg:overflow-visible">
            {nomesSecoes.map((nome) => {
              const s = secoes[nome];
              const { preenchidos, total } = contagem(nome);
              const humano = s["x-somente-humano"] === true;
              return (
                <li key={nome} className="shrink-0">
                  <button type="button" onClick={() => setSecaoAtiva(nome)} aria-current={atual === nome ? "step" : undefined}
                    className={classes(
                      "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm",
                      atual === nome ? "bg-marca-50 font-medium text-destaque" : "hover:bg-fundo",
                    )}>
                    <span className="flex items-center gap-2">
                      {errosPorSecao(nome) && <span className="size-2 rounded-full bg-perigo" title="Há erros nesta seção" />}
                      {s.title as string}
                      {humano && <span title="Decisão clínica: exclusiva do examinador" className="rounded bg-fundo px-1 text-[10px] font-semibold uppercase tracking-wide text-suave">clínica</span>}
                    </span>
                    <span className={classes("text-xs tabular-nums", preenchidos === total ? "text-aprovada" : "text-suave")}>
                      {preenchidos}/{total}
                    </span>
                  </button>
                </li>
              );
            })}
            {temOdontograma && (
              <li className="shrink-0">
                <button type="button" onClick={() => setSecaoAtiva(ODONTOGRAMA)} aria-current={atual === ODONTOGRAMA ? "step" : undefined}
                  className={classes("flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm",
                    atual === ODONTOGRAMA ? "bg-marca-50 font-medium text-destaque" : "hover:bg-fundo")}>
                  Odontograma
                  <span className="text-xs tabular-nums text-suave">{Object.keys(odonto).length} dentes</span>
                </button>
              </li>
            )}
          </ol>
        </nav>

        {/* conteúdo da seção */}
        <section className="rounded-xl border border-borda bg-superficie">
          {atual === ODONTOGRAMA ? (
            <>
              <header className="border-b border-borda px-5 py-4">
                <h2 className="text-lg font-semibold">Odontograma</h2>
                <p className="text-sm text-suave">Ausências, próteses, cáries, lesões cervicais, restaurações e tratamentos endodônticos.</p>
              </header>
              <div className="p-5">
                <Odontograma valor={odonto} somenteLeitura={!editavel}
                  aoMudar={(v) => { setOdonto(v); setSujo(true); }} />
              </div>
            </>
          ) : (
            <>
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-borda px-5 py-4">
                <div>
                  <h2 className="text-lg font-semibold">{esquemaAtual.title as string}</h2>
                  {typeof esquemaAtual.description === "string" && <p className="mt-1 text-sm text-suave">{esquemaAtual.description}</p>}
                </div>
                {esquemaAtual["x-somente-humano"] === true ? (
                  <span className="rounded-full bg-fundo px-3 py-1 text-xs font-medium text-suave">
                    Decisão clínica · a IA não sugere nem preenche
                  </span>
                ) : (
                  (esquemaAtual["x-captacao"] as string[] | undefined)?.includes("ditado") && (
                    <span className="rounded-full bg-marca-50 px-3 py-1 text-xs font-medium text-destaque">
                      Admite ditado com IA
                    </span>
                  )
                )}
              </header>
              {editavel && ficha.tipo === "ficha-inicial" && esquemaAtual["x-somente-humano"] !== true &&
                (esquemaAtual["x-captacao"] as string[] | undefined)?.includes("ditado") && (
                <PainelIA fichaId={ficha.id} secao={atual} dados={dados}
                  aoAplicar={(caminho, valor) => {
                    setDados((d) => definirCaminho(d, caminho, valor) as Record<string, ValoresSecao>);
                    setSujo(true);
                  }} />
              )}
              <div className="p-2">
                <RenderizadorSecao secao={atual} esquemaSecao={esquemaAtual} valores={dados[atual]}
                  aoMudar={(v) => alterarSecao(atual, v)} somenteLeitura={!editavel} erros={erros} />
              </div>
              <footer className="flex justify-between border-t border-borda px-5 py-3">
                <Botao variante="fantasma" disabled={nomesSecoes.indexOf(atual) === 0}
                  onClick={() => setSecaoAtiva(nomesSecoes[nomesSecoes.indexOf(atual) - 1])}>
                  ← Anterior
                </Botao>
                <Botao variante="fantasma"
                  onClick={() => setSecaoAtiva(nomesSecoes[nomesSecoes.indexOf(atual) + 1] ?? (temOdontograma ? ODONTOGRAMA : atual))}>
                  Próxima →
                </Botao>
              </footer>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
