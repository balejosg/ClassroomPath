import { appendFile, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface TestEmailSinkEntry {
  createdAt: string;
  html: string;
  subject: string;
  text?: string;
  to: string;
}

export const DEFAULT_TEST_EMAIL_SINK_FILE = '/tmp/classroompath-e2e-email-sink.jsonl';

export function resolveTestEmailSinkFile(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CP_TEST_EMAIL_SINK_FILE?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_TEST_EMAIL_SINK_FILE;
}

export async function appendTestEmailSinkEntry(
  entry: TestEmailSinkEntry,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const sinkFile = resolveTestEmailSinkFile(env);
  await mkdir(dirname(sinkFile), { recursive: true });
  await appendFile(sinkFile, `${JSON.stringify(entry)}\n`, 'utf8');
}

export async function clearTestEmailSink(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await rm(resolveTestEmailSinkFile(env), { force: true });
}
