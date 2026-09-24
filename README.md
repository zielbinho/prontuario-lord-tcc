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
apps/api/                API (Node.js + Fastify + PostgreSQL 17)
  migrations/            Estrutura, Row-Level Security e esquema analítico pseudonimizado (SQL)
  src/                   Autenticação, rotas, auditoria, ambiente de desenvolvimento
  test/                  Testes de integração contra um PostgreSQL real e descartável
ferramentas/sinteticos/  Gerador de casos sintéticos (gabarito + roteiro da narrativa)
dados/sinteticos/casos/  40 casos gerados (semente 2026): 10 de ajuste, 30 de teste
implantacao/             Caddyfile do proxy HTTPS; docker-compose.yml fica na raiz
apps/web/                Interface (React + Vite + Tailwind), gerada a partir dos esquemas
  src/ficha/             Campo por tipo de esquema, mapa de palpação, odontograma
  e2e/                   Testes de ponta a ponta (Playwright com o Edge instalado) e geração das figuras
packages/ia/             Estruturação da anamnese: prompt versionado, cliente Ollama, salvaguardas
  scripts/               Roteiro do Experimento A
services/transcricao/    Transcrição de fala (FastAPI + faster-whisper), áudio só em memória
docs/figuras/            Capturas de tela geradas automaticamente para o TCC
```

Próxima fase: `services/analitico` (Pandas).

## Interface

```bash
npm run dev -w @lord/api      # terminal 1: API + banco de desenvolvimento
npm run dev -w @lord/web      # terminal 2: http://localhost:5173
```

- O formulário da ficha é montado a partir do JSON Schema: cada tipo de campo vira o controle
  adequado (botões de opção, sim/não, régua de dor 0–10, número em mm, texto), com o número da
  questão do papel. Campos condicionais (`x-mostrar-se`) aparecem e somem conforme a resposta.
- Validação no navegador com o mesmo esquema e as mesmas mensagens (em português) da API.
- Mapa de palpação (questões 43–45) e odontograma (FDI, 5 faces por dente).
- Fluxo de revisão: aluno salva e envia; professor devolve com comentário ou aprova; ficha aprovada
  fica somente leitura, com adendo.

```bash
npm test -w @lord/web                              # componentes (Vitest + Testing Library)
npm run e2e -w @lord/web                           # ponta a ponta (Playwright + Microsoft Edge)
FIGURAS=1 npx playwright test figuras              # (em apps/web) regenera docs/figuras/
```

## Ditado com IA

A IA **não diagnostica**: só transfere para a ficha o que foi dito, e cada valor passa pelo acadêmico.

```bash
ollama pull qwen2.5:3b                          # ~1,9 GB; o Ollama escuta em 127.0.0.1:11434
cd services/transcricao
..\..\.venv\Scripts\python -m pip install -r requirements.txt
..\..\.venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port 8765
```

- Nas seções que admitem ditado (queixa, história médica e odontológica, prótese, observações),
  o painel "Ditado com IA" grava o áudio (ou recebe texto), transcreve e pede sugestões.
- Cada sugestão chega com o **trecho de evidência**; o acadêmico aceita, rejeita ou aceita todas.
  Valor aceito e depois alterado é registrado como "editada".
- Salvaguardas no código (`packages/ficha/src/ia.ts`): seções `x-somente-humano` nunca vão ao modelo
  e a API recusa sugestões para elas; valores sem evidência, com evidência ausente do relato ou
  incoerentes com a evidência são descartados e mostrados à parte.
- Tabela `sugestao_ia`: modelo, versão do prompt, saída bruta e decisão por campo.
- O prompt é versionado (`packages/ia/src/prompt.ts`). Ajuste **somente** com os relatos de
  `dados/sinteticos/desenvolvimento/` (casos de ajuste); casos de teste ficam para a medição final.

```bash
IA=1 npx playwright test ia                                     # (em apps/web) fluxo com o modelo real
npx tsx scripts/experimento-a.ts --desenvolvimento              # (em packages/ia) teste do roteiro
npx tsx scripts/experimento-a.ts --divisao teste --modelos qwen2.5:3b,qwen2.5:7b
```

O Experimento A grava cada execução em `execucoes.jsonl` assim que termina; rodar de novo com a mesma
`--saida` retoma de onde parou. Saídas: `resumo.md`, `resumo.json`, `campos.csv` e
`avaliacao-humana-texto.csv` (notas de 0 a 2 dos avaliadores).

## API

### Rodar localmente

```bash
npm install
npm run dev -w @lord/api
```

Sobe um PostgreSQL 17 local (pacote `embedded-postgres`, sem instalar nada no sistema) em
`apps/api/.dados-dev/`, aplica as migrações, cria usuários e 12 pacientes sintéticos e inicia a
API em `http://localhost:3333`. Senha de todos os usuários de desenvolvimento: `lord-dev-2026`
(`aluna@lord.dev`, `aluno@lord.dev`, `professora@lord.dev`, `pesquisadora@lord.dev`, `admin@lord.dev`).
Se a porta do banco ficar presa depois de fechar o terminal: `npm run dev:parar -w @lord/api`.

### Segurança implementada

| Requisito | Onde |
|---|---|
| Senhas Argon2id (parâmetros OWASP), sessão em cookie `HttpOnly`/`SameSite=Strict`, token só como hash no banco | `src/autenticacao.ts` |
| Bloqueio após 5 tentativas por 15 min; mesma resposta para e-mail inexistente e senha errada | `src/autenticacao.ts` |
| Controle por papel na API **e** Row-Level Security no banco (aluno vê só os próprios pacientes; admin e pesquisador não veem dados clínicos) | `migrations/002_seguranca.sql` |
| CPF, RG, telefones e endereço cifrados com `pgcrypto`; chave fora do banco; busca por CPF via índice HMAC | `src/rotas/pacientes.ts` |
| Ficha aprovada imutável e fichas nunca excluídas (gatilho no banco); correções por adendo versionado | `migrations/001_estrutura.sql`, `src/rotas/fichas.ts` |
| Trilha de auditoria somente de inserção, inclusive de leituras, sem dados pessoais | `src/auditoria.ts` |
| Esquema analítico pseudonimizado (HMAC com segredo separado, faixa etária, dias relativos, sem textos livres) | `migrations/003_analitico.sql` |

### Principais rotas

| Método e rota | Quem | O que faz |
|---|---|---|
| `POST /auth/login`, `POST /auth/logout`, `GET /auth/eu` | todos | Sessão |
| `GET/POST /pacientes`, `GET/PUT /pacientes/:id` | aluno, professor | Cadastro e busca (nome, prontuário ou CPF) |
| `POST /pacientes/:id/consentimentos`, `POST /pacientes/:id/tratamentos` | aluno, professor | TCLE e tratamentos |
| `GET/POST /pacientes/:id/atendimentos` | aluno, professor | Abrir atendimento já cria a ficha em rascunho |
| `GET/PUT /fichas/:id`, `GET /fichas/:id/versoes` | aluno, professor | Ler e salvar rascunho (validação pelo esquema e completude) |
| `POST /fichas/:id/enviar` | aluno, professor | Rascunho → em revisão |
| `POST /fichas/:id/devolver`, `POST /fichas/:id/aprovar`, `GET /revisao` | professor | Revisão docente |
| `POST /fichas/:id/adendo` | aluno, professor | Nova versão de ficha aprovada |
| `GET/PUT /atendimentos/:id/odontograma` | aluno, professor | Odontograma (FDI) |
| `GET/POST/PATCH /usuarios`, `GET /auditoria` | admin | Administração |
| `GET /esquemas/:tipo` | todos | Esquemas para a interface montar os formulários |
| `POST /transcricoes` | aluno, professor | Áudio → texto (serviço de transcrição) |
| `POST /fichas/:id/sugestoes`, `POST /sugestoes/:id/decisoes` | aluno, professor | Sugestões da IA e decisão por campo |

### Implantação

`docker-compose.yml` (PostgreSQL 17, API e Caddy com HTTPS) e `.env.exemplo`.
**Ainda não testados**, porque não há Docker na máquina de desenvolvimento: validar na primeira
implantação no servidor da UEPG.

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
| `x-mostrar-se`      | Campo só aparece quando outro campo da seção tem o valor indicado  |

Para mudar a ficha, crie uma nova versão (`ficha-inicial.v2.schema.json`) em vez de editar a v1:
as fichas antigas continuam válidas na versão em que foram registradas.

## Como rodar

Requisitos: Node.js 22+ e Python 3.11.

```bash
npm install
npm test                      # ficha + IA + API + interface (a API sobe um PostgreSQL descartável)
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
Os relatos de `dados/sinteticos/desenvolvimento/` foram escritos pelos autores só para desenvolver
o prompt e o roteiro do experimento; não são narrativas oficiais.
