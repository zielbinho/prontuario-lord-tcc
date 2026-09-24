import { esquemaResolvido, listarCampos, rotulo, type Esquema } from "@lord/ficha";

/** Versão do prompt: registrada em cada sugestão (tabela sugestao_ia) e nos resultados do Experimento A. */
// v1: regras gerais. v2 (ajuste com relatos de desenvolvimento): proíbe classificar doenças a partir
// de medicamentos, proíbe repetir a mesma informação em dois campos e inclui um exemplo resolvido.
// v3: o guia dos campos separava título e tipo com "Valor:", e o modelo copiava "Título. Valor:" para
// dentro do valor; o guia passa a separar as partes com rótulos que não se confundem com conteúdo.
// v4: o modelo citava o título do campo como evidência ("Tipo de escova") ou embrulhava a citação
// ("Relato do acadêmico: '...'"); a regra da evidência passa a proibir as duas coisas.
export const VERSAO_PROMPT = "v4";

export const INSTRUCOES_SISTEMA = `Você é um assistente de DOCUMENTAÇÃO clínica de uma liga acadêmica de odontologia (DTM e prótese).
Sua única tarefa é transferir para campos estruturados as informações ditas EXPLICITAMENTE no relato do acadêmico.

Regras obrigatórias:
1. Não faça diagnóstico, não sugira conduta ou tratamento e não interprete sintomas.
2. Não deduza nem complete: se a informação não foi dita, use null em "valor" e em "evidencia".
3. "evidencia" deve ser um trecho COPIADO LITERALMENTE do relato que justifica o valor, sem aspas e sem prefixo.
   Nunca use como evidência o título, a instrução ou a pergunta do campo: se o relato não contém o trecho, o valor é null.
4. Se houver autocorreção ("não, na verdade..."), use o valor final corrigido.
5. Negações explícitas contam como informação: "nega alergias" → "Nega."; "não usa medicamento" → false.
6. Para campos com opções, use somente os códigos listados.
7. Ignore comentários sem relação com a saúde do paciente.
8. Não classifique doenças nem sistemas do corpo por dedução: marque uma condição somente se o relato a mencionar.
   O uso de um remédio NÃO permite deduzir a doença (ex.: "toma losartana" não autoriza marcar "cardíaca").
9. Cada informação vai para um único campo, o mais específico. Não repita a mesma informação em dois campos.
10. O valor contém apenas a informação do paciente: não copie o título do campo, a instrução nem o tipo aceito.

Exemplo (outro paciente):
Relato: "Relata que tem diabetes e toma metformina há três anos. Nega alergias. Tempo bom hoje."
- q1_sistemas: null (diabetes não está entre as opções)
- q1_outras: "Diabetes." — evidência "tem diabetes"
- q3_alergias: "Nega." — evidência "Nega alergias"
- q4_usa_medicamento: true — evidência "toma metformina"
- q4_medicamentos: "Metformina, há três anos." — evidência "toma metformina há três anos"
- demais campos: null
Responda apenas com o JSON no formato pedido.`;

function descreverTipo(esquema: Esquema): string {
  const tipos = ([] as string[]).concat((esquema.type as string | string[] | undefined) ?? []);
  if (Array.isArray(esquema.enum)) {
    const opcoes = (esquema.enum as unknown[]).filter((v) => v !== null);
    return `uma opção: ${opcoes.map((v) => `${String(v)} (${rotulo(v)})`).join("; ")}`;
  }
  if (tipos.includes("array")) {
    const itens = ((esquema.items as Esquema | undefined)?.enum ?? []) as string[];
    return `lista com zero ou mais de: ${itens.map((v) => `${v} (${rotulo(v)})`).join("; ")}`;
  }
  if (tipos.includes("boolean")) return "true (sim) ou false (não)";
  if (tipos.includes("integer")) {
    const faixa = esquema.minimum !== undefined ? ` de ${esquema.minimum} a ${esquema.maximum ?? "…"}` : "";
    return `número inteiro${faixa}`;
  }
  if (tipos.includes("number")) return "número";
  return "texto curto, fiel ao relato";
}

/** Guia dos campos de uma seção: título, instrução do esquema e valores aceitos. */
export function guiaDosCampos(secao: string): string {
  const campos = listarCampos("ficha-inicial").filter((c) => c.secao === secao && !c.somenteHumano);
  return campos
    .map((c) => {
      const relativo = c.caminho.slice(secao.length + 1);
      const instrucao = typeof c.esquema.description === "string" ? `\n    instrução: ${c.esquema.description}` : "";
      return `- ${relativo} [${c.titulo}]${instrucao}\n    tipo aceito: ${descreverTipo(c.esquema)}`;
    })
    .join("\n");
}

export interface Mensagem {
  role: "system" | "user";
  content: string;
}

export function montarMensagens(secoes: string[], relato: string): Mensagem[] {
  const raiz = esquemaResolvido("ficha-inicial").properties as Record<string, Esquema>;
  const blocos = secoes.map((s) => `## Seção "${s}" (${raiz[s].title as string})\n${guiaDosCampos(s)}`).join("\n\n");
  return [
    { role: "system", content: INSTRUCOES_SISTEMA },
    {
      role: "user",
      content: `Campos a preencher:\n\n${blocos}\n\nRelato do acadêmico:\n"""\n${relato.trim()}\n"""`,
    },
  ];
}
