# Experimento A

Prompt v4; 10 caso(s): caso_001, caso_002, caso_003, caso_004, caso_005, caso_006, caso_007, caso_008, caso_011, caso_013.

| Modelo | Estratégia | Modo | P | R | F1 | F1 fechados | F1 texto (aprox.) | Alucinação | Omissão | Latência (s) |
|---|---|---|---|---|---|---|---|---|---|---|
| qwen2.5:3b | inteira | bruto | 0.6185 | 0.5169 | 0.5632 | 0.703 | 0.4558 | 0.4151 | 0.2705 | 169.3401 |
| qwen2.5:3b | inteira | salvaguardas | 0.6172 | 0.3816 | 0.4716 | 0.5379 | 0.4211 | 0.2642 | 0.4493 | 169.3401 |
