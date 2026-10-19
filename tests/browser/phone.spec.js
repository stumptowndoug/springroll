import { test, expect } from '@playwright/test';

// On a phone the chat gets the screen: the title is in Springroll's top bar (not part of this fixture), the
// agent in the composer, so the chat's own header shows only a job, a status or a folder other than ~/home.
const phone = () => test.info().project.name === 'phone';
const head = (page) => page.locator('#chat .thread-head');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#chat .msg-user')).toBeVisible();
});

test('the header gives way on a phone and stays on a computer', async ({ page }, info) => {
  if (phone()) {
    await expect(head(page)).toBeHidden();
    await expect(page.locator('#chat textarea')).toHaveAttribute('placeholder', 'Ask anything');
    const box = await page.locator('#chat .thread-scroll').boundingBox();
    expect(box.height / page.viewportSize().height).toBeGreaterThan(0.7);
  } else {
    await expect(page.locator('#chat .th-title')).toHaveText('Make chat easier to follow');
    await expect(page.locator('#chat .th-meta')).toContainText('~/home');
  }
  for (const theme of ['dark', 'light']) {
    await page.evaluate((name) => window.chatTest.theme(name), theme);
    await page.screenshot({ path: info.outputPath(`head-${theme}.png`) });
  }
});

test('a job, a status or another folder keeps one line', async ({ page }) => {
  await page.evaluate(() => window.chatTest.status({ origin: 'job:mail-triage', cwd: '/home/agent/projects/site', status: 'waiting', running: false }));
  await expect(page.locator('#chat .th-meta')).toContainText('mail-triage');
  await expect(page.locator('#chat .th-meta')).toContainText('Needs you');
  await expect(page.locator('#chat .th-meta .th-cwd')).toBeVisible();
  if (phone()) {
    await expect(page.locator('#chat .th-title')).toBeHidden();
    expect((await head(page).boundingBox()).height).toBeLessThan(48);
  }
});

test('on a touch screen Return is a new line and the button sends', async ({ page }) => {
  test.skip(!phone(), 'touch screens only');
  const box = page.locator('#chat textarea');
  await box.fill('First line');
  await box.press('Enter');
  await box.pressSequentially('second line');
  await expect(box).toHaveValue('First line\nsecond line');
  await page.locator('#chat .c-send').click();
  await expect.poll(() => page.evaluate(() => JSON.stringify(window.chatTest.posts.at(-1)?.body || {}))).toContain('First line\\nsecond line');
});
