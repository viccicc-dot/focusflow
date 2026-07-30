import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Filter, ArrowUpDown, Group, Table2, CalendarDays, ChevronLeft,
  ChevronRight, Trash2, Link2, Check, X, ChevronDown, Loader2, RotateCcw,
  MoreHorizontal, GripVertical, Copy, EyeOff, Settings2, Briefcase, Home,
  ListTodo, StickyNote, Columns3
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
const FIELD_ICONS = {
  text: 'A', long_text: '≡', number: '#', select: '●', multi_select: '◆', status: '◉',
  date: '▣', datetime: '◷', checkbox: '☑', url: '↗', person: '@'
};

function valueOf(record, fieldId) {
  return record?.values?.[fieldId] ?? null;
}
function optionFor(field, value) {
  return field?.config?.options?.find(option => option.id === value || option.label === value);
}
function optionIdFor(field, labels) {
  const wanted = new Set(Array.isArray(labels) ? labels : [labels]);
  return field?.config?.options?.find(option => wanted.has(option.id) || wanted.has(option.label))?.id || null;
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
function semanticField(bundle, role) {
  const aliases = {
    record_kind: ['记录类型', '事项类型', '类型'],
    area: ['归属', '领域', '工作生活'],
    status: ['状态'],
    date: ['日期', '截止日期', '时间'],
    notes: ['备注', '其他信息', '说明']
  };
  return bundle.fields.find(field => field.config?.role === role)
    || (role === 'title' ? titleField(bundle) : null)
    || bundle.fields.find(field => (aliases[role] || []).includes(field.name));
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
function normalizeOptions(text, oldOptions = []) {
  const oldByLabel = new Map(oldOptions.map(option => [option.label, option]));
  return text.split(/[,，\n]/).map(item => item.trim()).filter(Boolean).map((label, index) => {
    const old = oldByLabel.get(label);
    return old || {
      id: `${label.toLowerCase().replace(/\s+/g, '-') || 'option'}-${Date.now()}-${index + 1}`,
      label,
      color: DEFAULT_COLORS[index % DEFAULT_COLORS.length]
    };
  });
}
function fieldTypeLabel(type) {
  return FIELD_TYPES.find(item => item[0] === type)?.[1] || type;
}

function useOutside(ref, handler, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const onPointer = event => {
      if (ref.current && !ref.current.contains(event.target)) handler();
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [active, handler, ref]);
}

function Popup({ open, onClose, title, children, className = '' }) {
  const ref = useRef(null);
  useOutside(ref, onClose, open);
  if (!open) return null;
  return <div ref={ref} className={`smart-popup ${className}`} onPointerDown={event => event.stopPropagation()}>
    <div className="smart-popup-header"><strong>{title}</strong><button type="button" onClick={onClose}><X size={16}/></button></div>
    {children}
  </div>;
}

function TableTitle({ table, onSave, showToast }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(table.name);
  useEffect(() => setDraft(table.name), [table.id, table.name]);
  const commit = async () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === table.name) return;
    try { await onSave({ name: next }); }
    catch (error) { setDraft(table.name); showToast(error.message, 'error'); }
  };
  return <div className="smart-title-edit-wrap">
    <span className="table-color" style={{background: table.color}}/>
    {editing
      ? <input className="smart-title-input" autoFocus value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') { setDraft(table.name); setEditing(false); }
      }}/>
      : <button className="smart-title-button" onClick={() => setEditing(true)} onDoubleClick={() => setEditing(true)} title="点击修改表格名称"><h1>{table.name}</h1></button>}
  </div>;
}

function ValuePill({ field, value }) {
  const option = optionFor(field, value);
  if (!option) return <span className="cell-placeholder">点击填写</span>;
  return <span className="value-pill" style={{'--pill-color': option.color}}>{option.label}</span>;
}

function CellDisplay({ field, value }) {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return <span className="cell-placeholder">点击填写</span>;
  if (field.type === 'checkbox') return <span className={`display-checkbox ${value ? 'checked' : ''}`}>{value && <Check size={13}/>}</span>;
  if (field.type === 'select' || field.type === 'status') return <ValuePill field={field} value={value}/>;
  if (field.type === 'multi_select') return <span className="pill-list">{value.map(item => {
    const option = optionFor(field, item);
    return <span key={item} className="value-pill" style={{'--pill-color': option?.color || '#64748b'}}>{option?.label || item}</span>;
  })}</span>;
  if (field.type === 'url') return <a href={String(value)} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>{String(value)}</a>;
  return <span className={field.type === 'long_text' ? 'cell-long-text' : ''}>{String(value)}</span>;
}

function ActiveEditor({ field, value, onCommit, onCancel, onMove }) {
  const [draft, setDraft] = useState(value ?? (field.type === 'multi_select' ? [] : ''));
  const committed = useRef(false);
  useEffect(() => setDraft(value ?? (field.type === 'multi_select' ? [] : '')), [value, field.id]);
  const commit = async (next = draft, move = null) => {
    if (committed.current) return;
    committed.current = true;
    await onCommit(next === '' ? null : next);
    if (move) onMove?.(move);
  };
  const keyDown = event => {
    if (event.key === 'Escape') { committed.current = true; onCancel(); }
    if (event.key === 'Enter' && field.type !== 'long_text') { event.preventDefault(); commit(draft, 'down'); }
    if (event.key === 'Tab') { event.preventDefault(); commit(draft, event.shiftKey ? 'left' : 'right'); }
  };
  if (field.type === 'checkbox') {
    return <button autoFocus className={`smart-checkbox ${draft ? 'checked' : ''}`} onClick={() => commit(!draft)}>{draft && <Check size={14}/>}</button>;
  }
  if (field.type === 'select' || field.type === 'status') {
    return <select autoFocus className="smart-cell-input" value={draft || ''} onChange={event => commit(event.target.value || null)} onBlur={() => commit(draft)} onKeyDown={keyDown}>
      <option value="">—</option>
      {(field.config?.options || []).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>;
  }
  if (field.type === 'multi_select') {
    const selected = Array.isArray(draft) ? draft : [];
    return <div className="multi-editor" tabIndex={0} autoFocus onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) commit(selected);
    }} onKeyDown={keyDown}>
      {(field.config?.options || []).map(option => {
        const active = selected.includes(option.id);
        return <button key={option.id} type="button" className={active ? 'active' : ''} style={{'--tag-color': option.color}} onClick={() => {
          const next = active ? selected.filter(id => id !== option.id) : [...selected, option.id];
          setDraft(next);
        }}>{option.label}</button>;
      })}
      <button type="button" className="multi-done" onClick={() => commit(selected)}>完成</button>
    </div>;
  }
  const inputType = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : field.type === 'url' ? 'url' : 'text';
  if (field.type === 'long_text') {
    return <textarea autoFocus className="smart-cell-input smart-textarea" value={draft || ''} onChange={event => setDraft(event.target.value)} onBlur={() => commit(draft)} onKeyDown={event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') commit(draft, 'down');
      else keyDown(event);
    }}/>;
  }
  return <input autoFocus className="smart-cell-input" type={inputType} value={draft ?? ''}
    onFocus={event => event.currentTarget.select()}
    onChange={event => setDraft(field.type === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value)}
    onBlur={() => commit(draft)} onKeyDown={keyDown}/>;
}

function EditableCell({ record, field, value, active, onActivate, onSave, onMove }) {
  const save = async next => {
    await onSave(record, field, next);
    onActivate(null);
  };
  if (active) return <div className={`smart-cell editing type-${field.type}`}>
    <ActiveEditor field={field} value={value} onCommit={save} onCancel={() => onActivate(null)} onMove={onMove}/>
  </div>;
  return <button type="button" className={`smart-cell display type-${field.type}`} onClick={() => onActivate({recordId: record.id, fieldId: field.id})} onDoubleClick={() => onActivate({recordId: record.id, fieldId: field.id})}>
    <CellDisplay field={field} value={value}/>
  </button>;
}

function ColumnMenu({ field, open, onClose, onUpdate, onDelete, onAddAfter }) {
  const [name, setName] = useState(field.name);
  const [options, setOptions] = useState((field.config?.options || []).map(option => option.label).join(', '));
  useEffect(() => {
    setName(field.name);
    setOptions((field.config?.options || []).map(option => option.label).join(', '));
  }, [field.id, field.name, field.config]);
  return <Popup open={open} onClose={onClose} title="字段设置" className="column-popup">
    <div className="column-menu-form">
      <label>字段名称<input value={name} onChange={event => setName(event.target.value)} onBlur={() => name.trim() && name.trim() !== field.name && onUpdate({name: name.trim()})}/></label>
      <label>字段类型<select value={field.type} disabled={Boolean(field.is_primary)} onChange={event => onUpdate({type: event.target.value})}>{FIELD_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {['select', 'multi_select', 'status'].includes(field.type) && <label>选项<textarea value={options} onChange={event => setOptions(event.target.value)} onBlur={() => onUpdate({config: {...field.config, options: normalizeOptions(options, field.config?.options || [])}})} placeholder="用逗号分隔"/></label>}
      <button type="button" className="popup-action" onClick={onAddAfter}><Plus size={15}/>在右侧新增字段</button>
      <button type="button" className="popup-action" onClick={() => onUpdate({hidden: true})}><EyeOff size={15}/>在当前表格隐藏</button>
      <button type="button" className="popup-action danger" disabled={Boolean(field.is_primary)} onClick={onDelete}><Trash2 size={15}/>删除字段</button>
    </div>
  </Popup>;
}

function ColumnHeader({ field, bundle, menuFieldId, setMenuFieldId, onUpdate, onDelete, onAddAfter, onDropField }) {
  const drag = useRef(null);
  const startResize = event => {
    event.preventDefault();
    event.stopPropagation();
    drag.current = {startX: event.clientX, startWidth: Number(field.width || 180)};
    const onMove = moveEvent => {
      const next = Math.max(90, Math.min(700, drag.current.startWidth + moveEvent.clientX - drag.current.startX));
      document.documentElement.style.setProperty(`--field-${field.id}-width`, `${next}px`);
    };
    const onUp = async upEvent => {
      const next = Math.max(90, Math.min(700, drag.current.startWidth + upEvent.clientX - drag.current.startX));
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.documentElement.style.removeProperty(`--field-${field.id}-width`);
      await onUpdate(field, {width: next});
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };
  return <div className="field-heading" draggable onDragStart={event => event.dataTransfer.setData('text/field-id', field.id)} onDragOver={event => event.preventDefault()} onDrop={event => {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData('text/field-id');
    if (sourceId && sourceId !== field.id) onDropField(sourceId, field.id);
  }} style={{width: `var(--field-${field.id}-width, ${field.width || 180}px)`}}>
    <button type="button" className="field-heading-main" onClick={() => setMenuFieldId(menuFieldId === field.id ? null : field.id)} title="点击设置字段">
      <span className="field-type-icon">{FIELD_ICONS[field.type] || 'A'}</span>
      <span>{field.name}</span>
      <ChevronDown size={13}/>
    </button>
    <span className="column-resizer" onPointerDown={startResize}/>
    <ColumnMenu field={field} open={menuFieldId === field.id} onClose={() => setMenuFieldId(null)} onUpdate={patch => onUpdate(field, patch)} onDelete={() => onDelete(field)} onAddAfter={() => onAddAfter(field)}/>
  </div>;
}

function AddColumnHeader({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('text');
  const submit = async event => {
    event?.preventDefault();
    if (!name.trim()) return;
    await onAdd({name: name.trim(), type});
    setName(''); setType('text'); setOpen(false);
  };
  return <div className="add-column-heading">
    <button type="button" onClick={() => setOpen(!open)}><Plus size={15}/><span>添加字段</span></button>
    <Popup open={open} onClose={() => setOpen(false)} title="新增字段"><form className="popup-form" onSubmit={submit}>
      <input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="字段名称"/>
      <select value={type} onChange={event => setType(event.target.value)}>{FIELD_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <button className="primary" disabled={!name.trim()}><Plus size={15}/>添加</button>
    </form></Popup>
  </div>;
}

function EmptyRow({ fields, onCreate }) {
  const [activeFieldId, setActiveFieldId] = useState(null);
  const fakeRecord = {id: '__new__', values: {}};
  const save = async (_record, field, value) => {
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) { setActiveFieldId(null); return; }
    await onCreate({[field.id]: value}, field.id);
    setActiveFieldId(null);
  };
  return <div className="smart-grid-row empty-entry-row" style={{gridTemplateColumns: `42px 52px ${fields.map(field => `var(--field-${field.id}-width, ${field.width || 180}px)`).join(' ')} 150px`}}>
    <div></div><div className="row-number"><Plus size={14}/></div>
    {fields.map(field => <EditableCell key={field.id} record={fakeRecord} field={field} value={null} active={activeFieldId === field.id} onActivate={next => setActiveFieldId(next?.fieldId || null)} onSave={save}/>) }
    <div className="empty-row-hint">点击任意空格录入</div>
  </div>;
}

function GridView({ bundle, view, onReload, showToast }) {
  const config = view.config || {};
  const [selected, setSelected] = useState([]);
  const [collapsed, setCollapsed] = useState({});
  const [activeCell, setActiveCell] = useState(null);
  const [menuFieldId, setMenuFieldId] = useState(null);
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
    } else {
      records.sort((a, b) => a.position - b.position);
    }
    return records;
  }, [bundle, config]);
  const groups = useMemo(() => {
    if (!config.group_field_id) return [{key: '__all__', label: '', records: filtered}];
    const field = bundle.fields.find(item => item.id === config.group_field_id);
    const map = new Map();
    for (const record of filtered) {
      const label = stringifyValue(field, valueOf(record, field.id)) || '未填写';
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(record);
    }
    return [...map.entries()].map(([label, records]) => ({key: label, label, records}));
  }, [filtered, config.group_field_id, bundle.fields]);
  const saveCell = async (record, field, value) => {
    if (record.id === '__new__') return;
    try {
      await api(`/api/smart-records/${record.id}`, {method: 'PATCH', body: {values: {[field.id]: value}}});
      await onReload(false);
    } catch (error) { showToast(error.message, 'error'); await onReload(); }
  };
  const createRecord = async (values, focusFieldId = null) => {
    try {
      const result = await api(`/api/smart-tables/${bundle.table.id}/records`, {method: 'POST', body: {values}});
      await onReload(false);
      if (focusFieldId) setActiveCell({recordId: result.record.id, fieldId: focusFieldId});
    } catch (error) { showToast(error.message, 'error'); }
  };
  const removeRecords = async ids => {
    if (!ids.length || !window.confirm(`删除选中的 ${ids.length} 条记录？`)) return;
    try {
      await api('/api/smart-records/bulk', {method: 'POST', body: {ids, action: 'delete'}});
      setSelected([]); await onReload(); showToast('记录已删除');
    } catch (error) { showToast(error.message, 'error'); }
  };
  const convertToTasks = async ids => {
    try {
      await api('/api/smart-records/bulk', {method: 'POST', body: {ids, action: 'to_task'}});
      await onReload(); showToast('已标记为任务并同步到待办');
    } catch (error) { showToast(error.message, 'error'); }
  };
  const setArea = async (ids, area) => {
    const field = semanticField(bundle, 'area');
    if (!field) return showToast('请先添加“归属”字段', 'error');
    const value = optionIdFor(field, area === 'work' ? ['work', '工作'] : ['life', '生活']) || area;
    try {
      await api('/api/smart-records/bulk', {method: 'POST', body: {ids, action: 'update', values: {[field.id]: value}}});
      await onReload(false); showToast(area === 'work' ? '已归入工作' : '已归入生活');
    } catch (error) { showToast(error.message, 'error'); }
  };
  const duplicate = async record => {
    try { await api(`/api/smart-records/${record.id}/duplicate`, {method: 'POST'}); await onReload(); showToast('记录已复制'); }
    catch (error) { showToast(error.message, 'error'); }
  };
  const updateField = async (field, patch) => {
    try { await api(`/api/smart-fields/${field.id}`, {method: 'PATCH', body: patch}); await onReload(false); }
    catch (error) { showToast(error.message, 'error'); }
  };
  const deleteField = async field => {
    if (field.is_primary || !window.confirm(`删除字段“${field.name}”及其数据？`)) return;
    try { await api(`/api/smart-fields/${field.id}`, {method: 'DELETE'}); await onReload(); }
    catch (error) { showToast(error.message, 'error'); }
  };
  const addField = async (input, afterField = null) => {
    const configPatch = ['select', 'multi_select', 'status'].includes(input.type)
      ? {options: normalizeOptions(input.type === 'status' ? '待处理, 进行中, 已完成' : '选项一, 选项二')} : {};
    const position = afterField ? Number(afterField.position) + 1 : Math.max(0, ...bundle.fields.map(field => Number(field.position))) + 1024;
    try {
      await api(`/api/smart-tables/${bundle.table.id}/fields`, {method: 'POST', body: {...input, config: configPatch, position}});
      await onReload();
    } catch (error) { showToast(error.message, 'error'); }
  };
  const reorderFields = async (sourceId, targetId) => {
    const source = bundle.fields.find(field => field.id === sourceId);
    const target = bundle.fields.find(field => field.id === targetId);
    if (!source || !target) return;
    await Promise.all([
      api(`/api/smart-fields/${source.id}`, {method: 'PATCH', body: {position: target.position}}),
      api(`/api/smart-fields/${target.id}`, {method: 'PATCH', body: {position: source.position}})
    ]);
    await onReload(false);
  };
  const reorderRecord = async (sourceId, targetId) => {
    const sourceIndex = filtered.findIndex(record => record.id === sourceId);
    const targetIndex = filtered.findIndex(record => record.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const next = [...filtered];
    const [source] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, source);
    await api('/api/smart-records/reorder', {method: 'POST', body: {items: next.map((record, index) => ({id: record.id, position: (index + 1) * 1024}))}});
    await onReload(false);
  };
  const moveFromCell = direction => {
    if (!activeCell) return;
    const rowIndex = filtered.findIndex(record => record.id === activeCell.recordId);
    const fieldIndex = fields.findIndex(field => field.id === activeCell.fieldId);
    let nextRow = rowIndex;
    let nextField = fieldIndex;
    if (direction === 'down') nextRow += 1;
    if (direction === 'right') nextField += 1;
    if (direction === 'left') nextField -= 1;
    if (nextField >= fields.length) { nextField = 0; nextRow += 1; }
    if (nextField < 0) { nextField = fields.length - 1; nextRow -= 1; }
    const record = filtered[nextRow];
    const field = fields[nextField];
    setActiveCell(record && field ? {recordId: record.id, fieldId: field.id} : null);
  };
  const gridColumns = `42px 52px ${fields.map(field => `var(--field-${field.id}-width, ${field.width || 180}px)`).join(' ')} 150px`;
  return <div className="smart-grid-wrap">
    {selected.length > 0 && <div className="bulk-bar">
      <strong>已选择 {selected.length} 条</strong>
      <button onClick={() => setArea(selected, 'work')}><Briefcase size={15}/>工作</button>
      <button onClick={() => setArea(selected, 'life')}><Home size={15}/>生活</button>
      <button onClick={() => convertToTasks(selected)}><ListTodo size={15}/>标记为任务</button>
      <button onClick={() => removeRecords(selected)}><Trash2 size={15}/>删除</button>
      <button onClick={() => setSelected([])}><X size={15}/>取消</button>
    </div>}
    <div className="smart-grid" style={{'--grid-width': `${fields.reduce((sum, field) => sum + Number(field.width || 180), 0) + 244}px`}}>
      <div className="smart-grid-header smart-grid-row" style={{gridTemplateColumns: gridColumns}}>
        <div><input type="checkbox" checked={selected.length > 0 && selected.length === filtered.length} onChange={event => setSelected(event.target.checked ? filtered.map(record => record.id) : [])}/></div>
        <div>#</div>
        {fields.map(field => <ColumnHeader key={field.id} field={field} bundle={bundle} menuFieldId={menuFieldId} setMenuFieldId={setMenuFieldId} onUpdate={updateField} onDelete={deleteField} onAddAfter={after => addField({name: '新字段', type: 'text'}, after)} onDropField={reorderFields}/>) }
        <AddColumnHeader onAdd={addField}/>
      </div>
      {groups.map(group => <React.Fragment key={group.key}>
        {group.label && <button className="group-row" onClick={() => setCollapsed({...collapsed, [group.key]: !collapsed[group.key]})}>{collapsed[group.key] ? <ChevronRight size={16}/> : <ChevronDown size={16}/>}<strong>{group.label}</strong><span>总数 {group.records.length}</span></button>}
        {!collapsed[group.key] && group.records.map((record, index) => <div key={record.id} className={`smart-grid-row data-row ${selected.includes(record.id) ? 'selected' : ''}`} style={{gridTemplateColumns: gridColumns}}
          draggable onDragStart={event => event.dataTransfer.setData('text/record-id', record.id)} onDragOver={event => event.preventDefault()} onDrop={event => reorderRecord(event.dataTransfer.getData('text/record-id'), record.id)}>
          <div className="row-select"><GripVertical size={14}/><input type="checkbox" checked={selected.includes(record.id)} onChange={event => setSelected(event.target.checked ? [...selected, record.id] : selected.filter(id => id !== record.id))}/></div>
          <div className="row-number">{index + 1}</div>
          {fields.map(field => <EditableCell key={field.id} record={record} field={field} value={valueOf(record, field.id)} active={activeCell?.recordId === record.id && activeCell?.fieldId === field.id} onActivate={setActiveCell} onSave={saveCell} onMove={moveFromCell}/>) }
          <div className="row-actions">
            <button className={record.task_id ? 'linked' : ''} onClick={() => convertToTasks([record.id])} title={record.task_id ? '已同步到任务' : '标记为任务'}><Link2 size={14}/></button>
            <button onClick={() => duplicate(record)} title="复制记录"><Copy size={14}/></button>
            <button onClick={() => removeRecords([record.id])} title="删除"><Trash2 size={14}/></button>
          </div>
        </div>)}
      </React.Fragment>)}
      <EmptyRow fields={fields} onCreate={createRecord}/>
    </div>
  </div>;
}

function MonthCalendar({ month, setMonth, events, onEvent, onAdd, controls }) {
  const start = startOfWeek(startOfMonth(month), {weekStartsOn: 1});
  const end = endOfWeek(endOfMonth(month), {weekStartsOn: 1});
  const days = eachDayOfInterval({start, end});
  return <div className="month-calendar">
    <div className="calendar-toolbar">
      <button className="secondary" onClick={() => setMonth(new Date())}>今天</button>
      <h2>{format(month, 'yyyy年 M月', {locale: zhCN})}</h2>
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
    await api(`/api/smart-views/${view.id}`, {method: 'PATCH', body: {config: {...config, ...patch}}});
    await onReload();
  };
  const addOnDate = async date => {
    const primary = titleField(bundle);
    const values = {[primary.id]: ''};
    if (dateField) values[dateField.id] = date;
    await api(`/api/smart-tables/${bundle.table.id}/records`, {method: 'POST', body: {values}});
    await onReload(); showToast('已在日历中添加空白记录，切回表格可直接填写');
  };
  const editEvent = async event => {
    const record = bundle.records.find(item => item.id === event.id);
    const primary = titleField(bundle);
    const nextTitle = window.prompt('记录名称', recordTitle(bundle, record));
    if (nextTitle == null) return;
    await api(`/api/smart-records/${record.id}`, {method: 'PATCH', body: {values: {[primary.id]: nextTitle.trim()}}});
    await onReload(false);
  };
  return <MonthCalendar month={month} setMonth={setMonth} events={events} onEvent={editEvent} onAdd={addOnDate} controls={<div className="calendar-config">
    <label>日期字段<select value={dateField?.id || ''} onChange={event => saveView({date_field_id: event.target.value || null})}><option value="">请选择</option>{dateFields.map(field => <option value={field.id} key={field.id}>{field.name}</option>)}</select></label>
    <label>颜色字段<select value={colorField?.id || ''} onChange={event => saveView({color_field_id: event.target.value || null})}><option value="">表格颜色</option>{bundle.fields.filter(field => ['select','status'].includes(field.type)).map(field => <option value={field.id} key={field.id}>{field.name}</option>)}</select></label>
  </div>}/>;
}

export function SmartTablePage({ summary, showToast, onChanged }) {
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeViewId, setActiveViewId] = useState(null);
  const [panel, setPanel] = useState(null);
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
      await api(`/api/smart-views/${activeView.id}`, {method: 'PATCH', body: {config: {...config, ...patch}}});
      await load(false);
    } catch (error) { showToast(error.message, 'error'); }
  };
  const patchTable = async patch => {
    await api(`/api/smart-tables/${bundle.table.id}`, {method: 'PATCH', body: patch});
    await load(false); onChanged?.();
  };
  const createView = async type => {
    const name = window.prompt('视图名称', type === 'calendar' ? '新日历' : '新表格');
    if (!name?.trim()) return;
    const dateField = bundle.fields.find(field => field.type === 'date' || field.type === 'datetime');
    const result = await api(`/api/smart-tables/${bundle.table.id}/views`, {method: 'POST', body: {name, type, config: type === 'calendar' ? {date_field_id: dateField?.id || null} : {}}});
    await load(false); setActiveViewId(result.view.id);
  };
  const filter = (config.filters || [])[0] || {field_id: '', operator: 'contains', value: ''};
  return <section className="smart-table-page">
    <header className="smart-page-header compact-header">
      <div>
        <TableTitle table={bundle.table} onSave={patchTable} showToast={showToast}/>
        <p>{bundle.records.length} 条记录 · {bundle.fields.length} 个字段 · 直接点击表头或单元格修改</p>
      </div>
    </header>
    <div className="view-tabs">
      {bundle.views.map(view => <button key={view.id} className={view.id === activeView.id ? 'active' : ''} onDoubleClick={async () => {
        const name = window.prompt('视图名称', view.name);
        if (name?.trim()) { await api(`/api/smart-views/${view.id}`, {method: 'PATCH', body: {name: name.trim()}}); await load(false); }
      }} onClick={() => setActiveViewId(view.id)}>{view.type === 'calendar' ? <CalendarDays size={15}/> : <Table2 size={15}/>} {view.name}</button>)}
      <div className="view-add"><button onClick={() => setPanel(panel === 'views' ? null : 'views')}><Plus size={15}/>新建视图</button><Popup open={panel === 'views'} onClose={() => setPanel(null)} title="新建视图"><button className="popup-action" onClick={() => createView('grid')}><Table2 size={16}/>表格视图</button><button className="popup-action" onClick={() => createView('calendar')}><CalendarDays size={16}/>日历视图</button></Popup></div>
    </div>
    <div className="smart-toolbar">
      <span className="toolbar-tip"><Columns3 size={15}/>表格本身就是编辑器</span>
      <div className="toolbar-popup-wrap"><button className={(config.filters || []).length ? 'active' : ''} onClick={() => setPanel(panel === 'filter' ? null : 'filter')}><Filter size={16}/>筛选{(config.filters || []).length ? ` (${config.filters.length})` : ''}</button><Popup open={panel === 'filter'} onClose={() => setPanel(null)} title="筛选"><div className="popup-form"><select value={filter.field_id} onChange={event => patchView({filters: [{...filter, field_id: event.target.value}]})}><option value="">选择字段</option>{bundle.fields.map(field => <option key={field.id} value={field.id}>{field.name}</option>)}</select><select value={filter.operator} onChange={event => patchView({filters: [{...filter, operator: event.target.value}]})}><option value="contains">包含</option><option value="equals">等于</option><option value="is_empty">为空</option><option value="not_empty">不为空</option></select>{!['is_empty','not_empty'].includes(filter.operator) && <input value={filter.value || ''} onChange={event => patchView({filters: [{...filter, value: event.target.value}]})} placeholder="筛选值"/>}<button className="secondary" onClick={() => patchView({filters: []})}><RotateCcw size={14}/>清除筛选</button></div></Popup></div>
      <div className="toolbar-popup-wrap"><button className={config.sort?.field_id ? 'active' : ''} onClick={() => setPanel(panel === 'sort' ? null : 'sort')}><ArrowUpDown size={16}/>排序</button><Popup open={panel === 'sort'} onClose={() => setPanel(null)} title="排序"><div className="popup-form"><select value={config.sort?.field_id || ''} onChange={event => patchView({sort: {field_id: event.target.value, direction: config.sort?.direction || 'asc'}})}><option value="">不排序</option>{bundle.fields.map(field => <option key={field.id} value={field.id}>{field.name}</option>)}</select><select value={config.sort?.direction || 'asc'} onChange={event => patchView({sort: {field_id: config.sort?.field_id || '', direction: event.target.value}})}><option value="asc">升序</option><option value="desc">降序</option></select></div></Popup></div>
      <div className="toolbar-popup-wrap"><button className={config.group_field_id ? 'active' : ''} onClick={() => setPanel(panel === 'group' ? null : 'group')}><Group size={16}/>分组</button><Popup open={panel === 'group'} onClose={() => setPanel(null)} title="分组"><div className="popup-form"><select value={config.group_field_id || ''} onChange={event => patchView({group_field_id: event.target.value || null})}><option value="">不分组</option>{bundle.fields.map(field => <option key={field.id} value={field.id}>{field.name}</option>)}</select></div></Popup></div>
      <span className="toolbar-spacer"/><button onClick={() => load()}><RotateCcw size={15}/>刷新</button>
    </div>
    <div className="smart-view-body">{activeView.type === 'calendar'
      ? <SmartCalendarView bundle={bundle} view={activeView} onReload={load} showToast={showToast}/>
      : <GridView bundle={bundle} view={activeView} onReload={async loadingValue => { await load(loadingValue); onChanged?.(); }} showToast={showToast}/>}</div>
  </section>;
}

export function UnifiedCalendar({ onOpenTask, onOpenSmartTable, onQuickAdd, showToast }) {
  const [month, setMonth] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [sources, setSources] = useState({task: true, smart_record: true});
  const load = async () => {
    const start = format(startOfWeek(startOfMonth(month), {weekStartsOn: 1}), 'yyyy-MM-dd');
    const end = format(endOfWeek(endOfMonth(month), {weekStartsOn: 1}), 'yyyy-MM-dd');
    try { const result = await api(`/api/calendar/events?start=${start}&end=${end}`); setEvents(result.events); }
    catch (error) { showToast(error.message, 'error'); }
  };
  useEffect(() => { load(); }, [month]);
  const visible = events.filter(event => sources[event.source]);
  return <section className="unified-calendar-page">
    <header className="smart-page-header"><div><h1>统一日历</h1><p>任务与未转成任务的表格记录显示在同一个月历中；已关联记录不会重复显示。</p></div><button className="primary" onClick={onQuickAdd}><Plus size={16}/>添加任务</button></header>
    <MonthCalendar month={month} setMonth={setMonth} events={visible} onAdd={() => onQuickAdd?.()} onEvent={event => event.source === 'task' ? onOpenTask?.(event.task_id) : onOpenSmartTable?.(event.table_id, event.record_id)} controls={<div className="source-filters"><button className={sources.task ? 'active' : ''} onClick={() => setSources({...sources, task: !sources.task})}>任务</button><button className={sources.smart_record ? 'active' : ''} onClick={() => setSources({...sources, smart_record: !sources.smart_record})}>表格记录</button></div>}/>
  </section>;
}
