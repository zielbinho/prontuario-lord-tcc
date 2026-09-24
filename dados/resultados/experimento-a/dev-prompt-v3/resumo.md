# Experimento A (DESENVOLVIMENTO, não oficial)

Prompt v3; 3 caso(s): caso_009, caso_010, caso_014.

| Modelo | Estratégia | Modo | P | R | F1 | F1 fechados | F1 texto (aprox.) | Alucinação | Omissão | Latência (s) |
|---|---|---|---|---|---|---|---|---|---|---|
| qwen2.5:3b | secao | bruto | 0.5373 | 0.6207 | 0.576 | 0.7037 | 0.4789 | 0.7 | 0.0862 | 163.1757 |
| qwen2.5:3b | secao | salvaguardas | 0.6 | 0.5172 | 0.5556 | 0.6364 | 0.5 | 0.35 | 0.2586 | 163.1757 |
| qwen2.5:3b | inteira | bruto | 0.5556 | 0.6034 | 0.5785 | 0.75 | 0.4658 | 0.6 | 0.1207 | 146.6517 |
| qwen2.5:3b | inteira | salvaguardas | 0.6667 | 0.3793 | 0.4835 | 0.5366 | 0.44 | 0.1 | 0.4655 | 146.6517 |
