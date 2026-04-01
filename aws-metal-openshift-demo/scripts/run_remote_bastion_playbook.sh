#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <playbook-path> [ansible-playbook args...]" >&2
  exit 64
fi

PLAYBOOK_PATH="$1"
shift
EXTRA_ARGS=("$@")
ORIGINAL_ARGS=("$@")
STAGE_ARGS=()

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INVENTORY_PATH="${PROJECT_ROOT}/inventory/hosts.yml"
STAGE_PLAYBOOK="${PROJECT_ROOT}/playbooks/bootstrap/bastion-stage.yml"
BASTION_RUNNER="/opt/openshift/aws-metal-openshift-demo/scripts/run_bastion_playbook.sh"
BASTION_HOST="${BASTION_HOST:-172.16.0.30}"
VALIDATION_SCRIPT="${PROJECT_ROOT}/scripts/validate-orchestration.sh"

if ! command -v ansible-inventory >/dev/null 2>&1; then
  echo "ansible-inventory is required" >&2
  exit 69
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 69
fi

METAL_JSON="$(
  ansible-inventory -i "${INVENTORY_PATH}" --host metal-01
)"

HYPERVISOR_HOST="$(printf '%s' "${METAL_JSON}" | jq -r '.ansible_host')"
HYPERVISOR_USER="$(printf '%s' "${METAL_JSON}" | jq -r '.ansible_user')"
HYPERVISOR_KEY="$(printf '%s' "${METAL_JSON}" | jq -r '.ansible_ssh_private_key_file')"
cd "${PROJECT_ROOT}"

while [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; do
  case "${EXTRA_ARGS[0]}" in
    -e|--extra-vars)
      if [[ ${#EXTRA_ARGS[@]} -lt 2 ]]; then
        echo "missing value for ${EXTRA_ARGS[0]}" >&2
        exit 64
      fi
      STAGE_ARGS+=("${EXTRA_ARGS[0]}" "${EXTRA_ARGS[1]}")
      EXTRA_ARGS=("${EXTRA_ARGS[@]:2}")
      ;;
    *)
      EXTRA_ARGS=("${EXTRA_ARGS[@]:1}")
      ;;
  esac
done

case "${PLAYBOOK_PATH}" in
  playbooks/site-lab.yml)
    STAGE_ARGS+=(
      -e "bastion_stage_require_lab_default_password=true"
      -e "bastion_stage_requires_support_service_rhsm=true"
    )
    ;;
  playbooks/day2/openshift-post-install.yml|playbooks/day2/openshift-post-install-*.yml)
    STAGE_ARGS+=(
      -e "bastion_stage_require_lab_default_password=true"
    )
    ;;
  playbooks/bootstrap/bastion.yml|playbooks/bootstrap/idm.yml|playbooks/lab/mirror-registry.yml|playbooks/lab/mirror-registry-refresh.yml)
    STAGE_ARGS+=(
      -e "bastion_stage_requires_support_service_rhsm=true"
    )
    ;;
esac

"${VALIDATION_SCRIPT}" --playbook "${PLAYBOOK_PATH}" "${ORIGINAL_ARGS[@]}"

ansible-playbook -i "${INVENTORY_PATH}" "${STAGE_PLAYBOOK}" "${STAGE_ARGS[@]}"

exec ssh \
  -i "${HYPERVISOR_KEY}" \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  -o ProxyCommand="ssh -i ${HYPERVISOR_KEY} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${HYPERVISOR_USER}@${HYPERVISOR_HOST} -W %h:%p" \
  "cloud-user@${BASTION_HOST}" \
  "${BASTION_RUNNER}" "${PLAYBOOK_PATH}" "$@"
