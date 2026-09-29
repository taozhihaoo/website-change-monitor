import { describe, expect, it } from 'vitest';
import {
  SmtpEmailNotifier,
  buildChangeEmailText,
  type MailTransport,
} from '../../src/notifications/email-notifier.js';
import type { NotificationPayload } from '../../src/notifications/provider.js';
import { NotificationError } from '../../src/notifications/provider.js';

const PAYLOAD: NotificationPayload = {
  event: 'content_changed',
  monitor_id: 'm-1',
  monitor_name: 'Acme product price',
  url: 'https://example.com/product',
  detected_at: '2026-09-30T10:00:00.000Z',
  previous_hash: 'aaa',
  current_hash: 'bbb',
  diff: {
    added: 1,
    removed: 1,
    changes: [
      { type: 'removed', value: '$99', count: 1 },
      { type: 'added', value: '$89', count: 1 },
    ],
  },
};

function capturingTransport(): { transport: MailTransport; mails: Array<Record<string, unknown>> } {
  const mails: Array<Record<string, unknown>> = [];
  return {
    mails,
    transport: {
      sendMail: async (mail) => {
        mails.push(mail as Record<string, unknown>);
        return { messageId: 'test-1' };
      },
    },
  };
}

describe('SmtpEmailNotifier (injected transport, no real SMTP)', () => {
  it('sends a compact change email to the configured recipient', async () => {
    const { transport, mails } = capturingTransport();
    const notifier = new SmtpEmailNotifier({ from: 'wcm@example.com', transport });

    await notifier.send(PAYLOAD, 'owner@example.com');

    expect(mails).toHaveLength(1);
    const mail = mails[0] as { from: string; to: string; subject: string; text: string };
    expect(mail.from).toBe('wcm@example.com');
    expect(mail.to).toBe('owner@example.com');
    expect(mail.subject).toContain('[changed]');
    expect(mail.subject).toContain('Acme product price');
    // required content, no full snapshot
    expect(mail.text).toContain('https://example.com/product');
    expect(mail.text).toContain('aaa');
    expect(mail.text).toContain('bbb');
    expect(mail.text).toContain('+1 line(s) added, -1 line(s) removed');
    expect(mail.text).toContain('$99');
    expect(mail.text).toContain('$89');
  });

  it('rejects invalid recipients without retry', async () => {
    const { transport, mails } = capturingTransport();
    const notifier = new SmtpEmailNotifier({ from: 'wcm@example.com', transport });
    await expect(notifier.send(PAYLOAD, 'not-an-email')).rejects.toMatchObject({
      retryable: false,
    });
    expect(mails).toHaveLength(0);
  });

  it('marks auth failures as non-retryable', async () => {
    const transport: MailTransport = {
      sendMail: async () => {
        const err = new Error('Invalid login') as Error & { code?: string };
        err.code = 'EAUTH';
        throw err;
      },
    };
    const notifier = new SmtpEmailNotifier({ from: 'wcm@example.com', transport });
    const err = await notifier.send(PAYLOAD, 'owner@example.com').then(
      () => null,
      (error: unknown) => error,
    );
    expect(err).toBeInstanceOf(NotificationError);
    expect((err as NotificationError).retryable).toBe(false);
    expect((err as NotificationError).message).toContain('EAUTH');
    // the SMTP credentials or internals are not part of the safe message
    expect((err as NotificationError).message).not.toContain('Invalid login');
  });

  it('marks transport/network failures as retryable', async () => {
    const transport: MailTransport = {
      sendMail: async () => {
        const err = new Error('Connection closed') as Error & { code?: string };
        err.code = 'ECONNECTION';
        throw err;
      },
    };
    const notifier = new SmtpEmailNotifier({ from: 'wcm@example.com', transport });
    await expect(notifier.send(PAYLOAD, 'owner@example.com')).rejects.toMatchObject({
      retryable: true,
    });
  });

  it('keeps huge diffs bounded (excerpt + omission note, no full snapshot)', () => {
    const manyBlocks = Array.from({ length: 30 }, (_unused, index) => ({
      type: 'added' as const,
      value: `line ${index} ${'x'.repeat(600)}`,
      count: 1,
    }));
    const text = buildChangeEmailText({
      ...PAYLOAD,
      diff: { added: 30, removed: 0, changes: manyBlocks },
    });
    expect(text).toContain('more change block(s) omitted');
    expect(text).not.toContain('line 20');
    expect(text.length).toBeLessThan(10_000);
  });
});
