#!/bin/bash

echo "========================================="
echo "ClassroomPath Multi-Tenancy Quick Deploy"
echo "========================================="
echo ""
echo "Este script te guiará por los pasos de despliegue"
echo ""

read -p "¿Estás listo para comenzar? (y/n): " ready
if [ "$ready" != "y" ]; then
    echo "Abortado."
    exit 0
fi

echo ""
echo "Paso 1: Aplicando migración de base de datos..."
cd api
npx drizzle-kit push
if [ $? -ne 0 ]; then
    echo "❌ Error al aplicar migración. Abortando."
    exit 1
fi
echo "✅ Migración aplicada"

echo ""
echo "Paso 2: Instalando dependencias..."
npm install
if [ $? -ne 0 ]; then
    echo "❌ Error al instalar dependencias. Abortando."
    exit 1
fi
echo "✅ Dependencias instaladas"

echo ""
echo "Paso 3: Compilando TypeScript..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Error al compilar. Abortando."
    exit 1
fi
echo "✅ Compilación exitosa"

cd ..

echo ""
echo "Paso 4: Construyendo SPA..."
cd spa
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Error al construir SPA. Abortando."
    exit 1
fi
echo "✅ SPA construido"

cd ..

echo ""
echo "========================================="
echo "✅ Build completado exitosamente!"
echo "========================================="
echo ""
echo "Próximos pasos:"
echo ""
echo "STAGING (automático):"
echo "  git add ."
echo "  git commit -m 'feat: implement multi-tenancy isolation'"
echo "  git push origin main"
echo ""
echo "PRODUCCIÓN (automático):"
echo "  git tag v1.1.0"
echo "  git push origin v1.1.0"
echo ""
echo "VERIFICAR AISLAMIENTO:"
echo "  ./test-multitenancy.sh https://classroompath-staging.duckdns.org"
echo ""
echo "Ver DEPLOYMENT_GUIDE.md para más detalles"
