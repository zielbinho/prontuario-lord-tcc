import { rotulo } from "@lord/ficha";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type ConsultaEvolucao, type Evolucao } from "../api";
import { MapaPalpacao, type ValoresPalpacao } from "../ficha/MapaPalpacao";
import { GraficoLinha } from "./graficos";
import { Cartao, Carregando, MensagemErro, Selecao, Vazio, classes, formatarData } from "./ui";

export const GRAU_GCPS = ["0", "I", "II", "III", "IV"];
const DIA = 86_400_000;
const numero = (v: number | null | undefined, casas = 0) => (v === null || v === undefined ? "—" : v.toFixed(casas));

function Destaque({ titulo, antes, depois, unidade = "", melhoraSeMenor = true }: {
  titulo: string; antes: number | null; depois: number | null; unidade?: string; melhoraSeMenor?: boolean;
}) {
  const variacao = antes && depois !== null ? ((depois - antes) / antes) * 100 : null;
  const melhorou = variacao !== null && (melhoraSeMenor ? variacao < 0 : variacao > 0);
  return (
    <div className="rounded-lg border border-borda px-3 py-2">
      <p className="text-xs text-suave">{titulo}</p>
      <p className="text-lg font-semibold tabular-nums">
        {numero(antes)} → {numero(depois)}{unidade}
      </p>
      {variacao !== null && Math.abs(variacao) >= 0.5 && (
        <p className={classes("text-xs", melhorou ? "text-aprovada" : "text-suave")}>
          {variacao > 0 ? "+" : ""}{variacao.toFixed(0)}% {melhorou ? "(melhora)" : ""}
        </p>
      )}
    </div>
  );
}

function dicaConsulta(c: ConsultaEvolucao) {
  return (
    <>
      <p className="font-medium">{formatarData(c.data)} · {c.tipo_ficha === "ficha-inicial" ? "primeira consulta" : "retorno"}</p>
      <p>Intensidade da dor {numero(c.icd)} · dor atual {numero(c.dor_atual)}/10</p>
      <p className="text-suave">GCPS grau {c.grau_gcps === null ? "—" : GRAU_GCPS[c.grau_gcps]} · abertura {numero(c.abertura_max_mm)} mm</p>
    </>
  );
}

/** Painel de evolução clínica do paciente (fichas aprovadas): dor, abertura, palpação e tratamentos. */
export function EvolucaoPaciente({ pacienteId }: { pacienteId: string }) {
  const evolucao = useQuery({ queryKey: ["evolucao", pacienteId], queryFn: () => api.get<Evolucao>(`/pacientes/${pacienteId}/evolucao`) });
  const [selecionada, setSelecionada] = useState<string | null>(null);

  if (evolucao.isPending) return <Cartao titulo="Evolução clínica"><Carregando /></Cartao>;
  if (evolucao.isError) return <Cartao titulo="Evolução clínica"><MensagemErro erro={evolucao.error} /></Cartao>;
  const { consultas, tratamentos } = evolucao.data;
  if (!consultas.length) {
    return <Cartao titulo="Evolução clínica"><Vazio>A evolução aparece depois que a primeira ficha for aprovada.</Vazio></Cartao>;
  }

  const inicio = new Date(consultas[0].data).getTime();
  const ultimaConsulta = consultas.at(-1)!;
  const faixas = tratamentos.map((t) => ({
    inicio: Math.max(0, Math.round((new Date(t.inicio).getTime() - inicio) / DIA)),
    fim: Math.round(((t.fim ? new Date(t.fim).getTime() : new Date(ultimaConsulta.data).getTime()) - inicio) / DIA),
    rotulo: `${rotulo(t.categoria)}${t.fim ? "" : " (em andamento)"}`,
  }));
  const pontos = (campo: "icd" | "abertura_max_mm") => consultas.map((c) => ({ x: c.dias, y: c[campo], dica: dicaConsulta(c) }));
  const palpacao = consultas.find((c) => c.ficha_id === selecionada) ?? ultimaConsulta;
  const primeira = consultas[0];

  return (
    <Cartao titulo="Evolução clínica">
      <div className="space-y-5">
        <div className="grid gap-2 sm:grid-cols-3">
          <Destaque titulo="Intensidade característica da dor (0–100)" antes={primeira.icd} depois={ultimaConsulta.icd} />
          <Destaque titulo="Abertura máxima sem auxílio" antes={primeira.abertura_max_mm} depois={ultimaConsulta.abertura_max_mm} unidade=" mm" melhoraSeMenor={false} />
          <Destaque titulo="Sítios dolorosos à palpação" antes={primeira.sitios_dolorosos} depois={ultimaConsulta.sitios_dolorosos} />
        </div>

        {consultas.length > 1 ? (
          <div className="grid gap-5 xl:grid-cols-2">
            <figure>
              <figcaption className="mb-1 text-sm font-medium">Intensidade característica da dor</figcaption>
              <GraficoLinha pontos={pontos("icd")} yMax={100} rotuloY="Intensidade da dor" faixas={faixas} />
            </figure>
            <figure>
              <figcaption className="mb-1 text-sm font-medium">Abertura máxima sem auxílio (mm)</figcaption>
              <GraficoLinha pontos={pontos("abertura_max_mm")} yMin={0}
                yMax={Math.max(60, ...consultas.map((c) => c.abertura_max_mm ?? 0))} rotuloY="Abertura (mm)" faixas={faixas} />
            </figure>
          </div>
        ) : (
          <p className="text-sm text-suave">Os gráficos aparecem a partir do primeiro retorno aprovado.</p>
        )}

        <div className="space-y-5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Indicadores por consulta</caption>
              <thead className="text-left text-xs text-suave">
                <tr>
                  <th className="pb-2 font-medium">Data</th><th className="pb-2 font-medium">Consulta</th>
                  <th className="pb-2 text-right font-medium">Dor atual</th><th className="pb-2 text-right font-medium">ICD</th>
                  <th className="pb-2 text-right font-medium">GCPS</th><th className="pb-2 text-right font-medium">Abertura</th>
                  <th className="pb-2 text-right font-medium">Sítios</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borda tabular-nums">
                {consultas.map((c) => (
                  <tr key={c.ficha_id} className={classes(c === palpacao && "bg-marca-50")}>
                    <td className="py-1.5">{formatarData(c.data)}</td>
                    <td className="py-1.5">{c.tipo_ficha === "ficha-inicial" ? "Inicial" : `Retorno (dia ${c.dias})`}</td>
                    <td className="py-1.5 text-right">{numero(c.dor_atual)}</td>
                    <td className="py-1.5 text-right">{numero(c.icd)}</td>
                    <td className="py-1.5 text-right">{c.grau_gcps === null ? "—" : GRAU_GCPS[c.grau_gcps]}</td>
                    <td className="py-1.5 text-right">{numero(c.abertura_max_mm)} mm</td>
                    <td className="py-1.5 text-right">{numero(c.sitios_dolorosos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-suave">
              ICD: média das questões 16 a 18 × 10. GCPS: Escala Graduada de Dor Crônica (grau 0 a IV), calculada por fórmula, sem IA.
            </p>
          </div>
          <div className="max-w-3xl space-y-2">
            <label className="flex max-w-xs items-center gap-2 text-sm">
              <span className="shrink-0 font-medium">Palpação em</span>
              <Selecao value={palpacao.ficha_id} onChange={(e) => setSelecionada(e.target.value)}>
                {consultas.map((c) => <option key={c.ficha_id} value={c.ficha_id}>{formatarData(c.data)}</option>)}
              </Selecao>
            </label>
            <MapaPalpacao somenteLeitura aoMudar={() => {}}
              muscular={(palpacao.palpacao.q44_palpacao_muscular ?? undefined) as ValoresPalpacao | undefined}
              articular={(palpacao.palpacao.q45_palpacao_articular ?? undefined) as ValoresPalpacao | undefined} />
          </div>
        </div>
      </div>
    </Cartao>
  );
}
