# Plan: corregir regresiones del Windows Offline Installer

> **Ejecución:** aplicar directamente sobre `main`; no desplegar ni promover.

## Objetivo

Corregir los defectos de propagación del pin, resolución del directorio host,
permisos del template, readiness caliente, estado de release, canary single-use
y publicación de artifacts, preservando template RO, artifacts RW y refs
single-use.

## Pasos TDD

1. Añadir pruebas de contrato que reproduzcan pin incompleto en Compose/deploy,
   default divergente del directorio host y permisos inseguros del provisioner.
2. Implementar un resolver canónico del directorio host y propagar el pin del
   release manifest de forma explícita hasta el gateway.
3. Normalizar permisos antes de publicar el template y verificar idempotencia,
   reprovisioning seguro y compatibilidad con el bind mount RO.
4. Añadir pruebas de que readiness hashea una vez, reutiliza identidad estable y
   vuelve a verificar cuando cambia el fichero; implementar la caché fail-closed.
5. Añadir los cuatro campos del pin al runtime state y a restore/rollback, con
   cobertura de serialización y recuperación.
6. Añadir retry corto y acotado al segundo GET del canary, manteniendo resultado
   final 410 y salida sin secretos.
7. Añadir prueba de fallo `mintReference -> rename` y hacer que el servicio
   invalide la referencia recién creada y elimine staging.
8. Ejecutar pruebas dirigidas, gates locales obligatorios, revisar diff y crear
   un commit en `main`.

## Verificación

Como mínimo:

```bash
npm run test:deployment
npm run verify:static
npm run verify:public-surface
npm run verify:docs
npm run verify:commit
```

No se ejecutarán deploys, promociones, tags ni smoke tests live.
