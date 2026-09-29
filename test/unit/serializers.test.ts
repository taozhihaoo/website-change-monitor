import { describe, expect, it } from 'vitest';
import { serializeDelivery } from '../../src/api/serializers.js';
import type { NotificationDelivery } from '../../src/domain/types.js';

function delivery(target: string): NotificationDelivery {
  const now = '2026-09-30T10:00:00.000Z';
  return {
    id: 'd1',
    changeEventId: 'e1',
    monitorId: 'm1',
    provider: 'webhook',
    target,
    status: 'sent',
    attempts: 1,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('serializeDelivery (webhook target masking)', () => {
  it('masks path and query in API responses', () => {
    const serialized = serializeDelivery(
      delivery('https://hooks.example.com/webhooks/abc123?token=secret'),
    );
    expect(serialized.target).toBe('https://hooks.example.com/…');
    expect(JSON.stringify(serialized)).not.toContain('abc123');
    expect(JSON.stringify(serialized)).not.toContain('secret');
  });

  it('keeps bare-origin targets readable', () => {
    const serialized = serializeDelivery(delivery('https://hooks.example.com'));
    expect(serialized.target).toBe('https://hooks.example.com');
  });

  it('passes mock targets through unchanged', () => {
    expect(serializeDelivery(delivery('mock')).target).toBe('mock');
  });

  it('marks unparsable targets instead of throwing', () => {
    expect(serializeDelivery(delivery('not a url')).target).toBe('unparsed');
  });
});
