import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { addDays, format, isBefore, parseISO, startOfDay } from 'date-fns';
import { db, id, initDb, now, getWorkspaceForUser, assertWorkspaceAccess, taskWithRelations } from './db.js';
import { createAccount } from './seed-data.js';
import { nextRecurringDate } from './recurrence.js';
import { registerSmartTableRoutes, smartTableSummaries } from './smart-tables.js';

initDb();
await createAccount({ email: 'demo@focusflow.local', name: '演示用户', password: 'demo1234', demo: true });

const app = express();
const PORT = Number(process.env.PORT || 4173);
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-me';
const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads');
fs.mkdirSync(uploadDir, { recursive: true });

app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/uploads', express.static(uploadDir));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${id()}${path.extname(file.originalname)}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024 }
});

function signSession(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '14d' });
}
function setSession(res, user) {
  res.cookie('ff_session', signSession(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 14 * 24 * 60 * 60 * 1000,
    path: '/'
  });
}
function publicUser(user) {
  return user && { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url, theme: user.theme, timezone: user.timezone };
}
function auth(req, res, next) {
  try {
    const token = req.cookies.ff_session;
    if (!token) return res.status(401).json({ error: '请先登录' });
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!user) return res.status(401).json({ error: '登录已失效' });
    req.user = user;
    const workspace = getWorkspaceForUser(user.id);
    if (!workspace) return res.status(403).json({ error: '没有可用工作区' });
    req.workspace = workspace;
    next();
  } catch {
    return res.status(401).json({ error: '登录已失效' });
  }
}
function canManage(req) {
  return ['owner', 'admin'].includes(req.workspace.role);
}
function cleanString(value, max = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function bool(value) { return value ? 1 : 0; }
function dateOnly(value) { return value ? String(value).slice(0, 10) : null; }
function ensureTaskAccess(taskId, req, res) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?').get(taskId, req.workspace.id);
  if (!task) res.status(404).json({ error: '任务不存在' });
  return task;
}
function hydrateTasks(workspaceId) {
  const tasks = db.prepare(`
    SELECT t.*, p.name AS project_name, p.color AS project_color, s.name AS section_name,
           u.name AS assignee_name
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN sections s ON s.id = t.section_id
    LEFT JOIN users u ON u.id = t.assignee_id
    WHERE t.workspace_id = ?
    ORDER BY t.completed_at IS NOT NULL, t.position, t.created_at DESC
  `).all(workspaceId);
  const labelRows = db.prepare(`
    SELECT tl.task_id, l.* FROM task_labels tl JOIN labels l ON l.id = tl.label_id WHERE l.workspace_id = ?
  `).all(workspaceId);
  const labelsByTask = new Map();
  for (const row of labelRows) {
    if (!labelsByTask.has(row.task_id)) labelsByTask.set(row.task_id, []);
    labelsByTask.get(row.task_id).push({ id: row.id, name: row.name, color: row.color });
  }
  return tasks.map(t => ({ ...t, labels: labelsByTask.get(t.id) || [] }));
}
function syncTaskLabels(taskId, labelIds, workspaceId) {
  if (!Array.isArray(labelIds)) return;
  const valid = new Set(db.prepare('SELECT id FROM labels WHERE workspace_id = ?').all(workspaceId).map(x => x.id));
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM task_labels WHERE task_id = ?').run(taskId);
    const stmt = db.prepare('INSERT OR IGNORE INTO task_labels (task_id,label_id) VALUES (?,?)');
    labelIds.filter(x => valid.has(x)).forEach(labelId => stmt.run(taskId, labelId));
  });
  tx();
}
function createDueNotifications(userId, workspaceId) {
  const due = db.prepare(`
    SELECT r.*, t.content FROM reminders r JOIN tasks t ON t.id = r.task_id
    WHERE r.user_id = ? AND t.workspace_id = ? AND r.fired_at IS NULL AND r.remind_at <= ? AND t.completed_at IS NULL
  `).all(userId, workspaceId, now());
  const tx = db.transaction(() => {
    const insert = db.prepare(`INSERT INTO notifications (id,workspace_id,user_id,type,title,body,entity_id,created_at) VALUES (?,?,?,?,?,?,?,?)`);
    const fire = db.prepare('UPDATE reminders SET fired_at = ? WHERE id = ?');
    due.forEach(r => {
      insert.run(id(), workspaceId, userId, 'reminder', '任务提醒', r.content, r.task_id, now());
      fire.run(now(), r.id);
    });
  });
  tx();
}

registerSmartTableRoutes(app, auth);

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'focusflow', time: now() }));

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const email = cleanString(req.body.email, 320).toLowerCase();
  const name = cleanString(req.body.name, 80);
  const password = String(req.body.password || '');
  if (!email.includes('@') || name.length < 2 || password.length < 8) {
    return res.status(400).json({ error: '请填写有效姓名、邮箱，并使用至少 8 位密码' });
  }
  try {
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: '邮箱已注册' });
    const userId = await createAccount({ email, name, password, demo: false });
    const pending = db.prepare("SELECT * FROM invitations WHERE email = ? AND status = 'pending'").all(email);
    const joinPending = db.transaction(() => {
      for (const invite of pending) {
        db.prepare('INSERT OR IGNORE INTO memberships (workspace_id,user_id,role,created_at) VALUES (?,?,?,?)').run(invite.workspace_id, userId, invite.role, now());
        db.prepare("UPDATE invitations SET status = 'accepted' WHERE id = ?").run(invite.id);
      }
    });
    joinPending();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    setSession(res, user);
    res.status(201).json({ user: publicUser(user), workspace: getWorkspaceForUser(user.id) });
  } catch (error) {
    if (String(error).includes('UNIQUE')) return res.status(409).json({ error: '邮箱已注册' });
    console.error(error);
    res.status(500).json({ error: '注册失败' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const email = cleanString(req.body.email, 320).toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: '邮箱或密码错误' });
  setSession(res, user);
  res.json({ user: publicUser(user), workspace: getWorkspaceForUser(user.id) });
});
app.post('/api/auth/logout', (_req, res) => { res.clearCookie('ff_session', { path: '/' }); res.json({ ok: true }); });
app.get('/api/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user), workspace: req.workspace }));

app.get('/api/bootstrap', auth, (req, res) => {
  createDueNotifications(req.user.id, req.workspace.id);
  const projects = db.prepare('SELECT * FROM projects WHERE workspace_id = ? AND archived_at IS NULL ORDER BY position,name').all(req.workspace.id);
  const sections = db.prepare(`SELECT s.* FROM sections s JOIN projects p ON p.id=s.project_id WHERE p.workspace_id=? ORDER BY s.position,s.created_at`).all(req.workspace.id);
  const labels = db.prepare('SELECT * FROM labels WHERE workspace_id = ? ORDER BY is_favorite DESC,name').all(req.workspace.id);
  const filters = db.prepare('SELECT * FROM filters WHERE workspace_id = ? AND user_id = ? ORDER BY is_favorite DESC,name').all(req.workspace.id, req.user.id);
  const members = db.prepare(`SELECT u.id,u.name,u.email,u.avatar_url,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY u.name`).all(req.workspace.id);
  const notifications = db.prepare('SELECT * FROM notifications WHERE workspace_id=? AND user_id=? ORDER BY created_at DESC LIMIT 50').all(req.workspace.id, req.user.id);
  const smartTables = smartTableSummaries(req.workspace.id);
  res.json({ user: publicUser(req.user), workspace: req.workspace, projects, sections, tasks: hydrateTasks(req.workspace.id), labels, filters, members, notifications, smartTables });
});

app.patch('/api/profile', auth, (req, res) => {
  const name = cleanString(req.body.name, 80) || req.user.name;
  const theme = ['light','dark','system'].includes(req.body.theme) ? req.body.theme : req.user.theme;
  const timezone = cleanString(req.body.timezone, 80) || req.user.timezone;
  db.prepare('UPDATE users SET name=?,theme=?,timezone=?,updated_at=? WHERE id=?').run(name, theme, timezone, now(), req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
});

app.post('/api/projects', auth, (req, res) => {
  const name = cleanString(req.body.name, 120);
  if (!name) return res.status(400).json({ error: '项目名称不能为空' });
  const project = {
    id: id(), workspace_id: req.workspace.id, owner_id: req.user.id,
    parent_id: req.body.parent_id || null, name, color: cleanString(req.body.color, 20) || '#7c3aed',
    icon: cleanString(req.body.icon, 40) || null,
    view_mode: ['list','board','calendar'].includes(req.body.view_mode) ? req.body.view_mode : 'list',
    is_favorite: bool(req.body.is_favorite), is_shared: bool(req.body.is_shared),
    position: Number(req.body.position || Date.now()), created_at: now(), updated_at: now()
  };
  db.prepare(`INSERT INTO projects (id,workspace_id,owner_id,parent_id,name,color,icon,view_mode,is_favorite,is_shared,position,created_at,updated_at)
    VALUES (@id,@workspace_id,@owner_id,@parent_id,@name,@color,@icon,@view_mode,@is_favorite,@is_shared,@position,@created_at,@updated_at)`).run(project);
  res.status(201).json({ project });
});
app.patch('/api/projects/:id', auth, (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=?').get(req.params.id, req.workspace.id);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  const next = {
    name: cleanString(req.body.name, 120) || p.name,
    color: cleanString(req.body.color, 20) || p.color,
    icon: req.body.icon === undefined ? p.icon : cleanString(req.body.icon,40) || null,
    view_mode: ['list','board','calendar'].includes(req.body.view_mode) ? req.body.view_mode : p.view_mode,
    is_favorite: req.body.is_favorite === undefined ? p.is_favorite : bool(req.body.is_favorite),
    is_shared: req.body.is_shared === undefined ? p.is_shared : bool(req.body.is_shared),
    parent_id: req.body.parent_id === undefined ? p.parent_id : req.body.parent_id || null
  };
  db.prepare(`UPDATE projects SET name=@name,color=@color,icon=@icon,view_mode=@view_mode,is_favorite=@is_favorite,is_shared=@is_shared,parent_id=@parent_id,updated_at=@updated_at WHERE id=@id`)
    .run({ ...next, id: p.id, updated_at: now() });
  res.json({ project: db.prepare('SELECT * FROM projects WHERE id=?').get(p.id) });
});
app.delete('/api/projects/:id', auth, (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=?').get(req.params.id, req.workspace.id);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  db.prepare('UPDATE tasks SET project_id=NULL,section_id=NULL,updated_at=? WHERE project_id=?').run(now(), p.id);
  db.prepare('DELETE FROM projects WHERE id=?').run(p.id);
  res.json({ ok: true });
});

app.post('/api/sections', auth, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=?').get(req.body.project_id, req.workspace.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const name = cleanString(req.body.name, 120);
  if (!name) return res.status(400).json({ error: '分区名称不能为空' });
  const section = { id: id(), project_id: project.id, name, position: Number(req.body.position || Date.now()), created_at: now(), updated_at: now() };
  db.prepare('INSERT INTO sections (id,project_id,name,position,created_at,updated_at) VALUES (@id,@project_id,@name,@position,@created_at,@updated_at)').run(section);
  res.status(201).json({ section });
});
app.patch('/api/sections/:id', auth, (req, res) => {
  const s = db.prepare(`SELECT s.* FROM sections s JOIN projects p ON p.id=s.project_id WHERE s.id=? AND p.workspace_id=?`).get(req.params.id, req.workspace.id);
  if (!s) return res.status(404).json({ error: '分区不存在' });
  db.prepare('UPDATE sections SET name=?,position=?,updated_at=? WHERE id=?').run(cleanString(req.body.name,120)||s.name, Number(req.body.position ?? s.position), now(), s.id);
  res.json({ section: db.prepare('SELECT * FROM sections WHERE id=?').get(s.id) });
});
app.delete('/api/sections/:id', auth, (req, res) => {
  const s = db.prepare(`SELECT s.* FROM sections s JOIN projects p ON p.id=s.project_id WHERE s.id=? AND p.workspace_id=?`).get(req.params.id, req.workspace.id);
  if (!s) return res.status(404).json({ error: '分区不存在' });
  db.prepare('UPDATE tasks SET section_id=NULL,updated_at=? WHERE section_id=?').run(now(), s.id);
  db.prepare('DELETE FROM sections WHERE id=?').run(s.id);
  res.json({ ok: true });
});

app.post('/api/tasks', auth, (req, res) => {
  const content = cleanString(req.body.content, 500);
  if (!content) return res.status(400).json({ error: '任务内容不能为空' });
  if (req.body.project_id) {
    const project = db.prepare('SELECT id FROM projects WHERE id=? AND workspace_id=?').get(req.body.project_id, req.workspace.id);
    if (!project) return res.status(400).json({ error: '项目无效' });
  }
  const task = {
    id: id(), workspace_id: req.workspace.id, project_id: req.body.project_id || null, section_id: req.body.section_id || null,
    parent_id: req.body.parent_id || null, creator_id: req.user.id, assignee_id: req.body.assignee_id || null,
    content, description: cleanString(req.body.description, 20000), priority: Math.min(4, Math.max(1, Number(req.body.priority || 4))),
    due_date: dateOnly(req.body.due_date), due_time: cleanString(req.body.due_time, 8) || null,
    deadline_date: dateOnly(req.body.deadline_date), timezone: cleanString(req.body.timezone,80)||req.user.timezone,
    recurrence_rule: cleanString(req.body.recurrence_rule,100)||null, duration_minutes: req.body.duration_minutes ? Number(req.body.duration_minutes) : null,
    position: Number(req.body.position || Date.now()), created_at: now(), updated_at: now()
  };
  db.prepare(`INSERT INTO tasks (id,workspace_id,project_id,section_id,parent_id,creator_id,assignee_id,content,description,priority,due_date,due_time,deadline_date,timezone,recurrence_rule,duration_minutes,position,created_at,updated_at)
    VALUES (@id,@workspace_id,@project_id,@section_id,@parent_id,@creator_id,@assignee_id,@content,@description,@priority,@due_date,@due_time,@deadline_date,@timezone,@recurrence_rule,@duration_minutes,@position,@created_at,@updated_at)`).run(task);
  syncTaskLabels(task.id, req.body.label_ids, req.workspace.id);
  res.status(201).json({ task: taskWithRelations(task.id) });
});
app.get('/api/tasks/:id', auth, (req, res) => {
  const task = ensureTaskAccess(req.params.id, req, res); if (!task) return;
  res.json({ task: taskWithRelations(task.id) });
});
app.patch('/api/tasks/:id', auth, (req, res) => {
  const t = ensureTaskAccess(req.params.id, req, res); if (!t) return;
  const data = {
    id: t.id,
    project_id: req.body.project_id === undefined ? t.project_id : req.body.project_id || null,
    section_id: req.body.section_id === undefined ? t.section_id : req.body.section_id || null,
    parent_id: req.body.parent_id === undefined ? t.parent_id : req.body.parent_id || null,
    assignee_id: req.body.assignee_id === undefined ? t.assignee_id : req.body.assignee_id || null,
    content: req.body.content === undefined ? t.content : cleanString(req.body.content,500) || t.content,
    description: req.body.description === undefined ? t.description : cleanString(req.body.description,20000),
    priority: req.body.priority === undefined ? t.priority : Math.min(4,Math.max(1,Number(req.body.priority))),
    due_date: req.body.due_date === undefined ? t.due_date : dateOnly(req.body.due_date),
    due_time: req.body.due_time === undefined ? t.due_time : cleanString(req.body.due_time,8)||null,
    deadline_date: req.body.deadline_date === undefined ? t.deadline_date : dateOnly(req.body.deadline_date),
    recurrence_rule: req.body.recurrence_rule === undefined ? t.recurrence_rule : cleanString(req.body.recurrence_rule,100)||null,
    duration_minutes: req.body.duration_minutes === undefined ? t.duration_minutes : (req.body.duration_minutes ? Number(req.body.duration_minutes) : null),
    position: req.body.position === undefined ? t.position : Number(req.body.position),
    updated_at: now()
  };
  db.prepare(`UPDATE tasks SET project_id=@project_id,section_id=@section_id,parent_id=@parent_id,assignee_id=@assignee_id,content=@content,description=@description,priority=@priority,due_date=@due_date,due_time=@due_time,deadline_date=@deadline_date,recurrence_rule=@recurrence_rule,duration_minutes=@duration_minutes,position=@position,updated_at=@updated_at WHERE id=@id`).run(data);
  syncTaskLabels(t.id, req.body.label_ids, req.workspace.id);
  res.json({ task: taskWithRelations(t.id) });
});
app.post('/api/tasks/reorder', auth, (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length || items.length > 500) return res.status(400).json({ error: '排序数据无效' });
  const seen = new Set();
  const normalized = [];
  for (const item of items) {
    const taskId = cleanString(item?.id, 80);
    if (!taskId || seen.has(taskId)) return res.status(400).json({ error: '排序任务重复或无效' });
    seen.add(taskId);
    const task = db.prepare('SELECT * FROM tasks WHERE id=? AND workspace_id=?').get(taskId, req.workspace.id);
    if (!task || task.parent_id) return res.status(400).json({ error: '只能排序当前工作区的顶层任务' });
    const projectId = item.project_id || null;
    const sectionId = item.section_id || null;
    if (projectId && !db.prepare('SELECT id FROM projects WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(projectId, req.workspace.id)) {
      return res.status(400).json({ error: '目标项目无效' });
    }
    if (sectionId) {
      const section = db.prepare(`SELECT s.id,s.project_id FROM sections s JOIN projects p ON p.id=s.project_id WHERE s.id=? AND p.workspace_id=?`).get(sectionId, req.workspace.id);
      if (!section || section.project_id !== projectId) return res.status(400).json({ error: '目标分区与项目不匹配' });
    }
    const position = Number(item.position);
    if (!Number.isFinite(position)) return res.status(400).json({ error: '任务位置无效' });
    normalized.push({ id: taskId, project_id: projectId, section_id: sectionId, position });
  }
  const update = db.prepare('UPDATE tasks SET project_id=@project_id,section_id=@section_id,position=@position,updated_at=@updated_at WHERE id=@id AND workspace_id=@workspace_id');
  db.transaction(() => normalized.forEach(item => update.run({ ...item, updated_at: now(), workspace_id: req.workspace.id })))();
  res.json({ tasks: normalized.map(item => taskWithRelations(item.id)) });
});

app.post('/api/tasks/:id/complete', auth, (req, res) => {
  const t = ensureTaskAccess(req.params.id, req, res); if (!t) return;
  const completed = now();
  db.prepare('INSERT INTO task_completions (id,task_id,user_id,completed_at,due_date) VALUES (?,?,?,?,?)').run(id(), t.id, req.user.id, completed, t.due_date);
  const nextDate = nextRecurringDate(t.due_date, t.recurrence_rule);
  if (nextDate) {
    db.prepare('UPDATE tasks SET due_date=?,completed_at=NULL,updated_at=? WHERE id=?').run(nextDate, completed, t.id);
  } else {
    db.prepare('UPDATE tasks SET completed_at=?,updated_at=? WHERE id=?').run(completed, completed, t.id);
  }
  res.json({ task: taskWithRelations(t.id), recurring: Boolean(nextDate) });
});
app.post('/api/tasks/:id/uncomplete', auth, (req, res) => {
  const t = ensureTaskAccess(req.params.id, req, res); if (!t) return;
  db.prepare('UPDATE tasks SET completed_at=NULL,updated_at=? WHERE id=?').run(now(), t.id);
  res.json({ task: taskWithRelations(t.id) });
});
app.delete('/api/tasks/:id', auth, (req, res) => {
  const t = ensureTaskAccess(req.params.id, req, res); if (!t) return;
  db.prepare('DELETE FROM tasks WHERE id=?').run(t.id);
  res.json({ ok: true });
});

app.post('/api/labels', auth, (req, res) => {
  const name = cleanString(req.body.name,80); if (!name) return res.status(400).json({ error: '标签名不能为空' });
  const label = { id:id(),workspace_id:req.workspace.id,name,color:cleanString(req.body.color,20)||'#64748b',is_favorite:bool(req.body.is_favorite),created_at:now(),updated_at:now() };
  try { db.prepare('INSERT INTO labels (id,workspace_id,name,color,is_favorite,created_at,updated_at) VALUES (@id,@workspace_id,@name,@color,@is_favorite,@created_at,@updated_at)').run(label); }
  catch { return res.status(409).json({ error:'标签已存在' }); }
  res.status(201).json({ label });
});
app.patch('/api/labels/:id', auth, (req, res) => {
  const l = db.prepare('SELECT * FROM labels WHERE id=? AND workspace_id=?').get(req.params.id,req.workspace.id); if(!l)return res.status(404).json({error:'标签不存在'});
  db.prepare('UPDATE labels SET name=?,color=?,is_favorite=?,updated_at=? WHERE id=?').run(cleanString(req.body.name,80)||l.name,cleanString(req.body.color,20)||l.color,req.body.is_favorite===undefined?l.is_favorite:bool(req.body.is_favorite),now(),l.id);
  res.json({label:db.prepare('SELECT * FROM labels WHERE id=?').get(l.id)});
});
app.delete('/api/labels/:id', auth, (req,res)=>{ const l=db.prepare('SELECT id FROM labels WHERE id=? AND workspace_id=?').get(req.params.id,req.workspace.id);if(!l)return res.status(404).json({error:'标签不存在'});db.prepare('DELETE FROM labels WHERE id=?').run(l.id);res.json({ok:true}); });

app.post('/api/filters', auth, (req,res)=>{
  const name=cleanString(req.body.name,100), query=cleanString(req.body.query,500);if(!name||!query)return res.status(400).json({error:'名称和查询条件不能为空'});
  const f={id:id(),workspace_id:req.workspace.id,user_id:req.user.id,name,query,color:cleanString(req.body.color,20)||'#64748b',is_favorite:bool(req.body.is_favorite),created_at:now(),updated_at:now()};
  db.prepare('INSERT INTO filters (id,workspace_id,user_id,name,query,color,is_favorite,created_at,updated_at) VALUES (@id,@workspace_id,@user_id,@name,@query,@color,@is_favorite,@created_at,@updated_at)').run(f);res.status(201).json({filter:f});
});
app.patch('/api/filters/:id',auth,(req,res)=>{const f=db.prepare('SELECT * FROM filters WHERE id=? AND workspace_id=? AND user_id=?').get(req.params.id,req.workspace.id,req.user.id);if(!f)return res.status(404).json({error:'筛选器不存在'});db.prepare('UPDATE filters SET name=?,query=?,color=?,is_favorite=?,updated_at=? WHERE id=?').run(cleanString(req.body.name,100)||f.name,cleanString(req.body.query,500)||f.query,cleanString(req.body.color,20)||f.color,req.body.is_favorite===undefined?f.is_favorite:bool(req.body.is_favorite),now(),f.id);res.json({filter:db.prepare('SELECT * FROM filters WHERE id=?').get(f.id)});});
app.delete('/api/filters/:id',auth,(req,res)=>{db.prepare('DELETE FROM filters WHERE id=? AND workspace_id=? AND user_id=?').run(req.params.id,req.workspace.id,req.user.id);res.json({ok:true});});

app.post('/api/tasks/:id/comments', auth, (req,res)=>{
  const t=ensureTaskAccess(req.params.id,req,res);if(!t)return;const body=cleanString(req.body.body,10000);if(!body)return res.status(400).json({error:'评论不能为空'});
  const c={id:id(),task_id:t.id,user_id:req.user.id,body,created_at:now(),updated_at:now()};db.prepare('INSERT INTO comments (id,task_id,user_id,body,created_at,updated_at) VALUES (@id,@task_id,@user_id,@body,@created_at,@updated_at)').run(c);res.status(201).json({comment:{...c,user_name:req.user.name,user_email:req.user.email}});
});
app.delete('/api/comments/:id', auth, (req,res)=>{const c=db.prepare(`SELECT c.* FROM comments c JOIN tasks t ON t.id=c.task_id WHERE c.id=? AND t.workspace_id=?`).get(req.params.id,req.workspace.id);if(!c)return res.status(404).json({error:'评论不存在'});if(c.user_id!==req.user.id&&!canManage(req))return res.status(403).json({error:'无权删除'});db.prepare('DELETE FROM comments WHERE id=?').run(c.id);res.json({ok:true});});

app.post('/api/tasks/:id/attachments', auth, upload.single('file'), (req,res)=>{
  const t=ensureTaskAccess(req.params.id,req,res);if(!t){ if(req.file)fs.unlinkSync(req.file.path); return; }if(!req.file)return res.status(400).json({error:'请选择文件'});
  const a={id:id(),comment_id:null,task_id:t.id,user_id:req.user.id,original_name:req.file.originalname,stored_name:req.file.filename,mime_type:req.file.mimetype,size:req.file.size,created_at:now()};
  db.prepare('INSERT INTO attachments (id,comment_id,task_id,user_id,original_name,stored_name,mime_type,size,created_at) VALUES (@id,@comment_id,@task_id,@user_id,@original_name,@stored_name,@mime_type,@size,@created_at)').run(a);res.status(201).json({attachment:{...a,url:`/uploads/${a.stored_name}`}});
});
app.delete('/api/attachments/:id', auth, (req,res)=>{const a=db.prepare(`SELECT a.* FROM attachments a JOIN tasks t ON t.id=a.task_id WHERE a.id=? AND t.workspace_id=?`).get(req.params.id,req.workspace.id);if(!a)return res.status(404).json({error:'附件不存在'});if(a.user_id!==req.user.id&&!canManage(req))return res.status(403).json({error:'无权删除'});db.prepare('DELETE FROM attachments WHERE id=?').run(a.id);const file=path.join(uploadDir,a.stored_name);if(fs.existsSync(file))fs.unlinkSync(file);res.json({ok:true});});

app.post('/api/tasks/:id/reminders', auth, (req,res)=>{const t=ensureTaskAccess(req.params.id,req,res);if(!t)return;const remindAt=new Date(req.body.remind_at);if(Number.isNaN(remindAt.getTime()))return res.status(400).json({error:'提醒时间无效'});const r={id:id(),task_id:t.id,user_id:req.user.id,remind_at:remindAt.toISOString(),kind:'in_app',created_at:now()};db.prepare('INSERT INTO reminders (id,task_id,user_id,remind_at,kind,created_at) VALUES (@id,@task_id,@user_id,@remind_at,@kind,@created_at)').run(r);res.status(201).json({reminder:r});});
app.delete('/api/reminders/:id',auth,(req,res)=>{db.prepare('DELETE FROM reminders WHERE id=? AND user_id=?').run(req.params.id,req.user.id);res.json({ok:true});});

app.get('/api/notifications',auth,(req,res)=>{createDueNotifications(req.user.id,req.workspace.id);res.json({notifications:db.prepare('SELECT * FROM notifications WHERE workspace_id=? AND user_id=? ORDER BY created_at DESC LIMIT 50').all(req.workspace.id,req.user.id)});});
app.post('/api/notifications/read',auth,(req,res)=>{if(req.body.id)db.prepare('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?').run(now(),req.body.id,req.user.id);else db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND workspace_id=? AND read_at IS NULL').run(now(),req.user.id,req.workspace.id);res.json({ok:true});});

app.post('/api/team/invite',auth,(req,res)=>{
  if(!canManage(req))return res.status(403).json({error:'只有管理员可以邀请成员'});const email=cleanString(req.body.email,320).toLowerCase(),role=['admin','member','guest'].includes(req.body.role)?req.body.role:'member';if(!email.includes('@'))return res.status(400).json({error:'邮箱无效'});
  const invited=db.prepare('SELECT * FROM users WHERE email=?').get(email);if(invited){db.prepare('INSERT OR REPLACE INTO memberships (workspace_id,user_id,role,created_at) VALUES (?,?,?,?)').run(req.workspace.id,invited.id,role,now());return res.json({joined:true,member:{id:invited.id,name:invited.name,email:invited.email,role}});}
  const invitation={id:id(),workspace_id:req.workspace.id,email,role,status:'pending',invited_by:req.user.id,created_at:now()};db.prepare('INSERT INTO invitations (id,workspace_id,email,role,status,invited_by,created_at) VALUES (@id,@workspace_id,@email,@role,@status,@invited_by,@created_at)').run(invitation);res.status(201).json({invitation});
});
app.patch('/api/team/members/:id',auth,(req,res)=>{if(!canManage(req))return res.status(403).json({error:'只有管理员可以修改成员'});const role=['admin','member','guest'].includes(req.body.role)?req.body.role:null;if(!role)return res.status(400).json({error:'角色无效'});db.prepare(`UPDATE memberships SET role=? WHERE workspace_id=? AND user_id=? AND role!='owner'`).run(role,req.workspace.id,req.params.id);res.json({ok:true});});
app.delete('/api/team/members/:id',auth,(req,res)=>{if(!canManage(req))return res.status(403).json({error:'只有管理员可以移除成员'});db.prepare(`DELETE FROM memberships WHERE workspace_id=? AND user_id=? AND role!='owner'`).run(req.workspace.id,req.params.id);res.json({ok:true});});

app.get('/api/search',auth,(req,res)=>{
  const q=cleanString(req.query.q,200).toLowerCase();if(!q)return res.json({tasks:[]});
  const tasks=hydrateTasks(req.workspace.id).filter(t=>t.content.toLowerCase().includes(q)||t.description.toLowerCase().includes(q)||t.labels.some(l=>l.name.toLowerCase().includes(q))||String(t.project_name||'').toLowerCase().includes(q));res.json({tasks:tasks.slice(0,100)});
});

const dist = path.resolve(process.cwd(), 'client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((_req,res)=>res.sendFile(path.join(dist,'index.html')));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? '文件不能超过 10MB' : '上传失败' });
  res.status(500).json({ error: '服务器发生错误' });
});

app.listen(PORT, () => console.log(`FocusFlow running at http://localhost:${PORT}`));
