#!/usr/bin/env node
/**
 * Generates a real personalized Windows offline installer from the ClassroomPath
 * staging API and downloads it. Intended as a pre-staging CI step so Windows
 * validation always runs against an installer with real enrollment.
 *
 * Env:
 *   STAGING_PUBLIC_URL  required, e.g. https://staging.classroompath.eu
 *   OUTPUT_PATH         optional, defaults to ./openpath-staging-installer.exe
 *   CLASSROOM_ID        optional, reuse an existing classroom (skips bootstrap)
 *   CANARY_EMAIL        optional, reuse an existing account
 *   CANARY_PASSWORD     optional, required with CANARY_EMAIL
 *
 * Flow:
 *   auth.register/verify (when needed) -> auth.login
 *   -> reuse the supplied CLASSROOM_ID (or discover an existing classroom)
 *   -> windowsOfflineInstaller.generate -> download + SHA256 verify
 *
 * Output: JSON summary on stdout (no secrets).
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const TERMS_VERSION = '2026-03-09';

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function password() {
  return `Op!${randomBytes(18).toString('base64url')}`;
}

class Session {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/u, '');
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  absorb(response) {
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const raw of setCookies) {
      const pair = raw.split(';', 1)[0];
      const index = pair.indexOf('=');
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }

  async query(procedure, input) {
    const url = new URL(`${this.baseUrl}/cp/trpc/${procedure}`);
    url.searchParams.set('input', JSON.stringify(input ?? {}));
    const headers = { origin: this.baseUrl, referer: `${this.baseUrl}/` };
    const cookieHeader = this.cookieHeader();
    if (cookieHeader) headers.cookie = cookieHeader;
    const response = await fetch(url, { headers });
    this.absorb(response);
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error(`${procedure}: invalid JSON (${response.status})`);
    }
    if (!response.ok || body.error) {
      const message = body.error?.json?.message ?? body.error?.message ?? `HTTP ${response.status}`;
      throw new Error(`${procedure}: ${message}`);
    }
    return body.result?.data;
  }

  async call(procedure, input) {
    const headers = {
      'Content-Type': 'application/json',
      origin: this.baseUrl,
      referer: `${this.baseUrl}/`,
    };
    const cookieHeader = this.cookieHeader();
    if (cookieHeader) headers.cookie = cookieHeader;
    const response = await fetch(`${this.baseUrl}/cp/trpc/${procedure}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(input ?? {}),
    });
    this.absorb(response);
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error(`${procedure}: invalid JSON (${response.status})`);
    }
    if (!response.ok || body.error) {
      const message = body.error?.json?.message ?? body.error?.message ?? `HTTP ${response.status}`;
      throw new Error(`${procedure}: ${message}`);
    }
    return body.result?.data;
  }

  async get(url) {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`download: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    return { bytes, headers: response.headers };
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function bootstrapAccount(session) {
  const suffix = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  const email = (process.env.CANARY_EMAIL ?? `op-staging-canary-${suffix}@example.invalid`).trim();
  const secret = process.env.CANARY_PASSWORD?.trim() || password();
  const name = 'OpenPath Staging Canary';

  if (!process.env.CANARY_EMAIL) {
    const registration = await session.call('auth.register', {
      email,
      name,
      password: secret,
      termsAccepted: true,
      termsVersion: TERMS_VERSION,
    });
    if (!registration?.verificationRequired) throw new Error('register: verification not required');
    const verificationUrl = String(registration.verificationUrl ?? '');
    const token = new URL(verificationUrl).searchParams.get('token');
    if (!token) throw new Error('register: verification token missing');
    await session.call('auth.verifyEmail', { email, token });
  } else {
    // Idempotent bootstrap with fixed credentials: register when new, verify,
    // then log in. Re-runs of this script reuse the same account.
    try {
      const registration = await session.call('auth.register', {
        email,
        name,
        password: secret,
        termsAccepted: true,
        termsVersion: TERMS_VERSION,
      });
      const verificationUrl = String(registration?.verificationUrl ?? '');
      const token = verificationUrl ? new URL(verificationUrl).searchParams.get('token') : null;
      if (token) await session.call('auth.verifyEmail', { email, token });
    } catch {
      // Account already exists; fall through to login.
    }
  }

  await session.call('auth.login', { email, password: secret });

  if (process.env.CLASSROOM_ID) {
    return { email, classroomId: process.env.CLASSROOM_ID };
  }

  // Organization creation requires billing checkout in this deployment, so
  // automation must reuse an existing organization via a service account.
  const classrooms = await session.query('classrooms.list', {});
  const list = Array.isArray(classrooms) ? classrooms : (classrooms?.classrooms ?? []);
  const firstId = list[0]?.id;
  if (!firstId) throw new Error('classrooms.list: no classrooms for this account');
  return { email, classroomId: String(firstId) };
}

async function main() {
  const baseUrl = requireEnv('STAGING_PUBLIC_URL');
  const outputPath = path.resolve(process.env.OUTPUT_PATH ?? 'openpath-staging-installer.exe');
  const session = new Session(baseUrl);

  const { email, classroomId } = await bootstrapAccount(session);
  const metadata = await session.call('windowsOfflineInstaller.generate', { classroomId });
  const downloadUrl = String(metadata?.downloadUrl ?? '');
  const expectedSha256 = String(metadata?.sha256 ?? '').toLowerCase();
  if (!downloadUrl || !/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new Error('generate: incomplete metadata');
  }

  const resolved = new URL(downloadUrl, `${baseUrl}/`).href;
  const { bytes } = await session.get(resolved);
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== expectedSha256) throw new Error('download: sha256 mismatch');

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, bytes, { mode: 0o600 });

  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'generated',
        baseUrl,
        email,
        classroomId,
        outputPath,
        size: bytes.length,
        sha256: actualSha256,
        metadata,
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
