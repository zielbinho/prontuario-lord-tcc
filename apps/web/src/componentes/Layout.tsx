import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router";
import { api, type ItemRevisao, type Papel } from "../api";
import { useAutenticacao, useUsuario } from "../autenticacao";
import { AlternarTema } from "../tema";
import { classes } from "./ui";

const NOMES_PAPEL: Record<Papel, string> = {
  aluno: "Aluno(a)",
  professor: "Professor(a)",
  pesquisador: "Pesquisador(a)",
  admin: "Administração",
};

const LINKS: Record<Papel, { para: string; texto: string }[]> = {
  aluno: [{ para: "/pacientes", texto: "Pacientes" }],
  professor: [{ para: "/pacientes", texto: "Pacientes" }, { para: "/revisao", texto: "Revisão" }, { para: "/painel", texto: "Painel" }],
  pesquisador: [{ para: "/painel", texto: "Painel" }],
  admin: [{ para: "/usuarios", texto: "Usuários" }, { para: "/auditoria", texto: "Auditoria" }, { para: "/painel", texto: "Qualidade" }],
};

export function Layout() {
  const usuario = useUsuario();
  const { sair } = useAutenticacao();
  const fila = useQuery({
    queryKey: ["revisao"],
    queryFn: () => api.get<ItemRevisao[]>("/revisao"),
    enabled: usuario.papel === "professor",
    refetchInterval: 60_000,
  });

  return (
    <div className="min-h-screen">
      <header className="border-b border-borda bg-superficie">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <NavLink to="/" className="flex items-center gap-2 font-semibold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-marca-600 text-sm font-bold text-white">L</span>
            Prontuário LORD
          </NavLink>
          <nav className="flex gap-1" aria-label="Principal">
            {LINKS[usuario.papel].map((l) => (
              <NavLink key={l.para} to={l.para}
                className={({ isActive }) => classes(
                  "flex min-h-9 items-center gap-2 rounded-lg px-3 text-sm",
                  isActive ? "bg-marca-50 font-medium text-destaque" : "text-suave hover:text-texto",
                )}>
                {l.texto}
                {l.para === "/revisao" && !!fila.data?.length && (
                  <span className="rounded-full bg-revisao px-1.5 text-xs font-semibold text-superficie">{fila.data.length}</span>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <AlternarTema />
            <span className="text-right leading-tight">
              <span className="block font-medium">{usuario.nome}</span>
              <span className="block text-xs text-suave">{NOMES_PAPEL[usuario.papel]}</span>
            </span>
            <button type="button" onClick={sair} className="min-h-9 rounded-lg px-3 text-suave hover:bg-fundo hover:text-texto">
              Sair
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
