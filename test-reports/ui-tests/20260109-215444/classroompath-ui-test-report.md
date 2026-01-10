# Reporte de Pruebas UI - ClassroomPath Staging

**Fecha:** 2026-01-09  
**Hora:** 21:19 CET  
**URL:** https://classroompath-staging.duckdns.org/  
**Tester:** Sisyphus (Automated UI Testing)

---

## Credenciales Usadas

- **Email:** it.qa+20260109-215444@pruebas.local
- **Nombre:** IT QA 20260109-215444
- **Contraseña:** (Qa2026!Pass - solo para registro interno de pruebas)

---

## Tabla de Resultados

| Flujo | Estado | Notas |
|-------|--------|-------|
| **Registro** | ✅ Completado | Validaciones funcionan correctamente |
| **Login** | ⚠️ Bloqueado | BUG-001 impide completar login |
| **Onboarding** | ⚠️ Parcial | BUG-002 al crear organización |
| **Aulas** | ❌ No probado | Bloqueado por BUG-001 |
| **Grupos/Cursos** | ❌ No probado | Bloqueado por BUG-001 |
| **Calendario** | ❌ No probado | Bloqueado por BUG-001 |

---

## Hallazgos

### **[BUG-001] Login se queda en "Autenticando..." indefinidamente después de crear organización**

- **Estado:** Confirmado (2/2 intentos)
- **Severidad:** 🔴 **BLOQUEANTE**
- **Área UI:** Login
- **Precondiciones (UI):**
  1. Usuario recién registrado
  2. Organización creada durante onboarding
  3. Intentar login con credenciales válidas
  
- **Pasos (UI):**
  1. Cerrar sesión o refrescar navegador
  2. Ir a login
  3. Introducir email: `it.qa+20260109-215444@pruebas.local`
  4. Introducir contraseña: `Qa2026!Pass`
  5. Hacer clic en "Acceder al Panel"

- **Resultado esperado:** El usuario accede al panel principal/dashboard

- **Resultado obtenido:**
  - Botón cambia a "Autenticando..." y se queda bloqueado
  - No hay mensaje de error visible en UI
  - Los campos de login quedan deshabilitados
  - No avanza a ninguna pantalla (esperado 10+ segundos)

- **Reproducibilidad:** 2/2 intentos

- **Evidencia:**
  - `screenshot-13-login-stuck.png` - Botón "Autenticando..." bloqueado
  - URL: `https://classroompath-staging.duckdns.org/`
  - **Errores de consola (JavaScript):**
    ```
    [ERROR] Failed to parse stored user
    Invalid enum value. Expected 'admin' | 'teacher' | 'student', received 'openpath-admin'
    Path: roles[0].role
    ```

- **Hipótesis (no verificada):**
  - El backend devuelve el rol `"openpath-admin"` 
  - El frontend solo acepta: `"admin"`, `"teacher"`, `"student"`
  - La validación Zod/TypeScript falla
  - El flujo de autenticación se interrumpe sin mostrar error al usuario
  - Incompatibilidad entre esquema de roles OpenPath (backend) y ClassroomPath (frontend)

---

### **[BUG-002] Error al crear organización pero la organización SÍ se crea**

- **Estado:** Confirmado (1/1 intento exitoso a pesar del error)
- **Severidad:** 🟠 **Alta**
- **Área UI:** Onboarding
- **Precondiciones (UI):**
  1. Usuario recién registrado
  2. Pantalla de onboarding visible
  3. Click en "Crear mi organización"

- **Pasos (UI):**
  1. Hacer clic en botón "Crear organización"
  2. Rellenar nombre: "Centro QA 20260109"
  3. Hacer clic en "Crear organización"

- **Resultado esperado:**
  - Mensaje de éxito
  - Redirección al panel principal
  - Usuario puede acceder a la organización

- **Resultado obtenido:**
  - Mensaje visible en UI: **"Error al crear la organizacion"** (sin tilde en "organización")
  - Error en consola JavaScript: `TypeError: S.saveTokens is not a function`
  - Al intentar de nuevo, error: `User already belongs to an organization`
  - La organización SÍ se creó (confirmado en log de consola)

- **Reproducibilidad:** 1/1 intentos (primera creación mostró error pero funcionó)

- **Evidencia:**
  - `screenshot-12-org-creation-error.png` - Mensaje de error visible
  - URL: `https://classroompath-staging.duckdns.org/`
  - **Errores de consola:**
    ```
    TypeError: S.saveTokens is not a function
    at Object.createOrganization (main-CbNOVzvT.js:1:86004)
    ```
  - **Log de confirmación:**
    ```
    User belongs to org: Centro QA 20260109 as admin
    ```

- **Hipótesis (no verificada):**
  - La organización se crea correctamente en backend
  - Fallo en la función `saveTokens` del frontend
  - El flujo post-creación no se completa
  - El usuario queda en estado inconsistente (tiene org pero UI no lo refleja)

---

### **[BUG-003] Usuario queda atrapado en pantalla de onboarding después de crear organización**

- **Estado:** Confirmado
- **Severidad:** 🟠 **Alta**
- **Área UI:** Onboarding / Navegación
- **Precondiciones (UI):**
  1. BUG-002 ocurrió (error al crear org)
  2. Usuario pertenece a organización (confirmado en consola)

- **Pasos (UI):**
  1. Después de BUG-002, refrescar navegador (F5)
  2. Observar pantalla

- **Resultado esperado:**
  - Usuario es redirigido automáticamente al dashboard
  - O se muestra acceso a funcionalidades de la organización

- **Resultado obtenido:**
  - Usuario permanece en pantalla de onboarding
  - Opciones "Crear organización" y "Esperar invitación" siguen visibles
  - Al intentar cualquier acción: error "User already belongs to an organization"
  - Navegación manual a `#dashboard` no funciona

- **Reproducibilidad:** 1/1 intentos

- **Evidencia:**
  - Screenshot muestra pantalla de onboarding persistente
  - URL: `https://classroompath-staging.duckdns.org/`
  - Intentos de navegación manual no funcionan

- **Hipótesis (no verificada):**
  - La lógica de routing no detecta que el usuario ya tiene organización
  - Falta sincronización entre estado del backend y frontend
  - El onboarding no comprueba estado real del usuario al cargar

---

### **[VALIDACIÓN-OK] Validaciones de formulario de registro funcionan correctamente**

- **Estado:** ✅ Completado sin problemas
- **Área UI:** Registro

**Validaciones probadas:**

1. ✅ **Email inválido:** Muestra "Introduce un email válido" (screenshot-07)
2. ✅ **Contraseña corta:** Muestra "Mínimo 8 caracteres", indicador "Débil" (screenshot-08)
3. ✅ **Contraseña sin requisitos:** Muestra "Debe incluir mayúscula, minúscula y número"
4. ✅ **Contraseñas no coinciden:** Muestra "Las contraseñas no coinciden" (screenshot-09)
5. ✅ **Requisitos visuales:** Lista de checks ✓/✗ actualiza en tiempo real
6. ✅ **Fuerza de contraseña:** Indicador cambia de "Débil" a "Fuerte"
7. ✅ **Botón deshabilitado:** "Crear cuenta" solo se habilita con datos válidos

**Creación de cuenta:**
- ✅ Cuenta creada exitosamente
- ✅ Mensaje: "Cuenta creada correctamente"
- ✅ Redirección automática a pantalla de onboarding (screenshot-10, screenshot-11)

---

## Capturas de Pantalla Generadas

| # | Archivo | Descripción |
|---|---------|-------------|
| 01 | `screenshot-01-home.png` | Pantalla inicial con sesión previa |
| 02 | `screenshot-02-login-screen.png` | Login después de logout |
| 03 | `screenshot-03-after-scroll.png` | Vista completa login |
| 04 | `screenshot-04-register-forced.png` | Intento de forzar registro (pantalla negra) |
| 05 | `screenshot-05-login-with-register-link.png` | Login con link "Crear cuenta" visible |
| 06 | `screenshot-06-register-screen.png` | Formulario de registro completo |
| 07 | `screenshot-07-email-validation.png` | Validación email inválido |
| 08 | `screenshot-08-password-short-validation.png` | Validación contraseña corta |
| 09 | `screenshot-09-password-mismatch.png` | Validación contraseñas no coinciden |
| 10 | `screenshot-10-account-created.png` | Mensaje "Cuenta creada correctamente" + onboarding |
| 11 | `screenshot-11-onboarding-screen.png` | Pantalla onboarding ClassroomPath |
| 12 | `screenshot-12-org-creation-error.png` | Error al crear organización |
| 13 | `screenshot-13-login-stuck.png` | Login bloqueado en "Autenticando..." |

---

## Observaciones Adicionales

### **[OBS-001] Link "Crear cuenta" inicialmente oculto**

- **Descripción:** En la primera carga, el link "Crear cuenta" tiene clase CSS `hidden`
- **Impacto:** Usuarios podrían no saber cómo registrarse
- **Workaround observado:** Después de refrescar, el link aparece visible
- **Severidad:** 🟡 Baja (resuelto con refresh)

### **[OBS-002] Errores de consola de validación DOM**

- **Descripción:**
  ```
  [DOM] Password field is not contained in a form
  [DOM] Input elements should have autocomplete attributes
  ```
- **Impacto:** Advertencias de accesibilidad y mejores prácticas
- **Severidad:** 🟡 Baja (no afecta funcionalidad)

### **[OBS-003] Término "organizacion" sin tilde**

- **Descripción:** Mensaje de error usa "organizacion" en vez de "organización"
- **Impacto:** Inconsistencia ortográfica
- **Severidad:** 🟢 Muy baja (cosmético)

---

## Resumen Ejecutivo

### ✅ Funciona correctamente:
- Formulario de registro con validaciones exhaustivas
- Creación de cuenta de usuario
- Redirección a onboarding

### ⚠️ Funciona con errores:
- Creación de organización (funciona pero muestra error)
- Onboarding (queda atrapado después de crear org)

### ❌ No funciona (BLOQUEANTE):
- **Login después de crear organización**
  - Causa: Incompatibilidad de roles `openpath-admin` vs `admin|teacher|student`
  - Impacto: **Imposible acceder al sistema después de registro completo**
  - Flujos bloqueados: Aulas, Grupos, Calendario, toda gestión

### Impacto en Testing:
**No fue posible completar las pruebas de las secciones E, F, G del plan de pruebas debido a BUG-001 bloqueante.**

---

## Siguiente Pasos Recomendados

1. **URGENTE:** Corregir incompatibilidad de roles (BUG-001)
   - Alinear roles entre OpenPath y ClassroomPath
   - Opciones:
     - Backend devuelve `"admin"` en vez de `"openpath-admin"`
     - Frontend acepta `"openpath-admin"` en el enum de validación
     - Mapeo de roles en capa intermedia

2. **ALTA PRIORIDAD:** Corregir flujo de creación de organización (BUG-002)
   - Verificar función `saveTokens` existe y es accesible
   - Manejo correcto de respuesta post-creación
   - Redirección automática al dashboard

3. **ALTA PRIORIDAD:** Resolver estado atrapado en onboarding (BUG-003)
   - Comprobar estado de membresía al cargar onboarding
   - Redirigir automáticamente si usuario ya tiene organización

4. **Re-testing:** Una vez corregidos BUG-001, BUG-002, BUG-003:
   - Completar secciones E (Aulas), F (Grupos), G (Calendario)
   - Verificar flujo end-to-end completo

---

**Nota:** Este reporte se generó siguiendo estrictamente las reglas de `ui-only-test-template.md`:
- ✅ Solo se usó la UI web (navegación, clicks, formularios)
- ✅ No se accedió a API, DB, código fuente, o logs del servidor
- ✅ Hipótesis sobre causas internas se etiquetan como "no verificadas"
- ✅ Todos los BUGs tienen evidencia visual y pasos reproducibles
