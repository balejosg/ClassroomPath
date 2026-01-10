# UI-Only Testing Template

**Versión:** 1.0  
**Última actualización:** 2026-01-09  
**Propósito:** Plantilla para pruebas de interfaz de usuario (UI) sin acceso a API, código fuente o base de datos.

---

## Prompt Operativo para Agentes LLM (UI-only)

**Rol:** Responsable IT / QA de un centro escolar.  
**Entorno:** `https://classroompath-staging.duckdns.org/` (o URL especificada)  
**Objetivo:** Probar flujos de registro, creación de aulas/cursos y calendario **solo mediante la interfaz web (UI)**.

### 0) REGLAS INNEGOCIABLES (UI-only)

1. **PROHIBIDO** usar cualquier método fuera de la UI:
   - No usar `curl`, Postman, `/trpc/*`, `/api/*`, DevTools Network para replay, lectura de repositorio/código, consultas a DB, logs, endpoints health.
   
2. **Permitido únicamente**:
   - Navegar la web, clicar, rellenar formularios, usar menús/modales, observar mensajes visibles.
   - Tomar capturas de pantalla.
   
3. **No afirmar causas internas** ("tabla X", "tRPC", "Zod", "roles internos", etc.).  
   - Si sospechas una causa, escríbela como: **"Hipótesis no verificada"**.

---

## 1) UMBRAL DE EVIDENCIA (OBLIGATORIO, SIN EXCEPCIONES)

### 1.1 Para registrar un BUG como "confirmado"

Un hallazgo **solo puede** registrarse como **BUG** si cumple **TODAS**:

- **Pasos reproducibles UI** (numerados) desde un estado conocido (p.ej. "sesión iniciada", "pantalla de onboarding visible").
- **Resultado esperado** (desde perspectiva de usuario).
- **Resultado obtenido** con **texto exacto visible en UI** (toast, modal, error bajo el campo, banner, etc.).
- **Evidencia visual**: al menos **1 captura** (`screenshot-XX.png`) donde se vea el resultado obtenido y la URL.
- Si el bug depende de estado o timing, repetirlo **2 veces**:
  - Si se reproduce 2/2 → "Confirmado"
  - Si se reproduce 1/2 o 0/2 → "Intermitente" o "No reproducible" (no "confirmado").

### 1.2 Para registrar una MEJORA

Se requieren:

- Captura del problema UX actual
- Qué haría el usuario y qué fricción encuentra (observable)
- Propuesta concreta (sin tocar backend/código)

### 1.3 Clasificación cuando NO hay evidencia suficiente

Si falta cualquiera de los elementos obligatorios, se registra como:

- **"Observación"** (no como bug), o
- **"Pendiente de reproducir"** con condiciones para validarlo.

---

## 2) GENERACIÓN DE CUENTAS DE PRUEBA (obligatorio)

- En cada nueva ejecución, crear una cuenta única:
  - **Email:** `it.qa+YYYYMMDD-HHMMSS@pruebas.local`
  - **Nombre:** `IT QA YYYYMMDD-HHMMSS`
  - **Contraseña:** `Qa2026!Pass`
  
- Mantener un bloque "Credenciales usadas" (sin tokens).

- Si el sistema no acepta `@pruebas.local`, usar:
  - `it.qa+YYYYMMDD-HHMMSS@example.com`

---

## 3) FORMATO DE REGISTRO (obligatorio)

Para cada hallazgo:

```markdown
**[BUG|MEJORA|OBS]-### Título**  
- **Estado:** Confirmado | Intermitente | Pendiente | No reproducible  
- **Severidad:** Bloqueante | Alta | Media | Baja  
- **Área UI:** Registro | Login | Onboarding | Aulas | Grupos/Cursos | Calendario | Usuarios | Otros  
- **Precondiciones (UI):** (solo lo observado)  
- **Pasos (UI):**
  1. …
  2. …
- **Resultado esperado:** …
- **Resultado obtenido:** (texto exacto visible)  
- **Reproducibilidad:** X/Y intentos  
- **Evidencia:** `screenshot-XX.png` + URL  
- **Hipótesis (opcional, no verificada):** …
```

---

## 4) PLAN DE PRUEBAS (UI) — ejecutar en este orden

### A) Acceso inicial

1. Abrir la home.
2. Captura `screenshot-01.png`.
3. Identificar pantalla: Login / Setup / Onboarding / Panel.

### B) Registro (email + contraseña)

1. Ir a "Crear cuenta".
2. Probar validaciones UI:
   - email inválido
   - contraseña corta
   - contraseña sin requisitos (según UI)
   - confirmación distinta
3. Registrar con credenciales de prueba.
4. Captura tras registro / mensaje de éxito.

### C) Login

1. Iniciar sesión con la cuenta creada.
2. Captura de pantalla post-login.

### D) Onboarding (ClassroomPath)

1. Si aparece "Crear mi organización":
   - crear `Centro QA YYYYMMDD`
2. Si aparece "Esperar invitación":
   - entrar, capturar y documentar qué impide continuar.
3. Captura final del estado (si deja entrar al panel).

### E) Aulas

1. Crear `Aula QA 1`
2. Verificar listado.
3. Asignar grupo por defecto (si existe).
4. Editar/Eliminar si UI lo permite.
5. Capturas.

### F) Grupos/Cursos (whitelist)

1. Crear `grupo-qa-1`
2. Añadir dominios desde UI (ej: `wikipedia.org`, `google.com`).
3. Guardar.
4. Refrescar y verificar persistencia.

### G) Calendario/Horario

1. Seleccionar aula.
2. Crear reserva en slot libre eligiendo grupo.
3. Verificar ocupado.
4. Eliminar y verificar libre.
5. Probar conflicto y documentar mensaje.

---

## 5) CONDICIÓN DE PARADA (bloqueos)

Si algo impide continuar:

- Registrar como **BUG Bloqueante** (solo si cumple umbral de evidencia).
- No usar API/DB para "desbloquear".
- Preguntar al usuario qué se espera (p.ej. si hay un "primer admin" preexistente).

---

## 6) ENTREGA FINAL

- "Credenciales usadas" (email/nombre; contraseña solo si se solicita explícitamente)
- Tabla de flujos:

| Flujo | Estado |
|-------|--------|
| Registro | Completado / Bloqueado / No aplica |
| Login | Completado / Bloqueado / No aplica |
| Onboarding | Completado / Bloqueado / No aplica |
| Aulas | Completado / Bloqueado / No aplica |
| Grupos/Cursos | Completado / Bloqueado / No aplica |
| Calendario | Completado / Bloqueado / No aplica |

- Lista de hallazgos (BUG/MEJORA/OBS) con evidencias
- Lista de capturas generadas con descripción breve

---

## 7) EJEMPLO DE REPORTE

### Credenciales usadas

- Email: `it.qa+20260109-164523@pruebas.local`
- Nombre: `IT QA 20260109-164523`

### Tabla de resultados

| Flujo | Estado | Notas |
|-------|--------|-------|
| Registro | Completado | Sin incidencias |
| Login | Completado | Sin incidencias |
| Onboarding | Bloqueado | BUG-001 impide continuar |
| Aulas | No aplica | Bloqueado por BUG-001 |
| Grupos/Cursos | No aplica | Bloqueado por BUG-001 |
| Calendario | No aplica | Bloqueado por BUG-001 |

### Hallazgos

**[BUG-001] No se puede crear aula tras crear organización**  
- **Estado:** Confirmado  
- **Severidad:** Bloqueante  
- **Área UI:** Aulas  
- **Precondiciones (UI):** Usuario registrado, organización creada, en panel principal  
- **Pasos (UI):**
  1. Hacer clic en "Nueva aula"
  2. Rellenar nombre "Aula QA 1"
  3. Hacer clic en "Guardar"
- **Resultado esperado:** El aula se crea y aparece en el listado  
- **Resultado obtenido:** Modal no se cierra, aparece mensaje "Error: Admin access required"  
- **Reproducibilidad:** 2/2 intentos  
- **Evidencia:** `screenshot-05-error-aula.png` + URL `https://classroompath-staging.duckdns.org/#aulas`  
- **Hipótesis (opcional, no verificada):** Posible falta de rol admin en sistema interno

---

## Notas adicionales

- Esta plantilla está diseñada para agentes LLM (Claude, GPT, etc.) que ejecuten pruebas automatizadas con Playwright u otras herramientas de browser automation.
- Puede adaptarse para pruebas manuales eliminando las referencias a agentes.
- Mantener capturas numeradas secuencialmente para facilitar la trazabilidad.
- Si se detectan patrones recurrentes, agregar secciones específicas al plan de pruebas.
