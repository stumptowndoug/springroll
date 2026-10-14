import { test, expect } from '@playwright/test';

const scroll = (page, root = '#chat') => page.locator(`${root} .thread-scroll`);
const latest = (page, root = '#chat') => page.locator(`${root} .thread-latest`);
const work = (page) => page.locator('#chat details[data-key="t1:work"]');
const paragraphs = (count) => Array.from({ length: count }, (_, i) => `Paragraph ${i + 1} of the answer. This is enough text to wrap on a phone.`).join('\n\n');
const add = (page, item, id = 'main') => page.evaluate(async ({ item, id }) => {
  const key = window.chatTest.item(item, id);
  await new Promise(requestAnimationFrame);
  return key;
}, { item, id });
const atEnd = async (page, root = '#chat') => {
  await expect.poll(() => scroll(page, root).evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop))).toBeLessThanOrEqual(2);
  await expect(latest(page, root)).toBeHidden();
};
async function moveScroll(page, target, delta) {
  // Playwright cannot swipe in mobile WebKit. Exercise its touch-intent events
  // and resulting scroll together; the CDP case below covers a native gesture.
  if (test.info().project.name === 'phone') {
    await target.evaluate((el, delta) => {
      const dispatch = (name, y) => {
        const event = new Event(name, { bubbles: true });
        Object.defineProperty(event, 'touches', { value: y == null ? [] : [{ clientX: 100, clientY: y }] });
        el.dispatchEvent(event);
      };
      dispatch('touchstart', 200);
      dispatch('touchmove', 200 - delta);
      el.scrollTop += delta;
      dispatch('touchend');
    }, delta);
    return;
  }
  const box = await target.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, delta);
}
async function wheelUp(page, root = '#chat') {
  await moveScroll(page, scroll(page, root), -300);
  await expect(latest(page, root)).toBeVisible();
  await expect.poll(() => scroll(page, root).evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeGreaterThan(100);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#chat .msg-user')).toBeVisible();
});

test('live work folds immediately and keeps its row and open state when finished', async ({ page }) => {
  await add(page, { kind: 'thought', text: 'First I will check the tests.' });
  await expect(work(page).locator(':scope > summary')).toContainText('WorkingThinking');
  await expect(page.locator('#chat .tail .working')).toHaveCount(0);
  await add(page, { kind: 'text', text: 'I will read the test file.' });
  const tool = await add(page, { kind: 'tool', toolKind: 'read', title: 'Read tests/chat.test.mjs', status: 'in_progress' });
  await expect(work(page).locator(':scope > summary')).toContainText('chat.test.mjs');
  await page.evaluate(() => window.chatTest.status({ status: 'waiting' }));
  await expect(work(page).locator('.work-label')).toHaveText('Waiting for you');
  await page.evaluate(() => window.chatTest.status({ status: 'running' }));
  await expect(work(page).locator('.work-label')).toHaveText('Working');
  await expect(work(page).locator('.tool')).toBeHidden();
  await expect(page.getByText('I will read the test file.', { exact: true })).toBeHidden();
  const row = await work(page).elementHandle();
  await work(page).locator(':scope > summary').click();
  await expect(work(page).locator('.tool')).toBeVisible();
  await add(page, { id: tool, kind: 'tool', toolKind: 'read', title: 'Read tests/chat.test.mjs', status: 'completed' });
  await add(page, { kind: 'text', text: 'All tests pass.' });
  await expect(page.locator('#chat .turn > .msg-agent')).toHaveText('All tests pass.');
  await page.evaluate(() => window.chatTest.finish());
  await expect(work(page).locator(':scope > summary')).toContainText('Worked for 4s');
  expect(await work(page).evaluate((el, before) => el === before, row)).toBe(true);
  await expect(work(page)).toHaveAttribute('open', '');
  await expect(page.locator('#chat .turn > .msg-agent')).toContainText('All tests pass.');
});

test('answers, media, notices, approvals and changes stay outside the work fold', async ({ page }) => {
  await add(page, { kind: 'tool', toolKind: 'edit', title: 'Edit app.js', status: 'completed', content: [{ type: 'diff', path: '/home/app.js', oldText: 'before', newText: 'after' }] });
  await add(page, { kind: 'notice', level: 'warn', text: 'Waiting for the service.' });
  await add(page, { kind: 'permission', toolCall: { title: 'Run the tests' }, options: [{ optionId: 'yes', kind: 'allow_once', name: 'Allow once' }] });
  await add(page, { kind: 'text', text: 'Here is the result.' });
  await add(page, { kind: 'media', content: { type: 'image', mimeType: 'image/svg+xml', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60"><text y="30">Result preview</text></svg>').toString('base64') } });
  await add(page, { kind: 'media', content: { type: 'resource_link', uri: 'https://example.com/result', name: 'Open result' } });
  await expect(page.locator('#chat .turn > .notice')).toHaveText('Waiting for the service.');
  await expect(page.locator('#chat .turn > .perm')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Allow once' })).toBeVisible();
  await page.evaluate(() => window.chatTest.finish());
  await expect(page.locator('#chat .turn > .media')).toBeVisible();
  await expect(page.locator('#chat .turn > a.row')).toHaveText('Open result');
  await expect(page.locator('#chat .turn > .msg-agent')).toContainText('Here is the result.');
  await expect(page.locator('#chat .turn > .changes > summary')).toContainText('Changed 1 file');
  await expect(work(page)).not.toHaveAttribute('open', '');
  await expect(page.locator('#chat .notice')).toHaveCount(1);
});

test('a plain answer needs no work group and long-reply rendering stays unchanged', async ({ page }) => {
  const id = await add(page, { kind: 'text', text: 'Just an answer.' });
  await expect(work(page)).toHaveCount(0);
  await expect(page.locator('#chat .tail .working')).toBeVisible();
  await add(page, { id, kind: 'text', text: 'A long answer. '.repeat(1800) });
  await expect(page.locator('#chat .msg-agent .plain')).toBeAttached();
  await page.evaluate(() => window.chatTest.finish());
  await expect(page.locator('#chat .msg-agent .plain')).toHaveCount(0);
});

test('streaming and browser layout movement keep following until a wheel scroll up', async ({ page }) => {
  const id = await add(page, { kind: 'text', text: paragraphs(35) });
  await atEnd(page);
  await scroll(page).evaluate((el) => { el.scrollTop -= 250; });
  await atEnd(page);
  await wheelUp(page);
  const top = await scroll(page).evaluate((el) => el.scrollTop);
  await add(page, { id, kind: 'text', text: paragraphs(45) });
  await expect.poll(() => scroll(page).evaluate((el) => el.scrollTop)).toBeCloseTo(top, 0);
  await expect(latest(page)).toBeVisible();
  await latest(page).click();
  await atEnd(page);
  await add(page, { id, kind: 'text', text: paragraphs(50) });
  await atEnd(page);
});

test('scrolling down to the end and sending each resume following', async ({ page }) => {
  await add(page, { kind: 'text', text: paragraphs(35) });
  await atEnd(page);
  await wheelUp(page);
  await moveScroll(page, scroll(page), 10000);
  await atEnd(page);
  await wheelUp(page);
  await page.locator('#chat textarea').fill('Summarize that.');
  await page.locator('#chat textarea').press('Enter');
  await atEnd(page);
});

test('keyboard history navigation works without confusing composer arrow keys', async ({ page }) => {
  await add(page, { kind: 'text', text: paragraphs(35) });
  await atEnd(page);
  await scroll(page).focus();
  await page.keyboard.press('Home');
  await expect(latest(page)).toBeVisible();
  await expect.poll(() => scroll(page).evaluate((el) => el.scrollTop)).toBe(0);
  await page.keyboard.press('End');
  await atEnd(page);
  await page.locator('#chat textarea').fill('Draft message');
  await page.locator('#chat textarea').press('ArrowUp');
  await atEnd(page);
});

test('nested tool output scrolls independently', async ({ page }) => {
  await add(page, { kind: 'text', text: paragraphs(20) });
  await add(page, { kind: 'tool', toolKind: 'execute', title: '`npm test`', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: Array.from({ length: 100 }, (_, i) => 'Output line ' + i).join('\n') } }] });
  await work(page).locator(':scope > summary').click();
  await page.locator('#chat .tool > summary').click();
  const out = page.locator('#chat .tool .out');
  await out.evaluate((el) => { el.style.maxHeight = '90px'; el.style.overflowY = 'auto'; el.scrollTop = el.scrollHeight; });
  // Restore following after opening earlier work through keyboard focus.
  if (await latest(page).isVisible()) await latest(page).click();
  await atEnd(page);
  await moveScroll(page, out, -40);
  await expect.poll(() => out.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeGreaterThan(10);
  await atEnd(page);
});

test('composer and viewport resizing follow only when already following', async ({ page }) => {
  await add(page, { kind: 'text', text: paragraphs(35) });
  await atEnd(page);
  await page.locator('#chat textarea').fill('A growing draft\n'.repeat(8));
  await atEnd(page);
  const size = page.viewportSize();
  await page.setViewportSize({ width: size.width, height: size.height - 80 });
  await atEnd(page);
  await wheelUp(page);
  const top = await scroll(page).evaluate((el) => el.scrollTop);
  await page.setViewportSize(size);
  await expect(latest(page)).toBeVisible();
  await expect.poll(() => scroll(page).evaluate((el) => el.scrollTop)).toBeCloseTo(top, 0);
});

test('focusing a history link leaves following and keeps that link in view', async ({ page }) => {
  await add(page, { kind: 'text', text: '[Earlier result](https://example.com)\n\n' + paragraphs(35) });
  await atEnd(page);
  const link = page.getByRole('link', { name: 'Earlier result' });
  await link.focus();
  await expect(latest(page)).toBeVisible();
  await expect(link).toBeInViewport();
  await latest(page).click();
  await atEnd(page);
});

test('page and side panel follow independently, and panel disposal removes its handlers', async ({ page }) => {
  test.skip(page.viewportSize().width < 600, 'Two simultaneous chats need a desktop width.');
  const id = await add(page, { kind: 'text', text: paragraphs(35) });
  await page.evaluate(() => window.chatTest.panel());
  const panelId = await add(page, { kind: 'text', text: paragraphs(35) }, 'panel');
  await atEnd(page); await atEnd(page, '#panel');
  await wheelUp(page, '#panel');
  await add(page, { id, kind: 'text', text: paragraphs(40) });
  await add(page, { id: panelId, kind: 'text', text: paragraphs(40) }, 'panel');
  await atEnd(page); await expect(latest(page, '#panel')).toBeVisible();
  await page.evaluate(() => window.chatTest.closePanel());
  await expect(page.locator('#panel .thread')).toHaveCount(0);
  await add(page, { id, kind: 'text', text: paragraphs(45) });
  await atEnd(page);
});

test('showing earlier turns preserves the visible history and pauses following', async ({ page }) => {
  await page.evaluate(() => {
    for (let turn = 2; turn <= 55; turn++) {
      window.chatTest.item({ turn, kind: 'user', text: 'Question ' + turn });
      window.chatTest.item({ turn, kind: 'text', text: 'Answer ' + turn });
      window.chatTest.item({ turn, kind: 'turn', stopReason: 'end_turn' });
    }
    window.chatTest.status({ running: false, status: 'idle' });
  });
  await atEnd(page);
  await scroll(page).focus();
  await page.keyboard.press('Home');
  await expect.poll(() => scroll(page).evaluate((el) => el.scrollTop)).toBe(0);
  const anchor = page.locator('#chat section[data-turn="6"]');
  const before = await anchor.evaluate((el) => el.getBoundingClientRect().top);
  await page.getByRole('button', { name: 'Show 5 earlier turns' }).click();
  await expect(page.locator('#chat .turn')).toHaveCount(55);
  await expect(latest(page)).toBeVisible();
  await expect.poll(async () => Math.abs(await anchor.evaluate((el) => el.getBoundingClientRect().top) - before)).toBeLessThanOrEqual(1);
});

test('native touch scrolling can leave the end and Latest resumes it', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native touch input uses Chromium CDP; other cases run on phone WebKit too.');
  await add(page, { kind: 'text', text: paragraphs(40) });
  await atEnd(page);
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const box = await scroll(page).boundingBox(), x = box.x + box.width / 2, y = box.y + 100;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 10; step++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + step * 20 }] });
    await page.waitForTimeout(20);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(latest(page)).toBeVisible();
  await expect.poll(() => scroll(page).evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeGreaterThan(100);
  await latest(page).click();
  await atEnd(page);
  await session.detach();
});

test('light and dark chat layouts fit page, panel and phone widths', async ({ page }, testInfo) => {
  await add(page, { kind: 'thought', text: 'Checking the implementation.' });
  await add(page, { kind: 'tool', toolKind: 'execute', title: '`npm test -- tests/chat/work-and-follow-output.test.mjs`', status: 'in_progress' });
  await add(page, { kind: 'text', text: paragraphs(10) });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((name) => window.chatTest.theme(name), theme);
    await scroll(page).focus();
    await page.keyboard.press('Home');
    await expect.poll(() => scroll(page).evaluate((el) => el.scrollTop)).toBe(0);
    await expect.poll(() => scroll(page).evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`page-${theme}.png`) });
  }
  await page.evaluate(() => window.chatTest.panel(true));
  await add(page, { kind: 'thought', text: 'Reviewing the result.' }, 'panel');
  await add(page, { kind: 'tool', toolKind: 'read', title: 'Read tests/chat.test.mjs', status: 'in_progress' }, 'panel');
  await add(page, { kind: 'text', text: paragraphs(10) }, 'panel');
  for (const theme of ['light', 'dark']) {
    await page.evaluate((name) => window.chatTest.theme(name), theme);
    await scroll(page, '#panel').focus();
    await page.keyboard.press('Home');
    await expect.poll(() => scroll(page, '#panel').evaluate((el) => el.scrollTop)).toBe(0);
    await expect.poll(() => scroll(page, '#panel').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`panel-${theme}.png`) });
  }
});
