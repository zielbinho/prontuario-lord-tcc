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
services/analitico/      Indicadores e estatística (FastAPI + Pandas + SciPy), só o esquema pseudonimizado
ferramentas/             Geradores de casos e da coorte sintética; experimento_d.py
docs/figuras/            Capturas de tela geradas automaticamente para o TCC
```

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
  fica somente leitura, com adendo. Enviar com campos obrigatórios em branco pede confirmação.
- Tema claro, escuro ou automático (segue o sistema), no botão do cabeçalho; a escolha fica no
  navegador (`lord-tema`) e é aplicada antes da primeira pintura (`public/tema-inicial.js`).

```bash
npm test -w @lord/web                              # componentes (Vitest + Testing Library)
npm run e2e -w @lord/web                           # ponta a ponta (Playwright + Microsoft Edge)
FIGURAS=1 npx playwright test figuras              # (em apps/web) regenera docs/figuras/
PRODUCAO=1 npx playwright test fluxo-ficha         # fluxo sobre a versão COMPILADA, com a CSP da implantação
ACESSIBILIDADE=1 npx playwright test acessibilidade  # axe-core (WCAG 2.1 A/AA), 10 telas × 2 temas
VISUAL=1 npx playwright test temas                 # capturas das telas nos dois temas (test-results/temas)
```

A auditoria de acessibilidade grava `dados/resultados/acessibilidade/violacoes-{claro,escuro}.json`
e falha diante de violação grave ou crítica.

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
- Cada sugestão chega com o **trecho de evidência**; o acadêmico aceita ou rejeita **uma a uma**
  (não há aceite em lote, que a avaliação heurística apontou como risco).
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

## Módulo analítico e painéis

```bash
.venv\Scripts\python -m pip install -e "services/analitico[figuras,testes]"
cd services/analitico
..\..\.venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port 8766
```

- O serviço lê só as visões do esquema `analitico`, com o papel `lord_analitico` (no desenvolvimento,
  a URL sai de `apps/api/.dados-dev/segredos.json`; em produção, `URL_BANCO_ANALITICO`).
- **Evolução do paciente** (aluno, professor): a API aplica a RLS e manda ao serviço só as seções
  dos indicadores (`POST /evolucao`, sem acesso ao banco). ICD, escore de incapacidade, grau GCPS,
  abertura, sítios dolorosos à palpação.
- **Painel da coorte** (`/painel`; professor, pesquisador): variação da dor por tratamento
  (Wilcoxon pareado + rank-bisserial, Kruskal-Wallis + ε², IC 95%, respondedores ≥ 30% e ≥ 50%),
  abandono, prevalências, Eixo I e correlações de Spearman.
- **Qualidade** (também administrador): completude das fichas e aceitação das sugestões da IA.
- A API de desenvolvimento carrega a **coorte sintética** na primeira execução (aluno
  `coorte@lord.dev`; `COORTE=0` pula).

```bash
cd ferramentas
..\.venv\Scripts\python -m sinteticos.coorte                   # regenera dados/sinteticos/coorte
..\.venv\Scripts\python experimento_d.py --fonte offline       # Experimento D sem banco
..\.venv\Scripts\python experimento_d.py --fonte banco         # pelas visões (API e banco de dev no ar)
```

Resultados e figuras em `dados/resultados/experimento-d/`. As duas fontes dão o mesmo resultado.

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
| Sessão e papel verificados **antes** da validação do corpo (`preValidation`): sem sessão é sempre 401 | `src/autenticacao.ts` |
| CSP sem `unsafe-eval`: os validadores do esquema são pré-compilados (ver abaixo) | `packages/ficha/src/gerado/` |
| Cabeçalhos HSTS, CSP, X-Frame-Options, nosniff, Referrer-Policy e Permissions-Policy (só microfone) | `implantacao/Caddyfile` |

Os testes de ataque (sem sessão em todas as rotas, sessão forjada, injeção de SQL e HTML, objeto de
outro aluno, identificador malformado, corpo grande demais) estão em `test/seguranca.test.ts`.
Dependências: `npm audit` e `.venv\Scripts\pip-audit` sem vulnerabilidades conhecidas.

**Depois de alterar um esquema da ficha**, regenere os validadores pré-compilados (um teste acusa
se estiverem desatualizados):

```bash
cd packages/ficha
npx tsx scripts/gerar-validadores.ts
```

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
| `GET /pacientes/:id/evolucao` | aluno, professor | Indicadores por consulta aprovada |
| `GET /analise/coorte` | professor, pesquisador | Painel da coorte (pseudonimizado) |
| `GET /analise/qualidade` | professor, pesquisador, admin | Completude e aceitação da IA |
| `GET /analise/exportacao.csv` | professor, pesquisador | Dados pseudonimizados em CSV (auditado) |

### Implantação

`docker-compose.yml` com seis serviços (PostgreSQL 17, API, Ollama, transcrição, serviço analítico e
Caddy com HTTPS, que também serve a interface compilada) e `.env.exemplo`.
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

- `narrativa.txt` (casos de teste): o relato ditado, escrito **pelos autores** a partir do roteiro,
  depois que o prompt (v4) e as salvaguardas foram congelados. A Liga não participou da redação,
  o que está registrado como limitação no TCC (os relatos podem ser mais organizados que os reais).

Os relatos de `dados/sinteticos/desenvolvimento/` foram escritos pelos autores só para desenvolver
o prompt e o roteiro do experimento (casos de ajuste); os casos de teste nunca foram usados para isso.

## Avaliação técnica e de usabilidade (sem participantes)

```bash
cd apps/api
npx tsx scripts/benchmark-jsonb.ts          # JSONB × normalizado, 1.000 e 10.000 pacientes (~1 h)
cd ../../packages/ficha
npx tsx scripts/klm.ts                      # tempo de preenchimento pelo Keystroke-Level Model
```

Experimento B (sem voluntários: voz sintética pt-BR do Windows e ruído rosa a 10 dB, declarados no TCC):

```bash
cd ferramentas
..\.venv\Scripts\python experimento_b.py --modelos small,base     # áudio, transcrições e WER
cd ../packages/ia                                                   # extração sobre as transcrições
npx tsx scripts/experimento-a.ts --estrategias inteira --casos caso_001,... \
  --narrativas ../../dados/resultados/experimento-b/transcricoes/small-ruido \
  --saida ../../dados/resultados/experimento-b/extracao-small-ruido
```

Resultados em `dados/resultados/benchmark-jsonb/`, `dados/resultados/klm/`, `dados/resultados/experimento-b/` e
`dados/resultados/acessibilidade/`. O KLM usa o `campos.csv` do Experimento A
(`dados/resultados/experimento-a/teste-v4`) para estimar a revisão das sugestões.
