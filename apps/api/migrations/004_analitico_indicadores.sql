-- Complementos do esquema analítico para os indicadores de coorte e de qualidade (fase 5).
-- Continuam valendo as regras da 003: sem nome, documentos, contatos, datas exatas ou texto livre.

-- Tempo desde a última consulta, relativo à data atual: necessário para medir o abandono.
-- É uma duração, não uma data, e não identifica o paciente.
create or replace view analitico.paciente as
    select analitico.pseudonimo(p.id) as pseudo_id,
           (floor(extract(year from age(current_date, p.data_nascimento)) / 10) * 10)::int as faixa_etaria_inicio,
           p.sexo,
           current_date - (select max(a.data) from atendimento a where a.paciente_id = p.id) as dias_desde_ultima_consulta
    from paciente p;

-- Completude das fichas vigentes (sem as versões substituídas por adendo), para o painel de qualidade.
create view analitico.qualidade_ficha as
    select f.tipo as tipo_ficha, f.status, f.completude
    from ficha f
    where not exists (select 1 from ficha g where g.ficha_anterior_id = f.id);

-- Uma linha por decisão humana sobre uma sugestão da IA. Sem o relato, a transcrição, a saída do
-- modelo nem o valor sugerido: só qual campo, qual decisão e com que modelo e versão de prompt.
create view analitico.decisao_ia as
    select s.secao, s.modelo, s.versao_prompt, s.origem, d.key as campo, d.value as decisao
    from sugestao_ia s
    cross join lateral jsonb_each_text(s.decisoes) d;

grant select on analitico.qualidade_ficha, analitico.decisao_ia to lord_analitico;
