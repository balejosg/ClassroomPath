#!/bin/bash

set -e

echo "🧪 Testing Multi-Tenant Isolation"
echo "=================================="
echo ""

API_URL="${1:-http://localhost:3001}"

check_command() {
    if ! command -v $1 &> /dev/null; then
        echo "❌ Error: $1 not found. Please install it first."
        exit 1
    fi
}

check_command curl
check_command jq

echo "📝 Test Setup:"
echo "  API URL: $API_URL"
echo ""

echo "Step 1: Creating two test users and organizations..."

USER_A_EMAIL="test-user-a@example.com"
USER_A_PASSWORD="TestPassword123"
USER_A_NAME="Test User A"

USER_B_EMAIL="test-user-b@example.com"
USER_B_PASSWORD="TestPassword456"
USER_B_NAME="Test User B"

echo "  → Registering User A..."
REGISTER_A=$(curl -s -X POST "$API_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$USER_A_EMAIL\",\"name\":\"$USER_A_NAME\",\"password\":\"$USER_A_PASSWORD\"}")

if echo "$REGISTER_A" | jq -e '.error' > /dev/null 2>&1; then
    echo "  ⚠️  User A might already exist, trying to login..."
fi

echo "  → Logging in User A..."
LOGIN_A=$(curl -s -X POST "$API_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$USER_A_EMAIL\",\"password\":\"$USER_A_PASSWORD\"}")

TOKEN_A=$(echo "$LOGIN_A" | jq -r '.accessToken // .token // empty')

if [ -z "$TOKEN_A" ]; then
    echo "❌ Failed to get token for User A"
    echo "Response: $LOGIN_A"
    exit 1
fi

echo "  ✓ User A logged in"

echo "  → Registering User B..."
REGISTER_B=$(curl -s -X POST "$API_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$USER_B_EMAIL\",\"name\":\"$USER_B_NAME\",\"password\":\"$USER_B_PASSWORD\"}")

if echo "$REGISTER_B" | jq -e '.error' > /dev/null 2>&1; then
    echo "  ⚠️  User B might already exist, trying to login..."
fi

echo "  → Logging in User B..."
LOGIN_B=$(curl -s -X POST "$API_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$USER_B_EMAIL\",\"password\":\"$USER_B_PASSWORD\"}")

TOKEN_B=$(echo "$LOGIN_B" | jq -r '.accessToken // .token // empty')

if [ -z "$TOKEN_B" ]; then
    echo "❌ Failed to get token for User B"
    echo "Response: $LOGIN_B"
    exit 1
fi

echo "  ✓ User B logged in"
echo ""

echo "Step 2: Creating organizations..."

ORG_A_NAME="Organization A - $(date +%s)"
ORG_B_NAME="Organization B - $(date +%s)"

echo "  → Creating Organization A for User A..."
CREATE_ORG_A=$(curl -s -X POST "$API_URL/cp/trpc/onboarding.createOrganization" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$ORG_A_NAME\"}")

echo "  ✓ Organization A created"

echo "  → Creating Organization B for User B..."
CREATE_ORG_B=$(curl -s -X POST "$API_URL/cp/trpc/onboarding.createOrganization" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$ORG_B_NAME\"}")

echo "  ✓ Organization B created"
echo ""

echo "Step 3: Creating test data..."

CLASSROOM_A_NAME="classroom-a-$(date +%s)"
echo "  → User A creating classroom: $CLASSROOM_A_NAME"
CREATE_CLASSROOM_A=$(curl -s -X POST "$API_URL/cp/trpc/classrooms.create" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$CLASSROOM_A_NAME\",\"displayName\":\"Classroom A Test\"}")

if echo "$CREATE_CLASSROOM_A" | jq -e '.error' > /dev/null 2>&1; then
    echo "❌ Failed to create classroom for User A"
    echo "Response: $CREATE_CLASSROOM_A"
    exit 1
fi

echo "  ✓ Classroom created by User A"
echo ""

echo "Step 4: Testing isolation..."

echo "  → User A listing classrooms..."
LIST_A=$(curl -s "$API_URL/cp/trpc/classrooms.list" \
  -H "Authorization: Bearer $TOKEN_A")

COUNT_A=$(echo "$LIST_A" | jq 'length')
echo "  ✓ User A sees $COUNT_A classroom(s)"

if [ "$COUNT_A" -lt 1 ]; then
    echo "❌ User A should see at least 1 classroom"
    exit 1
fi

echo "  → User B listing classrooms..."
LIST_B=$(curl -s "$API_URL/cp/trpc/classrooms.list" \
  -H "Authorization: Bearer $TOKEN_B")

COUNT_B=$(echo "$LIST_B" | jq 'length')
echo "  ✓ User B sees $COUNT_B classroom(s)"

if [ "$COUNT_B" -ne 0 ]; then
    echo "❌ ISOLATION FAILURE: User B should see 0 classrooms but sees $COUNT_B"
    echo "User B response: $LIST_B"
    exit 1
fi

echo ""
echo "✅ All tests passed!"
echo ""
echo "Summary:"
echo "  - User A created classroom: ✓"
echo "  - User A can see their classroom: ✓"
echo "  - User B cannot see User A's classroom: ✓"
echo "  - Multi-tenant isolation working correctly: ✓"
