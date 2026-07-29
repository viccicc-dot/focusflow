import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const dbPath = process.env.DATABASE_PATH || './data/focusflow.db';
const absolutePath = path.resolve(process.cwd(), dbPath);
fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

export const db = new Database(absolutePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const now = () => new Date().toISOString();
export const id = () => randomUUID();

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_url TEXT,
      theme TEXT NOT NULL DEFAULT 'system',
      timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memberships (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('owner','admin','member','guest')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      email TEXT NOT NULL COLLATE NOCASE,
      role TEXT NOT NULL CHECK(role IN ('admin','member','guest')),
      status TEXT NOT NULL DEFAULT 'pending',
      invited_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL REFERENCES users(id),
      parent_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#7c3aed',
      icon TEXT,
      view_mode TEXT NOT NULL DEFAULT 'list' CHECK(view_mode IN ('list','board','calendar')),
      is_favorite INTEGER NOT NULL DEFAULT 0,
      is_shared INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      position REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sections (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      section_id TEXT REFERENCES sections(id) ON DELETE SET NULL,
      parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      creator_id TEXT NOT NULL REFERENCES users(id),
      assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority INTEGER NOT NULL DEFAULT 4 CHECK(priority BETWEEN 1 AND 4),
      due_date TEXT,
      due_time TEXT,
      deadline_date TEXT,
      timezone TEXT,
      recurrence_rule TEXT,
      duration_minutes INTEGER,
      position REAL NOT NULL DEFAULT 0,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);

    CREATE TABLE IF NOT EXISTS task_completions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id),
      completed_at TEXT NOT NULL,
      due_date TEXT
    );

    CREATE TABLE IF NOT EXISTS labels (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#64748b',
      is_favorite INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, name)
    );

    CREATE TABLE IF NOT EXISTS task_labels (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      PRIMARY KEY(task_id, label_id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      remind_at TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'in_app',
      fired_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS filters (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      query TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#64748b',
      is_favorite INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );


    CREATE TABLE IF NOT EXISTS smart_tables (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#7c3aed',
      position REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS smart_fields (
      id TEXT PRIMARY KEY,
      table_id TEXT NOT NULL REFERENCES smart_tables(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      position REAL NOT NULL DEFAULT 0,
      width INTEGER NOT NULL DEFAULT 180,
      hidden INTEGER NOT NULL DEFAULT 0,
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS smart_records (
      id TEXT PRIMARY KEY,
      table_id TEXT NOT NULL REFERENCES smart_tables(id) ON DELETE CASCADE,
      position REAL NOT NULL DEFAULT 0,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS smart_values (
      record_id TEXT NOT NULL REFERENCES smart_records(id) ON DELETE CASCADE,
      field_id TEXT NOT NULL REFERENCES smart_fields(id) ON DELETE CASCADE,
      value_json TEXT NOT NULL DEFAULT 'null',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(record_id, field_id)
    );

    CREATE TABLE IF NOT EXISTS smart_views (
      id TEXT PRIMARY KEY,
      table_id TEXT NOT NULL REFERENCES smart_tables(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'grid',
      config_json TEXT NOT NULL DEFAULT '{}',
      position REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_smart_tables_workspace ON smart_tables(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_smart_fields_table ON smart_fields(table_id);
    CREATE INDEX IF NOT EXISTS idx_smart_records_table ON smart_records(table_id);
    CREATE INDEX IF NOT EXISTS idx_smart_records_task ON smart_records(task_id);


    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      entity_id TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

export function getWorkspaceForUser(userId) {
  return db.prepare(`
    SELECT w.*, m.role
    FROM workspaces w
    JOIN memberships m ON m.workspace_id = w.id
    WHERE m.user_id = ?
    ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, w.created_at
    LIMIT 1
  `).get(userId);
}

export function assertWorkspaceAccess(userId, workspaceId) {
  return db.prepare('SELECT role FROM memberships WHERE user_id = ? AND workspace_id = ?').get(userId, workspaceId);
}

export function taskWithRelations(taskId) {
  const task = db.prepare(`
    SELECT t.*, p.name AS project_name, p.color AS project_color,
           s.name AS section_name,
           u.name AS assignee_name, u.email AS assignee_email
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN sections s ON s.id = t.section_id
    LEFT JOIN users u ON u.id = t.assignee_id
    WHERE t.id = ?
  `).get(taskId);
  if (!task) return null;
  task.labels = db.prepare(`
    SELECT l.* FROM labels l JOIN task_labels tl ON tl.label_id = l.id WHERE tl.task_id = ? ORDER BY l.name
  `).all(taskId);
  task.reminders = db.prepare('SELECT * FROM reminders WHERE task_id = ? ORDER BY remind_at').all(taskId);
  task.comments = db.prepare(`
    SELECT c.*, u.name AS user_name, u.email AS user_email
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.task_id = ? ORDER BY c.created_at
  `).all(taskId);
  task.attachments = db.prepare('SELECT * FROM attachments WHERE task_id = ? ORDER BY created_at').all(taskId);
  task.subtasks = db.prepare('SELECT * FROM tasks WHERE parent_id = ? ORDER BY completed_at IS NOT NULL, position, created_at').all(taskId);
  return task;
}
