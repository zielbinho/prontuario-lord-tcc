# Experimento A (DESENVOLVIMENTO, não oficial)

Prompt v4; 3 caso(s): caso_009, caso_010, caso_014.

| Modelo | Estratégia | Modo | P | R | F1 | F1 fechados | F1 texto (aprox.) | Alucinação | Omissão | Latência (s) |
|---|---|---|---|---|---|---|---|---|---|---|
| qwen2.5:3b | secao | bruto | 0.5574 | 0.5862 | 0.5714 | 0.6792 | 0.4848 | 0.45 | 0.1034 | 184.324 |
| qwen2.5:3b | secao | salvaguardas | 0.5714 | 0.4828 | 0.5234 | 0.6087 | 0.459 | 0.3 | 0.2586 | 184.324 |
| qwen2.5:3b | inteira | bruto | 0.6923 | 0.6207 | 0.6545 | 0.7083 | 0.6129 | 0.2 | 0.1724 | 123.3927 |
| qwen2.5:3b | inteira | salvaguardas | 0.6744 | 0.5 | 0.5743 | 0.5714 | 0.5763 | 0.15 | 0.3103 | 123.3927 |
