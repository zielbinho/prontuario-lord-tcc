import { esquemaParaIA, extrairSugestoes, validarContra, type Esquema, type ResultadoSugestao } from "@lord/ficha";
import { ErroModelo, type ClienteModelo } from "./ollama";
import { montarMensagens, VERSAO_PROMPT } from "./prompt";

export interface PedidoEstruturacao {
  /** Uma seção (estratégia "por seção") ou várias numa só chamada (estratégia "ficha inteira"). */
  secoes: string[];
  relato: string;
  modelo: string;
}

export interface ResultadoEstruturacao extends ResultadoSugestao {
  /** Saída bruta do modelo, guardada para auditoria e para a análise dos experimentos. */
  saida: Record<string, unknown>;
  modelo: string;
  versaoPrompt: string;
  latenciaMs: number;
  tokensGerados: number;
}

/**
 * Esquema de saída para uma ou mais seções. Com uma seção, é o próprio esquema derivado;
 * com várias, cada seção vira uma propriedade. esquemaParaIA recusa seções de decisão clínica.
 */
export function esquemaDeSaida(secoes: string[]): Esquema {
  if (secoes.length === 1) return esquemaParaIA(secoes[0]);
  const propriedades = Object.fromEntries(secoes.map((s) => [s, esquemaParaIA(s)]));
  return { type: "object", additionalProperties: false, properties: propriedades, required: secoes };
}

export async function estruturar(cliente: ClienteModelo, pedido: PedidoEstruturacao): Promise<ResultadoEstruturacao> {
  if (!pedido.relato.trim()) throw new ErroModelo("o relato está vazio");
  const formato = esquemaDeSaida(pedido.secoes);
  const resposta = await cliente.gerar({
    modelo: pedido.modelo,
    mensagens: montarMensagens(pedido.secoes, pedido.relato),
    formato,
  });

  let saida: Record<string, unknown>;
  try {
    saida = JSON.parse(resposta.conteudo);
  } catch {
    throw new ErroModelo("o modelo não devolveu um JSON válido");
  }
  const conformidade = validarContra(formato, saida);
  if (!conformidade.valido) throw new ErroModelo(`a saída do modelo não respeita o esquema: ${conformidade.erros[0]?.mensagem}`);

  // cada seção passa pelas salvaguardas: sem evidência, ou com evidência fora do relato, é descartado
  const resultado: ResultadoSugestao = { sugestoes: [], descartados: [] };
  for (const secao of pedido.secoes) {
    const parte = pedido.secoes.length === 1 ? saida : saida[secao];
    const r = extrairSugestoes(parte, secao, pedido.relato);
    resultado.sugestoes.push(...r.sugestoes);
    resultado.descartados.push(...r.descartados);
  }

  return {
    ...resultado,
    saida,
    modelo: pedido.modelo,
    versaoPrompt: VERSAO_PROMPT,
    latenciaMs: resposta.duracaoMs,
    tokensGerados: resposta.tokensGerados,
  };
}
