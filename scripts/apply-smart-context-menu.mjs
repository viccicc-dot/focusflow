import fs from 'node:fs';

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Missing integration marker: ${label}`);
  return source.replace(search, replacement);
}

function write(path, content) {
  fs.writeFileSync(path, content.replace(/[ \t]+$/gm, '') + (content.endsWith('\n') ? '' : '\n'));
  console.log(`Updated ${path}`);
}

const serverPath = 'server/smart-tables.js';
let server = fs.readFileSync(serverPath, 'utf8');
if (!server.includes("./smart-record-extras.js")) {
  server = replaceOnce(
    server,
    "import { db, id, now } from './db.js';",
    "import { db, id, now } from './db.js';\nimport { registerSmartRecordExtraRoutes, saveSmartRecordValues } from './smart-record-extras.js';",
    'server import'
  );
  const savePattern = /function saveRecordValues\(recordId, tableId, values\) \{[\s\S]*?\n\}\n\nfunction defaultOptions/;
  if (!savePattern.test(server)) throw new Error('Missing saveRecordValues block');
  server = server.replace(savePattern, `function saveRecordValues(recordId, tableId, values, userId = null) {\n  saveSmartRecordValues(recordId, tableId, values, userId);\n}\n\nfunction defaultOptions`);
  server = replaceOnce(
    server,
    'export function registerSmartTableRoutes(app, auth) {',
    'export function registerSmartTableRoutes(app, auth) {\n  registerSmartRecordExtraRoutes(app, auth);',
    'route registration'
  );
  server = server.replaceAll('saveRecordValues(record.id, table.id, req.body.values || {});', 'saveRecordValues(record.id, table.id, req.body.values || {}, req.user.id);');
  server = server.replaceAll('saveRecordValues(record.id, record.table_id, req.body.values || {});', 'saveRecordValues(record.id, record.table_id, req.body.values || {}, req.user.id);');
  write(serverPath, server);
}

const clientPath = 'client/src/SmartTable.jsx';
let client = fs.readFileSync(clientPath, 'utf8');
if (!client.includes("./SmartContextMenu.jsx")) {
  client = replaceOnce(
    client,
    "import { api } from './api.js';\nimport './smart-table.css';",
    "import { api } from './api.js';\nimport { SmartContextMenu, SmartRecordPanel } from './SmartContextMenu.jsx';\nimport './smart-table.css';",
    'client import'
  );
  client = replaceOnce(
    client,
    "function fieldTypeLabel(type) {\n  return FIELD_TYPES.find(item => item[0] === type)?.[1] || type;\n}\n",
    `function fieldTypeLabel(type) {\n  return FIELD_TYPES.find(item => item[0] === type)?.[1] || type;\n}\n\nfunction clipboardValue(field, text) {\n  const value = String(text ?? '').trim();\n  if (!value) return null;\n  if (field.type === 'number') {\n    const number = Number(value);\n    return Number.isFinite(number) ? number : null;\n  }\n  if (field.type === 'checkbox') return ['1', 'true', 'yes', '是', '已勾选'].includes(value.toLowerCase());\n  if (field.type === 'select' || field.type === 'status') {\n    return field.config?.options?.find(option => option.id === value || option.label === value)?.id || value;\n  }\n  if (field.type === 'multi_select') {\n    return value.split(/[、,，\\n]/).map(item => item.trim()).filter(Boolean).map(item => field.config?.options?.find(option => option.id === item || option.label === item)?.id || item);\n  }\n  return value;\n}\n`,
    'clipboard helper'
  );
  client = replaceOnce(
    client,
    'function EditableCell({ record, field, value, active, onActivate, onSave, onMove }) {',
    'function EditableCell({ record, field, value, active, onActivate, onSave, onMove, onContextMenu }) {',
    'editable cell signature'
  );
  client = replaceOnce(
    client,
    '  return <button type="button" className={`smart-cell display type-${field.type}`} onClick={() => onActivate({recordId: record.id, fieldId: field.id})} onDoubleClick={() => onActivate({recordId: record.id, fieldId: field.id})}>',
    '  return <button id={`smart-cell-${record.id}-${field.id}`} type="button" className={`smart-cell display type-${field.type}`} onContextMenu={event => onContextMenu?.(event, record, field)} onClick={() => onActivate({recordId: record.id, fieldId: field.id})} onDoubleClick={() => onActivate({recordId: record.id, fieldId: field.id})}>',
    'editable cell button'
  );
  client = replaceOnce(
    client,
    '  const [menuFieldId, setMenuFieldId] = useState(null);\n  const fields = bundle.fields.filter(field => !field.hidden && !(config.hidden_field_ids || []).includes(field.id));',
    `  const [menuFieldId, setMenuFieldId] = useState(null);\n  const [contextMenu, setContextMenu] = useState(null);\n  const [recordPanel, setRecordPanel] = useState(null);\n  const fields = bundle.fields.filter(field => !field.hidden && !(config.hidden_field_ids || []).includes(field.id));\n  useEffect(() => {\n    const match = window.location.hash.match(/smart-record=([^&]+)&field=([^&]+)/);\n    if (!match) return;\n    const recordId = decodeURIComponent(match[1]);\n    const fieldId = decodeURIComponent(match[2]);\n    if (!bundle.records.some(record => record.id === recordId) || !bundle.fields.some(field => field.id === fieldId)) return;\n    setActiveCell({recordId, fieldId});\n    requestAnimationFrame(() => document.getElementById(\`smart-cell-\${recordId}-\${fieldId}\`)?.scrollIntoView({block: 'center', inline: 'center'}));\n  }, [bundle.table.id]);`,
    'grid state'
  );
  client = replaceOnce(
    client,
    `  const duplicate = async record => {\n    try { await api(\`/api/smart-records/\${record.id}/duplicate\`, {method: 'POST'}); await onReload(); showToast('记录已复制'); }\n    catch (error) { showToast(error.message, 'error'); }\n  };`,
    `  const duplicate = async record => {\n    try { await api(\`/api/smart-records/\${record.id}/duplicate\`, {method: 'POST'}); await onReload(); showToast('记录已复制'); }\n    catch (error) { showToast(error.message, 'error'); }\n  };\n  const openContextMenu = (event, record, field) => {\n    event.preventDefault();\n    event.stopPropagation();\n    setActiveCell({recordId: record.id, fieldId: field.id});\n    setContextMenu({x: event.clientX, y: event.clientY, record, field});\n  };\n  const copyContextValue = async () => {\n    const {record, field} = contextMenu;\n    await navigator.clipboard.writeText(stringifyValue(field, valueOf(record, field.id)));\n    showToast('已复制单元格内容');\n  };\n  const pasteContextValue = async () => {\n    const {record, field} = contextMenu;\n    const text = await navigator.clipboard.readText();\n    await saveCell(record, field, clipboardValue(field, text));\n    showToast('已粘贴');\n  };\n  const insertContextRecords = async (direction, count) => {\n    const record = contextMenu.record;\n    const total = Math.max(1, Math.min(100, Number(count) || 1));\n    try {\n      for (let index = 0; index < total; index += 1) {\n        const offset = (index + 1) / (total + 1);\n        const position = direction === 'above' ? Number(record.position) - (1 - offset) : Number(record.position) + offset;\n        await api(\`/api/smart-tables/\${bundle.table.id}/records\`, {method: 'POST', body: {position, values: {}}});\n      }\n      await onReload(false);\n      showToast(\`已插入 \${total} 条记录\`);\n    } catch (error) { showToast(error.message, 'error'); }\n  };\n  const filterByContextValue = async () => {\n    const {record, field} = contextMenu;\n    const value = stringifyValue(field, valueOf(record, field.id));\n    const nextFilters = [...(config.filters || []), {field_id: field.id, operator: 'equals', value}];\n    await api(\`/api/smart-views/\${view.id}\`, {method: 'PATCH', body: {config: {...config, filters: nextFilters}}});\n    await onReload(false);\n    showToast('已按当前内容筛选');\n  };\n  const clearContextValue = async () => {\n    const {record, field} = contextMenu;\n    await saveCell(record, field, null);\n    showToast('内容已清除');\n  };\n  const copyContextLink = async () => {\n    const {record, field} = contextMenu;\n    const url = new URL(window.location.href);\n    url.hash = \`smart-record=\${encodeURIComponent(record.id)}&field=\${encodeURIComponent(field.id)}\`;\n    await navigator.clipboard.writeText(url.toString());\n    showToast('选区链接已复制');\n  };`,
    'context actions'
  );
  client = replaceOnce(
    client,
    '{fields.map(field => <EditableCell key={field.id} record={record} field={field} value={valueOf(record, field.id)} active={activeCell?.recordId === record.id && activeCell?.fieldId === field.id} onActivate={setActiveCell} onSave={saveCell} onMove={moveFromCell}/>) }',
    '{fields.map(field => <EditableCell key={field.id} record={record} field={field} value={valueOf(record, field.id)} active={activeCell?.recordId === record.id && activeCell?.fieldId === field.id} onActivate={setActiveCell} onSave={saveCell} onMove={moveFromCell} onContextMenu={openContextMenu}/>) }',
    'cell map'
  );
  client = replaceOnce(
    client,
    `      <EmptyRow fields={fields} onCreate={createRecord}/>\n    </div>\n  </div>;`,
    `      <EmptyRow fields={fields} onCreate={createRecord}/>\n    </div>\n    <SmartContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} actions={{\n      paste: pasteContextValue,\n      pasteValues: pasteContextValue,\n      copyValue: copyContextValue,\n      insert: insertContextRecords,\n      duplicate: () => duplicate(contextMenu.record),\n      expand: () => setRecordPanel({mode: 'details', recordId: contextMenu.record.id, fieldId: contextMenu.field.id}),\n      subtask: () => setRecordPanel({mode: 'subtask', recordId: contextMenu.record.id, fieldId: contextMenu.field.id}),\n      comment: () => setRecordPanel({mode: 'comments', recordId: contextMenu.record.id, fieldId: contextMenu.field.id}),\n      copyLink: copyContextLink,\n      history: () => setRecordPanel({mode: 'history', recordId: contextMenu.record.id, fieldId: contextMenu.field.id}),\n      filter: filterByContextValue,\n      clear: clearContextValue,\n      remove: () => removeRecords([contextMenu.record.id])\n    }}/>\n    <SmartRecordPanel panel={recordPanel} bundle={bundle} onClose={() => setRecordPanel(null)} onReload={onReload} showToast={showToast}/>\n  </div>;`,
    'context render'
  );
  write(clientPath, client);
}
