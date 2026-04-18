#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <playbook-path> [ansible-playbook args...]" >&2
  exit 64
fi

PLAYBOOK_PATH="$1"
shift
EXTRA_ARGS=("$@")
EXTRA_ARGS_RENDERED=""
APPEND_LOG="${CALABI_APPEND_LOG:-0}"

controller_playbook_requires_winrm() {
  case "$1" in
    playbooks/bootstrap/ad-server.yml|playbooks/bootstrap/idm.yml|playbooks/bootstrap/idm-ad-trust.yml|playbooks/maintenance/ad-gc-diagnose.yml)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

assert_controller_pywinrm() {
  python3 - <<'PY'
import importlib.util
import sys

missing = [name for name in ("requests", "winrm") if importlib.util.find_spec(name) is None]
if missing:
    print(
        "missing controller Python dependencies for Windows orchestration: "
        + ", ".join(missing),
        file=sys.stderr,
    )
    print(
        "install them with: python3 -m pip install --user -r requirements-pip.txt",
        file=sys.stderr,
    )
    sys.exit(1)
PY
}

if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then
  EXTRA_ARGS_RENDERED="$(printf ' %q' "${EXTRA_ARGS[@]}")"
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${XDG_STATE_HOME:-${HOME}/.local/state}/calabi-playbooks-onprem"
PLAYBOOK_BASENAME="$(basename "${PLAYBOOK_PATH}")"
PLAYBOOK_STEM="${PLAYBOOK_BASENAME%.yml}"
LOG_PATH="${STATE_DIR}/${PLAYBOOK_STEM}.log"
PID_PATH="${STATE_DIR}/${PLAYBOOK_STEM}.pid"
RC_PATH="${STATE_DIR}/${PLAYBOOK_STEM}.rc"

if controller_playbook_requires_winrm "${PLAYBOOK_PATH}"; then
  assert_controller_pywinrm
fi

mkdir -p "${STATE_DIR}"
rm -f "${PID_PATH}" "${RC_PATH}"
if [[ "${APPEND_LOG}" != "1" ]]; then
  rm -f "${LOG_PATH}"
fi

cat > "${STATE_DIR}/${PLAYBOOK_STEM}.runner.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "\$\$" > "${PID_PATH}"
cd "${PROJECT_ROOT}"
set +e
if [[ "${APPEND_LOG}" == "1" ]]; then
  ansible-playbook -i inventory/hosts.yml "${PLAYBOOK_PATH}"${EXTRA_ARGS_RENDERED} >> "${LOG_PATH}" 2>&1
else
  ansible-playbook -i inventory/hosts.yml "${PLAYBOOK_PATH}"${EXTRA_ARGS_RENDERED} > "${LOG_PATH}" 2>&1
fi
rc="\$?"
printf '%s\n' "\${rc}" > "${RC_PATH}"
exit "\${rc}"
EOF

chmod 700 "${STATE_DIR}/${PLAYBOOK_STEM}.runner.sh"
nohup "${STATE_DIR}/${PLAYBOOK_STEM}.runner.sh" >/dev/null 2>&1 </dev/null &

for _ in $(seq 1 10); do
  if [[ -f "${PID_PATH}" || -f "${LOG_PATH}" || -f "${RC_PATH}" ]]; then
    break
  fi
  sleep 0.2
done

if [[ ! -f "${PID_PATH}" && ! -f "${LOG_PATH}" && ! -f "${RC_PATH}" ]]; then
  echo "failed to launch tracked local playbook runner for ${PLAYBOOK_STEM}" >&2
  exit 1
fi

echo "pid_file=${PID_PATH}"
echo "rc_file=${RC_PATH}"
echo "log_file=${LOG_PATH}"
