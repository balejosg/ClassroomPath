import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildDatabaseUrl,
  deriveDatabaseComponentEnv,
  parseDatabaseUrl,
  resolveDatabaseUrl,
} from '../src/lib/database-url.js';

describe('database url helpers', () => {
  it('prefers DATABASE_URL when present', () => {
    assert.equal(
      resolveDatabaseUrl({
        DATABASE_URL: 'postgresql://user:pass@db.internal:5433/classroompath',
        DB_HOST: 'ignored-host',
      }),
      'postgresql://user:pass@db.internal:5433/classroompath'
    );
  });

  it('builds a database url from component env when needed', () => {
    assert.equal(
      resolveDatabaseUrl(
        {
          DB_HOST: 'localhost',
          DB_PORT: '5434',
          DB_NAME: 'classroompath_test',
          DB_USER: 'teacher',
          DB_PASSWORD: 'secret',
        },
        { database: 'classroompath' }
      ),
      'postgresql://teacher:secret@localhost:5434/classroompath_test'
    );
  });

  it('derives component env from DATABASE_URL', () => {
    assert.deepEqual(
      deriveDatabaseComponentEnv({
        DATABASE_URL: 'postgresql://teacher:secret@db.internal:5434/classroompath_test',
      }),
      {
        DB_HOST: 'db.internal',
        DB_PORT: '5434',
        DB_NAME: 'classroompath_test',
        DB_USER: 'teacher',
        DB_PASSWORD: 'secret',
      }
    );
  });

  it('round-trips parsed parts back into a connection string', () => {
    const parts = parseDatabaseUrl(
      'postgresql://teacher:secret@db.internal:5434/classroompath_test'
    );
    assert.equal(
      buildDatabaseUrl(parts),
      'postgresql://teacher:secret@db.internal:5434/classroompath_test'
    );
  });
});
