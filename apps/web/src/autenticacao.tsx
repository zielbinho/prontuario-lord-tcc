import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { api, definirAoPerderSessao, ErroApi, type Usuario } from "./api";

interface ContextoAutenticacao {
  usuario: Usuario | null;
  carregando: boolean;
  entrar: (email: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
}

const Contexto = createContext<ContextoAutenticacao | null>(null);
const CHAVE_SESSAO = ["eu"];

/**
 * Troca o usuário da sessão e descarta os dados em cache do usuário anterior.
 * A consulta da sessão é preservada (não usar clear()): ela tem um observador ativo
 * no provedor, que deixaria de receber atualizações se fosse removida.
 */
function trocarUsuario(cliente: QueryClient, usuario: Usuario | null) {
  cliente.removeQueries({ predicate: (q) => q.queryKey[0] !== CHAVE_SESSAO[0] });
  cliente.setQueryData(CHAVE_SESSAO, usuario);
}

export function ProvedorAutenticacao({ children }: { children: ReactNode }) {
  const cliente = useQueryClient();
  const consulta = useQuery({
    queryKey: CHAVE_SESSAO,
    queryFn: () => api.get<Usuario>("/auth/eu").catch((e) => (e instanceof ErroApi && e.status === 401 ? null : Promise.reject(e))),
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    // sessão expirada no meio do uso: volta para o login.
    // Sem usuário logado (ex.: a própria verificação inicial de sessão) não há o que fazer.
    definirAoPerderSessao(() => {
      if (cliente.getQueryData(CHAVE_SESSAO)) trocarUsuario(cliente, null);
    });
  }, [cliente]);

  const valor: ContextoAutenticacao = {
    usuario: consulta.data ?? null,
    carregando: consulta.isPending,
    entrar: async (email, senha) => {
      trocarUsuario(cliente, await api.post<Usuario>("/auth/login", { email, senha }));
    },
    sair: async () => {
      await api.post("/auth/logout").catch(() => {});
      trocarUsuario(cliente, null);
    },
  };
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useAutenticacao(): ContextoAutenticacao {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useAutenticacao fora do ProvedorAutenticacao");
  return ctx;
}

/** Usuário autenticado; use apenas dentro de rotas protegidas. */
export function useUsuario(): Usuario {
  const { usuario } = useAutenticacao();
  if (!usuario) throw new Error("rota protegida sem usuário");
  return usuario;
}
