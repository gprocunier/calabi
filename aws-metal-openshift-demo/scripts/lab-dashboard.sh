#!/usr/bin/env bash
# lab-dashboard.sh — tmux-based operator dashboard for the Calabi lab.
#
# Works on both the operator workstation and bastion-01. Shows live
# status of the automation runner, hypervisor VMs, OpenShift cluster
# state, and the playbook log in a single tmux session.
#
# Usage:
#   ./scripts/lab-dashboard.sh                     # auto-detect active playbook
#   ./scripts/lab-dashboard.sh site-bootstrap      # watch workstation bootstrap state
#   ./scripts/lab-dashboard.sh site-lab            # watch site-lab runner
#   ./scripts/lab-dashboard.sh mirror-registry     # watch mirror-registry runner
#
# Environment overrides:
#   REFRESH        — pane refresh interval in seconds (default: 10)
#   VIRT_HOST      — hypervisor address override
#   VIRT_USER      — hypervisor SSH user override
#   SSH_KEY        — SSH private key path override
#   BASTION_HOST   — bastion management IP/FQDN override
#   SESSION        — tmux session name (default: lab-dashboard)

set -euo pipefail

# --- Configuration --------------------------------------------------------

REFRESH="${REFRESH:-10}"
SESSION="${SESSION:-lab-dashboard}"
SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || printf '%s' "${BASH_SOURCE[0]}")"
PROJECT_ROOT_CANDIDATES=(
  "$(cd "$(dirname "$SCRIPT_PATH")/.." && pwd)"
  "/opt/openshift/aws-metal-openshift-demo"
  "${HOME}/codex/calabi-upstream/aws-metal-openshift-demo"
)
PROJECT_ROOT=""
for candidate in "${PROJECT_ROOT_CANDIDATES[@]}"; do
  if [[ -f "${candidate}/inventory/hosts.yml" && -d "${candidate}/playbooks" ]]; then
    PROJECT_ROOT="$candidate"
    break
  fi
done
if [[ -z "$PROJECT_ROOT" ]]; then
  echo "Unable to locate project root for lab-dashboard" >&2
  exit 70
fi
INVENTORY_PATH="${PROJECT_ROOT}/inventory/hosts.yml"
BASTION_HOST="${BASTION_HOST:-172.16.0.30}"
LOCAL_STATE_DIR="${XDG_STATE_HOME:-${HOME}/.local/state}/calabi-playbooks"
BASTION_STATE_DIR="/var/tmp/bastion-playbooks"

if [[ -d /opt/openshift/aws-metal-openshift-demo && -f /opt/openshift/secrets/id_ed25519 ]]; then
  DASHBOARD_MODE="bastion"
  VIRT_HOST_DEFAULT="172.16.0.1"
  VIRT_USER_DEFAULT="ec2-user"
  SSH_KEY_DEFAULT="/opt/openshift/secrets/id_ed25519"
  STATE_DIR="${BASTION_STATE_DIR}"
else
  DASHBOARD_MODE="workstation"
  if command -v ansible-inventory >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
    METAL_JSON="$(
      ansible-inventory -i "${INVENTORY_PATH}" --host metal-01 2>/dev/null || echo '{}'
    )"
    VIRT_HOST_DEFAULT="$(printf '%s' "${METAL_JSON}" | jq -r '.ansible_host // empty')"
    VIRT_USER_DEFAULT="$(printf '%s' "${METAL_JSON}" | jq -r '.ansible_user // empty')"
    SSH_KEY_DEFAULT="$(printf '%s' "${METAL_JSON}" | jq -r '.ansible_ssh_private_key_file // empty')"
  fi
  VIRT_HOST_DEFAULT="${VIRT_HOST_DEFAULT:-52.14.239.29}"
  VIRT_USER_DEFAULT="${VIRT_USER_DEFAULT:-ec2-user}"
  SSH_KEY_DEFAULT="${SSH_KEY_DEFAULT:-${HOME}/.ssh/id_ed25519}"
  STATE_DIR="${LOCAL_STATE_DIR}"
fi

VIRT_HOST="${VIRT_HOST:-${VIRT_HOST_DEFAULT}}"
VIRT_USER="${VIRT_USER:-${VIRT_USER_DEFAULT}}"
SSH_KEY="${SSH_KEY:-${SSH_KEY_DEFAULT}}"
DASHBOARD_RUNTIME_BASE="${XDG_RUNTIME_DIR:-/tmp}"

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required" >&2
  exit 69
fi

TMUX_VERSION="$(tmux -V 2>/dev/null | awk '{print $2}')"
TMUX_OS_ID="unknown"
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
  TMUX_OS_ID="${ID:-unknown}"
fi
TMUX_BIND_SUPPORTS_TARGET_SESSION=0
TMUX_BIND_KEY_USAGE="$(tmux list-commands 2>/dev/null | awk '/^bind-key / { print; exit }')"
if printf '%s\n' "${TMUX_BIND_KEY_USAGE}" | grep -Eq '(^|[[:space:]])-t([[:space:]]|$)'; then
  TMUX_BIND_SUPPORTS_TARGET_SESSION=1
fi

# --- Detect active playbook stem -----------------------------------------

detect_runner() {
  if [[ $# -ge 1 && -n "$1" ]]; then
    printf '%s' "$1"
    return
  fi
  local newest_live=""
  local newest_live_ts=0
  local newest_stale=""
  local newest_stale_ts=0
  local newest_log=""
  local newest_log_ts=0
  for pid_file in "${STATE_DIR}"/*.pid; do
    [[ -f "$pid_file" ]] || continue
    local stem
    stem="$(basename "$pid_file" .pid)"
    local rc_file="${STATE_DIR}/${stem}.rc"
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    local ts
    ts="$(stat -c %Y "$pid_file" 2>/dev/null || echo 0)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      if [[ "$ts" -gt "$newest_live_ts" ]]; then
        newest_live="$stem"
        newest_live_ts="$ts"
      fi
    elif [[ ! -f "$rc_file" && "$ts" -gt "$newest_stale_ts" ]]; then
      newest_stale="$stem"
      newest_stale_ts="$ts"
    fi
  done
  if [[ -n "$newest_live" ]]; then
    printf '%s' "$newest_live"
    return
  fi
  if [[ -z "$newest_stale" ]]; then
    for log_file in "${STATE_DIR}"/*.log; do
      [[ -f "$log_file" ]] || continue
      local stem
      stem="$(basename "$log_file" .log)"
      local rc_file="${STATE_DIR}/${stem}.rc"
      local ts
      ts="$(stat -c %Y "$log_file" 2>/dev/null || echo 0)"
      if [[ ! -f "$rc_file" && "$ts" -gt "$newest_log_ts" ]]; then
        newest_log="$stem"
        newest_log_ts="$ts"
      fi
    done
  fi
  if [[ -n "$newest_stale" ]]; then
    printf '%s' "$newest_stale"
  else
    printf '%s' "${newest_log:-site-lab}"
  fi
}

RUNNER_STEM="$(detect_runner "${1:-}")"
LOG_PATH="${STATE_DIR}/${RUNNER_STEM}.log"
PID_PATH="${STATE_DIR}/${RUNNER_STEM}.pid"
RC_PATH="${STATE_DIR}/${RUNNER_STEM}.rc"
REMOTE_ENV_PATH="${LOCAL_STATE_DIR}/${RUNNER_STEM}.remote.env"
STAGE_PATH="${LOCAL_STATE_DIR}/${RUNNER_STEM}.stage"

detect_canvas_size() {
  local width=""
  local height=""
  local rows=""
  local cols=""

  if [[ -n "${TMUX:-}" ]]; then
    read -r width height < <(
      tmux display-message -p '#{client_width} #{client_height}' 2>/dev/null || true
    )
    if [[ -n "${height:-}" && "${height:-0}" -gt 1 ]]; then
      height=$(( height - 1 ))
    fi
  fi

  if [[ -z "${width:-}" || -z "${height:-}" ]]; then
    read -r width height < <(
      tmux list-clients -F '#{client_activity} #{client_width} #{client_height}' 2>/dev/null \
      | sort -nr \
      | awk 'NR == 1 { print $2, ($3 > 1 ? $3 - 1 : $3) }'
    )
  fi

  if [[ -z "${width:-}" || -z "${height:-}" ]]; then
    read -r rows cols < <(stty size 2>/dev/null || true)
    if [[ -n "${rows:-}" && -n "${cols:-}" ]]; then
      width="$cols"
      height="$rows"
    fi
  fi

  if [[ -z "${width:-}" || -z "${height:-}" ]]; then
    width="$(tput cols 2>/dev/null || echo 160)"
    height="$(tput lines 2>/dev/null || echo 40)"
  fi

  if (( width < 120 )); then
    width=120
  fi
  if (( height < 28 )); then
    height=28
  fi

  printf '%s %s\n' "$width" "$height"
}

read -r SESSION_WIDTH SESSION_HEIGHT <<< "$(detect_canvas_size)"

# --- Write pane scripts to temp files -------------------------------------
# This avoids all quoting issues with heredocs passed through printf %q.

# --- Pre-flight checks ----------------------------------------------------

if [[ ! -r "$SSH_KEY" ]]; then
  echo "ERROR: SSH key not readable: ${SSH_KEY}" >&2
  echo "  current user: $(whoami)" >&2
  echo "  key perms: $(ls -l "$SSH_KEY" 2>/dev/null || echo 'missing')" >&2
  echo "" >&2
  echo "  Use a per-user 0600 copy of the hypervisor key instead of" >&2
  echo "  making the shared private key group-readable:" >&2
  echo "    sudo install -d -m 700 \$HOME/.ssh" >&2
  echo "    sudo install -m 600 -o $(whoami) -g $(id -gn) \\" >&2
  echo "      /opt/openshift/aws-metal-openshift-demo/secrets/id_ed25519 \\" >&2
  echo "      \$HOME/.ssh/lab-hypervisor.key" >&2
  echo "    SSH_KEY=\$HOME/.ssh/lab-hypervisor.key /usr/local/bin/lab-dashboard" >&2
  exit 1
fi

PANE_DIR="$(mktemp -d "${DASHBOARD_RUNTIME_BASE%/}/lab-dashboard.panes.XXXXXX")"
SSH_MUX_DIR="$(mktemp -d "${DASHBOARD_RUNTIME_BASE%/}/lab-dashboard.mux.XXXXXX")"
chmod 700 "$PANE_DIR" "$SSH_MUX_DIR"

close_dashboard_mux_master() {
  local control_path="$1"
  shift
  [[ -S "$control_path" ]] || return 0
  ssh -q -S "$control_path" -O exit "$@" >/dev/null 2>&1 || true
}

cleanup_dashboard_runtime() {
  local mux_hypervisor_host="$VIRT_HOST"
  local mux_hypervisor_user="$VIRT_USER"
  local mux_hypervisor_key="$SSH_KEY"
  local mux_bastion_host="$BASTION_HOST"
  local mux_bastion_user="cloud-user"

  if [[ -f "$REMOTE_ENV_PATH" ]]; then
    # shellcheck disable=SC1090
    source "$REMOTE_ENV_PATH"
    mux_hypervisor_host="${HYPERVISOR_HOST:-$mux_hypervisor_host}"
    mux_hypervisor_user="${HYPERVISOR_USER:-$mux_hypervisor_user}"
    mux_hypervisor_key="${HYPERVISOR_KEY:-$mux_hypervisor_key}"
    mux_bastion_host="${BASTION_HOST:-$mux_bastion_host}"
    mux_bastion_user="${BASTION_USER:-$mux_bastion_user}"
  fi

  close_dashboard_mux_master \
    "${SSH_MUX_DIR}/bastion.sock" \
    -i "$mux_hypervisor_key" \
    -o BatchMode=yes \
    -o ConnectTimeout=5 \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ProxyCommand="ssh -q -i ${mux_hypervisor_key} -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ControlMaster=auto -o ControlPersist=600 -o ControlPath=${SSH_MUX_DIR}/hypervisor.sock ${mux_hypervisor_user}@${mux_hypervisor_host} -W %h:%p" \
    "${mux_bastion_user}@${mux_bastion_host}"

  close_dashboard_mux_master \
    "${SSH_MUX_DIR}/hypervisor.sock" \
    -i "$SSH_KEY" \
    -o BatchMode=yes \
    -o ConnectTimeout=5 \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    "${VIRT_USER}@${VIRT_HOST}"

  rm -rf "$PANE_DIR" "$SSH_MUX_DIR"
}

trap cleanup_dashboard_runtime EXIT

cat > "${PANE_DIR}/ssh-common.sh" <<'SSHEOF'
#!/usr/bin/env bash
SSH_MUX_DIR="__SSH_MUX_DIR__"
SSH_MUX_CONTROL_PERSIST="600"

ssh_hypervisor_control_path() {
  printf '%s\n' "${SSH_MUX_DIR}/hypervisor.sock"
}

ssh_bastion_control_path() {
  printf '%s\n' "${SSH_MUX_DIR}/bastion.sock"
}

hypervisor_ssh() {
  local control_path
  control_path="$(ssh_hypervisor_control_path)"
  ssh -q -i "$SSH_KEY" \
    -o BatchMode=yes \
    -o ConnectTimeout=5 \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ControlMaster=auto \
    -o ControlPersist="${SSH_MUX_CONTROL_PERSIST}" \
    -o ControlPath="$control_path" \
    "${VIRT_USER}@${VIRT_HOST}" "$@" 2>/dev/null
}

bastion_ssh_mux() {
  local bastion_control_path
  local hypervisor_control_path
  : "${HYPERVISOR_KEY:=${SSH_KEY:-}}"
  bastion_control_path="$(ssh_bastion_control_path)"
  hypervisor_control_path="$(ssh_hypervisor_control_path)"
  ssh -q -i "$HYPERVISOR_KEY" \
    -o BatchMode=yes \
    -o ConnectTimeout=5 \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ControlMaster=auto \
    -o ControlPersist="${SSH_MUX_CONTROL_PERSIST}" \
    -o ControlPath="$bastion_control_path" \
    -o ProxyCommand="ssh -q -i ${HYPERVISOR_KEY} -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ControlMaster=auto -o ControlPersist=${SSH_MUX_CONTROL_PERSIST} -o ControlPath=${hypervisor_control_path} ${HYPERVISOR_USER}@${HYPERVISOR_HOST} -W %h:%p" \
    "${BASTION_USER}@${BASTION_HOST}" "$@" 2>/dev/null
}
SSHEOF
sed -i \
  -e "s|__SSH_MUX_DIR__|${SSH_MUX_DIR}|g" \
  "${PANE_DIR}/ssh-common.sh"
chmod 700 "${PANE_DIR}/ssh-common.sh"

bastion_ssh_manifest() {
  [[ -f "$REMOTE_ENV_PATH" ]] || return 1
  # shellcheck disable=SC1090
  source "$REMOTE_ENV_PATH"
  ssh -q -i "$HYPERVISOR_KEY" \
    -o BatchMode=yes \
    -o ConnectTimeout=5 \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ProxyCommand="ssh -q -i ${HYPERVISOR_KEY} -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${HYPERVISOR_USER}@${HYPERVISOR_HOST} -W %h:%p" \
    "${BASTION_USER}@${BASTION_HOST}" "$@" 2>/dev/null
}

# --- Build task manifest --------------------------------------------------
# Run --list-tasks once at launch to get per-play task counts.
# Output format: one line per play — "task_count|play_name"

PLAYBOOK_MAP=(
  "ad-server:playbooks/bootstrap/ad-server.yml"
  "idm:playbooks/bootstrap/idm.yml"
  "idm-ad-trust:playbooks/bootstrap/idm-ad-trust.yml"
  "site-lab:playbooks/site-lab.yml"
  "site-bootstrap:playbooks/site-bootstrap.yml"
  "mirror-registry:playbooks/lab/mirror-registry.yml"
  "openshift-dns:playbooks/lab/openshift-dns.yml"
  "openshift-cluster:playbooks/cluster/openshift-cluster.yml"
  "openshift-post-install:playbooks/day2/openshift-post-install.yml"
)

PLAYBOOK_PATH=""
for entry in "${PLAYBOOK_MAP[@]}"; do
  stem="${entry%%:*}"
  path="${entry#*:}"
  if [[ "$stem" == "$RUNNER_STEM" ]]; then
    PLAYBOOK_PATH="$path"
    break
  fi
done

MANIFEST="${PANE_DIR}/task-manifest.txt"
MANIFEST_STATUS="${PANE_DIR}/task-manifest.status"
ROLE_TASK_COUNTS="${PANE_DIR}/role-task-counts.txt"
cat > "${PANE_DIR}/build-manifest.sh" <<'MANIFESTEOF'
#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="__PROJECT_ROOT__"
PLAYBOOK_PATH="__PLAYBOOK_PATH__"
RUNNER_STEM="__RUNNER_STEM__"
MANIFEST="__MANIFEST__"
MANIFEST_STATUS="__MANIFEST_STATUS__"
LISTTASKS_ERR="__LISTTASKS_ERR__"
REMOTE_ENV_PATH="__REMOTE_ENV_PATH__"
BASTION_HOST="__BASTION_HOST__"
BASTION_USER="cloud-user"
HYPERVISOR_HOST="__HYPERVISOR_HOST__"
HYPERVISOR_USER="__HYPERVISOR_USER__"
SSH_KEY="__SSH_KEY__"
SSH_HELPERS="__SSH_HELPERS__"

# shellcheck disable=SC1090
source "$SSH_HELPERS"

bastion_ssh_manifest() {
  [[ -f "$REMOTE_ENV_PATH" ]] || return 1
  # shellcheck disable=SC1090
  source "$REMOTE_ENV_PATH"
  bastion_ssh_mux "$@"
}

build_from_stream() {
  awk '
    /^  play #[0-9]/ {
      if (play_name != "") printf "%d|%s\n", task_count, play_name
      play_name = $0
      sub(/^  play #[0-9]+ \([^)]+\): /, "", play_name)
      sub(/\t.*/, "", play_name)
      task_count = 0
      next
    }
    /^      / && NF > 0 { task_count++ }
    END { if (play_name != "") printf "%d|%s\n", task_count, play_name }
  ' > "$MANIFEST"
}

printf 'building\n' > "$MANIFEST_STATUS"
cd "$PROJECT_ROOT"
if ANSIBLE_COLLECTIONS_PATH=/usr/share/ansible/collections \
  ansible-playbook -i inventory/hosts.yml "$PLAYBOOK_PATH" --list-tasks 2>"$LISTTASKS_ERR" | build_from_stream; then
  printf 'ready\n' > "$MANIFEST_STATUS"
  exit 0
fi

if bastion_ssh_manifest "cd /opt/openshift/aws-metal-openshift-demo && ANSIBLE_COLLECTIONS_PATH=/usr/share/ansible/collections ansible-playbook -i inventory/hosts.yml '$PLAYBOOK_PATH' --list-tasks 2>/dev/null" | build_from_stream; then
  printf 'Manifest built on bastion for %s.\n' "$RUNNER_STEM" >&2
  printf 'ready\n' > "$MANIFEST_STATUS"
  exit 0
fi

if grep -q "ansible.windows.win_powershell" "$LISTTASKS_ERR" && [[ ! -f "$REMOTE_ENV_PATH" ]]; then
  printf 'pending-bastion\n' > "$MANIFEST_STATUS"
  : > "$MANIFEST"
  exit 0
fi

printf 'Manifest build failed for %s; continuing without progress bars.\n' "$RUNNER_STEM" >&2
sed -n '1,8p' "$LISTTASKS_ERR" >&2 || true
printf 'unavailable\n' > "$MANIFEST_STATUS"
: > "$MANIFEST"
MANIFESTEOF
sed -i \
  -e "s|__PROJECT_ROOT__|${PROJECT_ROOT}|g" \
  -e "s|__PLAYBOOK_PATH__|${PLAYBOOK_PATH}|g" \
  -e "s|__RUNNER_STEM__|${RUNNER_STEM}|g" \
  -e "s|__MANIFEST__|${MANIFEST}|g" \
  -e "s|__MANIFEST_STATUS__|${MANIFEST_STATUS}|g" \
  -e "s|__LISTTASKS_ERR__|${PANE_DIR}/list-tasks.err|g" \
  -e "s|__REMOTE_ENV_PATH__|${REMOTE_ENV_PATH}|g" \
  -e "s|__BASTION_HOST__|${BASTION_HOST}|g" \
  -e "s|__HYPERVISOR_HOST__|${VIRT_HOST}|g" \
  -e "s|__HYPERVISOR_USER__|${VIRT_USER}|g" \
  -e "s|__SSH_KEY__|${SSH_KEY}|g" \
  -e "s|__SSH_HELPERS__|${PANE_DIR}/ssh-common.sh|g" \
  "${PANE_DIR}/build-manifest.sh"

PROJECT_ROOT_FOR_PYTHON="${PROJECT_ROOT}" python - <<'PY' > "${ROLE_TASK_COUNTS}"
import os
from pathlib import Path
import re

roles_root = Path(os.environ["PROJECT_ROOT_FOR_PYTHON"]) / "roles"
name_re = re.compile(r'^\s*-\s+name\s*:')
for role_dir in sorted(roles_root.iterdir()):
    tasks_dir = role_dir / "tasks"
    if not tasks_dir.is_dir():
        continue
    count = 0
    for task_file in sorted(tasks_dir.rglob("*.yml")):
        for line in task_file.read_text(errors="ignore").splitlines():
            if name_re.match(line):
                count += 1
    if count > 0:
        print(f"{count}|{role_dir.name}")
PY

if [[ -n "$PLAYBOOK_PATH" && -f "${PROJECT_ROOT}/${PLAYBOOK_PATH}" ]]; then
  printf 'Building task manifest for %s...\n' "$RUNNER_STEM"
  bash "${PANE_DIR}/build-manifest.sh"
  printf 'Manifest: %s plays, %s total tasks\n' \
    "$(wc -l < "$MANIFEST")" \
    "$(awk -F'|' '{s+=$1} END {print s+0}' "$MANIFEST")"
else
  printf 'No playbook mapping for stem "%s" — progress bars disabled\n' "$RUNNER_STEM"
  touch "$MANIFEST"
fi

# Pane 0 — Runner status with progress tracking
cat > "${PANE_DIR}/runner.sh" <<'RUNEOF'
#!/usr/bin/env bash
LOG_PATH="__LOG_PATH__"
PID_PATH="__PID_PATH__"
RC_PATH="__RC_PATH__"
RUNNER_STEM="__RUNNER_STEM__"
REFRESH="__REFRESH__"
MANIFEST="__MANIFEST__"
MANIFEST_STATUS="__MANIFEST_STATUS__"
DASHBOARD_MODE="__DASHBOARD_MODE__"
REMOTE_ENV_PATH="__REMOTE_ENV_PATH__"
STAGE_PATH="__STAGE_PATH__"
BASTION_HOST="__BASTION_HOST__"
BASTION_USER="cloud-user"
HYPERVISOR_HOST="__HYPERVISOR_HOST__"
HYPERVISOR_USER="__HYPERVISOR_USER__"
SSH_KEY="__SSH_KEY__"
SESSION="__SESSION__"
PANE_DIR="__PANE_DIR__"
BUILD_MANIFEST_SCRIPT="__BUILD_MANIFEST_SCRIPT__"
ROLE_TASK_COUNTS="__ROLE_TASK_COUNTS__"
SSH_HELPERS="__SSH_HELPERS__"

# shellcheck disable=SC1090
source "$SSH_HELPERS"

bastion_ssh() {
  bastion_ssh_mux "$@"
}

load_remote_env() {
  [[ -f "$REMOTE_ENV_PATH" ]] || return 1
  # shellcheck disable=SC1090
  source "$REMOTE_ENV_PATH"
}

load_stage_env() {
  [[ -f "$STAGE_PATH" ]] || return 1
  # shellcheck disable=SC1090
  source "$STAGE_PATH"
}

active_source() {
  if [[ "$DASHBOARD_MODE" == "bastion" ]]; then
    printf 'bastion\n'
    return
  fi
  if [[ -f "$PID_PATH" ]]; then
    local pid
    pid="$(cat "$PID_PATH" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      printf 'local\n'
      return
    fi
  fi
  if load_remote_env; then
    if [[ -f "$LOG_PATH" && -f "$REMOTE_ENV_PATH" ]]; then
      local local_ts remote_ts
      local_ts="$(stat -c %Y "$LOG_PATH" 2>/dev/null || echo 0)"
      remote_ts="$(stat -c %Y "$REMOTE_ENV_PATH" 2>/dev/null || echo 0)"
      if (( local_ts > remote_ts )); then
        printf 'local\n'
        return
      fi
    fi
    printf 'remote\n'
    return
  fi
  printf 'local\n'
}

file_exists_for_source() {
  local source_kind="$1"
  local target_path="$2"
  if [[ "$source_kind" == "remote" ]]; then
    bastion_ssh "test -f '${target_path}'"
  else
    [[ -f "$target_path" ]]
  fi
}

cat_for_source() {
  local source_kind="$1"
  local target_path="$2"
  if [[ "$source_kind" == "remote" ]]; then
    bastion_ssh "cat '${target_path}'"
  else
    cat "$target_path"
  fi
}

stat_epoch_for_source() {
  local source_kind="$1"
  local target_path="$2"
  if [[ "$source_kind" == "remote" ]]; then
    bastion_ssh "stat -c %W '${target_path}' 2>/dev/null || stat -c %Y '${target_path}' 2>/dev/null || echo 0"
  else
    stat -c %W "$target_path" 2>/dev/null || stat -c %Y "$target_path" 2>/dev/null || echo 0
  fi
}

# Load manifest into arrays: play_names[i] and play_tasks[i]
declare -a play_names=()
declare -a play_tasks=()
total_tasks=0
load_manifest() {
  play_names=()
  play_tasks=()
  total_tasks=0
  [[ -s "$MANIFEST" ]] || return
  while IFS='|' read -r count name; do
    play_tasks+=("$count")
    play_names+=("$name")
    total_tasks=$(( total_tasks + count ))
  done < "$MANIFEST"
}
load_manifest
num_plays="${#play_names[@]}"

manifest_state() {
  if [[ -f "$MANIFEST_STATUS" ]]; then
    cat "$MANIFEST_STATUS"
  else
    printf 'unknown\n'
  fi
}

declare -A role_task_totals=()
if [[ -s "$ROLE_TASK_COUNTS" ]]; then
  while IFS='|' read -r count role_name; do
    [[ -n "$role_name" ]] || continue
    role_task_totals["$role_name"]="$count"
  done < "$ROLE_TASK_COUNTS"
fi

clip_text() {
  local text="$1"
  local limit="$2"
  if (( ${#text} <= limit )); then
    printf '%s' "$text"
  elif (( limit > 1 )); then
    printf '%s…' "${text:0:limit-1}"
  fi
}

format_detail_field() {
  local text="$1"
  local width="$2"
  local clipped
  clipped="$(clip_text "$text" "$width")"
  printf '%-*s' "$width" "$clipped"
}

progress_bar() {
  local percent="$1"
  local state="$2"
  local width="$3"
  local filled=$(( percent * width / 100 ))
  local empty=$(( width - filled ))
  local suffix=""
  local color='\033[1;33m'
  if [[ "$state" == "done" ]]; then
    color='\033[1;32m'
  elif [[ "$state" == "failed" ]]; then
    color='\033[1;31m'
  elif [[ "$state" == "indeterminate" ]]; then
    color='\033[1;33m'
  fi
  printf '%b[' "$color"
  if [[ "$state" == "indeterminate" ]]; then
    local block_width=$(( width / 4 ))
    local start
    if (( block_width < 3 )); then
      block_width=3
    fi
    if (( block_width >= width )); then
      block_width=$(( width - 1 ))
    fi
    start=$(( percent % width ))
    for (( i = 0; i < width; i++ )); do
      if (( i >= start && i < start + block_width )); then
        printf '█'
      else
        printf '░'
      fi
    done
    suffix=' dyn'
  else
    printf '%0.s█' $(seq 1 "$filled") 2>/dev/null
    printf '%0.s░' $(seq 1 "$empty") 2>/dev/null
    suffix="$(printf '%3d%%' "$percent")"
  fi
  printf ']\033[0m %s' "$suffix"
}

staging_percent_for_task() {
  local task_name="$1"
  case "$task_name" in
    *"Sync the project repository to the bastion"*|*"Recreate the staged project root"*|*"Recreate the staged project-local secrets directory"*)
      printf '15\n'
      ;;
    *"Copy pull secret"*|*"Copy hypervisor SSH private key"*|*"Copy hypervisor SSH public key"*|*"Render the bastion-side inventory"*|*"Render bastion-side lab credentials"*)
      printf '35\n'
      ;;
    *"Install the mirror progress helper on the bastion"*|*"Install the tmux mirror progress helper on the bastion"*|*"Install the lab dashboard helper on the bastion"*|*"Install per-user bastion helper links"*)
      printf '55\n'
      ;;
    *"Install required Ansible collections on the bastion"*|*"Install required Python packages on the bastion"*|*"Ensure bastion execution prerequisites are installed"*)
      printf '75\n'
      ;;
    *"Verify SSH access from the bastion to the hypervisor management address"*|*"Seed managed name-resolution entries"*|*"Verify managed hostnames resolve"*|*"Verify managed hostnames resolve on the current host"*)
      printf '90\n'
      ;;
    *)
      printf '5\n'
      ;;
  esac
}

render_staging_progress() {
  local stage_name="$1"
  local latest_task="$2"
  local percent=0
  local detail=""
  case "$stage_name" in
    validate)
      percent=10
      detail="workstation validation"
      ;;
    bastion-stage)
      percent="$(staging_percent_for_task "$latest_task")"
      detail="${latest_task}"
      ;;
    handoff)
      percent=95
      detail="remote bastion handoff"
      ;;
    remote-running)
      percent=100
      detail="bastion runner active"
      ;;
    completed)
      percent=100
      detail="local wrapper completed"
      ;;
    failed)
      percent=100
      detail="local wrapper failed"
      ;;
    *)
      return
      ;;
  esac

  printf '\033[1m%-14s\033[0m ' "Staging"
  progress_bar "$percent" "active" "$PROGRESS_WIDTH"
  printf '  %s\n' "$(format_detail_field "$(clip_text "$detail" "$DETAIL_WIDTH")" "$DETAIL_WIDTH")"
}

format_elapsed() {
  local secs="$1"
  printf '%02d:%02d:%02d' $(( secs / 3600 )) $(( (secs % 3600) / 60 )) $(( secs % 60 ))
}

runner_start_epoch() {
  local source_kind="$1"
  local candidate_ts=0
  local path
  local paths=("$PID_PATH" "$LOG_PATH" "$RC_PATH")
  if [[ "$source_kind" == "remote" ]] && load_remote_env; then
    paths=("$REMOTE_PID_PATH" "$REMOTE_LOG_PATH" "$REMOTE_RC_PATH")
  fi
  for path in "${paths[@]}"; do
    if file_exists_for_source "$source_kind" "$path"; then
      candidate_ts="$(stat_epoch_for_source "$source_kind" "$path")"
      if (( candidate_ts > 0 )); then
        printf '%s\n' "$candidate_ts"
        return
      fi
    fi
  done
  printf '%s\n' "$(date +%s)"
}

format_epoch_label() {
  local epoch="$1"
  date -d "@${epoch}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date '+%Y-%m-%d %H:%M:%S'
}

ensure_bootstrap_log_pane() {
  [[ "$RUNNER_STEM" == "site-lab" ]] || return
  local existing_pane log_pane new_pane
  existing_pane="$(
    tmux list-panes -t "$SESSION" -F '#{pane_id} #{pane_title}' 2>/dev/null \
    | awk '$2 == "lab-bootstrap-log" { print $1; exit }'
  )"
  [[ -z "$existing_pane" ]] || return
  log_pane="$(
    tmux list-panes -t "$SESSION" -F '#{pane_id} #{pane_title}' 2>/dev/null \
    | awk '$2 == "lab-ansible-log" { print $1; exit }'
  )"
  [[ -n "$log_pane" ]] || return
  new_pane="$(
    tmux split-window -P -v -l 14 -t "$log_pane" -F '#{pane_id}' \
      "bash ${PANE_DIR}/bootstrap-log.sh" 2>/dev/null || true
  )"
  [[ -n "$new_pane" ]] || return
  tmux select-pane -t "$new_pane" -T "lab-bootstrap-log" >/dev/null 2>&1 || true
}

collapse_bootstrap_log_pane() {
  local existing_pane
  existing_pane="$(
    tmux list-panes -t "$SESSION" -F '#{pane_id} #{pane_title}' 2>/dev/null \
    | awk '$2 == "lab-bootstrap-log" { print $1; exit }'
  )"
  [[ -z "$existing_pane" ]] && return
  tmux kill-pane -t "$existing_pane" >/dev/null 2>&1 || true
}

sync_bootstrap_log_pane() {
  local current_task="$1"
  if [[ "$current_task" == *"bootstrap completion"* ]]; then
    ensure_bootstrap_log_pane
  else
    collapse_bootstrap_log_pane
  fi
}

PANE_WIDTH="$(tput cols 2>/dev/null || echo 120)"
PROGRESS_WIDTH=44
DETAIL_WIDTH=28
if (( PANE_WIDTH >= 220 )); then
  PROGRESS_WIDTH=56
  DETAIL_WIDTH=34
elif (( PANE_WIDTH >= 160 )); then
  PROGRESS_WIDTH=48
  DETAIL_WIDTH=30
elif (( PANE_WIDTH >= 120 )); then
  PROGRESS_WIDTH=40
  DETAIL_WIDTH=26
fi

is_log_active() {
  # A log file is "active" if it was modified in the last 60 seconds
  local path="$1"
  [[ -f "$path" ]] || return 1
  local now mod_ts age
  now="$(date +%s)"
  mod_ts="$(stat -c %Y "$path" 2>/dev/null || echo 0)"
  age=$(( now - mod_ts ))
  (( age < 60 ))
}

runner_status() {
  local source_kind="$1"
  local current_pid_path="$PID_PATH"
  local current_rc_path="$RC_PATH"
  local current_log_path="$LOG_PATH"
  if [[ "$source_kind" == "remote" ]] && load_remote_env; then
    current_pid_path="$REMOTE_PID_PATH"
    current_rc_path="$REMOTE_RC_PATH"
    current_log_path="$REMOTE_LOG_PATH"
  fi

  if file_exists_for_source "$source_kind" "$current_rc_path"; then
    local rc
    rc="$(cat_for_source "$source_kind" "$current_rc_path" 2>/dev/null)"
    local finished_ago=""
    local rc_ts
    rc_ts="$(stat_epoch_for_source "$source_kind" "$current_rc_path")"
    if (( rc_ts > 0 )); then
      local ago=$(( $(date +%s) - rc_ts ))
      finished_ago=" $(format_elapsed "$ago") ago"
    fi
    if [[ "$rc" == "0" ]]; then
      printf '\033[1;32mCOMPLETED (rc=0)%s\033[0m' "$finished_ago"
    else
      printf '\033[1;31mFAILED (rc=%s)%s\033[0m' "$rc" "$finished_ago"
    fi
    return
  fi

  # Check tracked PID first
  if file_exists_for_source "$source_kind" "$current_pid_path"; then
    local pid
    pid="$(cat_for_source "$source_kind" "$current_pid_path" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]]; then
      if [[ "$source_kind" == "remote" ]]; then
        if bastion_ssh "kill -0 '${pid}' 2>/dev/null"; then
          printf '\033[1;33mRUNNING (pid=%s)\033[0m' "$pid"
          return
        fi
      elif kill -0 "$pid" 2>/dev/null; then
        printf '\033[1;33mRUNNING (pid=%s)\033[0m' "$pid"
        return
      fi
    fi
  fi

  # PID file is stale or missing — if the log exists but no .rc file,
  # the playbook started and hasn't finished yet
  if file_exists_for_source "$source_kind" "$current_log_path" \
    && ! file_exists_for_source "$source_kind" "$current_rc_path"; then
    if [[ "$source_kind" == "remote" ]]; then
      printf '\033[1;33mRUNNING (bastion)\033[0m'
    elif [[ "$source_kind" == "bastion" ]]; then
      printf '\033[1;33mRUNNING (pid tracked locally)\033[0m'
    else
      printf '\033[1;33mRUNNING (workstation)\033[0m'
    fi
    return
  fi

  if [[ "$source_kind" == "remote" ]]; then
    printf '\033[0;37mWAITING FOR BASTION HANDOFF\033[0m'
    return
  fi

  # Check if any other runner has a log but no .rc (started, not finished)
  for log_file in __STATE_DIR__/*.log; do
    [[ -f "$log_file" ]] || continue
    local stem
    stem="$(basename "$log_file" .log)"
    local rc_file="__STATE_DIR__/${stem}.rc"
    if [[ ! -f "$rc_file" ]]; then
      printf '\033[1;33mRUNNING %s (no PID tracked)\033[0m' "$stem"
      return
    fi
  done

  # Truly idle — show last completed playbook
  local last_stem="" last_ts=0 last_rc=""
  for rc_file in __STATE_DIR__/*.rc; do
    [[ -f "$rc_file" ]] || continue
    local stem ts
    stem="$(basename "$rc_file" .rc)"
    ts="$(stat -c %Y "$rc_file" 2>/dev/null || echo 0)"
    if (( ts > last_ts )); then
      last_ts="$ts"
      last_stem="$stem"
      last_rc="$(cat "$rc_file" 2>/dev/null)"
    fi
  done
  if [[ -n "$last_stem" ]]; then
    local ago=$(( $(date +%s) - last_ts ))
    local rc_icon
    if [[ "$last_rc" == "0" ]]; then rc_icon="✓"; else rc_icon="✗ rc=$last_rc"; fi
    printf '\033[0;37mIDLE (last: %s %s %s ago)\033[0m' "$last_stem" "$rc_icon" "$(format_elapsed "$ago")"
  else
    printf '\033[0;37mIDLE\033[0m'
  fi
}

# Parse the log to get per-play task starts.
compute_progress() {
  local source_kind="$1"
  local current_log_path="$LOG_PATH"
  if [[ "$source_kind" == "remote" ]] && load_remote_env; then
    current_log_path="$REMOTE_LOG_PATH"
  fi
  if ! file_exists_for_source "$source_kind" "$current_log_path"; then
    printf '0\n0\n0\nwaiting...\nwaiting...\nwaiting...\n0\n'
    return
  fi
  local awk_program='
    /^PLAY \[/ {
      play_count++
      current_play_tasks = 0
      delete prefix_counts
      name = $0
      sub(/^PLAY \[/, "", name)
      sub(/\] \**$/, "", name)
      current_play_name = name
      current_task_name = "(waiting for first task in current play)"
      current_task_prefix = current_play_name
      current_prefix_started = 0
    }
    /^TASK \[/ {
      current_play_tasks++
      total_tasks++
      task_name = $0
      sub(/^TASK \[/, "", task_name)
      sub(/\] \**$/, "", task_name)
      current_task_name = task_name
      task_prefix = task_name
      if (index(task_prefix, " : ") > 0) {
        task_prefix = substr(task_prefix, 1, index(task_prefix, " : ") - 1)
      }
      current_task_prefix = task_prefix
      prefix_counts[task_prefix]++
      current_prefix_started = prefix_counts[task_prefix]
    }
    END {
      if (play_count == 0) play_count = 0
      if (current_play_name == "") current_play_name = "waiting..."
      if (current_task_name == "") current_task_name = "waiting..."
      if (current_task_prefix == "") current_task_prefix = "waiting..."
      printf "%d\n%d\n%d\n%s\n%s\n%s\n%d\n", play_count, current_play_tasks, total_tasks, current_play_name, current_task_name, current_task_prefix, current_prefix_started
    }
  '
  cat_for_source "$source_kind" "$current_log_path" 2>/dev/null | awk "$awk_program"
}

while true; do
  clear 2>/dev/null || true
  if (( total_tasks == 0 )) && [[ -x "$BUILD_MANIFEST_SCRIPT" ]]; then
    if bash "$BUILD_MANIFEST_SCRIPT" >/dev/null 2>&1; then
      load_manifest
      num_plays="${#play_names[@]}"
    fi
  fi
  current_manifest_state="$(manifest_state)"
  state_source="$(active_source)"
  run_start_epoch="$(runner_start_epoch "$state_source")"
  elapsed=$(( $(date +%s) - run_start_epoch ))
  printf '\033[1;36m── %s ──\033[0m  %b  │  Started %s  Elapsed %s\n' \
    "$RUNNER_STEM" "$(runner_status "$state_source")" "$(format_epoch_label "$run_start_epoch")" "$(format_elapsed "$elapsed")"

  mapfile -t progress_state < <(compute_progress "$state_source")
  cur_play_idx="${progress_state[0]:-0}"
  cur_play_started="${progress_state[1]:-0}"
  total_started="${progress_state[2]:-0}"
  cur_play_name="${progress_state[3]:-waiting...}"
  latest_task="${progress_state[4]:-waiting...}"
  current_task_prefix="${progress_state[5]:-waiting...}"
  current_prefix_started="${progress_state[6]:-0}"

  runner_rc=""
  if [[ "$state_source" == "remote" ]] && load_remote_env; then
    if file_exists_for_source remote "$REMOTE_RC_PATH"; then
      runner_rc="$(cat_for_source remote "$REMOTE_RC_PATH" 2>/dev/null || true)"
    fi
  elif [[ -f "$RC_PATH" ]]; then
    runner_rc="$(cat "$RC_PATH" 2>/dev/null || true)"
  fi

  manifest_idx=$(( cur_play_idx > 0 ? cur_play_idx - 1 : 0 ))
  expected_current=0
  if (( cur_play_idx > 0 && manifest_idx < num_plays )); then
    expected_current="${play_tasks[$manifest_idx]}"
  fi

  completed_previous=0
  if (( cur_play_idx > 1 && num_plays > 0 )); then
    for (( i = 0; i < manifest_idx && i < num_plays; i++ )); do
      completed_previous=$(( completed_previous + play_tasks[i] ))
    done
  fi

  completed_current=0
  overall_state="active"
  play_state="active"

  if [[ "$runner_rc" == "0" ]]; then
    completed_current="$expected_current"
    total_completed="$total_tasks"
    overall_state="done"
    play_state="done"
  else
    if (( cur_play_started > 0 )); then
      completed_current=$(( cur_play_started - 1 ))
    fi
    if (( completed_current < 0 )); then
      completed_current=0
    fi
    if (( expected_current > 0 && completed_current > expected_current )); then
      completed_current="$expected_current"
    fi
    if [[ -n "$runner_rc" && "$runner_rc" != "0" ]]; then
      overall_state="failed"
      play_state="failed"
    elif (( expected_current > 0 && completed_current >= expected_current )); then
      completed_current=$(( expected_current - 1 ))
    fi
    total_completed=$(( completed_previous + completed_current ))
    if (( total_tasks > 0 && total_completed >= total_tasks )); then
      total_completed=$(( total_tasks - 1 ))
    fi
  fi

  if (( total_completed < 0 )); then
    total_completed=0
  fi

  if (( total_tasks > 0 )); then
    overall_pct=$(( total_completed * 100 / total_tasks ))
    printf '\033[1m%-14s\033[0m ' "Deployment"
    progress_bar "$overall_pct" "$overall_state" "$PROGRESS_WIDTH"
    printf '  %s\n' "$(format_detail_field "$(printf '(%d/%d complete)' "$total_completed" "$total_tasks")" "$DETAIL_WIDTH")"
  elif [[ "$current_manifest_state" == "pending-bastion" ]]; then
    printf '\033[1m%-14s\033[0m manifest pending (awaiting bastion handoff)\n' "Deployment"
  else
    printf '\033[1m%-14s\033[0m task starts: %d (no manifest)\n' "Deployment" "$total_started"
  fi

  if (( cur_play_idx > 0 && num_plays > 0 )); then
    play_position_completed=$(( cur_play_idx - 1 ))
    if [[ "$runner_rc" == "0" ]]; then
      play_position_completed="$num_plays"
    fi
    if (( play_position_completed < 0 )); then
      play_position_completed=0
    fi
    if (( play_position_completed > num_plays )); then
      play_position_completed="$num_plays"
    fi
    play_position_pct=$(( play_position_completed * 100 / num_plays ))
    printf '\033[1m%-14s\033[0m ' "Play"
    progress_bar "$play_position_pct" "$play_state" "$PROGRESS_WIDTH"
    printf '  %s\n' "$(format_detail_field "$(printf '(%d/%d complete)' "$play_position_completed" "$num_plays")" "$DETAIL_WIDTH")"

    if (( manifest_idx < num_plays )); then
      expected="${play_tasks[$manifest_idx]}"
      task_bar_label="Tasks"
      task_bar_state="$play_state"
      task_bar_percent=0
      task_bar_detail=""
      role_expected="${role_task_totals[$current_task_prefix]:-0}"
      if [[ "$runner_rc" == "0" ]] && (( role_expected > 0 )); then
        task_bar_percent=100
        task_bar_detail="$(printf '(%d/%d complete in %s)' "$role_expected" "$role_expected" "$current_task_prefix")"
      elif [[ "$runner_rc" == "0" ]] && (( expected > 0 )); then
        task_bar_percent=100
        task_bar_detail="$(printf '(%d/%d complete)' "$expected" "$expected")"
      elif (( role_expected > 0 )); then
        role_completed=$(( current_prefix_started > 0 ? current_prefix_started - 1 : 0 ))
        if [[ -z "$runner_rc" && "$role_completed" -ge "$role_expected" ]]; then
          role_completed=$(( role_expected - 1 ))
        fi
        if (( role_completed < 0 )); then
          role_completed=0
        fi
        task_bar_percent=$(( role_completed * 100 / role_expected ))
        if (( task_bar_percent > 100 )); then
          task_bar_percent=100
        fi
        task_bar_detail="$(printf '(%d/%d complete in %s)' "$role_completed" "$role_expected" "$current_task_prefix")"
      elif (( expected > 0 )); then
        play_pct=$(( completed_current * 100 / expected ))
        if (( play_pct > 100 )); then
          play_pct=100
        fi
        task_bar_percent="$play_pct"
        task_bar_detail="$(printf '(%d/%d complete)' "$completed_current" "$expected")"
        if [[ -z "$runner_rc" && "$cur_play_started" -gt "$expected" ]]; then
          task_bar_label="Tasks*"
          task_bar_state="indeterminate"
          task_bar_percent="$cur_play_started"
          task_bar_detail="$(printf '(%d started in %s, total expands at runtime)' "$current_prefix_started" "$current_task_prefix")"
        fi
      else
        task_bar_state="indeterminate"
        task_bar_percent="$current_prefix_started"
        task_bar_detail="$(printf '(%d started in %s, total unknown)' "$current_prefix_started" "$current_task_prefix")"
      fi
      printf '\033[1m%-14s\033[0m ' "$task_bar_label"
      progress_bar "$task_bar_percent" "$task_bar_state" "$PROGRESS_WIDTH"
      printf '  %s\n' "$(format_detail_field "$task_bar_detail" "$DETAIL_WIDTH")"
    else
      printf '\033[1m%-14s\033[0m task starts: %d\n' "Tasks" "$cur_play_started"
    fi
  fi

  current_stage=""
  current_stage_detail=""
  if load_stage_env; then
    current_stage="${STAGE:-}"
    current_stage_detail="${DETAIL:-}"
  fi
  if [[ "$state_source" == "local" && -n "$current_stage" && "$current_stage" != "remote-running" ]]; then
    render_staging_progress "$current_stage" "${latest_task:-$current_stage_detail}"
  fi

  display_play_name="$cur_play_name"
  if (( cur_play_idx > 0 && manifest_idx < num_plays )); then
    display_play_name="${play_names[$manifest_idx]}"
  fi
  sync_bootstrap_log_pane "$latest_task"
  printf '\033[1mSource:\033[0m %s\n' "$state_source"
  printf '\033[1mPhase:\033[0m %s\n' "$(clip_text "$display_play_name" $(( PANE_WIDTH - 8 )))"
  if [[ "$state_source" == "local" && -n "$current_stage" ]]; then
    printf '\033[1mStage:\033[0m %s\n' "$(clip_text "$current_stage" $(( PANE_WIDTH - 8 )))"
  fi
  printf '\033[1mTask:\033[0m  %s\n' "$(clip_text "$latest_task" $(( PANE_WIDTH - 8 )))"
  if (( total_tasks > 0 )); then
    printf '\033[1mManifest:\033[0m %d plays, %d tasks\n' "$num_plays" "$total_tasks"
  elif [[ "$current_manifest_state" == "pending-bastion" ]]; then
    printf '\033[1mManifest:\033[0m pending from bastion after handoff\n'
  else
    printf '\033[1mManifest:\033[0m unavailable\n'
  fi

  sleep "$REFRESH"
done
RUNEOF
sed -i \
  -e "s|__LOG_PATH__|${LOG_PATH}|g" \
  -e "s|__PID_PATH__|${PID_PATH}|g" \
  -e "s|__RC_PATH__|${RC_PATH}|g" \
  -e "s|__RUNNER_STEM__|${RUNNER_STEM}|g" \
  -e "s|__REFRESH__|${REFRESH}|g" \
  -e "s|__MANIFEST__|${MANIFEST}|g" \
  -e "s|__MANIFEST_STATUS__|${MANIFEST_STATUS}|g" \
  -e "s|__DASHBOARD_MODE__|${DASHBOARD_MODE}|g" \
  -e "s|__REMOTE_ENV_PATH__|${REMOTE_ENV_PATH}|g" \
  -e "s|__STAGE_PATH__|${STAGE_PATH}|g" \
  -e "s|__BASTION_HOST__|${BASTION_HOST}|g" \
  -e "s|__HYPERVISOR_HOST__|${VIRT_HOST}|g" \
  -e "s|__HYPERVISOR_USER__|${VIRT_USER}|g" \
  -e "s|__SSH_KEY__|${SSH_KEY}|g" \
  -e "s|__SESSION__|${SESSION}|g" \
  -e "s|__PANE_DIR__|${PANE_DIR}|g" \
  -e "s|__BUILD_MANIFEST_SCRIPT__|${PANE_DIR}/build-manifest.sh|g" \
  -e "s|__ROLE_TASK_COUNTS__|${ROLE_TASK_COUNTS}|g" \
  -e "s|__STATE_DIR__|${STATE_DIR}|g" \
  -e "s|__SSH_HELPERS__|${PANE_DIR}/ssh-common.sh|g" \
  "${PANE_DIR}/runner.sh"

# Pane 1 — Hypervisor VMs
cat > "${PANE_DIR}/vms.sh" <<'VMSEOF'
#!/usr/bin/env bash
VIRT_HOST="__VIRT_HOST__"
VIRT_USER="__VIRT_USER__"
SSH_KEY="__SSH_KEY__"
REFRESH="__REFRESH__"
SSH_HELPERS="__SSH_HELPERS__"

# shellcheck disable=SC1090
source "$SSH_HELPERS"

virt_ssh() {
  hypervisor_ssh "$@"
}

while true; do
  clear 2>/dev/null || true
  printf '\033[1;36m── Infrastructure Summary ──\033[0m\n\n'

  domain_data="$(virt_ssh '
    sudo virsh list --all --name 2>/dev/null | sed "/^$/d" | while read -r dom; do
      state=$(sudo virsh domstate "$dom" 2>/dev/null | tr -d "\r")
      vcpus=$(sudo virsh vcpucount "$dom" --live --current 2>/dev/null || sudo virsh vcpucount "$dom" --config --current 2>/dev/null || echo "?")
      printf "%s|%s|%s\n" "$dom" "$state" "$vcpus"
    done
  ')"
  if [[ -z "$domain_data" ]]; then
    printf 'Hypervisor unreachable or no VM inventory available.\n'
    sleep "$REFRESH"
    continue
  fi

  host_load="$(virt_ssh "uptime | sed 's/^.*load average: //'" | head -n 1)"
  host_mem="$(virt_ssh "free -h | awk 'NR==2 {printf \"%s / %s used, %s free\", \$3, \$2, \$4}'" | head -n 1)"

  declare -A vm_state=()
  declare -A vm_vcpus=()
  total_domains=0
  running_domains=0
  masters_running=0
  infra_running=0
  workers_running=0

  while IFS='|' read -r dom state vcpus; do
    [[ -n "$dom" ]] || continue
    vm_state["$dom"]="$state"
    vm_vcpus["$dom"]="$vcpus"
    total_domains=$(( total_domains + 1 ))
    if [[ "$state" == "running" ]]; then
      running_domains=$(( running_domains + 1 ))
      case "$dom" in
        ocp-master-*) masters_running=$(( masters_running + 1 )) ;;
        ocp-infra-*) infra_running=$(( infra_running + 1 )) ;;
        ocp-worker-*) workers_running=$(( workers_running + 1 )) ;;
      esac
    fi
  done <<< "$domain_data"

  printf '\033[1mSupport VMs\033[0m\n'
  for dom in bastion-01.workshop.lan ad-01.corp.lan idm-01.workshop.lan mirror-registry.workshop.lan; do
    state="${vm_state[$dom]:-missing}"
    vcpus="${vm_vcpus[$dom]:--}"
    printf '  %-28s %-10s %4s vCPU\n' "$dom" "$state" "$vcpus"
  done

  printf '\n\033[1mOpenShift VM Counts\033[0m\n'
  printf '  domains up: %-3d of %-3d\n' "$running_domains" "$total_domains"
  printf '  masters: %-3d   infra: %-3d   workers: %-3d\n' \
    "$masters_running" "$infra_running" "$workers_running"

  printf '\n\033[1mHypervisor\033[0m\n'
  printf '  load: %s\n' "${host_load:-unavailable}"
  printf '  mem : %s\n' "${host_mem:-unavailable}"
  sleep "$REFRESH"
done
VMSEOF
sed -i \
  -e "s|__VIRT_HOST__|${VIRT_HOST}|g" \
  -e "s|__VIRT_USER__|${VIRT_USER}|g" \
  -e "s|__SSH_KEY__|${SSH_KEY}|g" \
  -e "s|__REFRESH__|${REFRESH}|g" \
  -e "s|__SSH_HELPERS__|${PANE_DIR}/ssh-common.sh|g" \
  "${PANE_DIR}/vms.sh"

# Pane 2 — OpenShift cluster
cat > "${PANE_DIR}/ocp.sh" <<'OCPEOF'
#!/usr/bin/env bash
REFRESH="__REFRESH__"
KUBECONFIG_CANDIDATES=(
  "$HOME/etc/kubeconfig"
  "/opt/openshift/aws-metal-openshift-demo/generated/ocp/auth/kubeconfig"
)

find_readable_kubeconfig() {
  for kc in "${KUBECONFIG_CANDIDATES[@]}"; do
    if [[ -f "$kc" && -r "$kc" ]]; then
      printf '%s' "$kc"
      return
    fi
  done
}

find_working_kubeconfig() {
  for kc in "${KUBECONFIG_CANDIDATES[@]}"; do
    if [[ -f "$kc" && -r "$kc" ]] \
      && oc whoami --kubeconfig="$kc" --request-timeout=5s >/dev/null 2>&1; then
      printf '%s' "$kc"
      return
    fi
  done
}

while true; do
  clear 2>/dev/null || true
  printf '\033[1;36m── Cluster Summary ──\033[0m\n\n'

  KC="$(find_working_kubeconfig)"
  if [[ -z "$KC" ]]; then
    READABLE_KC="$(find_readable_kubeconfig)"
    if [[ -n "$READABLE_KC" ]]; then
      printf '\033[1;33mKubeconfig found but API not reachable yet\033[0m\n'
      printf '  using: %s\n' "$READABLE_KC"
    else
      printf '\033[0;37mWaiting for kubeconfig...\033[0m\n'
      printf '  %s\n' "${KUBECONFIG_CANDIDATES[0]}"
      printf '  %s\n' "${KUBECONFIG_CANDIDATES[1]}"
    fi
    sleep "$REFRESH"
    continue
  fi

  export KUBECONFIG="$KC"

  cluster_version="$(oc get clusterversion version -o jsonpath='{.status.desired.version}' 2>/dev/null || true)"
  operator_bad_lines="$(oc get co --no-headers 2>/dev/null | awk '$3 != "True" || $4 == "True" || $5 == "True" { printf "  %-30s avail=%-5s prog=%-5s deg=%-5s\n", $1, $3, $4, $5 }' || true)"
  operator_bad_count="$(printf '%s\n' "$operator_bad_lines" | sed '/^$/d' | wc -l | tr -d ' ')"
  csr_count="$(oc get csr --no-headers 2>/dev/null | awk '$5 == "Pending" || $9 == "Pending" { count++ } END { print count + 0 }')"
  catalog_state="$(oc get catalogsource cs-redhat-operator-index-v4-20 -n openshift-marketplace -o jsonpath='{.status.connectionState.lastObservedState}' 2>/dev/null || true)"
  idp_names="$(oc get oauth cluster -o jsonpath='{range .spec.identityProviders[*]}{.name}{" "}{end}' 2>/dev/null || true)"

  node_summary="$(oc get nodes --no-headers 2>/dev/null | awk '
    {
      total++
      if ($2 == "Ready") ready++
      else notready++
      roles=$3
      if (roles ~ /master/) master++
      if (roles ~ /infra/) infra++
      if (roles ~ /worker/) worker++
      if ($2 != "Ready") bad = bad sprintf("  %-28s %s\n", $1, $2)
    }
    END {
      printf "%d|%d|%d|%d|%d|%d\n", total, ready, notready, master, infra, worker
      if (bad != "") printf "%s", bad
    }
  ')"
  IFS='|' read -r node_total node_ready node_notready node_master node_infra node_worker <<< "$(printf '%s\n' "$node_summary" | head -n 1)"
  node_bad_lines="$(printf '%s\n' "$node_summary" | tail -n +2)"

  printf '\033[1mAPI / Version\033[0m\n'
  printf '  user: %-20s version: %s\n' "$(oc whoami 2>/dev/null || echo unavailable)" "${cluster_version:-unavailable}"

  printf '\n\033[1mNodes\033[0m\n'
  printf '  ready: %-3s of %-3s   not-ready: %-3s\n' "${node_ready:-0}" "${node_total:-0}" "${node_notready:-0}"
  printf '  master: %-3s   infra: %-3s   worker: %-3s\n' "${node_master:-0}" "${node_infra:-0}" "${node_worker:-0}"
  if [[ -n "$node_bad_lines" ]]; then
    printf '%s\n' "$node_bad_lines" | head -4
  fi

  printf '\n\033[1mPlatform Health\033[0m\n'
  if [[ "${operator_bad_count:-0}" -eq 0 ]]; then
    printf '  all cluster operators healthy\n'
  else
    printf '  unhealthy operators: %s\n' "$operator_bad_count"
    printf '%s\n' "$operator_bad_lines" | head -5
  fi

  printf '\n\033[1mAccess / Catalog\033[0m\n'
  printf '  pending csr: %s\n' "${csr_count:-0}"
  printf '  mirrored catalog: %s\n' "${catalog_state:-waiting}"
  printf '  idps: %s\n' "${idp_names:-unavailable}"

  sleep "$REFRESH"
done
OCPEOF
# Patch the refresh value into the OCP pane (single-quoted heredoc above)
sed -i "s|__REFRESH__|${REFRESH}|g" "${PANE_DIR}/ocp.sh"

# Pane 3 — Log tail
cat > "${PANE_DIR}/log.sh" <<'LOGEOF'
#!/usr/bin/env bash
LOG_PATH="__LOG_PATH__"
DASHBOARD_MODE="__DASHBOARD_MODE__"
REMOTE_ENV_PATH="__REMOTE_ENV_PATH__"
REFRESH="__REFRESH__"
BASTION_HOST="__BASTION_HOST__"
BASTION_USER="cloud-user"
HYPERVISOR_HOST="__HYPERVISOR_HOST__"
HYPERVISOR_USER="__HYPERVISOR_USER__"
SSH_KEY="__SSH_KEY__"
SSH_HELPERS="__SSH_HELPERS__"

# shellcheck disable=SC1090
source "$SSH_HELPERS"

bastion_ssh() {
  bastion_ssh_mux "$@"
}

load_remote_env() {
  [[ -f "$REMOTE_ENV_PATH" ]] || return 1
  # shellcheck disable=SC1090
  source "$REMOTE_ENV_PATH"
}

while true; do
  clear 2>/dev/null || true
  printf '\033[1;36m── Log Snapshot ──\033[0m\n\n'
  if [[ "$DASHBOARD_MODE" == "workstation" ]] && load_remote_env \
    && bastion_ssh "test -f '${REMOTE_LOG_PATH}'"; then
    printf '\033[1mSource:\033[0m bastion %s\n\n' "${REMOTE_LOG_PATH}"
    bastion_ssh "tail -n 80 '${REMOTE_LOG_PATH}'" || printf 'Remote log unavailable.\n'
  elif [[ -f "$LOG_PATH" ]]; then
    printf '\033[1mSource:\033[0m workstation %s\n\n' "${LOG_PATH}"
    tail -n 80 "$LOG_PATH"
  else
    printf 'Waiting for %s ...\n' "$LOG_PATH"
  fi
  sleep "$REFRESH"
done
LOGEOF
sed -i \
  -e "s|__LOG_PATH__|${LOG_PATH}|g" \
  -e "s|__DASHBOARD_MODE__|${DASHBOARD_MODE}|g" \
  -e "s|__REMOTE_ENV_PATH__|${REMOTE_ENV_PATH}|g" \
  -e "s|__REFRESH__|${REFRESH}|g" \
  -e "s|__BASTION_HOST__|${BASTION_HOST}|g" \
  -e "s|__HYPERVISOR_HOST__|${VIRT_HOST}|g" \
  -e "s|__HYPERVISOR_USER__|${VIRT_USER}|g" \
  -e "s|__SSH_KEY__|${SSH_KEY}|g" \
  -e "s|__SSH_HELPERS__|${PANE_DIR}/ssh-common.sh|g" \
  "${PANE_DIR}/log.sh"

# Pane 4 — OpenShift installer bootstrap log
cat > "${PANE_DIR}/bootstrap-log.sh" <<'BOOTEOF'
#!/usr/bin/env bash
DASHBOARD_MODE="__DASHBOARD_MODE__"
REMOTE_ENV_PATH="__REMOTE_ENV_PATH__"
REFRESH="__REFRESH__"
BASTION_HOST="__BASTION_HOST__"
BASTION_USER="cloud-user"
HYPERVISOR_HOST="__HYPERVISOR_HOST__"
HYPERVISOR_USER="__HYPERVISOR_USER__"
SSH_KEY="__SSH_KEY__"
INSTALL_LOG_PATH="/opt/openshift/aws-metal-openshift-demo/generated/ocp/.openshift_install.log"
LOCAL_INSTALL_LOG_PATH="__PROJECT_ROOT__/generated/ocp/.openshift_install.log"
SSH_HELPERS="__SSH_HELPERS__"

# shellcheck disable=SC1090
source "$SSH_HELPERS"

bastion_ssh() {
  bastion_ssh_mux "$@"
}

load_remote_env() {
  [[ -f "$REMOTE_ENV_PATH" ]] || return 1
  # shellcheck disable=SC1090
  source "$REMOTE_ENV_PATH"
}

while true; do
  clear 2>/dev/null || true
  printf '\033[1;36m── OpenShift Installer Log ──\033[0m\n\n'
  if [[ "$DASHBOARD_MODE" == "workstation" ]] && load_remote_env \
    && bastion_ssh "test -f '${INSTALL_LOG_PATH}'"; then
    printf '\033[1mSource:\033[0m bastion %s\n\n' "${INSTALL_LOG_PATH}"
    bastion_ssh "tail -n 60 '${INSTALL_LOG_PATH}'" || printf 'OpenShift installer log unavailable.\n'
  elif [[ -f "$INSTALL_LOG_PATH" ]]; then
    printf '\033[1mSource:\033[0m bastion-local %s\n\n' "${INSTALL_LOG_PATH}"
    tail -n 60 "$INSTALL_LOG_PATH"
  elif [[ -f "$LOCAL_INSTALL_LOG_PATH" ]]; then
    printf '\033[1mSource:\033[0m workstation %s\n\n' "${LOCAL_INSTALL_LOG_PATH}"
    tail -n 60 "$LOCAL_INSTALL_LOG_PATH"
  else
    printf 'Waiting for %s ...\n' "$INSTALL_LOG_PATH"
  fi
  sleep "$REFRESH"
done
BOOTEOF
sed -i \
  -e "s|__DASHBOARD_MODE__|${DASHBOARD_MODE}|g" \
  -e "s|__REMOTE_ENV_PATH__|${REMOTE_ENV_PATH}|g" \
  -e "s|__REFRESH__|${REFRESH}|g" \
  -e "s|__BASTION_HOST__|${BASTION_HOST}|g" \
  -e "s|__HYPERVISOR_HOST__|${VIRT_HOST}|g" \
  -e "s|__HYPERVISOR_USER__|${VIRT_USER}|g" \
  -e "s|__SSH_KEY__|${SSH_KEY}|g" \
  -e "s|__PROJECT_ROOT__|${PROJECT_ROOT}|g" \
  -e "s|__SSH_HELPERS__|${PANE_DIR}/ssh-common.sh|g" \
  "${PANE_DIR}/bootstrap-log.sh"

chmod +x "${PANE_DIR}"/*.sh

# --- Build tmux session ---------------------------------------------------

if tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux kill-session -t "$SESSION"
fi

# Layout:
#   uses the active client canvas instead of a hard-coded oversized session
#   ┌──────────────────────────────────────────────────────────────────────┐
#   │ Runner status + coherent progress                                   │
#   ├──────────────────────────────┬───────────────────────────────────────┤
#   │ Infrastructure summary       │                                       │
#   ├──────────────────────────────┤ Live log tail                         │
#   │ Cluster summary              │                                       │
#   └──────────────────────────────┴───────────────────────────────────────┘

RUNNER_PANE_HEIGHT=10
if (( SESSION_HEIGHT < 40 )); then
  RUNNER_PANE_HEIGHT=8
fi
LEFT_COLUMN_WIDTH=$(( SESSION_WIDTH * 38 / 100 ))
if (( LEFT_COLUMN_WIDTH < 78 )); then
  LEFT_COLUMN_WIDTH=78
fi
LEFT_STACK_HEIGHT=$(( (SESSION_HEIGHT - RUNNER_PANE_HEIGHT) / 2 ))
if (( LEFT_STACK_HEIGHT < 10 )); then
  LEFT_STACK_HEIGHT=10
fi

# Start with runner full-width
tmux new-session -d -s "$SESSION" -x "$SESSION_WIDTH" -y "$SESSION_HEIGHT" \
  "bash ${PANE_DIR}/runner.sh"

# Split below runner
tmux split-window -v -t "${SESSION}:0.0" \
  "bash ${PANE_DIR}/vms.sh"

# Split the bottom into left (VMs) and right (log tail)
tmux split-window -h -t "${SESSION}:0.1" \
  "bash ${PANE_DIR}/log.sh"

# Split the left column (VMs) vertically to add OCP below
tmux split-window -v -t "${SESSION}:0.1" \
  "bash ${PANE_DIR}/ocp.sh"

# All panes exist — now force absolute sizes using the detected client canvas
tmux resize-pane -t "${SESSION}:0.0" -y "$RUNNER_PANE_HEIGHT"
tmux resize-pane -t "${SESSION}:0.1" -x "$LEFT_COLUMN_WIDTH"
tmux resize-pane -t "${SESSION}:0.1" -y "$LEFT_STACK_HEIGHT"

# Pane indexes shift after the final left-column split, so assign titles by
# geometry instead of assuming static pane numbers.
INFRA_PANE="$(
  tmux list-panes -t "${SESSION}" -F '#{pane_id} #{pane_left} #{pane_top}' 2>/dev/null \
  | awk '$2 == 0 && $3 > 0 { if (min_top == "" || $3 < min_top) { min_top = $3; id = $1 } } END { print id }'
)"
CLUSTER_PANE="$(
  tmux list-panes -t "${SESSION}" -F '#{pane_id} #{pane_left} #{pane_top}' 2>/dev/null \
  | awk '$2 == 0 && $3 > 0 { if (max_top == "" || $3 > max_top) { max_top = $3; id = $1 } } END { print id }'
)"
ANSIBLE_LOG_PANE="$(
  tmux list-panes -t "${SESSION}" -F '#{pane_id} #{pane_left}' 2>/dev/null \
  | awk '$2 > 0 { if (max_left == "" || $2 > max_left) { max_left = $2; id = $1 } } END { print id }'
)"

[[ -n "${INFRA_PANE}" ]] && tmux select-pane -t "${INFRA_PANE}" -T "lab-infra"
[[ -n "${ANSIBLE_LOG_PANE}" ]] && tmux select-pane -t "${ANSIBLE_LOG_PANE}" -T "lab-ansible-log"
[[ -n "${CLUSTER_PANE}" ]] && tmux select-pane -t "${CLUSTER_PANE}" -T "lab-cluster"

# Fast exit keys for the dashboard.
# Prefer session-targeted bindings when the local tmux supports them.
# Otherwise fall back to guarded root-table bindings that only act when the
# current session is this dashboard session.
if (( TMUX_BIND_SUPPORTS_TARGET_SESSION )); then
  tmux bind-key -n -t "${SESSION}" q kill-session -t "${SESSION}"
  tmux bind-key -n -t "${SESSION}" Q kill-session -t "${SESSION}"
  tmux bind-key -n -t "${SESSION}" Escape kill-session -t "${SESSION}"
else
  tmux bind-key -n q if-shell -F "#{==:#{session_name},${SESSION}}" \
    "kill-session -t ${SESSION}" \
    "send-keys q"
  tmux bind-key -n Q if-shell -F "#{==:#{session_name},${SESSION}}" \
    "kill-session -t ${SESSION}" \
    "send-keys Q"
  tmux bind-key -n Escape if-shell -F "#{==:#{session_name},${SESSION}}" \
    "kill-session -t ${SESSION}" \
    "send-keys Escape"
fi

# Focus on the runner pane
tmux select-pane -t "${SESSION}:0.0"

printf 'Launching dashboard session: %s (runner: %s)\n' "$SESSION" "$RUNNER_STEM"
printf 'Log: %s\n' "$LOG_PATH"
printf 'tmux %s on %s using %s binding mode\n' \
  "${TMUX_VERSION:-unknown}" \
  "$TMUX_OS_ID" \
  "$([[ "$TMUX_BIND_SUPPORTS_TARGET_SESSION" == "1" ]] && printf 'session-targeted' || printf 'guarded-root-table')"

tmux attach -t "$SESSION"
