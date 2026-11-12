/**
 * Regenerates the README screenshots from a REAL running instance.
 *
 *   npm run build && npm run screenshots
 *
 * Seeds a throwaway SQLite database with representative monitors, change
 * events, check runs and deliveries, starts the built server on a private
 * port, then captures the dashboard and monitor detail in English and
 * Chinese with Playwright.
 */
import { mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DB_PATH = join(ROOT, 'data', 'screenshots.db');
const PORT = 3205;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT_DIR = join(ROOT, 'docs', 'screenshots');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function seed(db) {
  const monitorInsert = db.prepare(
    `INSERT INTO monitors
      (id, name, url, selector, selector_type, check_interval_seconds, enabled, webhook_url, notify_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const snapshotInsert = db.prepare(
    `INSERT INTO snapshots (id, monitor_id, content_hash, content, checked_at) VALUES (?, ?, ?, ?, ?)`,
  );
  const eventInsert = db.prepare(
    `INSERT INTO change_events
      (id, monitor_id, previous_hash, current_hash, previous_content, current_content, diff_json, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const runInsert = db.prepare(
    `INSERT INTO check_runs
      (id, monitor_id, triggered_by, status, error_code, error_message, duration_ms, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const deliveryInsert = db.prepare(
    `INSERT INTO notification_deliveries
      (id, change_event_id, monitor_id, provider, target, status, attempts, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const monitors = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Acme Store · Wireless Mouse M200 price',
      url: 'https://acme-store.example/products/wireless-mouse',
      selector: '.product-price',
      type: 'css',
      interval: 300,
      enabled: 1,
      webhook: 'https://hooks.example.com/acme/price?token=…',
      email: 'ops@acme.example',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Pricing page · Pro plan',
      url: 'https://saas.example.com/pricing',
      selector: '.plan-price',
      type: 'css',
      interval: 3600,
      enabled: 1,
      webhook: null,
      email: 'billing@saas.example',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Careers · Senior engineering roles',
      url: 'https://careers.example.com/jobs',
      selector: "//div[@class='job-list']",
      type: 'xpath',
      interval: 21600,
      enabled: 1,
      webhook: null,
      email: null,
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Docs · API changelog',
      url: 'https://docs.example.com/changelog',
      selector: 'Breaking changes',
      type: 'text',
      interval: 900,
      enabled: 1,
      webhook: 'https://hooks.example.com/docs/changelog',
      email: null,
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Status page · Incident banner',
      url: 'https://status.example.com',
      selector: '.incident-banner',
      type: 'css',
      interval: 300,
      enabled: 0,
      webhook: null,
      email: null,
    },
  ];

  for (const m of monitors) {
    monitorInsert.run(
      m.id,
      m.name,
      m.url,
      m.selector,
      m.type,
      m.interval,
      m.enabled,
      m.webhook,
      m.email,
      iso(3 * DAY),
      iso(2 * MIN),
    );
  }

  // --- monitor 1: changed, rich history -----------------------------------
  const m1 = monitors[0].id;
  snapshotInsert.run('s101', m1, 'a1b2c3d4e5f60718', '$89', iso(2 * MIN));
  snapshotInsert.run('s102', m1, '9f8e7d6c5b4a3928', '$89', iso(1 * HOUR));
  snapshotInsert.run('s103', m1, '1122334455667788', '$99', iso(1 * DAY));

  eventInsert.run(
    'e101',
    m1,
    '1122334455667788',
    '9f8e7d6c5b4a3928',
    '$99',
    '$89',
    JSON.stringify({
      added: 1,
      removed: 1,
      changes: [
        { type: 'removed', value: '$99', count: 1 },
        { type: 'added', value: '$89', count: 1 },
      ],
    }),
    iso(18 * MIN),
  );
  eventInsert.run(
    'e102',
    m1,
    '5566778899aabbcc',
    '1122334455667788',
    '$94',
    '$99',
    JSON.stringify({
      added: 1,
      removed: 1,
      changes: [
        { type: 'removed', value: '$94', count: 1 },
        { type: 'added', value: '$99', count: 1 },
      ],
    }),
    iso(2 * HOUR),
  );
  eventInsert.run(
    'e103',
    m1,
    'ddeeff0011223344',
    '5566778899aabbcc',
    '$129',
    '$94',
    JSON.stringify({
      added: 1,
      removed: 1,
      changes: [
        { type: 'removed', value: '$129', count: 1 },
        { type: 'added', value: '$94', count: 1 },
      ],
    }),
    iso(1 * DAY),
  );

  deliveryInsert.run('d101', 'e101', m1, 'webhook', 'https://hooks.example.com/acme/price?token=…', 'sent', 1, null, iso(18 * MIN), iso(18 * MIN));
  deliveryInsert.run('d102', 'e101', m1, 'email', 'ops@acme.example', 'sent', 1, null, iso(18 * MIN), iso(18 * MIN));
  deliveryInsert.run('d103', 'e102', m1, 'webhook', 'https://hooks.example.com/acme/price?token=…', 'sent', 1, null, iso(2 * HOUR), iso(2 * HOUR));
  deliveryInsert.run('d104', 'e103', m1, 'webhook', 'https://hooks.example.com/acme/price?token=…', 'failed', 3, 'Webhook endpoint responded with HTTP 503.', iso(1 * DAY), iso(1 * DAY));

  const m1Runs = [
    { id: 'r101', status: 'unchanged', started: iso(2 * MIN), duration: 842 },
    { id: 'r102', status: 'changed', started: iso(18 * MIN), duration: 913 },
    { id: 'r103', status: 'unchanged', started: iso(1 * HOUR), duration: 771 },
    { id: 'r104', status: 'changed', started: iso(2 * HOUR), duration: 1204 },
    { id: 'r105', status: 'changed', started: iso(1 * DAY), duration: 998 },
    { id: 'r106', status: 'baseline', started: iso(3 * DAY), duration: 1431 },
  ];
  for (const run of m1Runs) {
    runInsert.run(run.id, m1, run.id === 'r106' ? 'manual' : 'schedule', run.status, null, null, run.duration, run.started, run.started);
  }

  // --- monitor 2: unchanged, healthy --------------------------------------
  const m2 = monitors[1].id;
  snapshotInsert.run('s201', m2, 'c0ffee00112233', '$29 / month', iso(5 * MIN));
  snapshotInsert.run('s202', m2, 'c0ffee00112233', '$29 / month', iso(1 * HOUR));
  for (const [id, started] of [
    ['r201', iso(5 * MIN)],
    ['r202', iso(1 * HOUR)],
    ['r203', iso(2 * HOUR)],
  ]) {
    runInsert.run(id, m2, 'schedule', 'unchanged', null, null, 604, started, started);
  }

  // --- monitor 3: baseline ------------------------------------------------
  const m3 = monitors[2].id;
  snapshotInsert.run(
    's301',
    m3,
    'feedfacecafebabe',
    'Senior Frontend Engineer — Remote\nSenior Backend Engineer — Berlin',
    iso(12 * MIN),
  );
  runInsert.run('r301', m3, 'schedule', 'baseline', null, null, 1120, iso(12 * MIN), iso(12 * MIN));

  // --- monitor 4: failing -------------------------------------------------
  const m4 = monitors[3].id;
  snapshotInsert.run(
    's401',
    m4,
    'deadbeef0011',
    'Breaking changes: v2 removes the legacy /v1/status endpoint.',
    iso(1 * HOUR),
  );
  runInsert.run('r401', m4, 'schedule', 'error', 'NETWORK_ERROR', 'A network error occurred while fetching the page.', 812, iso(1 * HOUR), iso(1 * HOUR));
  runInsert.run('r402', m4, 'schedule', 'error', 'NETWORK_ERROR', 'A network error occurred while fetching the page.', 795, iso(2 * HOUR), iso(2 * HOUR));
  runInsert.run('r403', m4, 'schedule', 'unchanged', null, null, 903, iso(3 * HOUR), iso(3 * HOUR));
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error('Server did not become healthy in time.');
}

async function capture(browser, locale) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1.5,
    locale: locale === 'zh' ? 'zh-CN' : 'en-US',
    colorScheme: 'light',
  });
  await context.addInitScript(() => {
    globalThis.localStorage.setItem('wcm.theme', 'light');
  });
  const page = await context.newPage();

  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.stats-grid');
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT_DIR, `dashboard-${locale}.png`) });

  await page.goto(`${BASE}/#/monitors/11111111-1111-4111-8111-111111111111`, {
    waitUntil: 'networkidle',
  });
  await page.waitForSelector('.timeline');
  await page.locator('.change-item summary').first().click();
  await page.waitForTimeout(400);
  const cardTop = await page.locator('.timeline').evaluate((element) => {
    const card = element.closest('section.card') ?? element;
    return card.getBoundingClientRect().top + globalThis.scrollY - 86;
  });
  await page.evaluate((top) => globalThis.scrollTo(0, top), cardTop);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT_DIR, `detail-${locale}.png`) });

  await context.close();
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(join(ROOT, 'data'), { recursive: true });
  await rm(DB_PATH, { force: true });
  await rm(`${DB_PATH}-wal`, { force: true });
  await rm(`${DB_PATH}-shm`, { force: true });

  const { openDatabase } = await import('../dist/db/database.js');
  const { migrate } = await import('../dist/db/migrate.js');
  const db = openDatabase(DB_PATH);
  migrate(db);
  seed(db);

  const server = spawn(process.execPath, ['dist/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      APP_PORT: String(PORT),
      DB_PATH: 'data/screenshots.db',
      LOG_LEVEL: 'error',
      SCHEDULER_TICK_MS: '600000',
      BROWSER_HEADLESS: 'true',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const browser = await chromium.launch();
  try {
    await waitForHealth();
    for (const locale of ['en', 'zh']) {
      await capture(browser, locale);
      console.log(`captured dashboard-${locale}.png and detail-${locale}.png`);
    }
  } finally {
    await browser.close();
    db.close();
    server.kill();
    await sleep(400);
  }
  console.log('screenshots written to docs/screenshots/');
}

main().catch((error) => {
  console.error('screenshot capture failed:', error);
  process.exitCode = 1;
});
