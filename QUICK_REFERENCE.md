# Multi-Tenancy Quick Reference

## 🚀 Deployment Status

| Environment | URL | Status | Last Deploy |
|-------------|-----|--------|-------------|
| **Staging** | https://classroompath-staging.duckdns.org | ✅ Live | Jan 12, 2026 |
| **Production** | https://classroompath.duckdns.org | ⏳ Pending | - |

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Internet                           │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │ Nginx Proxy Manager   │
         │ (SSL Termination)     │
         └───────────┬───────────┘
                     │
         ┌───────────┴────────────┐
         ▼                        ▼
    Staging                  Production
         │                        │
    ┌────┴────┐            ┌────┴────┐
    │ CT 114  │            │ CT 111  │
    │  App    │            │  App    │
    └────┬────┘            └────┬────┘
         │                      │
    ┌────┴────┐            ┌────┴────┐
    │ CT 113  │            │ CT 110  │
    │   DB    │            │   DB    │
    └─────────┘            └─────────┘
```

## 🔌 API Endpoints

### Public Gateway (Port 3001)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/cp/health` | GET | Health check |
| `/cp/trpc/onboarding.status` | POST | Get user org status |
| `/cp/trpc/onboarding.createOrganization` | POST | Create new org |
| `/cp/trpc/classrooms.list` | POST | List org classrooms |
| `/cp/trpc/groups.list` | POST | List org groups |
| `/cp/trpc/users.list` | POST | List org users |

### Internal OpenPath API (Port 3000)
⚠️ **Not exposed publicly** - Internal container network only

## 🗄️ Database Schema

### ClassroomPath Tables (Prefix: `cp_`)
```sql
cp_organizations              -- Organization records
cp_memberships                -- User-org associations (with roles)
cp_user_status                -- User invitation status
cp_organization_classrooms    -- Classroom → Organization links
cp_organization_groups        -- Group → Organization links
cp_organization_users         -- User → Organization links
```

### OpenPath Tables (No prefix)
```sql
users, roles, classrooms, groups, rules, etc.
```

## 🧪 Testing Commands

### Health Check
```bash
# Staging
curl -sf https://classroompath-staging.duckdns.org/cp/health

# Production
curl -sf https://classroompath.duckdns.org/cp/health
```

### Manual Isolation Test
```bash
./test-multitenancy.sh
```

### Database Inspection
```bash
# Staging (CT 113)
ssh root@192.168.1.150
pct exec 113 -- docker exec classroompath-postgres-staging \
  psql -U classroompath -d classroompath_staging -c \
  "SELECT * FROM cp_organizations;"

# Production (CT 110)
pct exec 110 -- docker exec classroompath-postgres \
  psql -U classroompath -d classroompath -c \
  "SELECT * FROM cp_organizations;"
```

## 🚢 Deployment

### To Staging (Automatic)
```bash
git push origin main
```

### To Production (Manual)
```bash
git tag v1.1.0
git push origin v1.1.0
```

### Monitor Deployment
```bash
gh run watch --repo balejosg/ClassroomPath
```

## 🐛 Troubleshooting

### Gateway Not Responding
```bash
# Check logs
ssh root@192.168.1.150
pct exec 114 -- docker logs classroompath-gateway --tail 50

# Restart container
pct exec 114 -- su -
cd /opt/classroompath/app/docker
docker compose restart gateway
```

### Database Connection Issues
```bash
# Check PostgreSQL status
pct exec 113 -- docker ps | grep postgres

# Check database connectivity
pct exec 113 -- docker exec classroompath-postgres-staging \
  psql -U classroompath -d classroompath_staging -c "SELECT 1;"
```

### Deployment Failed
```bash
# View GitHub Actions logs
gh run list --limit 5
gh run view <RUN_ID> --log

# SSH to server and check manually
ssh root@192.168.1.150
pct exec 114 -- docker compose ps
pct exec 114 -- docker compose logs --tail 100
```

## 🔄 Common Operations

### View Organizations
```bash
pct exec 113 -- docker exec classroompath-postgres-staging \
  psql -U classroompath -d classroompath_staging -c "
    SELECT o.id, o.name, o.created_at, COUNT(m.user_id) as members
    FROM cp_organizations o
    LEFT JOIN cp_memberships m ON o.id = m.organization_id
    GROUP BY o.id, o.name, o.created_at
    ORDER BY o.created_at DESC;
  "
```

### View User Memberships
```bash
pct exec 113 -- docker exec classroompath-postgres-staging \
  psql -U classroompath -d classroompath_staging -c "
    SELECT u.email, o.name as organization, m.role, m.created_at
    FROM cp_memberships m
    JOIN users u ON m.user_id = u.id
    JOIN cp_organizations o ON m.organization_id = o.id
    ORDER BY m.created_at DESC;
  "
```

### Clear Test Data (Staging Only!)
```bash
pct exec 113 -- docker exec classroompath-postgres-staging \
  psql -U classroompath -d classroompath_staging -c "
    TRUNCATE cp_organization_users, cp_organization_groups, 
             cp_organization_classrooms, cp_memberships, 
             cp_organizations CASCADE;
  "
```

## 📊 Metrics to Monitor

### Application Health
- [ ] Gateway response time < 200ms
- [ ] Database connection pool < 80% usage
- [ ] No 500 errors in last hour
- [ ] Container memory < 80%

### Business Metrics
- [ ] Organization creation rate
- [ ] Active users per organization
- [ ] Resource count per organization

## 🆘 Emergency Contacts

| Role | Action |
|------|--------|
| **Staging Issues** | Check logs in CT 114, restart containers |
| **Production Issues** | Check logs in CT 111, contact stakeholder |
| **Database Issues** | Check PostgreSQL in CT 113/110 |
| **Deployment Failed** | Review GitHub Actions logs |

## 📚 Documentation

- **Implementation**: `MULTI_TENANCY_IMPLEMENTATION.md`
- **Deployment**: `DEPLOYMENT_GUIDE.md`
- **Success Report**: `DEPLOYMENT_SUCCESS.md`
- **Next Steps**: `NEXT_STEPS.md`
- **Architecture**: `AGENTS.md`

---

**Last Updated**: January 12, 2026  
**Version**: 1.1.0-staging  
**Status**: ✅ Deployed to Staging, Awaiting UAT
