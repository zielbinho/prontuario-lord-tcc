import type { FastifyError, FastifyInstance } from "fastify";

export class ErroHttp extends Error {
  constructor(
    public readonly statusCode: number,
    mensagem: string,
    public readonly detalhes?: unknown,
  ) {
    super(mensagem);
  }
}

export const naoEncontrado = (mensagem = "registro não encontrado") => new ErroHttp(404, mensagem);
export const proibido = (mensagem = "acesso não permitido para o seu perfil") => new ErroHttp(403, mensagem);
export const conflito = (mensagem: string) => new ErroHttp(409, mensagem);

/** Traduz erros do PostgreSQL e da validação em respostas HTTP com corpo { erro, detalhes? }. */
export function registrarTratadorDeErros(app: FastifyInstance): void {
  app.setErrorHandler((erro: FastifyError & { code?: string; detalhes?: unknown }, requisicao, resposta) => {
    if (erro instanceof ErroHttp) {
      return resposta.code(erro.statusCode).send({ erro: erro.message, detalhes: erro.detalhes });
    }
    if (erro.validation) {
      return resposta.code(400).send({ erro: "requisição inválida", detalhes: erro.message });
    }
    switch (erro.code) {
      case "P0001": // exceções dos gatilhos (ficha aprovada, auditoria)
        return resposta.code(409).send({ erro: erro.message });
      case "23505":
        return resposta.code(409).send({ erro: "registro duplicado" });
      case "23514": // restrição CHECK (ex.: categoria de tratamento fora da lista)
        return resposta.code(400).send({ erro: "valor fora das opções permitidas" });
      case "42501": // violação de política de RLS ou falta de permissão
        return resposta.code(403).send({ erro: "acesso não permitido" });
      case "22P02":
        return resposta.code(400).send({ erro: "identificador inválido" });
    }
    if (erro.statusCode && erro.statusCode < 500) {
      return resposta.code(erro.statusCode).send({ erro: erro.message });
    }
    requisicao.log.error(erro);
    return resposta.code(500).send({ erro: "erro interno" });
  });
}
