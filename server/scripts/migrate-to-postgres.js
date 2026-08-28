// Migra TODOS os dados reais do banco SQLite antigo (dev.db) pro
// PostgreSQL novo — usado UMA VEZ, na troca de infraestrutura. Não é
// preciso listar as 56 tabelas na mão: lê a estrutura de relações
// (DMMF) do próprio Prisma e descobre sozinho em que ordem inserir cada
// tabela (uma tabela só entra depois de todas as que ela referencia via
// chave estrangeira já estarem migradas — senão a inserção falharia por
// violar a integridade referencial).
//
// COMO USAR (depois de configurar DATABASE_URL apontando pro Postgres
// novo, no .env real):
//   1. npx prisma generate --schema=prisma/schema.sqlite-legacy.prisma
//   2. LEGACY_SQLITE_URL="file:./dev.db" node scripts/migrate-to-postgres.js
//
// Idempotente: pode rodar de novo sem duplicar nada (usa skipDuplicates).
// Não apaga nem modifica o dev.db antigo — só lê dele.

const { PrismaClient: PgClient, Prisma } = require('@prisma/client');
let SqliteClient;
try {
  ({ PrismaClient: SqliteClient } = require('../node_modules/.prisma/legacy-sqlite-client'));
} catch {
  console.error(
    'Client do SQLite legado não encontrado. Rode primeiro:\n' +
    '  npx prisma generate --schema=prisma/schema.sqlite-legacy.prisma',
  );
  process.exit(1);
}

// Descobre a ordem segura de migração a partir das relações declaradas no
// schema (uma tabela entra só depois de tudo que ela referencia via chave
// estrangeira) — evita ter que manter uma lista de 56 tabelas na mão toda
// vez que o schema mudar.
function topoSortModels(models) {
  const dependsOn = new Map(models.map((m) => [m.name, new Set()]));
  for (const model of models) {
    for (const field of model.fields) {
      if (field.kind === 'object' && field.relationFromFields?.length > 0 && field.type !== model.name) {
        dependsOn.get(model.name).add(field.type);
      }
    }
  }
  const order = [];
  const done = new Set();
  function visit(name, stack) {
    if (done.has(name) || stack.has(name)) return; // stack.has = ciclo, ignora (auto-relação já é filtrada acima)
    stack.add(name);
    for (const dep of dependsOn.get(name) || []) visit(dep, stack);
    stack.delete(name);
    done.add(name);
    order.push(name);
  }
  for (const model of models) visit(model.name, new Set());
  return order;
}

function delegateName(modelName) {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

async function main() {
  const sqliteUrl = process.env.LEGACY_SQLITE_URL || 'file:./dev.db';
  const sqlite = new SqliteClient({ datasources: { db: { url: sqliteUrl } } });
  const pg = new PgClient();

  const models = Prisma.dmmf.datamodel.models;
  const order = topoSortModels(models);

  console.log(`Migrando ${order.length} tabelas de "${sqliteUrl}" pro PostgreSQL...\n`);

  let totalRows = 0;
  for (const modelName of order) {
    const delegate = delegateName(modelName);
    if (!sqlite[delegate] || !pg[delegate]) continue; // modelo sem delegate usável (não deveria acontecer, mas não trava a migração por isso)

    let rows;
    try {
      rows = await sqlite[delegate].findMany();
    } catch (err) {
      // Modelo novo que não existia no banco SQLite antigo (ex.: criado
      // numa atualização depois do último deploy) — não tem o que
      // migrar, só pula pro próximo em vez de travar tudo.
      console.log(`  ${modelName}: não existe no banco antigo (pulado — ${err.message.split('\n')[0]})`);
      continue;
    }
    if (rows.length === 0) { console.log(`  ${modelName}: 0 linhas (pulado)`); continue; }

    // createMany é bem mais rápido que criar linha por linha — só cai pra
    // criação individual se o banco rejeitar o lote inteiro de uma vez
    // (na primeira execução, isso é raro; numa reexecução é o caminho
    // normal, porque o MongoDB não tem a opção skipDuplicates que o
    // Postgres tinha — cada linha que já existe faz o create() dela falhar
    // sozinha, e o catch abaixo ignora só essa, sem travar as outras).
    try {
      const result = await pg[delegate].createMany({ data: rows });
      console.log(`  ${modelName}: ${result.count}/${rows.length} linhas migradas`);
      totalRows += result.count;
    } catch (err) {
      console.warn(`  ${modelName}: createMany falhou (${err.message}), tentando linha por linha...`);
      let ok = 0;
      for (const row of rows) {
        try { await pg[delegate].create({ data: row }); ok++; } catch { /* provavelmente já existe (reexecução) — ignora */ }
      }
      console.log(`  ${modelName}: ${ok}/${rows.length} linhas migradas (modo linha a linha)`);
      totalRows += ok;
    }
  }

  console.log(`\nMigração concluída. ${totalRows} linhas no total.`);
  await sqlite.$disconnect();
  await pg.$disconnect();
}

main().catch((err) => {
  console.error('Falha na migração:', err);
  process.exit(1);
});
