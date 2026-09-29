import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebhookNotifier } from '../../src/notifications/webhook-notifier.js';
import { MockNotifier } from '../../src/notifications/mock-notifier.js';
import type { NotificationProvider } from '../../src/notifications/provider.js';
import {
  buildStack,
  cleanupStack,
  silentLogger,
  type ServiceStack,
} from '../helpers/test-stack.js';

interface WebhookServer {
  server: Server;
  url: string;
  requests: Array<{ body: string; headers: Record<string, string | string[] | undefined> }>;
  setHandler(handler: (req: { method?: string }, res: { statusCode: number; end: (b?: string) => void }) => void): void;
}

async function startWebhookServer(): Promise<WebhookServer> {
  const requests: WebhookServer['requests'] = [];
  let handler: NonNullable<WebhookServer['setHandler']> extends (h: infer H) => void ? H : never =
    (_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({ body: Buffer.concat(chunks).toString('utf8'), headers: req.headers });
      handler(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${address.port}/hook?secret=token123`,
    requests,
    setHandler(next) {
      handler = next;
    },
  };
}

function makeStackWithRealProviders(hook: WebhookServer): ServiceStack {
  const urlGuardOptions = { allowPrivateTargets: true };
  const logger = silentLogger();
  const stack = buildStack({
    providers: new Map<string, NotificationProvider>([
      ['webhook', new WebhookNotifier({ timeoutMs: 2_000, urlGuardOptions, dnsResolver: null })],
      ['mock', new MockNotifier(logger)],
    ]),
    webhookMaxAttempts: 3,
    retryBaseDelayMs: 1,
    urlGuardOptions,
  });
  (stack as { webhookHook: WebhookServer }).webhookHook = hook;
  return stack;
}

describe('NotificationService', () => {
  let hook: WebhookServer;

  beforeAll(async () => {
    hook = await startWebhookServer();
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      hook.server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('webhook success: posts the documented payload once and records the delivery', async () => {
    const stack = makeStackWithRealProviders(hook);
    try {
      const monitor = stack.createMonitor({ webhookUrl: hook.url });
      stack.setExtraction(() => Promise.resolve({ content: 'v1', durationMs: 1 }));
      const baseline = await stack.checkService.runCheck(monitor, 'schedule');
      stack.setExtraction(() => Promise.resolve({ content: 'v2', durationMs: 1 }));
      const outcome = await stack.checkService.runCheck(monitor, 'schedule');
      await outcome.notification;

      expect(outcome.run.status).toBe('changed');
      expect(hook.requests).toHaveLength(1);
      const payload = JSON.parse(hook.requests[0]?.body ?? '{}') as Record<string, unknown>;
      expect(payload).toMatchObject({
        event: 'content_changed',
        monitor_id: monitor.id,
        monitor_name: monitor.name,
        url: monitor.url,
      });
      expect(payload.diff).toBeTypeOf('object');
      expect(payload.previous_hash).toBeTypeOf('string');
      expect(payload.current_hash).toBeTypeOf('string');

      const deliveries = stack.repos.deliveries.listByMonitor(monitor.id, 10);
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({ provider: 'webhook', status: 'sent', attempts: 1 });
      // the database keeps the COMPLETE endpoint (path + query preserved) —
      // an origin-only record could not be audited or debugged
      expect(deliveries[0]?.target).toBe(hook.url);
      expect(deliveries[0]?.target).toContain('/hook?secret=token123');
      // no error detail on success, and nothing URL-related leaked
      expect(deliveries[0]?.lastError).toBeNull();
      void baseline;
    } finally {
      cleanupStack(stack);
    }
  });

  it('webhook 5xx is retried until success', async () => {
    const stack = makeStackWithRealProviders(hook);
    try {
      let failures = 0;
      hook.setHandler((_req, res) => {
        if (failures < 2) {
          failures += 1;
          res.statusCode = 500;
          res.end('boom');
        } else {
          res.statusCode = 200;
          res.end('ok');
        }
      });
      const monitor = stack.createMonitor({ webhookUrl: hook.url });
      stack.setExtraction(() => Promise.resolve({ content: 'x1', durationMs: 1 }));
      await stack.checkService.runCheck(monitor, 'schedule');
      stack.setExtraction(() => Promise.resolve({ content: 'x2', durationMs: 1 }));
      const outcome = await stack.checkService.runCheck(monitor, 'schedule');
      await outcome.notification;

      const delivery = stack.repos.deliveries.listByMonitor(monitor.id, 1)[0];
      expect(delivery).toMatchObject({ status: 'sent', attempts: 3 });
      hook.setHandler((_req, res) => {
        res.statusCode = 200;
        res.end('ok');
      });
    } finally {
      cleanupStack(stack);
    }
  });

  it('webhook 4xx fails immediately without retry', async () => {
    const stack = makeStackWithRealProviders(hook);
    try {
      hook.setHandler((_req, res) => {
        res.statusCode = 404;
        res.end('nope');
      });
      const monitor = stack.createMonitor({ webhookUrl: hook.url });
      stack.setExtraction(() => Promise.resolve({ content: 'y1', durationMs: 1 }));
      await stack.checkService.runCheck(monitor, 'schedule');
      stack.setExtraction(() => Promise.resolve({ content: 'y2', durationMs: 1 }));
      const outcome = await stack.checkService.runCheck(monitor, 'schedule');
      await outcome.notification;

      const delivery = stack.repos.deliveries.listByMonitor(monitor.id, 1)[0];
      expect(delivery).toMatchObject({ status: 'failed', attempts: 1 });
      expect(delivery?.lastError).toContain('404');
      hook.setHandler((_req, res) => {
        res.statusCode = 200;
        res.end('ok');
      });
    } finally {
      cleanupStack(stack);
    }
  });

  it('persistent 5xx exhausts the retry budget and marks the delivery failed', async () => {
    const stack = makeStackWithRealProviders(hook);
    try {
      hook.setHandler((_req, res) => {
        res.statusCode = 503;
        res.end('unavailable');
      });
      const monitor = stack.createMonitor({ webhookUrl: hook.url });
      stack.setExtraction(() => Promise.resolve({ content: 'z1', durationMs: 1 }));
      await stack.checkService.runCheck(monitor, 'schedule');
      stack.setExtraction(() => Promise.resolve({ content: 'z2', durationMs: 1 }));
      const outcome = await stack.checkService.runCheck(monitor, 'schedule');
      await outcome.notification;

      const delivery = stack.repos.deliveries.listByMonitor(monitor.id, 1)[0];
      expect(delivery).toMatchObject({ status: 'failed', attempts: 3 });
      // the check itself is unaffected
      expect(outcome.run.status).toBe('changed');
      hook.setHandler((_req, res) => {
        res.statusCode = 200;
        res.end('ok');
      });
    } finally {
      cleanupStack(stack);
    }
  });

  it('a failing webhook does not break the check result (provider isolation)', async () => {
    const stack = makeStackWithRealProviders(hook);
    try {
      hook.setHandler((_req, res) => {
        res.statusCode = 500;
        res.end('down');
      });
      const monitor = stack.createMonitor({ webhookUrl: hook.url });
      stack.setExtraction(() => Promise.resolve({ content: 'w1', durationMs: 1 }));
      await stack.checkService.runCheck(monitor, 'schedule');
      stack.setExtraction(() => Promise.resolve({ content: 'w2', durationMs: 1 }));
      const outcome = await stack.checkService.runCheck(monitor, 'schedule');
      await outcome.notification;

      expect(outcome.run.status).toBe('changed');
      expect(outcome.changeEvent).not.toBeNull();
      expect(stack.repos.checkRuns.listByMonitor(monitor.id, 10)).toHaveLength(2);
      hook.setHandler((_req, res) => {
        res.statusCode = 200;
        res.end('ok');
      });
    } finally {
      cleanupStack(stack);
    }
  });

  it('monitor without webhook and default none → no notification activity', async () => {
    const stack = buildStack({ defaultNotificationProvider: 'none' });
    try {
      const monitor = stack.createMonitor();
      stack.setExtraction(() => Promise.resolve({ content: 'a1', durationMs: 1 }));
      await stack.checkService.runCheck(monitor, 'schedule');
      stack.setExtraction(() => Promise.resolve({ content: 'a2', durationMs: 1 }));
      const outcome = await stack.checkService.runCheck(monitor, 'schedule');
      await outcome.notification;

      expect(outcome.run.status).toBe('changed');
      expect(stack.repos.deliveries.listByMonitor(monitor.id, 10)).toHaveLength(0);
      expect(stack.mockPayloads).toHaveLength(0);
    } finally {
      cleanupStack(stack);
    }
  });

  it('monitor without webhook and default mock → mock provider delivers', async () => {
    const stack = buildStack({ defaultNotificationProvider: 'mock' });
    try {
      const monitor = stack.createMonitor();
      stack.setExtraction(() => Promise.resolve({ content: 'b1', durationMs: 1 }));
      await stack.checkService.runCheck(monitor, 'schedule');
      stack.setExtraction(() => Promise.resolve({ content: 'b2', durationMs: 1 }));
      const outcome = await stack.checkService.runCheck(monitor, 'schedule');
      await outcome.notification;

      expect(stack.mockPayloads).toHaveLength(1);
      const delivery = stack.repos.deliveries.listByMonitor(monitor.id, 1)[0];
      expect(delivery).toMatchObject({ provider: 'mock', status: 'sent', target: 'mock' });
    } finally {
      cleanupStack(stack);
    }
  });

  it('sendTestNotification reports per-provider results for every configured target', async () => {
    const stack = makeStackWithRealProviders(hook);
    try {
      const monitor = stack.createMonitor({ webhookUrl: hook.url });
      const ok = await stack.notificationService.sendTestNotification(monitor);
      expect(ok).toHaveLength(1);
      expect(ok[0]).toMatchObject({ provider: 'webhook', delivered: true, error: null });

      hook.setHandler((_req, res) => {
        res.statusCode = 401;
        res.end('denied');
      });
      const failing = await stack.notificationService.sendTestNotification(monitor);
      expect(failing[0]).toMatchObject({ provider: 'webhook', delivered: false });
      expect(failing[0]?.error).toContain('401');
      hook.setHandler((_req, res) => {
        res.statusCode = 200;
        res.end('ok');
      });

      const noWebhook = stack.createMonitor();
      const viaMock = await stack.notificationService.sendTestNotification(noWebhook);
      expect(viaMock[0]).toMatchObject({ provider: 'mock', delivered: true });
    } finally {
      cleanupStack(stack);
    }
  });

  it('a monitor with both webhook and email receives deliveries on every route', async () => {
    const emailProvider: NotificationProvider = {
      name: 'email',
      send: async () => undefined,
    };
    const stack = buildStack({
      providers: new Map<string, NotificationProvider>([
        ['webhook', new WebhookNotifier({ timeoutMs: 2_000, urlGuardOptions: { allowPrivateTargets: true }, dnsResolver: null })],
        ['email', emailProvider],
      ]),
      defaultNotificationProvider: 'none',
    });
    try {
      const monitor = stack.createMonitor({
        webhookUrl: hook.url,
        notifyEmail: 'owner@example.com',
      });
      stack.setExtraction(() => Promise.resolve({ content: 'e1', durationMs: 1 }));
      await stack.checkService.runCheck(monitor, 'schedule');
      stack.setExtraction(() => Promise.resolve({ content: 'e2', durationMs: 1 }));
      const outcome = await stack.checkService.runCheck(monitor, 'schedule');
      await outcome.notification;

      const deliveries = stack.repos.deliveries.listByMonitor(monitor.id, 10);
      expect(deliveries.map((delivery) => delivery.provider).sort()).toEqual([
        'email',
        'webhook',
      ]);
      const emailDelivery = deliveries.find((delivery) => delivery.provider === 'email');
      expect(emailDelivery?.target).toBe('owner@example.com');
      expect(emailDelivery?.status).toBe('sent');
    } finally {
      cleanupStack(stack);
    }
  });

  it('an email target without a registered email provider logs and skips (no crash)', async () => {
    const stack = buildStack({ defaultNotificationProvider: 'none' });
    try {
      const monitor = stack.createMonitor({ notifyEmail: 'owner@example.com' });
      stack.setExtraction(() => Promise.resolve({ content: 'f1', durationMs: 1 }));
      await stack.checkService.runCheck(monitor, 'schedule');
      stack.setExtraction(() => Promise.resolve({ content: 'f2', durationMs: 1 }));
      const outcome = await stack.checkService.runCheck(monitor, 'schedule');
      await outcome.notification;
      expect(outcome.run.status).toBe('changed');
      expect(stack.repos.deliveries.listByMonitor(monitor.id, 10)).toHaveLength(0);
    } finally {
      cleanupStack(stack);
    }
  });

  it('refuses to deliver to a private-network webhook target', async () => {
    const strictGuard = { allowPrivateTargets: false };
    const stack = buildStack({
      urlGuardOptions: strictGuard,
      webhookMaxAttempts: 2,
      retryBaseDelayMs: 1,
      providers: new Map<string, NotificationProvider>([
        ['webhook', new WebhookNotifier({ timeoutMs: 2_000, urlGuardOptions: strictGuard, dnsResolver: null })],
        ['mock', new MockNotifier(silentLogger())],
      ]),
    });
    try {
      const monitor = stack.createMonitor({ webhookUrl: 'http://127.0.0.1:9999/hook' });
      const results = await stack.notificationService.sendTestNotification(monitor);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ provider: 'webhook', delivered: false });
      expect(results[0]?.error).toContain('not allowed');
    } finally {
      cleanupStack(stack);
    }
  });
});
