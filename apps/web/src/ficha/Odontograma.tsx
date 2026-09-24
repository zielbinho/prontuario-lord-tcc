// Odontograma na notação FDI. Cada dente tem cinco faces: O (oclusal/incisal), V (vestibular),
// L (lingual/palatina), M (mesial) e D (distal). O documento segue o esquema odontograma.v1.
import { rotulo } from "@lord/ficha";
import { useState } from "react";
import { classes } from "../componentes/ui";

type Face = "O" | "V" | "L" | "M" | "D";
type EstadoFace = "carie" | "restauracao" | "lesao_cervical_nao_cariosa" | "fratura";
export interface Dente {
  ausente?: boolean;
  condicoes?: string[];
  faces?: Partial<Record<Face, EstadoFace>>;
  observacao?: string;
}
export type DadosOdontograma = Record<string, Dente>;

const SUPERIOR = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const INFERIOR = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

const FERRAMENTAS: { valor: EstadoFace | "apagar"; cor: string }[] = [
  { valor: "carie", cor: "fill-[#d94848]" },
  { valor: "restauracao", cor: "fill-[#3b73c9]" },
  { valor: "lesao_cervical_nao_cariosa", cor: "fill-[#e39a36]" },
  { valor: "fratura", cor: "fill-[#8a52c7]" },
  { valor: "apagar", cor: "fill-superficie" },
];
const COR_FACE: Record<string, string> = Object.fromEntries(FERRAMENTAS.map((f) => [f.valor, f.cor]));

const CONDICOES = [
  "protese_preexistente", "coroa", "implante", "tratamento_endodontico", "recessao", "atricao", "abfracao", "erosao",
];

/** Remove dentes sem nenhuma informação, para o documento continuar enxuto e válido. */
export function limparOdontograma(dados: DadosOdontograma): DadosOdontograma {
  const limpo: DadosOdontograma = {};
  for (const [numero, d] of Object.entries(dados)) {
    const faces = Object.fromEntries(Object.entries(d.faces ?? {}).filter(([, v]) => v));
    const dente: Dente = {
      ...(d.ausente ? { ausente: true } : {}),
      ...(d.condicoes?.length ? { condicoes: d.condicoes } : {}),
      ...(Object.keys(faces).length ? { faces } : {}),
      ...(d.observacao?.trim() ? { observacao: d.observacao } : {}),
    };
    if (Object.keys(dente).length) limpo[numero] = dente;
  }
  return limpo;
}

/** Posição de cada face no desenho do dente: mesial fica voltada para a linha média. */
function geometria(numero: number) {
  const quadrante = Math.floor(numero / 10);
  const superior = quadrante === 1 || quadrante === 2;
  const mesialADireita = quadrante === 1 || quadrante === 4;
  return {
    topo: (superior ? "V" : "L") as Face,
    base: (superior ? "L" : "V") as Face,
    esquerda: (mesialADireita ? "D" : "M") as Face,
    direita: (mesialADireita ? "M" : "D") as Face,
  };
}

function DesenhoDente({ numero, dente, selecionado, aoClicarFace, aoSelecionar, somenteLeitura }: {
  numero: number;
  dente: Dente | undefined;
  selecionado: boolean;
  aoClicarFace: (face: Face) => void;
  aoSelecionar: () => void;
  somenteLeitura?: boolean;
}) {
  const g = geometria(numero);
  const faces = dente?.faces ?? {};
  const poligonos: [Face, string][] = [
    [g.topo, "0,0 40,0 30,10 10,10"],
    [g.base, "10,30 30,30 40,40 0,40"],
    [g.esquerda, "0,0 10,10 10,30 0,40"],
    [g.direita, "40,0 40,40 30,30 30,10"],
    ["O", "10,10 30,10 30,30 10,30"],
  ];
  const superior = numero < 30;
  const numeroBotao = (
    <button type="button" onClick={aoSelecionar}
      className={classes("w-full rounded text-xs font-semibold tabular-nums",
        selecionado ? "bg-marca-600 text-white" : "text-suave hover:bg-marca-50")}
      aria-pressed={selecionado} aria-label={`Dente ${numero}`}>
      {numero}
    </button>
  );
  return (
    <div className="flex w-11 flex-col items-center gap-1">
      {superior && numeroBotao}
      <svg viewBox="-1 -1 42 42" className="w-10">
        {poligonos.map(([face, pontos]) => (
          <polygon key={face} points={pontos}
            className={classes(
              "stroke-suave",
              faces[face] ? COR_FACE[faces[face]!] : "fill-superficie",
              !somenteLeitura && !dente?.ausente && "cursor-pointer hover:opacity-70",
            )}
            strokeWidth="1"
            onClick={() => !somenteLeitura && !dente?.ausente && aoClicarFace(face)}>
            <title>{`${numero} ${face}${faces[face] ? `: ${rotulo(faces[face])}` : ""}`}</title>
          </polygon>
        ))}
        {dente?.ausente && <path d="M2 2 L38 38 M38 2 L2 38" className="stroke-perigo" strokeWidth="3" />}
        {!!dente?.condicoes?.length && <circle cx="36" cy="4" r="4" className="fill-revisao" />}
      </svg>
      {!superior && numeroBotao}
    </div>
  );
}

interface Props {
  valor: DadosOdontograma;
  aoMudar: (valor: DadosOdontograma) => void;
  somenteLeitura?: boolean;
}

export function Odontograma({ valor, aoMudar, somenteLeitura }: Props) {
  const [ferramenta, setFerramenta] = useState<EstadoFace | "apagar">("carie");
  const [selecionado, setSelecionado] = useState<number | null>(null);

  const alterarDente = (numero: number, alteracao: (d: Dente) => Dente) =>
    aoMudar(limparOdontograma({ ...valor, [numero]: alteracao(valor[numero] ?? {}) }));

  const clicarFace = (numero: number, face: Face) =>
    alterarDente(numero, (d) => {
      const atual = d.faces?.[face];
      const novo = ferramenta === "apagar" || atual === ferramenta ? undefined : ferramenta;
      return { ...d, faces: { ...d.faces, [face]: novo } };
    });

  const arcada = (numeros: number[]) => (
    <div className="flex justify-center gap-0.5">
      {numeros.map((n, i) => (
        <div key={n} className={classes(i === 8 && "ml-3 border-l-2 border-dashed border-borda pl-3")}>
          <DesenhoDente numero={n} dente={valor[n]} selecionado={selecionado === n} somenteLeitura={somenteLeitura}
            aoSelecionar={() => setSelecionado(selecionado === n ? null : n)}
            aoClicarFace={(face) => clicarFace(n, face)} />
        </div>
      ))}
    </div>
  );

  const dente = selecionado ? valor[selecionado] ?? {} : null;

  return (
    <div className="space-y-4">
      {!somenteLeitura && (
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Ferramenta de marcação das faces">
          <span className="text-sm text-suave">Marcar face como:</span>
          {FERRAMENTAS.map((f) => (
            <button key={f.valor} type="button" role="radio" aria-checked={ferramenta === f.valor}
              onClick={() => setFerramenta(f.valor)}
              className={classes("flex min-h-9 items-center gap-2 rounded-lg border px-3 text-sm",
                ferramenta === f.valor ? "border-marca-600 bg-marca-50 font-medium" : "border-borda bg-superficie")}>
              <svg viewBox="0 0 10 10" className="size-3"><rect width="10" height="10" className={classes(f.cor, "stroke-suave")} /></svg>
              {f.valor === "apagar" ? "Apagar" : rotulo(f.valor)}
            </button>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-borda bg-fundo p-4">
        <div className="min-w-max space-y-6">
          {arcada(SUPERIOR)}
          {arcada(INFERIOR)}
        </div>
      </div>

      {selecionado && dente && (
        <div className="rounded-lg border border-borda p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Dente {selecionado}</h3>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-5" checked={!!dente.ausente} disabled={somenteLeitura}
                onChange={(e) => alterarDente(selecionado, (d) => ({ ...d, ausente: e.target.checked, faces: e.target.checked ? {} : d.faces }))} />
              Ausente
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {CONDICOES.map((c) => {
              const ativa = dente.condicoes?.includes(c) ?? false;
              return (
                <button key={c} type="button" disabled={somenteLeitura} aria-pressed={ativa}
                  onClick={() => alterarDente(selecionado, (d) => ({
                    ...d, condicoes: ativa ? d.condicoes!.filter((x) => x !== c) : [...(d.condicoes ?? []), c],
                  }))}
                  className={classes("min-h-9 rounded-lg border px-3 text-sm",
                    ativa ? "border-marca-600 bg-marca-600 text-white" : "border-borda bg-superficie")}>
                  {rotulo(c)}
                </button>
              );
            })}
          </div>
          <input type="text" placeholder="Observação sobre o dente" maxLength={500} disabled={somenteLeitura}
            value={dente.observacao ?? ""}
            onChange={(e) => alterarDente(selecionado, (d) => ({ ...d, observacao: e.target.value }))}
            className="mt-3 min-h-10 w-full rounded-lg border border-borda bg-superficie px-3 text-sm" />
        </div>
      )}
    </div>
  );
}
