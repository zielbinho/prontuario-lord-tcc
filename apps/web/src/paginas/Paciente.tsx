import { rotulo } from "@lord/ficha";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, type Atendimento, type Paciente as TipoPaciente } from "../api";
import { useUsuario } from "../autenticacao";
import { EvolucaoPaciente } from "../componentes/EvolucaoPaciente";
import {
  BarraCompletude, Botao, Cartao, Carregando, Entrada, EtiquetaStatus, MensagemErro, Rotulo, Selecao, Vazio,
  formatarCpf, formatarData, formatarTelefone, idade,
} from "../componentes/ui";

const CATEGORIAS_TRATAMENTO = [
  "placa_oclusal", "orientacoes_autocuidado", "termoterapia", "farmacoterapia", "fisioterapia",
  "laser_baixa_intensidade", "exercicios_mandibulares", "protese_total", "protese_parcial_removivel",
  "protese_fixa", "protese_sobre_implante", "encaminhamento", "outro",
];
const hoje = () => new Date().toISOString().slice(0, 10);

function Dado({ rotulo: r, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-suave">{r}</dt>
      <dd className="text-sm">{valor || "—"}</dd>
    </div>
  );
}

export default function Paciente() {
  const { id = "" } = useParams();
  const usuario = useUsuario();
  const navegar = useNavigate();
  const cliente = useQueryClient();

  const paciente = useQuery({ queryKey: ["paciente", id], queryFn: () => api.get<TipoPaciente>(`/pacientes/${id}`) });
  const atendimentos = useQuery({ queryKey: ["atendimentos", id], queryFn: () => api.get<Atendimento[]>(`/pacientes/${id}/atendimentos`) });
  const professores = useQuery({
    queryKey: ["professores"], queryFn: () => api.get<{ id: string; nome: string }[]>("/usuarios/professores"),
    enabled: usuario.papel === "aluno",
  });
  const alunos = useQuery({
    queryKey: ["alunos"], queryFn: () => api.get<{ id: string; nome: string }[]>("/usuarios/alunos"),
    enabled: usuario.papel === "professor",
  });

  const [novoAtendimento, setNovoAtendimento] = useState({ tipo: "primeira_consulta", data: hoje(), pessoa: "" });
  const [abrindo, setAbrindo] = useState(false);
  const [tratamento, setTratamento] = useState({ categoria: "placa_oclusal", inicio: hoje() });

  const abrir = useMutation({
    mutationFn: () => api.post<{ ficha: { id: string } }>(`/pacientes/${id}/atendimentos`, {
      tipo: novoAtendimento.tipo,
      data: novoAtendimento.data,
      ...(novoAtendimento.pessoa ? { [usuario.papel === "professor" ? "aluno_id" : "professor_id"]: novoAtendimento.pessoa } : {}),
    }),
    onSuccess: (r) => {
      cliente.invalidateQueries({ queryKey: ["atendimentos", id] });
      navegar(`/fichas/${r.ficha.id}`);
    },
  });
  const registrarTcle = useMutation({
    mutationFn: () => api.post(`/pacientes/${id}/consentimentos`, { tipo: "tcle", versao_termo: "LORD-2026", aceito_em: hoje() }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ["paciente", id] }),
  });
  const registrarTratamento = useMutation({
    mutationFn: () => api.post(`/pacientes/${id}/tratamentos`, tratamento),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ["paciente", id] }),
  });

  if (paciente.isPending) return <Carregando />;
  if (paciente.error || !paciente.data) return <MensagemErro erro={paciente.error ?? "Paciente não encontrado"} />;
  const p = paciente.data;
  const temTcle = p.consentimentos?.some((c) => c.tipo === "tcle");
  const primeiraConsultaFeita = atendimentos.data?.some((a) => a.tipo === "primeira_consulta");
  const pessoas = usuario.papel === "professor" ? alunos.data : professores.data;

  return (
    <div className="space-y-4">
      <Link to="/pacientes" className="text-sm text-destaque hover:underline">← Pacientes</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{p.nome}</h1>
          <p className="text-sm text-suave">
            {idade(p.data_nascimento)} anos · {rotulo(p.sexo)} · prontuário {p.numero_prontuario ?? "sem número"}
          </p>
        </div>
        <Botao onClick={() => {
          setNovoAtendimento((n) => ({ ...n, tipo: primeiraConsultaFeita ? "retorno" : "primeira_consulta" }));
          setAbrindo(true);
        }}>
          Novo atendimento
        </Botao>
      </div>

      {!temTcle && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rascunho/30 bg-rascunho-fundo px-4 py-3 text-sm">
          <span>Não há TCLE registrado para este paciente.</span>
          <Botao variante="secundario" onClick={() => registrarTcle.mutate()} carregando={registrarTcle.isPending}>
            Registrar TCLE assinado hoje
          </Botao>
        </div>
      )}

      {abrindo && (
        <Cartao titulo="Novo atendimento">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Rotulo htmlFor="tipo">Tipo</Rotulo>
              <Selecao id="tipo" value={novoAtendimento.tipo} onChange={(e) => setNovoAtendimento({ ...novoAtendimento, tipo: e.target.value })}>
                <option value="primeira_consulta">Primeira consulta (ficha inicial)</option>
                <option value="retorno">Retorno (ficha de evolução)</option>
              </Selecao>
            </div>
            <div>
              <Rotulo htmlFor="data">Data</Rotulo>
              <Entrada id="data" type="date" value={novoAtendimento.data} onChange={(e) => setNovoAtendimento({ ...novoAtendimento, data: e.target.value })} />
            </div>
            <div>
              <Rotulo htmlFor="pessoa">{usuario.papel === "professor" ? "Aluno(a) responsável" : "Professor(a) supervisor(a)"}</Rotulo>
              <Selecao id="pessoa" value={novoAtendimento.pessoa} onChange={(e) => setNovoAtendimento({ ...novoAtendimento, pessoa: e.target.value })}>
                <option value="">{usuario.papel === "professor" ? "Selecione…" : "Definir depois"}</option>
                {pessoas?.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </Selecao>
            </div>
          </div>
          <MensagemErro erro={abrir.error} />
          <div className="mt-4 flex justify-end gap-2">
            <Botao variante="fantasma" onClick={() => setAbrindo(false)}>Cancelar</Botao>
            <Botao onClick={() => abrir.mutate()} carregando={abrir.isPending}
              disabled={usuario.papel === "professor" && !novoAtendimento.pessoa}>
              Abrir ficha
            </Botao>
          </div>
        </Cartao>
      )}

      {!!atendimentos.data?.length && <EvolucaoPaciente pacienteId={id} />}

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_22rem]">
        <Cartao titulo="Atendimentos">
          {atendimentos.isPending ? <Carregando /> : !atendimentos.data?.length ? (
            <Vazio>Nenhum atendimento registrado. Abra a primeira consulta para preencher a ficha inicial.</Vazio>
          ) : (
            <ul className="divide-y divide-borda">
              {atendimentos.data.map((a) => (
                <li key={a.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">
                      {a.tipo === "primeira_consulta" ? "Primeira consulta" : "Retorno"} · {formatarData(a.data)}
                    </span>
                    <span className="text-xs text-suave">
                      {a.aluno}{a.professor ? ` · supervisão ${a.professor}` : ""}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {a.fichas.map((f) => (
                      <li key={f.id}>
                        <Link to={`/fichas/${f.id}`}
                          className="flex flex-wrap items-center gap-3 rounded-lg border border-borda px-3 py-2 text-sm hover:border-marca-500">
                          <span>{f.tipo === "ficha-inicial" ? "Ficha inicial" : "Ficha de retorno"}{f.versao > 1 ? ` · adendo v${f.versao}` : ""}</span>
                          <EtiquetaStatus status={f.status} />
                          <span className="ml-auto"><BarraCompletude fracao={f.completude} compacta /></span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Cartao>

        <div className="space-y-4">
          <Cartao titulo="Dados pessoais">
            <dl className="grid grid-cols-2 gap-3">
              <Dado rotulo="Nascimento" valor={formatarData(p.data_nascimento)} />
              <Dado rotulo="CPF" valor={formatarCpf(p.cpf)} />
              <Dado rotulo="Telefone" valor={formatarTelefone(p.telefone)} />
              <Dado rotulo="Recado" valor={formatarTelefone(p.telefone_recado)} />
              <Dado rotulo="Estado civil" valor={p.estado_civil} />
              <Dado rotulo="Profissão" valor={p.profissao} />
              <div className="col-span-2"><Dado rotulo="Endereço" valor={p.endereco} /></div>
            </dl>
          </Cartao>

          <Cartao titulo="Tratamentos">
            {p.tratamentos?.length ? (
              <ul className="mb-4 space-y-1 text-sm">
                {p.tratamentos.map((t) => (
                  <li key={t.id} className="flex justify-between gap-2">
                    <span>{rotulo(t.categoria)}</span>
                    <span className="text-suave tabular-nums">{formatarData(t.inicio)}{t.fim ? ` – ${formatarData(t.fim)}` : ""}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="mb-4 text-sm text-suave">Nenhum tratamento registrado.</p>}
            <div className="flex gap-2">
              <Selecao aria-label="Categoria de tratamento" value={tratamento.categoria}
                onChange={(e) => setTratamento({ ...tratamento, categoria: e.target.value })}>
                {CATEGORIAS_TRATAMENTO.map((c) => <option key={c} value={c}>{rotulo(c)}</option>)}
              </Selecao>
              <Entrada aria-label="Início" type="date" value={tratamento.inicio} className="w-40"
                onChange={(e) => setTratamento({ ...tratamento, inicio: e.target.value })} />
            </div>
            <Botao variante="secundario" className="mt-2 w-full" onClick={() => registrarTratamento.mutate()} carregando={registrarTratamento.isPending}>
              Registrar início de tratamento
            </Botao>
            <MensagemErro erro={registrarTratamento.error} />
          </Cartao>

          <Cartao titulo="Consentimentos">
            {p.consentimentos?.length ? (
              <ul className="space-y-1 text-sm">
                {p.consentimentos.map((c) => (
                  <li key={c.id} className="flex justify-between">
                    <span>{c.tipo === "tcle" ? "TCLE" : c.tipo === "gravacao_audio" ? "Gravação de áudio" : "Pesquisa"} ({c.versao_termo})</span>
                    <span className="text-suave tabular-nums">{formatarData(c.aceito_em)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-suave">Nenhum consentimento registrado.</p>}
          </Cartao>
        </div>
      </div>
    </div>
  );
}
