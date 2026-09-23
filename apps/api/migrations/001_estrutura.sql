-- Estrutura principal do prontuário (seção 4.5 do TCC).
-- Modelo híbrido: entidades estáveis em tabelas relacionais; conteúdo da ficha e
-- odontograma em JSONB, validados na API pelos esquemas de packages/ficha.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Usuários e sessões
-- ---------------------------------------------------------------------------
create table usuario (
    id                uuid primary key default gen_random_uuid(),
    nome              text not null,
    email             text not null,
    senha_hash        text not null,
    papel             text not null check (papel in ('aluno', 'professor', 'pesquisador', 'admin')),
    ativo             boolean not null default true,
    tentativas_falhas integer not null default 0,
    bloqueado_ate     timestamptz,
    criado_em         timestamptz not null default now()
);
create unique index usuario_email_idx on usuario (lower(email));

create table sessao (
    token_hash bytea primary key,            -- SHA-256 do token; o token em si só existe no cookie
    usuario_id uuid not null references usuario (id),
    criada_em  timestamptz not null default now(),
    expira_em  timestamptz not null
);
create index sessao_usuario_idx on sessao (usuario_id);

-- ---------------------------------------------------------------------------
-- Pacientes: identificadores diretos cifrados com pgcrypto (a chave fica fora do banco)
-- ---------------------------------------------------------------------------
create table paciente (
    id                      uuid primary key default gen_random_uuid(),
    numero_prontuario       text unique,
    nome                    text not null,
    data_nascimento         date not null,
    sexo                    char(1) check (sexo in ('M', 'F')),
    estado_civil            text,
    profissao               text,
    telefone_cifrado        bytea,
    telefone_recado_cifrado bytea,
    endereco_cifrado        bytea,
    rg_cifrado              bytea,
    cpf_cifrado             bytea,
    cpf_indice              bytea unique,    -- HMAC do CPF: permite busca exata e unicidade sem expor o valor
    criado_por              uuid not null references usuario (id),
    criado_em               timestamptz not null default now()
);
create index paciente_nome_idx on paciente (lower(nome));

create table consentimento (
    id             uuid primary key default gen_random_uuid(),
    paciente_id    uuid not null references paciente (id),
    tipo           text not null check (tipo in ('tcle', 'gravacao_audio', 'pesquisa')),
    versao_termo   text not null,
    aceito_em      date not null,
    registrado_por uuid not null references usuario (id),
    criado_em      timestamptz not null default now()
);
create index consentimento_paciente_idx on consentimento (paciente_id);

-- ---------------------------------------------------------------------------
-- Atendimentos e fichas
-- ---------------------------------------------------------------------------
create table atendimento (
    id           uuid primary key default gen_random_uuid(),
    paciente_id  uuid not null references paciente (id),
    data         date not null default current_date,
    tipo         text not null check (tipo in ('primeira_consulta', 'retorno')),
    aluno_id     uuid not null references usuario (id),
    professor_id uuid references usuario (id),
    criado_em    timestamptz not null default now()
);
create index atendimento_paciente_idx on atendimento (paciente_id);
create index atendimento_aluno_idx on atendimento (aluno_id);

create table ficha (
    id                 uuid primary key default gen_random_uuid(),
    atendimento_id     uuid not null references atendimento (id),
    tipo               text not null check (tipo in ('ficha-inicial', 'ficha-retorno')),
    schema_versao      text not null,             -- $id do esquema, ex.: urn:lord-uepg:ficha-inicial:v1
    versao             integer not null default 1,
    ficha_anterior_id  uuid references ficha (id), -- preenchido nos adendos
    dados              jsonb not null default '{}',
    status             text not null default 'rascunho' check (status in ('rascunho', 'em_revisao', 'aprovada')),
    completude         real,
    comentario_revisao text,
    preenchido_por     uuid not null references usuario (id),
    aprovado_por       uuid references usuario (id),
    aprovado_em        timestamptz,
    criado_em          timestamptz not null default now(),
    atualizado_em      timestamptz not null default now(),

    -- Campos mais consultados pelo módulo analítico, expostos como colunas geradas
    -- (a ficha inicial e a de retorno guardam as mesmas medidas em caminhos diferentes)
    dor_atual smallint generated always as (
        coalesce(dados #>> '{questionario_dtm,q16_dor_atual}', dados #>> '{dor,q16_dor_atual}')::smallint) stored,
    pior_dor smallint generated always as (
        coalesce(dados #>> '{questionario_dtm,q17_pior_dor_6m}', dados #>> '{dor,q17_pior_dor}')::smallint) stored,
    dor_media smallint generated always as (
        coalesce(dados #>> '{questionario_dtm,q18_dor_media_6m}', dados #>> '{dor,q18_dor_media}')::smallint) stored,
    abertura_max_sem_auxilio real generated always as (
        coalesce(dados #>> '{exame_dtm,q39b_abertura_maxima_sem_auxilio_mm}',
                 dados #>> '{exame,q39b_abertura_maxima_sem_auxilio_mm}')::real) stored,

    unique (atendimento_id, tipo, versao)
);
create index ficha_atendimento_idx on ficha (atendimento_id);
create index ficha_dados_idx on ficha using gin (dados jsonb_path_ops);
create index ficha_dor_atual_idx on ficha (dor_atual);

create table odontograma (
    atendimento_id uuid primary key references atendimento (id),
    dados          jsonb not null default '{}',
    atualizado_por uuid not null references usuario (id),
    atualizado_em  timestamptz not null default now()
);

create table tratamento (
    id             uuid primary key default gen_random_uuid(),
    paciente_id    uuid not null references paciente (id),
    categoria      text not null check (categoria in (
        'placa_oclusal', 'orientacoes_autocuidado', 'termoterapia', 'farmacoterapia',
        'fisioterapia', 'laser_baixa_intensidade', 'exercicios_mandibulares',
        'protese_total', 'protese_parcial_removivel', 'protese_fixa', 'protese_sobre_implante',
        'encaminhamento', 'outro')),
    inicio         date not null,
    fim            date check (fim is null or fim >= inicio),
    registrado_por uuid not null references usuario (id),
    criado_em      timestamptz not null default now()
);
create index tratamento_paciente_idx on tratamento (paciente_id);

-- Registro de cada sugestão da IA e da decisão humana campo a campo (usado na fase 4)
create table sugestao_ia (
    id            uuid primary key default gen_random_uuid(),
    ficha_id      uuid not null references ficha (id),
    secao         text not null,
    origem        text not null check (origem in ('texto', 'audio')),
    transcricao   text,
    modelo        text not null,
    versao_prompt text not null,
    saida         jsonb not null,
    latencia_ms   integer,
    decisoes      jsonb not null default '{}',
    criado_por    uuid not null references usuario (id),
    criado_em     timestamptz not null default now()
);
create index sugestao_ia_ficha_idx on sugestao_ia (ficha_id);

-- ---------------------------------------------------------------------------
-- Trilha de auditoria: somente inserção
-- ---------------------------------------------------------------------------
create table auditoria (
    id          bigint generated always as identity primary key,
    em          timestamptz not null default now(),
    usuario_id  uuid references usuario (id),
    acao        text not null,
    entidade    text,
    entidade_id uuid,
    detalhes    jsonb not null default '{}',
    ip          inet
);
create index auditoria_entidade_idx on auditoria (entidade_id);
create index auditoria_usuario_idx on auditoria (usuario_id, em);

create function impedir_alteracao_auditoria() returns trigger
language plpgsql as $$
begin
    raise exception 'a trilha de auditoria é somente de inserção' using errcode = 'P0001';
end $$;

create trigger auditoria_somente_insercao
    before update or delete on auditoria
    for each row execute function impedir_alteracao_auditoria();
create trigger auditoria_sem_truncate
    before truncate on auditoria
    for each statement execute function impedir_alteracao_auditoria();

-- ---------------------------------------------------------------------------
-- Ficha aprovada é imutável; fichas nunca são excluídas (correções viram adendos)
-- ---------------------------------------------------------------------------
create function proteger_ficha() returns trigger
language plpgsql as $$
begin
    if tg_op = 'DELETE' then
        raise exception 'fichas não podem ser excluídas' using errcode = 'P0001';
    end if;
    if old.status = 'aprovada' then
        raise exception 'ficha aprovada é imutável; registre um adendo' using errcode = 'P0001';
    end if;
    new.atualizado_em := now();
    return new;
end $$;

create trigger ficha_protegida
    before update or delete on ficha
    for each row execute function proteger_ficha();
