#!/bin/bash
# ClassroomPath Gateway Database Migrations
# This script runs database migrations BEFORE docker deployment
# to avoid needing dev dependencies in production containers.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
API_DIR="$PROJECT_ROOT/api"

echo "🔄 Running ClassroomPath Gateway database migrations..."
echo "   Project root: $PROJECT_ROOT"
echo "   API directory: $API_DIR"

# Check if we're in the right directory
if [ ! -f "$API_DIR/package.json" ]; then
    echo "❌ Error: Cannot find api/package.json"
    echo "   Expected at: $API_DIR/package.json"
    exit 1
fi

# Load environment variables
if [ -f "$PROJECT_ROOT/config/.env" ]; then
    echo "📄 Loading environment from config/.env"
    export $(grep -v '^#' "$PROJECT_ROOT/config/.env" | xargs)
else
    echo "⚠️  Warning: config/.env not found, using existing environment"
fi

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ Error: DATABASE_URL environment variable is not set"
    exit 1
fi

echo "✅ DATABASE_URL is configured"

# Install dependencies if node_modules doesn't exist
cd "$API_DIR"
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm ci
else
    echo "✅ Dependencies already installed"
fi

# Run migrations
echo "🚀 Running drizzle-kit push..."
npm run db:push

echo "✅ Migrations completed successfully!"
