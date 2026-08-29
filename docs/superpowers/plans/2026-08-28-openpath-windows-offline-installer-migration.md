# Plan: consume the canonical OpenPath Windows offline installer

Issue: `balejosg/ClassroomPath#158`
Contract: OpenPath `fe253a94053eafc5356b7a6c6c24b109df599d15`

## 1. Establish the public boundary with tests

- Add typed OpenPath gateway tests for the exact `windowsOfflineInstaller.generate`
  procedure, bearer forwarding, safe response validation, and upstream error mapping.
- Add wrapper-router tests proving tenant policy runs before the upstream call and
  that the same ClassroomPath access token is forwarded.
- Add readiness tests for the OpenPath capability signal and unavailable/degraded
  upstream states.
- Add proxy/application-route tests for the canonical root download path and the
  retired `/cp/api` path.

## 2. Implement the thin consumer

- Add the installer method to the existing public `OpenPathGateway` adapter.
- Replace the CP generator router body with the tenant-scoped policy plus this
  public adapter call.
- Remove local artifact/ref/config/overlay/ticket dependencies from the server and
  gateway composition.
- Keep the existing localized visible action and prove every click receives a fresh
  canonical URL which is cleared after immediate navigation.

## 3. Move readiness and deployment ownership

- Parse `checks.windowsOfflineInstaller.status === "ok"` from the OpenPath
  `healthcheck.ready` contract; do not read or hash a template in ClassroomPath.
- Proxy `GET /api/windows-offline-installer/download` to OpenPath and explicitly
  reject the retired CP route.
- Replace gateway CP installer variables, mounts, and volume with canonical
  `OPENPATH_WINDOWS_OFFLINE_*` values, an OpenPath-only template/artifact volume,
  and the OpenPath one-shot provisioner dependency.
- Update deploy/release state helpers to carry the complete OpenPath template pin as
  one coherent set, without a CP provisioner or legacy variable fallback.

## 4. Add wrapper canary and architecture guards

- Make the canary exercise CP auth/session and policy through the CP tRPC endpoint,
  then the canonical download proxy; record only status, headers, size, and SHA.
- Replace deployment tests for the CP provisioner with canonical wiring tests.
- Add a repository architecture regression test for reintroduced generic CP refs,
  artifacts, binary streaming, template hashing/provisioning, and `CP_OFFLINE`
  ownership while allowing the wrapper route/component and historical migration.

## 5. Retire legacy code and data safely

- Delete the generic CP services, route, config, overlay, ticket client, provisioner,
  host-path helper, and their internal tests after the consumer tests are green.
- Preserve migration `0010` unchanged and add a forward retirement migration for
  the legacy refs table; remove its Drizzle schema declarations only with that
  forward migration after the drain. The normal migration runner defers `0011`
  and requires the explicit `--confirm-windows-offline-installer-legacy-retirement`
  command for the one-shot destructive cleanup.
- Remove obsolete CP ownership plans and update maintained environment/routes docs.

## 6. Verify locally and hand off

- Run focused API, SPA, deployment, migration metadata, architecture, docs,
  public-surface, scripts-types, formatting, static, and incremental gates.
- Do not run staging, production, promotion, live canary, or the destructive DB
  migration in this session because the request explicitly withholds authorization.
- Report the highest evidence rung as local unit/contract evidence and mark #158
  `todavía bloqueado` until an authorized staging cutover and legacy drain exist.
