#!/usr/bin/env bash
# Quick API testing script for contextus daemon
# Usage: ./scripts/test-api.sh [endpoint]

set -euo pipefail

PORT=${CONTEXTUS_PORT:-37800}
BASE="http://localhost:${PORT}"
PROJECT="$(basename "${PWD}")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

function test_health() {
  echo -e "${YELLOW}=== GET /health ===${NC}"
  curl -s "${BASE}/health" | jq .
}

function test_health_probe() {
  echo -e "${YELLOW}=== GET /health?probe=true ===${NC}"
  curl -s "${BASE}/health?probe=true" | jq .
}

function test_novelty() {
  echo -e "${YELLOW}=== GET /novelty ===${NC}"
  curl -s "${BASE}/novelty?project=${PROJECT}" | jq .
}

function test_introspect() {
  echo -e "${YELLOW}=== GET /introspect ===${NC}"
  curl -s "${BASE}/introspect?project=${PROJECT}" | jq .
}

function test_query() {
  local prompt="${1:-How does the daemon work?}"
  echo -e "${YELLOW}=== POST /query ===${NC}"
  echo "Prompt: ${prompt}"
  curl -s -X POST "${BASE}/query" \
    -H "Content-Type: application/json" \
    -d "{\"project\":\"${PROJECT}\",\"prompt\":\"${prompt}\"}" \
    | jq -r '.hookSpecificOutput.additionalContext // "No injection"'
}

function test_capture() {
  echo -e "${YELLOW}=== POST /capture ===${NC}"
  curl -s -X POST "${BASE}/capture" \
    -H "Content-Type: application/json" \
    -d "{\"category\":\"reference\",\"slug\":\"test-capture-endpoint\",\"description\":\"Test capture via API\",\"body\":\"This is a test capture created by test-api.sh.\\n\\nIt should be cleaned up after testing.\",\"cwd\":\"${PWD}\",\"project\":\"${PROJECT}\"}" \
    | jq .
  echo -e "${GREEN}(Remember to delete .claude/context/reference/reference-test-capture-endpoint.md after testing)${NC}"
}

function test_capture_validation() {
  echo -e "${YELLOW}=== POST /capture (missing fields) ===${NC}"
  curl -s -X POST "${BASE}/capture" \
    -H "Content-Type: application/json" \
    -d "{\"category\":\"gotcha\"}" \
    | jq .
}

function test_all() {
  test_health
  echo
  test_novelty
  echo
  test_introspect
  echo
  test_query "How does logging work?"
}

# Parse command
case "${1:-all}" in
  health)
    test_health
    ;;
  health-probe)
    test_health_probe
    ;;
  novelty)
    test_novelty
    ;;
  introspect)
    test_introspect
    ;;
  query)
    test_query "${2:-How does the daemon work?}"
    ;;
  capture)
    test_capture
    ;;
  capture-validation)
    test_capture_validation
    ;;
  all)
    test_all
    ;;
  *)
    echo "Usage: $0 [health|health-probe|novelty|introspect|query|all]"
    echo "Examples:"
    echo "  $0 health"
    echo "  $0 query 'How does configuration work?'"
    echo "  $0 all"
    exit 1
    ;;
esac
