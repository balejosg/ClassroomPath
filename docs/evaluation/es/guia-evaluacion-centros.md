# Guía breve de evaluación para centros

> Estado: mantenido
> Aplica a: responsables TIC y equipos directivos en fase de evaluación
> Última verificación: 2026-04-13
> Fuente de verdad: `docs/evaluation/es/guia-evaluacion-centros.md`

Si tu centro está valorando ClassroomPath, esta es la ruta corta:

1. **Aclara el modelo de operación.**
   Si queréis operar el sistema vosotros mismos, empezad por [OpenPath](https://github.com/balejosg/openpath) y su guía de adopción OSS.
   Si queréis una demo, un piloto o un servicio gestionado, empezad por ClassroomPath.

2. **Revisa la confianza técnica mínima.**
   Leed la guía de seguridad y confianza: [`../security-trust.md`](../security-trust.md).
   Ahí están enlazados el modelo de sesión, la política de seguridad del core y la postura de privacidad de la extensión.
   Si queréis separar hechos de mensajes comerciales, revisad también [`../claims-and-evidence.md`](../claims-and-evidence.md).

3. **Usa una checklist común entre TIC y dirección.**
   Trabajad sobre [`../it-evaluation-checklist.md`](../it-evaluation-checklist.md) para evitar que la decisión dependa solo de impresiones o de una demo.

4. **Comprueba el encaje técnico del piloto.**
   Revisad [`../compatibility-matrix.md`](../compatibility-matrix.md) para confirmar si el entorno que queréis probar encaja con la superficie documentada actualmente.

5. **Compara core OSS frente a servicio gestionado.**
   Leed [`../openpath-vs-classroompath.md`](../openpath-vs-classroompath.md) para decidir si necesitáis autogestión o una vía operativa con menos carga diaria.

6. **Diseña el piloto antes de ampliarlo.**
   Usad [`../pilot-runbook.md`](../pilot-runbook.md) para dejar claro alcance, responsables, mediciones y criterios de salida.

7. **Pide el siguiente paso correcto.**
   Para presupuesto, piloto o demo, usad [classroompath.example.invalid](https://classroompath.example.invalid/).

## Qué deberíais tener claro antes de seguir

- quién aprobará cambios de acceso
- qué aulas o dispositivos entrarían primero en el piloto
- qué riesgo queréis reducir primero: seguridad, carga operativa o coherencia de política digital
- qué evidencia interna necesitáis para pasar de piloto a despliegue más amplio
- qué objeciones técnicas deben quedar resueltas antes de tomar una decisión

## Qué no deberíais asumir sin confirmación explícita

- certificaciones o marcos de compliance no publicados en el repositorio
- integraciones empresariales no documentadas
- que el servicio elimina por completo la necesidad de criterio interno sobre la política de acceso
