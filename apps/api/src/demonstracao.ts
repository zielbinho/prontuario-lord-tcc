// Popula uma implantação de DEMONSTRAÇÃO com os mesmos dados sintéticos do desenvolvimento:
// usuários de teste (senha "lord-dev-2026"), 12 pacientes sintéticos e a coorte de 150 pacientes.
// Uso (no servidor):  docker compose exec api npx tsx src/demonstracao.ts
// Nunca rode em uma instalação com dados reais: cria usuários com senha conhecida.
import { criarApp } from "./app";
import { conectar } from "./banco";
import { carregarCoorte } from "./coorte";
import { carregarConfig } from "./config";
import { semear } from "./semear";

const config = carregarConfig();
const admin = conectar(config.urlBancoAdmin, { max: 2 });
const sql = conectar(config.urlBanco);
const app = await criarApp({ sql, config, log: false });

console.log((await semear(admin, app)) ? "Usuários e pacientes sintéticos criados." : "Já havia usuários: nada a criar.");
const carregados = await carregarCoorte(admin, app, (feitos, total) => {
  if (feitos % 25 === 0 || feitos === total) console.log(`Coorte sintética: ${feitos}/${total} pacientes`);
});
if (carregados) console.log(`Coorte sintética carregada: ${carregados} pacientes.`);

await app.close();
await sql.end();
await admin.end();
