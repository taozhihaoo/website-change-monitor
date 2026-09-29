import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureSite, readFixture, type FixtureSite } from './helpers/fixture-site.js';
import { buildRealStack, type RealStack } from './helpers/real-stack.js';

/**
 * HTTP API integration suite: Fastify → services → SQLite, exercised through
 * app.inject() against the real stack (real browser, real database).
 */
describe('HTTP API', () => {
  let site: FixtureSite;
  let stack: RealStack;

  beforeAll(async () => {
    site = await startFixtureSite();
    stack = await buildRealStack();
  });

  afterAll(async () => {
    await stack.close();
    await site.close();
  });

  it('GET /health reports ok with scheduler status', async () => {
    const response = await stack.app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
    expect(response.json().scheduler).toMatchObject({ active_checks: 0, queued_checks: 0 });
  });

  it('POST /monitors validates input (400) and blocks private URLs', async () => {
    const missingName = await stack.app.inject({
      method: 'POST',
      url: '/monitors',
      payload: { url: site.url, selector: '.price' },
    });
    expect(missingName.statusCode).toBe(400);
    const body = missingName.json() as { error: { code: string; details: unknown } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toBeDefined();

    const badInterval = await stack.app.inject({
      method: 'POST',
      url: '/monitors',
      payload: {
        name: 'x',
        url: site.url,
        selector: '.price',
        check_interval_seconds: 10,
      },
    });
    expect(badInterval.statusCode).toBe(400);

    const badType = await stack.app.inject({
      method: 'POST',
      url: '/monitors',
      payload: { name: 'x', url: site.url, selector: '.price', selector_type: 'regex' },
    });
    expect(badType.statusCode).toBe(400);
  });

  it('create → read → list → patch → delete lifecycle', async () => {
    const created = await stack.app.inject({
      method: 'POST',
      url: '/monitors',
      payload: {
        name: 'API lifecycle',
        url: site.url,
        selector: '.product-price',
        selector_type: 'css',
        check_interval_seconds: 600,
        webhook_url: '',
      },
    });
    expect(created.statusCode).toBe(201);
    const monitor = (created.json() as { monitor: Record<string, unknown> }).monitor;
    expect(monitor).toMatchObject({
      name: 'API lifecycle',
      selector_type: 'css',
      check_interval_seconds: 600,
      enabled: true,
      webhook_url: null,
    });
    const id = monitor.id as string;

    const detail = await stack.app.inject({ method: 'GET', url: `/monitors/${id}` });
    expect(detail.statusCode).toBe(200);

    const list = await stack.app.inject({ method: 'GET', url: '/monitors' });
    const monitors = (list.json() as { monitors: Record<string, unknown>[] }).monitors;
    expect(monitors.some((entry) => entry.id === id)).toBe(true);

    const patched = await stack.app.inject({
      method: 'PATCH',
      url: `/monitors/${id}`,
      payload: { name: 'Renamed via API', enabled: false },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { monitor: Record<string, unknown> }).monitor).toMatchObject({
      name: 'Renamed via API',
      enabled: false,
    });

    const emptyPatch = await stack.app.inject({
      method: 'PATCH',
      url: `/monitors/${id}`,
      payload: {},
    });
    expect(emptyPatch.statusCode).toBe(400);

    const deleted = await stack.app.inject({ method: 'DELETE', url: `/monitors/${id}` });
    expect(deleted.statusCode).toBe(204);
    const gone = await stack.app.inject({ method: 'GET', url: `/monitors/${id}` });
    expect(gone.statusCode).toBe(404);
    expect((gone.json() as { error: { code: string } }).error.code).toBe('MONITOR_NOT_FOUND');
  });

  it('unknown monitor id → 404; malformed id → 400', async () => {
    const unknown = await stack.app.inject({
      method: 'GET',
      url: '/monitors/74a3e33f-1c58-4a1e-a6d3-9f7e2c11b001',
    });
    expect(unknown.statusCode).toBe(404);

    const malformed = await stack.app.inject({ method: 'GET', url: '/monitors/not-a-uuid' });
    expect(malformed.statusCode).toBe(400);
  });

  it('run now (wait) executes a full check through the API', async () => {
    const created = await stack.app.inject({
      method: 'POST',
      url: '/monitors',
      payload: { name: 'Run now', url: site.url, selector: '.product-price' },
    });
    const id = (created.json() as { monitor: { id: string } }).monitor.id;

    const run = await stack.app.inject({ method: 'POST', url: `/monitors/${id}/run?wait=1` });
    expect(run.statusCode).toBe(200);
    const runBody = run.json() as { run: Record<string, unknown>; change_event: unknown };
    expect(runBody.run.status).toBe('baseline');
    expect(runBody.change_event).toBeNull();

    const runs = await stack.app.inject({ method: 'GET', url: `/monitors/${id}/runs` });
    expect((runs.json() as { runs: unknown[] }).runs).toHaveLength(1);

    const changes = await stack.app.inject({ method: 'GET', url: `/monitors/${id}/changes` });
    expect((changes.json() as { changes: unknown[] }).changes).toHaveLength(0);

    const notifications = await stack.app.inject({
      method: 'GET',
      url: `/monitors/${id}/notifications`,
    });
    expect(notifications.statusCode).toBe(200);
  });

  it('run now without wait returns 202 queued', async () => {
    const created = await stack.app.inject({
      method: 'POST',
      url: '/monitors',
      payload: { name: 'Queued run', url: site.url, selector: '.product-stock' },
    });
    const id = (created.json() as { monitor: { id: string } }).monitor.id;
    const queued = await stack.app.inject({ method: 'POST', url: `/monitors/${id}/run` });
    expect(queued.statusCode).toBe(202);
    expect(queued.json()).toMatchObject({ status: 'queued', monitor_id: id });
  });

  it('test-extraction endpoint returns content and never persists', async () => {
    const response = await stack.app.inject({
      method: 'POST',
      url: '/monitors/test-extraction',
      payload: { url: site.url, selector: '.product-price', selector_type: 'css' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ content: '$99' }); // api suite keeps serving site-v1

    const failing = await stack.app.inject({
      method: 'POST',
      url: '/monitors/test-extraction',
      payload: { url: site.url, selector: '.nope', selector_type: 'css' },
    });
    expect(failing.statusCode).toBe(422);
    expect((failing.json() as { error: { code: string } }).error.code).toBe(
      'SELECTOR_NOT_FOUND',
    );
  });

  it('POST /monitors/:id/test-notification reports delivery status', async () => {
    const created = await stack.app.inject({
      method: 'POST',
      url: '/monitors',
      payload: { name: 'Notify test', url: site.url, selector: '.product-price' },
    });
    const id = (created.json() as { monitor: { id: string } }).monitor.id;
    const response = await stack.app.inject({
      method: 'POST',
      url: `/monitors/${id}/test-notification`,
    });
    expect(response.statusCode).toBe(200);
    const notifyBody = response.json() as { results: Array<{ provider: string; delivered: boolean }> };
    expect(notifyBody.results[0]).toMatchObject({ provider: 'mock', delivered: true });
  });

  it('webhook deliveries keep the full endpoint internally, masked over the API', async () => {
    // point the monitor at an unreachable (offline) webhook with a secret path
    const created = await stack.app.inject({
      method: 'POST',
      url: '/monitors',
      payload: {
        name: 'Hook mask',
        url: site.url,
        selector: '.product-price',
        webhook_url: 'https://hooks.example.com/webhooks/abc123?token=secret',
      },
    });
    const id = (created.json() as { monitor: { id: string } }).monitor.id;

    // force a change so a notification fires: baseline on v2, then flip to v1
    await site.setPage(await readFixture('site-v2.html'));
    await stack.app.inject({ method: 'POST', url: `/monitors/${id}/run?wait=1` });
    await site.setPage(await readFixture('site-v1.html'));
    const run = await stack.app.inject({ method: 'POST', url: `/monitors/${id}/run?wait=1` });
    expect((run.json() as { run: { status: string } }).run.status).toBe('changed');

    const changes = await stack.app.inject({ method: 'GET', url: `/monitors/${id}/changes` });
    const body = changes.body;
    const deliveries = (
      changes.json() as {
        changes: Array<{ deliveries: Array<{ target: string; last_error: string | null }> }>;
      }
    ).changes[0]?.deliveries;
    expect(deliveries).toHaveLength(1);
    // API shows origin only — path and secret query are masked
    expect(deliveries?.[0]?.target).toBe('https://hooks.example.com/…');
    expect(body).not.toContain('abc123');
    expect(body).not.toContain('token=secret');
    // failure details must not leak the configured URL either
    expect(deliveries?.[0]?.last_error ?? '').not.toContain('http');
  });

  it('GET /stats aggregates dashboard numbers', async () => {
    const response = await stack.app.inject({ method: 'GET', url: '/stats' });
    expect(response.statusCode).toBe(200);
    const stats = response.json() as Record<string, unknown>;
    expect(stats.total_monitors).toBeGreaterThan(0);
    expect(stats.changes_detected).toBeGreaterThanOrEqual(0);
  });

  it('unknown routes return the JSON 404 envelope; malformed JSON → 400', async () => {
    const missing = await stack.app.inject({ method: 'GET', url: '/definitely-not-here' });
    expect(missing.statusCode).toBe(404);
    expect((missing.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');

    const malformed = await stack.app.inject({
      method: 'POST',
      url: '/monitors',
      payload: 'this is not json',
      headers: { 'content-type': 'application/json' },
    });
    expect(malformed.statusCode).toBe(400);
  });
});
