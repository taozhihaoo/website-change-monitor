import type { Db } from '../db/database.js';
import type { DeliveryStatus, NotificationDelivery } from '../domain/types.js';
import { withDb } from './with-db.js';

export interface NewDelivery {
  id: string;
  changeEventId: string;
  monitorId: string;
  provider: string;
  target: string;
  createdAt: string;
}

export interface DeliveryStatusUpdate {
  status: DeliveryStatus;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
}

interface DeliveryRow {
  id: string;
  change_event_id: string;
  monitor_id: string;
  provider: string;
  target: string;
  status: DeliveryStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function rowToDelivery(row: DeliveryRow): NotificationDelivery {
  return {
    id: row.id,
    changeEventId: row.change_event_id,
    monitorId: row.monitor_id,
    provider: row.provider,
    target: row.target,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class NotificationDeliveryRepository {
  constructor(private readonly db: Db) {}

  create(delivery: NewDelivery): NotificationDelivery {
    return withDb('delivery.create', () => {
      this.db
        .prepare(
          `
          INSERT INTO notification_deliveries
            (id, change_event_id, monitor_id, provider, target, status, attempts, last_error, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?)
        `,
        )
        .run(
          delivery.id,
          delivery.changeEventId,
          delivery.monitorId,
          delivery.provider,
          delivery.target,
          delivery.createdAt,
          delivery.createdAt,
        );
      return {
        id: delivery.id,
        changeEventId: delivery.changeEventId,
        monitorId: delivery.monitorId,
        provider: delivery.provider,
        target: delivery.target,
        status: 'pending',
        attempts: 0,
        lastError: null,
        createdAt: delivery.createdAt,
        updatedAt: delivery.createdAt,
      };
    });
  }

  updateStatus(id: string, update: DeliveryStatusUpdate): void {
    withDb('delivery.updateStatus', () => {
      this.db
        .prepare(
          'UPDATE notification_deliveries SET status = ?, attempts = ?, last_error = ?, updated_at = ? WHERE id = ?',
        )
        .run(update.status, update.attempts, update.lastError, update.updatedAt, id);
    });
  }

  listByMonitor(monitorId: string, limit: number, offset = 0): NotificationDelivery[] {
    return withDb('delivery.listByMonitor', () => {
      const rows = this.db
        .prepare(
          `
          SELECT * FROM notification_deliveries WHERE monitor_id = ?
          ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?
        `,
        )
        .all(monitorId, limit, offset) as DeliveryRow[];
      return rows.map(rowToDelivery);
    });
  }

  listByChangeEvent(changeEventId: string): NotificationDelivery[] {
    return withDb('delivery.listByChangeEvent', () => {
      const rows = this.db
        .prepare('SELECT * FROM notification_deliveries WHERE change_event_id = ? ORDER BY created_at ASC')
        .all(changeEventId) as DeliveryRow[];
      return rows.map(rowToDelivery);
    });
  }
}
