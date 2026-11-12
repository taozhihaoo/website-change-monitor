import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebhookNotifier } from '../../src/notifications/webhook-notifier.js';
import type { NotificationPayload } from '../../src/notifications/provider.js';
import type { HostResolver } from '../../src/utils/dns-guard.js';

const STRICT = { allowPrivateTargets: false };
const PERMISSIVE = { allowPrivateTargets: true };

const payload: NotificationPayload = {
  event: 'content_changed',
  monitor_id: 'm1',
  monitor_name: 'Price watcher',
  url: 'https://example.com/product',
  detected_at: '2026-09-30T10:00:00.000Z',
  previous_hash: 'aaa',
  current_hash: 'bbb',
  diff: { added: 1, removed: 1, changes: [] },
};

function httpResponse(status: number, location?: string): Response {
  return new Response(null, {
    status,
    headers: location === undefined ? {} : { location },
  });
}

const publicResolver: HostResolver = {
  resolve4: async (host: string) => (host === 'internal.example.com' ? ['10.0.0.5'] : ['93.184.216.34']),
  resolve6: async () => [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WebhookNotifier redirect safety', () => {
  it('never follows a redirect into a private IP literal', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(httpResponse(302, 'http://169.254.169.254/latest/meta-data/'));
    vi.stubGlobal('fetch', fetchMock);
    const notifier = new WebhookNotifier({
      timeoutMs: 1_000,
      urlGuardOptions: STRICT,
      dnsResolver: null,
    });

    await expect(notifier.send(payload, 'https://hooks.example.com/hook')).rejects.toMatchObject({
      message: expect.stringContaining('not allowed'),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-runs the DNS guard on every redirect hop', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(httpResponse(307, 'https://internal.example.com/hook'));
    vi.stubGlobal('fetch', fetchMock);
    const notifier = new WebhookNotifier({
      timeoutMs: 1_000,
      urlGuardOptions: STRICT,
      dnsResolver: publicResolver,
    });

    // The first hop resolves to a public IP and passes; the redirect target
    // resolves to 10.0.0.5 and must be refused before a second request.
    await expect(notifier.send(payload, 'https://hooks.example.com/hook')).rejects.toMatchObject({
      message: expect.stringContaining('not allowed'),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks fetch not to follow redirects and posts the documented payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(httpResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    const notifier = new WebhookNotifier({
      timeoutMs: 1_000,
      urlGuardOptions: PERMISSIVE,
      dnsResolver: null,
    });

    await notifier.send(payload, 'http://127.0.0.1:8933/hook?token=secret');
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(options.redirect).toBe('manual');
    expect(options.method).toBe('POST');
    expect(JSON.parse(String(options.body))).toMatchObject({ event: 'content_changed' });
  });

  it('follows a legitimate redirect with standard POST → GET semantics', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(httpResponse(302, 'http://127.0.0.1:8933/final'))
      .mockResolvedValueOnce(httpResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    const notifier = new WebhookNotifier({
      timeoutMs: 1_000,
      urlGuardOptions: PERMISSIVE,
      dnsResolver: null,
    });

    await notifier.send(payload, 'http://127.0.0.1:8933/start');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://127.0.0.1:8933/final');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe('GET');
  });

  it('caps redirect chains', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(httpResponse(307, `http://127.0.0.1:8933/next?from=${encodeURIComponent(url)}`)),
      );
    vi.stubGlobal('fetch', fetchMock);
    const notifier = new WebhookNotifier({
      timeoutMs: 1_000,
      urlGuardOptions: PERMISSIVE,
      dnsResolver: null,
    });

    await expect(notifier.send(payload, 'http://127.0.0.1:8933/start')).rejects.toMatchObject({
      message: expect.stringContaining('too many'),
    });
    expect(fetchMock).toHaveBeenCalledTimes(4); // initial + 3 hops
  });
});
