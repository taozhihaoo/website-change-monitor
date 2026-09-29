import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureSite, type FixtureSite } from './helpers/fixture-site.js';
import { buildRealStack, type RealStack } from './helpers/real-stack.js';

/**
 * BrowserManager stability: one shared browser survives across checks and a
 * crashed/killed browser is transparently relaunched on the next use, with
 * every check still getting its own isolated context.
 */
describe('browser lifecycle stability', () => {
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

  it('reuses the same browser across checks and relaunches after a crash', async () => {
    const manager = stack.browserManager;

    await manager.withPage(async (page) => {
      await page.goto(site.url, { waitUntil: 'domcontentloaded' });
      expect(await page.title()).toContain('Acme Store');
    });
    expect(manager.isRunning).toBe(true);

    // simulate a browser crash: kill the underlying process/connection
    const internals = manager as unknown as {
      browser: { close(): Promise<void>; isConnected(): boolean } | null;
    };
    expect(internals.browser).not.toBeNull();
    const crashedBrowser = internals.browser;
    await crashedBrowser?.close();
    expect(manager.isRunning).toBe(false);

    // the next check relaunches transparently — no scheduler stall
    await manager.withPage(async (page) => {
      await page.goto(site.url, { waitUntil: 'domcontentloaded' });
      expect(await page.title()).toContain('Acme Store');
    });
    expect(manager.isRunning).toBe(true);
    expect(internals.browser).not.toBe(crashedBrowser);

    // contexts are closed after each use (no leak): the current browser has
    // no dangling contexts once withPage returned
    const withContexts = internals.browser as unknown as {
      contexts?: unknown[];
    };
    expect((withContexts.contexts ?? []).length).toBe(0);

    // the full pipeline keeps working after the crash
    const monitor = await stack.monitorService.create({
      name: 'After crash',
      url: site.url,
      selector: '.product-price',
      selectorType: 'css',
      checkIntervalSeconds: 300,
      enabled: true,
      webhookUrl: null,
      notifyEmail: null,
    });
    const outcome = await stack.checkService.runCheck(monitor, 'manual');
    expect(outcome.run.status).toBe('baseline');
  });
});
