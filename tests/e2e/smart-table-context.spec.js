import { test, expect } from '@playwright/test';

async function login(page) {
  await page.goto('/');
  const loginButton = page.getByRole('button', { name: '登录', exact: true });
  if (await loginButton.isVisible().catch(() => false)) await loginButton.click();
  await expect(page.getByText('智能表格', { exact: true })).toBeVisible();
}

async function createFixture(page, label) {
  const tableName = `验收-${label}-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const tableResponse = await page.request.post('/api/smart-tables', { data: { name: tableName, color: '#7c3aed' } });
  expect(tableResponse.ok()).toBeTruthy();
  const bundle = await tableResponse.json();
  const primary = bundle.fields.find(field => field.is_primary) || bundle.fields[0];
  const originalValue = `原始内容-${label}`;
  const recordResponse = await page.request.post(`/api/smart-tables/${bundle.table.id}/records`, {
    data: { values: { [primary.id]: originalValue } }
  });
  expect(recordResponse.ok()).toBeTruthy();
  const { record } = await recordResponse.json();

  await page.reload();
  const tableButton = page.locator('.small-nav').filter({ hasText: tableName });
  await expect(tableButton).toBeVisible();
  await tableButton.click();
  const cell = page.locator(`[id="smart-cell-${record.id}-${primary.id}"]`);
  await expect(cell).toContainText(originalValue);
  return { tableName, tableId: bundle.table.id, field: primary, record, cell, originalValue };
}

async function openMenu(page, cell) {
  await cell.click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}

async function getBundle(page, tableId) {
  const response = await page.request.get(`/api/smart-tables/${tableId}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function recordValue(page, fixture) {
  const bundle = await getBundle(page, fixture.tableId);
  const record = bundle.records.find(item => item.id === fixture.record.id);
  return record?.values?.[fixture.field.id] ?? null;
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('右键菜单项目、Esc、外部关闭和窗口边缘定位均可用', async ({ page }) => {
  const fixture = await createFixture(page, '菜单');
  const menu = await openMenu(page, fixture.cell);
  for (const label of [
    '粘贴', '选择性粘贴', '复制单元格内容', '向上插入记录', '向下插入记录',
    '复制记录', '展开记录', '新增子任务', '添加评论', '获取指向此选区的链接',
    '查看此单元格历史', '按此内容筛选', '清除内容', '删除记录'
  ]) await expect(menu.getByText(label, { exact: true })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await fixture.cell.dispatchEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 1275, clientY: 715, button: 2 });
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1280);
  expect(box.y + box.height).toBeLessThanOrEqual(720);

  await page.mouse.click(2, 2);
  await expect(menu).toBeHidden();
});

test('复制、粘贴、选择性粘贴和单元格链接使用系统剪贴板', async ({ page }) => {
  const fixture = await createFixture(page, '剪贴板');

  let menu = await openMenu(page, fixture.cell);
  await menu.getByRole('button', { name: '复制单元格内容' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(fixture.originalValue);

  await page.evaluate(() => navigator.clipboard.writeText('直接粘贴后的内容'));
  menu = await openMenu(page, fixture.cell);
  await menu.getByRole('button', { name: '粘贴', exact: true }).click();
  await expect.poll(() => recordValue(page, fixture)).toBe('直接粘贴后的内容');

  await page.evaluate(() => navigator.clipboard.writeText('仅值粘贴后的内容'));
  menu = await openMenu(page, fixture.cell);
  await menu.getByRole('button', { name: '选择性粘贴' }).click();
  await menu.getByRole('button', { name: '仅粘贴值' }).click();
  await expect.poll(() => recordValue(page, fixture)).toBe('仅值粘贴后的内容');

  menu = await openMenu(page, fixture.cell);
  await menu.getByRole('button', { name: '获取指向此选区的链接' }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain(`smart-record=${fixture.record.id}`);
  expect(link).toContain(`field=${fixture.field.id}`);
});

test('插入、复制、筛选、清空、历史恢复和删除都写入数据库', async ({ page }) => {
  const fixture = await createFixture(page, '写入');

  let menu = await openMenu(page, fixture.cell);
  const above = menu.locator('.smart-context-inline').filter({ hasText: '向上插入记录' });
  await above.getByLabel('插入记录数量').fill('2');
  await above.getByRole('button').click();
  await expect.poll(async () => (await getBundle(page, fixture.tableId)).records.length).toBe(3);

  menu = await openMenu(page, fixture.cell);
  const below = menu.locator('.smart-context-inline').filter({ hasText: '向下插入记录' });
  await below.getByLabel('插入记录数量').fill('1');
  await below.getByRole('button').click();
  await expect.poll(async () => (await getBundle(page, fixture.tableId)).records.length).toBe(4);

  menu = await openMenu(page, fixture.cell);
  await menu.getByRole('button', { name: '复制记录' }).click();
  await expect.poll(async () => (await getBundle(page, fixture.tableId)).records.length).toBe(5);

  menu = await openMenu(page, fixture.cell);
  await menu.getByRole('button', { name: '按此内容筛选' }).click();
  await expect.poll(async () => {
    const bundle = await getBundle(page, fixture.tableId);
    return bundle.views.some(view => (view.config?.filters || []).some(filter => filter.field_id === fixture.field.id && filter.value === fixture.originalValue));
  }).toBeTruthy();

  menu = await openMenu(page, fixture.cell);
  await menu.getByRole('button', { name: '清除内容' }).click();
  await expect.poll(() => recordValue(page, fixture)).toBeNull();

  menu = await openMenu(page, fixture.cell);
  await menu.getByRole('button', { name: '查看此单元格历史' }).click();
  const panel = page.getByLabel('记录详情');
  await expect(panel).toBeVisible();
  await expect(panel.getByText(fixture.originalValue, { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '还原' }).first().click();
  await expect.poll(() => recordValue(page, fixture)).toBe(fixture.originalValue);
  await panel.locator('header button').click();

  const countBeforeDelete = (await getBundle(page, fixture.tableId)).records.length;
  menu = await openMenu(page, fixture.cell);
  page.once('dialog', dialog => dialog.accept());
  await menu.getByRole('button', { name: '删除记录' }).click();
  await expect.poll(async () => (await getBundle(page, fixture.tableId)).records.length).toBe(countBeforeDelete - 1);
  await page.reload();
  await expect(page.locator(`[id="smart-cell-${fixture.record.id}-${fixture.field.id}"]`)).toHaveCount(0);
});

test('详情、评论、历史与子任务侧栏可操作并在刷新后保留', async ({ page }) => {
  const fixture = await createFixture(page, '侧栏');

  let menu = await openMenu(page, fixture.cell);
  await menu.getByRole('button', { name: '展开记录' }).click();
  let panel = page.getByLabel('记录详情');
  await expect(panel).toBeVisible();
  await expect(panel.getByText(fixture.tableName, { exact: true })).toBeVisible();
  await expect(panel.getByText('详情', { exact: true })).toBeVisible();
  await panel.locator('header button').click();

  menu = await openMenu(page, fixture.cell);
  await menu.getByRole('button', { name: '添加评论' }).click();
  panel = page.getByLabel('记录详情');
  const comment = `持久评论-${Date.now()}`;
  await panel.getByPlaceholder(/输入评论/).fill(comment);
  await panel.getByRole('button', { name: '发送' }).click();
  await expect(panel.getByText(comment, { exact: true })).toBeVisible();
  await panel.locator('header button').click();

  await page.reload();
  const tableButton = page.locator('.small-nav').filter({ hasText: fixture.tableName });
  await tableButton.click();
  const cell = page.locator(`[id="smart-cell-${fixture.record.id}-${fixture.field.id}"]`);
  menu = await openMenu(page, cell);
  await menu.getByRole('button', { name: '添加评论' }).click();
  panel = page.getByLabel('记录详情');
  await expect(panel.getByText(comment, { exact: true })).toBeVisible();
  await panel.locator('header button').click();

  menu = await openMenu(page, cell);
  await menu.getByRole('button', { name: '新增子任务' }).click();
  panel = page.getByLabel('记录详情');
  const subtaskName = `子任务-${Date.now()}`;
  await panel.getByPlaceholder('子任务名称').fill(subtaskName);
  await panel.getByRole('button', { name: '添加子任务' }).click();
  await expect(page.getByText('子任务已添加', { exact: true })).toBeVisible();

  const bundle = await getBundle(page, fixture.tableId);
  const linkedRecord = bundle.records.find(item => item.id === fixture.record.id);
  expect(linkedRecord.task_id).toBeTruthy();
  const taskResponse = await page.request.get(`/api/tasks/${linkedRecord.task_id}`);
  expect(taskResponse.ok()).toBeTruthy();
  const taskPayload = await taskResponse.json();
  expect(taskPayload.task.subtasks.some(item => item.content === subtaskName)).toBeTruthy();
});
