#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_TARGET_ROOT="$(cd "${SOURCE_ROOT}/.." && pwd)/calabi-publish"
TARGET_ROOT="${1:-${CALABI_PUBLISH_ROOT:-${DEFAULT_TARGET_ROOT}}}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 69
  }
}

require_cmd rsync
require_cmd ansible-playbook
require_cmd rg

mkdir -p "${TARGET_ROOT}"

rsync -a --delete \
  --exclude=.git \
  --exclude=.ansible \
  --exclude=generated \
  --exclude=secrets \
  --exclude=__pycache__ \
  --exclude=_site \
  --exclude=calabi-notebooklm.md \
  --exclude=aws-metal-openshift-demo/inventory/group_vars/all/lab_credentials.yml \
  --exclude=on-prem-openshift-demo/inventory/group_vars/all/lab_credentials.yml \
  "${SOURCE_ROOT}/" "${TARGET_ROOT}/"

rm -f "${TARGET_ROOT}/on-prem-openshift-demo/inventory/overrides/"*.yml

cat > "${TARGET_ROOT}/aws-metal-openshift-demo/inventory/hosts.yml" <<'EOF'
---
all:
  children:
    aws_metal:
      hosts:
        metal-01:
          # Replace with the operator-reachable management address of virt-01
          # before running the lab.
          ansible_host: 192.0.2.10
          ansible_user: ec2-user
          ansible_ssh_private_key_file: ~/.ssh/id_ed25519
          ansible_ssh_common_args: >-
            -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
EOF

cat > "${TARGET_ROOT}/on-prem-openshift-demo/inventory/hosts.yml" <<'EOF'
---
all:
  children:
    aws_metal:
      hosts:
        metal-01:
          # Replace with the operator-reachable management address of the
          # on-prem virt-01 host before running the lab.
          ansible_host: 192.0.2.10
          ansible_user: root
          ansible_ssh_private_key_file: ~/.ssh/id_ed25519
          ansible_ssh_common_args: >-
            -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
EOF

for secret_path in \
  "${TARGET_ROOT}/aws-metal-openshift-demo/inventory/group_vars/all/lab_credentials.yml" \
  "${TARGET_ROOT}/on-prem-openshift-demo/inventory/group_vars/all/lab_credentials.yml"
do
  if [[ -e "${secret_path}" ]]; then
    echo "unsanitized secret survived export: ${secret_path}" >&2
    exit 1
  fi
done

for forbidden in \
  '52\.14\.239\.29' \
  '172\.18\.0\.209' \
  '/home/d00d/\.ssh/id_ed25519'
do
  if rg -n "${forbidden}" \
    "${TARGET_ROOT}/aws-metal-openshift-demo/inventory" \
    "${TARGET_ROOT}/on-prem-openshift-demo/inventory" >/dev/null 2>&1; then
    echo "forbidden publish value still present in exported inventory: ${forbidden}" >&2
    exit 1
  fi
done

(
  cd "${TARGET_ROOT}/aws-metal-openshift-demo"
  ansible-playbook playbooks/site-bootstrap.yml --syntax-check >/dev/null
  ansible-playbook playbooks/site-lab.yml --syntax-check >/dev/null
)

(
  cd "${TARGET_ROOT}/on-prem-openshift-demo"
  ansible-playbook playbooks/site-bootstrap.yml --syntax-check >/dev/null
  ansible-playbook playbooks/site-lab.yml --syntax-check >/dev/null
  ansible-playbook playbooks/site-precluster.yml --syntax-check >/dev/null
)

printf 'Exported sanitized publish tree to %s\n' "${TARGET_ROOT}"
