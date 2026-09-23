import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { registrarAutenticacao } from "./autenticacao";
import type { Config } from "./config";
import { registrarTratadorDeErros } from "./erros";
import { rotasAuditoria, rotasEsquemas } from "./rotas/auditoria";
import { rotasFichas } from "./rotas/fichas";
import { rotasPacientes } from "./rotas/pacientes";
import { rotasUsuarios } from "./rotas/usuarios";

export interface Dependencias {
  /** Conexão com o papel lord_app (sujeito à RLS). */
  sql: Sql;
  config: Config;
  log?: boolean;
}

export async function criarApp({ sql, config, log = false }: Dependencias): Promise<FastifyInstance> {
  const app = Fastify({
    logger: log ? { level: "info", redact: ["req.headers.cookie", "res.headers['set-cookie']"] } : false,
    // a API fica atrás do proxy HTTPS (Caddy); o IP real vem do cabeçalho X-Forwarded-For
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  await app.register(cookie);
  registrarTratadorDeErros(app);

  // Nenhuma resposta da API pode ser guardada em cache pelo navegador ou por proxies
  app.addHook("onSend", async (_req, resposta) => {
    resposta.header("Cache-Control", "no-store");
    resposta.header("X-Content-Type-Options", "nosniff");
  });

  app.get("/saude", async () => {
    await sql`select 1`;
    return { ok: true };
  });

  registrarAutenticacao(app, sql, config);
  rotasUsuarios(app, sql);
  rotasPacientes(app, sql, config);
  rotasFichas(app, sql);
  rotasAuditoria(app, sql);
  rotasEsquemas(app);

  return app;
}
