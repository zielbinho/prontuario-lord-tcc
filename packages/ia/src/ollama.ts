import type { Esquema } from "@lord/ficha";
import type { Mensagem } from "./prompt";

export interface RespostaModelo {
  /** JSON devolvido pelo modelo, como texto. */
  conteudo: string;
  tokensGerados: number;
  duracaoMs: number;
}

/** Interface mínima de um modelo de linguagem; permite testar sem o Ollama. */
export interface ClienteModelo {
  gerar(pedido: { modelo: string; mensagens: Mensagem[]; formato: Esquema }): Promise<RespostaModelo>;
}

export class ErroModelo extends Error {}
/** Falha de infraestrutura (Ollama fora do ar, tempo esgotado): não diz nada sobre a qualidade da saída. */
export class ErroConexaoModelo extends ErroModelo {}

/**
 * Cliente do Ollama executado localmente (nenhum dado sai da máquina/servidor).
 * Temperatura 0 e semente fixa tornam as respostas reprodutíveis para os experimentos.
 */
export function clienteOllama(url = "http://127.0.0.1:11434", tempoLimiteMs = 300_000): ClienteModelo {
  return {
    async gerar({ modelo, mensagens, formato }) {
      const inicio = Date.now();
      let resposta: Response;
      try {
        resposta = await fetch(`${url}/api/chat`, {
          method: "POST",
          signal: AbortSignal.timeout(tempoLimiteMs),
          body: JSON.stringify({
            model: modelo,
            stream: false,
            format: formato,
            keep_alive: "30m",
            options: { temperature: 0, seed: 42, num_ctx: 8192 },
            messages: mensagens,
          }),
        });
      } catch (e) {
        throw new ErroConexaoModelo(`não foi possível contatar o Ollama em ${url}: ${(e as Error).message}`);
      }
      if (!resposta.ok) throw new ErroConexaoModelo(`Ollama respondeu ${resposta.status}: ${await resposta.text()}`);
      const corpo = (await resposta.json()) as { message: { content: string }; eval_count?: number };
      return { conteudo: corpo.message.content, tokensGerados: corpo.eval_count ?? 0, duracaoMs: Date.now() - inicio };
    },
  };
}
