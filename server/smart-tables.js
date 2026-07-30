import { db, id, now } from './db.js';

const FIELD_TYPES = new Set([
  'text', 'long_text', 'number', 'select', 'multi_select', 'status',
  'date', 'datetime', 'checkbox', 'url', 'person'
]);
const VIEW_TYPES = new Set(['grid', 'calendar']);
const AREA_LABELS = ['工作', '生活'];

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
function bool(value) {
  return value ? 1 : 0;
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
  return {...row, config: parseJson(row.config_json, {}) || {}};
}
function normalizeView(row) {
  return {...row, config: parseJson(row.config_json, {}) || {}};
}
function normalizeRecord(row, valuesByRecord = new Map()) {
  return {...row, values: valuesByRecord.get(row.id) || {}};
}
function fieldByRole(bundle, role) {
  const aliases = {
    title: ['名称', '标题'], record_kind: ['记录类型', '事项类型'], area: ['归属', '领域', '工作生活'],
    status: ['状态'], date: ['日期', '截止日期', '时间'], notes: ['备注', '其他信息', '说明']
  };
  return bundle.fields.find(field => field.config?.role === role)
    || (role === 'title' ? bundle.fields.find(field => field.is_primary) : null)
    || bundle.fields.find(field => (aliases[role] || []).includes(field.name));
}
function optionFor(field, value) {
  return field?.config?.options?.find(option => option.id === value || option.label === value);
}
function optionValue(field, labels, fallback = null) {
  const wanted = new Set(Array.isArray(labels) ? labels : [labels]);
  return field?.config?.options?.find(option => wanted.has(option.id) || wanted.has(option.label))?.id || fallback;
}
function valueLabel(field, value) {
  return optionFor(field, value)?.label || String(value || '');
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

function applyLinkedTaskOverlay(bundle, record, workspaceId) {
  if (!record.task_id) return record;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?').get(record.task_id, workspaceId);
  if (!task) return {...record, task_id: null};
  const title = fieldByRole(bundle, 'title');
  const kind = fieldByRole(bundle, 'record_kind');
  const area = fieldByRole(bundle, 'area');
  const status = fieldByRole(bundle, 'status');
  const date = fieldByRole(bundle, 'date');
  const notes = fieldByRole(bundle, 'notes');
  const values = {...record.values};
  if (title) values[title.id] = task.content;
  if (kind) values[kind.id] = optionValue(kind, ['task', '任务'], 'task');
  if (date) values[date.id] = task.due_date || null;
  if (notes) values[notes.id] = task.description || null;
  if (status) values[status.id] = task.completed_at
    ? optionValue(status, ['done', '已完成', '完成'], values[status.id] || 'done')
    : (values[status.id] || optionValue(status, ['pending', '待处理'], 'pending'));
  if (area) {
    const labels = db.prepare(`
      SELECT l.name FROM labels l JOIN task_labels tl ON tl.label_id = l.id WHERE tl.task_id = ?
    `).all(task.id).map(row => row.name);
    if (labels.includes('工作')) values[area.id] = optionValue(area, ['work', '工作'], 'work');
    if (labels.includes('生活')) values[area.id] = optionValue(area, ['life', '生活'], 'life');
  }
  return {...record, values};
}

export function smartTableBundle(tableId, workspaceId) {
  const table = tableForWorkspace(tableId, workspaceId);
  if (!table) return null;
  const fields = db.prepare('SELECT * FROM smart_fields WHERE table_id = ? ORDER BY position, created_at').all(table.id).map(normalizeField);
  const views = db.prepare('SELECT * FROM smart_views WHERE table_id = ? ORDER BY position, created_at').all(table.id).map(normalizeView);
  const recordRows = db.prepare('SELECT * FROM smart_records WHERE table_id = ? ORDER BY position, created_at').all(table.id);
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
  const base = {table, fields, views, records: []};
  base.records = recordRows
    .map(row => normalizeRecord(row, valuesByRecord))
    .map(record => applyLinkedTaskOverlay(base, record, workspaceId));
  return base;
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

function defaultOptions(items) {
  return items.map(([idValue, label, color]) => ({id: idValue, label, color}));
}
function createDefaultTable(workspaceId, userId, name, color) {
  const tableId = id();
  const createdAt = now();
  const nameFieldId = id();
  const kindFieldId = id();
  const areaFieldId = id();
  const statusFieldId = id();
  const dateFieldId = id();
  const notesFieldId = id();
  const gridViewId = id();
  const calendarViewId = id();
  const kindOptions = defaultOptions([
    ['memo', '备忘', '#64748b'], ['task', '任务', '#2563eb']
  ]);
  const areaOptions = defaultOptions([
    ['work', '工作', '#7c3aed'], ['life', '生活', '#10b981']
  ]);
  const statusOptions = defaultOptions([
    ['pending', '待处理', '#3b82f6'], ['doing', '进行中', '#f59e0b'], ['done', '已完成', '#8b5cf6']
  ]);
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO smart_tables (id,workspace_id,owner_id,name,description,color,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(tableId, workspaceId, userId, name, '', color, Date.now(), createdAt, createdAt);
    const insertField = db.prepare(`INSERT INTO smart_fields
      (id,table_id,name,type,config_json,position,width,hidden,is_primary,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    insertField.run(nameFieldId, tableId, '名称', 'text', encode({role: 'title'}), 1024, 300, 0, 1, createdAt, createdAt);
    insertField.run(kindFieldId, tableId, '记录类型', 'select', encode({role: 'record_kind', options: kindOptions}), 2048, 130, 0, 0, createdAt, createdAt);
    insertField.run(areaFieldId, tableId, '归属', 'select', encode({role: 'area', options: areaOptions}), 3072, 120, 0, 0, createdAt, createdAt);
    insertField.run(statusFieldId, tableId, '状态', 'status', encode({role: 'status', options: statusOptions}), 4096, 130, 0, 0, createdAt, createdAt);
    insertField.run(dateFieldId, tableId, '日期', 'date', encode({role: 'date'}), 5120, 145, 0, 0, createdAt, createdAt);
    insertField.run(notesFieldId, tableId, '其他信息', 'long_text', encode({role: 'notes'}), 6144, 320, 0, 0, createdAt, createdAt);
    const insertView = db.prepare(`INSERT INTO smart_views
      (id,table_id,name,type,config_json,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`);
    insertView.run(gridViewId, tableId, '表格', 'grid', encode({hidden_field_ids: []}), 1024, createdAt, createdAt);
    insertView.run(calendarViewId, tableId, '日历', 'calendar', encode({date_field_id: dateFieldId, color_field_id: areaFieldId}), 2048, createdAt, createdAt);
  });
  tx();
  return smartTableBundle(tableId, workspaceId);
}

function titleForRecord(bundle, record) {
  const primary = fieldByRole(bundle, 'title');
  const value = primary ? record.values[primary.id] : null;
  return clean(String(value || ''), 300) || '未命名记录';
}
function dateForRecord(bundle, record) {
  const calendarView = bundle.views.find(view => view.type === 'calendar');
  const configured = calendarView?.config?.date_field_id;
  const field = bundle.fields.find(item => item.id === configured) || fieldByRole(bundle, 'date')
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
  const option = optionFor(field, raw);
  return option?.color || bundle.table.color || '#7c3aed';
}
function recordKind(bundle, record) {
  const field = fieldByRole(bundle, 'record_kind');
  return field ? valueLabel(field, record.values[field.id]) : '';
}
function recordArea(bundle, record) {
  const field = fieldByRole(bundle, 'area');
  return field ? valueLabel(field, record.values[field.id]) : '';
}
function recordStatus(bundle, record) {
  const field = fieldByRole(bundle, 'status');
  return field ? valueLabel(field, record.values[field.id]) : '';
}
function recordNotes(bundle, record) {
  const field = fieldByRole(bundle, 'notes');
  return field ? clean(String(record.values[field.id] || ''), 20000) : '';
}
function ensureLabel(workspaceId, name, color) {
  let label = db.prepare('SELECT * FROM labels WHERE workspace_id = ? AND name = ?').get(workspaceId, name);
  if (label) return label;
  label = {id: id(), workspace_id: workspaceId, name, color, is_favorite: 1, created_at: now(), updated_at: now()};
  db.prepare(`INSERT INTO labels (id,workspace_id,name,color,is_favorite,created_at,updated_at)
    VALUES (@id,@workspace_id,@name,@color,@is_favorite,@created_at,@updated_at)`).run(label);
  return label;
}
function syncAreaLabel(taskId, workspaceId, areaName) {
  const areaLabels = db.prepare(`
    SELECT l.id,l.name FROM labels l JOIN task_labels tl ON tl.label_id=l.id
    WHERE tl.task_id=? AND l.workspace_id=? AND l.name IN ('工作','生活')
  `).all(taskId, workspaceId);
  for (const label of areaLabels) db.prepare('DELETE FROM task_labels WHERE task_id=? AND label_id=?').run(taskId, label.id);
  if (!AREA_LABELS.includes(areaName)) return;
  const label = ensureLabel(workspaceId, areaName, areaName === '工作' ? '#7c3aed' : '#10b981');
  db.prepare('INSERT OR IGNORE INTO task_labels (task_id,label_id) VALUES (?,?)').run(taskId, label.id);
}
function ensureTaskForRecord(record, workspaceId, user) {
  let bundle = smartTableBundle(record.table_id, workspaceId);
  let normalizedRecord = bundle.records.find(item => item.id === record.id);
  let task = record.task_id ? db.prepare('SELECT * FROM tasks WHERE id=? AND workspace_id=?').get(record.task_id, workspaceId) : null;
  const complete = ['done', '已完成', '完成'].includes(recordStatus(bundle, normalizedRecord));
  const taskData = {
    content: titleForRecord(bundle, normalizedRecord),
    description: recordNotes(bundle, normalizedRecord),
    due_date: dateForRecord(bundle, normalizedRecord),
    completed_at: complete ? (task?.completed_at || now()) : null,
    updated_at: now()
  };
  const tx = db.transaction(() => {
    if (!task) {
      task = {
        id: id(), workspace_id: workspaceId, project_id: null, section_id: null, parent_id: null,
        creator_id: user.id, assignee_id: null, content: taskData.content, description: taskData.description,
        priority: 4, due_date: taskData.due_date, due_time: null, deadline_date: null,
        timezone: user.timezone || null, recurrence_rule: null, duration_minutes: null,
        position: Date.now(), completed_at: taskData.completed_at, created_at: now(), updated_at: taskData.updated_at
      };
      db.prepare(`INSERT INTO tasks
        (id,workspace_id,project_id,section_id,parent_id,creator_id,assignee_id,content,description,priority,due_date,due_time,deadline_date,timezone,recurrence_rule,duration_minutes,position,completed_at,created_at,updated_at)
        VALUES (@id,@workspace_id,@project_id,@section_id,@parent_id,@creator_id,@assignee_id,@content,@description,@priority,@due_date,@due_time,@deadline_date,@timezone,@recurrence_rule,@duration_minutes,@position,@completed_at,@created_at,@updated_at)`).run(task);
      db.prepare('UPDATE smart_records SET task_id=?,updated_at=? WHERE id=?').run(task.id, now(), record.id);
    } else {
      db.prepare('UPDATE tasks SET content=?,description=?,due_date=?,completed_at=?,updated_at=? WHERE id=?')
        .run(taskData.content, taskData.description, taskData.due_date, taskData.completed_at, taskData.updated_at, task.id);
      task = db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id);
    }
    syncAreaLabel(task.id, workspaceId, recordArea(bundle, normalizedRecord));
  });
  tx();
  return db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id);
}
function maybeSyncRecordToTask(recordId, workspaceId, user) {
  const record = recordForWorkspace(recordId, workspaceId);
  if (!record) return null;
  const bundle = smartTableBundle(record.table_id, workspaceId);
  const normalizedRecord = bundle.records.find(item => item.id === record.id);
  const kind = recordKind(bundle, normalizedRecord);
  if (!record.task_id && !['task', '任务'].includes(kind)) return null;
  return ensureTaskForRecord(record, workspaceId, user);
}

export function registerSmartTableRoutes(app, auth) {
  app.get('/api/smart-tables', auth, (req, res) => {
    res.json({tables: smartTableSummaries(req.workspace.id)});
  });

  app.post('/api/smart-tables', auth, (req, res) => {
    const name = clean(req.body.name, 120);
    if (!name) return res.status(400).json({error: '表格名称不能为空'});
    const color = clean(req.body.color, 20) || '#7c3aed';
    res.status(201).json(createDefaultTable(req.workspace.id, req.user.id, name, color));
  });

  app.get('/api/smart-tables/:id', auth, (req, res) => {
    const bundle = smartTableBundle(req.params.id, req.workspace.id);
    if (!bundle) return res.status(404).json({error: '智能表格不存在'});
    res.json(bundle);
  });

  app.patch('/api/smart-tables/:id', auth, (req, res) => {
    const table = tableForWorkspace(req.params.id, req.workspace.id);
    if (!table) return res.status(404).json({error: '智能表格不存在'});
    const name = req.body.name === undefined ? table.name : clean(req.body.name, 120) || table.name;
    const description = req.body.description === undefined ? table.description : clean(req.body.description, 2000);
    const color = req.body.color === undefined ? table.color : clean(req.body.color, 20) || table.color;
    const position = req.body.position === undefined ? table.position : Number(req.body.position) || table.position;
    db.prepare('UPDATE smart_tables SET name=?,description=?,color=?,position=?,updated_at=? WHERE id=?')
      .run(name, description, color, position, now(), table.id);
    res.json({table: tableForWorkspace(table.id, req.workspace.id)});
  });

  app.delete('/api/smart-tables/:id', auth, (req, res) => {
    const table = tableForWorkspace(req.params.id, req.workspace.id);
    if (!table) return res.status(404).json({error: '智能表格不存在'});
    db.prepare('DELETE FROM smart_tables WHERE id = ?').run(table.id);
    res.json({ok: true});
  });

  app.post('/api/smart-tables/:tableId/fields', auth, (req, res) => {
    const table = tableForWorkspace(req.params.tableId, req.workspace.id);
    if (!table) return res.status(404).json({error: '智能表格不存在'});
    const name = clean(req.body.name, 120);
    const type = FIELD_TYPES.has(req.body.type) ? req.body.type : 'text';
    if (!name) return res.status(400).json({error: '字段名称不能为空'});
    const field = {
      id: id(), table_id: table.id, name, type,
      config_json: encode(req.body.config && typeof req.body.config === 'object' ? req.body.config : {}),
      position: Number(req.body.position) || Date.now(),
      width: clampNumber(req.body.width, 90, 700, 180), hidden: bool(req.body.hidden),
      is_primary: 0, created_at: now(), updated_at: now()
    };
    db.prepare(`INSERT INTO smart_fields
      (id,table_id,name,type,config_json,position,width,hidden,is_primary,created_at,updated_at)
      VALUES (@id,@table_id,@name,@type,@config_json,@position,@width,@hidden,@is_primary,@created_at,@updated_at)`).run(field);
    res.status(201).json({field: normalizeField(field)});
  });

  app.patch('/api/smart-fields/:id', auth, (req, res) => {
    const field = fieldForWorkspace(req.params.id, req.workspace.id);
    if (!field) return res.status(404).json({error: '字段不存在'});
    const name = req.body.name === undefined ? field.name : clean(req.body.name, 120) || field.name;
    const type = req.body.type === undefined ? field.type : (FIELD_TYPES.has(req.body.type) ? req.body.type : field.type);
    const config = req.body.config === undefined ? parseJson(field.config_json, {}) : req.body.config;
    const position = req.body.position === undefined ? field.position : Number(req.body.position) || field.position;
    const width = req.body.width === undefined ? field.width : clampNumber(req.body.width, 90, 700, field.width);
    const hidden = req.body.hidden === undefined ? field.hidden : bool(req.body.hidden);
    db.prepare('UPDATE smart_fields SET name=?,type=?,config_json=?,position=?,width=?,hidden=?,updated_at=? WHERE id=?')
      .run(name, type, encode(config || {}), position, width, hidden, now(), field.id);
    res.json({field: normalizeField(fieldForWorkspace(field.id, req.workspace.id))});
  });

  app.delete('/api/smart-fields/:id', auth, (req, res) => {
    const field = fieldForWorkspace(req.params.id, req.workspace.id);
    if (!field) return res.status(404).json({error: '字段不存在'});
    if (field.is_primary) return res.status(400).json({error: '主字段不能删除'});
    db.prepare('DELETE FROM smart_fields WHERE id = ?').run(field.id);
    res.json({ok: true});
  });

  app.post('/api/smart-tables/:tableId/records', auth, (req, res) => {
    const table = tableForWorkspace(req.params.tableId, req.workspace.id);
    if (!table) return res.status(404).json({error: '智能表格不存在'});
    const record = {id: id(), table_id: table.id, position: Number(req.body.position) || Date.now(), task_id: null, created_at: now(), updated_at: now()};
    db.transaction(() => {
      db.prepare(`INSERT INTO smart_records (id,table_id,position,task_id,created_at,updated_at)
        VALUES (@id,@table_id,@position,@task_id,@created_at,@updated_at)`).run(record);
      saveRecordValues(record.id, table.id, req.body.values || {});
    })();
    maybeSyncRecordToTask(record.id, req.workspace.id, req.user);
    const bundle = smartTableBundle(table.id, req.workspace.id);
    res.status(201).json({record: bundle.records.find(item => item.id === record.id)});
  });

  app.patch('/api/smart-records/:id', auth, (req, res) => {
    const record = recordForWorkspace(req.params.id, req.workspace.id);
    if (!record) return res.status(404).json({error: '记录不存在'});
    const position = req.body.position === undefined ? record.position : Number(req.body.position) || record.position;
    const taskId = req.body.task_id === undefined ? record.task_id : req.body.task_id || null;
    db.transaction(() => {
      db.prepare('UPDATE smart_records SET position=?,task_id=?,updated_at=? WHERE id=?').run(position, taskId, now(), record.id);
      saveRecordValues(record.id, record.table_id, req.body.values || {});
    })();
    maybeSyncRecordToTask(record.id, req.workspace.id, req.user);
    const bundle = smartTableBundle(record.table_id, req.workspace.id);
    res.json({record: bundle.records.find(item => item.id === record.id)});
  });

  app.post('/api/smart-records/reorder', auth, (req, res) => {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length || items.length > 2000) return res.status(400).json({error: '排序数据无效'});
    const update = db.prepare(`
      UPDATE smart_records SET position=?,updated_at=? WHERE id=? AND table_id IN (SELECT id FROM smart_tables WHERE workspace_id=?)
    `);
    db.transaction(() => {
      for (const item of items) {
        const position = Number(item.position);
        if (!item.id || !Number.isFinite(position)) continue;
        update.run(position, now(), item.id, req.workspace.id);
      }
    })();
    res.json({ok: true});
  });

  app.post('/api/smart-records/:id/duplicate', auth, (req, res) => {
    const record = recordForWorkspace(req.params.id, req.workspace.id);
    if (!record) return res.status(404).json({error: '记录不存在'});
    const values = db.prepare('SELECT field_id,value_json FROM smart_values WHERE record_id=?').all(record.id);
    const copy = {id: id(), table_id: record.table_id, position: Number(record.position) + 1, task_id: null, created_at: now(), updated_at: now()};
    db.transaction(() => {
      db.prepare(`INSERT INTO smart_records (id,table_id,position,task_id,created_at,updated_at)
        VALUES (@id,@table_id,@position,@task_id,@created_at,@updated_at)`).run(copy);
      const insert = db.prepare('INSERT INTO smart_values (record_id,field_id,value_json,updated_at) VALUES (?,?,?,?)');
      values.forEach(value => insert.run(copy.id, value.field_id, value.value_json, now()));
    })();
    const bundle = smartTableBundle(record.table_id, req.workspace.id);
    res.status(201).json({record: bundle.records.find(item => item.id === copy.id)});
  });

  app.post('/api/smart-records/bulk', auth, (req, res) => {
    const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).map(value => clean(value, 100)).filter(Boolean))];
    if (!ids.length || ids.length > 1000) return res.status(400).json({error: '请选择有效记录'});
    const records = ids.map(recordId => recordForWorkspace(recordId, req.workspace.id)).filter(Boolean);
    if (records.length !== ids.length) return res.status(400).json({error: '部分记录不存在'});
    const action = clean(req.body.action, 30);
    if (action === 'delete') {
      db.transaction(() => records.forEach(record => db.prepare('DELETE FROM smart_records WHERE id=?').run(record.id)))();
      return res.json({ok: true, count: records.length});
    }
    if (action === 'update') {
      db.transaction(() => records.forEach(record => {
        saveRecordValues(record.id, record.table_id, req.body.values || {});
        db.prepare('UPDATE smart_records SET updated_at=? WHERE id=?').run(now(), record.id);
      }))();
      records.forEach(record => maybeSyncRecordToTask(record.id, req.workspace.id, req.user));
      return res.json({ok: true, count: records.length});
    }
    if (action === 'to_task') {
      records.forEach(record => ensureTaskForRecord(record, req.workspace.id, req.user));
      return res.json({ok: true, count: records.length});
    }
    return res.status(400).json({error: '不支持的批量操作'});
  });

  app.delete('/api/smart-records/:id', auth, (req, res) => {
    const record = recordForWorkspace(req.params.id, req.workspace.id);
    if (!record) return res.status(404).json({error: '记录不存在'});
    db.prepare('DELETE FROM smart_records WHERE id = ?').run(record.id);
    res.json({ok: true});
  });

  app.post('/api/smart-tables/:tableId/views', auth, (req, res) => {
    const table = tableForWorkspace(req.params.tableId, req.workspace.id);
    if (!table) return res.status(404).json({error: '智能表格不存在'});
    const type = VIEW_TYPES.has(req.body.type) ? req.body.type : 'grid';
    const view = {
      id: id(), table_id: table.id, name: clean(req.body.name, 120) || (type === 'calendar' ? '日历' : '表格'),
      type, config_json: encode(req.body.config || {}), position: Number(req.body.position) || Date.now(),
      created_at: now(), updated_at: now()
    };
    db.prepare(`INSERT INTO smart_views (id,table_id,name,type,config_json,position,created_at,updated_at)
      VALUES (@id,@table_id,@name,@type,@config_json,@position,@created_at,@updated_at)`).run(view);
    res.status(201).json({view: normalizeView(view)});
  });

  app.patch('/api/smart-views/:id', auth, (req, res) => {
    const view = viewForWorkspace(req.params.id, req.workspace.id);
    if (!view) return res.status(404).json({error: '视图不存在'});
    const name = req.body.name === undefined ? view.name : clean(req.body.name, 120) || view.name;
    const type = req.body.type === undefined ? view.type : (VIEW_TYPES.has(req.body.type) ? req.body.type : view.type);
    const config = req.body.config === undefined ? parseJson(view.config_json, {}) : req.body.config;
    const position = req.body.position === undefined ? view.position : Number(req.body.position) || view.position;
    db.prepare('UPDATE smart_views SET name=?,type=?,config_json=?,position=?,updated_at=? WHERE id=?')
      .run(name, type, encode(config || {}), position, now(), view.id);
    res.json({view: normalizeView(viewForWorkspace(view.id, req.workspace.id))});
  });

  app.delete('/api/smart-views/:id', auth, (req, res) => {
    const view = viewForWorkspace(req.params.id, req.workspace.id);
    if (!view) return res.status(404).json({error: '视图不存在'});
    const count = db.prepare('SELECT COUNT(*) AS count FROM smart_views WHERE table_id = ?').get(view.table_id).count;
    if (count <= 1) return res.status(400).json({error: '至少保留一个视图'});
    db.prepare('DELETE FROM smart_views WHERE id = ?').run(view.id);
    res.json({ok: true});
  });

  app.post('/api/smart-records/:id/to-task', auth, (req, res) => {
    const record = recordForWorkspace(req.params.id, req.workspace.id);
    if (!record) return res.status(404).json({error: '记录不存在'});
    const task = ensureTaskForRecord(record, req.workspace.id, req.user);
    res.status(record.task_id ? 200 : 201).json({task, linked: true});
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
        if (record.task_id) continue;
        const date = dateForRecord(bundle, record);
        if (!date || date < start || date > end) continue;
        smartEvents.push({
          id: `smart:${record.id}`, source: 'smart_record', record_id: record.id, table_id: table.id,
          table_name: table.name, task_id: null, title: titleForRecord(bundle, record),
          date, color: colorForRecord(bundle, record), completed: false
        });
      }
    }
    res.json({events: [...tasks, ...smartEvents].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))});
  });
}
