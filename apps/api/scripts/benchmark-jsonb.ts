// Avaliação técnica (seção 4.9.6 do TCC): persistência híbrida (JSONB) x modelo normalizado para o
// mapa de palpação e o odontograma, os dois componentes citados no parecer técnico.
//
// Os dois modelos guardam o restante da ficha do mesmo jeito (um documento JSONB); só muda onde
// ficam a palpação (questões 44 e 45) e o odontograma: dentro do JSONB, como no sistema, ou em
// tabelas relacionais próprias. Roda num PostgreSQL 17 temporário (não toca o banco de desenvolvimento).
//
// Uso (em apps/api):  npx tsx scripts/benchmark-jsonb.ts [--pacientes 1000,10000] [--repeticoes 300]
import EmbeddedPostgres from "embedded-postgres";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import postgres, { type Sql } from "postgres";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EXEMPLO = JSON.parse(readFileSync(join(RAIZ, "packages", "ficha", "exemplos", "ficha-inicial.exemplo.json"), "utf-8"));
const SITIOS_MUSCULARES = Object.keys(EXEMPLO.exame_dtm.q44_palpacao_muscular);
const SITIOS_ARTICULARES = Object.keys(EXEMPLO.exame_dtm.q45_palpacao_articular);
const DENTES = [11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28, 31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48];
const CONDICOES = ["coroa", "tratamento_endodontico", "recessao", "atricao", "abfracao"];
const ESTADOS_FACE = ["carie", "restauracao", "lesao_cervical_nao_cariosa"];

// gerador pseudoaleatório com semente (resultados reprodutíveis)
let semente = 2026;
const aleatorio = () => ((semente = (semente * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const sortear = <T>(lista: T[]) => lista[Math.floor(aleatorio() * lista.length)];

function palpacao() {
  const bilateral = () => ({ direito: Math.floor(aleatorio() * 4), esquerdo: Math.floor(aleatorio() * 4) });
  return {
    q44_palpacao_muscular: Object.fromEntries(SITIOS_MUSCULARES.map((s) => [s, bilateral()])),
    q45_palpacao_articular: Object.fromEntries(SITIOS_ARTICULARES.map((s) => [s, bilateral()])),
  };
}

function odontograma() {
  const doc: Record<string, { ausente?: boolean; condicoes?: string[]; faces?: Record<string, string> }> = {};
  for (const dente of DENTES) {
    const r = aleatorio();
    if (r < 0.06) doc[dente] = { ausente: true };
    else if (r < 0.3) {
      doc[dente] = {};
      if (aleatorio() < 0.4) doc[dente].condicoes = [sortear(CONDICOES)];
      if (aleatorio() < 0.8) doc[dente].faces = Object.fromEntries(["O", "M", "D", "V", "L"].filter(() => aleatorio() < 0.3).map((f) => [f, sortear(ESTADOS_FACE)]));
    }
  }
  return doc;
}

interface Consulta { data: string; tipo: string; ficha: Record<string, unknown>; palpacao: ReturnType<typeof palpacao>; odontograma?: ReturnType<typeof odontograma> }

function paciente(): Consulta[] {
  const inicial = structuredClone(EXEMPLO);
  const p0 = palpacao();
  const consultas: Consulta[] = [{ data: "2026-01-10", tipo: "primeira_consulta", ficha: inicial, palpacao: p0, odontograma: odontograma() }];
  for (const [i, data] of ["2026-02-10", "2026-03-10"].entries()) {
    consultas.push({
      data, tipo: "retorno", palpacao: palpacao(),
      ficha: { dor: { q16_dor_atual: 5 - i, q17_pior_dor: 7 - i, q18_dor_media: 5 - i }, exame: { q39b_abertura_maxima_sem_auxilio_mm: 40 + i } },
    });
  }
  return consultas;
}

/** Ficha no modelo híbrido: palpação dentro do documento. */
function fichaHibrida(c: Consulta) {
  const dados = structuredClone(c.ficha) as Record<string, Record<string, unknown>>;
  const secao = c.tipo === "primeira_consulta" ? "exame_dtm" : "exame";
  dados[secao] = { ...dados[secao], ...c.palpacao };
  return dados;
}

/** Ficha no modelo normalizado: o documento sem a palpação (que vai para a tabela própria). */
function fichaSemPalpacao(c: Consulta) {
  const dados = structuredClone(c.ficha) as Record<string, Record<string, unknown>>;
  const secao = c.tipo === "primeira_consulta" ? "exame_dtm" : "exame";
  if (dados[secao]) {
    delete dados[secao].q44_palpacao_muscular;
    delete dados[secao].q45_palpacao_articular;
  }
  return dados;
}

const linhasPalpacao = (fichaId: number, p: ReturnType<typeof palpacao>) =>
  [...Object.entries(p.q44_palpacao_muscular).map(([s, v]) => ["muscular", s, v] as const),
   ...Object.entries(p.q45_palpacao_articular).map(([s, v]) => ["articular", s, v] as const)]
    .flatMap(([grupo, sitio, v]) => (["direito", "esquerdo"] as const).map((lado) => ({ ficha_id: fichaId, grupo, sitio, lado, intensidade: v[lado] })));

function linhasOdontograma(atendimentoId: number, o: ReturnType<typeof odontograma>) {
  const dentes = [], condicoes = [], faces = [];
  for (const [dente, d] of Object.entries(o)) {
    dentes.push({ atendimento_id: atendimentoId, dente: Number(dente), ausente: !!d.ausente });
    for (const c of d.condicoes ?? []) condicoes.push({ atendimento_id: atendimentoId, dente: Number(dente), condicao: c });
    for (const [face, estado] of Object.entries(d.faces ?? {})) faces.push({ atendimento_id: atendimentoId, dente: Number(dente), face, estado });
  }
  return { dentes, condicoes, faces };
}

const ESQUEMA = `
  create table paciente_h (id int primary key, nome text not null);
  create table atendimento_h (id int primary key, paciente_id int not null references paciente_h, data date not null, tipo text not null);
  create index on atendimento_h (paciente_id);
  create table ficha_h (id int primary key, atendimento_id int not null references atendimento_h, dados jsonb not null);
  create index on ficha_h (atendimento_id);
  create table odontograma_h (atendimento_id int primary key references atendimento_h, dados jsonb not null);

  create table paciente_n (id int primary key, nome text not null);
  create table atendimento_n (id int primary key, paciente_id int not null references paciente_n, data date not null, tipo text not null);
  create index on atendimento_n (paciente_id);
  create table ficha_n (id int primary key, atendimento_id int not null references atendimento_n, dados jsonb not null);
  create index on ficha_n (atendimento_id);
  create table palpacao_n (ficha_id int not null references ficha_n, grupo text not null, sitio text not null, lado text not null,
                           intensidade smallint not null, primary key (ficha_id, sitio, lado));
  create table dente_n (atendimento_id int not null references atendimento_n, dente smallint not null, ausente boolean not null,
                        primary key (atendimento_id, dente));
  create table condicao_dente_n (atendimento_id int not null, dente smallint not null, condicao text not null,
                                 primary key (atendimento_id, dente, condicao), foreign key (atendimento_id, dente) references dente_n);
  create table face_dente_n (atendimento_id int not null, dente smallint not null, face char(1) not null, estado text not null,
                             primary key (atendimento_id, dente, face), foreign key (atendimento_id, dente) references dente_n);`;

const LEITURA_H = (sql: Sql, pacienteId: number) => sql`
  select a.id, a.data, a.tipo, f.dados as ficha, o.dados as odontograma
  from atendimento_h a join ficha_h f on f.atendimento_id = a.id left join odontograma_h o on o.atendimento_id = a.id
  where a.paciente_id = ${pacienteId} order by a.data`;

// o modelo normalizado precisa remontar palpação e odontograma para devolver a mesma informação
const LEITURA_N = (sql: Sql, pacienteId: number) => sql`
  select a.id, a.data, a.tipo, f.dados as ficha,
    (select json_agg(json_build_object('grupo', p.grupo, 'sitio', p.sitio, 'lado', p.lado, 'intensidade', p.intensidade))
       from palpacao_n p where p.ficha_id = f.id) as palpacao,
    (select json_agg(json_build_object('dente', d.dente, 'ausente', d.ausente,
        'condicoes', (select json_agg(c.condicao) from condicao_dente_n c where c.atendimento_id = d.atendimento_id and c.dente = d.dente),
        'faces', (select json_object_agg(x.face, x.estado) from face_dente_n x where x.atendimento_id = d.atendimento_id and x.dente = d.dente)))
       from dente_n d where d.atendimento_id = a.id) as odontograma
  from atendimento_n a join ficha_n f on f.atendimento_id = a.id
  where a.paciente_id = ${pacienteId} order by a.data`;

async function inserirEmLotes(sql: Sql, tabela: string, linhas: Record<string, unknown>[]) {
  for (let i = 0; i < linhas.length; i += 2000) await sql`insert into ${sql(tabela)} ${sql(linhas.slice(i, i + 2000) as never)}`;
}

async function carregar(sql: Sql, n: number) {
  let atendimentoId = 0, fichaId = 0;
  const lote = { ph: [] as object[], ah: [] as object[], fh: [] as object[], oh: [] as object[],
                 pn: [] as object[], an: [] as object[], fn: [] as object[], palp: [] as object[], dn: [] as object[], cn: [] as object[], xn: [] as object[] };
  const descarregar = async () => {
    await inserirEmLotes(sql, "paciente_h", lote.ph as never); await inserirEmLotes(sql, "atendimento_h", lote.ah as never);
    await inserirEmLotes(sql, "ficha_h", lote.fh as never); await inserirEmLotes(sql, "odontograma_h", lote.oh as never);
    await inserirEmLotes(sql, "paciente_n", lote.pn as never); await inserirEmLotes(sql, "atendimento_n", lote.an as never);
    await inserirEmLotes(sql, "ficha_n", lote.fn as never); await inserirEmLotes(sql, "palpacao_n", lote.palp as never);
    await inserirEmLotes(sql, "dente_n", lote.dn as never); await inserirEmLotes(sql, "condicao_dente_n", lote.cn as never);
    await inserirEmLotes(sql, "face_dente_n", lote.xn as never);
    for (const k of Object.keys(lote) as (keyof typeof lote)[]) lote[k] = [];
  };
  for (let p = 1; p <= n; p++) {
    lote.ph.push({ id: p, nome: `Paciente ${p}` });
    lote.pn.push({ id: p, nome: `Paciente ${p}` });
    for (const c of paciente()) {
      atendimentoId++; fichaId++;
      lote.ah.push({ id: atendimentoId, paciente_id: p, data: c.data, tipo: c.tipo });
      lote.an.push({ id: atendimentoId, paciente_id: p, data: c.data, tipo: c.tipo });
      lote.fh.push({ id: fichaId, atendimento_id: atendimentoId, dados: sql.json(fichaHibrida(c) as never) });
      lote.fn.push({ id: fichaId, atendimento_id: atendimentoId, dados: sql.json(fichaSemPalpacao(c) as never) });
      lote.palp.push(...linhasPalpacao(fichaId, c.palpacao));
      if (c.odontograma) {
        lote.oh.push({ atendimento_id: atendimentoId, dados: sql.json(c.odontograma as never) });
        const o = linhasOdontograma(atendimentoId, c.odontograma);
        lote.dn.push(...o.dentes); lote.cn.push(...o.condicoes); lote.xn.push(...o.faces);
      }
    }
    if (p % 1000 === 0) await descarregar();
  }
  await descarregar();
  await sql`vacuum analyze`;
  return { atendimentoId, fichaId };
}

const mediana = (xs: number[]) => { const v = [...xs].sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
const p95 = (xs: number[]) => { const v = [...xs].sort((a, b) => a - b); return v[Math.floor(v.length * 0.95)]; };
const arred = (x: number, casas = 3) => Number(x.toFixed(casas));

async function medir(sql: Sql, n: number, repeticoes: number, ids: { atendimentoId: number; fichaId: number }) {
  const sorteio = () => 1 + Math.floor(aleatorio() * n);
  const resultado: Record<string, unknown> = { pacientes: n, atendimentos: ids.atendimentoId, fichas: ids.fichaId };

  // As medições dos dois modelos são intercaladas (e a ordem alterna a cada repetição), para que
  // variações de carga da máquina afetem os dois igualmente.
  const modelos = ["hibrido", "normalizado"] as const;
  const ordem = (i: number) => (i % 2 === 0 ? modelos : ([...modelos].reverse() as unknown as typeof modelos));

  // leitura do prontuário completo de um paciente (tempo no servidor, por EXPLAIN ANALYZE)
  const textoLeitura = (nome: (typeof modelos)[number], id: number) => nome === "hibrido"
    ? `select a.id, a.data, a.tipo, f.dados, o.dados from atendimento_h a join ficha_h f on f.atendimento_id = a.id left join odontograma_h o on o.atendimento_id = a.id where a.paciente_id = ${id} order by a.data`
    : `select a.id, a.data, a.tipo, f.dados,
         (select json_agg(json_build_object('grupo', p.grupo, 'sitio', p.sitio, 'lado', p.lado, 'intensidade', p.intensidade)) from palpacao_n p where p.ficha_id = f.id),
         (select json_agg(json_build_object('dente', d.dente, 'ausente', d.ausente,
            'condicoes', (select json_agg(c.condicao) from condicao_dente_n c where c.atendimento_id = d.atendimento_id and c.dente = d.dente),
            'faces', (select json_object_agg(x.face, x.estado) from face_dente_n x where x.atendimento_id = d.atendimento_id and x.dente = d.dente)))
            from dente_n d where d.atendimento_id = a.id)
       from atendimento_n a join ficha_n f on f.atendimento_id = a.id where a.paciente_id = ${id} order by a.data`;
  for (let i = 0; i < 30; i++) { await LEITURA_H(sql, sorteio()); await LEITURA_N(sql, sorteio()); } // aquecimento do cache
  const leituras = { hibrido: [] as number[], normalizado: [] as number[] };
  for (let i = 0; i < repeticoes; i++) {
    const id = sorteio();
    for (const nome of ordem(i)) {
      const [{ "QUERY PLAN": plano }] = await sql.unsafe(`explain (analyze, format json) ${textoLeitura(nome, id)}`);
      leituras[nome].push(plano[0]["Execution Time"]);
    }
  }
  for (const nome of modelos) resultado[`leitura_${nome}_ms`] = { mediana: arred(mediana(leituras[nome])), p95: arred(p95(leituras[nome])) };

  // escrita de um atendimento completo (ficha + palpação + odontograma), em transação
  let proximoAtendimento = ids.atendimentoId + 1_000_000, proximaFicha = ids.fichaId + 1_000_000;
  const escritas = { hibrido: [] as number[], normalizado: [] as number[] };
  for (let i = 0; i < repeticoes; i++) {
    const c = paciente()[0];
    const pid = sorteio();
    for (const nome of ordem(i)) {
      const aid = proximoAtendimento++, fid = proximaFicha++;
      const inicio = performance.now();
      await sql.begin(async (tx) => {
        if (nome === "hibrido") {
          await tx`insert into atendimento_h values (${aid}, ${pid}, ${c.data}, ${c.tipo})`;
          await tx`insert into ficha_h values (${fid}, ${aid}, ${tx.json(fichaHibrida(c) as never)})`;
          await tx`insert into odontograma_h values (${aid}, ${tx.json(c.odontograma as never)})`;
        } else {
          await tx`insert into atendimento_n values (${aid}, ${pid}, ${c.data}, ${c.tipo})`;
          await tx`insert into ficha_n values (${fid}, ${aid}, ${tx.json(fichaSemPalpacao(c) as never)})`;
          await tx`insert into palpacao_n ${tx(linhasPalpacao(fid, c.palpacao) as never)}`;
          const o = linhasOdontograma(aid, c.odontograma!);
          if (o.dentes.length) await tx`insert into dente_n ${tx(o.dentes as never)}`;
          if (o.condicoes.length) await tx`insert into condicao_dente_n ${tx(o.condicoes as never)}`;
          if (o.faces.length) await tx`insert into face_dente_n ${tx(o.faces as never)}`;
        }
      });
      escritas[nome].push(performance.now() - inicio);
    }
  }
  for (const nome of modelos) resultado[`escrita_${nome}_ms`] = { mediana: arred(mediana(escritas[nome])), p95: arred(p95(escritas[nome])) };

  // consulta analítica: quantas fichas têm dor >= 2 no masseter (corpo) direito
  const analitica = {
    hibrido: `select count(*) from ficha_h where coalesce(dados #>> '{exame_dtm,q44_palpacao_muscular,masseter_corpo,direito}',
                dados #>> '{exame,q44_palpacao_muscular,masseter_corpo,direito}')::int >= 2`,
    normalizado: `select count(*) from palpacao_n where sitio = 'masseter_corpo' and lado = 'direito' and intensidade >= 2`,
  };
  for (const [nome, texto] of Object.entries(analitica)) {
    const tempos: number[] = [];
    for (let i = 0; i < 10; i++) {
      const [{ "QUERY PLAN": plano }] = await sql.unsafe(`explain (analyze, format json) ${texto}`);
      tempos.push(plano[0]["Execution Time"]);
    }
    resultado[`analitica_${nome}_ms`] = arred(mediana(tempos));
  }

  // espaço em disco (tabelas + índices + TOAST)
  const tamanho = async (tabelas: string[]) => {
    const [{ bytes }] = await sql`select sum(pg_total_relation_size(t::regclass))::bigint as bytes from unnest(${tabelas}::text[]) t`;
    return arred(Number(bytes) / 1024 / 1024, 1);
  };
  resultado.disco_hibrido_mb = await tamanho(["paciente_h", "atendimento_h", "ficha_h", "odontograma_h"]);
  resultado.disco_normalizado_mb = await tamanho(["paciente_n", "atendimento_n", "ficha_n", "palpacao_n", "dente_n", "condicao_dente_n", "face_dente_n"]);
  return resultado;
}

async function principal() {
  const { values } = parseArgs({ options: { pacientes: { type: "string", default: "1000,10000" }, repeticoes: { type: "string", default: "300" } } });
  const pasta = mkdtempSync(join(tmpdir(), "lord-benchmark-"));
  const pg = new EmbeddedPostgres({ databaseDir: join(pasta, "pg"), port: 54341, user: "postgres", password: "benchmark", persistent: false, onLog: () => {} });
  await pg.initialise();
  await pg.start();
  const resultados = [];
  try {
    for (const n of values.pacientes!.split(",").map(Number)) {
      await pg.createDatabase(`bench${n}`);
      const sql = postgres(`postgres://postgres:benchmark@127.0.0.1:54341/bench${n}`, { max: 1, onnotice: () => {} });
      await sql.unsafe(ESQUEMA);
      semente = 2026;
      const inicio = performance.now();
      const ids = await carregar(sql, n);
      console.log(`${n} pacientes carregados em ${((performance.now() - inicio) / 1000).toFixed(0)} s`);
      const r = await medir(sql, n, Number(values.repeticoes), ids);
      console.log(JSON.stringify(r));
      resultados.push(r);
      await sql.end();
    }
  } finally {
    await pg.stop();
    rmSync(pasta, { recursive: true, force: true });
  }
  const saida = join(RAIZ, "dados", "resultados", "benchmark-jsonb");
  mkdirSync(saida, { recursive: true });
  const [versao] = [process.version];
  writeFileSync(join(saida, "resultado.json"), JSON.stringify({ node: versao, postgres: "17 (embedded-postgres)", resultados }, null, 2), "utf-8");
  console.log(`Resultados em ${saida}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await principal();
