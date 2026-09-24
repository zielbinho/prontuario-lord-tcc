import { validar } from "@lord/ficha";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api, ErroApi, type Paciente } from "../api";
import { Botao, Cartao, Entrada, MensagemErro, Rotulo, Selecao } from "../componentes/ui";

type Formulario = Record<string, string>;

const CAMPOS: { nome: string; rotulo: string; tipo?: string; obrigatorio?: boolean; dica?: string; largo?: boolean }[] = [
  { nome: "nome", rotulo: "Nome completo", obrigatorio: true, largo: true },
  { nome: "data_nascimento", rotulo: "Data de nascimento", tipo: "date", obrigatorio: true },
  { nome: "numero_prontuario", rotulo: "Número do prontuário" },
  { nome: "cpf", rotulo: "CPF", dica: "Somente números" },
  { nome: "rg", rotulo: "RG" },
  { nome: "telefone", rotulo: "Telefone", tipo: "tel" },
  { nome: "telefone_recado", rotulo: "Telefone para recado", tipo: "tel" },
  { nome: "estado_civil", rotulo: "Estado civil" },
  { nome: "profissao", rotulo: "Profissão" },
  { nome: "endereco", rotulo: "Endereço residencial", largo: true },
];

/** Converte o formulário para o formato do esquema: textos vazios viram null; CPF só com dígitos. */
export function paraDadosPaciente(f: Formulario) {
  const dados: Record<string, string | null> = {};
  for (const [chave, valor] of Object.entries(f)) {
    const limpo = chave === "cpf" ? valor.replace(/\D/g, "") : valor.trim();
    dados[chave] = limpo === "" ? null : limpo;
  }
  return dados;
}

export default function NovoPaciente() {
  const navegar = useNavigate();
  const cliente = useQueryClient();
  const [form, setForm] = useState<Formulario>({ sexo: "" });
  const [erros, setErros] = useState<Record<string, string>>({});

  const criar = useMutation({
    mutationFn: (dados: unknown) => api.post<Paciente>("/pacientes", dados),
    onSuccess: (p) => {
      cliente.invalidateQueries({ queryKey: ["pacientes"] });
      navegar(`/pacientes/${p.id}`);
    },
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const dados = paraDadosPaciente(form);
    const r = validar("paciente", dados);
    if (!r.valido) {
      setErros(Object.fromEntries(r.erros.map((x) => [x.caminho.replace("/", "") || "geral", x.mensagem])));
      return;
    }
    setErros({});
    criar.mutate(dados);
  };

  const erroApi = criar.error instanceof ErroApi && criar.error.status === 409 ? new Error("Já existe um paciente com este CPF ou número de prontuário.") : criar.error;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/pacientes" className="text-sm text-destaque hover:underline">← Pacientes</Link>
      <h1 className="text-2xl font-semibold">Novo paciente</h1>
      <Cartao>
        <form onSubmit={enviar} className="grid gap-4 sm:grid-cols-2" noValidate>
          {CAMPOS.slice(0, 2).map((c) => campo(c))}
          <div>
            <Rotulo htmlFor="sexo">Sexo</Rotulo>
            <Selecao id="sexo" value={form.sexo} onChange={(e) => setForm({ ...form, sexo: e.target.value })}>
              <option value="">Não informado</option>
              <option value="F">Feminino</option>
              <option value="M">Masculino</option>
            </Selecao>
          </div>
          {CAMPOS.slice(2).map((c) => campo(c))}
          <p className="text-xs text-suave sm:col-span-2">
            CPF, RG, telefones e endereço são gravados criptografados. Confira se o TCLE foi assinado antes do atendimento.
          </p>
          <div className="sm:col-span-2"><MensagemErro erro={erroApi} /></div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Botao variante="fantasma" onClick={() => navegar("/pacientes")}>Cancelar</Botao>
            <Botao type="submit" carregando={criar.isPending}>Cadastrar paciente</Botao>
          </div>
        </form>
      </Cartao>
    </div>
  );

  function campo(c: (typeof CAMPOS)[number]) {
    return (
      <div key={c.nome} className={c.largo ? "sm:col-span-2" : ""}>
        <Rotulo htmlFor={c.nome}>
          {c.rotulo}{c.obrigatorio && <span className="text-perigo"> *</span>}
        </Rotulo>
        <Entrada id={c.nome} type={c.tipo ?? "text"} value={form[c.nome] ?? ""} required={c.obrigatorio}
          aria-invalid={!!erros[c.nome]} placeholder={c.dica}
          onChange={(e) => setForm({ ...form, [c.nome]: e.target.value })}
          className={erros[c.nome] ? "border-perigo" : ""} />
        {erros[c.nome] && <p className="mt-1 text-xs text-perigo">{erros[c.nome]}</p>}
      </div>
    );
  }
}
