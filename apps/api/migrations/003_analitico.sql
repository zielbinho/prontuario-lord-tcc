-- Esquema analítico pseudonimizado (LGPD, art. 13; seções 4.6 e 4.8 do TCC).
--
-- O papel lord_analitico (usado pelo serviço analítico e por pesquisadores) enxerga
-- apenas as visões deste esquema: sem nome, documentos, contatos ou datas exatas.
-- O identificador do paciente é substituído por um HMAC com chave secreta guardada
-- no esquema "privado", ao qual nenhum papel de aplicação tem acesso.

create schema privado;
revoke all on schema privado from public;

create table privado.segredo (
    nome  text primary key,
    valor bytea not null
);
-- o valor 'pseudonimo' é inserido pelo executor das migrações a partir de SEGREDO_PSEUDONIMO

create schema analitico;
revoke all on schema analitico from public;

create function analitico.pseudonimo(id uuid) returns text
language sql stable security definer
set search_path = pg_catalog, public
as $$
    select left(encode(hmac(convert_to(id::text, 'UTF8'),
                            (select valor from privado.segredo where nome = 'pseudonimo'),
                            'sha256'), 'hex'), 16)
$$;
revoke all on function analitico.pseudonimo(uuid) from public;

-- Data da primeira consulta de cada paciente: referência para converter datas em "dias desde o início"
create view analitico.inicio_paciente as
    select paciente_id, min(data) as primeira_data
    from atendimento
    group by paciente_id;
revoke all on analitico.inicio_paciente from public;

create view analitico.paciente as
    select analitico.pseudonimo(p.id) as pseudo_id,
           (floor(extract(year from age(current_date, p.data_nascimento)) / 10) * 10)::int as faixa_etaria_inicio,
           p.sexo
    from paciente p;

-- Apenas a versão aprovada mais recente de cada ficha; somente campos estruturados
-- (textos livres podem conter nomes e outros identificadores e ficam de fora)
create view analitico.ficha as
    select analitico.pseudonimo(a.paciente_id) as pseudo_id,
           a.data - i.primeira_data as dias_desde_inicio,
           a.tipo as tipo_atendimento,
           f.tipo as tipo_ficha,
           f.versao,
           f.dor_atual,
           f.pior_dor,
           f.dor_media,
           f.abertura_max_sem_auxilio,
           jsonb_strip_nulls(jsonb_build_object(
               'questionario_dtm',              f.dados -> 'questionario_dtm',
               'exame_dtm',                     (f.dados -> 'exame_dtm') - 'q38_padrao_abertura_outro',
               'rdc_caracteristicas_relatadas', f.dados -> 'rdc_caracteristicas_relatadas',
               'diagnostico_eixo1',             f.dados -> 'diagnostico_eixo1',
               'categorias_tratamento',         f.dados #> '{plano_tratamento,categorias}',
               'usuario_protese',               f.dados #> '{protese,q47_usuario_protese}',
               'tipos_protese',                 f.dados #> '{protese,q47_tipos_protese}',
               'dor',                           f.dados -> 'dor',
               'exame',                         f.dados -> 'exame',
               'adesao_tratamento',             f.dados #> '{acompanhamento,adesao_tratamento}'
           )) as dados_estruturados
    from ficha f
    join atendimento a on a.id = f.atendimento_id
    join analitico.inicio_paciente i on i.paciente_id = a.paciente_id
    where f.status = 'aprovada'
      and not exists (select 1 from ficha g where g.ficha_anterior_id = f.id and g.status = 'aprovada');

create view analitico.tratamento as
    select analitico.pseudonimo(t.paciente_id) as pseudo_id,
           t.categoria,
           t.inicio - i.primeira_data as inicio_dias,
           t.fim - i.primeira_data as fim_dias
    from tratamento t
    left join analitico.inicio_paciente i on i.paciente_id = t.paciente_id;

grant usage on schema analitico to lord_analitico;
grant select on analitico.paciente, analitico.ficha, analitico.tratamento to lord_analitico;
-- Funções usadas em visões são verificadas com os privilégios de quem consulta a visão.
-- A execução não expõe o segredo (security definer) e só reproduz um pseudônimo a partir
-- do UUID real do paciente, que não aparece em nenhuma visão analítica.
grant execute on function analitico.pseudonimo(uuid) to lord_analitico;
