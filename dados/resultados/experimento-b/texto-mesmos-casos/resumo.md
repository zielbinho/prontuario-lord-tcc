# Experimento A

Prompt v4; 10 caso(s): caso_001, caso_002, caso_003, caso_004, caso_005, caso_006, caso_007, caso_008, caso_011, caso_013.

| Modelo | Estratégia | Modo | P | R | F1 | F1 fechados | F1 texto (aprox.) | Alucinação | Omissão | Latência (s) |
|---|---|---|---|---|---|---|---|---|---|---|
| qwen2.5:3b | inteira | bruto | 0.6257 | 0.5652 | 0.5939 | 0.7241 | 0.4909 | 0.3962 | 0.1981 | 139.4927 |
| qwen2.5:3b | inteira | salvaguardas | 0.6516 | 0.4879 | 0.558 | 0.6541 | 0.4828 | 0.3019 | 0.3285 | 139.4927 |
