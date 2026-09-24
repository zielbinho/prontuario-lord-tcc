// Mapa de palpação (questões 43 a 45 da ficha): rosto em vista frontal com os sítios musculares
// e articulares de cada lado. O lado direito do paciente aparece à esquerda de quem olha.
import { classes } from "../componentes/ui";

type Lado = "direito" | "esquerdo";
type Intensidade = 0 | 1 | 2 | 3 | null;
type ValorBilateral = { direito?: Intensidade; esquerdo?: Intensidade };
export type ValoresPalpacao = Record<string, ValorBilateral | undefined>;

interface Sitio {
  chave: string;
  campo: "q44_palpacao_muscular" | "q45_palpacao_articular";
  nome: string;
  /** posição no lado direito do paciente (esquerda da figura); o outro lado é espelhado */
  x: number;
  y: number;
}

export const SITIOS: Sitio[] = [
  { chave: "temporal_anterior", campo: "q44_palpacao_muscular", nome: "Temporal anterior", x: 110, y: 96 },
  { chave: "temporal_medio", campo: "q44_palpacao_muscular", nome: "Temporal médio", x: 88, y: 66 },
  { chave: "temporal_posterior", campo: "q44_palpacao_muscular", nome: "Temporal posterior", x: 64, y: 100 },
  { chave: "masseter_origem", campo: "q44_palpacao_muscular", nome: "Masseter na origem", x: 92, y: 160 },
  { chave: "masseter_corpo", campo: "q44_palpacao_muscular", nome: "Masseter no corpo", x: 90, y: 188 },
  { chave: "masseter_insercao", campo: "q44_palpacao_muscular", nome: "Masseter na inserção", x: 100, y: 214 },
  { chave: "cervical", campo: "q44_palpacao_muscular", nome: "Cervical", x: 118, y: 276 },
  { chave: "articular_lateral", campo: "q45_palpacao_articular", nome: "ATM lateral", x: 82, y: 140 },
  { chave: "articular_posterior", campo: "q45_palpacao_articular", nome: "ATM posterior", x: 46, y: 176 },
];

const LARGURA = 320;
const PROXIMA: Record<string, Intensidade> = { null: 0, 0: 1, 1: 2, 2: 3, 3: null };
const COR: Record<string, string> = {
  null: "fill-superficie stroke-suave",
  0: "fill-dor-0 stroke-aprovada",
  1: "fill-dor-1 stroke-rascunho",
  2: "fill-dor-2 stroke-rascunho",
  3: "fill-dor-3 stroke-perigo",
};
const DESCRICAO = ["somente pressão", "dor leve", "dor moderada", "dor severa"];

interface Props {
  muscular: ValoresPalpacao | undefined;
  articular: ValoresPalpacao | undefined;
  aoMudar: (campo: Sitio["campo"], valor: ValoresPalpacao) => void;
  somenteLeitura?: boolean;
}

export function MapaPalpacao({ muscular, articular, aoMudar, somenteLeitura }: Props) {
  const valores = { q44_palpacao_muscular: muscular ?? {}, q45_palpacao_articular: articular ?? {} };
  const ler = (s: Sitio, lado: Lado): Intensidade => valores[s.campo][s.chave]?.[lado] ?? null;

  const definir = (s: Sitio, lado: Lado, v: Intensidade) => {
    if (somenteLeitura) return;
    const atual = valores[s.campo];
    const sitio = { ...atual[s.chave], [lado]: v };
    aoMudar(s.campo, { ...atual, [s.chave]: sitio });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <figure>
        <svg viewBox={`0 0 ${LARGURA} 300`} className="w-full max-w-[320px]" role="img"
          aria-label="Mapa de palpação: rosto em vista frontal com os sítios de cada lado">
          {/* contorno esquemático do rosto e do pescoço */}
          <ellipse cx="160" cy="140" rx="92" ry="118" className="fill-fundo stroke-borda" strokeWidth="2" />
          <ellipse cx="62" cy="150" rx="10" ry="24" className="fill-fundo stroke-borda" strokeWidth="2" />
          <ellipse cx="258" cy="150" rx="10" ry="24" className="fill-fundo stroke-borda" strokeWidth="2" />
          <path d="M112 244 L108 300 M208 244 L212 300" className="stroke-borda" strokeWidth="2" fill="none" />
          <path d="M128 118 q12 -8 24 0 M168 118 q12 -8 24 0" className="stroke-suave" strokeWidth="2" fill="none" />
          <path d="M160 128 l-8 40 h16" className="stroke-suave" strokeWidth="2" fill="none" />
          <path d="M136 200 q24 14 48 0" className="stroke-suave" strokeWidth="2" fill="none" />
          <text x="18" y="24" className="fill-suave text-[13px] font-semibold">Direito</text>
          <text x={LARGURA - 18} y="24" textAnchor="end" className="fill-suave text-[13px] font-semibold">Esquerdo</text>

          {SITIOS.flatMap((s) =>
            (["direito", "esquerdo"] as Lado[]).map((lado) => {
              const v = ler(s, lado);
              const x = lado === "direito" ? s.x : LARGURA - s.x;
              const articularSitio = s.campo === "q45_palpacao_articular";
              return (
                <g key={`${s.chave}-${lado}`}
                  role="button"
                  tabIndex={somenteLeitura ? -1 : 0}
                  aria-label={`${s.nome}, ${lado}: ${v === null ? "não avaliado" : `${v} (${DESCRICAO[v]})`}`}
                  className={somenteLeitura ? "" : "cursor-pointer"}
                  onClick={() => definir(s, lado, PROXIMA[String(v)])}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      definir(s, lado, PROXIMA[String(v)]);
                    }
                  }}>
                  <title>{`${s.nome} (${lado})`}</title>
                  {articularSitio ? (
                    <rect x={x - 10} y={s.y - 10} width="20" height="20" rx="4" className={COR[String(v)]} strokeWidth="2" />
                  ) : (
                    <circle cx={x} cy={s.y} r="11" className={COR[String(v)]} strokeWidth="2" />
                  )}
                  <text x={x} y={s.y + 4} textAnchor="middle" className="pointer-events-none fill-texto text-[11px] font-bold">
                    {v ?? ""}
                  </text>
                </g>
              );
            }),
          )}
        </svg>
        <figcaption className="mt-2 flex flex-wrap gap-3 text-xs text-suave">
          <span><span className="mr-1 inline-block size-3 rounded-full border border-borda align-middle" />círculo: músculo</span>
          <span><span className="mr-1 inline-block size-3 rounded-sm border border-borda align-middle" />quadrado: ATM</span>
          {!somenteLeitura && <span>toque para alternar 0 → 3 → vazio</span>}
        </figcaption>
      </figure>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-suave">
            <th className="pb-2 font-medium">Sítio</th>
            <th className="pb-2 font-medium">Direito</th>
            <th className="pb-2 font-medium">Esquerdo</th>
          </tr>
        </thead>
        <tbody>
          {SITIOS.map((s, i) => (
            <tr key={s.chave} className={classes(i === 7 && "border-t border-borda")}>
              <td className="py-1 pr-2">{s.nome}</td>
              {(["direito", "esquerdo"] as Lado[]).map((lado) => (
                <td key={lado} className="py-1 pr-2">
                  <div className="flex gap-1" role="group" aria-label={`${s.nome}, ${lado}`}>
                    {([0, 1, 2, 3] as const).map((n) => {
                      const ativo = ler(s, lado) === n;
                      return (
                        <button key={n} type="button" disabled={somenteLeitura} aria-pressed={ativo}
                          title={DESCRICAO[n]}
                          onClick={() => definir(s, lado, ativo ? null : n)}
                          className={classes(
                            "size-9 rounded-md border text-xs font-semibold tabular-nums disabled:cursor-default",
                            ativo ? `border-transparent ${["bg-dor-0", "bg-dor-1", "bg-dor-2", "bg-dor-3 text-white"][n]}` : "border-borda bg-superficie",
                          )}>
                          {n}
                        </button>
                      );
                    })}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-suave lg:col-span-2">
        Escala da questão 43: 0 = somente pressão (sem dor) · 1 = dor leve · 2 = dor moderada · 3 = dor severa.
      </p>
    </div>
  );
}
