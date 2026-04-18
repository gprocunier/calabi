#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <playbook-path> [ansible-playbook args...]" >&2
  exit 64
fi

PLAYBOOK_PATH="$1"
shift
EXTRA_ARGS=("$@")
EXTRA_ARGS_DECL=$'EXTRA_ARGS=(\n'

if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then
  for arg in "${EXTRA_ARGS[@]}"; do
    printf -v quoted_arg '%q' "${arg}"
    EXTRA_ARGS_DECL+="  ${quoted_arg}"$'\n'
  done
fi

EXTRA_ARGS_DECL+=')'

PROJECT_ROOT="/opt/openshift/on-prem-openshift-demo"
STATE_DIR="/var/tmp/bastion-playbooks-onprem"
PLAYBOOK_BASENAME="$(basename "${PLAYBOOK_PATH}")"
PLAYBOOK_STEM="${PLAYBOOK_BASENAME%.yml}"
LOG_PATH="${STATE_DIR}/${PLAYBOOK_STEM}.log"
PID_PATH="${STATE_DIR}/${PLAYBOOK_STEM}.pid"
RC_PATH="${STATE_DIR}/${PLAYBOOK_STEM}.rc"

mkdir -p "${STATE_DIR}"
rm -f "${PID_PATH}" "${RC_PATH}" "${LOG_PATH}"

cat > "${STATE_DIR}/${PLAYBOOK_STEM}.runner.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "${PROJECT_ROOT}"
${EXTRA_ARGS_DECL}
set +e
ANSIBLE_COLLECTIONS_PATHS="\${ANSIBLE_COLLECTIONS_PATHS:-/usr/share/ansible/collections:/usr/local/share/ansible/collections}" \\
  ansible-playbook -i inventory/hosts.yml "${PLAYBOOK_PATH}" "\${EXTRA_ARGS[@]}" > "${LOG_PATH}" 2>&1
rc="\$?"
printf '%s\n' "\${rc}" > "${RC_PATH}"
exit "\${rc}"
EOF

chmod 700 "${STATE_DIR}/${PLAYBOOK_STEM}.runner.sh"
nohup "${STATE_DIR}/${PLAYBOOK_STEM}.runner.sh" >/dev/null 2>&1 </dev/null &
echo "$!" > "${PID_PATH}"

echo "pid_file=${PID_PATH}"
echo "rc_file=${RC_PATH}"
echo "log_file=${LOG_PATH}"
