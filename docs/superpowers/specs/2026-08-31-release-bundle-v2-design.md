# ClassroomPath #160: diseño de Release Bundle v2

## Objetivo

Hacer que ClassroomPath consuma una publicación inmutable de OpenPath por el
SHA exacto fijado en el gitlink y que toda la cadena RC → staging → evidence →
production → rollback transporte la misma identidad de release.

El primer cutover fija el gitlink de upstream/openpath a
a3846d6cbbb5c816d12dc4c5a60409760e121b90. El contrato remoto esperado es

https://raw.githubusercontent.com/balejosg/OpenPath/gh-pages/promotion-contracts/v2/a3846d6cbbb5c816d12dc4c5a60409760e121b90.json

La URL es una forma concreta del contrato general:

https://raw.githubusercontent.com/balejosg/OpenPath/gh-pages/promotion-contracts/v2/<FULL_OPENPATH_SHA>.json

## Límites y no objetivos

- Este cambio sólo modifica ClassroomPath y su referencia de submódulo.
- No se editará upstream/openpath ni se añadirá una dependencia de
  OpenPath hacia ClassroomPath.
- No se ejecutarán deploys, promoción, tags, releases ni push.
- No se introducirán fallback a ancestros, ramas, latest, tags mutables ni
  composición de componentes desde búsquedas independientes.
- Durante la migración se mantendrán parsers/proyecciones legacy sólo como
  compatibilidad de formato; no conservarán autoridad de selección.

## Autoridad de OpenPath

El nuevo resolvedor recibe el SHA que resulta de
git rev-parse HEAD:upstream/openpath. Descarga únicamente el objeto
promotion-contracts/v2/<SHA>.json. La ausencia de ese objeto, un estado HTTP
no exitoso, JSON inválido, schemaVersion no soportado, interfaces no
soportadas, componentes incompletos o cualquier discrepancia de SHA hace
fallar cerrado el proceso.

El módulo de contrato:

1. valida un SHA hexadecimal completo de 40 caracteres;
2. construye la URL v2 exacta;
3. conserva los bytes recibidos sin reserializarlos;
4. calcula contractSha256 sobre esos bytes exactos;
5. valida que contract.openpathSha coincide byte por byte con el SHA fijado;
6. expone los datos de Linux, Windows y browser policy únicamente como
   provenance consumible y como fuente de proyecciones legacy.

La política inicial acepta wrapperIntegration=1,
windowsOfflineInstaller=1 y readiness=1. Cambiar una versión de interfaz
requiere una actualización explícita de la política y de sus tests.

## Release Bundle v2

El bundle canónico contiene sólo identidad reproducible y referencias físicas:

    {
      schemaVersion: 2,
      classroomPathSha: <40 hex>,
      openPath: {
        sourceSha: <40 hex>,
        contractSha256: <64 lowercase hex>
      },
      images: {
        gateway: <OCI repository@sha256:digest>,
        migrations: <OCI repository@sha256:digest>,
        openpathFirefoxAssets: <OCI repository@sha256:digest>,
        openpathApi: <OCI repository@sha256:digest>,
        spa: <OCI repository@sha256:digest>,
        verifier: <OCI repository@sha256:digest>
      }
    }

El serializador fija el orden de claves, no incluye timestamps, workflow IDs,
tags, deploy state ni releaseId, y produce los bytes exactos que se publican.
releaseId es SHA-256 de esos bytes. Por tanto, dos bundles byte a byte iguales
tienen la misma identidad y cualquier cambio material genera otra identidad.

Junto al bundle se publica el archivo exacto del contrato OpenPath. El
consumidor verifica:

- hash del bundle frente a releaseId;
- contractSha256 frente a los bytes del contrato;
- openPath.sourceSha frente al gitlink y a contract.openpathSha;
- cada imagen como referencia OCI por digest, nunca por tag.

## Provenance y reuse

Cada imagen derivada de OpenPath lleva en su configuración OCI:

- org.opencontainers.image.revision = OpenPath source SHA;
- eu.classroompath.openpath.contract-sha256 = hash de los bytes del contrato.

La decisión de reuse se basa en contractSha256: un hash igual permite reutilizar
una imagen OpenPath-derived ya verificada; un hash distinto obliga a
reconstruirla. ClassroomPath no infiere equivalencia por componentes.

## Flujo de estados

### RC

El job comprueba checkout limpio, fija el SHA del gitlink, resuelve el contrato
exacto, verifica interfaces y calcula el hash de bytes. Después construye o
reutiliza imágenes según contractSha256, verifica provenance y genera bundle,
contrato y evidence ligados a releaseId. Los campos Linux/Windows legacy, si
se emiten, son proyecciones del contrato.

### Staging

Staging recibe un único bundle y su contrato. Verifica sus hashes, ClassroomPath
SHA, OpenPath SHA, imágenes, pin Linux, template Windows y readiness antes de
activar. El estado persistente registra al menos RELEASE_ID, APP_SHA,
OPENPATH_SHA y OPENPATH_CONTRACT_SHA256. La evidencia sólo es válida si su
releaseId coincide con el bundle y con RELEASE_ID vivo.

### Production

La promoción usa una anotación de tag que contiene ClassroomPath-Release-Id y
ClassroomPath-RC-Run-Id. El tag debe apuntar al ClassroomPath SHA del bundle.
El workflow obtiene el bundle del locator exacto del run RC, recalcula su hash,
comprueba el tag target y despliega los mismos digests sin re-resolver ni
reconstruir. Repetir la misma identidad es idempotente; una identidad
conflictiva falla cerrado. La operación no crea tags ligeros.

### Rollback

release-state/releases/<releaseId>/ conserva bundle, contrato y runtime.env.
current y previous contienen sólo IDs. Rollback selecciona únicamente
previous, vuelve a verificar bundle, contrato, imágenes, template y readiness,
y activa el ID anterior atómicamente. Un reprovisionado fallido no puede borrar
el estado current/previous válido.

## Migración

Primero se añaden el resolvedor exacto, los tests de contrato y el serializador
del bundle. Luego los workflows y despliegues consumen el bundle. Finalmente
los resolvedores Linux/Windows dejan de seleccionar versiones: sólo verifican
valores proporcionados por contrato y exponen proyecciones compatibles. Los
selectores legacy se retiran cuando ningún consumidor activo los necesita.

## Verificación

La implementación seguirá TDD: tests rojos para contrato exacto, hash de bytes,
bundle canónico, releaseId, provenance, reuse y estados; después cambios
mínimos de runtime/workflow hasta hacerlos verdes.

Se ejecutarán gates locales focalizados y los tests de deployment/workflows del
repositorio. Esta fase no ejecuta staging, producción, tags, releases ni push.
