import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus, Settings2, Filter, ArrowUpDown, Group, Table2, CalendarDays, ChevronLeft,
  ChevronRight, Trash2, Link2, Check, X, Eye, EyeOff, ChevronDown, ChevronUp,
  Loader2, RotateCcw
} from 'lucide-react';
import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay,
  isSameMonth, startOfMonth, startOfWeek
} from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { api } from './api.js';
import './smart-table.css';

const FIELD_TYPES = [
  ['text', '单行文本'], ['long_text', '多行文本'], ['number', '数字'],
  ['select', '单选'], ['multi_select', '多选'], ['status', '状态'],
  ['date', '日期'], ['datetime', '日期时间'], ['checkbox', '复选框'],
  ['url', '链接'], ['person', '人员/标签']
];
const DEFAULT_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#64748b'];

function valueOf(record, fieldId) {
  return record?.values?.[fieldId] ?? null;
}
function optionFor(field, value) {
  return field?.config?.options?.find(option => option.id === value || option.label === value);
}
function stringifyValue(field, value) {
  if (value == null || value === '') return '';
  if (field.type === 'checkbox') return value ? '是' : '否';
  if (field.type === 'multi_select') {
    const values = Array.isArray(value) ? value : [];
    return values.map(item => optionFor(field, item)?.label || item).join('、');
  }
  if (field.type === 'select' || field.type === 'status') return optionFor(field, value)?.label || String(value);
  return String(value);
}
function titleField(bundle) {
  return bundle.fields.find(field => field.is_primary) || bundle.fields[0];
}
function recordTitle(bundle, record) {
  const field = titleField(bundle);
  return stringifyValue(field, valueOf(record, field?.id)) || '未命名记录';
}
function colorFor(bundle, record, fieldId) {
  const field = bundle.fields.find(item => item.id === fieldId);
  if (!field) return bundle.table.color || '#7c3aed';
  return optionFor(field, valueOf(record, field.id))?.color || bundle.table.color || '#7c3aed';
}
function normalizeOptions(text) {
  return text.split(/[,，\n]/).map(item => item.trim()).filter(Boolean).map((label, index) => ({
    id: `${label.toLowerCase().replace(/\s+/g, '-') || 'option'}-${index + 1}`,
    label,
    color: DEFAULT_COLORS[index % DEFAULT_COLORS.length]
  }));
}

function Popup({ open, onClose, title, children, className = '' }) {
  if (!open) return null;
  return <div className={`smart-popup ${className}`}>
    <div className="smart-popup-header"><strong>{title}</strong><button onClick={onClose}><X size={16}/></button></div>
    {children}
  </div>;
}

function CellEditor({ field, value, onSave }) {
  const [draft, setDraft] = useState(value ?? (field.type === 'multi_select' ? [] : ''));
  useEffect(() => setDraft(value ?? (field.type === 'multi_select' ? [] : '')), [value, field.id]);
  const save = next => {
    setDraft(next);
    onSave(next);
  };
  if (field.type === 'checkbox') {
    return <button className={`smart-checkbox ${draft ? 'checked' : ''}`} onClick={() => save(!draft)}>{draft && <Check size={14}/>}</button>;
  }
  if (field.type === 'select' || field.type === 'status') {
    return <select className="smart-cell-input" value={draft || ''} onChange={event => save(event.target.value || null)}>
      <option value="">—</option>
      {(field.config?.options || []).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>;
  }
  if (field.type === 'multi_select') {
    const selected = Array.isArray(draft) ? draft : [];
    return <div className="multi-editor">{(field.config?.options || []).map(option => {
      const active = selected.includes(option.id);
      return <button key={option.id} type="button" className={active ? 'active' : ''} style={{'--tag-color': option.color}} onClick={() => save(active ? selected.filter(id => id !== option.id) : [...selected, option.id])}>{option.label}</button>;
    })}</div>;
  }
  const inputType = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : field.type === 'url' ? 'url' : 'text';
  if (field.type === 'long_text') {
    return <textarea className="smart-cell-input smart-textarea" value={draft || ''} onChange={event => setDraft(event.target.value)} onBlur={() => onSave(draft || null)}/>;
  }
  return <input className="smart-cell-input" type={inputType} value={draft ?? ''} onChange={event => setDraft(field.type === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value)} onBlur={() => onSave(draft === '' ? null : draft)}/>;
}

function FieldManager({ bundle, onClose, onReload, showToast }) {
  const [newField, setNewField] = useState({ name: '', type: 'text' });
  const [busy, setBusy] = useState(false);
  const update = async (field, patch) => {
    setBusy(true);
    try { await api(`/api/smart-fields/${field.id}`, { method: 'PATCH', body: patch }); await onReload(); }
    catch (error) { showToast(error.message, 'error'); }
    finally { setBusy(false); }
  };
  const remove = async field => {
    if (!window.confirm(`删除字段“${field.name}”及其所有数据？`)) return;
    try { await api(`/api/smart-fields/${field.id}`, { method: 'DELETE' }); await onReload(); }
    catch (error) { showToast(error.message, 'error'); }
  };
  const add = async () => {
    if (!newField.name.trim()) return;
    const config = ['select', 'multi_select', 'status'].includes(newField.type)
      ? { options: normalizeOptions('选项一,选项二,选项三') } : {};
    setBusy(true);
    try {
      await api(`/api/smart-tables/${bundle.table.id}/fields`, { method: 'POST', body: { ...newField, config } });
      setNewField({ name: '', type: 'text' });
      await onReload();
    } catch (error) { showToast(error.message, 'error'); }
    finally { setBusy(false); }
  };
  const move = async (field, direction) => {
    const fields = [...bundle.fields].sort((a, b) => a.position - b.position);
    const index = fields.findIndex(item => item.id === field.id);
    const target = fields[index + direction];
    if (!target) return;
    await Promise.all([
      api(`/api/smart-fields/${field.id}`, { method: 'PATCH', body: { position: target.position } }),
      api(`/api/smart-fields/${target.id}`, { method: 'PATCH', body: { position: field.position } })
    ]);
    await onReload();
  };
  return <div className="modal-backdrop smart-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div className="smart-modal field-manager">
      <div className="smart-modal-header"><div><h2>字段管理</h2><p>所有列都可以重命名、改类型、隐藏、调整宽度和顺序。</p></div><button onClick={onClose}><X/></button></div>
      <div className="field-manager-list">
        {bundle.fields.map(field => <div className="field-manager-row" key={field.id}>
          <div className="field-order"><button onClick={() => move(field, -1)} title="上移"><ChevronUp size={15}/></button><button onClick={() => move(field, 1)} title="下移"><ChevronDown size={15}/></button></div>
          <input defaultValue={field.name} key={`${field.id}:${field.name}`} onBlur={event => event.target.value.trim() && event.target.value !== field.name && update(field, { name: event.target.value })} onFocus={event => event.target.select()} readOnly={busy}/>
          <select value={field.type} onChange={event => update(field, { type: event.target.value })} disabled={field.is_primary || busy}>{FIELD_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <label className="width-control">宽度<input type="number" min="90" max="600" defaultValue={field.width} onBlur={event => update(field, { width: Number(event.target.value) })}/></label>
          <button className="secondary compact" onClick={() => update(field, { hidden: !field.hidden })}>{field.hidden ? <Eye size={15}/> : <EyeOff size={15}/>} {field.hidden ? '显示' : '隐藏'}</button>
          {['select', 'multi_select', 'status'].includes(field.type) && <button className="secondary compact" onClick={() => {
            const current = (field.config?.options || []).map(item => item.label).join(', ');
            const text = window.prompt('用逗号分隔选项', current);
            if (text != null) update(field, { config: { ...field.config, options: normalizeOptions(text) } });
          }}>编辑选项</button>}
          <button className="danger-icon" disabled={Boolean(field.is_primary)} onClick={() => remove(field)} title={field.is_primary ? '主字段不能删除' : '删除字段'}><Trash2 size={16}/></button>
        </div>)}
      </div>
      <div className="field-add-row">
        <input value={newField.name} onChange={event => setNewField({ ...newField, name: event.target.value })} placeholder="新字段名称"/>
        <select value={newField.type} onChange={event => setNewField({ ...newField, type: event.target.value })}>{FIELD_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <button className="primary" onClick={add} disabled={busy || !newField.name.trim()}>{busy ? <Loader2 className="spin" size={16}/> : <Plus size={16}/>}添加字段</button>
      </div>
    </div>
  </div>;
}

function GridView({ bundle, view, onReload, showToast }) {
  const config = view.config || {};
  const [selected, setSelected] = useState([]);
  const [collapsed, setCollapsed] = useState({});
  const fields = bundle.fields.filter(field => !field.hidden && !(config.hidden_field_ids || []).includes(field.id));
  const filtered = useMemo(() => {
    let records = [...bundle.records];
    for (const filter of config.filters || []) {
      if (!filter.field_id) continue;
      const field = bundle.fields.find(item => item.id === filter.field_id);
      records = records.filter(record => {
        const raw = valueOf(record, filter.field_id);
        const text = stringifyValue(field, raw).toLowerCase();
        const expected = String(filter.value || '').toLowerCase();
        if (filter.operator === 'equals') return text === expected;
        if (filter.operator === 'is_empty') return raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0);
        if (filter.operator === 'not_empty') return !(raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0));
        return text.includes(expected);
      });
    }
    if (config.sort?.field_id) {
      const field = bundle.fields.find(item => item.id === config.sort.field_id);
      records.sort((a, b) => stringifyValue(field, valueOf(a, field.id)).localeCompare(stringifyValue(field, valueOf(b, field.id)), 'zh-CN') * (config.sort.direction === 'desc' ? -1 : 1));
    }
    return records;
  }, [bundle, config]);
  const groups = useMemo(() => {
    if (!config.group_field_id) return [{ key: '__all__', label: '', records: filtered }];
    const field = bundle.fields.find(item => item.id === config.group_field_id);
    const map = new Map();
    for (const record of filtered) {
      const label = stringifyValue(field, valueOf(record, field.id)) || '未填写';
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(record);
    }
    return [...map.entries()].map(([label, records]) => ({ key: label, label, records }));
  }, [filtered, config.group_field_id, bundle.fields]);
  const saveCell = async (record, fieldId, value) => {
    try { await api(`/api/smart-records/${record.id}`, { method: 'PATCH', body: { values: { [fieldId]: value } } }); await onReload(false); }
    catch (error) { showToast(error.message, 'error'); await onReload(); }
  };
  const removeRecords = async ids => {
    if (!ids.length || !window.confirm(`删除选中的 ${ids.length} 条记录？`)) return;
    try { await Promise.all(ids.map(recordId => api(`/api/smart-records/${recordId}`, { method: 'DELETE' }))); setSelected([]); await onReload(); showToast('记录已删除'); }
    catch (error) { showToast(error.message, 'error'); }
  };
  const toTask = async record => {
    try { await api(`/api/smart-records/${record.id}/to-task`, { method: 'POST' }); await onReload(); showToast('已关联到个人任务'); }
    catch (error) { showToast(error.message, 'error'); }
  };
  const moveRecord = async (record, delta) => {
    const index = filtered.findIndex(item => item.id === record.id);
    const target = filtered[index + delta];
    if (!target) return;
    await Promise.all([
      api(`/api/smart-records/${record.id}`, { method: 'PATCH', body: { position: target.position } }),
      api(`/api/smart-records/${target.id}`, { method: 'PATCH', body: { position: record.position } })
    ]);
    await onReload();
  };
  return <div className="smart-grid-wrap">
    {selected.length > 0 && <div className="bulk-bar"><strong>已选择 {selected.length} 条</strong><button onClick={() => removeRecords(selected)}><Trash2 size={15}/>删除</button><button onClick={() => setSelected([])}><X size={15}/>取消选择</button></div>}
    <div className="smart-grid" style={{'--grid-width': `${fields.reduce((sum, field) => sum + Number(field.width || 180), 0) + 128}px`}}>
      <div className="smart-grid-header smart-grid-row" style={{gridTemplateColumns: `42px 52px ${fields.map(field => `${field.width || 180}px`).join(' ')} 76px`}}>
        <div><input type="checkbox" checked={selected.length > 0 && selected.length === filtered.length} onChange={event => setSelected(event.target.checked ? filtered.map(record => record.id) : [])}/></div>
        <div>#</div>
        {fields.map(field => <div key={field.id} className="field-heading"><span>{field.name}</span><small>{FIELD_TYPES.find(item => item[0] === field.type)?.[1]}</small></div>)}
        <div></div>
      </div>
      {groups.map(group => <React.Fragment key={group.key}>
        {group.label && <button className="group-row" onClick={() => setCollapsed({ ...collapsed, [group.key]: !collapsed[group.key] })}>{collapsed[group.key] ? <ChevronRight size={16}/> : <ChevronDown size={16}/>}<strong>{group.label}</strong><span>总数 {group.records.length}</span></button>}
        {!collapsed[group.key] && group.records.map((record, index) => <div key={record.id} className={`smart-grid-row data-row ${selected.includes(record.id) ? 'selected' : ''}`} style={{gridTemplateColumns: `42px 52px ${fields.map(field => `${field.width || 180}px`).join(' ')} 76px`}}>
          <div><input type="checkbox" checked={selected.includes(record.id)} onChange={event => setSelected(event.target.checked ? [...selected, record.id] : selected.filter(id => id !== record.id))}/></div>
          <div className="row-number">{index + 1}</div>
          {fields.map(field => <div key={field.id} className={`smart-cell type-${field.type}`}><CellEditor field={field} value={valueOf(record, field.id)} onSave={value => saveCell(record, field.id, value)}/></div>)}
          <div className="row-actions">
            <button onClick={() => moveRecord(record, -1)} title="上移"><ChevronUp size={14}/></button>
            <button onClick={() => moveRecord(record, 1)} title="下移"><ChevronDown size={14}/></button>
            <button className={record.task_id ? 'linked' : ''} onClick={() => toTask(record)} title={record.task_id ? '已关联任务' : '转换为任务'}><Link2 size={14}/></button>
            <button onClick={() => removeRecords([record.id])} title="删除"><Trash2 size={14}/></button>
          </div>
        </div>)}
      </React.Fragment>)}
      {filtered.length === 0 && <div className="smart-empty">当前筛选条件下没有记录。</div>}
    </div>
  </div>;
}

function MonthCalendar({ month, setMonth, events, onEvent, onAdd, controls }) {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start, end });
  return <div className="month-calendar">
    <div className="calendar-toolbar">
      <button className="secondary" onClick={() => setMonth(new Date())}>今天</button>
      <h2>{format(month, 'yyyy年 M月', { locale: zhCN })}</h2>
      <button className="icon-button" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft/></button>
      <button className="icon-button" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight/></button>
      <div className="calendar-spacer"/>{controls}
    </div>
    <div className="weekday-row">{['周一','周二','周三','周四','周五','周六','周日'].map(day => <div key={day}>{day}</div>)}</div>
    <div className="month-grid">{days.map(day => {
      const iso = format(day, 'yyyy-MM-dd');
      const dayEvents = events.filter(event => event.date === iso);
      return <div key={iso} className={`month-day ${!isSameMonth(day, month) ? 'outside' : ''} ${isSameDay(day, new Date()) ? 'today' : ''}`}>
        <div className="day-heading"><span>{format(day, 'd')}</span>{onAdd && <button onClick={() => onAdd(iso)}><Plus size={14}/>添加</button>}</div>
        <div className="day-events">{dayEvents.map(event => <button key={event.id} className="calendar-event" style={{'--event-color': event.color || '#7c3aed'}} onClick={() => onEvent?.(event)} title={event.title}>{event.title}{event.source === 'smart_record' && <small>{event.table_name}</small>}</button>)}</div>
      </div>;
    })}</div>
  </div>;
}

function SmartCalendarView({ bundle, view, onReload, showToast }) {
  const [month, setMonth] = useState(new Date());
  const config = view.config || {};
  const dateFields = bundle.fields.filter(field => field.type === 'date' || field.type === 'datetime');
  const dateField = bundle.fields.find(field => field.id === config.date_field_id) || dateFields[0];
  const colorField = bundle.fields.find(field => field.id === config.color_field_id);
  const events = bundle.records.map(record => ({
    id: record.id, title: recordTitle(bundle, record),
    date: valueOf(record, dateField?.id) ? String(valueOf(record, dateField?.id)).slice(0, 10) : null,
    color: colorFor(bundle, record, colorField?.id)
  })).filter(event => event.date);
  const saveView = async patch => {
    await api(`/api/smart-views/${view.id}`, { method: 'PATCH', body: { config: { ...config, ...patch } } });
    await onReload();
  };
  const addOnDate = async date => {
    const primary = titleField(bundle);
    const values = { [primary.id]: '新记录' };
    if (dateField) values[dateField.id] = date;
    await api(`/api/smart-tables/${bundle.table.id}/records`, { method: 'POST', body: { values } });
    await onReload();
    showToast('已在日历中添加记录');
  };
  const editEvent = async event => {
    const record = bundle.records.find(item => item.id === event.id);
    const primary = titleField(bundle);
    const nextTitle = window.prompt('记录名称', recordTitle(bundle, record));
    if (nextTitle == null || !nextTitle.trim()) return;
    await api(`/api/smart-records/${record.id}`, { method: 'PATCH', body: { values: { [primary.id]: nextTitle.trim() } } });
    await onReload(false);
  };
  return <MonthCalendar month={month} setMonth={setMonth} events={events} onEvent={editEvent} onAdd={addOnDate} controls={<div className="calendar-config">
    <label>日期字段<select value={dateField?.id || ''} onChange={event => saveView({ date_field_id: event.target.value || null })}><option value="">请选择</option>{dateFields.map(field => <option value={field.id} key={field.id}>{field.name}</option>)}</select></label>
    <label>颜色字段<select value={colorField?.id || ''} onChange={event => saveView({ color_field_id: event.target.value || null })}><option value="">表格颜色</option>{bundle.fields.filter(field => ['select','status'].includes(field.type)).map(field => <option value={field.id} key={field.id}>{field.name}</option>)}</select></label>
  </div>}/>;
}

export function SmartTablePage({ summary, showToast, onChanged }) {
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeViewId, setActiveViewId] = useState(null);
  const [panel, setPanel] = useState(null);
  const [fieldManager, setFieldManager] = useState(false);
  const load = async (showLoading = true) => {
    if (!summary?.id) return;
    if (showLoading) setLoading(true);
    try {
      const next = await api(`/api/smart-tables/${summary.id}`);
      setBundle(next);
      setActiveViewId(current => next.views.some(view => view.id === current) ? current : next.views[0]?.id || null);
    } catch (error) { showToast(error.message, 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [summary?.id]);
  if (loading || !bundle) return <div className="smart-loading"><Loader2 className="spin"/><span>正在加载智能表格…</span></div>;
  const activeView = bundle.views.find(view => view.id === activeViewId) || bundle.views[0];
  const config = activeView?.config || {};
  const patchView = async patch => {
    try {
      await api(`/api/smart-views/${activeView.id}`, { method: 'PATCH', body: { config: { ...config, ...patch } } });
      await load(false);
    } catch (error) { showToast(error.message, 'error'); }
  };
  const addRecord = async values => {
    const primary = titleField(bundle);
    await api(`/api/smart-tables/${bundle.table.id}/records`, { method: 'POST', body: { values: values || { [primary.id]: '新记录' } } });
    await load(false); showToast('记录已添加');
  };
  const createView = async type => {
    const name = window.prompt('视图名称', type === 'calendar' ? '新日历' : '新表格');
    if (!name?.trim()) return;
    const dateField = bundle.fields.find(field => field.type === 'date' || field.type === 'datetime');
    const result = await api(`/api/smart-tables/${bundle.table.id}/views`, { method: 'POST', body: { name, type, config: type === 'calendar' ? { date_field_id: dateField?.id || null } : {} } });
    await load(false); setActiveViewId(result.view.id);
  };
  const filter = (config.filters || [])[0] || { field_id: '', operator: 'contains', value: '' };
  return <section className="smart-table-page">
    <header className="smart-page-header">
      <div><div className="smart-title-line"><span className="table-color" style={{background: bundle.table.color}}/><h1>{bundle.table.name}</h1></div><p>{bundle.records.length} 条记录 · {bundle.fields.length} 个字段</p></div>
      <button className="primary" onClick={() => addRecord()}><Plus size={16}/>添加记录</button>
    </header>
    <div className="view-tabs">
      {bundle.views.map(view => <button key={view.id} className={view.id === activeView.id ? 'active' : ''} onClick={() => setActiveViewId(view.id)}>{view.type === 'calendar' ? <CalendarDays size={15}/> : <Table2 size={15}/>} {view.name}</button>)}
      <div className="view-add"><button onClick={() => setPanel(panel === 'views' ? null : 'views')}><Plus size={15}/>新建视图</button><Popup open={panel === 'views'} onClose={() => setPanel(null)} title="新建视图"><button className="popup-action" onClick={() => createView('grid')}><Table2 size={16}/>表格视图</button><button className="popup-action" onClick={() => createView('calendar')}><CalendarDays size={16}/>日历视图</button></Popup></div>
    </div>
    <div className="smart-toolbar">
      <button onClick={() => setFieldManager(true)}><Settings2 size={16}/>字段管理</button>
      <div className="toolbar-popup-wrap"><button className={(config.filters || []).length ? 'active' : ''} onClick={() => setPanel(panel === 'filter' ? null : 'filter')}><Filter size={16}/>筛选{(config.filters || []).length ? ` (${config.filters.length})` : ''}</button><Popup open={panel === 'filter'} onClose={() => setPanel(null)} title="筛选"><div className="popup-form"><select value={filter.field_id} onChange={event => patchView({ filters: [{ ...filter, field_id: event.target.value }] })}><option value="">选择字段</option>{bundle.fields.map(field => <option key={field.id} value={field.id}>{field.name}</option>)}</select><select value={filter.operator} onChange={event => patchView({ filters: [{ ...filter, operator: event.target.value }] })}><option value="contains">包含</option><option value="equals">等于</option><option value="is_empty">为空</option><option value="not_empty">不为空</option></select>{!['is_empty','not_empty'].includes(filter.operator) && <input value={filter.value || ''} onChange={event => patchView({ filters: [{ ...filter, value: event.target.value }] })} placeholder="筛选值"/>}<button className="secondary" onClick={() => patchView({ filters: [] })}><RotateCcw size={14}/>清除筛选</button></div></Popup></div>
      <div className="toolbar-popup-wrap"><button className={config.sort?.field_id ? 'active' : ''} onClick={() => setPanel(panel === 'sort' ? null : 'sort')}><ArrowUpDown size={16}/>排序</button><Popup open={panel === 'sort'} onClose={() => setPanel(null)} title="排序"><div className="popup-form"><select value={config.sort?.field_id || ''} onChange={event => patchView({ sort: { field_id: event.target.value, direction: config.sort?.direction || 'asc' } })}><option value="">不排序</option>{bundle.fields.map(field => <option key={field.id} value={field.id}>{field.name}</option>)}</select><select value={config.sort?.direction || 'asc'} onChange={event => patchView({ sort: { field_id: config.sort?.field_id || '', direction: event.target.value } })}><option value="asc">升序</option><option value="desc">降序</option></select></div></Popup></div>
      <div className="toolbar-popup-wrap"><button className={config.group_field_id ? 'active' : ''} onClick={() => setPanel(panel === 'group' ? null : 'group')}><Group size={16}/>分组</button><Popup open={panel === 'group'} onClose={() => setPanel(null)} title="分组"><div className="popup-form"><select value={config.group_field_id || ''} onChange={event => patchView({ group_field_id: event.target.value || null })}><option value="">不分组</option>{bundle.fields.map(field => <option key={field.id} value={field.id}>{field.name}</option>)}</select></div></Popup></div>
      <span className="toolbar-spacer"/><button onClick={() => load()}><RotateCcw size={15}/>刷新</button>
    </div>
    <div className="smart-view-body">{activeView.type === 'calendar'
      ? <SmartCalendarView bundle={bundle} view={activeView} onReload={load} showToast={showToast}/>
      : <GridView bundle={bundle} view={activeView} onReload={load} showToast={showToast}/>}</div>
    {fieldManager && <FieldManager bundle={bundle} onClose={() => setFieldManager(false)} onReload={async () => { await load(false); onChanged?.(); }} showToast={showToast}/>} 
  </section>;
}

export function UnifiedCalendar({ onOpenTask, onOpenSmartTable, onQuickAdd, showToast }) {
  const [month, setMonth] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [sources, setSources] = useState({ task: true, smart_record: true });
  const load = async () => {
    const start = format(startOfWeek(startOfMonth(month), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const end = format(endOfWeek(endOfMonth(month), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    try { const result = await api(`/api/calendar/events?start=${start}&end=${end}`); setEvents(result.events); }
    catch (error) { showToast(error.message, 'error'); }
  };
  useEffect(() => { load(); }, [month]);
  const visible = events.filter(event => sources[event.source]);
  return <section className="unified-calendar-page">
    <header className="smart-page-header"><div><h1>统一日历</h1><p>普通任务和智能表格记录显示在同一个月历中。</p></div><button className="primary" onClick={onQuickAdd}><Plus size={16}/>添加任务</button></header>
    <MonthCalendar month={month} setMonth={setMonth} events={visible} onAdd={() => onQuickAdd?.()} onEvent={event => event.source === 'task' ? onOpenTask?.(event.task_id) : onOpenSmartTable?.(event.table_id, event.record_id)} controls={<div className="source-filters"><button className={sources.task ? 'active' : ''} onClick={() => setSources({ ...sources, task: !sources.task })}>任务</button><button className={sources.smart_record ? 'active' : ''} onClick={() => setSources({ ...sources, smart_record: !sources.smart_record })}>智能表格</button></div>}/>
  </section>;
}
