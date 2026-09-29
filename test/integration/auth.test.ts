import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureSite, type FixtureSite } from './helpers/fixture-site.js';
import { buildRealStack, type RealStack } from './helpers/real-stack.js';

/**
 * Single-user API key protection: when APP_API_KEY is configured, every API
 * route except /health requires `Authorization: Bearer <key>`; with no key
 * configured everything stays open (trusted-network mode).
 */
describe('API key authentication', () => {
  let site: FixtureSite;
  let stack: RealStack;
  const KEY = 'phase2-verification-key-0123456789';

  beforeAll(async () => {
    site = await startFixtureSite();
    stack = await buildRealStack({ appApiKey: KEY });
  });

  afterAll(async () => {
    await stack.close();
    await site.close();
  });

  it('/health stays public for liveness probes', async () => {
    const response = await stack.app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('rejects API requests without or with a wrong bearer token', async () => {
    const noKey = await stack.app.inject({ method: 'GET', url: '/monitors' });
    expect(noKey.statusCode).toBe(401);
    expect(noKey.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });

    const wrongKey = await stack.app.inject({
      method: 'GET',
      url: '/monitors',
      headers: { authorization: 'Bearer wrong-key-wrong-key-1234' },
    });
    expect(wrongKey.statusCode).toBe(401);

    const writeBlocked = await stack.app.inject({
      method: 'POST',
      url: '/monitors',
      payload: { name: 'x', url: site.url, selector: '.price' },
    });
    expect(writeBlocked.statusCode).toBe(401);
  });

  it('accepts requests with the correct bearer key', async () => {
    const list = await stack.app.inject({
      method: 'GET',
      url: '/monitors',
      headers: { authorization: `Bearer ${KEY}` },
    });
    expect(list.statusCode).toBe(200);

    const created = await stack.app.inject({
      method: 'POST',
      url: '/monitors',
      headers: { authorization: `Bearer ${KEY}` },
      payload: { name: 'Authed monitor', url: site.url, selector: '.product-price' },
    });
    expect(created.statusCode).toBe(201);
  });

  it('never echoes the key or a distinguishable mismatch in responses', async () => {
    const response = await stack.app.inject({
      method: 'GET',
      url: '/monitors',
      headers: { authorization: `Bearer ${KEY.slice(0, -1)}x` },
    });
    expect(response.body).not.toContain(KEY);
    expect(response.body).not.toContain(KEY.slice(0, -1));
    // identical envelope for missing vs wrong key (no oracle about the key)
    const missing = await stack.app.inject({ method: 'GET', url: '/monitors' });
    expect(missing.body).toBe(response.body);
  });

  it('non-API paths (unknown routes) stay reachable without the key', async () => {
    const response = await stack.app.inject({ method: 'GET', url: '/definitely-not-here' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
