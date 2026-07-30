import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clipboard, ClipboardPaste, Copy, Rows3, Maximize2, ListTree, MessageSquarePlus,
  Link2, History, Filter, Eraser, Trash2, ChevronRight, X, RotateCcw, Send
} from 'lucide-react';
import { api } from './api.js';
import './smart-context-menu.css';

function useDismiss(ref, onClose, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const pointer = event => {
      if (ref.current && !ref.current.contains(event.target)) onClose();
    };
    const key = event => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('keydown', key);
    };
  }, [active, onClose, ref]);
}

function MenuButton({ icon: Icon, children, onClick, danger = false, suffix = null }) {
  return <button type="button" className={`smart-context-item ${danger ? 'danger' : ''}`} onClick={onClick}>
    <Icon size={16}/><span>{children}</span>{suffix}
  </button>;
}

export function SmartContextMenu({ menu, onClose, actions }) {
  const ref = useRef(null);
  const [count, setCount] = useState(1);
  const [pasteOpen, setPasteOpen] = useState(false);
  useDismiss(ref, onClose, Boolean(menu));
  useEffect(() => { setCount(1); setPasteOpen(false); }, [menu?.record?.id, menu?.field?.id]);
  if (!menu) return null;
  const width = 286;
  const estimatedHeight = 620;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - estimatedHeight - 8));
  const run = fn => async () => {
    try { await fn?.(); } finally { onClose(); }
  };
  const insertControl = direction => <div className="smart-context-inline">
    <button type="button" onClick={run(() => actions.insert(direction, count))}>
      <Rows3 size={16}/><span>{direction === 'above' ? '向上插入记录' : '向下插入记录'}</span>
    </button>
    <input aria-label="插入记录数量" type="number" min="1" max="100" value={count}
      onChange={event => setCount(Math.max(1, Math.min(100, Number(event.target.value) || 1)))}/><small>条</small>
  </div>;
  return <div ref={ref} className="smart-context-menu" style={{left, top}} role="menu" onContextMenu={event => event.preventDefault()}>
    <MenuButton icon={ClipboardPaste} onClick={run(actions.paste)}>粘贴</MenuButton>
    <div className="smart-context-submenu-wrap">
      <MenuButton icon={Clipboard} onClick={() => setPasteOpen(value => !value)} suffix={<ChevronRight size={15}/>}>选择性粘贴</MenuButton>
      {pasteOpen && <div className="smart-context-submenu">
        <MenuButton icon={ClipboardPaste} onClick={run(actions.pasteValues)}>仅粘贴值</MenuButton>
      </div>}
    </div>
    <MenuButton icon={Clipboard} onClick={run(actions.copyValue)}>复制单元格内容</MenuButton>
    <div className="smart-context-divider"/>
    {insertControl('above')}
    {insertControl('below')}
    <div className="smart-context-divider"/>
    <MenuButton icon={Copy} onClick={run(actions.duplicate)}>复制记录</MenuButton>
    <MenuButton icon={Maximize2} onClick={run(actions.expand)}>展开记录</MenuButton>
    <MenuButton icon={ListTree} onClick={run(actions.subtask)}>新增子任务</MenuButton>
    <div className="smart-context-divider"/>
    <MenuButton icon={MessageSquarePlus} onClick={run(actions.comment)}>添加评论</MenuButton>
    <MenuButton icon={Link2} onClick={run(actions.copyLink)}>获取指向此选区的链接</MenuButton>
    <MenuButton icon={History} onClick={run(actions.history)}>查看此单元格历史</MenuButton>
    <MenuButton icon={Filter} onClick={run(actions.filter)}>按此内容筛选</MenuButton>
    <MenuButton icon={Eraser} onClick={run(actions.clear)}>清除内容</MenuButton>
    <div className="smart-context-divider"/>
    <MenuButton icon={Trash2} danger onClick={run(actions.remove)}>删除记录</MenuButton>
  </div>;
}

function valueText(field, value) {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) return value.map(item => field?.config?.options?.find(option => option.id === item)?.label || item).join('、');
  return field?.config?.options?.find(option => option.id === value)?.label || String(value);
}

function PanelEditor({ field, value, onSave }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [field.id, value]);
  const save = () => onSave(field, draft === '' ? null : draft);
  if (field.type === 'checkbox') return <button type="button" className={`panel-checkbox ${draft ? 'checked' : ''}`} onClick={() => { const next = !draft; setDraft(next); onSave(field, next); }}>{draft ? '已勾选' : '未勾选'}</button>;
  if (field.type === 'select' || field.type === 'status') return <select value={draft || ''} onChange={event => { setDraft(event.target.value); onSave(field, event.target.value || null); }}>
    <option value="">—</option>{(field.config?.options || []).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
  </select>;
  const type = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : field.type === 'url' ? 'url' : 'text';
  if (field.type === 'long_text') return <textarea value={draft || ''} onChange={event => setDraft(event.target.value)} onBlur={save}/>;
  return <input type={type} value={draft ?? ''} onChange={event => setDraft(field.type === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value)} onBlur={save}/>;
}

export function SmartRecordPanel({ panel, bundle, onClose, onReload, showToast }) {
  const [tab, setTab] = useState(panel?.mode || 'details');
  const [history, setHistory] = useState([]);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [subtask, setSubtask] = useState('');
  const record = useMemo(() => bundle?.records?.find(item => item.id === panel?.recordId), [bundle, panel?.recordId]);
  const selectedField = useMemo(() => bundle?.fields?.find(item => item.id === panel?.fieldId), [bundle, panel?.fieldId]);
  useEffect(() => setTab(panel?.mode || 'details'), [panel?.mode, panel?.recordId, panel?.fieldId]);
  useEffect(() => {
    if (!panel || !record) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        if (tab === 'history') {
          const result = await api(`/api/smart-records/${record.id}/history${selectedField ? `?field_id=${encodeURIComponent(selectedField.id)}` : ''}`);
          if (!cancelled) setHistory(result.history || []);
        }
        if (tab === 'comments') {
          const result = await api(`/api/smart-records/${record.id}/comments`);
          if (!cancelled) setComments(result.comments || []);
        }
      } catch (error) { showToast(error.message, 'error'); }
      finally { if (!cancelled) setLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [panel, record?.id, selectedField?.id, tab]);
  if (!panel || !record) return null;
  const saveField = async (field, value) => {
    try {
      await api(`/api/smart-records/${record.id}`, {method: 'PATCH', body: {values: {[field.id]: value}}});
      await onReload(false);
    } catch (error) { showToast(error.message, 'error'); }
  };
  const restore = async item => {
    try {
      await api(`/api/smart-records/${record.id}/history/${item.id}/restore`, {method: 'POST'});
      await onReload(false);
      const result = await api(`/api/smart-records/${record.id}/history?field_id=${encodeURIComponent(item.field_id)}`);
      setHistory(result.history || []);
      showToast('已还原该单元格');
    } catch (error) { showToast(error.message, 'error'); }
  };
  const addComment = async event => {
    event.preventDefault();
    if (!commentBody.trim()) return;
    try {
      const result = await api(`/api/smart-records/${record.id}/comments`, {method: 'POST', body: {body: commentBody.trim(), field_id: selectedField?.id || null}});
      setComments(items => [...items, result.comment]); setCommentBody('');
    } catch (error) { showToast(error.message, 'error'); }
  };
  const addSubtask = async event => {
    event.preventDefault();
    if (!subtask.trim()) return;
    try {
      const link = await api(`/api/smart-records/${record.id}/to-task`, {method: 'POST'});
      await api('/api/tasks', {method: 'POST', body: {content: subtask.trim(), parent_id: link.task.id}});
      setSubtask(''); await onReload(false); showToast('子任务已添加');
    } catch (error) { showToast(error.message, 'error'); }
  };
  return <aside className="smart-record-panel" aria-label="记录详情">
    <header><div><strong>{valueText(bundle.fields.find(field => field.is_primary) || bundle.fields[0], record.values[(bundle.fields.find(field => field.is_primary) || bundle.fields[0])?.id])}</strong><small>{bundle.table.name}</small></div><button type="button" onClick={onClose}><X size={18}/></button></header>
    <nav>
      <button className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}>详情</button>
      <button className={tab === 'comments' ? 'active' : ''} onClick={() => setTab('comments')}>评论</button>
      <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>历史</button>
      <button className={tab === 'subtask' ? 'active' : ''} onClick={() => setTab('subtask')}>子任务</button>
    </nav>
    <div className="smart-record-panel-body">
      {loading && <div className="panel-loading">正在加载…</div>}
      {!loading && tab === 'details' && <div className="panel-fields">{bundle.fields.map(field => <label key={field.id}><span>{field.name}</span><PanelEditor field={field} value={record.values[field.id]} onSave={saveField}/></label>)}</div>}
      {!loading && tab === 'comments' && <><div className="panel-comments">{comments.length ? comments.map(comment => <article key={comment.id}><strong>{comment.user_name || comment.user_email || '我'}</strong><p>{comment.body}</p><time>{new Date(comment.created_at).toLocaleString()}</time></article>) : <p className="panel-empty">暂无评论</p>}</div><form className="panel-compose" onSubmit={addComment}><textarea value={commentBody} onChange={event => setCommentBody(event.target.value)} placeholder="输入评论；Enter 发送，Shift+Enter 换行" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }}/><button disabled={!commentBody.trim()}><Send size={15}/>发送</button></form></>}
      {!loading && tab === 'history' && <div className="panel-history">{history.length ? history.map(item => <article key={item.id}><div><strong>{item.field_name}</strong><time>{new Date(item.created_at).toLocaleString()}</time></div><p><del>{valueText({config: {}}, item.old_value)}</del><span>→</span><ins>{valueText({config: {}}, item.new_value)}</ins></p><button onClick={() => restore(item)}><RotateCcw size={14}/>还原</button></article>) : <p className="panel-empty">暂无修改历史</p>}</div>}
      {!loading && tab === 'subtask' && <form className="panel-subtask" onSubmit={addSubtask}><p>把当前记录作为任务，并在其下新增一个子任务。</p><input value={subtask} onChange={event => setSubtask(event.target.value)} placeholder="子任务名称" autoFocus/><button disabled={!subtask.trim()}><ListTree size={15}/>添加子任务</button></form>}
    </div>
  </aside>;
}
