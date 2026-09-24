import { useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { useAutenticacao } from "../autenticacao";
import { Botao, Entrada, MensagemErro, Rotulo } from "../componentes/ui";

export default function Login() {
  const { usuario, entrar } = useAutenticacao();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<unknown>(null);
  const [enviando, setEnviando] = useState(false);

  if (usuario) return <Navigate to="/" replace />;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      await entrar(email, senha);
    } catch (err) {
      setErro(err);
      setSenha("");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-marca-600 text-lg font-bold text-white">L</div>
          <h1 className="text-xl font-semibold">Prontuário LORD-UEPG</h1>
          <p className="text-sm text-suave">Liga Odontológica de Reabilitação e DTM</p>
        </div>
        <form onSubmit={enviar} className="space-y-4 rounded-xl border border-borda bg-superficie p-6">
          <div>
            <Rotulo htmlFor="email">E-mail</Rotulo>
            <Entrada id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </div>
          <div>
            <Rotulo htmlFor="senha">Senha</Rotulo>
            <Entrada id="senha" type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
          </div>
          <MensagemErro erro={erro} />
          <Botao type="submit" className="w-full" carregando={enviando}>Entrar</Botao>
        </form>
        <p className="mt-4 text-center text-xs text-suave">
          Acesso restrito a membros e professores da LORD. Todos os acessos são registrados.
        </p>
      </div>
    </main>
  );
}
