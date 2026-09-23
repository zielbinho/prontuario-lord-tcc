import { createHash } from "node:crypto";

export interface Config {
  porta: number;
  /** Conexão da API: papel lord_app, sujeito às políticas de RLS. */
  urlBanco: string;
  /** Conexão do dono das tabelas: usada apenas para migrações. */
  urlBancoAdmin: string;
  senhaPapelApp: string;
  senhaPapelAnalitico: string;
  /** Chave simétrica dos campos cifrados do paciente (pgcrypto). Nunca é gravada no banco. */
  chaveCriptografia: string;
  /** Chave do índice de busca do CPF, derivada da chave de criptografia. */
  chaveIndice: string;
  /** Segredo do HMAC que gera os pseudônimos do esquema analítico. */
  segredoPseudonimo: string;
  /** Cookie apenas por HTTPS (desligar só em desenvolvimento local). */
  cookieSeguro: boolean;
  duracaoSessaoHoras: number;
  maxTentativasLogin: number;
  bloqueioMinutos: number;
}

function obrigatoria(env: NodeJS.ProcessEnv, nome: string): string {
  const valor = env[nome];
  if (!valor) throw new Error(`Variável de ambiente obrigatória ausente: ${nome}`);
  return valor;
}

export function carregarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const chaveCriptografia = obrigatoria(env, "CHAVE_CRIPTOGRAFIA");
  if (chaveCriptografia.length < 32) throw new Error("CHAVE_CRIPTOGRAFIA deve ter pelo menos 32 caracteres");
  return {
    porta: Number(env.PORTA ?? 3333),
    urlBanco: obrigatoria(env, "URL_BANCO"),
    urlBancoAdmin: obrigatoria(env, "URL_BANCO_ADMIN"),
    senhaPapelApp: obrigatoria(env, "SENHA_PAPEL_APP"),
    senhaPapelAnalitico: obrigatoria(env, "SENHA_PAPEL_ANALITICO"),
    chaveCriptografia,
    chaveIndice: createHash("sha256").update(`indice:${chaveCriptografia}`).digest("hex"),
    segredoPseudonimo: obrigatoria(env, "SEGREDO_PSEUDONIMO"),
    cookieSeguro: env.COOKIE_SEGURO !== "false",
    duracaoSessaoHoras: Number(env.DURACAO_SESSAO_HORAS ?? 8),
    maxTentativasLogin: Number(env.MAX_TENTATIVAS_LOGIN ?? 5),
    bloqueioMinutos: Number(env.BLOQUEIO_MINUTOS ?? 15),
  };
}
