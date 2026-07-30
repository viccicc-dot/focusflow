import { db, id, now } from './db.js';

let schemaReady = false;

function clean(value, max = 10000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function encode(value) {
  return JSON.stringify(value === undefined ? null : value);
}

function ensureSchema() {
  if (schemaReady) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS smart_cell_history (
      id TEXT PRIMARY KEY,
      record_id TEXT NOT NULL REFERENCES smart_records(id) ON DELETE CASCADE,
      field_id TEXT NOT NULL REFERENCES smart_fields(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      old_value_json TEXT NOT NULL DEFAULT 'null',
      new_value_json TEXT NOT NULL DEFAULT 'null',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS smart_record_comments (
      id TEXT PRIMARY KEY,
      record_id TEXT NOT NULL REFERENCES smart_records(id) ON DELETE CASCADE,
      field_id TEXT REFERENCES smart_fields(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_smart_cell_history_record ON smart_cell_history(record_id, field_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_smart_record_comments_record ON smart_record_comments(record_id, created_at);
  `);
  schemaReady = true;
}

function recordForWorkspace(recordId, workspaceId) {
  return db.prepare(`
    SELECT r.* FROM smart_records r
    JOIN smart_tables t ON t.id = r.table_id
    WHERE r.id = ? AND t.workspace_id = ?
  `).get(recordId, workspaceId);
}

function fieldBelongsToTable(fieldId, tableId) {
  return db.prepare('SELECT id FROM smart_fields WHERE id=? AND table_id=?').get(fieldId, tableId);
}

export function saveSmartRecordValues(recordId, tableId, values, userId = null) {
  ensureSchema();
  if (!values || typeof values !== 'object' || Array.isArray(values)) return;
  const allowedFields = new Set(db.prepare('SELECT id FROM smart_fields WHERE table_id = ?').all(tableId).map(row => row.id));
  const getCurrent = db.prepare('SELECT value_json FROM smart_values WHERE record_id=? AND field_id=?');
  const upsert = db.prepare(`
    INSERT INTO smart_values (record_id, field_id, value_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(record_id, field_id) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `);
  const insertHistory = db.prepare(`
    INSERT INTO smart_cell_history (id,record_id,field_id,user_id,old_value_json,new_value_json,created_at)
    VALUES (?,?,?,?,?,?,?)
  `);
  for (const [fieldId, value] of Object.entries(values)) {
    if (!allowedFields.has(fieldId)) continue;
    const current = getCurrent.get(recordId, fieldId);
    const oldJson = current?.value_json ?? 'null';
    const nextJson = encode(value);
    if (oldJson === nextJson) continue;
    const timestamp = now();
    upsert.run(recordId, fieldId, nextJson, timestamp);
    insertHistory.run(id(), recordId, fieldId, userId, oldJson, nextJson, timestamp);
  }
}

export function registerSmartRecordExtraRoutes(app, auth) {
  ensureSchema();

  app.get('/api/smart-records/:id/history', auth, (req, res) => {
    const record = recordForWorkspace(req.params.id, req.workspace.id);
    if (!record) return res.status(404).json({error: '记录不存在'});
    const fieldId = clean(req.query.field_id, 100);
    if (fieldId && !fieldBelongsToTable(fieldId, record.table_id)) return res.status(400).json({error: '字段无效'});
    const params = fieldId ? [record.id, fieldId] : [record.id];
    const where = fieldId ? 'h.record_id=? AND h.field_id=?' : 'h.record_id=?';
    const history = db.prepare(`
      SELECT h.*,f.name AS field_name,u.name AS user_name,u.email AS user_email
      FROM smart_cell_history h
      JOIN smart_fields f ON f.id=h.field_id
      LEFT JOIN users u ON u.id=h.user_id
      WHERE ${where}
      ORDER BY h.created_at DESC
      LIMIT 300
    `).all(...params).map(item => ({
      ...item,
      old_value: parseJson(item.old_value_json, null),
      new_value: parseJson(item.new_value_json, null)
    }));
    res.json({history});
  });

  app.post('/api/smart-records/:recordId/history/:historyId/restore', auth, (req, res) => {
    const record = recordForWorkspace(req.params.recordId, req.workspace.id);
    if (!record) return res.status(404).json({error: '记录不存在'});
    const item = db.prepare(`
      SELECT h.* FROM smart_cell_history h
      JOIN smart_records r ON r.id=h.record_id
      WHERE h.id=? AND h.record_id=? AND r.table_id=?
    `).get(req.params.historyId, record.id, record.table_id);
    if (!item) return res.status(404).json({error: '历史记录不存在'});
    saveSmartRecordValues(record.id, record.table_id, {[item.field_id]: parseJson(item.old_value_json, null)}, req.user.id);
    db.prepare('UPDATE smart_records SET updated_at=? WHERE id=?').run(now(), record.id);
    res.json({ok: true, field_id: item.field_id, value: parseJson(item.old_value_json, null)});
  });

  app.get('/api/smart-records/:id/comments', auth, (req, res) => {
    const record = recordForWorkspace(req.params.id, req.workspace.id);
    if (!record) return res.status(404).json({error: '记录不存在'});
    const comments = db.prepare(`
      SELECT c.*,f.name AS field_name,u.name AS user_name,u.email AS user_email
      FROM smart_record_comments c
      LEFT JOIN smart_fields f ON f.id=c.field_id
      JOIN users u ON u.id=c.user_id
      WHERE c.record_id=?
      ORDER BY c.created_at
    `).all(record.id);
    res.json({comments});
  });

  app.post('/api/smart-records/:id/comments', auth, (req, res) => {
    const record = recordForWorkspace(req.params.id, req.workspace.id);
    if (!record) return res.status(404).json({error: '记录不存在'});
    const body = clean(req.body.body, 10000);
    if (!body) return res.status(400).json({error: '评论内容不能为空'});
    const fieldId = clean(req.body.field_id, 100) || null;
    if (fieldId && !fieldBelongsToTable(fieldId, record.table_id)) return res.status(400).json({error: '字段无效'});
    const comment = {id: id(), record_id: record.id, field_id: fieldId, user_id: req.user.id, body, created_at: now(), updated_at: now()};
    db.prepare(`INSERT INTO smart_record_comments (id,record_id,field_id,user_id,body,created_at,updated_at)
      VALUES (@id,@record_id,@field_id,@user_id,@body,@created_at,@updated_at)`).run(comment);
    res.status(201).json({comment: {...comment, user_name: req.user.name, user_email: req.user.email}});
  });
}
