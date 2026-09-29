import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../../src/db/database.js';
import { migrate } from '../../src/db/migrate.js';
import { createRepositories, type Repositories } from '../../src/repositories/index.js';
import type { NewMonitor } from '../../src/repositories/monitor-repository.js';
import type { NewSnapshot } from '../../src/repositories/snapshot-repository.js';
import type { NewChangeEvent } from '../../src/repositories/change-event-repository.js';
import type { NewCheckRun } from '../../src/repositories/check-run-repository.js';

const NOW = new Date('2026-09-30T10:00:00.000Z').toISOString();

function makeMonitor(overrides: Partial<NewMonitor> = {}): NewMonitor {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Example product page',
    url: 'https://example.com/product',
    selector: '.product-price',
    selectorType: 'css',
    checkIntervalSeconds: 300,
    enabled: true,
    webhookUrl: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('repositories (SQLite CRUD)', () => {
  let db: Db;
  let repos: Repositories;

  beforeEach(() => {
    db = openDatabase(':memory:');
    migrate(db);
    repos = createRepositories(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('monitorRepository', () => {
    it('creates, reads, lists and deletes monitors', () => {
      const created = repos.monitors.create(makeMonitor());
      expect(created.id).toBe(makeMonitor().id);
      expect(repos.monitors.getById(created.id)).toMatchObject({
        name: 'Example product page',
        selectorType: 'css',
        enabled: true,
        webhookUrl: null,
      });
      expect(repos.monitors.list()).toHaveLength(1);
      expect(repos.monitors.listEnabled()).toHaveLength(1);

      expect(repos.monitors.delete(created.id)).toBe(true);
      expect(repos.monitors.getById(created.id)).toBeNull();
      expect(repos.monitors.delete(created.id)).toBe(false);
    });

    it('patches only the provided fields and updates updated_at', () => {
      const monitor = repos.monitors.create(makeMonitor());
      const updated = repos.monitors.update(monitor.id, {
        name: 'Renamed',
        enabled: false,
        webhookUrl: 'https://hooks.example.com/abc',
      }, '2026-09-30T11:00:00.000Z');
      expect(updated).toMatchObject({
        name: 'Renamed',
        enabled: false,
        webhookUrl: 'https://hooks.example.com/abc',
        url: 'https://example.com/product',
        updatedAt: '2026-09-30T11:00:00.000Z',
      });
    });

    it('returns null when updating a missing monitor', () => {
      expect(
        repos.monitors.update('22222222-2222-4222-8222-222222222222', { name: 'x' }, NOW),
      ).toBeNull();
    });

    it('exposes summary fields (last check / last change / next check)', () => {
      const monitor = repos.monitors.create(makeMonitor());
      const empty = repos.monitors.getByIdWithSummary(monitor.id);
      expect(empty?.lastCheckAt).toBeNull();
      expect(empty?.nextCheckAt).toBeNull();

      repos.checkRuns.insert({
        id: 'r1',
        monitorId: monitor.id,
        triggeredBy: 'schedule',
        status: 'changed',
        errorCode: null,
        errorMessage: null,
        durationMs: 100,
        startedAt: '2026-09-30T10:00:00.000Z',
        finishedAt: '2026-09-30T10:00:01.000Z',
      });
      repos.changeEvents.insert({
        id: 'e1',
        monitorId: monitor.id,
        previousHash: 'a',
        currentHash: 'b',
        previousContent: 'x',
        currentContent: 'y',
        diff: { added: 1, removed: 1, changes: [] },
        detectedAt: '2026-09-30T10:00:01.000Z',
      });

      const summary = repos.monitors.getByIdWithSummary(monitor.id);
      expect(summary?.lastCheckAt).toBe('2026-09-30T10:00:00.000Z');
      expect(summary?.lastCheckStatus).toBe('changed');
      expect(summary?.lastChangeAt).toBe('2026-09-30T10:00:01.000Z');
      expect(summary?.nextCheckAt).toBe('2026-09-30T10:05:00.000Z');

      // disabled monitors have no next check
      repos.monitors.update(monitor.id, { enabled: false }, NOW);
      const disabled = repos.monitors.getByIdWithSummary(monitor.id);
      expect(disabled?.nextCheckAt).toBeNull();
    });
  });

  describe('snapshotRepository', () => {
    it('stores snapshots and returns the latest one', () => {
      const monitor = repos.monitors.create(makeMonitor());
      const snapshot = (content: string, hash: string, at: string): NewSnapshot => ({
        id: `snap-${hash}`,
        monitorId: monitor.id,
        contentHash: hash,
        content,
        checkedAt: at,
      });
      repos.snapshots.insert(snapshot('v1', 'hash-v1', '2026-09-30T10:00:00.000Z'));
      repos.snapshots.insert(snapshot('v2', 'hash-v2', '2026-09-30T10:05:00.000Z'));

      const latest = repos.snapshots.latestByMonitor(monitor.id);
      expect(latest?.contentHash).toBe('hash-v2');
      expect(repos.snapshots.countByMonitor(monitor.id)).toBe(2);
      expect(repos.snapshots.listByMonitor(monitor.id, 10)).toHaveLength(2);
    });
  });

  describe('changeEventRepository', () => {
    it('rejects duplicate (monitor_id, current_hash) with null — the idempotency guarantee', () => {
      const monitor = repos.monitors.create(makeMonitor());
      const event = (id: string, currentHash: string): NewChangeEvent => ({
        id,
        monitorId: monitor.id,
        previousHash: 'prev',
        currentHash,
        previousContent: 'old',
        currentContent: 'new',
        diff: { added: 1, removed: 0, changes: [] },
        detectedAt: NOW,
      });

      expect(repos.changeEvents.insert(event('e1', 'hash-B'))?.id).toBe('e1');
      // same content state again → null, no second event
      expect(repos.changeEvents.insert(event('e2', 'hash-B'))).toBeNull();
      // different state → allowed
      expect(repos.changeEvents.insert(event('e3', 'hash-C'))?.id).toBe('e3');

      expect(repos.changeEvents.countByMonitor(monitor.id)).toBe(2);
      expect(repos.changeEvents.countAll()).toBe(2);
      expect(repos.changeEvents.listByMonitor(monitor.id, 10)).toHaveLength(2);
    });

    it('round-trips the diff payload', () => {
      const monitor = repos.monitors.create(makeMonitor());
      repos.changeEvents.insert({
        id: 'e1',
        monitorId: monitor.id,
        previousHash: 'a',
        currentHash: 'b',
        previousContent: 'price $99',
        currentContent: 'price $89',
        diff: { added: 1, removed: 1, changes: [{ type: 'added', value: 'price $89', count: 1 }] },
        detectedAt: NOW,
      });
      const loaded = repos.changeEvents.listByMonitor(monitor.id, 1)[0];
      expect(loaded?.diff).toEqual({
        added: 1,
        removed: 1,
        changes: [{ type: 'added', value: 'price $89', count: 1 }],
      });
    });
  });

  describe('checkRunRepository', () => {
    it('stores and lists check runs newest first', () => {
      const monitor = repos.monitors.create(makeMonitor());
      const run = (id: string, startedAt: string, status: NewCheckRun['status']): NewCheckRun => ({
        id,
        monitorId: monitor.id,
        triggeredBy: 'schedule',
        status,
        errorCode: status === 'error' ? 'TIMEOUT' : null,
        errorMessage: status === 'error' ? 'timed out' : null,
        durationMs: 1200,
        startedAt,
        finishedAt: startedAt,
      });
      repos.checkRuns.insert(run('r1', '2026-09-30T10:00:00.000Z', 'baseline'));
      repos.checkRuns.insert(run('r2', '2026-09-30T10:05:00.000Z', 'unchanged'));
      repos.checkRuns.insert(run('r3', '2026-09-30T10:10:00.000Z', 'error'));

      const runs = repos.checkRuns.listByMonitor(monitor.id, 10);
      expect(runs.map((r) => r.id)).toEqual(['r3', 'r2', 'r1']);
      expect(runs[0]?.errorCode).toBe('TIMEOUT');

      expect(repos.checkRuns.latestByMonitor(monitor.id)?.id).toBe('r3');
      expect(repos.checkRuns.latestStartedAt(monitor.id)).toBe('2026-09-30T10:10:00.000Z');
    });

    it('computes dashboard stats', () => {
      const m1 = repos.monitors.create(makeMonitor());
      const m2 = repos.monitors.create(
        makeMonitor({ id: '22222222-2222-4222-8222-222222222222', enabled: false }),
      );
      repos.checkRuns.insert({
        id: 'r1',
        monitorId: m1.id,
        triggeredBy: 'schedule',
        status: 'error',
        errorCode: 'TIMEOUT',
        errorMessage: null,
        durationMs: 1,
        startedAt: '2026-09-30T10:00:00.000Z',
        finishedAt: '2026-09-30T10:00:00.000Z',
      });
      repos.checkRuns.insert({
        id: 'r2',
        monitorId: m2.id,
        triggeredBy: 'manual',
        status: 'baseline',
        errorCode: null,
        errorMessage: null,
        durationMs: 1,
        startedAt: '2026-09-30T10:01:00.000Z',
        finishedAt: '2026-09-30T10:01:00.000Z',
      });
      repos.changeEvents.insert({
        id: 'e1',
        monitorId: m1.id,
        previousHash: 'a',
        currentHash: 'b',
        previousContent: 'x',
        currentContent: 'y',
        diff: { added: 0, removed: 0, changes: [] },
        detectedAt: NOW,
      });

      const stats = repos.checkRuns.dashboardStats();
      expect(stats).toEqual({
        totalMonitors: 2,
        activeMonitors: 1,
        failedMonitors: 1, // m1's latest run is an error; m2's is not
        changesDetected: 1,
        lastCheckAt: '2026-09-30T10:01:00.000Z',
      });
    });
  });

  describe('notificationDeliveryRepository', () => {
    it('creates deliveries and updates their status', () => {
      const monitor = repos.monitors.create(makeMonitor());
      repos.changeEvents.insert({
        id: 'e1',
        monitorId: monitor.id,
        previousHash: 'a',
        currentHash: 'b',
        previousContent: 'x',
        currentContent: 'y',
        diff: { added: 0, removed: 0, changes: [] },
        detectedAt: NOW,
      });

      const delivery = repos.deliveries.create({
        id: 'd1',
        changeEventId: 'e1',
        monitorId: monitor.id,
        provider: 'webhook',
        target: 'https://hooks.example.com',
        createdAt: NOW,
      });
      expect(delivery.status).toBe('pending');

      repos.deliveries.updateStatus('d1', {
        status: 'sent',
        attempts: 2,
        lastError: null,
        updatedAt: NOW,
      });
      const loaded = repos.deliveries.listByChangeEvent('e1')[0];
      expect(loaded).toMatchObject({ status: 'sent', attempts: 2, lastError: null });
    });
  });
});
