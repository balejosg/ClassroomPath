#!/bin/bash
set -e

BASE_URL="${1:-https://classroompath-staging.duckdns.org}"

echo "=== Multi-Tenancy Isolation Test ==="
echo "Target: $BASE_URL"
echo

# Test 1: Health check
echo "Test 1: Gateway Health Check"
HEALTH=$(curl -sf "$BASE_URL/cp/health")
echo "✅ Health: $HEALTH"
echo

# Test 2: Create Organization A
echo "Test 2: Create Organization A"
echo "Manual step required:"
echo "1. Open $BASE_URL in browser"
echo "2. Login as User A"
echo "3. Create 'Organization Alpha'"
echo "4. Create a classroom 'Math 101'"
echo

# Test 3: Verify Organization B cannot see Organization A's data
echo "Test 3: Isolation Verification"
echo "Manual step required:"
echo "1. Open $BASE_URL in incognito/private window"
echo "2. Login as User B (different Google account)"
echo "3. Create 'Organization Beta'"
echo "4. Verify classroom 'Math 101' is NOT visible"
echo

echo "Expected result: User B should NOT see any classrooms from Organization A"
echo "=== Test Complete ==="
