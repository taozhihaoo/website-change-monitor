import type {
  Monitor,
  MonitorWithSummary,
  SelectorType,
} from '../domain/types.js';
import { AppError } from '../domain/errors.js';
import type { MonitorPatch, MonitorRepository } from '../repositories/monitor-repository.js';
import type { Logger } from '../utils/logger.js';
import { newId } from '../utils/id.js';
import type { Clock } from '../utils/clock.js';
import {
  assertSafePublicUrl,
  type UrlGuardOptions,
} from '../utils/url-guard.js';
import {
  assertPublicDnsResolution,
  type HostResolver,
} from '../utils/dns-guard.js';
import type { ExtractionService } from './extraction-service.js';
import { sha256Hex } from '../utils/hash.js';
import { normalizeContent } from '../utils/normalize.js';

export interface CreateMonitorInput {
  name: string;
  url: string;
  selector: string;
  selectorType: SelectorType;
  checkIntervalSeconds: number;
  enabled: boolean;
  webhookUrl: string | null;
}

export type UpdateMonitorInput = MonitorPatch;

export interface TestExtractionInput {
  url: string;
  selector: string;
  selectorType: SelectorType;
}

export interface TestExtractionOutput {
  /** Normalized content — exactly what would be monitored and hashed. */
  content: string;
  hash: string;
  durationMs: number;
}

/**
 * CRUD and validation orchestration for monitors. Route handlers stay thin;
 * all business rules (URL guard, defaults, existence checks) live here.
 */
export class MonitorService {
  constructor(
    private readonly deps: {
      monitorRepo: MonitorRepository;
      extraction: ExtractionService;
      urlGuardOptions: UrlGuardOptions;
      dnsResolver: HostResolver | null;
      clock: Clock;
      logger: Logger;
      defaultTimeoutMs: number;
      defaultSettleMs: number;
    },
  ) {}

  /**
   * IP-layer guard plus (when enabled) DNS resolution guard for a monitor
   * URL. Shared by create and update.
   */
  private async assertSafeTarget(url: string): Promise<void> {
    const parsed = assertSafePublicUrl(url, this.deps.urlGuardOptions);
    if (!this.deps.urlGuardOptions.allowPrivateTargets && this.deps.dnsResolver !== null) {
      await assertPublicDnsResolution(parsed.hostname, { resolver: this.deps.dnsResolver });
    }
  }

  async create(input: CreateMonitorInput): Promise<Monitor> {
    await this.assertSafeTarget(input.url);
    const now = this.deps.clock.now().toISOString();
    const monitor = this.deps.monitorRepo.create({
      id: newId(),
      name: input.name,
      url: input.url,
      selector: input.selector,
      selectorType: input.selectorType,
      checkIntervalSeconds: input.checkIntervalSeconds,
      enabled: input.enabled,
      webhookUrl: input.webhookUrl,
      createdAt: now,
      updatedAt: now,
    });
    this.deps.logger.info({ monitorId: monitor.id, name: monitor.name }, 'monitor created');
    return monitor;
  }

  get(id: string): Monitor {
    const monitor = this.deps.monitorRepo.getById(id);
    if (monitor === null) {
      throw new AppError('MONITOR_NOT_FOUND', 'Monitor not found.');
    }
    return monitor;
  }

  getWithSummary(id: string): MonitorWithSummary {
    const monitor = this.deps.monitorRepo.getByIdWithSummary(id);
    if (monitor === null) {
      throw new AppError('MONITOR_NOT_FOUND', 'Monitor not found.');
    }
    return monitor;
  }

  list(): MonitorWithSummary[] {
    return this.deps.monitorRepo.listWithSummary();
  }

  async update(id: string, patch: UpdateMonitorInput): Promise<Monitor> {
    this.get(id);
    if (patch.url !== undefined) {
      await this.assertSafeTarget(patch.url);
    }
    const monitor = this.deps.monitorRepo.update(id, patch, this.deps.clock.now().toISOString());
    if (monitor === null) {
      throw new AppError('MONITOR_NOT_FOUND', 'Monitor not found.');
    }
    this.deps.logger.info({ monitorId: monitor.id }, 'monitor updated');
    return monitor;
  }

  delete(id: string): void {
    const deleted = this.deps.monitorRepo.delete(id);
    if (!deleted) {
      throw new AppError('MONITOR_NOT_FOUND', 'Monitor not found.');
    }
    this.deps.logger.info({ monitorId: id }, 'monitor deleted');
  }

  /**
   * Runs one extraction WITHOUT persisting a snapshot or change event —
   * powers the "test extraction" preview in the UI so users can validate a
   * selector before saving the monitor.
   */
  async testExtraction(input: TestExtractionInput): Promise<TestExtractionOutput> {
    const result = await this.deps.extraction.extract({
      url: input.url,
      selector: input.selector,
      selectorType: input.selectorType,
      timeoutMs: this.deps.defaultTimeoutMs,
      settleMs: this.deps.defaultSettleMs,
    });
    const content = normalizeContent(result.content);
    if (content.length === 0) {
      throw new AppError(
        'EMPTY_EXTRACTION',
        'The target matched but contained no text content.',
      );
    }
    return { content, hash: sha256Hex(content), durationMs: result.durationMs };
  }
}
