import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Inbox, CalendarDays, CalendarRange, Search, Plus, ChevronDown, ChevronRight,
  Hash, SlidersHorizontal, Circle, CheckCircle2, Flag, MessageSquare, Paperclip,
  Bell, MoreHorizontal, X, Menu, Sun, Moon, LogOut, Settings, Users, LayoutList,
  Columns3, Calendar, Clock3, Repeat2, Trash2, Edit3, UserRound, Tags, FolderPlus,
  Filter, Check, Loader2, Command, PanelLeftClose, PanelLeftOpen, Sparkles
} from 'lucide-react';
import { addDays, format, isAfter, isBefore, isSameDay, parseISO, startOfDay } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { api } from './api.js';
import { SmartTablePage, UnifiedCalendar } from './SmartTable.jsx';

const todayISO = () => format(new Date(), 'yyyy-MM-dd');
const COLORS = ['#dc2626','#ea580c','#d97706','#65a30d','#059669','#0891b2','#2563eb','#7c3aed','#db2777','#64748b'];
const priorityColor = { 1:'#dc2626', 2:'#f97316', 3:'#2563eb', 4:'#a3a3a3' };

function useToast() {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);
  const show = (message, type='success') => {
    setToast({ message, type });
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setToast(null), 2800);
  };
  return [toast, show];
}

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name:'', email:'demo@focusflow.local', password:'demo1234' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    try {
      await api(`/api/auth/${mode}`, { method:'POST', body:form });
      onAuth();
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  return <div className="auth-page">
    <div className="auth-brand"><div className="brand-mark"><Check size={24}/></div><span>FocusFlow</span></div>
    <div className="auth-card">
      <div className="auth-icon"><Sparkles size={26}/></div>
      <h1>{mode === 'login' ? '欢迎回来' : '创建你的个人空间'}</h1>
      <p>{mode === 'login' ? '登录后继续整理工作与生活。' : '任务、项目、表格和日历都集中在一个地方。'}</p>
      <form onSubmit={submit}>
        {mode === 'register' && <label>姓名<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="你的名字" required /></label>}
        <label>邮箱<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="name@example.com" required /></label>
        <label>密码<input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} minLength={8} required /></label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary full" disabled={loading}>{loading ? <Loader2 className="spin" size={18}/> : null}{mode === 'login' ? '登录' : '注册并开始'}</button>
      </form>
      <button className="text-button" onClick={()=>{setMode(mode==='login'?'register':'login');setError('')}}>{mode === 'login' ? '没有账号？创建账号' : '已有账号？返回登录'}</button>
      <div className="demo-note">演示账号：demo@focusflow.local / demo1234</div>
    </div>
  </div>;
}

function Sidebar({ data, active, setActive, collapsed, setCollapsed, onQuickAdd, onSearch, onCreateProject, onCreateSmartTable, onSettings, onLogout }) {
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [tablesOpen, setTablesOpen] = useState(true);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const rootProjects = data.projects.filter(p=>!p.parent_id);
  const count = (fn) => data.tasks.filter(t=>!t.completed_at && !t.parent_id && fn(t)).length;
  const today = todayISO();
  const nav = [
    ['search','搜索',Search,0,onSearch],
    ['pending','待处理',Inbox,count(t=>!t.project_id)],
    ['today','今天',CalendarDays,count(t=>t.due_date && t.due_date<=today)],
    ['calendar','日历',CalendarRange,count(t=>t.due_date && t.due_date>today)],
  ];
  return <aside className={`sidebar ${collapsed?'collapsed':''}`}>
    <div className="sidebar-top">
      <button className="account-button" onClick={onSettings} title="设置">
        <span className="avatar">{data.user.name.slice(0,1).toUpperCase()}</span>
        {!collapsed && <><span className="account-name">{data.user.name}</span><ChevronDown size={14}/></>}
      </button>
      <button className="icon-button" onClick={()=>setCollapsed(!collapsed)} title={collapsed?'展开侧栏':'收起侧栏'}>{collapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}</button>
    </div>
    <button className="add-task-sidebar" onClick={onQuickAdd}><span><Plus size={18}/></span>{!collapsed && '添加任务'}</button>
    <nav>
      {nav.map(([key,label,Icon,badge,handler])=><button key={key} className={`nav-item ${active.type===key?'active':''}`} onClick={()=>handler?handler():setActive({type:key})} title={collapsed?label:''}>
        <Icon size={19}/>{!collapsed&&<><span>{label}</span>{badge>0&&<em>{badge}</em>}</>}
      </button>)}
      <button className={`nav-item ${active.type==='completed'?'active':''}`} onClick={()=>setActive({type:'completed'})}><CheckCircle2 size={19}/>{!collapsed&&<span>已完成</span>}</button>
    </nav>
    {!collapsed && <div className="sidebar-scroll">
      <SidebarGroup title="我的项目" icon={projectsOpen?<ChevronDown/>:<ChevronRight/>} open={projectsOpen} setOpen={setProjectsOpen} action={onCreateProject}>
        {rootProjects.map(p=><ProjectTree key={p.id} project={p} projects={data.projects} active={active} setActive={setActive}/>) }
      </SidebarGroup>
      <SidebarGroup title="智能表格" icon={tablesOpen?<ChevronDown/>:<ChevronRight/>} open={tablesOpen} setOpen={setTablesOpen} action={onCreateSmartTable}>
        {(data.smartTables||[]).map(table=><button key={table.id} className={`small-nav ${active.type==='smartTable'&&active.id===table.id?'active':''}`} onClick={()=>setActive({type:'smartTable',id:table.id})}><Columns3 size={15} style={{color:table.color}}/><span>{table.name}</span><em>{table.record_count||0}</em></button>)}
      </SidebarGroup>
      <SidebarGroup title="标签" icon={labelsOpen?<ChevronDown/>:<ChevronRight/>} open={labelsOpen} setOpen={setLabelsOpen}>
        {data.labels.map(l=><button key={l.id} className={`small-nav ${active.type==='label'&&active.id===l.id?'active':''}`} onClick={()=>setActive({type:'label',id:l.id})}><Hash size={15} style={{color:l.color}}/><span>{l.name}</span></button>)}
      </SidebarGroup>
      <SidebarGroup title="筛选器" icon={filtersOpen?<ChevronDown/>:<ChevronRight/>} open={filtersOpen} setOpen={setFiltersOpen}>
        {data.filters.map(f=><button key={f.id} className={`small-nav ${active.type==='filter'&&active.id===f.id?'active':''}`} onClick={()=>setActive({type:'filter',id:f.id})}><SlidersHorizontal size={15} style={{color:f.color}}/><span>{f.name}</span></button>)}
      </SidebarGroup>
    </div>}
    <div className="sidebar-bottom">
      <button className="nav-item" onClick={onSettings}><Settings size={18}/>{!collapsed&&<span>设置</span>}</button>
      <button className="nav-item" onClick={onLogout}><LogOut size={18}/>{!collapsed&&<span>退出登录</span>}</button>
    </div>
  </aside>;
}

function SidebarGroup({title,icon,open,setOpen,action,children}) {
  return <div className="sidebar-group"><div className="group-heading"><button onClick={()=>setOpen(!open)}>{React.cloneElement(icon,{size:15})}<span>{title}</span></button>{action&&<button className="tiny-icon" onClick={action}><Plus size={15}/></button>}</div>{open&&<div className="group-body">{children}</div>}</div>
}
function ProjectTree({project,projects,active,setActive,depth=0}) {
  const children=projects.filter(p=>p.parent_id===project.id);
  return <><button className={`small-nav ${active.type==='project'&&active.id===project.id?'active':''}`} style={{paddingLeft:10+depth*14}} onClick={()=>setActive({type:'project',id:project.id})}><span className="project-dot" style={{background:project.color}}/><span>{project.name}</span></button>{children.map(c=><ProjectTree key={c.id} project={c} projects={projects} active={active} setActive={setActive} depth={depth+1}/>)}</>;
}

function parseQuickText(text, data) {
  let content = text.trim();
  const result = { content, priority:4, due_date:null, project_id:null, label_ids:[], recurrence_rule:null };
  const projectMatch = content.match(/#([^\s]+)/);
  if (projectMatch) { const p=data.projects.find(x=>x.name===projectMatch[1]); if(p){result.project_id=p.id;content=content.replace(projectMatch[0],'').trim();} }
  const labelMatches=[...content.matchAll(/@([^\s]+)/g)];
  for(const m of labelMatches){const l=data.labels.find(x=>x.name===m[1]);if(l){result.label_ids.push(l.id);content=content.replace(m[0],'').trim();}}
  const pm=content.match(/(?:^|\s)p([1-4])(?:\s|$)/i);if(pm){result.priority=Number(pm[1]);content=content.replace(pm[0],' ').trim();}
  if(/今天/.test(content)){result.due_date=todayISO();content=content.replace('今天','').trim();}
  if(/明天/.test(content)){result.due_date=format(addDays(new Date(),1),'yyyy-MM-dd');content=content.replace('明天','').trim();}
  if(/后天/.test(content)){result.due_date=format(addDays(new Date(),2),'yyyy-MM-dd');content=content.replace('后天','').trim();}
  const dateMatch=content.match(/\b(\d{4}-\d{2}-\d{2})\b/);if(dateMatch){result.due_date=dateMatch[1];content=content.replace(dateMatch[0],'').trim();}
  const recurs=[['每天','daily'],['每周','weekly'],['每月','monthly'],['每年','yearly'],['工作日','weekdays']];
  for(const [word,rule] of recurs){if(content.includes(word)){result.recurrence_rule=rule;content=content.replace(word,'').trim();break;}}
  result.content=content||text.trim(); return result;
}

function QuickAdd({open,onClose,data,onCreated,defaultProjectId}) {
  const [text,setText]=useState(''); const [details,setDetails]=useState({project_id:defaultProjectId||null,due_date:null,priority:4,label_ids:[]}); const [saving,setSaving]=useState(false); const input=useRef();
  useEffect(()=>{if(open){setText('');setDetails({project_id:defaultProjectId||null,due_date:null,priority:4,label_ids:[]});setTimeout(()=>input.current?.focus(),30)}},[open,defaultProjectId]);
  if(!open)return null;
  const submit=async(e)=>{e.preventDefault();if(!text.trim())return;setSaving(true);try{const parsed=parseQuickText(text,data);const payload={...parsed,...details,project_id:details.project_id||parsed.project_id,due_date:details.due_date||parsed.due_date,priority:details.priority!==4?details.priority:parsed.priority,label_ids:[...new Set([...(parsed.label_ids||[]),...(details.label_ids||[])])]};const r=await api('/api/tasks',{method:'POST',body:payload});onCreated(r.task);onClose();}finally{setSaving(false)}};
  return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><form className="quick-add" onSubmit={submit}>
    <div className="quick-input-wrap"><input ref={input} value={text} onChange={e=>setText(e.target.value)} placeholder="例如：准备周会 明天 #工作 @专注 p1"/><span className="kbd">Esc</span></div>
    <div className="quick-help">支持：今天 / 明天 / 2026-08-01 / 每周 / #项目 / @标签 / p1</div>
    <div className="quick-controls">
      <input type="date" value={details.due_date||''} onChange={e=>setDetails({...details,due_date:e.target.value||null})}/>
      <select value={details.project_id||''} onChange={e=>setDetails({...details,project_id:e.target.value||null})}><option value="">待处理</option>{data.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <select value={details.priority} onChange={e=>setDetails({...details,priority:Number(e.target.value)})}>{[1,2,3,4].map(p=><option key={p} value={p}>优先级 {p}</option>)}</select>
      <button className="primary" disabled={saving}>{saving?<Loader2 size={17} className="spin"/>:'添加任务'}</button>
    </div>
  </form></div>;
}

function Header({title,subtitle,viewMode,setViewMode,onQuickAdd,onMenu,sidebarCollapsed,onNotifications,unread}) {
  return <header className="content-header"><div className="header-left">{sidebarCollapsed&&<button className="icon-button mobile-menu" onClick={onMenu}><Menu size={20}/></button>}<div><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div></div><div className="header-actions"><div className="view-switch"><button className={viewMode==='list'?'active':''} onClick={()=>setViewMode('list')} title="列表"><LayoutList size={17}/></button><button className={viewMode==='board'?'active':''} onClick={()=>setViewMode('board')} title="看板"><Columns3 size={17}/></button><button className={viewMode==='calendar'?'active':''} onClick={()=>setViewMode('calendar')} title="日历"><Calendar size={17}/></button></div><button className="primary compact" onClick={onQuickAdd}><Plus size={17}/>添加任务</button><button className="icon-button notification-button" onClick={onNotifications}><Bell size={18}/>{unread>0&&<span>{unread>9?'9+':unread}</span>}</button><button className="icon-button"><MoreHorizontal size={19}/></button></div></header>;
}

function TaskCheckbox({task,onToggle}) { return <button className="task-check" style={{borderColor:priorityColor[task.priority]}} onClick={e=>{e.stopPropagation();onToggle(task)}}>{task.completed_at&&<Check size={14}/>}</button>; }
function TaskMeta({task}) { return <div className="task-meta">{task.due_date&&<span className={task.due_date<todayISO()&&!task.completed_at?'overdue':''}><CalendarDays size={13}/>{format(parseISO(task.due_date),'M月d日',{locale:zhCN})}{task.due_time&&` ${task.due_time}`}</span>}{task.recurrence_rule&&<span><Repeat2 size={13}/>{task.recurrence_rule}</span>}{task.duration_minutes&&<span><Clock3 size={13}/>{task.duration_minutes} 分钟</span>}{task.labels?.map(l=><span key={l.id}><Hash size={12} style={{color:l.color}}/>{l.name}</span>)}{task.project_name&&<span className="push-right"><span className="project-dot tiny" style={{background:task.project_color}}/>{task.project_name}</span>}</div>; }
function TaskRow({task,onOpen,onToggle,drag}) {
  return <div
    className={`task-row ${task.completed_at?'completed':''} ${drag?.dragging?'dragging':''} ${drag?.dropPosition?`drop-${drag.dropPosition}`:''}`}
    draggable={Boolean(drag?.enabled)}
    onDragStart={drag?.onDragStart}
    onDragEnd={drag?.onDragEnd}
    onDragOver={drag?.onDragOver}
    onDrop={drag?.onDrop}
    onClick={()=>onOpen(task.id)}
  ><TaskCheckbox task={task} onToggle={onToggle}/><div className="task-content"><div className="task-title">{task.content}</div>{task.description&&<div className="task-description">{task.description}</div>}<TaskMeta task={task}/></div><div className="task-hover"><button><Edit3 size={16}/></button><button><MoreHorizontal size={17}/></button></div></div>;
}

function useTaskDrag(onMove,enabled) {
  const [draggingId,setDraggingId]=useState(null);
  const [over,setOver]=useState(null);
  const start=(event,id)=>{if(!enabled)return;setDraggingId(id);event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',id)};
  const end=()=>{setDraggingId(null);setOver(null)};
  const overRow=(event,id)=>{if(!enabled||!draggingId||draggingId===id)return;event.preventDefault();event.stopPropagation();const rect=event.currentTarget.getBoundingClientRect();setOver({id,position:event.clientY<rect.top+rect.height/2?'before':'after'})};
  const dropRow=(event,items,sectionId,targetId)=>{if(!enabled)return;event.preventDefault();event.stopPropagation();const id=draggingId||event.dataTransfer.getData('text/plain');if(!id||id===targetId)return end();const candidates=items.filter(item=>item.id!==id);const targetIndex=candidates.findIndex(item=>item.id===targetId);const position=over?.id===targetId&&over.position==='after'?targetIndex+1:targetIndex;onMove(id,sectionId,Math.max(0,position));end()};
  const dropEnd=(event,sectionId,items)=>{if(!enabled)return;event.preventDefault();event.stopPropagation();const id=draggingId||event.dataTransfer.getData('text/plain');if(id)onMove(id,sectionId,items.filter(item=>item.id!==id).length);end()};
  return {draggingId,over,start,end,overRow,dropRow,dropEnd};
}

function DraggableRows({items,sectionId,onOpen,onToggle,canReorder,drag}) {
  return <>{items.map(task=><TaskRow key={task.id} task={task} onOpen={onOpen} onToggle={onToggle} drag={{enabled:canReorder,dragging:drag.draggingId===task.id,dropPosition:drag.over?.id===task.id?drag.over.position:null,onDragStart:e=>drag.start(e,task.id),onDragEnd:drag.end,onDragOver:e=>drag.overRow(e,task.id),onDrop:e=>drag.dropRow(e,items,sectionId,task.id)}}/>)}<div className={`task-drop-zone ${drag.draggingId?'active':''}`} onDragOver={e=>{if(canReorder)e.preventDefault()}} onDrop={e=>drag.dropEnd(e,sectionId,items)}>拖到这里移到末尾</div></>;
}

function ListView({tasks,sections,onOpen,onToggle,onInlineAdd,projectId,onCreateSection,onMove,canReorder}) {
  const top=tasks.filter(t=>!t.parent_id).sort((a,b)=>a.position-b.position);
  const drag=useTaskDrag(onMove,canReorder);
  const renderSection=(sectionId,name,showCount=true)=>{const items=top.filter(t=>(t.section_id||null)===(sectionId||null));return <section key={sectionId||'none'} className="task-section"><h3>{name}{showCount&&<span>{items.length}</span>}</h3><DraggableRows items={items} sectionId={sectionId} onOpen={onOpen} onToggle={onToggle} canReorder={canReorder} drag={drag}/><InlineAdd onAdd={content=>onInlineAdd(content,sectionId)}/></section>};
  if(projectId&&sections.length){return <div className="sections-list">{sections.map(s=>renderSection(s.id,s.name))}{renderSection(null,'无分区')}<button className="section-add" onClick={onCreateSection}><Plus size={15}/>添加分区</button></div>}
  return <div className="task-list">{projectId&&<button className="section-add" onClick={onCreateSection}><Plus size={15}/>添加分区</button>}<DraggableRows items={top} sectionId={null} onOpen={onOpen} onToggle={onToggle} canReorder={canReorder} drag={drag}/><InlineAdd onAdd={c=>onInlineAdd(c,null)}/>{!top.length&&<EmptyState/>}</div>;
}
function InlineAdd({onAdd}) { const [editing,setEditing]=useState(false),[text,setText]=useState(''); const save=async()=>{if(!text.trim()){setEditing(false);return;}await onAdd(text);setText('');setEditing(false)}; return editing?<div className="inline-add editing"><Circle size={18}/><input autoFocus value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')save();if(e.key==='Escape')setEditing(false)}} onBlur={save} placeholder="任务名称"/></div>:<button className="inline-add" onClick={()=>setEditing(true)}><Plus size={17}/><span>添加任务</span></button>; }
function EmptyState(){return <div className="empty-state"><div><CheckCircle2 size={34}/></div><h3>一切井然有序</h3><p>这里暂时没有任务。添加一项新任务开始规划。</p></div>}

function BoardColumn({section,items,onOpen,onToggle,onInlineAdd,canReorder,drag}) {
  const sectionId=section.id==='none'?null:section.id;
  return <div className={`board-column ${drag.draggingId?'drag-active':''}`} key={section.id} onDragOver={e=>{if(canReorder)e.preventDefault()}} onDrop={e=>drag.dropEnd(e,sectionId,items)}><div className="board-title"><span>{section.name}</span><em>{items.length}</em><MoreHorizontal size={16}/></div>{items.map(task=><div className={`task-card ${drag.draggingId===task.id?'dragging':''} ${drag.over?.id===task.id?`drop-${drag.over.position}`:''}`} key={task.id} draggable={canReorder} onDragStart={e=>drag.start(e,task.id)} onDragEnd={drag.end} onDragOver={e=>drag.overRow(e,task.id)} onDrop={e=>drag.dropRow(e,items,sectionId,task.id)} onClick={()=>onOpen(task.id)}><div className="card-top"><TaskCheckbox task={task} onToggle={onToggle}/><span>{task.content}</span></div>{task.description&&<p>{task.description}</p>}<TaskMeta task={task}/></div>)}<div className={`board-drop-zone ${drag.draggingId?'active':''}`}>拖到这里移到末尾</div><InlineAdd onAdd={c=>onInlineAdd(c,sectionId)}/></div>;
}
function BoardView({tasks,sections,onOpen,onToggle,onInlineAdd,onMove,canReorder}) {
  const top=tasks.filter(t=>!t.parent_id).sort((a,b)=>a.position-b.position);
  const drag=useTaskDrag(onMove,canReorder);
  const hasUnsectioned=top.some(t=>!t.section_id);
  const cols=sections.length?[...sections,...(hasUnsectioned?[{id:'none',name:'无分区'}]:[])]:[{id:'none',name:'任务'}];
  return <div className="board">{cols.map(section=>{const items=top.filter(t=>section.id==='none'?!t.section_id:t.section_id===section.id);return <BoardColumn key={section.id} section={section} items={items} onOpen={onOpen} onToggle={onToggle} onInlineAdd={onInlineAdd} canReorder={canReorder} drag={drag}/>})}</div>;
}
function CalendarView({tasks,onOpen,onToggle}) {
  const days=Array.from({length:14},(_,i)=>addDays(startOfDay(new Date()),i));
  return <div className="calendar-grid">{days.map(d=>{const iso=format(d,'yyyy-MM-dd');const items=tasks.filter(t=>!t.parent_id&&t.due_date===iso);return <div className={`calendar-day ${isSameDay(d,new Date())?'today-cell':''}`} key={iso}><div className="calendar-date"><span>{format(d,'EEE',{locale:zhCN})}</span><strong>{format(d,'d')}</strong></div><div className="calendar-tasks">{items.map(t=><button key={t.id} onClick={()=>onOpen(t.id)}><span style={{background:priorityColor[t.priority]}}/>{t.content}</button>)}</div></div>})}</div>;
}

function SearchOverlay({open,onClose,data,onOpen}) {
  const [q,setQ]=useState(''); const input=useRef();
  useEffect(()=>{if(open){setQ('');setTimeout(()=>input.current?.focus(),20)}},[open]);
  const results=useMemo(()=>{const s=q.toLowerCase().trim();if(!s)return [];return data.tasks.filter(t=>t.content.toLowerCase().includes(s)||t.description.toLowerCase().includes(s)||t.labels?.some(l=>l.name.toLowerCase().includes(s))).slice(0,30)},[q,data.tasks]);
  if(!open)return null; return <div className="modal-backdrop search-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className="search-panel"><div className="search-box"><Search size={20}/><input ref={input} value={q} onChange={e=>setQ(e.target.value)} placeholder="搜索任务、描述或标签"/><span className="kbd">Esc</span></div><div className="search-results">{q&&!results.length&&<p className="muted center">没有找到匹配任务</p>}{results.map(t=><button key={t.id} onClick={()=>{onOpen(t.id);onClose()}}><Circle size={16}/><div><strong>{t.content}</strong><span>{t.project_name||'收件箱'} · {t.due_date||'无日期'}</span></div></button>)}</div></div></div>;
}

function NotificationPanel({open,onClose,notifications,onOpenTask,onRead}) {
  if(!open)return null;
  return <div className="notification-popover"><div className="notification-head"><strong>通知</strong><button onClick={onRead}>全部已读</button></div><div className="notification-list">{!notifications.length&&<p>暂时没有通知</p>}{notifications.map(n=><button key={n.id} className={n.read_at?'':'unread'} onClick={()=>{n.entity_id&&onOpenTask(n.entity_id);onClose()}}><span><Bell size={15}/></span><div><strong>{n.title}</strong><p>{n.body}</p><time>{format(new Date(n.created_at),'M月d日 HH:mm')}</time></div></button>)}</div></div>;
}

function TaskDrawer({taskId,data,onClose,onRefresh,showToast}) {
  const [task,setTask]=useState(null),[loading,setLoading]=useState(true),[comment,setComment]=useState(''),[saving,setSaving]=useState(false); const fileRef=useRef();
  const load=async()=>{setLoading(true);try{const r=await api(`/api/tasks/${taskId}`);setTask(r.task)}finally{setLoading(false)}};
  useEffect(()=>{load()},[taskId]);
  if(!taskId)return null;
  const save=async(patch)=>{setSaving(true);try{const r=await api(`/api/tasks/${task.id}`,{method:'PATCH',body:patch});setTask(r.task);await onRefresh();showToast('任务已保存')}catch(e){showToast(e.message,'error')}finally{setSaving(false)}};
  const remove=async()=>{if(!confirm('确定删除此任务？'))return;await api(`/api/tasks/${task.id}`,{method:'DELETE'});await onRefresh();onClose();showToast('任务已删除')};
  const addComment=async()=>{if(!comment.trim())return;const r=await api(`/api/tasks/${task.id}/comments`,{method:'POST',body:{body:comment}});setTask({...task,comments:[...(task.comments||[]),r.comment]});setComment('')};
  const addSubtask=async(content)=>{const r=await api('/api/tasks',{method:'POST',body:{content,parent_id:task.id,project_id:task.project_id}});setTask({...task,subtasks:[...(task.subtasks||[]),r.task]});onRefresh()};
  const uploadFile=async(file)=>{const form=new FormData();form.append('file',file);const r=await api(`/api/tasks/${task.id}/attachments`,{method:'POST',body:form});setTask({...task,attachments:[...(task.attachments||[]),r.attachment]});showToast('附件已上传')};
  const addReminder=async()=>{const input=prompt('输入提醒时间，例如 2026-08-01T09:00');if(!input)return;const r=await api(`/api/tasks/${task.id}/reminders`,{method:'POST',body:{remind_at:input}});setTask({...task,reminders:[...(task.reminders||[]),r.reminder]})};
  return <div className="drawer-shell"><div className="drawer-backdrop" onClick={onClose}/><aside className="task-drawer">
    <div className="drawer-toolbar"><button className="icon-button" onClick={onClose}><X size={20}/></button><div><button className="icon-button" onClick={()=>fileRef.current?.click()}><Paperclip size={18}/></button><button className="icon-button" onClick={addReminder}><Bell size={18}/></button><button className="icon-button danger" onClick={remove}><Trash2 size={18}/></button></div></div>
    {loading?<div className="drawer-loading"><Loader2 className="spin"/></div>:task&&<div className="drawer-content">
      <div className="drawer-main">
        <div className="task-editor-title"><TaskCheckbox task={task} onToggle={async()=>{await api(`/api/tasks/${task.id}/${task.completed_at?'uncomplete':'complete'}`,{method:'POST'});load();onRefresh()}}/><textarea value={task.content} onChange={e=>setTask({...task,content:e.target.value})} onBlur={()=>save({content:task.content})}/></div>
        <textarea className="description-editor" value={task.description||''} onChange={e=>setTask({...task,description:e.target.value})} onBlur={()=>save({description:task.description})} placeholder="添加描述……"/>
        <section className="drawer-section"><h3>子任务 <span>{task.subtasks?.length||0}</span></h3>{task.subtasks?.map(st=><TaskRow key={st.id} task={st} onOpen={()=>{}} onToggle={async()=>{await api(`/api/tasks/${st.id}/${st.completed_at?'uncomplete':'complete'}`,{method:'POST'});load();onRefresh()}}/>)}<InlineAdd onAdd={addSubtask}/></section>
        <section className="drawer-section"><h3><MessageSquare size={17}/>评论</h3><div className="comments">{task.comments?.map(c=><div className="comment" key={c.id}><span className="avatar small">{c.user_name.slice(0,1)}</span><div><strong>{c.user_name}<time>{format(new Date(c.created_at),'M月d日 HH:mm')}</time></strong><p>{c.body}</p></div></div>)}</div><div className="comment-box"><span className="avatar small">{data.user.name.slice(0,1)}</span><textarea value={comment} onChange={e=>setComment(e.target.value)} placeholder="写评论……"/><button className="primary compact" onClick={addComment}>发送</button></div></section>
      </div>
      <div className="drawer-side">
        <Field label="项目"><select value={task.project_id||''} onChange={e=>{const v=e.target.value||null;setTask({...task,project_id:v,section_id:null});save({project_id:v,section_id:null})}}><option value="">收件箱</option>{data.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        {task.project_id&&<Field label="分区"><select value={task.section_id||''} onChange={e=>{const v=e.target.value||null;setTask({...task,section_id:v});save({section_id:v})}}><option value="">无分区</option>{data.sections.filter(s=>s.project_id===task.project_id).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
        <Field label="日期"><input type="date" value={task.due_date||''} onChange={e=>{const v=e.target.value||null;setTask({...task,due_date:v});save({due_date:v})}}/></Field>
        <Field label="截止日期"><input type="date" value={task.deadline_date||''} onChange={e=>{const v=e.target.value||null;setTask({...task,deadline_date:v});save({deadline_date:v})}}/></Field>
        <Field label="优先级"><select value={task.priority} onChange={e=>{const v=Number(e.target.value);setTask({...task,priority:v});save({priority:v})}}>{[1,2,3,4].map(p=><option key={p} value={p}>P{p}</option>)}</select></Field>
        <Field label="负责人"><select value={task.assignee_id||''} onChange={e=>{const v=e.target.value||null;setTask({...task,assignee_id:v});save({assignee_id:v})}}><option value="">未分配</option>{data.members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
        <Field label="重复"><select value={task.recurrence_rule||''} onChange={e=>{const v=e.target.value||null;setTask({...task,recurrence_rule:v});save({recurrence_rule:v})}}><option value="">不重复</option><option value="daily">每天</option><option value="weekdays">工作日</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="yearly">每年</option></select></Field>
        <Field label="时长"><input type="number" min="0" step="5" value={task.duration_minutes||''} onChange={e=>setTask({...task,duration_minutes:e.target.value})} onBlur={()=>save({duration_minutes:task.duration_minutes?Number(task.duration_minutes):null})} placeholder="分钟"/></Field>
        <Field label="标签"><div className="label-picker">{data.labels.map(l=><button key={l.id} className={task.labels?.some(x=>x.id===l.id)?'selected':''} onClick={()=>{const ids=task.labels?.some(x=>x.id===l.id)?task.labels.filter(x=>x.id!==l.id).map(x=>x.id):[...(task.labels||[]).map(x=>x.id),l.id];setTask({...task,labels:data.labels.filter(x=>ids.includes(x.id))});save({label_ids:ids})}}><span style={{background:l.color}}/>{l.name}</button>)}</div></Field>
        {(task.reminders?.length>0)&&<Field label="提醒"><div className="side-list">{task.reminders.map(r=><div key={r.id}><Bell size={13}/>{format(new Date(r.remind_at),'M月d日 HH:mm')}</div>)}</div></Field>}
        {(task.attachments?.length>0)&&<Field label="附件"><div className="side-list">{task.attachments.map(a=><a key={a.id} href={`/uploads/${a.stored_name}`} target="_blank"><Paperclip size={13}/>{a.original_name}</a>)}</div></Field>}
      </div>
      <input ref={fileRef} hidden type="file" onChange={e=>e.target.files[0]&&uploadFile(e.target.files[0])}/>
      {saving&&<div className="save-indicator"><Loader2 size={13} className="spin"/>保存中</div>}
    </div>}
  </aside></div>;
}
function Field({label,children}){return <div className="field"><label>{label}</label>{children}</div>}

function ProjectModal({open,onClose,data,onSaved}) {
  const [form,setForm]=useState({name:'',color:COLORS[6],view_mode:'list',parent_id:''});
  useEffect(()=>{if(open)setForm({name:'',color:COLORS[6],view_mode:'list',parent_id:''})},[open]);
  if(!open)return null; const submit=async(e)=>{e.preventDefault();const r=await api('/api/projects',{method:'POST',body:{...form,parent_id:form.parent_id||null}});onSaved(r.project);onClose()};
  return <Modal title="新建项目" onClose={onClose}><form className="stack-form" onSubmit={submit}><label>项目名称<input autoFocus value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required/></label><label>颜色<div className="color-row">{COLORS.map(c=><button type="button" key={c} className={form.color===c?'selected':''} style={{background:c}} onClick={()=>setForm({...form,color:c})}/>)}</div></label><label>默认布局<select value={form.view_mode} onChange={e=>setForm({...form,view_mode:e.target.value})}><option value="list">列表</option><option value="board">看板</option><option value="calendar">日历</option></select></label><label>父项目<select value={form.parent_id} onChange={e=>setForm({...form,parent_id:e.target.value})}><option value="">无</option>{data.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>取消</button><button className="primary">创建项目</button></div></form></Modal>;
}
function SettingsModal({open,onClose,data,onRefresh,onTheme,onLogout,showToast}) {
  const [tab,setTab]=useState('profile'); const [profile,setProfile]=useState({name:data.user.name,theme:data.user.theme||'system',timezone:data.user.timezone||'Asia/Tokyo'}); const [invite,setInvite]=useState({email:'',role:'member'}); const [label,setLabel]=useState({name:'',color:COLORS[9]}); const [filter,setFilter]=useState({name:'',query:'',color:COLORS[6]});
  if(!open)return null;
  const saveProfile=async()=>{await api('/api/profile',{method:'PATCH',body:profile});onTheme(profile.theme);await onRefresh();showToast('设置已保存')};
  const inviteMember=async()=>{const r=await api('/api/team/invite',{method:'POST',body:invite});setInvite({email:'',role:'member'});await onRefresh();showToast(r.joined?'成员已加入':'邀请已记录；接入邮件服务后可自动发送')};
  const createLabel=async()=>{await api('/api/labels',{method:'POST',body:label});setLabel({name:'',color:COLORS[9]});await onRefresh()};
  const createFilter=async()=>{await api('/api/filters',{method:'POST',body:filter});setFilter({name:'',query:'',color:COLORS[6]});await onRefresh()};
  return <Modal title="设置" onClose={onClose} wide><div className="settings-layout"><nav><button className={tab==='profile'?'active':''} onClick={()=>setTab('profile')}><UserRound size={17}/>账户与外观</button><button className={tab==='labels'?'active':''} onClick={()=>setTab('labels')}><Tags size={17}/>标签</button><button className={tab==='filters'?'active':''} onClick={()=>setTab('filters')}><Filter size={17}/>筛选器</button><button onClick={onLogout}><LogOut size={17}/>退出登录</button></nav><div className="settings-content">
    {tab==='profile'&&<><h2>账户与外观</h2><div className="stack-form"><label>姓名<input value={profile.name} onChange={e=>setProfile({...profile,name:e.target.value})}/></label><label>主题<select value={profile.theme} onChange={e=>setProfile({...profile,theme:e.target.value})}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label><label>时区<input value={profile.timezone} onChange={e=>setProfile({...profile,timezone:e.target.value})}/></label><button className="primary fit" onClick={saveProfile}>保存设置</button></div></>}
    {tab==='team'&&<><h2>团队成员</h2><div className="member-list">{data.members.map(m=><div key={m.id}><span className="avatar">{m.name.slice(0,1)}</span><div><strong>{m.name}</strong><small>{m.email}</small></div><em>{m.role}</em></div>)}</div><h3>邀请成员</h3><div className="inline-form"><input type="email" value={invite.email} onChange={e=>setInvite({...invite,email:e.target.value})} placeholder="member@example.com"/><select value={invite.role} onChange={e=>setInvite({...invite,role:e.target.value})}><option value="member">成员</option><option value="admin">管理员</option><option value="guest">访客</option></select><button className="primary" onClick={inviteMember}>邀请</button></div><p className="muted">未接入邮件服务时，邀请会保存在数据库中；已注册用户会立即加入。</p></>}
    {tab==='labels'&&<><h2>标签</h2><div className="chip-list">{data.labels.map(l=><span key={l.id}><i style={{background:l.color}}/>@{l.name}</span>)}</div><h3>新建标签</h3><div className="inline-form"><input value={label.name} onChange={e=>setLabel({...label,name:e.target.value})} placeholder="标签名称"/><input type="color" value={label.color} onChange={e=>setLabel({...label,color:e.target.value})}/><button className="primary" onClick={createLabel}>添加</button></div></>}
    {tab==='filters'&&<><h2>筛选器</h2><div className="filter-list">{data.filters.map(f=><div key={f.id}><SlidersHorizontal size={16} style={{color:f.color}}/><strong>{f.name}</strong><code>{f.query}</code></div>)}</div><h3>新建筛选器</h3><div className="stack-form"><label>名称<input value={filter.name} onChange={e=>setFilter({...filter,name:e.target.value})}/></label><label>查询<input value={filter.query} onChange={e=>setFilter({...filter,query:e.target.value})} placeholder="例如 priority:1 | today | no date"/></label><button className="primary fit" onClick={createFilter}>创建筛选器</button></div></>}
  </div></div></Modal>;
}
function Modal({title,onClose,children,wide}) { return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className={`modal ${wide?'wide':''}`}><div className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose}><X size={19}/></button></div>{children}</div></div> }
function Toast({toast}){if(!toast)return null;return <div className={`toast ${toast.type}`}><CheckCircle2 size={17}/>{toast.message}</div>}

function applyFilterQuery(tasks, query, data) {
  const q=query.toLowerCase(); const today=todayISO();
  return tasks.filter(t=>{
    const clauses=q.split('|').map(s=>s.trim());
    return clauses.some(c=>{
      if(c==='today')return t.due_date===today;
      if(c==='overdue')return t.due_date&&t.due_date<today&&!t.completed_at;
      if(c==='no date')return !t.due_date;
      if(c==='next 7 days'){const end=format(addDays(new Date(),7),'yyyy-MM-dd');return t.due_date&&t.due_date>=today&&t.due_date<=end;}
      const pm=c.match(/priority:(\d)/);if(pm)return t.priority===Number(pm[1]);
      if(c.startsWith('#')){const p=data.projects.find(x=>x.name.toLowerCase()===c.slice(1));return t.project_id===p?.id;}
      if(c.startsWith('@'))return t.labels?.some(l=>l.name.toLowerCase()===c.slice(1));
      return t.content.toLowerCase().includes(c);
    });
  });
}

export default function App() {
  const [status,setStatus]=useState('loading'),[data,setData]=useState(null),[active,setActive]=useState({type:'today'}),[collapsed,setCollapsed]=useState(false),[quickOpen,setQuickOpen]=useState(false),[searchOpen,setSearchOpen]=useState(false),[projectOpen,setProjectOpen]=useState(false),[settingsOpen,setSettingsOpen]=useState(false),[taskId,setTaskId]=useState(null),[viewOverride,setViewOverride]=useState(null),[notificationsOpen,setNotificationsOpen]=useState(false); const [toast,showToast]=useToast();
  const load=async()=>{try{const d=await api('/api/bootstrap');setData(d);setStatus('ready');applyTheme(d.user.theme)}catch(e){if(e.message.includes('登录'))setStatus('auth');else{setStatus('auth')}}};
  useEffect(()=>{load()},[]);
  const applyTheme=(theme)=>{const dark=theme==='dark'||(theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=dark?'dark':'light'};
  useEffect(()=>{const handler=e=>{if((e.key==='q'||e.key==='Q')&&!/INPUT|TEXTAREA/.test(document.activeElement?.tagName)){e.preventDefault();setQuickOpen(true)}if((e.key==='/'||(e.key.toLowerCase()==='k'&&(e.ctrlKey||e.metaKey)))&&!/INPUT|TEXTAREA/.test(document.activeElement?.tagName)){e.preventDefault();setSearchOpen(true)}if(e.key==='Escape'){setQuickOpen(false);setSearchOpen(false);setTaskId(null)}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)},[]);
  useEffect(()=>{if(window.matchMedia('(max-width: 900px)').matches)setCollapsed(true)},[]);
  const logout=async()=>{await api('/api/auth/logout',{method:'POST'});setData(null);setStatus('auth')};
  const currentProject=data?.projects.find(p=>p.id===active.id); const currentLabel=data?.labels.find(l=>l.id===active.id); const currentFilter=data?.filters.find(f=>f.id===active.id); const currentSmartTable=data?.smartTables?.find(table=>table.id===active.id);
  const visible=useMemo(()=>{if(!data)return[];const tasks=data.tasks;const today=todayISO();switch(active.type){case'pending':return tasks.filter(t=>!t.project_id&&!t.completed_at);case'today':return tasks.filter(t=>!t.completed_at&&t.due_date&&t.due_date<=today);case'calendar':return tasks.filter(t=>!t.completed_at);case'completed':return tasks.filter(t=>t.completed_at);case'project':return tasks.filter(t=>t.project_id===active.id&&!t.completed_at);case'label':return tasks.filter(t=>!t.completed_at&&t.labels?.some(l=>l.id===active.id));case'filter':return applyFilterQuery(tasks.filter(t=>!t.completed_at),currentFilter?.query||'',data);default:return tasks.filter(t=>!t.completed_at)}},[data,active,currentFilter]);
  const title=active.type==='pending'?'待处理':active.type==='today'?'今天':active.type==='calendar'?'日历':active.type==='smartTable'?currentSmartTable?.name:active.type==='completed'?'已完成':currentProject?.name||currentLabel?.name||currentFilter?.name||'任务';
  const subtitle=active.type==='today'?format(new Date(),'M月d日 EEEE',{locale:zhCN}):active.type==='filter'?currentFilter?.query:null;
  const viewMode=viewOverride||currentProject?.view_mode||'list';
  useEffect(()=>setViewOverride(null),[active.type,active.id]);
  if(status==='loading')return <div className="app-loading"><div className="brand-mark"><Check size={24}/></div><Loader2 className="spin"/></div>;
  if(status==='auth')return <AuthScreen onAuth={load}/>;
  const refresh=load;
  const toggle=async(t)=>{await api(`/api/tasks/${t.id}/${t.completed_at?'uncomplete':'complete'}`,{method:'POST'});await refresh();showToast(t.completed_at?'任务已恢复':t.recurrence_rule?'已完成，下一次日期已生成':'任务已完成')};
  const inlineAdd=async(content,section_id)=>{const r=await api('/api/tasks',{method:'POST',body:{content,project_id:active.type==='project'?active.id:null,section_id}});await refresh();showToast('任务已添加');return r.task};
  const createSection=async()=>{if(active.type!=='project')return;const name=prompt('分区名称');if(!name?.trim())return;await api('/api/sections',{method:'POST',body:{project_id:active.id,name}});await refresh();showToast('分区已创建')};
  const readNotifications=async()=>{await api('/api/notifications/read',{method:'POST',body:{}});await refresh()};
  const createSmartTable=async()=>{const name=window.prompt('智能表格名称','我的智能表格');if(!name?.trim())return;try{const result=await api('/api/smart-tables',{method:'POST',body:{name:name.trim()}});await refresh();setActive({type:'smartTable',id:result.table.id});showToast('智能表格已创建')}catch(error){showToast(error.message,'error')}};
  const canReorder=active.type==='project'||active.type==='pending';
  const moveTask=async(taskId,targetSectionId,targetIndex)=>{
    if(!canReorder)return;
    const snapshot=data;
    const dragged=data.tasks.find(t=>t.id===taskId);
    if(!dragged||dragged.parent_id)return;
    const targetProjectId=active.type==='project'?active.id:null;
    const oldSectionId=dragged.section_id||null;
    const normalizedTargetSection=targetProjectId?(targetSectionId||null):null;
    const relevant=data.tasks.filter(t=>!t.parent_id&&!t.completed_at&&(t.project_id||null)===(targetProjectId||null));
    const remaining=relevant.filter(t=>t.id!==taskId);
    const targetItems=remaining.filter(t=>(t.section_id||null)===normalizedTargetSection).sort((a,b)=>a.position-b.position);
    const safeIndex=Math.max(0,Math.min(Number(targetIndex)||0,targetItems.length));
    const project=data.projects.find(p=>p.id===targetProjectId);
    const section=data.sections.find(s=>s.id===normalizedTargetSection);
    const moved={...dragged,project_id:targetProjectId,section_id:normalizedTargetSection,project_name:project?.name||null,project_color:project?.color||null,section_name:section?.name||null};
    targetItems.splice(safeIndex,0,moved);
    const affectedSections=new Set([oldSectionId,normalizedTargetSection]);
    const updated=new Map();
    for(const sectionId of affectedSections){
      const bucket=sectionId===normalizedTargetSection?targetItems:remaining.filter(t=>(t.section_id||null)===sectionId).sort((a,b)=>a.position-b.position);
      bucket.forEach((task,index)=>updated.set(task.id,{...task,position:(index+1)*1024}));
    }
    const optimisticTasks=data.tasks.map(task=>updated.get(task.id)||task);
    setData({...data,tasks:optimisticTasks});
    try{
      const items=[...updated.values()].map(task=>({id:task.id,project_id:task.project_id||null,section_id:task.section_id||null,position:task.position}));
      const response=await api('/api/tasks/reorder',{method:'POST',body:{items}});
      const saved=new Map(response.tasks.map(task=>[task.id,task]));
      setData(current=>({...current,tasks:current.tasks.map(task=>saved.get(task.id)||task)}));
    }catch(error){
      setData(snapshot);
      showToast(`移动失败：${error.message}`,'error');
    }
  };
  return <div className="app-shell">
    <Sidebar data={data} active={active} setActive={setActive} collapsed={collapsed} setCollapsed={setCollapsed} onQuickAdd={()=>setQuickOpen(true)} onSearch={()=>setSearchOpen(true)} onCreateProject={()=>setProjectOpen(true)} onCreateSmartTable={createSmartTable} onSettings={()=>setSettingsOpen(true)} onLogout={logout}/>
    <main className="main-content">
      {active.type==='smartTable'&&currentSmartTable
        ? <SmartTablePage summary={currentSmartTable} showToast={showToast} onChanged={refresh}/>
        : active.type==='calendar'
          ? <UnifiedCalendar onOpenTask={setTaskId} onOpenSmartTable={(tableId,recordId)=>setActive({type:'smartTable',id:tableId,recordId})} onQuickAdd={()=>setQuickOpen(true)} showToast={showToast}/>
          : <><Header title={title} subtitle={subtitle} viewMode={viewMode} setViewMode={setViewOverride} onQuickAdd={()=>setQuickOpen(true)} onMenu={()=>setCollapsed(false)} sidebarCollapsed={collapsed} onNotifications={()=>setNotificationsOpen(!notificationsOpen)} unread={data.notifications.filter(n=>!n.read_at).length}/><div className={`content-body ${viewMode}`}>
              {viewMode==='list'&&<ListView tasks={visible} sections={active.type==='project'?data.sections.filter(s=>s.project_id===active.id):[]} onOpen={setTaskId} onToggle={toggle} onInlineAdd={inlineAdd} projectId={active.type==='project'?active.id:null} onCreateSection={createSection} onMove={moveTask} canReorder={canReorder}/>}
              {viewMode==='board'&&<BoardView tasks={visible} sections={active.type==='project'?data.sections.filter(s=>s.project_id===active.id):[]} onOpen={setTaskId} onToggle={toggle} onInlineAdd={inlineAdd} onMove={moveTask} canReorder={canReorder}/>}
              {viewMode==='calendar'&&<CalendarView tasks={visible} onOpen={setTaskId} onToggle={toggle}/>}
            </div></>}
    </main>
    <NotificationPanel open={notificationsOpen} onClose={()=>setNotificationsOpen(false)} notifications={data.notifications} onOpenTask={setTaskId} onRead={readNotifications}/>
    <QuickAdd open={quickOpen} onClose={()=>setQuickOpen(false)} data={data} defaultProjectId={active.type==='project'?active.id:null} onCreated={async()=>{await refresh();showToast('任务已添加')}}/>
    <SearchOverlay open={searchOpen} onClose={()=>setSearchOpen(false)} data={data} onOpen={setTaskId}/>
    <TaskDrawer taskId={taskId} data={data} onClose={()=>setTaskId(null)} onRefresh={refresh} showToast={showToast}/>
    <ProjectModal open={projectOpen} onClose={()=>setProjectOpen(false)} data={data} onSaved={async p=>{await refresh();setActive({type:'project',id:p.id});showToast('项目已创建')}}/>
    <SettingsModal open={settingsOpen} onClose={()=>setSettingsOpen(false)} data={data} onRefresh={refresh} onTheme={applyTheme} onLogout={logout} showToast={showToast}/>
    <Toast toast={toast}/>
  </div>;
}
