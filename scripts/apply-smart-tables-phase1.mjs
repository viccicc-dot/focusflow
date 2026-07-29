import fs from 'node:fs';

function replaceOnce(file, from, to) {
  const source = fs.readFileSync(file, 'utf8');
  if (!source.includes(from)) throw new Error(`Anchor not found in ${file}: ${from.slice(0, 120)}`);
  const next = source.replace(from, to);
  fs.writeFileSync(file, next);
}

const dbSchema = `

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
`;

replaceOnce('server/db.js', `
    CREATE TABLE IF NOT EXISTS notifications (`, `${dbSchema}

    CREATE TABLE IF NOT EXISTS notifications (`);

replaceOnce(
  'server/index.js',
  `import { nextRecurringDate } from './recurrence.js';`,
  `import { nextRecurringDate } from './recurrence.js';\nimport { registerSmartTableRoutes, smartTableSummaries } from './smart-tables.js';`
);
replaceOnce(
  'server/index.js',
  `app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'focusflow', time: now() }));`,
  `registerSmartTableRoutes(app, auth);\n\napp.get('/api/health', (_req, res) => res.json({ ok: true, service: 'focusflow', time: now() }));`
);
replaceOnce(
  'server/index.js',
  `  const notifications = db.prepare('SELECT * FROM notifications WHERE workspace_id=? AND user_id=? ORDER BY created_at DESC LIMIT 50').all(req.workspace.id, req.user.id);\n  res.json({ user: publicUser(req.user), workspace: req.workspace, projects, sections, tasks: hydrateTasks(req.workspace.id), labels, filters, members, notifications });`,
  `  const notifications = db.prepare('SELECT * FROM notifications WHERE workspace_id=? AND user_id=? ORDER BY created_at DESC LIMIT 50').all(req.workspace.id, req.user.id);\n  const smartTables = smartTableSummaries(req.workspace.id);\n  res.json({ user: publicUser(req.user), workspace: req.workspace, projects, sections, tasks: hydrateTasks(req.workspace.id), labels, filters, members, notifications, smartTables });`
);

replaceOnce(
  'client/src/App.jsx',
  `import { api } from './api.js';`,
  `import { api } from './api.js';\nimport { SmartTablePage, UnifiedCalendar } from './SmartTable.jsx';`
);
replaceOnce(
  'client/src/App.jsx',
  `function Sidebar({ data, active, setActive, collapsed, setCollapsed, onQuickAdd, onSearch, onCreateProject, onSettings, onLogout }) {\n  const [projectsOpen, setProjectsOpen] = useState(true);`,
  `function Sidebar({ data, active, setActive, collapsed, setCollapsed, onQuickAdd, onSearch, onCreateProject, onCreateSmartTable, onSettings, onLogout }) {\n  const [projectsOpen, setProjectsOpen] = useState(true);\n  const [tablesOpen, setTablesOpen] = useState(true);`
);
replaceOnce(
  'client/src/App.jsx',
  `    ['inbox','收件箱',Inbox,count(t=>!t.project_id)],\n    ['today','今天',CalendarDays,count(t=>t.due_date && t.due_date<=today)],\n    ['upcoming','预览',CalendarRange,count(t=>t.due_date && t.due_date>today)],`,
  `    ['pending','待处理',Inbox,count(t=>!t.project_id)],\n    ['today','今天',CalendarDays,count(t=>t.due_date && t.due_date<=today)],\n    ['calendar','日历',CalendarRange,count(t=>t.due_date && t.due_date>today)],`
);
replaceOnce(
  'client/src/App.jsx',
  `      </SidebarGroup>\n      <SidebarGroup title="标签"`,
  `      </SidebarGroup>\n      <SidebarGroup title="智能表格" icon={tablesOpen?<ChevronDown/>:<ChevronRight/>} open={tablesOpen} setOpen={setTablesOpen} action={onCreateSmartTable}>\n        {(data.smartTables||[]).map(table=><button key={table.id} className={\`small-nav \${active.type==='smartTable'&&active.id===table.id?'active':''}\`} onClick={()=>setActive({type:'smartTable',id:table.id})}><Columns3 size={15} style={{color:table.color}}/><span>{table.name}</span><em>{table.record_count||0}</em></button>)}\n      </SidebarGroup>\n      <SidebarGroup title="标签"`
);
replaceOnce('client/src/App.jsx', `<span>设置与团队</span>`, `<span>设置</span>`);
replaceOnce('client/src/App.jsx', `创建你的工作空间`, `创建你的个人空间`);
replaceOnce('client/src/App.jsx', `任务、项目和团队协作都集中在一个地方。`, `任务、项目、表格和日历都集中在一个地方。`);
replaceOnce('client/src/App.jsx', `<option value="">收件箱</option>`, `<option value="">待处理</option>`);
replaceOnce(
  'client/src/App.jsx',
  `<button className={tab==='team'?'active':''} onClick={()=>setTab('team')}><Users size={17}/>团队</button>`,
  ``
);
replaceOnce(
  'client/src/App.jsx',
  `  const currentProject=data?.projects.find(p=>p.id===active.id); const currentLabel=data?.labels.find(l=>l.id===active.id); const currentFilter=data?.filters.find(f=>f.id===active.id);`,
  `  const currentProject=data?.projects.find(p=>p.id===active.id); const currentLabel=data?.labels.find(l=>l.id===active.id); const currentFilter=data?.filters.find(f=>f.id===active.id); const currentSmartTable=data?.smartTables?.find(table=>table.id===active.id);`
);
replaceOnce(
  'client/src/App.jsx',
  `switch(active.type){case'inbox':return tasks.filter(t=>!t.project_id&&!t.completed_at);case'today':`,
  `switch(active.type){case'pending':return tasks.filter(t=>!t.project_id&&!t.completed_at);case'today':`
);
replaceOnce(
  'client/src/App.jsx',
  `case'upcoming':return tasks.filter(t=>!t.completed_at&&t.due_date&&t.due_date>today);`,
  `case'calendar':return tasks.filter(t=>!t.completed_at);`
);
replaceOnce(
  'client/src/App.jsx',
  `  const title=active.type==='inbox'?'收件箱':active.type==='today'?'今天':active.type==='upcoming'?'预览':active.type==='completed'?'已完成':currentProject?.name||currentLabel?.name||currentFilter?.name||'任务';`,
  `  const title=active.type==='pending'?'待处理':active.type==='today'?'今天':active.type==='calendar'?'日历':active.type==='smartTable'?currentSmartTable?.name:active.type==='completed'?'已完成':currentProject?.name||currentLabel?.name||currentFilter?.name||'任务';`
);
replaceOnce(
  'client/src/App.jsx',
  `  const viewMode=viewOverride||currentProject?.view_mode||(active.type==='upcoming'?'calendar':'list');`,
  `  const viewMode=viewOverride||currentProject?.view_mode||'list';`
);
replaceOnce(
  'client/src/App.jsx',
  `  const canReorder=active.type==='project'||active.type==='inbox';`,
  `  const canReorder=active.type==='project'||active.type==='pending';`
);
replaceOnce(
  'client/src/App.jsx',
  `  const readNotifications=async()=>{await api('/api/notifications/read',{method:'POST',body:{}});await refresh()};`,
  `  const readNotifications=async()=>{await api('/api/notifications/read',{method:'POST',body:{}});await refresh()};\n  const createSmartTable=async()=>{const name=window.prompt('智能表格名称','我的智能表格');if(!name?.trim())return;try{const result=await api('/api/smart-tables',{method:'POST',body:{name:name.trim()}});await refresh();setActive({type:'smartTable',id:result.table.id});showToast('智能表格已创建')}catch(error){showToast(error.message,'error')}};`
);
replaceOnce(
  'client/src/App.jsx',
  `<Sidebar data={data} active={active} setActive={setActive} collapsed={collapsed} setCollapsed={setCollapsed} onQuickAdd={()=>setQuickOpen(true)} onSearch={()=>setSearchOpen(true)} onCreateProject={()=>setProjectOpen(true)} onSettings={()=>setSettingsOpen(true)} onLogout={logout}/>` ,
  `<Sidebar data={data} active={active} setActive={setActive} collapsed={collapsed} setCollapsed={setCollapsed} onQuickAdd={()=>setQuickOpen(true)} onSearch={()=>setSearchOpen(true)} onCreateProject={()=>setProjectOpen(true)} onCreateSmartTable={createSmartTable} onSettings={()=>setSettingsOpen(true)} onLogout={logout}/>`
);

const oldMain = `    <main className="main-content"><Header title={title} subtitle={subtitle} viewMode={viewMode} setViewMode={setViewOverride} onQuickAdd={()=>setQuickOpen(true)} onMenu={()=>setCollapsed(false)} sidebarCollapsed={collapsed} onNotifications={()=>setNotificationsOpen(!notificationsOpen)} unread={data.notifications.filter(n=>!n.read_at).length}/><div className={\`content-body \${viewMode}\`}>\n      {viewMode==='list'&&<ListView tasks={visible} sections={active.type==='project'?data.sections.filter(s=>s.project_id===active.id):[]} onOpen={setTaskId} onToggle={toggle} onInlineAdd={inlineAdd} projectId={active.type==='project'?active.id:null} onCreateSection={createSection} onMove={moveTask} canReorder={canReorder}/>} \n      {viewMode==='board'&&<BoardView tasks={visible} sections={active.type==='project'?data.sections.filter(s=>s.project_id===active.id):[]} onOpen={setTaskId} onToggle={toggle} onInlineAdd={inlineAdd} onMove={moveTask} canReorder={canReorder}/>} \n      {viewMode==='calendar'&&<CalendarView tasks={visible} onOpen={setTaskId} onToggle={toggle}/>} \n    </div></main>`;
const newMain = `    <main className="main-content">\n      {active.type==='smartTable'&&currentSmartTable\n        ? <SmartTablePage summary={currentSmartTable} showToast={showToast} onChanged={refresh}/>\n        : active.type==='calendar'\n          ? <UnifiedCalendar onOpenTask={setTaskId} onOpenSmartTable={(tableId,recordId)=>setActive({type:'smartTable',id:tableId,recordId})} onQuickAdd={()=>setQuickOpen(true)} showToast={showToast}/>\n          : <><Header title={title} subtitle={subtitle} viewMode={viewMode} setViewMode={setViewOverride} onQuickAdd={()=>setQuickOpen(true)} onMenu={()=>setCollapsed(false)} sidebarCollapsed={collapsed} onNotifications={()=>setNotificationsOpen(!notificationsOpen)} unread={data.notifications.filter(n=>!n.read_at).length}/><div className={\`content-body \${viewMode}\`}>\n              {viewMode==='list'&&<ListView tasks={visible} sections={active.type==='project'?data.sections.filter(s=>s.project_id===active.id):[]} onOpen={setTaskId} onToggle={toggle} onInlineAdd={inlineAdd} projectId={active.type==='project'?active.id:null} onCreateSection={createSection} onMove={moveTask} canReorder={canReorder}/>} \n              {viewMode==='board'&&<BoardView tasks={visible} sections={active.type==='project'?data.sections.filter(s=>s.project_id===active.id):[]} onOpen={setTaskId} onToggle={toggle} onInlineAdd={inlineAdd} onMove={moveTask} canReorder={canReorder}/>} \n              {viewMode==='calendar'&&<CalendarView tasks={visible} onOpen={setTaskId} onToggle={toggle}/>} \n            </div></>}\n    </main>`;
replaceOnce('client/src/App.jsx', oldMain, newMain);

replaceOnce(
  '.github/workflows/ci.yml',
  `          node --check server/seed.js`,
  `          node --check server/seed.js\n          node --check server/smart-tables.js`
);

console.log('Smart tables Phase 1 patch applied successfully.');
