# Guía de Despliegue: Multi-Tenancy en ClassroomPath

## Resumen

Esta guía describe los pasos para desplegar el sistema de multi-tenancy que aísla los datos entre organizaciones.

## Pre-requisitos

- Acceso SSH al servidor de staging/producción
- Credenciales de base de datos PostgreSQL
- Docker y docker-compose instalados

## Pasos de Despliegue

### 1. Backup de la Base de Datos

**CRÍTICO**: Hacer backup ANTES de cualquier cambio:

```bash
# En el servidor
ssh root@192.168.1.150

# Staging
pct exec 113 -- docker exec classroompath-postgres-staging \
  pg_dump -U classroompath classroompath_staging > backup-staging-$(date +%Y%m%d-%H%M%S).sql

# Producción
pct exec 110 -- docker exec classroompath-postgres \
  pg_dump -U classroompath classroompath > backup-prod-$(date +%Y%m%d-%H%M%S).sql
```

### 2. Aplicar Migración de Schema

```bash
# En tu máquina local, desde el directorio del proyecto
cd api

# Generar SQL de migración (ya generado en drizzle/0000_lazy_masque.sql)
npx drizzle-kit generate

# Revisar el SQL generado
cat drizzle/0000_lazy_masque.sql

# Aplicar en staging
npx drizzle-kit push --config=drizzle.config.ts
```

### 3. Migrar Datos Existentes

```bash
# Desde el directorio raíz del proyecto
node migrate-to-multitenancy.js
```

Este script:
- Busca todas las organizaciones existentes
- Vincula todos los recursos (classrooms, groups, users) a la primera organización
- Es idempotente (puede ejecutarse múltiples veces sin problemas)

### 4. Build y Deploy

#### Staging

```bash
# Hacer commit y push a main
git add .
git commit -m "feat: implement multi-tenancy isolation"
git push origin main

# GitHub Actions desplegará automáticamente a staging
```

Verificar deployment:
```bash
# Ver logs del workflow
gh run list --workflow=deploy.yml

# Verificar que el servicio está corriendo
curl https://classroompath-staging.duckdns.org/cp/health
```

#### Producción

```bash
# Crear tag de versión
git tag v1.1.0
git push origin v1.1.0

# GitHub Actions desplegará automáticamente a producción
```

### 5. Verificación Post-Despliegue

#### A. Verificar que el puerto 3000 no está expuesto

```bash
# Desde fuera del servidor (debe fallar)
curl http://classroompath-staging.duckdns.org:3000/health
# Esperado: Connection refused

# Verificar que el Gateway funciona
curl https://classroompath-staging.duckdns.org/cp/health
# Esperado: {"status": "ok"}
```

#### B. Ejecutar tests de aislamiento

```bash
# Desde tu máquina local
./test-multitenancy.sh https://classroompath-staging.duckdns.org
```

El script verificará:
- ✓ Creación de 2 usuarios y organizaciones
- ✓ Usuario A puede crear un classroom
- ✓ Usuario A puede ver su classroom
- ✓ Usuario B NO puede ver el classroom de Usuario A
- ✓ Aislamiento funciona correctamente

#### C. Verificación Manual en el Browser

1. Abrir https://classroompath-staging.duckdns.org
2. Crear cuenta "Usuario A"
3. Crear organización "Org A"
4. Crear un aula "Aula Test A"
5. Logout
6. Crear cuenta "Usuario B"
7. Crear organización "Org B"
8. Verificar que NO aparece "Aula Test A"
9. Crear aula "Aula Test B"
10. Verificar que solo aparece "Aula Test B"
11. Logout y login como "Usuario A"
12. Verificar que solo aparece "Aula Test A"

### 6. Monitoreo

Verificar logs para errores:

```bash
# Staging
ssh root@192.168.1.150
pct exec 114 -- docker logs -f classroompath-gateway --tail=100

# Si hay errores relacionados con organizationId
# Verificar que todos los usuarios tienen membership
pct exec 113 -- docker exec classroompath-postgres-staging \
  psql -U classroompath -d classroompath_staging -c \
  "SELECT u.email, m.organization_id FROM users u LEFT JOIN cp_memberships m ON u.id = m.user_id;"
```

## Rollback

Si hay problemas críticos:

### 1. Rollback Rápido (Exponer OpenPath directamente)

```bash
# Editar docker-compose.yml en el servidor
ssh root@192.168.1.150
pct exec 114 -- vi /path/to/docker-compose.yml

# Cambiar:
# expose:
#   - "3000"
# Por:
# ports:
#   - "3000:3000"

# Reiniciar
pct exec 114 -- docker compose restart
```

### 2. Rollback Completo (Restaurar backup)

```bash
# Parar servicios
pct exec 114 -- docker compose down

# Restaurar backup
pct exec 113 -- docker exec -i classroompath-postgres-staging \
  psql -U classroompath classroompath_staging < backup-staging-YYYYMMDD-HHMMSS.sql

# Reiniciar con versión anterior
pct exec 114 -- docker compose up -d
```

## Problemas Comunes

### Error: "No organization membership found"

**Causa**: Usuario no tiene registro en `cp_memberships`

**Solución**:
```sql
-- Verificar memberships
SELECT * FROM cp_memberships WHERE user_id = 'USER_ID';

-- Si no existe, crear
INSERT INTO cp_memberships (id, user_id, organization_id, role)
VALUES (gen_random_uuid()::text, 'USER_ID', 'ORG_ID', 'admin');
```

### Error: "Classroom not found or access denied"

**Causa**: El classroom no está vinculado a la organización del usuario

**Solución**:
```sql
-- Verificar vínculo
SELECT * FROM cp_organization_classrooms 
WHERE classroom_id = 'CLASSROOM_ID';

-- Si no existe, vincular
INSERT INTO cp_organization_classrooms (id, organization_id, classroom_id)
VALUES (gen_random_uuid()::text, 'ORG_ID', 'CLASSROOM_ID');
```

### SPA muestra error de autenticación

**Causa**: El SPA está intentando acceder a `/trpc` en vez de `/cp/trpc`

**Solución**: Limpiar caché del browser y verificar que el build incluye el alias de vite:
```bash
cd spa
npm run build
# Verificar en dist/ que los imports apuntan a cp-trpc
```

## Checklist Final

- [ ] Backup de base de datos creado
- [ ] Migración de schema aplicada
- [ ] Datos existentes migrados
- [ ] Build y deploy completado
- [ ] Puerto 3000 no accesible externamente
- [ ] Gateway (puerto 3001) accesible
- [ ] Tests de aislamiento pasando
- [ ] Verificación manual completada
- [ ] Logs sin errores críticos
- [ ] Documentación actualizada

## Contacto de Soporte

Si hay problemas durante el despliegue:
1. Revisar logs en `/var/log/classroompath/`
2. Verificar estado de contenedores: `docker ps -a`
3. Revisar este documento para rollback si es necesario
