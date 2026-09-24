import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, type ItemRevisao } from "../api";
import { BarraCompletude, Carregando, MensagemErro, Vazio, formatarData } from "../componentes/ui";

export default function Revisao() {
  const fila = useQuery({ queryKey: ["revisao"], queryFn: () => api.get<ItemRevisao[]>("/revisao") });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Fichas aguardando revisão</h1>
        <p className="text-sm text-suave">Fichas enviadas pelos alunos, da mais antiga para a mais recente.</p>
      </div>
      <MensagemErro erro={fila.error} />
      {fila.isPending ? <Carregando /> : (
        <div className="overflow-hidden rounded-xl border border-borda bg-superficie">
          {fila.data?.length ? (
            <table className="w-full text-sm">
              <thead className="bg-fundo text-left text-xs text-suave">
                <tr>
                  <th className="px-4 py-2 font-medium">Paciente</th>
                  <th className="px-4 py-2 font-medium">Ficha</th>
                  <th className="px-4 py-2 font-medium">Aluno(a)</th>
                  <th className="px-4 py-2 font-medium">Atendimento</th>
                  <th className="px-4 py-2 font-medium">Completude</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {fila.data.map((f) => (
                  <tr key={f.id} className="hover:bg-fundo">
                    <td className="px-4 py-3">
                      <Link to={`/fichas/${f.id}`} className="font-medium text-marca-700 hover:underline">{f.paciente}</Link>
                    </td>
                    <td className="px-4 py-3">{f.tipo === "ficha-inicial" ? "Inicial" : "Retorno"}{f.versao > 1 ? ` · adendo v${f.versao}` : ""}</td>
                    <td className="px-4 py-3">{f.aluno}</td>
                    <td className="px-4 py-3 tabular-nums">{formatarData(f.data)}</td>
                    <td className="px-4 py-3"><BarraCompletude fracao={f.completude} compacta /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Vazio>Nenhuma ficha aguardando revisão.</Vazio>}
        </div>
      )}
    </div>
  );
}
