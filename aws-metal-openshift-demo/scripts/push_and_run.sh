#!/usr/bin/env bash
# push_and_run.sh — lightweight sync-and-run for iterative development.
#
# Rsyncs the local project tree to the bastion as cloud-user, runs the
# specified playbook in a blocking foreground SSH session, then shows
# only the PLAY RECAP on success or the full output on failure.
#
# Usage:
#   ./scripts/push_and_run.sh playbooks/day2/openshift-post-install-infra.yml
#   ./scripts/push_and_run.sh playbooks/day2/openshift-post-install-infra.yml -e some_var=true
#
# Environment:
#   JUMP_HOST        — SSH ProxyJump host (default: ec2-user@REPLACE_WITH_VIRT01_ELASTIC_IP)
#   BASTION_USER     — User on the bastion (default: cloud-user)
#   BASTION_HOST     — Bastion FQDN (default: bastion-01.workshop.lan)
#   BASTION_PROJECT  — Remote project root (default: /opt/openshift/aws-metal-openshift-demo)

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <playbook-path> [ansible-playbook args...]" >&2
  exit 64
fi

PLAYBOOK_PATH="$1"
shift

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JUMP_HOST="${JUMP_HOST:-ec2-user@REPLACE_WITH_VIRT01_ELASTIC_IP}"
BASTION_USER="${BASTION_USER:-cloud-user}"
BASTION_HOST="${BASTION_HOST:-bastion-01.workshop.lan}"
BASTION_PROJECT="${BASTION_PROJECT:-/opt/openshift/aws-metal-openshift-demo}"
REMOTE_LOG="/tmp/push-and-run-$$.log"
SSH_OPTS=(-J "${JUMP_HOST}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)

# --- Phase 1: rsync only changed files ---------------------------------
echo "==> Syncing project to ${BASTION_USER}@${BASTION_HOST}:${BASTION_PROJECT}"
rsync -rltz \
  --no-owner --no-group --no-perms \
  --exclude='generated/' \
  --exclude='.git/' \
  --exclude='__pycache__/' \
  --exclude='inventory/' \
  --exclude='secrets/' \
  -e "ssh ${SSH_OPTS[*]}" \
  "${PROJECT_ROOT}/" \
  "${BASTION_USER}@${BASTION_HOST}:${BASTION_PROJECT}/"

echo "==> Sync complete"

# --- Phase 2: run the playbook (blocking, foreground) -------------------
echo "==> Running: ansible-playbook ${PLAYBOOK_PATH} $*"
rc=0
ssh "${SSH_OPTS[@]}" "${BASTION_USER}@${BASTION_HOST}" \
  "cd ${BASTION_PROJECT} && \
   ANSIBLE_COLLECTIONS_PATH=/usr/share/ansible/collections \
   ansible-playbook -i inventory/hosts.yml ${PLAYBOOK_PATH} $*" \
  > "${REMOTE_LOG}" 2>&1 || rc=$?

# --- Phase 3: report ---------------------------------------------------
RECAP=$(grep -A 20 '^PLAY RECAP' "${REMOTE_LOG}" || true)

if [[ ${rc} -eq 0 ]]; then
  echo ""
  echo "==> SUCCESS"
  echo "${RECAP}"
else
  echo ""
  echo "==> FAILED (rc=${rc})"
  echo ""
  cat "${REMOTE_LOG}"
fi

rm -f "${REMOTE_LOG}"
exit ${rc}
