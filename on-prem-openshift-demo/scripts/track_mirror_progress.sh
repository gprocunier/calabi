#!/usr/bin/env bash
set -euo pipefail

LOG_PATH="${1:-/var/tmp/bastion-playbooks-onprem/mirror-registry.log}"
RC_PATH="${2:-/var/tmp/bastion-playbooks-onprem/mirror-registry.rc}"
PID_PATH="${PID_PATH:-/var/tmp/bastion-playbooks-onprem/mirror-registry.pid}"
REFRESH_SECONDS="${REFRESH_SECONDS:-5}"
ARCHIVE_ROOT="${ARCHIVE_ROOT:-/opt/openshift/oc-mirror-archive}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-/opt/openshift/oc-mirror}"
QUAY_ROOT="${QUAY_ROOT:-/opt/quay-install}"
MIRROR_HOST="${MIRROR_HOST:-172.16.0.20}"
MIRROR_USER="${MIRROR_USER:-cloud-user}"
MIRROR_SSH_KEY="${MIRROR_SSH_KEY:-/opt/openshift/secrets/id_ed25519}"

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

human_size() {
  local path="$1"
  if remote_ssh "test -e '$path'" >/dev/null 2>&1; then
    remote_ssh "du -sh '$path' 2>/dev/null | awk '{print \$1}'" 2>/dev/null || printf '%s' "-"
  else
    printf '%s' "-"
  fi
}

root_fs_stats() {
  remote_ssh "df -B1 --output=size,used,avail,pcent,target / | tail -n1" 2>/dev/null || echo "0 0 0 0% /"
}

percent_bar() {
  local percent="$1"
  local width=20
  local filled=$(( percent * width / 100 ))
  local empty=$(( width - filled ))
  printf '['
  printf '%0.s#' $(seq 1 "$filled")
  printf '%0.s.' $(seq 1 "$empty")
  printf ']'
}

storage_opinion() {
  local stats size used avail pcent mount
  read -r size used avail pcent mount <<<"$(root_fs_stats)"
  local percent="${pcent%%%}"
  local archive_bytes
  archive_bytes="$(remote_ssh "du -sb '$ARCHIVE_ROOT' 2>/dev/null | awk '{print \$1}'" 2>/dev/null || echo 0)"

  if (( avail <= 0 )); then
    printf '%s\n' "OPINION: no free space detected"
  elif (( percent >= 98 )); then
    printf '%s\n' "OPINION: critical risk of failure from low disk space"
  elif (( archive_bytes > 0 && avail < archive_bytes / 4 )); then
    printf '%s\n' "OPINION: likely to fail; remaining free space is too small for import headroom"
  elif (( percent >= 90 )); then
    printf '%s\n' "OPINION: high risk; very little free space remains"
  else
    printf '%s\n' "OPINION: space looks adequate for now"
  fi
}

recommended_sizes() {
  local archive_bytes
  archive_bytes="$(remote_ssh "du -sb '$ARCHIVE_ROOT' 2>/dev/null | awk '{print \$1}'" 2>/dev/null || echo 0)"
  if [[ -z "$archive_bytes" || "$archive_bytes" -le 0 ]]; then
    printf '%s\n' "  estimate: waiting for archive size"
    return
  fi

  local gib=$(( 1024 * 1024 * 1024 ))
  local m2d_safe_bytes=$(( archive_bytes + archive_bytes / 2 + 20 * gib ))
  local d2m_safe_bytes=$(( archive_bytes * 2 + archive_bytes / 2 + 20 * gib ))
  local same_host_recommended_bytes=$(( archive_bytes * 3 + 20 * gib ))

  printf '  m2d safe: ~%s\n' "$(numfmt --to=iec "$m2d_safe_bytes" 2>/dev/null || echo "$m2d_safe_bytes")"
  printf '  d2m safe on same host: ~%s\n' "$(numfmt --to=iec "$d2m_safe_bytes" 2>/dev/null || echo "$d2m_safe_bytes")"
  printf '  recommended disk for both on one host: ~%s\n' "$(numfmt --to=iec "$same_host_recommended_bytes" 2>/dev/null || echo "$same_host_recommended_bytes")"
}

quay_storage_size() {
  remote_ssh "sudo du -sh /var/lib/containers/storage/volumes/quay-storage/_data 2>/dev/null | awk '{print \$1}'" 2>/dev/null || printf '%s' "-"
}

completion_summary() {
  if [[ -f "$RC_PATH" ]] && [[ "$(cat "$RC_PATH" 2>/dev/null)" == "0" ]]; then
    printf 'Completion: mirror workflow finished successfully\n'
    printf '  archive size: %s\n' "$(human_size "$ARCHIVE_ROOT")"
    printf '  quay storage: %s\n' "$(quay_storage_size)"
  fi
}

file_count() {
  local path="$1"
  if remote_ssh "test -d '$path'" >/dev/null 2>&1; then
    remote_ssh "find '$path' -type f 2>/dev/null | wc -l | awk '{print \$1}'" 2>/dev/null || printf '%s' "0"
  else
    printf '%s' "0"
  fi
}

latest_task() {
  if [[ -f "$LOG_PATH" ]]; then
    awk '
      /^TASK \[/ { task=$0 }
      END {
        if (task != "") print task;
        else print "TASK [none yet]"
      }
    ' "$LOG_PATH"
  else
    printf '%s\n' "TASK [log file not present]"
  fi
}

latest_log_line() {
  if [[ -f "$LOG_PATH" ]]; then
    tac "$LOG_PATH" | awk 'NF { print; exit }'
  else
    printf '%s\n' "log file not present"
  fi
}

log_age_seconds() {
  if [[ -f "$LOG_PATH" ]]; then
    local now
    local modified
    now="$(date +%s)"
    modified="$(stat -c %Y "$LOG_PATH" 2>/dev/null || echo 0)"
    printf '%s\n' "$(( now - modified ))"
  else
    printf '%s\n' "-1"
  fi
}

task_age_seconds() {
  if [[ -f "$LOG_PATH" ]]; then
    local latest_task_line
    latest_task_line="$(grep -n '^TASK \[' "$LOG_PATH" | tail -n1 | cut -d: -f1)"
    if [[ -n "${latest_task_line:-}" ]]; then
      local task_file
      task_file="$(mktemp)"
      tail -n +"$latest_task_line" "$LOG_PATH" > "$task_file"
      local modified
      modified="$(stat -c %Y "$task_file" 2>/dev/null || echo 0)"
      rm -f "$task_file"
      printf '%s\n' "$(( $(date +%s) - modified ))"
      return
    fi
  fi
  printf '%s\n' "-1"
}

status_banner() {
  local runner
  local age
  runner="$(runner_state)"
  age="$(log_age_seconds)"

  if [[ "$runner" == completed* ]]; then
    printf '%s\n' "STATUS: completed"
  elif [[ "$age" -ge 0 && "$age" -le $(( REFRESH_SECONDS * 3 )) ]]; then
    printf '%s\n' "STATUS: active (log is updating)"
  elif [[ "$runner" == running* ]]; then
    printf '%s\n' "STATUS: running but waiting/no recent log updates"
  else
    printf '%s\n' "STATUS: idle or stalled"
  fi
}

runner_state() {
  if [[ -f "$RC_PATH" ]]; then
    printf 'completed (rc=%s)\n' "$(cat "$RC_PATH")"
    return
  fi

  if [[ -f "$PID_PATH" ]]; then
    local pid
    pid="$(cat "$PID_PATH" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      printf 'running (pid=%s)\n' "$pid"
      return
    fi
  fi

  local match
  match="$(pgrep -af 'ansible-playbook .*playbooks/lab/mirror-registry.yml' | head -n1 || true)"
  if [[ -n "$match" ]]; then
    printf 'running (%s)\n' "$match"
  else
    printf '%s\n' "not-running"
  fi
}

oc_mirror_state() {
  if remote_ssh "pgrep -af oc-mirror" >/tmp/track_mirror_progress.pgrep.$$ 2>/dev/null; then
    printf '%s\n' "active"
    cat /tmp/track_mirror_progress.pgrep.$$
  else
    printf '%s\n' "inactive"
  fi
  rm -f /tmp/track_mirror_progress.pgrep.$$
}

registry_containers() {
  remote_ssh "sudo podman ps --format '{{.Names}} {{.Status}}' 2>/dev/null | grep -E '^(quay-app|quay-redis|.*-infra) ' || true" || true
}

render() {
  if [[ -t 1 && -n "${TERM:-}" && "${TERM}" != "dumb" ]] && command -v clear >/dev/null 2>&1; then
    clear
  fi
  printf 'Mirror Progress Monitor\n'
  printf 'Time: %s\n' "$(date -Is)"
  printf '%s\n' "$(status_banner)"
  printf 'Runner: %s\n' "$(runner_state)"
  printf 'Latest Task: %s\n' "$(latest_task)"
  printf 'Task Age: %ss\n' "$(task_age_seconds)"
  printf 'Last Log Update: %ss ago\n' "$(log_age_seconds)"
  printf 'Latest Log Line: %s\n' "$(latest_log_line)"
  printf '\n'

  printf 'm2d / d2m Paths\n'
  printf '  archive:   %s (%s files)  %s\n' \
    "$ARCHIVE_ROOT" "$(file_count "$ARCHIVE_ROOT")" "$(human_size "$ARCHIVE_ROOT")"
  printf '  workspace: %s (%s files)  %s\n' \
    "$WORKSPACE_ROOT" "$(file_count "$WORKSPACE_ROOT")" "$(human_size "$WORKSPACE_ROOT")"
  printf '  quay:      %s  %s\n' \
    "$QUAY_ROOT" "$(human_size "$QUAY_ROOT")"
  printf '\n'

  local fs_size fs_used fs_avail fs_pcent fs_mount
  read -r fs_size fs_used fs_avail fs_pcent fs_mount <<<"$(root_fs_stats)"
  local fs_percent="${fs_pcent%%%}"
  printf 'Disk Capacity\n'
  printf '  root fs:   %s used / %s total, %s free, %s used %s\n' \
    "$(numfmt --to=iec "$fs_used" 2>/dev/null || echo "$fs_used")" \
    "$(numfmt --to=iec "$fs_size" 2>/dev/null || echo "$fs_size")" \
    "$(numfmt --to=iec "$fs_avail" 2>/dev/null || echo "$fs_avail")" \
    "$fs_pcent" "$(percent_bar "$fs_percent")"
  printf '  %s\n' "$(storage_opinion)"
  recommended_sizes
  completion_summary
  printf '\n'

  printf 'Mirror Guest\n'
  printf '  host: %s@%s\n' "$MIRROR_USER" "$MIRROR_HOST"
  printf '\n'

  printf 'oc-mirror\n'
  oc_mirror_state
  printf '\n'

  printf 'Registry Containers\n'
  registry_containers
  printf '\n'

  if [[ -f "$LOG_PATH" ]]; then
    printf 'Recent Log\n'
    tail -n 20 "$LOG_PATH"
  else
    printf 'Recent Log\n'
    printf '  %s\n' "log file not present"
  fi
}

while true; do
  render
  sleep "$REFRESH_SECONDS"
done
