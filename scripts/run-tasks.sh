#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Usage:
  $(basename "$0") <task-id> [task-id...]   Run specific tasks
  $(basename "$0") -n <count>               Run next N ready tasks
  $(basename "$0") --all                    Run all ready tasks

Options:
  -n, --count <N>   Number of ready tasks to pick (by priority)
  --all             Run all ready tasks
  --continue        Continue to next task on failure (default: stop)
  --dry-run         Show which tasks would run without executing
  -h, --help        Show this help

Examples:
  $(basename "$0") PGN-0f5 PGN-e1f PGN-r99
  $(basename "$0") -n 3
  $(basename "$0") --all --dry-run
  $(basename "$0") -n 5 --continue
EOF
  exit 0
}

DRY_RUN=false
CONTINUE_ON_FAIL=false
TASK_IDS=()
COUNT=0
ALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    --dry-run) DRY_RUN=true; shift ;;
    --all) ALL=true; shift ;;
    --continue) CONTINUE_ON_FAIL=true; shift ;;
    -n|--count)
      COUNT="$2"
      shift 2
      ;;
    -*)
      echo "Error: unknown option: $1" >&2
      echo "Run $(basename "$0") --help for usage" >&2
      exit 1
      ;;
    *) TASK_IDS+=("$1"); shift ;;
  esac
done

# Resolve task list
if [[ ${#TASK_IDS[@]} -gt 0 ]]; then
  # Explicit task IDs provided
  :
elif [[ "$ALL" == true ]] || [[ "$COUNT" -gt 0 ]]; then
  echo "Fetching ready tasks..."
  readarray -t TASK_IDS < <(bd ready --json 2>/dev/null | jq -r '.[].id')
  if [[ "$ALL" == false ]] && [[ "$COUNT" -gt 0 ]]; then
    TASK_IDS=("${TASK_IDS[@]:0:$COUNT}")
  fi
else
  echo "Error: provide task IDs, -n <count>, or --all" >&2
  echo "Run $(basename "$0") --help for usage" >&2
  exit 1
fi

if [[ ${#TASK_IDS[@]} -eq 0 ]]; then
  echo "No tasks to run."
  exit 0
fi

echo "Tasks to run (${#TASK_IDS[@]}):"
for id in "${TASK_IDS[@]}"; do
  echo "  - $id"
done
echo ""

if [[ "$DRY_RUN" == true ]]; then
  echo "(dry run — exiting)"
  exit 0
fi

PASSED=0
FAILED=0
SKIPPED=0
FAILED_IDS=()

for id in "${TASK_IDS[@]}"; do
  echo "=========================================="
  echo "Task: $id  [$(( PASSED + FAILED + 1 ))/${#TASK_IDS[@]}]"
  echo "=========================================="

  if claude -p "/do $id — after completing the task, commit changes with a descriptive message"; then
    PASSED=$((PASSED + 1))
    echo "  ✓ $id completed"
  else
    FAILED=$((FAILED + 1))
    FAILED_IDS+=("$id")
    echo "  ✗ $id FAILED"

    if [[ "$CONTINUE_ON_FAIL" == false ]]; then
      SKIPPED=$(( ${#TASK_IDS[@]} - PASSED - FAILED ))
      echo "Stopping on failure. Use --continue to keep going."
      break
    fi
  fi

  echo ""
done

echo "=========================================="
echo "Results: $PASSED passed, $FAILED failed, $SKIPPED skipped (${#TASK_IDS[@]} total)"
if [[ ${#FAILED_IDS[@]} -gt 0 ]]; then
  echo "Failed: ${FAILED_IDS[*]}"
  exit 1
fi
