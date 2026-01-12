# Problema: Botón de Login con Google No Aparece

## Diagnóstico ✅ COMPLETADO

### Problema Reportado
El botón de login con Google ha desaparecido de las páginas de identificación y registro tras los cambios de multi-tenancy.

### Causa Raíz Identificada
**El código está correcto**. El problema es de **configuración**: falta la variable de entorno `GOOGLE_CLIENT_ID` en el servidor.

### Evidencia

#### Test Ejecutado
```bash
node test-google-button.js
```

#### Resultado
```
❌ Botón de Google encontrado: 0 elementos
❌ PROBLEMA: El botón de Google NO se renderizó
Contenido del contenedor: ""

CONSOLE: [2026-01-12T11:18:10.066Z] [WARN] Google Client ID not configured
```

### Verificación de Código

#### 1. Contenedores HTML ✅
```html
<!-- Login Screen -->
<div id="google-signin-btn" class="google-btn-container"></div>

<!-- Register Screen -->
<div id="google-signup-btn" class="google-btn-container"></div>
```

Los contenedores existen en ambas pantallas.

#### 2. Lógica de Renderizado ✅
```typescript
// cp-init.ts línea 413-418
export async function init(): Promise<void> {
    if (!auth.isAuthenticated()) {
        setupRegisterUI();        // Configura UI de registro
        await openpathInit();      // Renderiza botón de Google
        return;
    }
}
```

El flujo es correcto:
1. `setupRegisterUI()` configura event listeners
2. `openpathInit()` llama a `googleAuth.renderButton()`

#### 3. OpenPath Code ✅
```typescript
// openpath/spa/src/modules/app-core.ts líneas 62-65
const configLoaded = await googleAuth.loadConfig();
if (configLoaded) {
    await googleAuth.renderButton('google-signin-btn');
}
```

OpenPath intenta cargar la configuración y renderizar el botón, pero `configLoaded` es `false` porque falta `GOOGLE_CLIENT_ID`.

---

## Solución Requerida

### Variable de Entorno Faltante

**Archivo**: `config/.env` (en el servidor)

**Variable Requerida**:
```bash
GOOGLE_CLIENT_ID=<tu-google-client-id>.apps.googleusercontent.com
```

### Dónde Obtener el Google Client ID

1. Ir a [Google Cloud Console](https://console.cloud.google.com/)
2. Seleccionar proyecto ClassroomPath (o crear uno nuevo)
3. Ir a **APIs & Services** → **Credentials**
4. Crear **OAuth 2.0 Client ID** (tipo: Web application)
5. Configurar **Authorized JavaScript origins**:
   - `https://classroompath-staging.duckdns.org`
   - `https://classroompath.duckdns.org`
6. Configurar **Authorized redirect URIs**:
   - `https://classroompath-staging.duckdns.org/auth/callback`
   - `https://classroompath.duckdns.org/auth/callback`
7. Copiar el **Client ID** generado

### Aplicar la Configuración

#### Staging (CT 114)
```bash
ssh root@192.168.1.150
pct exec 114 -- su -
cd /opt/classroompath/app/config
echo "GOOGLE_CLIENT_ID=<tu-client-id>" >> .env

# Reiniciar contenedor Gateway
cd /opt/classroompath/app/docker
docker compose restart gateway
```

#### Production (CT 111)
```bash
pct exec 111 -- su -
cd /opt/classroompath/app/config
echo "GOOGLE_CLIENT_ID=<tu-client-id>" >> .env
cd /opt/classroompath/app/docker
docker compose restart gateway
```

---

## Verificación Post-Configuración

Después de agregar `GOOGLE_CLIENT_ID`:

```bash
# Verificar que se cargó
curl -sf https://classroompath-staging.duckdns.org/

# Ejecutar test automatizado
node test-google-button.js
```

**Resultado Esperado**:
```
✅ Botón de Google encontrado: 1 elementos
✅ Botón en registro: 1 elementos
✅ RESULTADO FINAL: Ambos botones funcionan correctamente
```

---

## Resumen

| Aspecto | Estado |
|---------|--------|
| **Código SPA** | ✅ Correcto |
| **Contenedores HTML** | ✅ Presentes |
| **Lógica de renderizado** | ✅ Correcta |
| **Variable de entorno** | ❌ Faltante |

**Acción Requerida**: Configurar `GOOGLE_CLIENT_ID` en el archivo `.env` del servidor.

**Impacto**: Hasta que se configure, los usuarios NO podrán usar login con Google (solo email/password).

---

## Archivos Modificados (Commit 55864d2)

```
spa/src/cp-init.ts
  - Reordenado: setupRegisterUI() antes de openpathInit()
  - Añadido setTimeout para renderizado de botón en registro
```

**Estos cambios NO causaron el problema**. El problema ya existía (falta de configuración de Google OAuth).

---

**Estado**: ✅ **DIAGNOSTICADO** - Esperando configuración de Google Client ID
