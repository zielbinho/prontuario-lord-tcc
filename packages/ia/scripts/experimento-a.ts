// Experimento A (seção 4.9.2 do TCC): qualidade da estruturação automática da anamnese.
//
// Para cada caso com narrativa, cada modelo e cada estratégia, compara campo a campo a saída do
// modelo com o gabarito, em dois momentos: a saída BRUTA do modelo e a saída APÓS AS SALVAGUARDAS
// (descarte de valores sem evidência, com evidência ausente do relato ou incoerentes).
//
// Uso (em packages/ia):
//   npx tsx scripts/experimento-a.ts --divisao teste --modelos qwen2.5:3b --estrategias secao,inteira
//   npx tsx scripts/experimento-a.ts --desenvolvimento   (narrativas de desenvolvimento, só para testar)
import { extrairSugestoes, lerCaminho, listarCampos } from "@lord/ficha";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { clienteOllama, ErroConexaoModelo, ErroModelo, estruturar, VERSAO_PROMPT } from "../src";

export const SECOES_ALVO = ["queixa_principal", "historia_medica", "historia_odontologica", "protese", "observacoes"];

type Classe = "VP" | "VN" | "FP" | "FN" | "ERRO_VALOR";

export interface ComparacaoCampo {
  caminho: string;
  tipo: "texto" | "outro";
  gabarito: unknown;
  predito: unknown;
  classe: Classe;
  /** similaridade de palavras (0 a 1) para campos de texto; indicador aproximado */
  similaridade: number | null;
}

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const vazio = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

function palavras(texto: string): string[] {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ").filter((p) => p.length > 2);
}

/** F1 entre os conjuntos de palavras de dois textos. */
export function similaridadeTexto(a: string, b: string): number {
  const pa = new Set(palavras(a));
  const pb = new Set(palavras(b));
  if (pa.size === 0 && pb.size === 0) return 1;
  const comuns = [...pa].filter((p) => pb.has(p)).length;
  if (comuns === 0) return 0;
  const precisao = comuns / pb.size;
  const revocacao = comuns / pa.size;
  return (2 * precisao * revocacao) / (precisao + revocacao);
}

function iguais(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x) => b.includes(x));
  return a === b;
}

/** Limiar de similaridade para considerar um campo de texto correto na medida automática. */
export const LIMIAR_TEXTO = 0.5;

export function compararCampo(caminho: string, ehTexto: boolean, gabarito: unknown, predito: unknown): ComparacaoCampo {
  const base = { caminho, tipo: ehTexto ? "texto" : "outro", gabarito: gabarito ?? null, predito: predito ?? null } as const;
  if (vazio(gabarito) && vazio(predito)) return { ...base, classe: "VN", similaridade: null };
  if (vazio(gabarito)) return { ...base, classe: "FP", similaridade: null };
  if (vazio(predito)) return { ...base, classe: "FN", similaridade: null };
  if (ehTexto) {
    const s = similaridadeTexto(String(gabarito), String(predito));
    return { ...base, classe: s >= LIMIAR_TEXTO ? "VP" : "ERRO_VALOR", similaridade: Number(s.toFixed(3)) };
  }
  return { ...base, classe: iguais(gabarito, predito) ? "VP" : "ERRO_VALOR", similaridade: null };
}

export interface Metricas {
  campos: number;
  vp: number; fp: number; fn: number; vn: number; erroValor: number;
  precisao: number; revocacao: number; f1: number;
  /** campos preenchidos pelo modelo cujo gabarito é vazio, sobre todos os campos com gabarito vazio */
  alucinacao: number;
  /** campos deixados vazios pelo modelo cujo gabarito tem valor, sobre todos os campos com valor */
  omissao: number;
}

/** Valor errado conta como falso positivo e falso negativo, como é usual em extração de informação. */
export function calcularMetricas(comparacoes: ComparacaoCampo[]): Metricas {
  const conta = (c: Classe) => comparacoes.filter((x) => x.classe === c).length;
  const vp = conta("VP"), fp = conta("FP"), fn = conta("FN"), vn = conta("VN"), erroValor = conta("ERRO_VALOR");
  const precisao = vp + fp + erroValor ? vp / (vp + fp + erroValor) : 0;
  const revocacao = vp + fn + erroValor ? vp / (vp + fn + erroValor) : 0;
  const f1 = precisao + revocacao ? (2 * precisao * revocacao) / (precisao + revocacao) : 0;
  const gabaritoVazio = vn + fp;
  const gabaritoComValor = vp + fn + erroValor;
  return {
    campos: comparacoes.length, vp, fp, fn, vn, erroValor,
    precisao: arred(precisao), revocacao: arred(revocacao), f1: arred(f1),
    alucinacao: arred(gabaritoVazio ? fp / gabaritoVazio : 0),
    omissao: arred(gabaritoComValor ? fn / gabaritoComValor : 0),
  };
}

const arred = (x: number) => Number(x.toFixed(4));

/** Documento predito a partir da saída do modelo: só os valores, sem as evidências. */
function valoresDaSaida(saida: unknown): unknown {
  if (saida && typeof saida === "object" && "valor" in saida && "evidencia" in saida) return (saida as { valor: unknown }).valor;
  if (saida && typeof saida === "object") {
    return Object.fromEntries(Object.entries(saida).map(([k, v]) => [k, valoresDaSaida(v)]));
  }
  return saida;
}

function comparar(gabarito: unknown, predito: unknown, secoes: string[]): ComparacaoCampo[] {
  return listarCampos("ficha-inicial")
    .filter((c) => secoes.includes(c.secao) && !c.somenteHumano)
    .map((c) => {
      const tipos = ([] as string[]).concat((c.esquema.type as string | string[] | undefined) ?? []);
      const ehTexto = tipos.includes("string") && !Array.isArray(c.esquema.enum);
      return compararCampo(c.caminho, ehTexto, lerCaminho(gabarito, c.caminho), lerCaminho(predito, c.caminho));
    });
}

// ---------------------------------------------------------------------------------------------

interface Caso { id: string; divisao: string; desafios: string[]; narrativa: string; gabarito: unknown }

function carregarCasos(divisao: string, desenvolvimento: boolean, pastaNarrativas?: string, somente?: string[]): Caso[] {
  const pastaCasos = join(RAIZ, "dados", "sinteticos", "casos");
  const linhas = readFileSync(join(pastaCasos, "indice.csv"), "utf-8").trim().split(/\r?\n/).slice(1);
  return linhas.flatMap((linha) => {
    const [id, , , , div, desafios] = linha.split(",");
    if (divisao !== "todos" && div !== divisao) return [];
    if (somente && !somente.includes(id)) return [];
    const arquivo = pastaNarrativas ? join(pastaNarrativas, `${id}.txt`) : desenvolvimento
      ? join(RAIZ, "dados", "sinteticos", "desenvolvimento", `${id}.txt`)
      : join(pastaCasos, id, "narrativa.txt");
    if (!existsSync(arquivo)) return [];
    if (desenvolvimento && div !== "ajuste") throw new Error(`${id}: narrativa de desenvolvimento em caso de teste`);
    return [{
      id, divisao: div, desafios: desafios ? desafios.split(";") : [],
      narrativa: readFileSync(arquivo, "utf-8"),
      gabarito: JSON.parse(readFileSync(join(pastaCasos, id, "gabarito.json"), "utf-8")),
    }];
  });
}

const csv = (v: unknown) => {
  const t = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** Uma execução (caso × modelo × estratégia × repetição), gravada assim que termina. */
export interface Execucao {
  caso: string; modelo: string; estrategia: string; repeticao: number; versao_prompt: string;
  latencia_s: number; tokens: number; saidas_invalidas: number;
  /** mensagem de cada saída inválida (JSON quebrado, fora do esquema...) */
  erros?: string[];
  /** saída crua do modelo por seção; permite reavaliar as salvaguardas sem chamar o modelo de novo */
  saidas?: Record<string, unknown>;
  bruto: Record<string, unknown>; salvaguardas: Record<string, unknown>;
  /** valores barrados pelas salvaguardas, com a evidência citada e o motivo */
  descartados?: { caminho: string; valor: unknown; evidencia?: string; motivo: string }[];
}

const chaveExecucao = (e: Pick<Execucao, "caso" | "modelo" | "estrategia" | "repeticao">) =>
  `${e.caso}|${e.modelo}|${e.estrategia}|${e.repeticao}`;

/** Lê as execuções já gravadas (retomada após interrupção); recusa misturar versões de prompt. */
export function lerExecucoes(arquivo: string, versaoPrompt: string): Execucao[] {
  if (!existsSync(arquivo)) return [];
  const execucoes = readFileSync(arquivo, "utf-8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as Execucao);
  const outra = execucoes.find((e) => e.versao_prompt !== versaoPrompt);
  if (outra) throw new Error(`${arquivo} tem execuções do prompt ${outra.versao_prompt}; use outra pasta de saída`);
  return execucoes;
}

/** Saída bruta (só os valores) e saída após as salvaguardas, a partir da saída crua de cada seção. */
export function aplicarSalvaguardas(saidas: Record<string, unknown>, relato: string) {
  const bruto: Record<string, unknown> = {};
  const salvaguardas: Record<string, unknown> = {};
  const descartados: NonNullable<Execucao["descartados"]> = [];
  for (const [secao, saida] of Object.entries(saidas)) {
    bruto[secao] = valoresDaSaida(saida);
    const r = extrairSugestoes(saida, secao, relato);
    descartados.push(...r.descartados);
    for (const sug of r.sugestoes) {
      const [s, ...resto] = sug.caminho.split(".");
      let alvo = (salvaguardas[s] ??= {}) as Record<string, unknown>;
      resto.slice(0, -1).forEach((k) => (alvo = (alvo[k] ??= {}) as Record<string, unknown>));
      alvo[resto.at(-1)!] = sug.valor;
    }
  }
  return { bruto, salvaguardas, descartados };
}

/** Falhas de conexão passageiras (Ollama reiniciando) têm até 3 tentativas; saída inválida não é repetida. */
async function comNovasTentativas<T>(chamada: () => Promise<T>, tentativas = 3, esperaMs = 30_000): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await chamada();
    } catch (e) {
      if (!(e instanceof ErroConexaoModelo) || i >= tentativas) throw e;
      console.error(`falha de conexão (tentativa ${i} de ${tentativas}); nova tentativa em ${esperaMs / 1000} s`);
      await new Promise((r) => setTimeout(r, esperaMs));
    }
  }
}

async function executar(cliente: ReturnType<typeof clienteOllama>, caso: Caso, modelo: string, estrategia: string, repeticao: number): Promise<Execucao> {
  const lotes = estrategia === "inteira" ? [SECOES_ALVO] : SECOES_ALVO.map((s) => [s]);
  const saidas: Record<string, unknown> = {};
  let latenciaMs = 0, tokens = 0, invalidas = 0;
  const erros: string[] = [];
  for (const secoes of lotes) {
    try {
      const r = await comNovasTentativas(() => estruturar(cliente, { secoes, relato: caso.narrativa, modelo }));
      latenciaMs += r.latenciaMs;
      tokens += r.tokensGerados;
      for (const s of secoes) saidas[s] = secoes.length === 1 ? r.saida : r.saida[s];
    } catch (e) {
      // falha de conexão ou tempo esgotado interrompe o experimento sem gravar a execução:
      // rodar de novo retoma daqui, e "saídas inválidas" mede só a qualidade do modelo
      if (!(e instanceof ErroModelo) || e instanceof ErroConexaoModelo) throw e;
      invalidas++; // saída inválida: os campos do lote ficam vazios (contam como omissão)
      erros.push(`${secoes.join("+")}: ${e.message}`);
    }
  }
  return {
    caso: caso.id, modelo, estrategia, repeticao, versao_prompt: VERSAO_PROMPT,
    latencia_s: latenciaMs / 1000, tokens, saidas_invalidas: invalidas, erros, saidas,
    ...aplicarSalvaguardas(saidas, caso.narrativa),
  };
}

async function principal() {
  const { values } = parseArgs({
    options: {
      divisao: { type: "string", default: "teste" },
      modelos: { type: "string", default: "qwen2.5:3b" },
      estrategias: { type: "string", default: "secao,inteira" },
      repeticoes: { type: "string", default: "1" },
      desenvolvimento: { type: "boolean", default: false },
      saida: { type: "string" },
      // Experimento B: relatos transcritos do áudio (<pasta>/<caso>.txt) no lugar das narrativas
      narrativas: { type: "string" },
      casos: { type: "string" },
    },
  });
  const casos = carregarCasos(values.desenvolvimento ? "ajuste" : values.divisao!, values.desenvolvimento!,
    values.narrativas, values.casos?.split(","));
  if (casos.length === 0) {
    console.error("Nenhum caso com narrativa encontrado. As narrativas oficiais ficam em dados/sinteticos/casos/caso_NNN/narrativa.txt.");
    process.exit(1);
  }
  const carimbo = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const pasta = values.saida ?? join(RAIZ, "dados", "resultados", "experimento-a", `${values.desenvolvimento ? "dev-" : ""}${carimbo}`);
  mkdirSync(pasta, { recursive: true });

  // cada execução é gravada ao terminar; rodar de novo com a mesma --saida retoma de onde parou
  const arquivoExecucoes = join(pasta, "execucoes.jsonl");
  const feitas = new Map(lerExecucoes(arquivoExecucoes, VERSAO_PROMPT).map((e) => [chaveExecucao(e), e]));
  if (feitas.size) console.log(`Retomando: ${feitas.size} execução(ões) já gravada(s) em ${arquivoExecucoes}`);

  const cliente = clienteOllama(undefined, 15 * 60_000); // ficha inteira em CPU pode passar de 5 min
  const execucoes: Execucao[] = [];
  for (const modelo of values.modelos!.split(",")) {
    for (const estrategia of values.estrategias!.split(",")) {
      for (let rep = 1; rep <= Number(values.repeticoes); rep++) {
        for (const caso of casos) {
          let e = feitas.get(chaveExecucao({ caso: caso.id, modelo, estrategia, repeticao: rep }));
          if (!e) {
            e = await executar(cliente, caso, modelo, estrategia, rep);
            appendFileSync(arquivoExecucoes, JSON.stringify(e) + "\n", "utf-8");
            const m = calcularMetricas(comparar(caso.gabarito, e.salvaguardas, SECOES_ALVO));
            console.log(`${caso.id} ${modelo} ${estrategia} #${rep}: ${e.latencia_s.toFixed(0)} s, F1 ${m.f1}, alucinação ${m.alucinacao}`);
          }
          // com a saída crua gravada, as salvaguardas são recalculadas com o código atual
          if (e.saidas) e = { ...e, ...aplicarSalvaguardas(e.saidas, caso.narrativa) };
          execucoes.push(e);
        }
      }
    }
  }

  const gabaritos = new Map(casos.map((c) => [c.id, c.gabarito]));
  const registros: { caso: string; modelo: string; estrategia: string; repeticao: number; modo: string; c: ComparacaoCampo }[] = [];
  const porGrupo = new Map<string, ComparacaoCampo[]>();
  for (const e of execucoes) {
    for (const [modo, predito] of [["bruto", e.bruto], ["salvaguardas", e.salvaguardas]] as const) {
      const comparacoes = comparar(gabaritos.get(e.caso), predito, SECOES_ALVO);
      const chave = `${e.modelo}|${e.estrategia}|${modo}`;
      porGrupo.set(chave, [...(porGrupo.get(chave) ?? []), ...comparacoes]);
      for (const c of comparacoes) registros.push({ caso: e.caso, modelo: e.modelo, estrategia: e.estrategia, repeticao: e.repeticao, modo, c });
    }
  }

  const resumo = [...porGrupo.entries()].map(([chave, comparacoes]) => {
    const [modelo, estrategia, modo] = chave.split("|");
    const porSecao = Object.fromEntries(SECOES_ALVO.map((s) => [s, calcularMetricas(comparacoes.filter((c) => c.caminho.startsWith(`${s}.`))).f1]));
    const doGrupo = execucoes.filter((e) => e.modelo === modelo && e.estrategia === estrategia);
    return {
      modelo, estrategia, modo, ...calcularMetricas(comparacoes), f1_por_secao: porSecao,
      // campos fechados (opções, sim/não, números) têm comparação exata; nos de texto a medida
      // automática é só aproximada e a avaliação definitiva é a humana
      f1_campos_fechados: calcularMetricas(comparacoes.filter((c) => c.tipo === "outro")).f1,
      f1_texto_automatico: calcularMetricas(comparacoes.filter((c) => c.tipo === "texto")).f1,
      latencia_media_s: arred(doGrupo.reduce((a, e) => a + e.latencia_s, 0) / doGrupo.length),
      saidas_invalidas: doGrupo.reduce((a, e) => a + e.saidas_invalidas, 0),
    };
  });

  const linha = (valores: unknown[]) => valores.map(csv).join(",");
  writeFileSync(join(pasta, "campos.csv"), [
    "caso,modelo,estrategia,repeticao,modo,caminho,tipo,classe,similaridade,gabarito,predito",
    ...registros.map((r) => linha([r.caso, r.modelo, r.estrategia, r.repeticao, r.modo, r.c.caminho, r.c.tipo, r.c.classe, r.c.similaridade, r.c.gabarito, r.c.predito])),
  ].join("\n") + "\n", "utf-8");
  writeFileSync(join(pasta, "resumo.json"), JSON.stringify({
    versao_prompt: VERSAO_PROMPT, limiar_texto: LIMIAR_TEXTO, desenvolvimento: values.desenvolvimento,
    casos: casos.map((c) => c.id), resumo,
    execucoes: execucoes.map(({ saidas: _c, bruto: _b, salvaguardas: _s, descartados, ...resto }) => ({ ...resto, descartados: descartados?.length ?? null })),
  }, null, 2), "utf-8");
  // pares de texto para a avaliação humana (0 = inadequado, 1 = parcial, 2 = adequado)
  const pares = registros.filter((r) => r.modo === "salvaguardas" && r.c.tipo === "texto" && r.c.classe !== "VN");
  writeFileSync(join(pasta, "avaliacao-humana-texto.csv"), [
    "caso,modelo,estrategia,repeticao,caminho,gabarito,predito,similaridade_automatica,nota_0a2",
    ...pares.map((r) => linha([r.caso, r.modelo, r.estrategia, r.repeticao, r.c.caminho, r.c.gabarito, r.c.predito, r.c.similaridade, ""])),
  ].join("\n") + "\n", "utf-8");

  const tabela = ["| Modelo | Estratégia | Modo | P | R | F1 | F1 fechados | F1 texto (aprox.) | Alucinação | Omissão | Latência (s) |", "|---|---|---|---|---|---|---|---|---|---|---|",
    ...resumo.map((r) => `| ${r.modelo} | ${r.estrategia} | ${r.modo} | ${r.precisao} | ${r.revocacao} | ${r.f1} | ${r.f1_campos_fechados} | ${r.f1_texto_automatico} | ${r.alucinacao} | ${r.omissao} | ${r.latencia_media_s} |`)];
  writeFileSync(join(pasta, "resumo.md"), `# Experimento A${values.desenvolvimento ? " (DESENVOLVIMENTO, não oficial)" : ""}\n\nPrompt ${VERSAO_PROMPT}; ${casos.length} caso(s): ${casos.map((c) => c.id).join(", ")}.\n\n${tabela.join("\n")}\n`, "utf-8");
  console.log(`\n${tabela.join("\n")}\n\nResultados em ${pasta} (${pares.length} pares de texto para avaliação humana)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await principal();
