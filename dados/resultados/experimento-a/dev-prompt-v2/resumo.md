# Experimento A (DESENVOLVIMENTO, não oficial)

Prompt v2; 3 caso(s): caso_009, caso_010, caso_014.

| Modelo | Estratégia | Modo | P | R | F1 | F1 fechados | F1 texto (aprox.) | Alucinação | Omissão | Latência (s) |
|---|---|---|---|---|---|---|---|---|---|---|
| qwen2.5:3b | secao | bruto | 0.4658 | 0.5862 | 0.5191 | 0.6667 | 0.4054 | 0.75 | 0 | 171.956 |
| qwen2.5:3b | secao | salvaguardas | 0.4833 | 0.5 | 0.4915 | 0.625 | 0.4 | 0.5 | 0.1379 | 171.956 |
| qwen2.5:3b | inteira | bruto | 0.5965 | 0.5862 | 0.5913 | 0.7083 | 0.5075 | 0.3 | 0.1207 | 103.6687 |
| qwen2.5:3b | inteira | salvaguardas | 0.66 | 0.569 | 0.6111 | 0.7234 | 0.5246 | 0.15 | 0.1897 | 103.6687 |
