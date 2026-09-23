-- Papéis do banco, permissões e Row-Level Security (seção 4.6 do TCC).
--
-- A API conecta como lord_app, que NÃO é dona das tabelas; por isso as políticas de
-- RLS se aplicam a ela. A cada requisição a API executa, dentro da transação,
--     select set_config('app.usuario_id', '<id do usuário autenticado>', true)
-- e as políticas abaixo decidem o que aquele usuário enxerga.
-- As senhas dos papéis são definidas pelo executor das migrações (variáveis de ambiente).

do $$
begin
    if not exists (select from pg_roles where rolname = 'lord_app') then
        create role lord_app login;
    end if;
    if not exists (select from pg_roles where rolname = 'lord_analitico') then
        create role lord_analitico login;
    end if;
end $$;

-- Contexto da requisição -------------------------------------------------------
create function app_usuario() returns uuid
language sql stable as $$
    select nullif(current_setting('app.usuario_id', true), '')::uuid
$$;

-- O papel vem da tabela de usuários, e não de uma variável de sessão, para que não possa ser forjado
create function app_papel() returns text
language sql stable as $$
    select papel from usuario where id = app_usuario() and ativo
$$;

-- Permissões -----------------------------------------------------------------
revoke all on all tables in schema public from public;
grant usage on schema public to lord_app;
grant select, insert, update on
    usuario, sessao, paciente, consentimento, atendimento, ficha, odontograma, tratamento, sugestao_ia
    to lord_app;
grant delete on sessao to lord_app;
grant select, insert on auditoria to lord_app;   -- sem update/delete: auditoria é somente de inserção
grant usage on all sequences in schema public to lord_app;
grant execute on function app_usuario(), app_papel() to lord_app;

-- Row-Level Security -----------------------------------------------------------
-- Aluno: só os pacientes que cadastrou ou que atendeu. Professor: todos.
-- Administrador e pesquisador: nenhum dado clínico identificado.

alter table paciente enable row level security;
create policy paciente_leitura on paciente for select using (
    app_papel() = 'professor'
    or (app_papel() = 'aluno' and (
        criado_por = app_usuario()
        or exists (select 1 from atendimento a where a.paciente_id = paciente.id and a.aluno_id = app_usuario()))));
create policy paciente_insercao on paciente for insert with check (
    app_papel() in ('aluno', 'professor') and criado_por = app_usuario());
create policy paciente_alteracao on paciente for update using (
    app_papel() = 'professor'
    or (app_papel() = 'aluno' and (
        criado_por = app_usuario()
        or exists (select 1 from atendimento a where a.paciente_id = paciente.id and a.aluno_id = app_usuario()))));

alter table atendimento enable row level security;
create policy atendimento_leitura on atendimento for select using (
    app_papel() = 'professor' or (app_papel() = 'aluno' and aluno_id = app_usuario()));
create policy atendimento_insercao on atendimento for insert with check (
    (app_papel() = 'professor' or (app_papel() = 'aluno' and aluno_id = app_usuario()))
    and exists (select 1 from paciente p where p.id = paciente_id));
create policy atendimento_alteracao on atendimento for update using (
    app_papel() = 'professor' or (app_papel() = 'aluno' and aluno_id = app_usuario()));

-- Fichas, odontogramas e sugestões herdam a visibilidade do atendimento
alter table ficha enable row level security;
create policy ficha_acesso on ficha for all
    using (exists (select 1 from atendimento a where a.id = ficha.atendimento_id))
    with check (exists (select 1 from atendimento a where a.id = ficha.atendimento_id));

alter table odontograma enable row level security;
create policy odontograma_acesso on odontograma for all
    using (exists (select 1 from atendimento a where a.id = odontograma.atendimento_id))
    with check (exists (select 1 from atendimento a where a.id = odontograma.atendimento_id));

alter table sugestao_ia enable row level security;
create policy sugestao_ia_acesso on sugestao_ia for all
    using (exists (select 1 from ficha f where f.id = sugestao_ia.ficha_id))
    with check (exists (select 1 from ficha f where f.id = sugestao_ia.ficha_id));

-- Consentimentos e tratamentos herdam a visibilidade do paciente
alter table consentimento enable row level security;
create policy consentimento_acesso on consentimento for all
    using (exists (select 1 from paciente p where p.id = consentimento.paciente_id))
    with check (exists (select 1 from paciente p where p.id = consentimento.paciente_id));

alter table tratamento enable row level security;
create policy tratamento_acesso on tratamento for all
    using (exists (select 1 from paciente p where p.id = tratamento.paciente_id))
    with check (exists (select 1 from paciente p where p.id = tratamento.paciente_id));

-- Auditoria: qualquer requisição registra; só o administrador consulta
alter table auditoria enable row level security;
create policy auditoria_insercao on auditoria for insert with check (true);
create policy auditoria_leitura on auditoria for select using (app_papel() = 'admin');
