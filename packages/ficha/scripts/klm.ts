// Avaliação sem participantes (substituto parcial do Experimento C): estimativa do tempo de
// preenchimento pelo Keystroke-Level Model (Card, Moran e Newell, 1980).
//
// Operadores do artigo original: K = 0,28 s (tecla ou clique, digitador médio não profissional),
// P = 1,10 s (apontar com o mouse), H = 0,40 s (levar a mão do mouse ao teclado ou de volta) e
// M = 1,35 s (preparação mental). O tempo de resposta do sistema (R) é relatado à parte.
//
// Modelagem de cada campo, conforme o controle que a interface gera a partir do esquema:
//   escolha, sim/não, escala 0 a 10, palpação (tabela) → M P K
//   múltipla escolha                                   → M + (P K) por opção marcada
//   número ou texto                                     → M P K H + K por caractere + H
//   palpação pelo mapa (clique cíclico)                 → M P + K × (intensidade + 1)
//   troca de seção na navegação lateral                 → M P K
// Campos vazios no documento não são tocados.
//
// Uso (em packages/ficha):  npx tsx scripts/klm.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Esquema, lerCaminho, listarCampos } from "../src/index";

export const OPERADORES = { K: 0.28, P: 1.1, H: 0.4, M: 1.35 } as const;
const { K, P, H, M } = OPERADORES;

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EXEMPLO = JSON.parse(readFileSync(join(RAIZ, "packages", "ficha", "exemplos", "ficha-inicial.exemplo.json"), "utf-8"));
const CAMPOS = listarCampos("ficha-inicial");
const PORCAMINHO = new Map(CAMPOS.map((c) => [c.caminho, c]));

const tipos = (e: Esquema) => (Array.isArray(e.type) ? e.type : [e.type]) as string[];

/** Mesma regra de CampoEsquema.tipoDeControle (apps/web). */
function controle(e: Esquema): "escolha" | "multipla" | "simnao" | "escala" | "numero" | "texto" {
  const t = tipos(e);
  if (Array.isArray(e.enum)) return "escolha";
  if (t.includes("array")) return "multipla";
  if (t.includes("boolean")) return "simnao";
  if (t.includes("integer") && e.minimum === 0 && e.maximum === 10) return "escala";
  if (t.includes("integer") || t.includes("number")) return "numero";
  return "texto";
}

const vazio = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** Tempo (s) para preencher um campo pelo formulário com o valor dado. */
export function tempoCampo(e: Esquema, valor: unknown): number {
  if (vazio(valor)) return 0;
  switch (controle(e)) {
    case "escolha": case "simnao": case "escala": return M + P + K;
    case "multipla": return M + (valor as unknown[]).length * (P + K);
    case "numero": case "texto": return M + P + K + H + String(valor).length * K + H;
  }
}

const ehPalpacao = (caminho: string) => /\.q4[45]_palpacao_(muscular|articular)\./.test(caminho);

// 1) Ficha inicial completa pelo formulário, com os valores da ficha de exemplo
const porSecao = new Map<string, { campos: number; segundos: number }>();
let palpacaoTabela = 0, palpacaoMapa = 0, sitiosPalpados = 0;
for (const c of CAMPOS) {
  const valor = lerCaminho(EXEMPLO, c.caminho);
  if (vazio(valor)) continue;
  const s = porSecao.get(c.secao) ?? { campos: 0, segundos: M + P + K };
  s.campos++;
  s.segundos += tempoCampo(c.esquema, valor);
  porSecao.set(c.secao, s);
  if (ehPalpacao(c.caminho)) {
    sitiosPalpados++;
    palpacaoTabela += M + P + K;
    palpacaoMapa += M + P + K * ((valor as number) + 1);
  }
}
const arred = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const fichaCompleta = {
  secoes: Object.fromEntries([...porSecao].map(([k, v]) => [k, { campos: v.campos, segundos: arred(v.segundos) }])),
  campos: [...porSecao.values()].reduce((a, s) => a + s.campos, 0),
  minutos: arred([...porSecao.values()].reduce((a, s) => a + s.segundos, 0) / 60, 2),
  palpacao: { sitios: sitiosPalpados, tabela_s: arred(palpacaoTabela), mapa_s: arred(palpacaoMapa) },
};

// 2) Seções de ditado: digitar tudo × revisar as sugestões do Experimento A
//    aceitar (VP) ou rejeitar (FP): M P K; valor errado (EV): rejeitar e digitar; omissão (FN): digitar.
function lerCsv(texto: string): Record<string, string>[] {
  const linhas: string[][] = [];
  let campo = "", linha: string[] = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === ",") { linha.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = "";
    } else campo += ch;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  const [cab, ...resto] = linhas;
  return resto.filter((l) => l.length === cab.length).map((l) => Object.fromEntries(cab.map((c, i) => [c, l[i]])));
}
const valorDoCsv = (s: string): unknown => { if (s === "") return null; try { return JSON.parse(s); } catch { return s; } };

const PASTA_A = join(RAIZ, "dados", "resultados", "experimento-a", "teste-v4");
const linhas = lerCsv(readFileSync(join(PASTA_A, "campos.csv"), "utf-8"))
  .filter((l) => l.estrategia === "inteira" && l.modo === "salvaguardas");
const casos = new Map<string, { digitar: number; revisar: number; sugestoes: number; campos: number }>();
for (const l of linhas) {
  const c = PORCAMINHO.get(l.caminho);
  if (!c) continue;
  const caso = casos.get(l.caso) ?? { digitar: 0, revisar: 3 * (M + P + K), sugestoes: 0, campos: 0 }; // gravar, parar, enviar
  const custo = tempoCampo(c.esquema, valorDoCsv(l.gabarito));
  if (custo > 0) { caso.digitar += custo; caso.campos++; }
  if (l.classe === "VP" || l.classe === "FP") { caso.revisar += M + P + K; caso.sugestoes++; }
  else if (l.classe === "ERRO_VALOR") { caso.revisar += M + P + K + custo; caso.sugestoes++; }
  else if (l.classe === "FN") caso.revisar += custo;
  casos.set(l.caso, caso);
}
const narrativas = [...casos.keys()].map((c) =>
  readFileSync(join(RAIZ, "dados", "sinteticos", "casos", c, "narrativa.txt"), "utf-8").trim().split(/\s+/).length);
const mediana = (xs: number[]) => { const o = [...xs].sort((a, b) => a - b); const m = o.length >> 1; return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2; };
const lista = [...casos.values()];
const ditado = {
  casos: lista.length,
  modelo: "qwen2.5:3b, ficha inteira, com salvaguardas",
  campos_no_gabarito_mediana: mediana(lista.map((c) => c.campos)),
  sugestoes_mediana: mediana(lista.map((c) => c.sugestoes)),
  digitar_s: { mediana: arred(mediana(lista.map((c) => c.digitar))), min: arred(Math.min(...lista.map((c) => c.digitar))), max: arred(Math.max(...lista.map((c) => c.digitar))) },
  revisar_s: { mediana: arred(mediana(lista.map((c) => c.revisar))), min: arred(Math.min(...lista.map((c) => c.revisar))), max: arred(Math.max(...lista.map((c) => c.revisar))) },
  reducao_mediana: arred(mediana(lista.map((c) => 1 - c.revisar / c.digitar)), 3),
  palavras_narrativa: { mediana: mediana(narrativas), min: Math.min(...narrativas), max: Math.max(...narrativas) },
};

const resultado = { operadores: OPERADORES, ficha_completa: fichaCompleta, ditado };
const PASTA = join(RAIZ, "dados", "resultados", "klm");
mkdirSync(PASTA, { recursive: true });
writeFileSync(join(PASTA, "resultado.json"), JSON.stringify(resultado, null, 2) + "\n", "utf-8");
console.log(JSON.stringify(resultado, null, 2));
