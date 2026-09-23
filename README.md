# Prontuário eletrônico LORD-UEPG

Sistema web de prontuário para a Liga Odontológica de Reabilitação e DTM da UEPG, com
anamnese estruturada por IA (sem finalidade diagnóstica) e análise da evolução clínica.
TCC de Engenharia de Computação: Gabriel Henrique Pereira Guimarães e Bruno Cheres de Oliveira Cruz.

> **Dados reais de pacientes nunca entram neste repositório nem em serviços de nuvem.**
> Todo o desenvolvimento usa dados sintéticos (`dados/sinteticos`).

## Estrutura

```
packages/ficha/          Fonte única da ficha clínica
  schemas/               JSON Schemas: ficha inicial, ficha de retorno, odontograma, paciente
  src/                   Validação (Ajv), esquema derivado para a IA, completude
  exemplos/              Ficha inicial completa e fictícia
ferramentas/sinteticos/  Gerador de casos sintéticos (gabarito + roteiro da narrativa)
dados/sinteticos/casos/  40 casos gerados (semente 2026): 10 de ajuste, 30 de teste
```

Próximas fases: `apps/api` (Node.js + Fastify + PostgreSQL), `apps/web` (React),
`services/ia` (faster-whisper + Ollama) e `services/analitico` (Pandas).

## A ficha como esquema versionado

A ficha em papel foi transcrita em `packages/ficha/schemas/ficha-inicial.v1.schema.json`:
144 campos em 15 seções, cobrindo as questões 1 a 75 e os blocos não numerados.
O mesmo arquivo serve para gerar o formulário, validar a API, restringir a saída do
modelo de linguagem e achatar os dados para a análise.

Metadados próprios usados no esquema:

| Palavra-chave       | Significado                                                        |
|---------------------|--------------------------------------------------------------------|
| `x-questao`         | Número da questão na ficha em papel                                |
| `x-captacao`        | Formas de captação da seção: `formulario`, `visual`, `ditado`      |
| `x-somente-humano`  | Seção de decisão clínica: nunca enviada nem preenchida pela IA     |
| `x-obrigatorio`     | Campo usado no indicador de completude                             |
| `x-cifrado`         | Dado pessoal gravado criptografado (esquema de paciente)           |

Para mudar a ficha, crie uma nova versão (`ficha-inicial.v2.schema.json`) em vez de editar a v1:
as fichas antigas continuam válidas na versão em que foram registradas.

## Como rodar

Requisitos: Node.js 22+ e Python 3.11.

```bash
npm install
npm test                      # testes da biblioteca da ficha (vitest)
npm run typecheck
```

```bash
py -3.11 -m venv .venv
.venv\Scripts\python -m pip install -r ferramentas\requirements.txt
cd ferramentas
..\.venv\Scripts\python -m pytest
..\.venv\Scripts\python -m sinteticos.gerar_casos --n 40 --semente 2026
```

## Casos sintéticos (Experimento A)

Cada pasta `dados/sinteticos/casos/caso_NNN/` contém:

- `gabarito.json`: a ficha inicial completa, coerente e válida pelo esquema;
- `roteiro.md`: instruções para quem vai escrever a narrativa, com os fatos a mencionar,
  os campos que **não** podem aparecer (medem alucinação) e os desafios de linguagem.

O próximo passo é um membro da LORD escrever `narrativa.txt` em cada caso, seguindo o roteiro.
