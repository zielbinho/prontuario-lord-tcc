# Resultados do Experimento A

As pastas `dev-*` **não são resultados oficiais**: foram geradas com os relatos de desenvolvimento
(`dados/sinteticos/desenvolvimento/`, casos 009, 010 e 014, todos do conjunto de ajuste), só para
desenvolver o prompt, as salvaguardas e o próprio roteiro. O resultado oficial sai do conjunto de
teste, com as narrativas escritas pela LORD.

Cada pasta tem `execucoes.jsonl` (uma linha por execução; a partir da v4, com a saída crua do modelo),
`resumo.md`, `resumo.json`, `campos.csv` e `avaliacao-humana-texto.csv`.

## Histórico do ajuste (qwen2.5:3b, CPU, 3 relatos, ~58 campos com valor)

F1 após as salvaguardas (entre parênteses, a saída bruta do modelo):

| Prompt | Por seção | Ficha inteira | O que mudou e por quê |
|---|---|---|---|
| v2 | 0,49 (0,52) | 0,61 (0,59) | Linha de base |
| v3 | 0,56 (0,58) | 0,48 (0,58) | Guia dos campos sem "Valor:" (o modelo copiava o título para o valor) |
| v4 | 0,52 (0,57) | 0,57 (0,65) | Regra: evidência sem aspas/prefixo e nunca o título do campo; salvaguardas corrigidas (rótulo e aspas em volta da citação, texto "null", flexão de gênero e número) |

Conclusões:

- Com três relatos, diferenças de ±0,05 estão dentro do ruído; nenhuma versão domina. As decisões
  foram tomadas pela **análise qualitativa dos erros** (campos `descartados` e `saidas` do jsonl),
  não pelo número. A v4 ficou como candidata; novo ajuste só com os 10 relatos de ajuste da LORD.
- A v4 reduziu a alucinação bruta por seção (0,75 → 0,45) e melhorou a saída bruta da ficha inteira.
- As salvaguardas trocam revocação por precisão: os valores corretos que ainda se perdem têm
  evidência parafraseada ("Nega alergias" para "não tem alergia a nada"), o título do campo como
  evidência ("Tipo de escova") ou evidência nula. São descartes previstos: o que não é literal
  não pode ser conferido.
- A medida automática de texto penaliza paráfrases corretas; por isso o F1 é reportado também só
  para campos fechados, e a medida definitiva do texto é a avaliação humana (0 a 2).
- Uma execução da v4 falhou por tempo esgotado enquanto outros processos disputavam a CPU e foi
  contada como "saída inválida". O roteiro agora separa falha de conexão (interrompe e retoma) de
  saída inválida (métrica do modelo), e o tempo limite do experimento é de 15 min.
