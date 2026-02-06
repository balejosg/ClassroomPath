#!/bin/bash
# Setup test database for E2E tests
# This script creates the classroompath_test database with proper schema and permissions

set -e

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-openpath-postgres}"
DB_USER="${DB_USER:-openpath}"
DB_PASSWORD="${DB_PASSWORD:-openpath_dev}"
TEST_DB="classroompath_test"
TEST_USER="classroompath"
TEST_PASSWORD="classroompath_test"

echo "=== Setting up E2E Test Database ==="

# Check if Docker container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
  echo "ERROR: PostgreSQL container '${POSTGRES_CONTAINER}' is not running"
  echo "Start it with: docker compose up -d"
  exit 1
fi

echo "1. Creating test database '${TEST_DB}' (if not exists)..."
docker exec "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -tc \
  "SELECT 1 FROM pg_database WHERE datname = '${TEST_DB}'" | grep -q 1 || \
  docker exec "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -c \
  "CREATE DATABASE ${TEST_DB} OWNER ${DB_USER};"

echo "2. Creating test user '${TEST_USER}' (if not exists)..."
docker exec "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -tc \
  "SELECT 1 FROM pg_roles WHERE rolname = '${TEST_USER}'" | grep -q 1 || \
  docker exec "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -c \
  "CREATE USER ${TEST_USER} WITH PASSWORD '${TEST_PASSWORD}';"

echo "3. Setting password for '${TEST_USER}'..."
docker exec "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -c \
  "ALTER USER ${TEST_USER} WITH PASSWORD '${TEST_PASSWORD}';"

echo "4. Granting database permissions..."
docker exec "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -c \
  "GRANT ALL PRIVILEGES ON DATABASE ${TEST_DB} TO ${TEST_USER};"

echo "5. Granting schema permissions..."
docker exec "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -d "${TEST_DB}" -c \
  "GRANT ALL ON SCHEMA public TO ${TEST_USER};"

echo "6. Pushing OpenPath schema to test database..."
cd "$(dirname "$0")/../upstream/openpath/api"
DB_HOST=localhost DB_PORT=5432 DB_NAME="${TEST_DB}" DB_USER="${DB_USER}" DB_PASSWORD="${DB_PASSWORD}" \
  npx drizzle-kit push --force

echo "7. Pushing ClassroomPath schema to test database..."
cd "$(dirname "$0")/../api"
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${TEST_DB}" \
  npx drizzle-kit push --force

echo "8. Granting table permissions to test user..."
docker exec "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -d "${TEST_DB}" -c \
  "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${TEST_USER};"
docker exec "${POSTGRES_CONTAINER}" psql -U "${DB_USER}" -d "${TEST_DB}" -c \
  "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${TEST_USER};"

echo ""
echo "=== Test Database Setup Complete ==="
echo "Database: ${TEST_DB}"
echo "User: ${TEST_USER}"
echo "Connection: postgresql://${TEST_USER}:${TEST_PASSWORD}@localhost:5432/${TEST_DB}"
echo ""
echo "Run E2E tests with: npx playwright test"
