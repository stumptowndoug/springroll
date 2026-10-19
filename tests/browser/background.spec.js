import { test, expect } from '@playwright/test';

const title = 'Wait for the new county titles to go live';
const row = (page, id = 'watcher', root = '#chat') => page.locator(`${root} .timeline [data-side="task"][data-side-id="${id}"]`);
const shortcut = (page, root = '#chat') => page.locator(`${root} [data-bg-jump]`);
const add = (page, data, chat = 'main') => page.evaluate(({ data, chat }) => window.chatTest.item(data, chat), { data, chat });
const prose = Array.from({ length: 40 }, (_, i) => `Deployment check ${i + 1}. Waiting for the county titles to appear on the live site.`).join('\n\n');

async function task(page, id = 'watcher', chat = 'main', extra = {}) {
  await add(page, { kind: 'tool', toolCallId: 'start-' + id, toolKind: 'execute', status: 'in_progress', backgrounded: true,
    rawInput: { command: 'printf "Checking deployment…\\n"' } }, chat);
  return add(page, { kind: 'task', taskId: id, toolCallId: 'start-' + id, description: title,
    name: title, state: 'running', canStop: true, outputFile: '/tmp/test-command-output', ...extra }, chat);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#chat .msg-user')).toBeVisible();
});

test('one named row, no duplicate panel; output and Stop remain accessible', async ({ page }, info) => {
  await add(page, { kind: 'text', text: "While Render builds, I'm stopping the dev servers and putting the local checkout back on main." });
  await task(page);
  await expect(row(page)).toBeInViewport();
  await expect(page.locator('#chat .bg-work')).toBeEmpty();
  await expect(page.locator('#chat .work-status')).toContainText('Ran');
  await expect(page.getByText('Working in the background', { exact: true })).toHaveCount(0);
  for (const theme of ['dark', 'light']) {
    await page.evaluate((name) => window.chatTest.theme(name), theme);
    await page.screenshot({ path: info.outputPath(`single-${theme}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await row(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#chat .thread-side')).toBeVisible();
  await expect(page.locator('#chat .thread-side .out')).toContainText('Checked deployment: still building.');
  await page.locator('#chat [data-side-a="stop"]').click();
  expect(await page.evaluate(() => window.chatTest.posts.at(-1))).toEqual({ url: 'api/agent/threads/main/background/stop', body: { task: 'watcher' } });
});

test('scrolling away offers a keyboard-accessible shortcut to the original row', async ({ page }, info) => {
  await add(page, { kind: 'text', text: prose });
  await task(page);
  await expect(row(page)).toBeInViewport();
  await expect(shortcut(page)).toHaveCount(0);
  await page.locator('#chat .thread-scroll').focus();
  await page.keyboard.press('Home');
  await expect(shortcut(page)).toHaveText('Jump to 1 running command');
  for (const theme of ['dark', 'light']) {
    await page.evaluate((name) => window.chatTest.theme(name), theme);
    await page.screenshot({ path: info.outputPath(`offscreen-${theme}.png`) });
  }
  await shortcut(page).focus();
  await page.keyboard.press('Enter');
  await expect(row(page)).toBeInViewport();
  await expect(row(page)).toBeFocused();
  await expect(shortcut(page)).toHaveCount(0);
  const v = page.viewportSize(); // narrower and shorter: a phone profile is already narrow
  await page.setViewportSize(v.width <= 375 ? { width: v.width, height: v.height - 200 } : { width: 375, height: 600 });
  // Resizing while reading history preserves the reader's position. The shortcut
  // must return when wrapping or a smaller viewport puts the task out of sight.
  await expect(shortcut(page)).toBeVisible();
  await shortcut(page).click();
  await expect(row(page)).toBeInViewport();
  await expect(shortcut(page)).toHaveCount(0);
});

test('two distinct commands stay distinct; completion clears a stale background summary', async ({ page }) => {
  const first = await task(page, 'first');
  const second = await task(page, 'second');
  await add(page, { kind: 'text', text: prose });
  await page.evaluate(() => {
    window.chatTest.background([{ kind: 'task', id: 'first', label: 'stale' }, { kind: 'task', id: 'second', label: 'stale' }]);
    window.chatTest.finish();
  });
  await expect(shortcut(page)).toHaveText('Jump to 2 running commands');
  await shortcut(page).click();
  await expect(row(page, 'first')).toBeInViewport();
  await expect(row(page, 'second')).toBeInViewport();
  await expect(page.locator('#chat .timeline .task')).toHaveCount(2);
  await expect(shortcut(page)).toHaveCount(0);
  await page.locator('#chat .thread-latest').click();
  await expect(shortcut(page)).toHaveText('Jump to 2 running commands');
  await add(page, { id: first, kind: 'task', taskId: 'first', description: title, state: 'completed', ended: Date.now() });
  await expect(shortcut(page)).toHaveText('Jump to 1 running command');
  await add(page, { id: second, kind: 'task', taskId: 'second', description: title, state: 'stopped', ended: Date.now() });
  await expect(shortcut(page)).toHaveCount(0);
  await expect(row(page, 'first')).toHaveClass(/completed/);
  await expect(row(page, 'second')).toContainText('Stopped');
});

test('the shortcut reveals running work older than the last 50 turns', async ({ page }) => {
  await task(page);
  await page.evaluate(() => {
    for (let turn = 2; turn <= 55; turn++) window.chatTest.item({ kind: 'user', turn, text: `Follow-up ${turn}` });
    window.chatTest.reopen();
  });
  await expect(row(page)).toHaveCount(0);
  await expect(shortcut(page)).toHaveText('Jump to 1 running command');
  await shortcut(page).click();
  await expect(row(page)).toBeInViewport();
  await expect(row(page)).toBeFocused();
});

test('collapsed agents reopen at their original row; worker tasks open their output', async ({ page }) => {
  await add(page, { kind: 'agent', name: 'Deployment check', sessionId: 'worker', state: 'running' });
  await expect(page.locator('#chat .agents')).toHaveAttribute('open', '');
  await expect(shortcut(page)).toHaveCount(0);
  await page.locator('#chat .agents > summary').click();
  await expect(shortcut(page)).toHaveText('Jump to 1 running agent');
  await shortcut(page).click();
  await expect(page.locator('#chat .agents')).toHaveAttribute('open', '');
  await expect(shortcut(page)).toHaveCount(0);
  await add(page, { kind: 'permission', by: 'Deployment check', toolCall: { title: 'Read deployment' }, options: [] });
  await expect(page.locator('#chat .row.agent.waiting')).toBeVisible();
  await page.locator('#chat .agents > summary').click();
  await expect(shortcut(page)).toHaveText('Jump to 1 running agent');
  await shortcut(page).click();
  await expect(shortcut(page)).toHaveCount(0);
  await task(page, 'worker-command', 'main', { worker: 'worker' });
  await expect(shortcut(page)).toHaveText('Jump to 1 running command');
  await shortcut(page).click();
  await expect(page.locator('#chat .thread-side .side-head')).toContainText(title);
  await expect(shortcut(page)).toHaveCount(0);
  await page.locator('#chat [data-side-a="close"]').click();
  await expect(shortcut(page)).toHaveText('Jump to 1 running command');
});

test('timers keep their list and changing chats clears the shortcut', async ({ page }) => {
  await task(page);
  await add(page, { kind: 'text', text: prose });
  await page.evaluate(() => {
    window.chatTest.background([{ kind: 'timer', id: 'check', label: 'Check deployment every five minutes', schedule: '*/5 * * * *' }]);
    window.chatTest.reopen();
  });
  await expect(shortcut(page)).toBeVisible();
  await expect(page.locator('#chat .bg > summary')).toHaveText('1 timer');
  await page.locator('#chat .bg > summary').click();
  await expect(page.locator('#chat .bg-list')).toContainText('Check deployment every five minutes');
  await page.evaluate(() => window.chatTest.reopen('empty'));
  await expect(page.locator('#chat .bg-work')).toBeEmpty();
});

test('side-panel chat owns its shortcut independently', async ({ page }) => {
  await page.evaluate(() => window.chatTest.panel(true));
  await task(page, 'panel-task', 'panel');
  await expect(row(page, 'panel-task', '#panel')).toBeInViewport();
  await expect(shortcut(page, '#panel')).toHaveCount(0);
  await add(page, { kind: 'text', text: prose }, 'panel');
  await expect(shortcut(page, '#panel')).toHaveText('Jump to 1 running command');
  await expect(shortcut(page)).toHaveCount(0);
  await shortcut(page, '#panel').click();
  await expect(row(page, 'panel-task', '#panel')).toBeInViewport();
  await row(page, 'panel-task', '#panel').click();
  await expect(page.locator('#panel .thread-side .out')).toContainText('Checked deployment');
  await page.locator('#panel [data-side-a="close"]').click();
  await page.evaluate(() => window.chatTest.closePanel());
  await expect(page.locator('#panel')).toBeEmpty();
});
