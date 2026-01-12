# Multi-Tenancy Implementation Summary

## Changes Implemented

### 1. Database Schema (api/src/db/schema.ts)
Added three new relation tables:
- `cp_organization_classrooms`: Links classrooms to organizations
- `cp_organization_groups`: Links whitelist groups to organizations
- `cp_organization_users`: Links OpenPath users to organizations

### 2. Middleware (api/src/trpc/trpc.ts)
Created `tenantProcedure` that:
- Verifies user has organization membership
- Injects `organizationId` and `userRole` into context
- Throws FORBIDDEN if no membership found

### 3. Routers (api/src/trpc/routers/)
Created three new routers with tenant filtering:

**classrooms.ts**:
- list, getById, create, update, delete
- All operations filtered by organizationId

**groups.ts**:
- list, getById, getRules, create, update, delete
- addRule, deleteRule
- All operations filtered by organizationId

**users.ts**:
- list, getById, getRole, create, update, delete
- assignRole
- All operations filtered by organizationId

### 4. Docker Configuration (docker/docker-compose.yml)
Changed OpenPath API from:
```yaml
ports:
  - "3000:3000"
```
To:
```yaml
expose:
  - "3000"
```

Now only accessible within Docker network.

### 5. SPA Configuration (spa/vite.config.ts)
Added alias to redirect all `trpc.js` imports to `cp-trpc.ts`:
```typescript
{
    find: /^.*\/trpc\.js$/,
    replacement: resolve(__dirname, 'src/cp-trpc.ts'),
}
```

## Deployment Steps

### 1. Run Database Migration

```bash
cd api
npx drizzle-kit push:pg
```

This will create the three new tables.

### 2. Migrate Existing Data (CRITICAL)

For each existing organization, link their resources:

```sql
-- Example: Link all existing classrooms to the first organization
INSERT INTO cp_organization_classrooms (id, organization_id, classroom_id, created_at)
SELECT 
    gen_random_uuid()::text,
    (SELECT id FROM cp_organizations LIMIT 1),
    id,
    NOW()
FROM classrooms
WHERE id NOT IN (SELECT classroom_id FROM cp_organization_classrooms);

-- Repeat for groups and users
INSERT INTO cp_organization_groups (id, organization_id, group_id, created_at)
SELECT 
    gen_random_uuid()::text,
    (SELECT id FROM cp_organizations LIMIT 1),
    id,
    NOW()
FROM whitelist_groups
WHERE id NOT IN (SELECT group_id FROM cp_organization_groups);

INSERT INTO cp_organization_users (id, organization_id, openpath_user_id, created_at)
SELECT 
    gen_random_uuid()::text,
    (SELECT id FROM cp_organizations LIMIT 1),
    id,
    NOW()
FROM users
WHERE id NOT IN (SELECT openpath_user_id FROM cp_organization_users);
```

### 3. Build and Deploy

```bash
# Build API
cd api
npm run build

# Build SPA
cd ../spa
npm run build

# Rebuild Docker containers
cd ../docker
docker compose build --no-cache
docker compose up -d
```

### 4. Verify Isolation

Test multi-tenancy:

```bash
# Create test organizations
curl -X POST http://localhost:3001/cp/trpc/onboarding.createOrganization \
  -H "Authorization: Bearer USER_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Organization A"}'

curl -X POST http://localhost:3001/cp/trpc/onboarding.createOrganization \
  -H "Authorization: Bearer USER_B_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Organization B"}'

# Create resource in Org A
curl -X POST http://localhost:3001/cp/trpc/classrooms.create \
  -H "Authorization: Bearer USER_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "test-classroom-a", "displayName": "Test Classroom A"}'

# Verify User B cannot see it
curl http://localhost:3001/cp/trpc/classrooms.list \
  -H "Authorization: Bearer USER_B_TOKEN"
# Should return empty array
```

## Verification Checklist

- [ ] Database migration completed successfully
- [ ] Existing data migrated to first organization
- [ ] Docker containers rebuilt and running
- [ ] Port 3000 not accessible externally
- [ ] Port 3001 (Gateway) accessible
- [ ] User A can create classroom
- [ ] User B cannot see User A's classroom
- [ ] User B can create their own classroom
- [ ] Each user only sees their organization's data

## Rollback Plan

If issues occur:

1. Revert docker-compose.yml to expose port 3000
2. Drop new tables:
```sql
DROP TABLE cp_organization_users;
DROP TABLE cp_organization_groups;
DROP TABLE cp_organization_classrooms;
```
3. Rebuild containers from previous version

## Architecture After Implementation

```
┌─────────────────┐     ┌───────────────────────────┐     ┌──────────────────┐
│   SPA (:8081)   │────▶│ Gateway (:3001)           │────▶│ OpenPath (:3000) │
│                 │     │   /cp/trpc/*              │     │   INTERNAL ONLY  │
│                 │     │   + filtrado por org ✓    │     │   No expuesto    │
└─────────────────┘     └───────────────────────────┘     └──────────────────┘
                                      │
                                      ▼
                        ┌──────────────────────────┐
                        │   ClassroomPath DB       │
                        │   - cp_organizations     │
                        │   - cp_memberships       │
                        │   - cp_org_classrooms    │
                        │   - cp_org_groups        │
                        │   - cp_org_users         │
                        └──────────────────────────┘
```

## Important Notes

1. **Never modify OpenPath directly**: All ClassroomPath-specific code is in the wrapper layer
2. **Gateway is mandatory**: SPA cannot access OpenPath directly anymore
3. **All data is scoped**: Resources are linked to organizations via relation tables
4. **Backward compatible**: OpenPath tables remain unchanged
5. **Tenant procedure**: All new routers use `tenantProcedure` for automatic filtering
