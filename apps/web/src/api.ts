// Cliente da API. Em desenvolvimento o Vite repassa /api para localhost:3333; em produção, o Caddy.

export type Papel = "aluno" | "professor" | "pesquisador" | "admin";
export type StatusFicha = "rascunho" | "em_revisao" | "aprovada";
export type TipoFicha = "ficha-inicial" | "ficha-retorno";

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  ativo?: boolean;
}

export interface PacienteResumo {
  id: string;
  numero_prontuario: string | null;
  nome: string;
  data_nascimento: string;
  sexo: "M" | "F" | null;
}

export interface Paciente extends PacienteResumo {
  estado_civil: string | null;
  profissao: string | null;
  telefone: string | null;
  telefone_recado: string | null;
  endereco: string | null;
  rg: string | null;
  cpf: string | null;
  consentimentos?: { id: string; tipo: string; versao_termo: string; aceito_em: string }[];
  tratamentos?: { id: string; categoria: string; inicio: string; fim: string | null }[];
}

export interface FichaResumo {
  id: string;
  tipo: TipoFicha;
  versao: number;
  status: StatusFicha;
  completude: number | null;
}

export interface Atendimento {
  id: string;
  data: string;
  tipo: "primeira_consulta" | "retorno";
  aluno: string;
  professor: string | null;
  fichas: FichaResumo[];
}

export interface Ficha extends FichaResumo {
  atendimento_id: string;
  ficha_anterior_id: string | null;
  dados: Record<string, Record<string, unknown>>;
  comentario_revisao: string | null;
  aprovado_em: string | null;
  atualizado_em: string;
  completude_detalhada: { preenchidos: number; total: number; fracao: number; faltantes: string[] };
}

export interface ItemRevisao {
  id: string;
  tipo: TipoFicha;
  versao: number;
  completude: number;
  atualizado_em: string;
  data: string;
  paciente_id: string;
  paciente: string;
  aluno: string;
}

export class ErroApi extends Error {
  constructor(
    public readonly status: number,
    mensagem: string,
    public readonly detalhes?: unknown,
  ) {
    super(mensagem);
  }
}

/** Chamado quando a sessão expira (401), para o contexto de autenticação voltar ao login. */
let aoPerderSessao: () => void = () => {};
export const definirAoPerderSessao = (fn: () => void) => {
  aoPerderSessao = fn;
};

export async function requisitar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  const resposta = await fetch(`/api${caminho}`, {
    method: metodo,
    credentials: "same-origin",
    headers: corpo === undefined ? undefined : { "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  if (resposta.status === 204) return undefined as T;
  const conteudo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    if (resposta.status === 401 && caminho !== "/auth/login") aoPerderSessao();
    throw new ErroApi(resposta.status, conteudo.erro ?? `erro ${resposta.status}`, conteudo.detalhes);
  }
  return conteudo as T;
}

/** Envia um áudio (Blob) como corpo da requisição; usado pela transcrição do ditado. */
export async function enviarAudio<T>(caminho: string, audio: Blob): Promise<T> {
  const resposta = await fetch(`/api${caminho}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": audio.type.split(";")[0] || "audio/webm" },
    body: audio,
  });
  const conteudo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    if (resposta.status === 401) aoPerderSessao();
    throw new ErroApi(resposta.status, conteudo.erro ?? `erro ${resposta.status}`, conteudo.detalhes);
  }
  return conteudo as T;
}

export interface SugestaoIA {
  caminho: string;
  valor: unknown;
  evidencia: string;
}

export interface RespostaSugestoes {
  id: string;
  secao: string;
  sugestoes: SugestaoIA[];
  descartados: { caminho: string; valor: unknown; evidencia?: string; motivo: string }[];
  modelo: string;
  versao_prompt: string;
  latencia_ms: number;
}

// --- módulo analítico -------------------------------------------------------------------------

export interface ConsultaEvolucao {
  ficha_id: string;
  data: string;
  dias: number;
  tipo_ficha: TipoFicha;
  dor_atual: number | null;
  icd: number | null;
  escore_incapacidade: number | null;
  grau_gcps: number | null;
  abertura_sem_dor_mm: number | null;
  abertura_max_mm: number | null;
  abertura_max_auxilio_mm: number | null;
  sitios_dolorosos: number | null;
  soma_palpacao: number | null;
  palpacao: { q44_palpacao_muscular: Record<string, { direito?: number; esquerdo?: number }> | null; q45_palpacao_articular: Record<string, { direito?: number; esquerdo?: number }> | null };
}

export interface Evolucao {
  consultas: ConsultaEvolucao[];
  tratamentos: { categoria: string; inicio: string; fim: string | null }[];
}

export interface GrupoTratamento {
  grupo: string;
  n: number;
  base_mediana: number | null;
  final_mediana: number | null;
  reducao_media_pct: number | null;
  reducao_ic95: [number | null, number | null];
  reducao_mediana_pct: number | null;
  respondedores_30_pct: number | null;
  respondedores_50_pct: number | null;
  wilcoxon_p: number | null;
  efeito_rank_biserial: number | null;
}

export interface ComparacaoTratamentos {
  somente_concluintes: boolean;
  grupos: GrupoTratamento[];
  entre_grupos: { h: number | null; p: number | null; epsilon2: number | null };
}

export interface ResumoCoorte {
  pacientes: number;
  fichas: Record<string, number>;
  prevalencias: { caracteristica: string; n: number; prevalencia_pct: number | null }[];
  diagnosticos: Record<string, Record<string, number>>;
  tratamentos: ComparacaoTratamentos;
  tratamentos_concluintes: ComparacaoTratamentos;
  abandono: { grupo: string; n: number; abandono_pct: number | null; sem_retorno: number }[];
  correlacoes: { x: string; y: string; n: number; rho: number | null; p: number | null }[];
  variacoes: { grupo: string; variacao_rel: number; concluiu: boolean }[];
}

export interface AceitacaoIA {
  grupo: string;
  decisoes: number;
  aceitas: number;
  editadas: number;
  rejeitadas: number;
  taxa_aceitacao_pct: number;
}

export interface Qualidade {
  completude: { tipo_ficha: TipoFicha; status: StatusFicha; fichas: number; completude_media_pct: number | null }[];
  aceitacao_ia: { total: AceitacaoIA[]; por_secao: AceitacaoIA[]; por_versao_prompt: AceitacaoIA[] };
}

export const api = {
  get: <T>(caminho: string) => requisitar<T>("GET", caminho),
  post: <T>(caminho: string, corpo?: unknown) => requisitar<T>("POST", caminho, corpo ?? {}),
  put: <T>(caminho: string, corpo: unknown) => requisitar<T>("PUT", caminho, corpo),
  patch: <T>(caminho: string, corpo: unknown) => requisitar<T>("PATCH", caminho, corpo),
};
