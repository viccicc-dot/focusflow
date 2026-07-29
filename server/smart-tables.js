import { db, id, now } from './db.js';

const FIELD_TYPES = new Set([
  'text', 'long_text', 'number', 'select', 'multi_select', 'status',
  'date', 'datetime', 'checkbox', 'url', 'person'
]);
const VIEW_TYPES = new Set(['grid', 'calendar']);

function clean(value, max = 5000) {
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
function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}
function tableForWorkspace(tableId, workspaceId) {
  return db.prepare('SELECT * FROM smart_tables WHERE id = ? AND workspace_id = ?').get(tableId, workspaceId);
}
function fieldForWorkspace(fieldId, workspaceId) {
  return db.prepare(`
    SELECT f.* FROM smart_fields f
    JOIN smart_tables t ON t.id = f.table_id
    WHERE f.id = ? AND t.workspace_id = ?
  `).get(fieldId, workspaceId);
}
function recordForWorkspace(recordId, workspaceId) {
  return db.prepare(`
    SELECT r.* FROM smart_records r
    JOIN smart_tables t ON t.id = r.table_id
    WHERE r.id = ? AND t.workspace_id = ?
  `).get(recordId, workspaceId);
}
function viewForWorkspace(viewId, workspaceId) {
  return db.prepare(`
    SELECT v.* FROM smart_views v
    JOIN smart_tables t ON t.id = v.table_id
    WHERE v.id = ? AND t.workspace_id = ?
  `).get(viewId, workspaceId);
}
function normalizeField(row) {
  return { ...row, config: parseJson(row.config_json, {}) || {} };
}
function normalizeView(row) {
  return { ...row, config: parseJson(row.config_json, {}) || {} };
}
function normalizeRecord(row, valuesByRecord = new Map()) {
  return { ...row, values: valuesByRecord.get(row.id) || {} };
}

export function smartTableSummaries(workspaceId) {
  return db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM smart_records r WHERE r.table_id = t.id) AS record_count,
      (SELECT COUNT(*) FROM smart_fields f WHERE f.table_id = t.id) AS field_count
    FROM smart_tables t
    WHERE t.workspace_id = ?
    ORDER BY t.position, t.created_at
  `).all(workspaceId);
}

export function smartTableBundle(tableId, workspaceId) {
  const table = tableForWorkspace(tableId, workspaceId);
  if (!table) return null;
  const fields = db.prepare('SELECT * FROM smart_fields WHERE table_id = ? ORDER BY position, created_at').all(table.id).map(normalizeField);
  const views = db.prepare('SELECT * FROM smart_views WHERE table_id = ? ORDER BY position, created_at').all(table.id).map(normalizeView);
  const records = db.prepare('SELECT * FROM smart_records WHERE table_id = ? ORDER BY position, created_at').all(table.id);
  const values = db.prepare(`
    SELECT v.* FROM smart_values v
    JOIN smart_records r ON r.id = v.record_id
    WHERE r.table_id = ?
  `).all(table.id);
  const valuesByRecord = new Map();
  for (const row of values) {
    if (!valuesByRecord.has(row.record_id)) valuesByRecord.set(row.record_id, {});
    valuesByRecord.get(row.record_id)[row.field_id] = parseJson(row.value_json, null);
  }
  return { table, fields, views, records: records.map(row => normalizeRecord(row, valuesByRecord)) };
}

function saveRecordValues(recordId, tableId, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return;
  const allowedFields = new Set(db.prepare('SELECT id FROM smart_fields WHERE table_id = ?').all(tableId).map(row => row.id));
  const upsert = db.prepare(`
    INSERT INTO smart_values (record_id, field_id, value_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(record_id, field_id) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `);
  for (const [fieldId, value] of Object.entries(values)) {
    if (!allowedFields.has(fieldId)) continue;
    upsert.run(recordId, fieldId, encode(value), now());
  }
}

function createDefaultTable(workspaceId, userId, name, color) {
  const tableId = id();
  const createdAt = now();
  const nameFieldId = id();
  const statusFieldId = id();
  const dateFieldId = id();
  const notesFieldId = id();
  const typeFieldId = id();
  const gridViewId = id();
  const calendarViewId = id();
  const statusOptions = [
    { id: 'pending', label: '待处理', color: '#3b82f6' },
    { id: 'doing', label: '进行中', color: '#f59e0b' },
    { id: 'done', label: '已完成', color: '#8b5cf6' }
  ];
  const typeOptions = [
    { id: 'normal', label: '普通', color: '#64748b' },
    { id: 'important', label: '重要', color: '#7c3aed' },
    { id: 'risk', label: '风险', color: '#ec4899' }
  ];
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO smart_tables (id,workspace_id,owner_id,name,description,color,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(tableId, workspaceId, userId, name, '', color, Date.now(), createdAt, createdAt);
    const insertField = db.prepare(`INSERT INTO smart_fields
      (id,table_id,name,type,config_json,position,width,hidden,is_primary,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    insertField.run(nameFieldId, tableId, '名称', 'text', '{}', 1024, 300, 0, 1, createdAt, createdAt);
    insertField.run(statusFieldId, tableId, '状态', 'status', encode({ options: statusOptions }), 2048, 140, 0, 0, createdAt, createdAt);
    insertField.run(dateFieldId, tableId, '日期', 'date', '{}', 3072, 150, 0, 0, createdAt, createdAt);
    insertField.run(notesFieldId, tableId, '其他信息', 'long_text', '{}', 4096, 320, 0, 0, createdAt, createdAt);
    insertField.run(typeFieldId, tableId, '类型', 'select', encode({ options: typeOptions }), 5120, 140, 0, 0, createdAt, createdAt);
    const insertView = db.prepare(`INSERT INTO smart_views
      (id,table_id,name,type,config_json,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`);
    insertView.run(gridViewId, tableId, '表格', 'grid', encode({ hidden_field_ids: [] }), 1024, createdAt, createdAt);
    insertView.run(calendarViewId, tableId, '日历', 'calendar', encode({ date_field_id: dateFieldId, color_field_id: statusFieldId }), 2048, createdAt, createdAt);
  });
  tx();
  return smartTableBundle(tableId, workspaceId);
}

function titleForRecord(bundle, record) {
  const primary = bundle.fields.find(field => field.is_primary) || bundle.fields[0];
  const value = primary ? record.values[primary.id] : null;
  return clean(String(value || ''), 300) || '未命名记录';
}
function dateForRecord(bundle, record) {
  const calendarView = bundle.views.find(view => view.type === 'calendar');
  const configured = calendarView?.config?.date_field_id;
  const field = bundle.fields.find(item => item.id === configured)
    || bundle.fields.find(item => item.type === 'date' || item.type === 'datetime');
  const raw = field ? record.values[field.id] : null;
  return raw ? String(raw).slice(0, 10) : null;
}
function colorForRecord(bundle, record) {
  const calendarView = bundle.views.find(view => view.type === 'calendar');
  const configured = calendarView?.config?.color_field_id;
  const field = bundle.fields.find(item => item.id === configured);
  if (!field) return bundle.table.color || '#7c3aed';
  const raw = record.values[field.id];
  const option = field.config?.options?.find(item => item.id === raw || item.label === raw);
  return option?.color || bundle.table.color || '#7c3aed';
}

export function registerSmartTableRoutes(app, auth) {
  app.get('/api/smart-tables', auth, (req, res) => {
    res.json({ tables: smartTableSummaries(req.workspace.id) });
  });

  app.post('/api/smart-tables', auth, (req, res) => {
    const name = clean(req.body.name, 120);
    if (!name) return res.status(400).json({ error: '表格名称不能为空' });
    const color = clean(req.body.color, 20) || '#7c3aed';
    res.status(201).json(createDefaultTable(req.workspace.id, req.user.id, name, color));
  });

  app.get('/api/smart-tables/:id', auth, (req, res) => {
    const bundle = smartTableBundle(req.params.id, req.workspace.id);
    if (!bundle) return res.status(404).json({ error: '智能表格不存在' });
    res.json(bundle);
  });

  app.patch('/api/smart-tables/:id', auth, (req, res) => {
    const table = tableForWorkspace(req.params.id, req.workspace.id);
    if (!table) return res.status(404).json({ error: '智能表格不存在' });
    const name = req.body.name === undefined ? table.name : clean(req.body.name, 120) || table.name;
    const description = req.body.description === undefined ? table.description : clean(req.body.description, 2000);
    const color = req.body.color === undefined ? table.color : clean(req.body.color, 20) || table.color;
    const position = req.body.position === undefined ? table.position : Number(req.body.position) || table.position;
    db.prepare('UPDATE smart_tables SET name=?,description=?,color=?,position=?,updated_at=? WHERE id=?')
      .run(name, description, color, position, now(), table.id);
    res.json({ table: tableForWorkspace(table.id, req.workspace.id) });
  });

  app.delete('/api/smart-tables/:id', auth, (req, res) => {
    const table = tableForWorkspace(req.params.id, req.workspace.id);
    if (!table) return res.status(404).json({ error: '智能表格不存在' });
    db.prepare('DELETE FROM smart_tables WHERE id = ?').run(table.id);
    res.json({ ok: true });
  });

  app.post('/api/smart-tables/:tableId/fields', auth, (req, res) => {
    const table = tableForWorkspace(req.params.tableId, req.workspace.id);
    if (!table) return res.status(404).json({ error: '智能表格不存在' });
    const name = clean(req.body.name, 120);
    const type = FIELD_TYPES.has(req.body.type) ? req.body.type : 'text';
    if (!name) return res.status(400).json({ error: '字段名称不能为空' });
    const field = {
      id: id(), table_id: table.id, name, type,
      config_json: encode(req.body.config && typeof req.body.config === 'object' ? req.body.config : {}),
      position: Number(req.body.position) || Date.now(),
      width: clampNumber(req.body.width, 90, 600, 180), hidden: req.body.hidden ? 1 : 0,
      is_primary: 0, created_at: now(), updated_at: now()
    };
    db.prepare(`INSERT INTO smart_fields
      (id,table_id,name,type,config_json,position,width,hidden,is_primary,created_at,updated_at)
      VALUES (@id,@table_id,@name,@type,@config_json,@position,@width,@hidden,@is_primary,@created_at,@updated_at)`).run(field);
    res.status(201).json({ field: normalizeField(field) });
  });

  app.patch('/api/smart-fields/:id', auth, (req, res) => {
    const field = fieldForWorkspace(req.params.id, req.workspace.id);
    if (!field) return res.status(404).json({ error: '字段不存在' });
    const name = req.body.name === undefined ? field.name : clean(req.body.name, 120) || field.name;
    const type = req.body.type === undefined ? field.type : (FIELD_TYPES.has(req.body.type) ? req.body.type : field.type);
    const config = req.body.config === undefined ? parseJson(field.config_json, {}) : req.body.config;
    const position = req.body.position === undefined ? field.position : Number(req.body.position) || field.position;
    const width = req.body.width === undefined ? field.width : clampNumber(req.body.width, 90, 600, field.width);
    const hidden = req.body.hidden === undefined ? field.hidden : (req.body.hidden ? 1 : 0);
    db.prepare(`UPDATE smart_fields SET name=?,type=?,config_json=?,position=?,width=?,hidden=?,updated_at=? WHERE id=?`)
      .run(name, type, encode(config || {}), position, width, hidden, now(), field.id);
    res.json({ field: normalizeField(fieldForWorkspace(field.id, req.workspace.id)) });
  });

  app.delete('/api/smart-fields/:id', auth, (req, res) => {
    const field = fieldForWorkspace(req.params.id, req.workspace.id);
    if (!field) return res.status(404).json({ error: '字段不存在' });
    if (field.is_primary) return res.status(400).json({ error: '主字段不能删除' });
    db.prepare('DELETE FROM smart_fields WHERE id = ?').run(field.id);
    res.json({ ok: true });
  });

  app.post('/api/smart-tables/:tableId/records', auth, (req, res) => {
    const table = tableForWorkspace(req.params.tableId, req.workspace.id);
    if (!table) return res.status(404).json({ error: '智能表格不存在' });
    const record = {
      id: id(), table_id: table.id, position: Number(req.body.position) || Date.now(),
      task_id: null, created_at: now(), updated_at: now()
    };
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO smart_records (id,table_id,position,task_id,created_at,updated_at)
        VALUES (@id,@table_id,@position,@task_id,@created_at,@updated_at)`).run(record);
      saveRecordValues(record.id, table.id, req.body.values || {});
    });
    tx();
    const bundle = smartTableBundle(table.id, req.workspace.id);
    res.status(201).json({ record: bundle.records.find(item => item.id === record.id) });
  });

  app.patch('/api/smart-records/:id', auth, (req, res) => {
    const record = recordForWorkspace(req.params.id, req.workspace.id);
    if (!record) return res.status(404).json({ error: '记录不存在' });
    const position = req.body.position === undefined ? record.position : Number(req.body.position) || record.position;
    const taskId = req.body.task_id === undefined ? record.task_id : req.body.task_id || null;
    const tx = db.transaction(() => {
      db.prepare('UPDATE smart_records SET position=?,task_id=?,updated_at=? WHERE id=?').run(position, taskId, now(), record.id);
      saveRecordValues(record.id, record.table_id, req.body.values || {});
    });
    tx();
    const bundle = smartTableBundle(record.table_id, req.workspace.id);
    res.json({ record: bundle.records.find(item => item.id === record.id) });
  });

  app.delete('/api/smart-records/:id', auth, (req, res) => {
    const record = recordForWorkspace(req.params.id, req.workspace.id);
    if (!record) return res.status(404).json({ error: '记录不存在' });
    db.prepare('DELETE FROM smart_records WHERE id = ?').run(record.id);
    res.json({ ok: true });
  });

  app.post('/api/smart-tables/:tableId/views', auth, (req, res) => {
    const table = tableForWorkspace(req.params.tableId, req.workspace.id);
    if (!table) return res.status(404).json({ error: '智能表格不存在' });
    const type = VIEW_TYPES.has(req.body.type) ? req.body.type : 'grid';
    const view = {
      id: id(), table_id: table.id, name: clean(req.body.name, 120) || (type === 'calendar' ? '日历' : '表格'),
      type, config_json: encode(req.body.config || {}), position: Number(req.body.position) || Date.now(),
      created_at: now(), updated_at: now()
    };
    db.prepare(`INSERT INTO smart_views (id,table_id,name,type,config_json,position,created_at,updated_at)
      VALUES (@id,@table_id,@name,@type,@config_json,@position,@created_at,@updated_at)`).run(view);
    res.status(201).json({ view: normalizeView(view) });
  });

  app.patch('/api/smart-views/:id', auth, (req, res) => {
    const view = viewForWorkspace(req.params.id, req.workspace.id);
    if (!view) return res.status(404).json({ error: '视图不存在' });
    const name = req.body.name === undefined ? view.name : clean(req.body.name, 120) || view.name;
    const type = req.body.type === undefined ? view.type : (VIEW_TYPES.has(req.body.type) ? req.body.type : view.type);
    const config = req.body.config === undefined ? parseJson(view.config_json, {}) : req.body.config;
    const position = req.body.position === undefined ? view.position : Number(req.body.position) || view.position;
    db.prepare('UPDATE smart_views SET name=?,type=?,config_json=?,position=?,updated_at=? WHERE id=?')
      .run(name, type, encode(config || {}), position, now(), view.id);
    res.json({ view: normalizeView(viewForWorkspace(view.id, req.workspace.id)) });
  });

  app.delete('/api/smart-views/:id', auth, (req, res) => {
    const view = viewForWorkspace(req.params.id, req.workspace.id);
    if (!view) return res.status(404).json({ error: '视图不存在' });
    const count = db.prepare('SELECT COUNT(*) AS count FROM smart_views WHERE table_id = ?').get(view.table_id).count;
    if (count <= 1) return res.status(400).json({ error: '至少保留一个视图' });
    db.prepare('DELETE FROM smart_views WHERE id = ?').run(view.id);
    res.json({ ok: true });
  });

  app.post('/api/smart-records/:id/to-task', auth, (req, res) => {
    const record = recordForWorkspace(req.params.id, req.workspace.id);
    if (!record) return res.status(404).json({ error: '记录不存在' });
    if (record.task_id) {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?').get(record.task_id, req.workspace.id);
      if (task) return res.json({ task, linked: true });
    }
    const bundle = smartTableBundle(record.table_id, req.workspace.id);
    const normalizedRecord = bundle.records.find(item => item.id === record.id);
    const task = {
      id: id(), workspace_id: req.workspace.id, project_id: null, section_id: null, parent_id: null,
      creator_id: req.user.id, assignee_id: null, content: titleForRecord(bundle, normalizedRecord), description: '',
      priority: 4, due_date: dateForRecord(bundle, normalizedRecord), due_time: null, deadline_date: null,
      timezone: req.user.timezone || null, recurrence_rule: null, duration_minutes: null,
      position: Date.now(), completed_at: null, created_at: now(), updated_at: now()
    };
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO tasks
        (id,workspace_id,project_id,section_id,parent_id,creator_id,assignee_id,content,description,priority,due_date,due_time,deadline_date,timezone,recurrence_rule,duration_minutes,position,completed_at,created_at,updated_at)
        VALUES (@id,@workspace_id,@project_id,@section_id,@parent_id,@creator_id,@assignee_id,@content,@description,@priority,@due_date,@due_time,@deadline_date,@timezone,@recurrence_rule,@duration_minutes,@position,@completed_at,@created_at,@updated_at)`).run(task);
      db.prepare('UPDATE smart_records SET task_id=?,updated_at=? WHERE id=?').run(task.id, now(), record.id);
    });
    tx();
    res.status(201).json({ task, linked: true });
  });

  app.get('/api/calendar/events', auth, (req, res) => {
    const start = clean(req.query.start, 10) || '0000-01-01';
    const end = clean(req.query.end, 10) || '9999-12-31';
    const tasks = db.prepare(`
      SELECT id,content,due_date,completed_at,priority,project_id
      FROM tasks
      WHERE workspace_id=? AND due_date IS NOT NULL AND due_date BETWEEN ? AND ?
      ORDER BY due_date,position
    `).all(req.workspace.id, start, end).map(task => ({
      id: `task:${task.id}`, source: 'task', task_id: task.id, title: task.content,
      date: task.due_date, color: task.priority === 1 ? '#dc2626' : task.priority === 2 ? '#f97316' : task.priority === 3 ? '#2563eb' : '#64748b',
      completed: Boolean(task.completed_at), project_id: task.project_id
    }));
    const tables = smartTableSummaries(req.workspace.id);
    const smartEvents = [];
    for (const table of tables) {
      const bundle = smartTableBundle(table.id, req.workspace.id);
      for (const record of bundle.records) {
        const date = dateForRecord(bundle, record);
        if (!date || date < start || date > end) continue;
        smartEvents.push({
          id: `smart:${record.id}`, source: 'smart_record', record_id: record.id, table_id: table.id,
          table_name: table.name, task_id: record.task_id || null, title: titleForRecord(bundle, record),
          date, color: colorForRecord(bundle, record), completed: false
        });
      }
    }
    res.json({ events: [...tasks, ...smartEvents].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)) });
  });
}
