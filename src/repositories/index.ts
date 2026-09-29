import type { Db } from '../db/database.js';
import { ChangeEventRepository } from './change-event-repository.js';
import { CheckRunRepository } from './check-run-repository.js';
import { MonitorRepository } from './monitor-repository.js';
import { NotificationDeliveryRepository } from './notification-delivery-repository.js';
import { SnapshotRepository } from './snapshot-repository.js';

export interface Repositories {
  monitors: MonitorRepository;
  snapshots: SnapshotRepository;
  changeEvents: ChangeEventRepository;
  checkRuns: CheckRunRepository;
  deliveries: NotificationDeliveryRepository;
}

export function createRepositories(db: Db): Repositories {
  return {
    monitors: new MonitorRepository(db),
    snapshots: new SnapshotRepository(db),
    changeEvents: new ChangeEventRepository(db),
    checkRuns: new CheckRunRepository(db),
    deliveries: new NotificationDeliveryRepository(db),
  };
}
