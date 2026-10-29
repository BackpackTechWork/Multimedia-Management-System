const fs = require('fs');
const path = require('path');
const { readMigrationFiles } = require('drizzle-orm/migrator');
const mysql = require('mysql2/promise');
require('dotenv').config();

function normalizeType(value) {
  return String(value).toLowerCase().replace(/\b(int|bigint|tinyint)\(\d+\)/g, '$1').replace(/^boolean$/, 'tinyint');
}

function normalizeDefault(value) {
  if (value == null) return null;
  if (value === true) return '1';
  if (value === false) return '0';
  return String(value).replace(/^'(.*)'$/, '$1').replace(/^current_timestamp\(\)$/i, 'CURRENT_TIMESTAMP');
}

function compareSnapshot(snapshot, columns, indexes) {
  const differences = [];
  for (const table of Object.values(snapshot.tables)) {
    const actualColumns = columns.filter(column => column.TABLE_NAME === table.name);
    // Extra columns/indexes from schema pushes may be preserved; every required
    // definition must still match before its migration can be recorded.
    for (const expected of Object.values(table.columns)) {
      const actual = actualColumns.find(column => column.COLUMN_NAME === expected.name);
      if (!actual || normalizeType(actual.COLUMN_TYPE) !== normalizeType(expected.type)
        || (actual.IS_NULLABLE === 'NO') !== expected.notNull
        || actual.EXTRA.includes('auto_increment') !== expected.autoincrement
        || normalizeDefault(actual.COLUMN_DEFAULT) !== normalizeDefault(expected.default)) {
        differences.push(`${table.name}.${expected.name}: missing or different definition`);
      }
    }
    const expectedIndexes = [
      ...Object.values(table.indexes),
      ...Object.values(table.uniqueConstraints).map(index => ({ ...index, isUnique: true })),
      ...Object.values(table.compositePrimaryKeys).map(index => ({ ...index, name: 'PRIMARY', isUnique: true }))
    ];
    for (const expected of expectedIndexes) {
      const actual = indexes.filter(index => index.TABLE_NAME === table.name && index.INDEX_NAME === expected.name)
        .sort((a, b) => a.SEQ_IN_INDEX - b.SEQ_IN_INDEX);
      if (actual.length !== expected.columns.length
        || actual.some((index, i) => index.COLUMN_NAME !== expected.columns[i] || Boolean(index.NON_UNIQUE) === expected.isUnique || index.SUB_PART != null)) {
        differences.push(`${table.name}.${expected.name}: missing or different index`);
      }
    }
  }
  return differences;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const directory = path.resolve(__dirname, '../drizzle');
  const journal = JSON.parse(fs.readFileSync(path.join(directory, 'meta/_journal.json'), 'utf8'));
  const migrations = readMigrationFiles({ migrationsFolder: directory });
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'drive_clone', connectTimeout: 10000
  });
  try {
    const [history] = await connection.query('SELECT id FROM __drizzle_migrations LIMIT 1')
      .catch(error => { if (error.code === 'ER_NO_SUCH_TABLE') return [[]]; throw error; });
    if (history.length) throw new Error('Migration history is already populated. No changes made.');
    const [columns] = await connection.query('SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()');
    const [indexes] = await connection.query('SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX, SUB_PART FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()');
    // Only baseline a fully synchronized database. An older snapshot can match
    // a partially pushed schema whose later migrations would collide again.
    const matched = journal.entries.at(-1);
    const snapshot = JSON.parse(fs.readFileSync(path.join(directory, `meta/${String(matched.idx).padStart(4, '0')}_snapshot.json`), 'utf8'));
    const differences = compareSnapshot(snapshot, columns, indexes);
    if (differences.length) throw new Error(`The latest migration snapshot does not match the existing schema. No changes made.\n${differences.join('\n')}`);
    console.log(`Existing schema matches ${matched.tag}.`);
    if (!apply) {
      console.log('Check only. Run npm run db:baseline -- --apply to record this baseline, then npm run db:migrate.');
      return;
    }
    await connection.query('CREATE TABLE IF NOT EXISTS __drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)');
    await connection.beginTransaction();
    try {
      const [current] = await connection.query('SELECT id FROM __drizzle_migrations FOR UPDATE');
      if (current.length) throw new Error('Migration history changed during baseline. No entries added.');
      for (const entry of journal.entries.filter(entry => entry.idx <= matched.idx)) {
        await connection.execute('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)', [migrations[entry.idx].hash, entry.when]);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
    console.log(`Recorded ${matched.idx + 1} existing migrations. Application tables and data were not changed.`);
  } finally { await connection.end(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { compareSnapshot };
