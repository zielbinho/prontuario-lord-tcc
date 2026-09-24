import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, type PacienteResumo } from "../api";
import { Botao, Carregando, Entrada, MensagemErro, Vazio, formatarData, idade } from "../componentes/ui";

export default function Pacientes() {
  const navegar = useNavigate();
  const [texto, setTexto] = useState("");
  const [busca, setBusca] = useState("");

  // espera o usuário parar de digitar antes de consultar
  useEffect(() => {
    const t = setTimeout(() => setBusca(texto.trim()), 300);
    return () => clearTimeout(t);
  }, [texto]);

  const consulta = useQuery({
    queryKey: ["pacientes", busca],
    queryFn: () => api.get<PacienteResumo[]>(`/pacientes${busca ? `?busca=${encodeURIComponent(busca)}` : ""}`),
    placeholderData: (anterior) => anterior,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Pacientes</h1>
        <Botao onClick={() => navegar("/pacientes/novo")}>Novo paciente</Botao>
      </div>

      <Entrada type="search" placeholder="Buscar por nome, número do prontuário ou CPF" value={texto}
        onChange={(e) => setTexto(e.target.value)} aria-label="Buscar pacientes" className="max-w-xl" />

      <MensagemErro erro={consulta.error} />
      {consulta.isPending ? (
        <Carregando />
      ) : (
        <div className="overflow-hidden rounded-xl border border-borda bg-superficie">
          {consulta.data?.length ? (
            <table className="w-full text-sm">
              <thead className="bg-fundo text-left text-xs text-suave">
                <tr>
                  <th className="px-4 py-2 font-medium">Nome</th>
                  <th className="px-4 py-2 font-medium">Prontuário</th>
                  <th className="hidden px-4 py-2 font-medium sm:table-cell">Nascimento</th>
                  <th className="px-4 py-2 font-medium">Idade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {consulta.data.map((p) => (
                  <tr key={p.id} className="hover:bg-fundo">
                    <td className="px-4 py-3">
                      <Link to={`/pacientes/${p.id}`} className="font-medium text-destaque hover:underline">{p.nome}</Link>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{p.numero_prontuario ?? "—"}</td>
                    <td className="hidden px-4 py-3 tabular-nums sm:table-cell">{formatarData(p.data_nascimento)}</td>
                    <td className="px-4 py-3 tabular-nums">{idade(p.data_nascimento)} anos</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Vazio>{busca ? "Nenhum paciente encontrado para esta busca." : "Nenhum paciente cadastrado ainda."}</Vazio>
          )}
        </div>
      )}
      <p className="text-xs text-suave">
        Você vê os pacientes que cadastrou ou atendeu. Professores veem todos os pacientes da Liga.
      </p>
    </div>
  );
}
