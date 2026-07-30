import assert from 'node:assert/strict';
import { db, id, initDb, now } from '../server/db.js';
import { saveSmartRecordValues } from '../server/smart-record-extras.js';

initDb();
const stamp = now();
const userId = id();
const workspaceId = id();
const tableId = id();
const fieldId = id();
const recordId = id();

db.transaction(() => {
  db.prepare('INSERT INTO users (id,email,name,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(userId, `history-${userId}@example.local`, 'History Test', 'not-used', stamp, stamp);
  db.prepare('INSERT INTO workspaces (id,name,owner_id,created_at,updated_at) VALUES (?,?,?,?,?)')
    .run(workspaceId, 'History Test', userId, stamp, stamp);
  db.prepare('INSERT INTO memberships (workspace_id,user_id,role,created_at) VALUES (?,?,?,?)')
    .run(workspaceId, userId, 'owner', stamp);
  db.prepare('INSERT INTO smart_tables (id,workspace_id,owner_id,name,description,color,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(tableId, workspaceId, userId, 'History', '', '#7c3aed', 1, stamp, stamp);
  db.prepare('INSERT INTO smart_fields (id,table_id,name,type,config_json,position,width,hidden,is_primary,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(fieldId, tableId, '名称', 'text', '{}', 1, 180, 0, 1, stamp, stamp);
  db.prepare('INSERT INTO smart_records (id,table_id,position,task_id,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(recordId, tableId, 1, null, stamp, stamp);
})();

saveSmartRecordValues(recordId, tableId, {[fieldId]: '第一版'}, userId);
saveSmartRecordValues(recordId, tableId, {[fieldId]: '第二版'}, userId);

const current = JSON.parse(db.prepare('SELECT value_json FROM smart_values WHERE record_id=? AND field_id=?').get(recordId, fieldId).value_json);
assert.equal(current, '第二版');
const history = db.prepare('SELECT old_value_json,new_value_json FROM smart_cell_history WHERE record_id=? AND field_id=? ORDER BY created_at,id').all(recordId, fieldId);
assert.equal(history.length, 2);
assert.equal(JSON.parse(history[0].old_value_json), null);
assert.equal(JSON.parse(history[0].new_value_json), '第一版');
assert.equal(JSON.parse(history[1].old_value_json), '第一版');
assert.equal(JSON.parse(history[1].new_value_json), '第二版');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('smart_cell_history','smart_record_comments') ORDER BY name").all();
assert.deepEqual(tables.map(row => row.name), ['smart_cell_history', 'smart_record_comments']);
console.log('smart record extras persistence verified');
db.close();
