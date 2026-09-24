import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, type Papel, type Usuario } from "../api";
import { Botao, Cartao, Carregando, Entrada, MensagemErro, Rotulo, Selecao, Vazio, classes } from "../componentes/ui";

const PAPEIS: Record<Papel, string> = { aluno: "Aluno(a)", professor: "Professor(a)", pesquisador: "Pesquisador(a)", admin: "Administrador(a)" };

export function Usuarios() {
  const cliente = useQueryClient();
  const lista = useQuery({ queryKey: ["usuarios"], queryFn: () => api.get<Usuario[]>("/usuarios") });
  const [novo, setNovo] = useState({ nome: "", email: "", senha: "", papel: "aluno" as Papel });

  const criar = useMutation({
    mutationFn: () => api.post<Usuario>("/usuarios", novo),
    onSuccess: () => {
      setNovo({ nome: "", email: "", senha: "", papel: "aluno" });
      cliente.invalidateQueries({ queryKey: ["usuarios"] });
    },
  });
  const alternar = useMutation({
    mutationFn: (u: Usuario) => api.patch(`/usuarios/${u.id}`, { ativo: !u.ativo }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ["usuarios"] }),
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    criar.mutate();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Usuários</h1>
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <Cartao>
          {lista.isPending ? <Carregando /> : lista.data?.length ? (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-suave">
                <tr><th className="pb-2 font-medium">Nome</th><th className="pb-2 font-medium">E-mail</th><th className="pb-2 font-medium">Papel</th><th /></tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {lista.data.map((u) => (
                  <tr key={u.id} className={classes(!u.ativo && "text-suave")}>
                    <td className="py-2">{u.nome}</td>
                    <td className="py-2">{u.email}</td>
                    <td className="py-2">{PAPEIS[u.papel]}</td>
                    <td className="py-2 text-right">
                      <Botao variante={u.ativo ? "secundario" : "fantasma"} onClick={() => alternar.mutate(u)}>
                        {u.ativo ? "Desativar" : "Reativar"}
                      </Botao>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Vazio>Nenhum usuário.</Vazio>}
          <MensagemErro erro={lista.error ?? alternar.error} />
        </Cartao>

        <Cartao titulo="Novo usuário">
          <form onSubmit={enviar} className="space-y-3">
            <div><Rotulo htmlFor="n">Nome</Rotulo><Entrada id="n" required value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} /></div>
            <div><Rotulo htmlFor="e">E-mail</Rotulo><Entrada id="e" type="email" required value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} /></div>
            <div>
              <Rotulo htmlFor="s">Senha inicial</Rotulo>
              <Entrada id="s" type="password" minLength={10} required autoComplete="new-password" value={novo.senha}
                onChange={(e) => setNovo({ ...novo, senha: e.target.value })} />
              <p className="mt-1 text-xs text-suave">Mínimo de 10 caracteres.</p>
            </div>
            <div>
              <Rotulo htmlFor="p">Papel</Rotulo>
              <Selecao id="p" value={novo.papel} onChange={(e) => setNovo({ ...novo, papel: e.target.value as Papel })}>
                {Object.entries(PAPEIS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </Selecao>
            </div>
            <MensagemErro erro={criar.error} />
            <Botao type="submit" className="w-full" carregando={criar.isPending}>Criar usuário</Botao>
          </form>
        </Cartao>
      </div>
    </div>
  );
}

interface EventoAuditoria {
  id: number;
  em: string;
  usuario: string | null;
  acao: string;
  entidade: string | null;
  entidade_id: string | null;
  detalhes: Record<string, unknown>;
  ip: string | null;
}

const ACOES: Record<string, string> = {
  login: "Entrou no sistema", login_falhou: "Tentativa de login falhou", login_bloqueado: "Login bloqueado", logout: "Saiu do sistema",
  criar_paciente: "Cadastrou paciente", ler_paciente: "Consultou paciente", alterar_paciente: "Alterou paciente",
  abrir_atendimento: "Abriu atendimento", ler_ficha: "Consultou ficha", alterar_ficha: "Alterou ficha",
  enviar_ficha_revisao: "Enviou ficha para revisão", devolver_ficha: "Devolveu ficha", aprovar_ficha: "Aprovou ficha",
  criar_adendo: "Criou adendo", alterar_odontograma: "Alterou odontograma", registrar_consentimento: "Registrou consentimento",
  registrar_tratamento: "Registrou tratamento", criar_usuario: "Criou usuário", alterar_usuario: "Alterou usuário",
};

export function Auditoria() {
  const [filtro, setFiltro] = useState("");
  const eventos = useQuery({
    queryKey: ["auditoria", filtro],
    queryFn: () => api.get<EventoAuditoria[]>(`/auditoria${/^[0-9a-f-]{36}$/i.test(filtro) ? `?entidade_id=${filtro}` : ""}`),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Trilha de auditoria</h1>
        <p className="text-sm text-suave">Registro somente de inserção de acessos e alterações. Não contém dados clínicos nem pessoais.</p>
      </div>
      <Entrada placeholder="Filtrar pelo identificador de um paciente, ficha ou atendimento" value={filtro}
        onChange={(e) => setFiltro(e.target.value.trim())} className="max-w-xl" aria-label="Filtrar por identificador" />
      <MensagemErro erro={eventos.error} />
      {eventos.isPending ? <Carregando /> : (
        <div className="overflow-x-auto rounded-xl border border-borda bg-superficie">
          <table className="w-full text-sm">
            <thead className="bg-fundo text-left text-xs text-suave">
              <tr>
                <th className="px-4 py-2 font-medium">Quando</th><th className="px-4 py-2 font-medium">Quem</th>
                <th className="px-4 py-2 font-medium">Ação</th><th className="px-4 py-2 font-medium">Detalhes</th>
                <th className="px-4 py-2 font-medium">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borda">
              {eventos.data?.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-4 py-2 tabular-nums">{new Date(e.em).toLocaleString("pt-BR")}</td>
                  <td className="whitespace-nowrap px-4 py-2">{e.usuario ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2">{ACOES[e.acao] ?? e.acao}</td>
                  <td className="px-4 py-2 text-xs break-all text-suave">
                    {e.entidade && <span className="mr-2">{e.entidade} {e.entidade_id?.slice(0, 8)}</span>}
                    {Object.keys(e.detalhes).length > 0 && JSON.stringify(e.detalhes)}
                  </td>
                  <td className="px-4 py-2 text-xs tabular-nums text-suave">{e.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function Pesquisa() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">Pesquisa</h1>
      <Cartao>
        <p className="text-sm">
          O perfil de pesquisa acessa apenas dados pseudonimizados: sem nome, documentos, contatos, datas exatas ou textos livres.
          Os painéis de evolução clínica da coorte serão disponibilizados pelo módulo analítico (fase 5).
        </p>
      </Cartao>
    </div>
  );
}
