import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from "react-router";
import type { Papel } from "./api";
import { ProvedorAutenticacao, useAutenticacao } from "./autenticacao";
import { Layout } from "./componentes/Layout";
import { Carregando } from "./componentes/ui";
import { Auditoria, Pesquisa, Usuarios } from "./paginas/Administracao";
import Ficha from "./paginas/Ficha";
import Login from "./paginas/Login";
import NovoPaciente from "./paginas/NovoPaciente";
import Paciente from "./paginas/Paciente";
import Pacientes from "./paginas/Pacientes";
import Revisao from "./paginas/Revisao";
import "./estilo.css";

const INICIO: Record<Papel, string> = { aluno: "/pacientes", professor: "/revisao", pesquisador: "/pesquisa", admin: "/usuarios" };

/** Exige sessão e, opcionalmente, um dos papéis; a API aplica as mesmas regras. */
function Protegida({ papeis, children }: { papeis?: Papel[]; children?: ReactNode }) {
  const { usuario, carregando } = useAutenticacao();
  if (carregando) return <Carregando />;
  if (!usuario) return <Navigate to="/login" replace />;
  if (papeis && !papeis.includes(usuario.papel)) return <Navigate to={INICIO[usuario.papel]} replace />;
  return <>{children ?? <Outlet />}</>;
}

function Inicio() {
  const { usuario } = useAutenticacao();
  return <Navigate to={usuario ? INICIO[usuario.papel] : "/login"} replace />;
}

const clinicos: Papel[] = ["aluno", "professor"];

const roteador = createBrowserRouter([
  { path: "/login", element: <Login /> },
  {
    element: <Protegida><Layout /></Protegida>,
    children: [
      { index: true, element: <Inicio /> },
      { path: "pacientes", element: <Protegida papeis={clinicos}><Pacientes /></Protegida> },
      { path: "pacientes/novo", element: <Protegida papeis={clinicos}><NovoPaciente /></Protegida> },
      { path: "pacientes/:id", element: <Protegida papeis={clinicos}><Paciente /></Protegida> },
      { path: "fichas/:id", element: <Protegida papeis={clinicos}><Ficha /></Protegida> },
      { path: "revisao", element: <Protegida papeis={["professor"]}><Revisao /></Protegida> },
      { path: "usuarios", element: <Protegida papeis={["admin"]}><Usuarios /></Protegida> },
      { path: "auditoria", element: <Protegida papeis={["admin"]}><Auditoria /></Protegida> },
      { path: "pesquisa", element: <Protegida papeis={["pesquisador"]}><Pesquisa /></Protegida> },
      { path: "*", element: <Inicio /> },
    ],
  },
]);

const cliente = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    <QueryClientProvider client={cliente}>
      <ProvedorAutenticacao>
        <RouterProvider router={roteador} />
      </ProvedorAutenticacao>
    </QueryClientProvider>
  </StrictMode>,
);
