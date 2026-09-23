import { beforeAll, describe, expect, it } from "vitest";
import { type UsuarioTeste, chamar, criarUsuario, pacienteExemplo, usarContexto } from "./ajuda";

const ctx = usarContexto();
let aluno: UsuarioTeste;

beforeAll(async () => {
  aluno = await criarUsuario(ctx, "aluno");
});

describe("pacientes", () => {
  it("cadastra e devolve os dados pessoais decifrados para quem tem acesso", async () => {
    const dados = pacienteExemplo();
    const r = await chamar(ctx, aluno, "POST", "/pacientes", dados);
    expect(r.status).toBe(201);
    expect(r.corpo).toMatchObject({ nome: dados.nome, cpf: dados.cpf, telefone: dados.telefone, endereco: dados.endereco });

    const lido = await chamar(ctx, aluno, "GET", `/pacientes/${r.corpo.id}`);
    expect(lido.corpo).toMatchObject({ cpf: dados.cpf, data_nascimento: "1988-03-14", consentimentos: [], tratamentos: [] });
  });

  it("CPF, RG, telefone e endereço ficam cifrados no banco", async () => {
    const dados = pacienteExemplo();
    const { id } = (await chamar(ctx, aluno, "POST", "/pacientes", dados)).corpo;
    // procura o texto original, byte a byte, dentro do valor gravado
    const [bruto] = await ctx.admin`
      select position(convert_to(${dados.cpf}, 'UTF8') in cpf_cifrado) as cpf,
             position(convert_to('Fictícia', 'UTF8') in endereco_cifrado) as endereco,
             position(convert_to(${dados.telefone}, 'UTF8') in telefone_cifrado) as telefone
      from paciente where id = ${id}`;
    expect(bruto).toEqual({ cpf: 0, endereco: 0, telefone: 0 });
    // sem a chave, não há como decifrar
    await expect(ctx.admin`select pgp_sym_decrypt(cpf_cifrado, 'chave-errada') from paciente where id = ${id}`)
      .rejects.toThrow(/Wrong key/);
  });

  it("busca por CPF exato pelo índice HMAC, por nome e por número de prontuário", async () => {
    const dados = pacienteExemplo();
    const { id } = (await chamar(ctx, aluno, "POST", "/pacientes", dados)).corpo;
    const cpfFormatado = `${dados.cpf.slice(0, 3)}.${dados.cpf.slice(3, 6)}.${dados.cpf.slice(6, 9)}-${dados.cpf.slice(9)}`;
    for (const busca of [cpfFormatado, dados.nome.slice(-6).toLowerCase(), dados.numero_prontuario]) {
      const r = await chamar(ctx, aluno, "GET", `/pacientes?busca=${encodeURIComponent(busca)}`);
      expect(r.corpo.map((p: { id: string }) => p.id), busca).toEqual([id]);
    }
    // a listagem nunca traz dados pessoais cifrados
    const lista = await chamar(ctx, aluno, "GET", "/pacientes");
    expect(Object.keys(lista.corpo[0]).sort()).toEqual(["data_nascimento", "id", "nome", "numero_prontuario", "sexo"]);
  });

  it("rejeita CPF duplicado e dados fora do esquema", async () => {
    const dados = pacienteExemplo();
    expect((await chamar(ctx, aluno, "POST", "/pacientes", dados)).status).toBe(201);
    expect((await chamar(ctx, aluno, "POST", "/pacientes", { ...pacienteExemplo(), cpf: dados.cpf })).status).toBe(409);

    const invalido = await chamar(ctx, aluno, "POST", "/pacientes", { ...pacienteExemplo(), cpf: "123.456.789-00", tipo_sanguineo: "O" });
    expect(invalido.status).toBe(400);
    expect(invalido.corpo.detalhes.length).toBeGreaterThanOrEqual(2);
  });

  it("registra consentimentos e tratamentos, rejeitando categorias fora da lista", async () => {
    const { id } = (await chamar(ctx, aluno, "POST", "/pacientes", pacienteExemplo())).corpo;
    expect((await chamar(ctx, aluno, "POST", `/pacientes/${id}/consentimentos`, {
      tipo: "tcle", versao_termo: "LORD-2026", aceito_em: "2026-09-01",
    })).status).toBe(201);
    expect((await chamar(ctx, aluno, "POST", `/pacientes/${id}/tratamentos`, {
      categoria: "placa_oclusal", inicio: "2026-09-10",
    })).status).toBe(201);
    expect((await chamar(ctx, aluno, "POST", `/pacientes/${id}/tratamentos`, {
      categoria: "acupuntura", inicio: "2026-09-10",
    })).status).toBe(400);

    const p = (await chamar(ctx, aluno, "GET", `/pacientes/${id}`)).corpo;
    expect(p.consentimentos).toHaveLength(1);
    expect(p.tratamentos).toMatchObject([{ categoria: "placa_oclusal", inicio: "2026-09-10" }]);
  });

  it("audita criação e leitura, sem copiar dados pessoais para a auditoria", async () => {
    const dados = pacienteExemplo();
    const { id } = (await chamar(ctx, aluno, "POST", "/pacientes", dados)).corpo;
    await chamar(ctx, aluno, "GET", `/pacientes/${id}`);
    const eventos = await ctx.admin`select acao, detalhes::text from auditoria where entidade_id = ${id} order by id`;
    expect(eventos.map((e) => e.acao)).toEqual(["criar_paciente", "ler_paciente"]);
    expect(eventos.map((e) => e.detalhes).join()).not.toContain(dados.cpf);
  });
});
