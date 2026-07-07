import pg from 'pg';

import { resolveOpenPathDbEventsChannel } from '../../src/db/openpath.js';
import { resolveDatabaseUrl } from '../../src/lib/database-url.js';

// Dedicated LISTEN connection for observing the pg_notify side effects the
// publish/notify helpers emit on the openpath_events channel. Notifications
// are delivered asynchronously after COMMIT, so consumers poll via
// waitForCount instead of asserting immediately.

export interface CapturedOpenPathEvent {
  type: string;
  groupId?: string;
  classroomId?: string;
  origin?: string;
}

export interface OpenPathNotifyCapture {
  events: CapturedOpenPathEvent[];
  waitForCount(count: number, timeoutMs?: number): Promise<CapturedOpenPathEvent[]>;
  stop(): Promise<void>;
}

export async function startOpenPathNotifyCapture(): Promise<OpenPathNotifyCapture> {
  const client = new pg.Client({ connectionString: resolveDatabaseUrl(process.env) });
  await client.connect();

  const events: CapturedOpenPathEvent[] = [];
  client.on('notification', (message) => {
    if (message.payload) {
      events.push(JSON.parse(message.payload) as CapturedOpenPathEvent);
    }
  });
  // Channel name is regex-validated ([a-zA-Z0-9_]+) by resolveOpenPathDbEventsChannel,
  // so it is safe to interpolate as an identifier.
  await client.query(`LISTEN ${resolveOpenPathDbEventsChannel()}`);

  return {
    events,
    async waitForCount(count: number, timeoutMs = 2000): Promise<CapturedOpenPathEvent[]> {
      const deadline = Date.now() + timeoutMs;
      while (events.length < count && Date.now() < deadline) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      }
      return [...events];
    },
    async stop(): Promise<void> {
      await client.end();
    },
  };
}
