const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compareSnapshot } = require('../scripts/baseline-db');

const snapshot = { tables: { example: {
  name: 'example', columns: {
    id: { name: 'id', type: 'int', notNull: true, autoincrement: true },
    enabled: { name: 'enabled', type: 'boolean', notNull: true, autoincrement: false, default: true }
  }, indexes: { enabled_idx: { name: 'enabled_idx', columns: ['enabled'], isUnique: true } },
  uniqueConstraints: {}, compositePrimaryKeys: { example_id: { name: 'example_id', columns: ['id'] } }
} } };
const columns = [
  { TABLE_NAME: 'example', COLUMN_NAME: 'id', COLUMN_TYPE: 'int(11)', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null, EXTRA: 'auto_increment' },
  { TABLE_NAME: 'example', COLUMN_NAME: 'enabled', COLUMN_TYPE: 'tinyint(1)', IS_NULLABLE: 'NO', COLUMN_DEFAULT: '1', EXTRA: '' }
];
const indexes = [
  { TABLE_NAME: 'example', INDEX_NAME: 'PRIMARY', COLUMN_NAME: 'id', NON_UNIQUE: 0, SEQ_IN_INDEX: 1, SUB_PART: null },
  { TABLE_NAME: 'example', INDEX_NAME: 'enabled_idx', COLUMN_NAME: 'enabled', NON_UNIQUE: 0, SEQ_IN_INDEX: 1, SUB_PART: null }
];

test('baseline handles MySQL type/default normalization and preserves extra schema fields', () => {
  assert.deepEqual(compareSnapshot(snapshot, [...columns, { TABLE_NAME: 'example', COLUMN_NAME: 'extra' }], indexes), []);
});

test('baseline rejects missing columns, incompatible definitions, and missing indexes', () => {
  assert.ok(compareSnapshot(snapshot, columns.slice(1), indexes).some(error => error.includes('example.id')));
  assert.ok(compareSnapshot(snapshot, columns.map(column => ({ ...column, IS_NULLABLE: 'YES' })), indexes).length);
  assert.ok(compareSnapshot(snapshot, columns, indexes.slice(0, 1)).some(error => error.includes('enabled_idx')));
});

test('baseline rejects nonunique or prefix indexes that cannot enforce a required constraint', () => {
  for (const change of [{ NON_UNIQUE: 1 }, { SUB_PART: 1 }]) {
    const actual = indexes.map(index => index.INDEX_NAME === 'enabled_idx' ? { ...index, ...change } : index);
    assert.ok(compareSnapshot(snapshot, columns, actual).some(error => error.includes('enabled_idx')));
  }
});
