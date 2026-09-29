import type { NotificationPayload, NotificationProvider } from './provider.js';
import { NotificationError } from './provider.js';

/**
 * Minimal transport abstraction so tests can inject a fake and never touch
 * a real SMTP server. The production transport is nodemailer's.
 */
export interface MailTransport {
  sendMail(mail: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<unknown>;
}

export interface SmtpEmailNotifierOptions {
  from: string;
  transport: MailTransport;
}

const MAX_DIFF_BLOCKS = 10;
const MAX_BLOCK_CHARS = 400;

function truncate(value: string, maxChars: number): string {
  const normalized = value.replace(/\n+$/, '');
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars)}…`;
}

/**
 * Plain-text change email. Deliberately compact: monitor identity, hashes and
 * a bounded diff summary — never the full page content.
 */
export function buildChangeEmailText(payload: NotificationPayload): string {
  const lines: string[] = [];
  if (payload.event === 'test') {
    lines.push('This is a test notification from Website Change Monitor.');
    lines.push('');
  }
  lines.push(`Monitor : ${payload.monitor_name}`);
  lines.push(`URL     : ${payload.url}`);
  lines.push(`Detected: ${payload.detected_at}`);
  lines.push(`Previous hash: ${payload.previous_hash}`);
  lines.push(`Current hash : ${payload.current_hash}`);
  lines.push('');
  lines.push(
    `Diff summary: +${payload.diff.added} line(s) added, -${payload.diff.removed} line(s) removed`,
  );

  if (payload.diff.changes.length > 0) {
    lines.push('');
    lines.push('Changed lines (excerpt):');
    for (const change of payload.diff.changes.slice(0, MAX_DIFF_BLOCKS)) {
      const marker = change.type === 'added' ? '+' : '-';
      lines.push(`${marker} ${truncate(change.value, MAX_BLOCK_CHARS).replace(/\n/g, '\n  ')}`);
    }
    if (payload.diff.changes.length > MAX_DIFF_BLOCKS) {
      lines.push(`… ${payload.diff.changes.length - MAX_DIFF_BLOCKS} more change block(s) omitted`);
    }
  }

  lines.push('');
  lines.push('You are receiving this because the monitor targets content you are');
  lines.push('authorized to access. Respect the target site robots.txt and terms.');
  return lines.join('\n');
}

/**
 * SMTP email notification provider. Auth failures are not retried; transport
 * and network failures are (retry policy lives in NotificationService).
 */
export class SmtpEmailNotifier implements NotificationProvider {
  readonly name = 'email';

  constructor(private readonly options: SmtpEmailNotifierOptions) {}

  async send(payload: NotificationPayload, recipient: string): Promise<void> {
    if (recipient.trim().length === 0 || !recipient.includes('@')) {
      throw new NotificationError('Email recipient is invalid.', false);
    }

    const subject =
      payload.event === 'test'
        ? `[test] ${payload.monitor_name} — Website Change Monitor`
        : `[changed] ${payload.monitor_name} — Website Change Monitor`;

    try {
      await this.options.transport.sendMail({
        from: this.options.from,
        to: recipient,
        subject,
        text: buildChangeEmailText(payload),
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      const nonRetryable = code === 'EAUTH' || code === 'EINVAL';
      throw new NotificationError(
        `SMTP send failed${code ? ` (${code})` : ''}.`,
        !nonRetryable,
        err,
      );
    }
  }
}
