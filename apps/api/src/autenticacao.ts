import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { auditar } from "./auditoria";
import type { Config } from "./config";
import { ErroHttp, proibido } from "./erros";

export type Papel = "aluno" | "professor" | "pesquisador" | "admin";

export interface UsuarioAutenticado {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
}

declare module "fastify" {
  interface FastifyRequest {
    usuario?: UsuarioAutenticado;
  }
}

export const COOKIE_SESSAO = "lord_sessao";

// Parâmetros do Argon2id recomendados pela OWASP (19 MiB, 2 iterações)
const OPCOES_ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const gerarHashSenha = (senha: string) => hash(senha, OPCOES_ARGON2);

const hashToken = (token: string) => createHash("sha256").update(token).digest();

/**
 * Garante que a requisição está autenticada e, opcionalmente, que o papel é um dos permitidos.
 * Use como preValidation (e não preHandler): assim a autorização vem ANTES da validação do corpo,
 * e quem não tem sessão recebe 401 sem descobrir, pelas mensagens de validação, como a rota funciona.
 */
export function exigir(...papeis: Papel[]) {
  return async (requisicao: FastifyRequest) => {
    if (!requisicao.usuario) throw new ErroHttp(401, "autenticação necessária");
    if (papeis.length && !papeis.includes(requisicao.usuario.papel)) throw proibido();
  };
}

/** Usuário autenticado; use apenas em rotas protegidas por exigir(). */
export const usuarioDe = (requisicao: FastifyRequest) => requisicao.usuario!;

export function registrarAutenticacao(app: FastifyInstance, sql: Sql, config: Config): void {
  // Identifica o usuário a partir do cookie em toda requisição
  app.addHook("onRequest", async (requisicao) => {
    const token = requisicao.cookies[COOKIE_SESSAO];
    if (!token) return;
    const [usuario] = await sql<UsuarioAutenticado[]>`
      select u.id, u.nome, u.email, u.papel
      from sessao s join usuario u on u.id = s.usuario_id
      where s.token_hash = ${hashToken(token)} and s.expira_em > now() and u.ativo`;
    if (usuario) requisicao.usuario = usuario;
  });

  const esquemaLogin = {
    body: {
      type: "object",
      required: ["email", "senha"],
      additionalProperties: false,
      properties: { email: { type: "string", maxLength: 200 }, senha: { type: "string", maxLength: 200 } },
    },
  };

  app.post<{ Body: { email: string; senha: string } }>("/auth/login", { schema: esquemaLogin }, async (req, resposta) => {
    const { email, senha } = req.body;
    const [u] = await sql<
      (UsuarioAutenticado & { senha_hash: string; ativo: boolean; tentativas_falhas: number; bloqueado: boolean })[]
    >`
      select id, nome, email, papel, senha_hash, ativo, tentativas_falhas,
             coalesce(bloqueado_ate > now(), false) as bloqueado
      from usuario where lower(email) = lower(${email})`;

    if (u?.bloqueado) {
      await auditar(sql, { usuarioId: u.id, acao: "login_bloqueado", ip: req.ip });
      throw new ErroHttp(423, "conta temporariamente bloqueada por excesso de tentativas");
    }

    // A verificação roda mesmo para e-mail inexistente, para não revelar quais e-mails existem pelo tempo de resposta
    const hashReferencia = u?.senha_hash ?? (await gerarHashSenha("senha-inexistente"));
    const senhaCorreta = await verify(hashReferencia, senha);

    if (!u || !u.ativo || !senhaCorreta) {
      if (u) {
        const tentativas = u.tentativas_falhas + 1;
        const bloquear = tentativas >= config.maxTentativasLogin;
        await sql`
          update usuario set
            tentativas_falhas = ${bloquear ? 0 : tentativas},
            bloqueado_ate = ${bloquear ? sql`now() + make_interval(mins => ${config.bloqueioMinutos})` : null}
          where id = ${u.id}`;
      }
      await auditar(sql, { usuarioId: u?.id ?? null, acao: "login_falhou", ip: req.ip });
      throw new ErroHttp(401, "e-mail ou senha incorretos");
    }

    const token = randomBytes(32).toString("base64url");
    await sql.begin(async (tx) => {
      await tx`update usuario set tentativas_falhas = 0, bloqueado_ate = null where id = ${u.id}`;
      await tx`
        insert into sessao (token_hash, usuario_id, expira_em)
        values (${hashToken(token)}, ${u.id}, now() + make_interval(hours => ${config.duracaoSessaoHoras}))`;
      await auditar(tx as never, { usuarioId: u.id, acao: "login", ip: req.ip });
    });

    resposta.setCookie(COOKIE_SESSAO, token, {
      httpOnly: true,
      secure: config.cookieSeguro,
      sameSite: "strict",
      path: "/",
      maxAge: config.duracaoSessaoHoras * 3600,
    });
    return { id: u.id, nome: u.nome, email: u.email, papel: u.papel };
  });

  app.post("/auth/logout", async (req, resposta: FastifyReply) => {
    const token = req.cookies[COOKIE_SESSAO];
    if (token) {
      await sql`delete from sessao where token_hash = ${hashToken(token)}`;
      if (req.usuario) await auditar(sql, { usuarioId: req.usuario.id, acao: "logout", ip: req.ip });
    }
    resposta.clearCookie(COOKIE_SESSAO, { path: "/" });
    return resposta.code(204).send();
  });

  app.get("/auth/eu", { preValidation: exigir() }, async (req) => usuarioDe(req));
}
