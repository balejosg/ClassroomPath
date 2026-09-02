# ClassroomPath #162: diseño del executor hermético de producción

## Alcance y estado de esta iteración

Esta especificación define el diseño objetivo para las fases A–J del issue #162:
contrato mínimo del host, runtime hermético del verifier, contrato de empaquetado,
canary/fault injection del executor, estado transaccional, rollback independiente,
boundary explícito, diagnóstico post-switch y smoke staging/production independiente.

La implementación local permanece en `implementation complete / operational proof
pending`. El harness repository-owned para el host staging-equivalent está
implementado y cubierto por regresiones contractuales, pero K sigue en
`K NOT READY` hasta que exista y se preflightée un host aislado real. No se
ejecutan staging, producción, hosts reales, tags, releases, push ni cambios
remotos. Las fases K–M quedan explícitamente como prueba operativa pendiente de
autorización.

El staging normal queda descartado para K porque su namespace Compose y sus
named volumes no son los de producción. El procedimiento de K está documentado
en [`docs/runbooks/staging-equivalent-k.md`](../../runbooks/staging-equivalent-k.md)
y usa `scripts/staging-equivalent-harness.sh` con una fence durable de host,
daemon Docker, filesystem, deploy root, URL y proyecto Compose.

## Decisiones

Se extienden los helpers existentes en vez de introducir una segunda orquestación.
El host remoto sólo aporta primitivas POSIX documentadas, Git, Docker/Compose y
curl; cualquier CLI Node que siga siendo necesario se ejecuta desde una imagen
verifier fijada por digest. El shell marca la fase y el resultado de la transición;
el código Node de release-state conserva los artefactos inmutables y avanza los
punteros de forma atómica.

El executor se divide en estas fases:

```text
RESOLVE -> PREFLIGHT -> PREPARE -> SWITCH -> VERIFY -> COMMIT
                                  ^
                                  |
                            mutation boundary
```

Antes de `SWITCH`, un fallo significa que no se debe haber mutado producción.
Después de `SWITCH`, el estado queda en `ACTIVATED_UNVERIFIED` hasta que health,
readiness y validación semántica pasan. El candidato sólo pasa a `COMMITTED`
cuando el snapshot exacto se persiste y `current` avanza atómicamente.

## Contrato de host y runtime

`production-host-contract.sh` valida presencia, versión mínima cuando aplique,
daemon Docker, Compose, permisos de `CLASSROOMPATH_DEPLOY_ROOT`, espacio y red
de pull antes de la mutación. Node/npm no son requisitos y se comprueba que no
se utilizan en la ruta crítica del host. Los comandos Node de bundle/state se
invocan por un único helper a través del verifier immutable; el manifest del
Dockerfile mantiene explícitamente todos los módulos requeridos.

## Estado y rollback

El modelo de estado público es:

```text
PREPARED -> SWITCHING -> ACTIVATED_UNVERIFIED -> VERIFIED -> COMMITTED
      \-> FAILED                  \-> ROLLING_BACK -> ROLLED_BACK
```

Las transiciones inválidas fallan cerrado. `current` y `previous` siguen siendo
IDs de release; el snapshot previo contiene bundle, contrato y runtime exactos.
El rollback lee sólo `previous`, verifica hashes y refs OCI, prepara la proyección
guardada y valida health/readiness antes de activar el ID anterior. No usa helpers,
checkout, módulos, metadatos OpenPath, RC o runtime del candidato para seleccionar
la recuperación. El executor estable conserva las comprobaciones de shell y usa
el verifier del release previo únicamente para validar/proyectar sus artefactos.

## Diagnóstico y workflows

El marker de fase y un JSON bounded, sin secretos, se escriben de forma atómica.
El workflow recoge diagnóstico con `if: always()` cuando el marker indica que la
mutación pudo comenzar; distingue smoke de éxito de smoke diagnóstico read-only.
El workflow scheduled de smoke resuelve staging y producción como jobs independientes
y agrega sus resultados al final, de modo que una conexión caída no suprima el otro
entorno.

## Verificación

Los tests nuevos empiezan rojos y cubren contrato de host, invocación sin Node,
comandos ausentes del verifier, transiciones válidas/ inválidas, cada fallo de
prepare/switch/verify/commit, rollback con candidato roto, secret-safety y las
condiciones `always()`/independencia de smoke. Después se ejecutan las suites de
deployment, workflows, scripts y la regresión local completa disponible. El informe
separa evidencia local de la prueba operativa pendiente K–M.
