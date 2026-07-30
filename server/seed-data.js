import bcrypt from 'bcryptjs';
import { db, id, now } from './db.js';

export async function createAccount({ email, name, password, demo = false }) {
  if (demo && String(process.env.SEED_DEMO ?? 'true').toLowerCase() === 'false') return null;
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return existing.id;
  const timestamp = now();
  const userId = id();
  const workspaceId = id();
  const passwordHash = await bcrypt.hash(password, 12);

  const run = db.transaction(() => {
    db.prepare(`INSERT INTO users (id,email,name,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .run(userId, email, name, passwordHash, timestamp, timestamp);
    db.prepare(`INSERT INTO workspaces (id,name,owner_id,created_at,updated_at) VALUES (?,?,?,?,?)`)
      .run(workspaceId, `${name}的空间`, userId, timestamp, timestamp);
    db.prepare(`INSERT INTO memberships (workspace_id,user_id,role,created_at) VALUES (?,?,?,?)`)
      .run(workspaceId, userId, 'owner', timestamp);

    // Work/life is a property of each record, not a demo project hierarchy.
    const projects = demo ? [
      { name: '阅读清单', color: '#059669', icon: 'book-open' }
    ].map((project, index) => ({ ...project, id: id(), position: index + 1 })) : [];
    const insertProject = db.prepare(`INSERT INTO projects
      (id,workspace_id,owner_id,name,color,icon,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    projects.forEach(project => insertProject.run(project.id, workspaceId, userId, project.name, project.color, project.icon, project.position, timestamp, timestamp));

    const labelDefinitions = [
      ['工作', '#7c3aed'], ['生活', '#10b981'],
      ...(demo ? [['专注', '#dc2626'], ['五分钟', '#f59e0b'], ['等待', '#64748b'], ['外出', '#0891b2']] : [])
    ];
    const labels = labelDefinitions.map(([labelName, color]) => ({ id: id(), name: labelName, color }));
    const insertLabel = db.prepare(`INSERT INTO labels (id,workspace_id,name,color,is_favorite,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`);
    labels.forEach(label => insertLabel.run(label.id, workspaceId, label.name, label.color, ['工作', '生活'].includes(label.name) ? 1 : 0, timestamp, timestamp));
    const labelByName = new Map(labels.map(label => [label.name, label]));

    const today = new Date();
    const iso = date => date.toISOString().slice(0, 10);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const tasks = demo ? [
      { content: '欢迎使用 FocusFlow', description: '任务、备忘、智能表格和日历都在同一个个人空间中。', project: null, due: iso(today), priority: 1, area: '生活' },
      { content: '整理今天最重要的三件事', description: '', project: null, due: iso(today), priority: 2, area: '生活' },
      { content: '准备周会材料', description: '汇总本周进展与风险。', project: null, due: iso(tomorrow), priority: 2, area: '工作' },
      { content: '每天阅读 20 分钟', description: '', project: projects[0]?.id || null, due: iso(today), priority: 3, recurrence: 'daily', area: '生活' }
    ] : [];
    const insertTask = db.prepare(`INSERT INTO tasks
      (id,workspace_id,project_id,creator_id,content,description,priority,due_date,recurrence_rule,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertTaskLabel = db.prepare('INSERT OR IGNORE INTO task_labels (task_id,label_id) VALUES (?,?)');
    tasks.forEach((task, index) => {
      const taskId = id();
      insertTask.run(taskId, workspaceId, task.project, userId, task.content, task.description, task.priority, task.due, task.recurrence || null, index + 1, timestamp, timestamp);
      const areaLabel = labelByName.get(task.area);
      if (areaLabel) insertTaskLabel.run(taskId, areaLabel.id);
    });

    const filters = [
      ['工作', '@工作', '#7c3aed'],
      ['生活', '@生活', '#10b981'],
      ['高优先级', 'priority:1 | priority:2', '#dc2626'],
      ['无日期任务', 'no date', '#64748b'],
      ['未来 7 天', 'next 7 days', '#2563eb']
    ];
    const insertFilter = db.prepare(`INSERT INTO filters (id,workspace_id,user_id,name,query,color,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`);
    filters.forEach(([filterName, query, color]) => insertFilter.run(id(), workspaceId, userId, filterName, query, color, timestamp, timestamp));
  });
  run();
  return userId;
}
