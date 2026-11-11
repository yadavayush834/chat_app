const { test, expect } = require('@playwright/test');
async function register(page, username) {
  await page.goto('/');
  await page.getByLabel('Your username', { exact: true }).fill(username);
  await page.getByRole('button', { name: 'Create your account', exact: true }).click();
  const words = await page.locator('.phrase-grid li').allTextContents();
  expect(words.length).toBe(12);
  const phrase = words.map((word) => word.replace(/^\d+/, '')).join(' ');
  await page.getByLabel('I saved my phrase somewhere safe.').check();
  await page.getByRole('button', { name: 'Create account & start chatting' }).click();
  await expect(page.getByRole('button', { name: 'New conversation' })).toBeVisible();
  await expect(page.locator('.sidebar-profile')).toContainText('Connected & ready');
  return phrase;
}
test('two accounts: register, connect, type, send, read, attach, search, reconnect and recover on mobile', async ({
  browser,
}) => {
  const contextA = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const contextB = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const a = await contextA.newPage(),
    b = await contextB.newPage();
  const errors = [];
  a.on('pageerror', (err) => errors.push(err.message));
  b.on('pageerror', (err) => errors.push(err.message));
  await a.goto('/');
  await a.screenshot({ path: 'docs/screenshots/welcome.png', fullPage: true });
  const phrase = await register(a, 'ayush');
  await register(b, 'maya');
  await a.getByRole('button', { name: 'New conversation' }).click();
  await a.getByLabel('Their username').fill('nobody_here');
  await a.getByRole('button', { name: 'Start a conversation', exact: true }).last().click();
  await expect(a.getByRole('alert')).toContainText('No account');
  await a.getByLabel('Their username').fill('maya');
  await a.getByRole('button', { name: 'Start a conversation', exact: true }).last().click();
  await expect(a.getByRole('heading', { name: 'maya DIRECT MESSAGE' })).toBeVisible();
  await expect(b.locator('.conversation-item')).toContainText('ayush');
  await a
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Hey Maya! How’s the new project coming along?');
  await expect(b.locator('.conversation-meta .typing-text')).toContainText('typing');
  await a.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(b.locator('.unread-badge')).toHaveText('1');
  await b.locator('.conversation-item').click();
  await expect(b.locator('.message-bubble')).toContainText('new project');
  await expect(a.locator('.message-meta [aria-label="seen"]')).toHaveCount(1);
  await b
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Pretty good! Finally got the first version working ✨');
  await b.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  await expect(a.locator('.message-bubble')).toHaveCount(2);
  await a
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('That’s a win. Coffee tomorrow to celebrate?');
  await a.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  await expect(b.locator('.message-bubble')).toHaveCount(3);
  await b
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Absolutely! Same little place at 11?');
  await b.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  await expect(a.locator('.message-bubble')).toHaveCount(4);
  await a.getByRole('textbox', { name: 'Message', exact: true }).fill('Wouldn’t miss it ');
  await a.getByRole('button', { name: 'Add emoji' }).click();
  await a.getByRole('button', { name: 'Insert ☕' }).click();
  await a.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(b.locator('.message-bubble')).toHaveCount(5);
  await a.locator('input[type=file]').setInputFiles({
    name: 'weekend-plans.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Coffee at 11. Bring your latest ideas!'),
  });
  await expect(a.locator('.attachment-preview')).toContainText('weekend-plans.txt');
  await a.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(b.getByRole('link', { name: /weekend-plans.txt/ })).toBeVisible();
  const downloadPromise = b.waitForEvent('download');
  await b.getByRole('link', { name: /weekend-plans.txt/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('weekend-plans.txt');
  await a.screenshot({ path: 'docs/screenshots/chat-desktop.png', fullPage: true });
  await a.getByRole('button', { name: 'Search this conversation' }).click();
  await a.getByLabel('Search messages', { exact: true }).fill('Coffee tomorrow');
  await expect(a.locator('.message-bubble')).toHaveCount(1);
  await a.getByRole('button', { name: 'Close message search' }).click();
  await a.reload();
  await a.locator('.conversation-item').click();
  await expect(a.locator('.message-bubble')).toHaveCount(6);
  await contextA.setOffline(true);
  await expect(a.getByRole('status').filter({ hasText: 'Connection lost' })).toBeVisible({
    timeout: 15000,
  });
  await a.getByRole('textbox', { name: 'Message', exact: true }).fill('Draft kept while offline');
  await expect(a.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await contextA.setOffline(false);
  await expect(a.locator('.sidebar-profile')).toContainText('Connected & ready', {
    timeout: 15000,
  });
  await expect(a.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
    'Draft kept while offline',
  );
  await a.getByRole('textbox', { name: 'Message', exact: true }).fill('');
  await a.setViewportSize({ width: 390, height: 844 });
  await expect(a.getByRole('button', { name: 'Back to conversations' })).toBeVisible();
  expect(await a.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await a.screenshot({ path: 'docs/screenshots/chat-mobile.png', fullPage: true });
  await a.getByRole('button', { name: 'Back to conversations' }).click();
  await a.getByRole('button', { name: 'Your account', exact: true }).click();
  await a.getByRole('button', { name: 'Sign out of this session' }).click();
  await expect(a).toHaveURL(/login/);
  await a.getByLabel('Your recovery phrase', { exact: true }).fill(phrase);
  await a.getByRole('button', { name: 'Back to your conversations' }).click();
  await expect(a.locator('.conversation-item')).toContainText('maya');
  await a.locator('.conversation-item').click();
  await expect(a.locator('.message-bubble')).toHaveCount(6);
  expect(errors).toEqual([]);
  await contextA.close();
  await contextB.close();
});
test('invalid recovery phrases show a helpful error and narrow auth layout stays within viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await page
    .getByLabel('Your recovery phrase', { exact: true })
    .fill('not a valid recovery phrase');
  await page.getByRole('button', { name: 'Back to your conversations' }).click();
  await expect(page.getByRole('alert')).toContainText('isn’t valid');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
