// Gráficos dos painéis analíticos, em SVG simples (sem biblioteca). Regras seguidas:
// um único eixo vertical por gráfico, grade recessiva, linhas de 2 px, marcadores de 8 px com
// anel da cor da superfície, rótulos diretos seletivos e dica (tooltip) ao passar o mouse.
// Todo gráfico acompanha uma tabela com os mesmos números na página.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Largura real do contêiner, para desenhar em pixels (texto nítido em qualquer tamanho). */
function useLargura<T extends HTMLElement>(inicial = 600) {
  const ref = useRef<T>(null);
  const [largura, setLargura] = useState(inicial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setLargura(Math.max(260, el.clientWidth));
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, largura] as const;
}

function ticks(min: number, max: number, quantidade = 4): number[] {
  const bruto = (max - min) / quantidade;
  const potencia = 10 ** Math.floor(Math.log10(bruto || 1));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * potencia).find((p) => p >= bruto) ?? bruto;
  const lista: number[] = [];
  for (let v = Math.ceil(min / passo) * passo; v <= max + 1e-9; v += passo) lista.push(Number(v.toFixed(6)));
  return lista;
}

function Dica({ x, y, largura, children }: { x: number; y: number; largura: number; children: ReactNode }) {
  // mantém a dica dentro do gráfico: abre para a esquerda perto da borda direita
  const esquerda = x > largura - 180;
  return (
    <div role="tooltip" className="pointer-events-none absolute z-10 w-max max-w-56 rounded-lg border border-borda bg-superficie px-3 py-2 text-xs shadow-md"
      style={{ left: esquerda ? undefined : x + 12, right: esquerda ? largura - x + 12 : undefined, top: Math.max(0, y - 10) }}>
      {children}
    </div>
  );
}

// -----------------------------------------------------------------------------------------------

export interface PontoLinha {
  x: number;
  y: number | null;
  dica: ReactNode;
}

export interface Faixa {
  inicio: number;
  fim: number;
  rotulo: string;
}

/** Uma série ao longo do tempo (dias), com faixas opcionais (períodos de tratamento). */
export function GraficoLinha({ pontos, yMin = 0, yMax, rotuloY, rotuloX = "Dias desde a primeira consulta", faixas = [], cor = "var(--color-marca-600)", formatarY = (v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) }: {
  pontos: PontoLinha[];
  yMin?: number;
  yMax: number;
  rotuloY: string;
  rotuloX?: string;
  faixas?: Faixa[];
  cor?: string;
  formatarY?: (v: number) => string;
}) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [ativo, setAtivo] = useState<number | null>(null);
  const altura = 200;
  const m = { e: 44, d: 16, t: 22, b: 34 };
  const validos = pontos.filter((p) => p.y !== null);
  const xMax = Math.max(30, ...pontos.map((p) => p.x), ...faixas.map((f) => f.fim));
  const px = (x: number) => m.e + (x / xMax) * (largura - m.e - m.d);
  const py = (y: number) => altura - m.b - ((y - yMin) / (yMax - yMin)) * (altura - m.t - m.b);
  const caminho = validos.map((p, i) => `${i ? "L" : "M"}${px(p.x)},${py(p.y!)}`).join(" ");
  const ultimo = validos.at(-1);

  const mover = (evento: React.MouseEvent<SVGRectElement>) => {
    const caixa = evento.currentTarget.getBoundingClientRect();
    const x = evento.clientX - caixa.left + m.e;
    let melhor = 0;
    pontos.forEach((p, i) => { if (Math.abs(px(p.x) - x) < Math.abs(px(pontos[melhor].x) - x)) melhor = i; });
    setAtivo(melhor);
  };
  const pontoAtivo = ativo !== null ? pontos[ativo] : null;

  return (
    <div ref={ref} className="relative">
      <svg width={largura} height={altura} role="img" aria-label={`${rotuloY} ao longo do tempo`} className="block overflow-visible">
        {faixas.map((f, i) => (
          <g key={i}>
            <rect x={px(f.inicio)} y={m.t} width={Math.max(2, px(f.fim) - px(f.inicio))} height={altura - m.t - m.b} fill="var(--color-marca-50)" />
            <text x={px(f.inicio) + 4} y={m.t - 6} fontSize={11} fill="var(--color-suave)">{f.rotulo}</text>
          </g>
        ))}
        {ticks(yMin, yMax).map((t) => (
          <g key={t}>
            <line x1={m.e} x2={largura - m.d} y1={py(t)} y2={py(t)} stroke="var(--color-grade)" />
            <text x={m.e - 8} y={py(t)} fontSize={11} textAnchor="end" dominantBaseline="middle" fill="var(--color-suave)">{formatarY(t)}</text>
          </g>
        ))}
        {ticks(0, xMax, Math.min(6, Math.floor(largura / 90))).map((t) => (
          <text key={t} x={px(t)} y={altura - m.b + 16} fontSize={11} textAnchor="middle" fill="var(--color-suave)">{t}</text>
        ))}
        <text x={m.e} y={altura - 2} fontSize={11} fill="var(--color-suave)">{rotuloX}</text>
        {pontoAtivo && <line x1={px(pontoAtivo.x)} x2={px(pontoAtivo.x)} y1={m.t} y2={altura - m.b} stroke="var(--color-suave)" strokeDasharray="3 3" />}
        <path d={caminho} fill="none" stroke={cor} strokeWidth={2} strokeLinejoin="round" />
        {validos.map((p, i) => (
          <circle key={i} cx={px(p.x)} cy={py(p.y!)} r={pontoAtivo === p ? 5.5 : 4} fill={cor} stroke="var(--color-superficie)" strokeWidth={2} />
        ))}
        {ultimo && (
          <text x={px(ultimo.x)} y={py(ultimo.y!) - 10} fontSize={11} fontWeight={600} textAnchor="end" fill="var(--color-texto)">
            {formatarY(ultimo.y!)}
          </text>
        )}
        <rect x={m.e} y={0} width={largura - m.e - m.d} height={altura - m.b} fill="transparent"
          onMouseMove={mover} onMouseLeave={() => setAtivo(null)} />
      </svg>
      {pontoAtivo && pontoAtivo.y !== null && <Dica x={px(pontoAtivo.x)} y={py(pontoAtivo.y)} largura={largura}>{pontoAtivo.dica}</Dica>}
    </div>
  );
}

// -----------------------------------------------------------------------------------------------

const decimal = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function quantil(ordenados: number[], q: number): number {
  const pos = (ordenados.length - 1) * q;
  const base = Math.floor(pos);
  const resto = pos - base;
  return ordenados[base] + (ordenados[base + 1] !== undefined ? resto * (ordenados[base + 1] - ordenados[base]) : 0);
}

export function resumoCaixa(valores: number[]) {
  const v = [...valores].sort((a, b) => a - b);
  const q1 = quantil(v, 0.25), mediana = quantil(v, 0.5), q3 = quantil(v, 0.75);
  const iqr = q3 - q1;
  const dentro = v.filter((x) => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr);
  return {
    n: v.length, q1, mediana, q3, media: v.reduce((a, b) => a + b, 0) / v.length,
    bigodeMin: dentro[0], bigodeMax: dentro.at(-1)!, atipicos: v.filter((x) => !dentro.includes(x)),
  };
}

export interface GrupoCaixa {
  chave: string;
  nome: string;
  cor: string;
  valores: number[];
}

/** Diagramas de caixa lado a lado; losango = média; linha horizontal de referência opcional. */
export function Boxplot({ grupos, rotuloY, referencia }: { grupos: GrupoCaixa[]; rotuloY: string; referencia?: { valor: number; rotulo: string } }) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [ativo, setAtivo] = useState<number | null>(null);
  const altura = 260;
  const m = { e: 48, d: 12, t: 12, b: 48 };
  const todos = grupos.flatMap((g) => g.valores);
  const yMin = Math.min(0, ...todos), yMax = Math.max(referencia?.valor ?? 0, ...todos);
  // a escala sempre cobre todos os valores (os bigodes não podem sair da área do gráfico)
  const escala = ticks(yMin, yMax, 5);
  const passo = escala.length > 1 ? escala[1] - escala[0] : 10;
  if (escala[0] > yMin) escala.unshift(Number((escala[0] - passo).toFixed(6)));
  if (escala.at(-1)! < yMax) escala.push(Number((escala.at(-1)! + passo).toFixed(6)));
  const [lo, hi] = [escala[0], escala.at(-1)!];
  const py = (y: number) => altura - m.b - ((y - lo) / (hi - lo)) * (altura - m.t - m.b);
  const faixa = (largura - m.e - m.d) / grupos.length;
  const cx = (i: number) => m.e + faixa * (i + 0.5);
  const meia = Math.min(36, faixa * 0.25);
  const resumos = grupos.map((g) => resumoCaixa(g.valores));

  return (
    <div ref={ref} className="relative">
      <svg width={largura} height={altura} role="img" aria-label={`Diagramas de caixa: ${rotuloY}`} className="block">
        {escala.map((t) => (
          <g key={t}>
            <line x1={m.e} x2={largura - m.d} y1={py(t)} y2={py(t)} stroke={t === 0 ? "var(--color-suave)" : "var(--color-grade)"} />
            <text x={m.e - 8} y={py(t)} fontSize={11} textAnchor="end" dominantBaseline="middle" fill="var(--color-suave)">{t}%</text>
          </g>
        ))}
        <text x={12} y={altura / 2 - m.b / 2} fontSize={11} fill="var(--color-suave)" transform={`rotate(-90 12 ${altura / 2 - m.b / 2})`} textAnchor="middle">{rotuloY}</text>
        {referencia && (
          <g>
            <line x1={m.e} x2={largura - m.d} y1={py(referencia.valor)} y2={py(referencia.valor)} stroke="var(--color-suave)" strokeDasharray="2 4" />
            <text x={largura - m.d} y={py(referencia.valor) - 5} fontSize={10} textAnchor="end" fill="var(--color-suave)">{referencia.rotulo}</text>
          </g>
        )}
        {grupos.map((g, i) => {
          const r = resumos[i];
          if (!r.n) return null;
          return (
            <g key={g.chave} onMouseEnter={() => setAtivo(i)} onMouseLeave={() => setAtivo(null)}>
              {/* alvo de passagem do mouse maior que a marca */}
              <rect x={cx(i) - faixa / 2} y={m.t} width={faixa} height={altura - m.t - m.b} fill="transparent" />
              <line x1={cx(i)} x2={cx(i)} y1={py(r.bigodeMin)} y2={py(r.q1)} stroke={g.cor} strokeWidth={2} />
              <line x1={cx(i)} x2={cx(i)} y1={py(r.q3)} y2={py(r.bigodeMax)} stroke={g.cor} strokeWidth={2} />
              <rect x={cx(i) - meia} y={py(r.q3)} width={meia * 2} height={Math.max(2, py(r.q1) - py(r.q3))} rx={4}
                fill={g.cor} fillOpacity={ativo === i ? 0.35 : 0.2} stroke={g.cor} strokeWidth={2} />
              <line x1={cx(i) - meia} x2={cx(i) + meia} y1={py(r.mediana)} y2={py(r.mediana)} stroke={g.cor} strokeWidth={3} />
              <rect x={cx(i) - 5} y={py(r.media) - 5} width={10} height={10} transform={`rotate(45 ${cx(i)} ${py(r.media)})`}
                fill="var(--color-texto)" stroke="var(--color-superficie)" strokeWidth={2} />
              {r.atipicos.map((v, k) => <circle key={k} cx={cx(i)} cy={py(v)} r={4} fill="var(--color-superficie)" stroke={g.cor} strokeWidth={2} />)}
              {/* rótulo direto: a cor nunca é a única forma de identificar o grupo */}
              <text x={cx(i)} y={altura - m.b + 18} fontSize={12} textAnchor="middle" fill="var(--color-texto)">{g.nome}</text>
              <text x={cx(i)} y={altura - m.b + 34} fontSize={11} textAnchor="middle" fill="var(--color-suave)">n = {r.n}</text>
            </g>
          );
        })}
      </svg>
      {ativo !== null && resumos[ativo].n > 0 && (
        <Dica x={cx(ativo) + meia} y={py(resumos[ativo].q3)} largura={largura}>
          <p className="font-medium">{grupos[ativo].nome}</p>
          <p>Mediana {decimal(resumos[ativo].mediana)}% · média {decimal(resumos[ativo].media)}%</p>
          <p className="text-suave">Quartis {decimal(resumos[ativo].q1)}% a {decimal(resumos[ativo].q3)}% · n = {resumos[ativo].n}</p>
        </Dica>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------------------------

/** Barras horizontais de proporção (0 a 100%), com o valor escrito ao lado de cada barra. */
export function BarrasHorizontais({ itens, cor = "var(--color-serie-1)" }: { itens: { rotulo: string; valor: number; detalhe?: string }[]; cor?: string }) {
  return (
    <ul className="space-y-1.5">
      {itens.map((item) => (
        <li key={item.rotulo} className="group grid grid-cols-[minmax(7rem,11rem)_1fr_3rem] items-center gap-3 text-sm" title={item.detalhe}>
          <span className="truncate text-suave group-hover:text-texto">{item.rotulo}</span>
          <span className="h-3 rounded-r bg-grade" aria-hidden="true">
            <span className="block h-3 rounded-r-[4px] group-hover:opacity-80" style={{ width: `${Math.max(0, Math.min(100, item.valor))}%`, background: cor }} />
          </span>
          <span className="text-right tabular-nums">{item.valor.toFixed(0)}%</span>
        </li>
      ))}
    </ul>
  );
}
