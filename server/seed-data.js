import bcrypt from 'bcryptjs';
import { db, id, now } from './db.js';

export async function createAccount({ email, name, password, demo = false }) {
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

    const projects = [
      { name: '工作', color: '#2563eb', icon: 'briefcase' },
      { name: '个人', color: '#7c3aed', icon: 'home' },
      { name: '阅读清单', color: '#059669', icon: 'book-open' }
    ].map((p, i) => ({ ...p, id: id(), position: i + 1 }));
    const insertProject = db.prepare(`INSERT INTO projects
      (id,workspace_id,owner_id,name,color,icon,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    projects.forEach(p => insertProject.run(p.id, workspaceId, userId, p.name, p.color, p.icon, p.position, timestamp, timestamp));

    const labels = [
      ['专注', '#dc2626'], ['五分钟', '#f59e0b'], ['等待', '#64748b'], ['外出', '#0891b2']
    ].map(([name, color]) => ({ id: id(), name, color }));
    const insertLabel = db.prepare(`INSERT INTO labels (id,workspace_id,name,color,created_at,updated_at) VALUES (?,?,?,?,?,?)`);
    labels.forEach(l => insertLabel.run(l.id, workspaceId, l.name, l.color, timestamp, timestamp));

    const today = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const tasks = demo ? [
      { content: '欢迎使用 FocusFlow', description: '这是一个全栈任务管理应用。点击任务可查看详情、评论、子任务和提醒。', project: projects[1].id, due: iso(today), priority: 1 },
      { content: '整理今天最重要的三件事', description: '', project: null, due: iso(today), priority: 2 },
      { content: '准备周会材料', description: '汇总本周进展与风险。', project: projects[0].id, due: iso(tomorrow), priority: 2 },
      { content: '每天阅读 20 分钟', description: '', project: projects[2].id, due: iso(today), priority: 3, recurrence: 'daily' }
    ] : [];
    const insertTask = db.prepare(`INSERT INTO tasks
      (id,workspace_id,project_id,creator_id,content,description,priority,due_date,recurrence_rule,position,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    tasks.forEach((t, i) => insertTask.run(id(), workspaceId, t.project, userId, t.content, t.description, t.priority, t.due, t.recurrence || null, i + 1, timestamp, timestamp));

    const filters = [
      ['高优先级', 'priority:1 | priority:2', '#dc2626'],
      ['无日期任务', 'no date', '#64748b'],
      ['未来 7 天', 'next 7 days', '#2563eb']
    ];
    const insertFilter = db.prepare(`INSERT INTO filters (id,workspace_id,user_id,name,query,color,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`);
    filters.forEach(([n, q, c]) => insertFilter.run(id(), workspaceId, userId, n, q, c, timestamp, timestamp));
  });
  run();
  return userId;
}
