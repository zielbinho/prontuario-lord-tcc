# Experimento A

Prompt v4; 30 caso(s): caso_001, caso_002, caso_003, caso_004, caso_005, caso_006, caso_007, caso_008, caso_011, caso_013, caso_015, caso_016, caso_017, caso_018, caso_020, caso_022, caso_023, caso_024, caso_025, caso_026, caso_027, caso_028, caso_030, caso_032, caso_034, caso_035, caso_037, caso_038, caso_039, caso_040.

| Modelo | Estratégia | Modo | P | R | F1 | F1 fechados | F1 texto (aprox.) | Alucinação | Omissão | Latência (s) |
|---|---|---|---|---|---|---|---|---|---|---|
| qwen2.5:3b | secao | bruto | 0.5577 | 0.6081 | 0.5818 | 0.7426 | 0.4552 | 0.6937 | 0.0887 | 177.667 |
| qwen2.5:3b | secao | salvaguardas | 0.5806 | 0.5113 | 0.5437 | 0.6906 | 0.4214 | 0.5313 | 0.2565 | 177.667 |
| qwen2.5:3b | inteira | bruto | 0.6305 | 0.5532 | 0.5893 | 0.6992 | 0.5031 | 0.3187 | 0.2048 | 137.0796 |
| qwen2.5:3b | inteira | salvaguardas | 0.6475 | 0.471 | 0.5453 | 0.6325 | 0.4776 | 0.25 | 0.3371 | 137.0796 |
