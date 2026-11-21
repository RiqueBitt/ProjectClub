// Migração MySQL → MySQL (ex.: Square Cloud → Shard Cloud) sem mysqldump:
// copia TODAS as tabelas do banco de origem pro de destino, em lotes, com
// as checagens de chave estrangeira desligadas na sessão de destino.
//
// Pré-requisito: o ESQUEMA já existe no destino (ex.: `prisma db push` do
// Project Club, que roda no deploy). Se uma tabela não existir no destino,
// ela é criada com o mesmo `SHOW CREATE TABLE` da origem.
//
// Modo `truncate: true` esvazia a tabela no destino antes de copiar
// (migração limpa). `dryRun: true` só conta as linhas.
import mysql from 'mysql2/promise';

const BATCH = 500;

function sslFor(url) {
  // Shard Cloud exige SSL; Square Cloud normalmente não. Aceita certificado
  // do provedor sem precisar de CA local.
  const u = new URL(url);
  const ssl = u.searchParams.get('ssl') || u.searchParams.get('sslmode');
  if (ssl === 'false' || ssl === 'disable') return undefined;
  if (ssl || /shardcloud|shardweb/i.test(u.hostname)) return { rejectUnauthorized: false };
  return undefined;
}

async function connect(url) {
  const u = new URL(url);
  u.search = '';
  return mysql.createConnection({ uri: u.toString(), ssl: sslFor(url), multipleStatements: false, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, connectTimeout: 20000 });
}

export async function listTables(url) {
  const c = await connect(url);
  try {
    const [rows] = await c.query('SHOW FULL TABLES WHERE Table_type = "BASE TABLE"');
    const names = rows.map((r) => Object.values(r)[0]);
    const out = [];
    for (const t of names) {
      const [[{ n }]] = await c.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
      out.push({ table: t, rows: Number(n) });
    }
    return out;
  } finally { await c.end(); }
}

export async function copyDatabase({ sourceUrl, targetUrl, tables, truncate = false, dryRun = false, skip = ['_prisma_migrations'], onProgress }) {
  const src = await connect(sourceUrl);
  const dst = await connect(targetUrl);
  const report = { tables: [], totalRows: 0, errors: [] };
  try {
    const [rows] = await src.query('SHOW FULL TABLES WHERE Table_type = "BASE TABLE"');
    let names = rows.map((r) => Object.values(r)[0]).filter((t) => !skip.includes(t));
    if (tables && tables.length) names = names.filter((t) => tables.includes(t));
    await dst.query('SET FOREIGN_KEY_CHECKS=0');
    await dst.query('SET UNIQUE_CHECKS=0');
    await dst.query("SET SESSION sql_mode='NO_AUTO_VALUE_ON_ZERO'");
    for (const t of names) {
      const entry = { table: t, rows: 0, created: false, truncated: false };
      try {
        const [[{ n }]] = await src.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
        entry.sourceRows = Number(n);
        if (dryRun) { report.tables.push(entry); continue; }
        // Tabela não existe no destino? Cria igual à origem.
        const [exists] = await dst.query('SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [t]);
        if (!exists.length) {
          const [[create]] = await src.query(`SHOW CREATE TABLE \`${t}\``);
          await dst.query(create['Create Table']);
          entry.created = true;
        }
        if (truncate) { await dst.query(`TRUNCATE TABLE \`${t}\``); entry.truncated = true; }
        // Colunas em comum (o destino pode ter colunas novas com default).
        const [srcCols] = await src.query('SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position', [t]);
        const [dstCols] = await dst.query('SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?', [t]);
        const dstSet = new Set(dstCols.map((r) => r.c));
        const cols = srcCols.map((r) => r.c).filter((c) => dstSet.has(c));
        if (!cols.length) { entry.skipped = 'sem colunas em comum'; report.tables.push(entry); continue; }
        const colList = cols.map((c) => `\`${c}\``).join(', ');
        const updates = cols.map((c) => `\`${c}\`=VALUES(\`${c}\`)`).join(', ');
        let offset = 0;
        for (;;) {
          const [batch] = await src.query(`SELECT ${colList} FROM \`${t}\` LIMIT ${BATCH} OFFSET ${offset}`);
          if (!batch.length) break;
          const values = batch.map((r) => cols.map((c) => r[c]));
          // Upsert: se já existir (mesma PK/unique), atualiza — reexecutar é seguro.
          await dst.query(`INSERT INTO \`${t}\` (${colList}) VALUES ? ON DUPLICATE KEY UPDATE ${updates}`, [values]);
          entry.rows += batch.length; offset += batch.length;
          onProgress?.(t, entry.rows, entry.sourceRows);
          if (batch.length < BATCH) break;
        }
        report.totalRows += entry.rows;
      } catch (err) {
        entry.error = err.message;
        report.errors.push({ table: t, error: err.message });
      }
      report.tables.push(entry);
    }
    await dst.query('SET FOREIGN_KEY_CHECKS=1');
    await dst.query('SET UNIQUE_CHECKS=1');
  } finally {
    await Promise.allSettled([src.end(), dst.end()]);
  }
  return report;
}

// Confere origem x destino: contagem de linhas por tabela.
export async function compareDatabases(sourceUrl, targetUrl) {
  const [a, b] = await Promise.all([listTables(sourceUrl), listTables(targetUrl)]);
  const bm = new Map(b.map((x) => [x.table, x.rows]));
  return a.map((x) => ({ table: x.table, source: x.rows, target: bm.has(x.table) ? bm.get(x.table) : null, ok: bm.get(x.table) === x.rows }));
}
