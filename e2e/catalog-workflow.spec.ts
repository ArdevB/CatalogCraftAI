import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'csv-parse/sync';

/**
 * The complete CSV-first workflow from the spec (§13), in a real browser:
 * register → client → upload → map → validate → AI suggestions (scripted AI)
 * → review (approve some, reject one) → export → check the file → another
 * agency can't see any of it.
 */

// Synthetic products. "00042" has a leading zero and the barcode is long:
// both break if anything treats them as numbers. The note is a formula.
const CSV = [
  'SKU,Title,Description,Price,Stock,Barcode,Supplier note',
  '00042,Stoneware mug,Glazed mug.,12.50,-3,4006381333931,keep cool',
  'MUG-2,Enamel mug,Light enamel mug.,9.99,15,5012345678900,"=HYPERLINK(""http://evil.example"")"',
  'MUG-3,Glass tumbler,Clear tumbler.,4.00,40,,',
].join('\n');

let counter = 0;
async function registerAgency(page: Page, agencyName: string) {
  counter += 1;
  const email = `e2e-${Date.now()}-${counter}@example.test`;
  await page.goto('/register');
  await page.getByLabel('Your name').fill('E2E Tester');
  await page.getByLabel('Agency / organization name').fill(agencyName);
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill('a-long-e2e-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening), E2E$/ })).toBeVisible();
  return email;
}

test('an agency imports, enriches, reviews and exports a catalogue — and nobody else can see it', async ({ page, browser }) => {
  // 1. Register an agency user.
  await registerAgency(page, 'E2E Agency');

  // 2. Create a client workspace.
  await page.goto('/clients/new');
  await page.getByLabel('Client name').fill('Kitchen Co');
  await page.getByRole('button', { name: 'Create client' }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen Co' })).toBeVisible();

  // 3. Upload a synthetic CSV file.
  await page.getByRole('button', { name: 'New import' }).click();
  await expect(page).toHaveURL(/\/jobs\/[a-f0-9]{24}$/);
  const jobUrl = page.url();
  await page.getByLabel('Catalogue file').setInputFiles({ name: 'supplier.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });

  // 4. Map its columns (the suggested mapping recognises these headers), 5. preview and validate.
  await expect(page.getByRole('heading', { name: 'Map columns' })).toBeVisible();
  await expect(page.getByText('Stoneware mug').first()).toBeVisible(); // preview of the file
  await page.getByRole('button', { name: 'Save mapping and validate' }).click();
  await expect(page.getByText('Issues found').or(page.getByText('Valid').first())).toBeVisible();

  // 6. Enrich selected fields (title and description) with the configured (scripted) AI.
  await page.getByRole('button', { name: 'Generate suggestions' }).click();
  await expect(page.getByRole('heading', { name: 'Review suggestions' })).toBeVisible({ timeout: 60_000 });

  // 7. Review suggestions, 8. approve some, 9. reject another.
  // The list starts on "Pending", where reviewed rows drop out; show all so decisions stay visible.
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByRole('button', { name: 'Approve Title for 00042' }).click();
  await expect(page.getByRole('button', { name: 'Undo review of Title for 00042' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve Description for 00042' }).click();
  await expect(page.getByRole('button', { name: 'Undo review of Description for 00042' })).toBeVisible();
  await page.getByRole('button', { name: 'Reject Title for MUG-2' }).click();
  await expect(page.getByRole('button', { name: 'Undo review of Title for MUG-2' })).toBeVisible();

  // 10. Export the approved catalogue.
  await page.getByRole('button', { name: 'Create export' }).click();
  const downloadLink = page.getByRole('link', { name: /^Download .*\.csv$/ }).first();
  await expect(downloadLink).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
  const csvText = (await readFile((await download.path())!)).toString('utf8');

  // 11. Identifiers and protected values are unchanged; only approved text changed.
  const rows = parse(csvText, { columns: true, bom: true }) as Record<string, string>[];
  const bySku = new Map(rows.map((row) => [row.SKU, row]));
  expect(bySku.get('00042')).toMatchObject({
    Title: 'Improved Stoneware mug', // approved
    Description: 'A clear description of the Stoneware mug.', // approved
    Price: '12.50',
    Stock: '-3',
    Barcode: '4006381333931',
  });
  expect(bySku.get('MUG-2')).toMatchObject({ Title: 'Enamel mug', Description: 'Light enamel mug.', Price: '9.99' }); // rejected / pending
  expect(bySku.get('MUG-2')!['Supplier note']).toMatch(/^'=HYPERLINK/); // formula made safe
  expect(bySku.get('MUG-3')).toMatchObject({ Title: 'Glass tumbler' }); // never reviewed → original

  // 12. Another organization cannot access the job, its rows or its export.
  const jobId = jobUrl.split('/').pop()!;
  const exportHref = (await downloadLink.getAttribute('href'))!;
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await registerAgency(other, 'Rival Agency');
  await other.goto(`/jobs/${jobId}`);
  await expect(other.getByRole('heading', { name: 'Job not found' })).toBeVisible();
  for (const path of [`/api/v1/jobs/${jobId}`, `/api/v1/jobs/${jobId}/rows`, exportHref]) {
    expect((await other.request.get(path)).status(), path).toBe(404);
  }
  await otherContext.close();
});

test('the deployed page is locked down: security headers, cookies, no secrets in the bundle, no policy violations', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    // HTTP errors are logged by Chrome too (e.g. the expected 401 "am I signed in?" check); those aren't page problems.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));

  const response = await page.goto('/register');
  const headers = response!.headers();
  expect(headers['content-security-policy']).toContain("script-src 'self'");
  expect(headers['x-frame-options']).toBe('SAMEORIGIN');
  expect(headers['x-content-type-options']).toBe('nosniff');

  await registerAgency(page, 'Header Check Agency');
  const [cookie] = await page.context().cookies();
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax' });

  // Nothing secret may be compiled into JavaScript that every visitor downloads.
  const scripts = await page.locator('script[src]').evaluateAll((elements) => elements.map((element) => (element as HTMLScriptElement).src));
  for (const src of scripts) {
    const code = await (await page.request.get(src)).text();
    // The shapes real secret values take (help text may mention variable names like AI_API_KEY — that's fine).
    for (const pattern of [/sk-ant-[A-Za-z0-9_-]{8,}/, /mongodb(\+srv)?:\/\/[^\s'"`]*@/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /AKIA[0-9A-Z]{16}/]) {
      expect(pattern.test(code), `${src} matches ${pattern}`).toBe(false);
    }
  }

  // Visit the main pages: a blocked script or style (CSP) would show up as a console error.
  for (const path of ['/dashboard', '/clients', '/jobs', '/usage', '/settings/organization', '/settings/account']) {
    await page.goto(path);
    await expect(page.locator('main h1').first()).toBeVisible();
  }
  expect(problems).toEqual([]);
});
