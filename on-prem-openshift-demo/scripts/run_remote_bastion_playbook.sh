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
BASTION_RUNNER="/opt/openshift/on-prem-openshift-demo/scripts/run_bastion_playbook.sh"
BASTION_HOST="${BASTION_HOST:-172.16.0.30}"
VALIDATION_SCRIPT="${PROJECT_ROOT}/scripts/validate-orchestration.sh"
LOCAL_STATE_DIR="${XDG_STATE_HOME:-${HOME}/.local/state}/calabi-playbooks-onprem"
PLAYBOOK_BASENAME="$(basename "${PLAYBOOK_PATH}")"
PLAYBOOK_STEM="${PLAYBOOK_BASENAME%.yml}"
LOCAL_LOG_PATH="${LOCAL_STATE_DIR}/${PLAYBOOK_STEM}.log"
LOCAL_PID_PATH="${LOCAL_STATE_DIR}/${PLAYBOOK_STEM}.pid"
LOCAL_RC_PATH="${LOCAL_STATE_DIR}/${PLAYBOOK_STEM}.rc"
LOCAL_REMOTE_ENV_PATH="${LOCAL_STATE_DIR}/${PLAYBOOK_STEM}.remote.env"
LOCAL_STAGE_PATH="${LOCAL_STATE_DIR}/${PLAYBOOK_STEM}.stage"

if ! command -v ansible-inventory >/dev/null 2>&1; then
  echo "ansible-inventory is required" >&2
  exit 69
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 69
fi

expand_user_path() {
  case "$1" in
    \~) printf '%s\n' "${HOME}" ;;
    \~/*) printf '%s/%s\n' "${HOME}" "${1#\~/}" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

METAL_JSON="$(
  ansible-inventory -i "${INVENTORY_PATH}" --host metal-01
)"

HYPERVISOR_HOST="$(printf '%s' "${METAL_JSON}" | jq -r '.ansible_host')"
HYPERVISOR_USER="$(printf '%s' "${METAL_JSON}" | jq -r '.ansible_user')"
HYPERVISOR_KEY="$(printf '%s' "${METAL_JSON}" | jq -r '.ansible_ssh_private_key_file')"
HYPERVISOR_KEY="$(expand_user_path "${HYPERVISOR_KEY}")"
cd "${PROJECT_ROOT}"

mkdir -p "${LOCAL_STATE_DIR}"
rm -f "${LOCAL_PID_PATH}" "${LOCAL_RC_PATH}" "${LOCAL_LOG_PATH}" "${LOCAL_REMOTE_ENV_PATH}" "${LOCAL_STAGE_PATH}"
printf '%s\n' "$$" > "${LOCAL_PID_PATH}"

log_local() {
  printf '[%(%Y-%m-%d %H:%M:%S)T] %s\n' -1 "$*" | tee -a "${LOCAL_LOG_PATH}"
}

record_stage() {
  local stage="$1"
  local detail="${2:-}"
  cat > "${LOCAL_STAGE_PATH}" <<EOF
STAGE=${stage}
DETAIL=${detail}
UPDATED_AT=$(date +%s)
EOF
}

record_remote_handoff() {
  local output="$1"
  local remote_pid_file=""
  local remote_rc_file=""
  local remote_log_file=""

  remote_pid_file="$(printf '%s\n' "${output}" | awk -F= '/^pid_file=/{print $2}' | tail -n 1)"
  remote_rc_file="$(printf '%s\n' "${output}" | awk -F= '/^rc_file=/{print $2}' | tail -n 1)"
  remote_log_file="$(printf '%s\n' "${output}" | awk -F= '/^log_file=/{print $2}' | tail -n 1)"

  if [[ -n "${remote_pid_file}" && -n "${remote_rc_file}" && -n "${remote_log_file}" ]]; then
    cat > "${LOCAL_REMOTE_ENV_PATH}" <<EOF
BASTION_HOST=${BASTION_HOST}
BASTION_USER=cloud-user
HYPERVISOR_HOST=${HYPERVISOR_HOST}
HYPERVISOR_USER=${HYPERVISOR_USER}
HYPERVISOR_KEY=${HYPERVISOR_KEY}
REMOTE_PID_PATH=${remote_pid_file}
REMOTE_RC_PATH=${remote_rc_file}
REMOTE_LOG_PATH=${remote_log_file}
EOF
    record_stage "remote-running" "${remote_log_file}"
    log_local "Remote runner handed off on bastion."
    log_local "Remote log: ${remote_log_file}"
  fi
}

finish_local() {
  local rc="${1:-0}"
  printf '%s\n' "${rc}" > "${LOCAL_RC_PATH}"
  if [[ -f "${LOCAL_REMOTE_ENV_PATH}" ]]; then
    record_stage "remote-running" "bastion"
  elif [[ "${rc}" == "0" ]]; then
    record_stage "completed" "${PLAYBOOK_PATH}"
  else
    record_stage "failed" "${PLAYBOOK_PATH}"
  fi
  rm -f "${LOCAL_PID_PATH}"
}

trap 'finish_local "$?"' EXIT

# `site-bootstrap.yml` must stay on the workstation for host bootstrap and
# only hand off later once the bastion is actually ready.
case "${PLAYBOOK_PATH}" in
  */playbooks/site-bootstrap.yml|playbooks/site-bootstrap.yml)
    record_stage "validate" "${PLAYBOOK_PATH}"
    log_local "Validating ${PLAYBOOK_PATH}"
    CALABI_VALIDATE_REMOTE_EXECUTION=1 \
      "${VALIDATION_SCRIPT}" --playbook "${PLAYBOOK_PATH}" "${ORIGINAL_ARGS[@]}" \
      2>&1 | tee -a "${LOCAL_LOG_PATH}"

    rm -f "${LOCAL_STAGE_PATH}" "${LOCAL_PID_PATH}"
    trap - EXIT
    log_local "Launching local runner for ${PLAYBOOK_PATH}"
    CALABI_APPEND_LOG=1 exec "${PROJECT_ROOT}/scripts/run_local_playbook.sh" \
      "${PLAYBOOK_PATH}" "${ORIGINAL_ARGS[@]}"
    ;;
esac

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
  playbooks/site-lab.yml|playbooks/site-precluster.yml)
    STAGE_ARGS+=(
      -e "bastion_stage_require_lab_default_password=true"
      -e "bastion_stage_requires_support_service_rhsm=true"
      -e "bastion_stage_require_operator_ssh_public_key=true"
    )
    ;;
  playbooks/day2/openshift-post-install.yml|playbooks/day2/openshift-post-install-*.yml)
    STAGE_ARGS+=(
      -e "bastion_stage_require_lab_default_password=true"
    )
    ;;
  playbooks/bootstrap/bastion.yml|playbooks/bootstrap/bastion-join.yml|playbooks/bootstrap/idm.yml|playbooks/bootstrap/idm-ad-trust.yml|playbooks/lab/mirror-registry.yml|playbooks/lab/mirror-registry-refresh.yml|playbooks/lab/openshift-dns.yml|playbooks/lab/openshift-dns-cleanup.yml)
    STAGE_ARGS+=(
      -e "bastion_stage_requires_support_service_rhsm=true"
      -e "bastion_stage_require_operator_ssh_public_key=true"
    )
    ;;
esac

record_stage "validate" "${PLAYBOOK_PATH}"
log_local "Validating ${PLAYBOOK_PATH}"
CALABI_VALIDATE_REMOTE_EXECUTION=1 \
  "${VALIDATION_SCRIPT}" --playbook "${PLAYBOOK_PATH}" "${ORIGINAL_ARGS[@]}" 2>&1 | tee -a "${LOCAL_LOG_PATH}"

record_stage "bastion-stage" "${STAGE_PLAYBOOK}"
log_local "Refreshing bastion staging"
ansible-playbook -i "${INVENTORY_PATH}" "${STAGE_PLAYBOOK}" "${STAGE_ARGS[@]}" 2>&1 | tee -a "${LOCAL_LOG_PATH}"

record_stage "handoff" "${BASTION_HOST}"
log_local "Handing off ${PLAYBOOK_PATH} to bastion ${BASTION_HOST}"
SSH_OUTPUT="$(
ssh \
  -i "${HYPERVISOR_KEY}" \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  -o ProxyCommand="ssh -i ${HYPERVISOR_KEY} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${HYPERVISOR_USER}@${HYPERVISOR_HOST} -W %h:%p" \
  "cloud-user@${BASTION_HOST}" \
  "${BASTION_RUNNER}" "${PLAYBOOK_PATH}" "$@" 2>&1
)"
printf '%s\n' "${SSH_OUTPUT}" | tee -a "${LOCAL_LOG_PATH}"
record_remote_handoff "${SSH_OUTPUT}"
