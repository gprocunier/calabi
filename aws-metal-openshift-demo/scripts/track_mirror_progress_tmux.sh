#!/usr/bin/env bash
set -euo pipefail

SESSION_NAME="${SESSION_NAME:-mirror-progress}"
REFRESH_SECONDS="${REFRESH_SECONDS:-5}"
RECREATE_SESSION="${RECREATE_SESSION:-1}"
LOG_PATH="${LOG_PATH:-/var/tmp/bastion-playbooks/mirror-registry.log}"
RC_PATH="${RC_PATH:-/var/tmp/bastion-playbooks/mirror-registry.rc}"
PID_PATH="${PID_PATH:-/var/tmp/bastion-playbooks/mirror-registry.pid}"
ARCHIVE_ROOT="${ARCHIVE_ROOT:-/opt/openshift/oc-mirror-archive}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-/opt/openshift/oc-mirror}"
MIRROR_HOST="${MIRROR_HOST:-172.16.0.20}"
MIRROR_USER="${MIRROR_USER:-cloud-user}"
MIRROR_SSH_KEY="${MIRROR_SSH_KEY:-/opt/openshift/secrets/id_ed25519}"
SUMMARY_TOOL="${SUMMARY_TOOL:-/usr/local/bin/track-mirror-progress}"

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required" >&2
  exit 69
fi

remote_ssh() {
  ssh \
    -q \
    -i "$MIRROR_SSH_KEY" \
    -o BatchMode=yes \
    -o ConnectTimeout=5 \
    -o LogLevel=ERROR \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    "${MIRROR_USER}@${MIRROR_HOST}" "$@"
}

pane_loop() {
  local title="$1"
  local body="$2"
  cat <<EOF
printf '\033]2;%s\033\\' $(printf '%q' "$title")
while true; do
  if command -v clear >/dev/null 2>&1; then clear; fi
  printf '%s\n\n' $(printf '%q' "$title")
  ${body}
  sleep ${REFRESH_SECONDS}
done
EOF
}

summary_cmd="$(pane_loop \
  'Mirror Summary' \
  "if [ -x ${SUMMARY_TOOL@Q} ]; then ${SUMMARY_TOOL@Q} | awk '/^oc-mirror$/ { exit } { print }'; else echo 'summary helper missing'; fi")"

runner_cmd="$(pane_loop \
  'Runner State' \
  "printf 'time: %s\n\n' \"\$(date -Is)\"; \
   printf 'pid file: '; cat ${PID_PATH@Q} 2>/dev/null || echo missing; \
   printf 'rc file: '; cat ${RC_PATH@Q} 2>/dev/null || echo pending; \
   printf '\nps:\n'; pgrep -af 'ansible-playbook .*playbooks/lab/mirror-registry.yml' || true; \
   printf '\nlatest task:\n'; awk '/^TASK \\[/ { task=\$0 } END { print task ? task : \"TASK [none yet]\" }' ${LOG_PATH@Q} 2>/dev/null; \
   printf '\nlog timestamp:\n'; stat -c '%y %n' ${LOG_PATH@Q} 2>/dev/null || true")"

storage_cmd="$(pane_loop \
  'Storage And Import' \
  "printf 'time: %s\n\n' \"\$(date -Is)\"; \
   remote_ssh() { ssh -i ${MIRROR_SSH_KEY@Q} -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${MIRROR_USER}@${MIRROR_HOST} \"\$@\"; }; \
   remote_ssh \"df -h /; echo ====; du -sh ${ARCHIVE_ROOT@Q} 2>/dev/null || true; echo ====; du -sh ${WORKSPACE_ROOT@Q} 2>/dev/null || true; echo ====; pgrep -af oc-mirror || true; echo ====; ps -o pid,etime,%cpu,%mem,cmd -C oc-mirror || true\"")"

registry_cmd="$(pane_loop \
  'Registry Containers' \
  "printf 'time: %s\n\n' \"\$(date -Is)\"; \
   remote_ssh() { ssh -i ${MIRROR_SSH_KEY@Q} -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${MIRROR_USER}@${MIRROR_HOST} \"\$@\"; }; \
   remote_ssh \"sudo podman ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'; echo ====; sudo podman volume ls; echo ====; sudo du -sh /var/lib/containers/storage/volumes/quay-storage/_data 2>/dev/null || true; sudo du -sh /var/lib/containers/storage/volumes/sqlite-storage/_data 2>/dev/null || true\"")"

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  if [[ "$RECREATE_SESSION" == "1" ]]; then
    tmux kill-session -t "$SESSION_NAME"
  else
    tmux attach -t "$SESSION_NAME"
    exit 0
  fi
fi

tmux new-session -d -s "$SESSION_NAME" -n mirror "bash -lc $(printf '%q' "$summary_cmd")"
tmux split-window -h -t "${SESSION_NAME}:0" "bash -lc $(printf '%q' "$runner_cmd")"
tmux select-pane -t "${SESSION_NAME}:0.0"
tmux split-window -v -t "${SESSION_NAME}:0.0" "bash -lc $(printf '%q' "$storage_cmd")"
tmux split-window -v -t "${SESSION_NAME}:0.1" "bash -lc $(printf '%q' "$registry_cmd")"
tmux select-layout -t "${SESSION_NAME}:0" tiled
tmux resize-pane -t "${SESSION_NAME}:0.0" -y 18
tmux send-keys -t "${SESSION_NAME}:0.3" "tail -n 80 -F ${LOG_PATH@Q}" C-m
tmux select-pane -t "${SESSION_NAME}:0.0"
tmux attach -t "$SESSION_NAME"
