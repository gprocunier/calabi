#!/usr/bin/env bash
# lab-dashboard.sh — tmux-based operator dashboard for the Calabi lab.
#
# Designed to run on bastion-01. Shows live status of the automation
# runner, hypervisor VMs, OpenShift cluster state, and the playbook
# log in a single tmux session.
#
# Usage:
#   ./scripts/lab-dashboard.sh                     # auto-detect active playbook
#   ./scripts/lab-dashboard.sh site-lab            # watch site-lab runner
#   ./scripts/lab-dashboard.sh mirror-registry     # watch mirror-registry runner
#
# Environment overrides:
#   REFRESH        — pane refresh interval in seconds (default: 10)
#   VIRT_HOST      — hypervisor address (default: 172.16.0.1)
#   VIRT_USER      — hypervisor SSH user (default: ec2-user)
#   SSH_KEY        — SSH private key path (default: /opt/openshift/secrets/id_ed25519)
#   SESSION        — tmux session name (default: lab-dashboard)

set -euo pipefail

# --- Configuration --------------------------------------------------------

REFRESH="${REFRESH:-10}"
SESSION="${SESSION:-lab-dashboard}"
VIRT_HOST="${VIRT_HOST:-172.16.0.1}"
VIRT_USER="${VIRT_USER:-ec2-user}"
SSH_KEY="${SSH_KEY:-/opt/openshift/secrets/id_ed25519}"
STATE_DIR="/var/tmp/bastion-playbooks"

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required" >&2
  exit 69
fi

# --- Detect active playbook stem -----------------------------------------

detect_runner() {
  if [[ $# -ge 1 && -n "$1" ]]; then
    printf '%s' "$1"
    return
  fi
  local newest=""
  local newest_ts=0
  for pid_file in "${STATE_DIR}"/*.pid; do
    [[ -f "$pid_file" ]] || continue
    local stem
    stem="$(basename "$pid_file" .pid)"
    local rc_file="${STATE_DIR}/${stem}.rc"
    local ts
    ts="$(stat -c %Y "$pid_file" 2>/dev/null || echo 0)"
    if [[ ! -f "$rc_file" && "$ts" -gt "$newest_ts" ]]; then
      newest="$stem"
      newest_ts="$ts"
    fi
  done
  if [[ -z "$newest" ]]; then
    for log_file in "${STATE_DIR}"/*.log; do
      [[ -f "$log_file" ]] || continue
      local stem
      stem="$(basename "$log_file" .log)"
      local ts
      ts="$(stat -c %Y "$log_file" 2>/dev/null || echo 0)"
      if [[ "$ts" -gt "$newest_ts" ]]; then
        newest="$stem"
        newest_ts="$ts"
      fi
    done
  fi
  printf '%s' "${newest:-site-lab}"
}

RUNNER_STEM="$(detect_runner "${1:-}")"
LOG_PATH="${STATE_DIR}/${RUNNER_STEM}.log"
PID_PATH="${STATE_DIR}/${RUNNER_STEM}.pid"
RC_PATH="${STATE_DIR}/${RUNNER_STEM}.rc"

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

PANE_DIR="$(mktemp -d /tmp/lab-dashboard.XXXXXX)"
trap 'rm -rf "$PANE_DIR"' EXIT

# --- Build task manifest --------------------------------------------------
# Run --list-tasks once at launch to get per-play task counts.
# Output format: one line per play — "task_count|play_name"

PROJECT_ROOT="/opt/openshift/aws-metal-openshift-demo"
PLAYBOOK_MAP=(
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
if [[ -n "$PLAYBOOK_PATH" && -f "${PROJECT_ROOT}/${PLAYBOOK_PATH}" ]]; then
  printf 'Building task manifest for %s...\n' "$RUNNER_STEM"
  cd "$PROJECT_ROOT"
  ANSIBLE_COLLECTIONS_PATH=/usr/share/ansible/collections \
    ansible-playbook -i inventory/hosts.yml "$PLAYBOOK_PATH" --list-tasks 2>/dev/null | \
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
  cd - >/dev/null
  printf 'Manifest: %s plays, %s total tasks\n' \
    "$(wc -l < "$MANIFEST")" \
    "$(awk -F'|' '{s+=$1} END {print s}' "$MANIFEST")"
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

# Load manifest into arrays: play_names[i] and play_tasks[i]
declare -a play_names=()
declare -a play_tasks=()
total_tasks=0
if [[ -s "$MANIFEST" ]]; then
  while IFS='|' read -r count name; do
    play_tasks+=("$count")
    play_names+=("$name")
    total_tasks=$(( total_tasks + count ))
  done < "$MANIFEST"
fi
num_plays="${#play_names[@]}"

progress_bar() {
  local percent="$1"
  local width=30
  local filled=$(( percent * width / 100 ))
  local empty=$(( width - filled ))
  local color='\033[1;33m'
  if (( percent >= 100 )); then color='\033[1;32m'; fi
  printf '%b[' "$color"
  printf '%0.s█' $(seq 1 "$filled") 2>/dev/null
  printf '%0.s░' $(seq 1 "$empty") 2>/dev/null
  printf ']\033[0m %3d%%' "$percent"
}

format_elapsed() {
  local secs="$1"
  printf '%02d:%02d:%02d' $(( secs / 3600 )) $(( (secs % 3600) / 60 )) $(( secs % 60 ))
}

DASHBOARD_START_EPOCH="$(date +%s)"
DASHBOARD_START_LABEL="$(date '+%Y-%m-%d %H:%M:%S')"

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
  if [[ -f "$RC_PATH" ]]; then
    local rc
    rc="$(cat "$RC_PATH" 2>/dev/null)"
    local finished_ago=""
    local rc_ts
    rc_ts="$(stat -c %Y "$RC_PATH" 2>/dev/null || echo 0)"
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
  if [[ -f "$PID_PATH" ]]; then
    local pid
    pid="$(cat "$PID_PATH" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      printf '\033[1;33mRUNNING (pid=%s)\033[0m' "$pid"
      return
    fi
  fi

  # PID file is stale or missing — if the log exists but no .rc file,
  # the playbook started and hasn't finished yet
  if [[ -f "$LOG_PATH" && ! -f "$RC_PATH" ]]; then
    printf '\033[1;33mRUNNING (no PID tracked)\033[0m'
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

# Parse the log to get per-play task counts completed
compute_progress() {
  if [[ ! -f "$LOG_PATH" ]]; then
    echo "0|0|0|0|waiting..."
    return
  fi
  # Output: current_play_index | tasks_done_in_play | total_tasks_done | current_play_name
  awk '
    /^PLAY \[/ {
      play_count++
      current_play_tasks = 0
      name = $0
      sub(/^PLAY \[/, "", name)
      sub(/\] \**$/, "", name)
      current_play_name = name
    }
    /^TASK \[/ {
      current_play_tasks++
      total_tasks++
    }
    END {
      if (play_count == 0) play_count = 0
      printf "%d|%d|%d|%s\n", play_count, current_play_tasks, total_tasks, current_play_name
    }
  ' "$LOG_PATH"
}

while true; do
  clear 2>/dev/null || true
  elapsed=$(( $(date +%s) - DASHBOARD_START_EPOCH ))
  printf '\033[1;36m── %s ──\033[0m  %b  │  Started %s  Elapsed %s\n' \
    "$RUNNER_STEM" "$(runner_status)" "$DASHBOARD_START_LABEL" "$(format_elapsed "$elapsed")"

  IFS='|' read -r cur_play_idx cur_play_done total_done cur_play_name <<< "$(compute_progress)"

  if (( total_tasks > 0 )); then
    overall_pct=$(( total_done * 100 / total_tasks ))
    printf '\033[1m%-14s\033[0m ' "Deployment"
    progress_bar "$overall_pct"
    printf '  (%d/%d tasks)\n' "$total_done" "$total_tasks"
  else
    printf '\033[1m%-14s\033[0m tasks: %d (no manifest)\n' "Deployment" "$total_done"
  fi

  if (( cur_play_idx > 0 && num_plays > 0 )); then
    manifest_idx=$(( cur_play_idx - 1 ))
    play_label="$(printf 'Play %d/%d' "$cur_play_idx" "$num_plays")"
    if (( manifest_idx < num_plays )); then
      expected="${play_tasks[$manifest_idx]}"
      if (( expected > 0 )); then
        play_pct=$(( cur_play_done * 100 / expected ))
        if (( play_pct > 100 )); then play_pct=100; fi
      else
        play_pct=0
      fi
      printf '\033[1m%-14s\033[0m ' "$play_label"
      progress_bar "$play_pct"
      printf '  (%d/%d tasks)\n' "$cur_play_done" "$expected"
    else
      printf '\033[1m%-14s\033[0m tasks: %d\n' "$play_label" "$cur_play_done"
    fi
  fi

  # Current play and task on one line each
  if [[ -f "$LOG_PATH" ]]; then
    latest_task="$(awk '/^TASK \[/ { task=$0 } END { print task ? task : "waiting..." }' "$LOG_PATH" 2>/dev/null)"
  else
    latest_task="no log yet"
  fi
  printf '\033[1mPlay:\033[0m  %s\n' "${cur_play_name:-waiting...}"
  printf '\033[1mTask:\033[0m  %s\n' "$latest_task"

  # RECAP when done
  if [[ -f "$RC_PATH" && -f "$LOG_PATH" ]]; then
    printf '\n'
    grep -A 20 '^PLAY RECAP' "$LOG_PATH" 2>/dev/null | head -25 || true
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
  -e "s|__STATE_DIR__|${STATE_DIR}|g" \
  "${PANE_DIR}/runner.sh"

# Pane 1 — Hypervisor VMs
cat > "${PANE_DIR}/vms.sh" <<'VMSEOF'
#!/usr/bin/env bash
VIRT_HOST="__VIRT_HOST__"
VIRT_USER="__VIRT_USER__"
SSH_KEY="__SSH_KEY__"
REFRESH="__REFRESH__"

virt_ssh() {
  ssh -q -i "$SSH_KEY" \
    -o BatchMode=yes \
    -o ConnectTimeout=5 \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    "${VIRT_USER}@${VIRT_HOST}" "$@" 2>/dev/null
}

while true; do
  clear 2>/dev/null || true
  printf '\033[1;36m── Hypervisor VMs ──\033[0m\n\n'
  printf '\033[1mDomain Status\033[0m\n'
  virt_ssh "sudo virsh list --all" || echo "  (unreachable)"
  printf '\n\033[1mHost Load\033[0m\n'
  virt_ssh "uptime" || true
  printf '\n\033[1mHost Memory\033[0m\n'
  virt_ssh "free -h | head -2" || true
  printf '\n\033[1mGuest CPU Summary\033[0m\n'
  virt_ssh 'for dom in $(sudo virsh list --name 2>/dev/null); do vcpus=$(sudo virsh vcpucount "$dom" --live --current 2>/dev/null || echo "?"); printf "  %-35s %s vCPUs\n" "$dom" "$vcpus"; done' || true
  sleep "$REFRESH"
done
VMSEOF
sed -i \
  -e "s|__VIRT_HOST__|${VIRT_HOST}|g" \
  -e "s|__VIRT_USER__|${VIRT_USER}|g" \
  -e "s|__SSH_KEY__|${SSH_KEY}|g" \
  -e "s|__REFRESH__|${REFRESH}|g" \
  "${PANE_DIR}/vms.sh"

# Pane 2 — OpenShift cluster
cat > "${PANE_DIR}/ocp.sh" <<'OCPEOF'
#!/usr/bin/env bash
REFRESH="__REFRESH__"
KUBECONFIG_CANDIDATES=(
  "$HOME/etc/kubeconfig"
  "/opt/openshift/aws-metal-openshift-demo/generated/ocp/auth/kubeconfig"
)

find_kubeconfig() {
  for kc in "${KUBECONFIG_CANDIDATES[@]}"; do
    if [[ -f "$kc" && -r "$kc" ]]; then
      printf '%s' "$kc"
      return
    fi
  done
}

while true; do
  clear 2>/dev/null || true
  printf '\033[1;36m── OpenShift Cluster ──\033[0m\n\n'

  KC="$(find_kubeconfig)"
  if [[ -z "$KC" ]]; then
    printf '\033[0;37mWaiting for kubeconfig...\033[0m\n'
    printf '  checked:\n'
    for kc in "${KUBECONFIG_CANDIDATES[@]}"; do
      printf '    %s\n' "$kc"
    done
    sleep "$REFRESH"
    continue
  fi

  export KUBECONFIG="$KC"

  if ! oc whoami --request-timeout=5s >/dev/null 2>&1; then
    printf '\033[1;33mKubeconfig found but API not reachable yet\033[0m\n'
    printf '  %s\n' "$KC"
    sleep "$REFRESH"
    continue
  fi

  printf '\033[1mCluster Version\033[0m\n'
  oc get clusterversion version -o 'jsonpath={.status.desired.version}  {.status.conditions[?(@.type=="Available")].status}' 2>/dev/null && echo || echo "  unavailable"
  printf '\n'

  printf '\033[1mNodes\033[0m\n'
  oc get nodes --no-headers 2>/dev/null | awk '{printf "  %-40s %-15s %s\n", $1, $2, $3}' || echo "  unavailable"
  printf '\n'

  printf '\033[1mCluster Operators (Degraded/Progressing)\033[0m\n'
  oc get co --no-headers 2>/dev/null | awk '
    $3 != "True" || $4 == "True" || $5 == "True" {
      printf "  %-45s avail=%-6s prog=%-6s deg=%-6s\n", $1, $3, $4, $5
    }
  ' || true
  bad_count="$(oc get co --no-headers 2>/dev/null | awk '$3 != "True" || $4 == "True" || $5 == "True"' | wc -l)"
  if [[ "${bad_count:-0}" -eq 0 ]]; then
    printf '  \033[1;32mAll operators healthy\033[0m\n'
  fi
  printf '\n'

  printf '\033[1mPending CSRs\033[0m\n'
  csr_count="$(oc get csr --no-headers 2>/dev/null | grep -c Pending || true)"
  if [[ "${csr_count:-0}" -gt 0 ]]; then
    printf '  \033[1;33m%s pending\033[0m\n' "$csr_count"
  else
    printf '  none\n'
  fi

  sleep "$REFRESH"
done
OCPEOF
# Patch the refresh value into the OCP pane (single-quoted heredoc above)
sed -i "s|__REFRESH__|${REFRESH}|g" "${PANE_DIR}/ocp.sh"

# Pane 3 — Log tail
cat > "${PANE_DIR}/log.sh" <<'LOGEOF'
#!/usr/bin/env bash
LOG_PATH="__LOG_PATH__"
if [[ -f "$LOG_PATH" ]]; then
  exec tail -n 100 -F "$LOG_PATH"
else
  while [[ ! -f "$LOG_PATH" ]]; do
    printf 'Waiting for %s ...\n' "$LOG_PATH"
    sleep 5
  done
  exec tail -n 100 -F "$LOG_PATH"
fi
LOGEOF
sed -i "s|__LOG_PATH__|${LOG_PATH}|g" "${PANE_DIR}/log.sh"

chmod +x "${PANE_DIR}"/*.sh

# --- Build tmux session ---------------------------------------------------

if tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux kill-session -t "$SESSION"
fi

# Layout:
#   ┌─────────────────────────────────────────────┐
#   │  Runner Status + Progress Bars (6 lines)    │  pane 0
#   ├──────────────────┬──────────────────────────┤
#   │  Hypervisor VMs  │                          │
#   │     (pane 1)     │  Log Tail (pane 3)      │
#   ├──────────────────┤  full right column      │
#   │  OpenShift       │                          │
#   │     (pane 2)     │                          │
#   └──────────────────┴──────────────────────────┘

RUNNER_PANE_HEIGHT=6

# Start with runner full-width
tmux new-session -d -s "$SESSION" -x 200 -y 50 \
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

# All panes exist — now force absolute sizes, top pane first
tmux resize-pane -t "${SESSION}:0.0" -y "$RUNNER_PANE_HEIGHT"
# Left/right split: log gets 60%
tmux resize-pane -t "${SESSION}:0.3" -x 120
# VMs and OCP split evenly in left column
tmux resize-pane -t "${SESSION}:0.1" -y 21

# Focus on the runner pane
tmux select-pane -t "${SESSION}:0.0"

printf 'Launching dashboard session: %s (runner: %s)\n' "$SESSION" "$RUNNER_STEM"
printf 'Log: %s\n' "$LOG_PATH"

exec tmux attach -t "$SESSION"
