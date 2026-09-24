// Painel de ditado com IA (seção 4.7 do TCC). A IA só SUGERE: nada entra na ficha sem o aceite
// do aluno, cada sugestão mostra o trecho do relato que a justifica, e as seções de decisão
// clínica nem chegam a exibir este painel.
import { lerCaminho, listarCampos, rotulo } from "@lord/ficha";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, enviarAudio, type RespostaSugestoes, type SugestaoIA } from "../api";
import { Botao, MensagemErro, classes } from "../componentes/ui";

type Decisao = "aceita" | "editada" | "rejeitada";

export function formatarValor(valor: unknown): string {
  if (Array.isArray(valor)) return valor.length ? valor.map((v) => rotulo(v)).join(", ") : "—";
  return rotulo(valor);
}

const iguais = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const MOTIVOS: Record<string, string> = {
  sem_evidencia: "sem trecho de evidência",
  evidencia_nao_encontrada: "evidência não encontrada no relato",
  valor_incoerente_com_evidencia: "valor incoerente com a evidência",
};

interface Props {
  fichaId: string;
  secao: string;
  /** documento inteiro da ficha, para mostrar o valor atual de cada campo */
  dados: Record<string, unknown>;
  aoAplicar: (caminho: string, valor: unknown) => void;
}

export function PainelIA({ fichaId, secao, dados, aoAplicar }: Props) {
  const [aberto, setAberto] = useState(false);
  const [relato, setRelato] = useState("");
  const [origem, setOrigem] = useState<"texto" | "audio">("texto");
  const [resultado, setResultado] = useState<RespostaSugestoes | null>(null);
  const [decisoes, setDecisoes] = useState<Record<string, Decisao>>({});
  const [gravando, setGravando] = useState(false);
  const gravador = useRef<MediaRecorder | null>(null);
  const trechos = useRef<Blob[]>([]);

  const titulos = useMemo(
    () => Object.fromEntries(listarCampos("ficha-inicial").map((c) => [c.caminho, c.titulo])),
    [],
  );

  // troca de seção: começa um ditado novo
  useEffect(() => {
    setResultado(null);
    setDecisoes({});
    setRelato("");
  }, [secao]);

  const registrarDecisoes = useMutation({
    mutationFn: (novas: Record<string, Decisao>) => api.post(`/sugestoes/${resultado!.id}/decisoes`, { decisoes: novas }),
  });

  // valor aceito e depois alterado no formulário passa a contar como "editada"
  useEffect(() => {
    if (!resultado) return;
    const editadas: Record<string, Decisao> = {};
    for (const s of resultado.sugestoes) {
      if (decisoes[s.caminho] === "aceita" && !iguais(lerCaminho(dados, s.caminho), s.valor)) editadas[s.caminho] = "editada";
    }
    if (Object.keys(editadas).length) {
      setDecisoes((d) => ({ ...d, ...editadas }));
      registrarDecisoes.mutate(editadas);
    }
  }, [dados]); // eslint-disable-line react-hooks/exhaustive-deps

  const transcrever = useMutation({
    mutationFn: (audio: Blob) => enviarAudio<{ texto: string; duracao_audio_s: number }>("/transcricoes", audio),
    onSuccess: (r) => {
      setRelato((atual) => (atual ? `${atual}\n${r.texto}` : r.texto));
      setOrigem("audio");
    },
  });

  const gerar = useMutation({
    mutationFn: () => api.post<RespostaSugestoes>(`/fichas/${fichaId}/sugestoes`, { secao, relato, origem }),
    onSuccess: (r) => {
      setResultado(r);
      setDecisoes({});
    },
  });

  async function alternarGravacao() {
    if (gravando) {
      gravador.current?.stop();
      return;
    }
    const fluxo = await navigator.mediaDevices.getUserMedia({ audio: true });
    trechos.current = [];
    const g = new MediaRecorder(fluxo);
    g.ondataavailable = (e) => trechos.current.push(e.data);
    g.onstop = () => {
      fluxo.getTracks().forEach((t) => t.stop());
      setGravando(false);
      transcrever.mutate(new Blob(trechos.current, { type: g.mimeType || "audio/webm" }));
    };
    g.start();
    gravador.current = g;
    setGravando(true);
  }

  function decidir(s: SugestaoIA, decisao: Decisao) {
    if (decisao === "aceita") aoAplicar(s.caminho, s.valor);
    setDecisoes((d) => ({ ...d, [s.caminho]: decisao }));
    registrarDecisoes.mutate({ [s.caminho]: decisao });
  }

  if (!aberto) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-borda bg-marca-50/60 px-5 py-3">
        <p className="text-sm text-destaque">Prefere ditar? A IA local organiza o relato nos campos desta seção, e você revisa cada sugestão.</p>
        <Botao variante="secundario" onClick={() => setAberto(true)}>Ditado com IA</Botao>
      </div>
    );
  }

  const pendentes = resultado?.sugestoes.filter((s) => !decisoes[s.caminho]).length ?? 0;

  return (
    <div className="space-y-4 border-b border-borda bg-marca-50/40 px-5 py-4" aria-label="Ditado com IA">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Ditado com IA</h3>
        <button type="button" onClick={() => setAberto(false)} className="text-sm text-suave hover:text-texto">Fechar</button>
      </div>

      <div>
        <label htmlFor="relato-ia" className="mb-1 block text-sm font-medium">Relato (grave ou digite; confira a transcrição antes de gerar)</label>
        <textarea id="relato-ia" rows={4} value={relato} onChange={(e) => setRelato(e.target.value)}
          placeholder="Ex.: A paciente relata alergia a dipirona e toma losartana há dois anos…"
          className="w-full rounded-lg border border-borda bg-superficie px-3 py-2 text-sm" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Botao variante={gravando ? "perigo" : "secundario"} onClick={alternarGravacao} carregando={transcrever.isPending}>
            {gravando ? "■ Parar e transcrever" : transcrever.isPending ? "Transcrevendo…" : "● Gravar áudio"}
          </Botao>
          <Botao onClick={() => gerar.mutate()} disabled={!relato.trim() || gravando} carregando={gerar.isPending}>
            {gerar.isPending ? "O modelo local está analisando…" : "Gerar sugestões"}
          </Botao>
          <span className="text-xs text-suave">
            Modelo executado no servidor da instituição · o áudio é descartado após a transcrição
          </span>
        </div>
        <MensagemErro erro={transcrever.error ?? gerar.error} />
      </div>

      {resultado && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              {resultado.sugestoes.length} sugest{resultado.sugestoes.length === 1 ? "ão" : "ões"} em {(resultado.latencia_ms / 1000).toFixed(0)} s
              {resultado.descartados.length > 0 && (
                <span className="text-suave"> · {resultado.descartados.length} descartada(s) automaticamente</span>
              )}
            </p>
            {/* sem aceite em lote: cada sugestão exige decisão própria (RF07) */}
            {pendentes > 0 && <span className="text-xs text-suave">{pendentes} aguardando revisão</span>}
          </div>

          <ul className="space-y-2">
            {resultado.sugestoes.map((s) => {
              const decisao = decisoes[s.caminho];
              const atual = lerCaminho(dados, s.caminho);
              const substitui = decisao === undefined && atual !== undefined && atual !== null && !iguais(atual, s.valor);
              return (
                <li key={s.caminho} data-sugestao={s.caminho}
                  className={classes("rounded-lg border bg-superficie p-3",
                    decisao === "rejeitada" ? "border-borda opacity-60" : decisao ? "border-aprovada/50" : "border-marca-200")}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-suave">{titulos[s.caminho] ?? s.caminho}</p>
                      <p className="font-medium">{formatarValor(s.valor)}</p>
                      <p className="mt-1 text-sm italic text-suave">“{s.evidencia}”</p>
                      {substitui && <p className="mt-1 text-xs text-rascunho">Substitui o valor atual: {formatarValor(atual)}</p>}
                    </div>
                    {decisao ? (
                      <span className={classes("rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        decisao === "rejeitada" ? "bg-fundo text-suave" : "bg-aprovada-fundo text-aprovada")}>
                        {decisao === "aceita" ? "Aceita" : decisao === "editada" ? "Aceita e editada" : "Rejeitada"}
                      </span>
                    ) : (
                      <div className="flex gap-2">
                        <Botao variante="secundario" onClick={() => decidir(s, "rejeitada")}>Rejeitar</Botao>
                        <Botao onClick={() => decidir(s, "aceita")}>Aceitar</Botao>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {resultado.descartados.length > 0 && (
            <details className="text-sm text-suave">
              <summary className="cursor-pointer">Ver o que foi descartado automaticamente</summary>
              <ul className="mt-2 list-disc pl-5">
                {resultado.descartados.map((d) => (
                  <li key={d.caminho}>
                    {titulos[d.caminho] ?? d.caminho}: {formatarValor(d.valor)} ({MOTIVOS[d.motivo] ?? d.motivo}
                    {d.evidencia ? <>; trecho citado: “{d.evidencia}”</> : null})
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="text-xs text-suave">
            Os valores aceitos entram no formulário abaixo como rascunho. Você pode ajustá-los antes de salvar.
          </p>
        </div>
      )}
    </div>
  );
}
