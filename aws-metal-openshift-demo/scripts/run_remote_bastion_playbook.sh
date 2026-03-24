#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <playbook-path> [ansible-playbook args...]" >&2
  exit 64
fi

PLAYBOOK_PATH="$1"
shift

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INVENTORY_PATH="${PROJECT_ROOT}/inventory/hosts.yml"
STAGE_PLAYBOOK="${PROJECT_ROOT}/playbooks/bootstrap/bastion-stage.yml"
BASTION_RUNNER="/opt/openshift/aws-metal-openshift-demo/scripts/run_bastion_playbook.sh"
BASTION_HOST="${BASTION_HOST:-172.16.0.30}"

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

ansible-playbook -i "${INVENTORY_PATH}" "${STAGE_PLAYBOOK}"

exec ssh \
  -i "${HYPERVISOR_KEY}" \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  -o ProxyCommand="ssh -i ${HYPERVISOR_KEY} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${HYPERVISOR_USER}@${HYPERVISOR_HOST} -W %h:%p" \
  "cloud-user@${BASTION_HOST}" \
  "${BASTION_RUNNER}" "${PLAYBOOK_PATH}" "$@"
