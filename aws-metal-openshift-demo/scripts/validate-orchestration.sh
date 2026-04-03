#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INVENTORY_PATH="${PROJECT_ROOT}/inventory/hosts.yml"
PRECHECK_PLAYBOOK="${PROJECT_ROOT}/playbooks/validate/orchestration-preflight.yml"
SCOPED_CONTRACTS_PLAYBOOK="${PROJECT_ROOT}/playbooks/validate/scoped-var-contracts.yml"
TARGET_PLAYBOOK=""
EXTRA_ARGS=()
TOP_LEVEL_PLAYBOOKS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --playbook)
      if [[ $# -lt 2 ]]; then
        echo "missing value for --playbook" >&2
        exit 64
      fi
      TARGET_PLAYBOOK="$2"
      shift 2
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ -n "${TARGET_PLAYBOOK}" ]]; then
  TOP_LEVEL_PLAYBOOKS=(
    "${PROJECT_ROOT}/playbooks/bootstrap/bastion-stage.yml"
    "${PROJECT_ROOT}/${TARGET_PLAYBOOK}"
  )
else
  while IFS= read -r -d '' playbook_path; do
    TOP_LEVEL_PLAYBOOKS+=("${playbook_path}")
  done < <(
    find "${PROJECT_ROOT}/playbooks" -type f \( -name '*.yml' -o -name '*.yaml' \) \
      ! -path '*/tasks/*' -print0 | sort -z
  )
fi

echo "==> Parsing YAML sources"
python3 - "${PROJECT_ROOT}" <<'PY'
import sys
from pathlib import Path

import yaml

project_root = Path(sys.argv[1])
yaml_roots = ("inventory", "playbooks", "roles", "vars")
failures = []

for root_name in yaml_roots:
    root = project_root / root_name
    if not root.exists():
        continue
    for path in sorted(root.rglob("*")):
        if path.suffix not in (".yml", ".yaml"):
            continue
        try:
            yaml.safe_load(path.read_text())
        except Exception as exc:  # pragma: no cover - CLI validation
            failures.append(f"{path}: {exc}")

if failures:
    print("YAML parsing failed for:")
    for failure in failures:
        print(f"  - {failure}")
    sys.exit(1)

print("YAML parsing succeeded.")
PY

echo "==> Checking shell script syntax"
while IFS= read -r -d '' shell_script; do
  bash -n "${shell_script}"
done < <(find "${PROJECT_ROOT}/scripts" -type f -name '*.sh' -print0 | sort -z)

if command -v shellcheck >/dev/null 2>&1; then
  echo "==> Running shellcheck"
  while IFS= read -r -d '' shell_script; do
    shellcheck -S warning -e SC2029,SC2034 "${shell_script}"
  done < <(find "${PROJECT_ROOT}/scripts" -type f -name '*.sh' -print0 | sort -z)
else
  echo "==> shellcheck not installed; skipping"
fi

if command -v yamllint >/dev/null 2>&1; then
  echo "==> Running yamllint"
  yamllint -c "${PROJECT_ROOT}/.yamllint" \
    "${PROJECT_ROOT}/inventory" \
    "${PROJECT_ROOT}/playbooks" \
    "${PROJECT_ROOT}/roles" \
    "${PROJECT_ROOT}/vars"
else
  echo "==> yamllint not installed; skipping"
fi

if command -v ansible-lint >/dev/null 2>&1; then
  echo "==> Running ansible-lint (advisory)"
  if ! ansible-lint "${PROJECT_ROOT}"; then
    echo "ansible-lint reported existing repo issues; continuing because lint is advisory in this validation path." >&2
  fi
else
  echo "==> ansible-lint not installed; skipping"
fi

echo "==> Running ansible syntax checks"
for playbook_path in "${TOP_LEVEL_PLAYBOOKS[@]}"; do
  ansible-playbook -i "${INVENTORY_PATH}" "${playbook_path}" --syntax-check "${EXTRA_ARGS[@]}"
done

echo "==> Running orchestration preflight"
ansible-playbook \
  -i "${INVENTORY_PATH}" \
  "${PRECHECK_PLAYBOOK}" \
  -e "validate_target_playbook=${TARGET_PLAYBOOK}" \
  "${EXTRA_ARGS[@]}"

echo "==> Running scoped play contract checks"
ansible-playbook \
  -i "${INVENTORY_PATH}" \
  "${SCOPED_CONTRACTS_PLAYBOOK}" \
  -e "validate_target_playbook=${TARGET_PLAYBOOK}" \
  "${EXTRA_ARGS[@]}"

echo "Validation complete."
