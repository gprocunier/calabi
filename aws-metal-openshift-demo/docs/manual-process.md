# Manual Process

Nearby docs:

<a href="./prerequisites.md"><kbd>&nbsp;&nbsp;PREREQUISITES&nbsp;&nbsp;</kbd></a>
<a href="./automation-flow.md"><kbd>&nbsp;&nbsp;AUTOMATION FLOW&nbsp;&nbsp;</kbd></a>
<a href="./host-resource-management.md"><kbd>&nbsp;&nbsp;RESOURCE MANAGEMENT&nbsp;&nbsp;</kbd></a>
<a href="./openshift-cluster-matrix.md"><kbd>&nbsp;&nbsp;CLUSTER MATRIX&nbsp;&nbsp;</kbd></a>
<a href="./orchestration-guide.md"><kbd>&nbsp;&nbsp;ORCHESTRATION GUIDE&nbsp;&nbsp;</kbd></a>
<a href="./README.md"><kbd>&nbsp;&nbsp;DOCS MAP&nbsp;&nbsp;</kbd></a>

Use this to walk the build by hand, teach the flow to someone else, or
sanity-check what Ansible is really doing.

If you are starting from zero, read
<a href="./prerequisites.md"><kbd>PREREQUISITES</kbd></a> first.

Keep these pages nearby while you use this runbook:

- <a href="./automation-flow.md"><kbd>AUTOMATION FLOW</kbd></a> for phase order and execution context
- <a href="./host-resource-management.md"><kbd>RESOURCE MANAGEMENT</kbd></a> for CPU pools, performance domains, and host-resize guidance

Do not read this as a byte-for-byte dump of every Ansible task. It is the
manual equivalent of the current project behavior and run order.

When bastion-native playbooks need to be rerun after local repository changes,
the staged repo on bastion is refreshed in place so `generated/` output is not
thrown away between runs.

> [!IMPORTANT]
> The validated support-services order changed. The current golden path is:
> build `bastion-01`, stage the project to bastion, optionally build
> `ad-01` with AD DS and AD CS, build `idm-01`, join the bastion to IdM, then
> continue with `mirror-registry`, OpenShift DNS, and cluster work. The legacy
> section numbering is retained below so older deep links do not break.

The command examples use these neutral placeholders:

- `<operator-ssh-key>`: the SSH private key used from the operator workstation
- `<hypervisor-public-ip>`: the reachable public IP of `virt-01`, preferably a
  persistent Elastic IP
- `<project-root>`: the local checkout of this project on the current execution host
- `<rhel10-image-path>`: the local RHEL 10.1 qcow2 image path on `virt-01`
- `<pull-secret-file>`: the local Red Hat pull-secret file
- `<operator-public-key>`: the SSH public key injected into guest cloud-init
- `<ec2-user-password-hash>`: a SHA-512 password hash for `ec2-user`
- `<lab-default-password>`: the default demonstration password used for guest
  cloud-init, IdM bootstrap, and related manual examples

### Where each step runs

| Steps | Where | What happens |
| --- | --- | --- |
| 1-13 | Operator workstation / `virt-01` | AWS stacks, hypervisor, bastion build, bastion staging |
| 13A-36 | `bastion-01` | optional AD, IdM, bastion join, mirror registry, DNS, cluster build, day-2, debugging |

> [!IMPORTANT]
> **Pick a side and stay on it.** Steps 1-13 run from the operator workstation
> against `virt-01`. Steps 13A-36 run from the bastion. The project does not
> account for switching execution context mid-stream. Once you cross the
> bastion boundary at step 13A, stay on bastion.

## Table Of Contents

Use this like a runbook, not a novel. Jump to the phase you actually need.

### Outer Cloud And Host Bring-up

- [1. Provision The AWS IaaS Layer](#1-provision-the-aws-iaas-layer)
- [2. Verify First-Boot Access To `virt-01`](#2-verify-first-boot-access-to-virt-01)
- [3. Install Deterministic `/dev/ebs` Host Naming](#3-install-deterministic-devebs-host-naming)
- [4. Prepare The Hypervisor](#4-prepare-the-hypervisor)
- [5. Remove The Default Libvirt Network](#5-remove-the-default-libvirt-network)
- [6. Create The Lab Switch And VLAN Interfaces](#6-create-the-lab-switch-and-vlan-interfaces)
- [7. Configure Firewalld And Host Routing](#7-configure-firewalld-and-host-routing)
- [8. Define The Libvirt Network Over OVS](#8-define-the-libvirt-network-over-ovs)
- [9. Stage The Guest Base Image](#9-stage-the-guest-base-image)

### Support Services

Validated support-services order:

- [12. Build The Bastion VM](#12-build-the-bastion-vm)
- [13. Stage The Project To The Bastion](#13-stage-the-project-to-the-bastion)
- [13A. Optionally Build AD DS And AD CS From Bastion](#13a-optionally-build-ad-ds-and-ad-cs-from-bastion)
- [10. Build The IdM VM](#10-build-the-idm-vm)
- [11. Configure IdM In The Guest](#11-configure-idm-in-the-guest)
- [13B. Join The Bastion To IdM](#13b-join-the-bastion-to-idm)
- [14. Build The Mirror Registry VM](#14-build-the-mirror-registry-vm)
- [15. Mirror OpenShift And Operator Content](#15-mirror-openshift-and-operator-content)
- [16. Populate OpenShift DNS In IdM](#16-populate-openshift-dns-in-idm)

Legacy section order retained below:

- [10. Build The IdM VM](#10-build-the-idm-vm)
- [11. Configure IdM In The Guest](#11-configure-idm-in-the-guest)
- [12. Build The Bastion VM](#12-build-the-bastion-vm)
- [13. Stage The Project To The Bastion](#13-stage-the-project-to-the-bastion)
- [13A. Optionally Build AD DS And AD CS From Bastion](#13a-optionally-build-ad-ds-and-ad-cs-from-bastion)
- [13B. Join The Bastion To IdM](#13b-join-the-bastion-to-idm)
- [14. Build The Mirror Registry VM](#14-build-the-mirror-registry-vm)
- [15. Mirror OpenShift And Operator Content](#15-mirror-openshift-and-operator-content)
- [16. Populate OpenShift DNS In IdM](#16-populate-openshift-dns-in-idm)

### Cluster Bring-up

- [17. Download Installer Binaries](#17-download-installer-binaries)
- [18. Render Install Artifacts](#18-render-install-artifacts)
- [19. Generate The Agent ISO](#19-generate-the-agent-iso)
- [20. Create The OpenShift VM Shells](#20-create-the-openshift-vm-shells)
- [21. Wait For Installer Convergence](#21-wait-for-installer-convergence)
- [22. Validate Post-install State](#22-validate-post-install-state)
- [23. Detach Install Media And Normalize Boot](#23-detach-install-media-and-normalize-boot)

### Day-2 And Follow-on Work

- [24. Configure LDAP Auth, Group Sync, And Infra Roles](#24-configure-ldap-auth-group-sync-and-infra-roles)
- [25. Install Kubernetes NMState](#25-install-kubernetes-nmstate)
- [26. Deploy ODF Declaratively](#26-deploy-odf-declaratively)
- [27. Install OpenShift Virtualization](#27-install-openshift-virtualization)
- [28. Install The Web Terminal](#28-install-the-web-terminal)
- [29. Install Network Observability And Loki](#29-install-network-observability-and-loki)
- [30. Install Ansible Automation Platform](#30-install-ansible-automation-platform)
- [31. Install OpenShift Pipelines](#31-install-openshift-pipelines)
- [32. Launch A Windows EFI Build](#32-launch-a-windows-efi-build)
- [33. Pivot OperatorHub To The Disconnected Catalog](#33-pivot-operatorhub-to-the-disconnected-catalog)
- [34. Roll Out An IdM Ingress Certificate](#34-roll-out-an-idm-ingress-certificate)
- [35. Cleanup](#35-cleanup)
- [36. Manual Debugging Examples](#36-manual-debugging-examples)

## 1. Provision The AWS IaaS Layer

_This section describes the AWS IaaS steps modeled by `cloudformation/templates/tenant.yaml.j2`, `cloudformation/templates/virt-host.yaml.j2`, and the legacy `cloudformation/templates/virt-lab.yaml.j2`, rendered by `cloudformation/render-virt-lab.py`, and deployed by `cloudformation/deploy-stack.sh` or `cloudformation/deploy-virt-lab.sh`._

For a full fresh environment, create the tenant substrate first, then create
the host substrate inside it. For a later `virt-01` rebuild inside an existing
tenant, only repeat the host stack.

```bash
cd <project-root>

cat <<'EOF' >cloudformation/parameters.tenant.json
[
  { "ParameterKey": "LabPrefix", "ParameterValue": "workshop" },
  { "ParameterKey": "AvailabilityZone", "ParameterValue": "us-east-2a" },
  { "ParameterKey": "VpcCidr", "ParameterValue": "10.0.0.0/16" },
  { "ParameterKey": "PublicSubnetCidr", "ParameterValue": "10.0.0.0/20" }
]
EOF

./cloudformation/deploy-stack.sh tenant virt-tenant cloudformation/parameters.tenant.json

aws cloudformation describe-stacks \
  --stack-name virt-tenant \
  --query 'Stacks[0].Outputs'

cat <<'EOF' >cloudformation/parameters.host.json
[
  { "ParameterKey": "LabPrefix", "ParameterValue": "workshop" },
  { "ParameterKey": "AvailabilityZone", "ParameterValue": "us-east-2a" },
  { "ParameterKey": "ExistingVpcId", "ParameterValue": "vpc-REPLACE_FROM_VIRT_TENANT_OUTPUTS" },
  { "ParameterKey": "ExistingSubnetId", "ParameterValue": "subnet-REPLACE_FROM_VIRT_TENANT_OUTPUTS" },
  { "ParameterKey": "PersistentPublicIpAllocationId", "ParameterValue": "eipalloc-REPLACE_FROM_VIRT_TENANT_OUTPUTS" },
  { "ParameterKey": "VirtHostPrivateIp", "ParameterValue": "10.0.8.207" },
  { "ParameterKey": "AdminIngressCidr", "ParameterValue": "0.0.0.0/0" },
  { "ParameterKey": "VirtHostInstanceType", "ParameterValue": "m5.metal" },
  { "ParameterKey": "RedHatRhelPrivateAmiId", "ParameterValue": "ami-REPLACE_WITH_RHEL_10_1_AMI" },
  { "ParameterKey": "ImportedKeyPairName", "ParameterValue": "virt-lab-key" },
  { "ParameterKey": "ImportedPublicKeyMaterial", "ParameterValue": "ssh-ed25519 AAAA_REPLACE_WITH_REAL_PUBLIC_KEY" },
  { "ParameterKey": "Ec2UserPasswordHash", "ParameterValue": "<ec2-user-password-hash>" },
  { "ParameterKey": "RootVolumeSizeGiB", "ParameterValue": "100" },
  { "ParameterKey": "RootVolumeIops", "ParameterValue": "3000" },
  { "ParameterKey": "RootVolumeThroughput", "ParameterValue": "125" }
]
EOF

./cloudformation/deploy-stack.sh host virt-host cloudformation/parameters.host.json

aws cloudformation describe-stacks \
  --stack-name virt-host \
  --query 'Stacks[0].Outputs'
```

## 2. Verify First-Boot Access To `virt-01`

_This section describes the first-boot cloud-init behavior modeled by the CloudFormation host templates and the follow-on host bootstrap expectations used by `playbooks/bootstrap/site.yml`._

Verify that cloud-init completed, the operator SSH key was installed for
`ec2-user`, and Cockpit was enabled for SOCKS-proxied browser access.

```bash
ssh -i <operator-ssh-key> ec2-user@<hypervisor-public-ip> 'hostnamectl; systemctl is-active cockpit.socket'

# Example SOCKS proxy for Cockpit access without opening TCP/9090 in the security group.
ssh -i <operator-ssh-key> -D 5555 ec2-user@<hypervisor-public-ip>

# Browser configuration:
#   SOCKS5 proxy: 127.0.0.1:5555
#   Proxy DNS through SOCKS: enabled
#   Cockpit URL: https://<hypervisor-public-ip>:9090/
#
# Authenticate to Cockpit as:
#   user: ec2-user
#   password: the plaintext corresponding to <ec2-user-password-hash>
```

Fresh AWS RHEL images can still leave `ec2-user` locked even when a password
hash is present. The orchestration now explicitly unlocks the account. The
manual equivalent is:

```bash
ssh -i <operator-ssh-key> ec2-user@<hypervisor-public-ip> 'sudo usermod -U ec2-user'
```

Ensure the hypervisor identity is correct.

```bash
ssh -i <operator-ssh-key> ec2-user@<hypervisor-public-ip> <<'EOF'
sudo hostnamectl set-hostname virt-01.workshop.lan
grep -q '^127.0.1.1 virt-01.workshop.lan virt-01$' /etc/hosts || \
  echo '127.0.1.1 virt-01.workshop.lan virt-01' | sudo tee -a /etc/hosts
EOF
```

## 3. Install Deterministic `/dev/ebs` Host Naming

_This section describes the inventory-driven `/dev/ebs/*` naming steps performed by `playbooks/bootstrap/site.yml`, primarily in the `lab_host_base` role._

Derive the active guest-disk map from the current AWS attachments by
`GuestDisk` tag, then render the host naming layer from that live map. This
avoids stale EBS volume IDs after a rebuild.

```bash
sudo install -d -m 0755 /dev/ebs

cat <<'EOF' | sudo tee /etc/tmpfiles.d/ebs-friendly.conf
d /dev/ebs 0755 root root -
EOF

sudo systemd-tmpfiles --create /etc/tmpfiles.d/ebs-friendly.conf

INSTANCE_ID="$(curl -fsS http://169.254.169.254/latest/meta-data/instance-id)"
aws ec2 describe-volumes \
  --filters Name=attachment.instance-id,Values=${INSTANCE_ID} \
           Name=tag-key,Values=GuestDisk \
  --query "Volumes[].{volume_id:VolumeId,guest_disk:Tags[?Key=='GuestDisk']|[0].Value}" \
  --output json >/tmp/guest-volumes.json

python3 - <<'PY' | sudo tee /etc/udev/rules.d/99-ebs-friendly.rules
import json
from pathlib import Path

vols = json.loads(Path('/tmp/guest-volumes.json').read_text())
print('# Managed from live AWS GuestDisk-tagged attachments.')
for vol in sorted(vols, key=lambda v: v['guest_disk']):
    serial = vol['volume_id'].replace('-', '')
    guest = vol['guest_disk']
    print(
        f'ACTION=="add|change", SUBSYSTEM=="block", ENV{{DEVTYPE}}=="disk", '
        f'KERNEL=="nvme*n1", ENV{{ID_MODEL}}=="Amazon Elastic Block Store", '
        f'ENV{{ID_SERIAL_SHORT}}=="{serial}", SYMLINK+="ebs/{guest}"'
    )
PY

sudo udevadm control --reload-rules
sudo udevadm trigger --subsystem-match=block --action=change
sudo udevadm settle
ls -1 /dev/ebs
```

## 4. Prepare The Hypervisor

_This section describes the steps performed by `playbooks/bootstrap/site.yml`, primarily the `lab_host_base` role._

Install the required host packages, enable the Red Hat fast-datapath repo for
OVS, and turn on the core host services.

```bash
ssh -i <operator-ssh-key> ec2-user@<hypervisor-public-ip>
sudo -i

timeout 30s subscription-manager repos \
  --enable fast-datapath-for-rhel-10-x86_64-rpms

dnf -y install insights-client
insights-client --register

dnf -y install \
  firewalld \
  qemu-kvm \
  qemu-img \
  libvirt \
  virt-install \
  virt-viewer \
  virt-top \
  guestfs-tools \
  genisoimage \
  openvswitch3.6 \
  cockpit \
  cockpit-files \
  cockpit-machines \
  cockpit-podman \
  cockpit-session-recording \
  cockpit-image-builder \
  pcp \
  pcp-system-tools \
  tmux \
  jq

dnf -y update
reboot

systemctl enable --now firewalld
systemctl enable --now cockpit.socket
systemctl enable --now openvswitch
systemctl enable --now osbuild-composer.socket
systemctl enable --now pmcd.service pmlogger.service pmproxy.service
systemctl enable --now virtqemud.socket
systemctl enable --now virtnetworkd.socket
systemctl enable --now virtstoraged.socket
systemctl enable --now virtlogd.socket
```

### Apply The Host Resource-Management Policy

_This subsection describes the steps performed by `playbooks/bootstrap/site.yml`,
primarily the `lab_host_resource_management` role._

The current settled design keeps manager-level systemd `CPUAffinity` and the
Gold/Silver/Bronze slice units, but it does not set kernel affinity boot args
or an `irqbalance` guest-domain ban by default.

```bash
cat <<'EOF' >/etc/systemd/system.conf.d/90-aws-metal-openshift-demo-host-resource-management.conf
[Manager]
DefaultCPUAccounting=yes
CPUAffinity=0-5,24-29,48-53,72-77
EOF

cat <<'EOF' >/etc/systemd/system/machine-gold.slice
[Unit]
Description=Gold performance domain for prioritized VMs

[Slice]
CPUAccounting=yes
CPUWeight=512
EOF

cat <<'EOF' >/etc/systemd/system/machine-silver.slice
[Unit]
Description=Silver performance domain for medium-priority VMs

[Slice]
CPUAccounting=yes
CPUWeight=333
EOF

cat <<'EOF' >/etc/systemd/system/machine-bronze.slice
[Unit]
Description=Bronze performance domain for best-effort VMs

[Slice]
CPUAccounting=yes
CPUWeight=167
EOF

systemctl daemon-reload
systemctl daemon-reexec
```

Validate the current host-policy shape.

```bash
grep -E '^(DefaultCPUAccounting|CPUAffinity)=' \
  /etc/systemd/system.conf.d/90-aws-metal-openshift-demo-host-resource-management.conf

systemctl show machine-gold.slice machine-silver.slice machine-bronze.slice \
  -p CPUAccounting -p CPUWeight

grep Cpus_allowed_list /proc/1/status
cat /proc/cmdline
```

Expected current state:

- PID 1 allowed on `0-5,24-29,48-53,72-77`
- `machine-gold.slice`, `machine-silver.slice`, and `machine-bronze.slice`
  installed with weights `512`, `333`, and `167`
- no `systemd.cpu_affinity=` or `irqaffinity=` kernel arguments

### Apply The Host Memory-Oversubscription Policy

_This subsection describes the steps performed by `playbooks/bootstrap/site.yml`,
primarily the `lab_host_memory_oversubscription` role. The same role can be
re-applied independently using `playbooks/bootstrap/host-memory-oversubscription.yml`
without re-running the full bootstrap sequence. The orchestration source of truth
for all memory-policy defaults is `vars/global/host_memory_oversubscription.yml`._

The memory-overcommit policy is kept separate from CPU placement. It improves
host RAM efficiency through three independent kernel mechanisms:

- **zram** compressed swap — an in-memory block device that stores anonymous
  pages in compressed form, giving the kernel a cheap place to park cold pages
  before direct reclaim gets expensive
- **THP** in `madvise` mode — Transparent Huge Pages only when applications
  explicitly request them, avoiding background compaction stalls
- **KSM** with conservative scan settings — Kernel Same-page Merging
  deduplicates identical memory pages across guests running the same OS image

> [!IMPORTANT]
> `zram-size = 16G` is not a 16 GiB reservation taken away from the host up
> front. The device only consumes physical RAM as compressed pages are stored
> in it. With `zstd` compression the typical effective ratio is 2:1 to 4:1,
> so 16G of logical swap capacity costs roughly 4-8G of physical RAM when
> fully utilized.

> [!NOTE]
> This is most useful when the host is calm or moderately busy. It helps the
> kernel avoid harsher reclaim behavior and can smooth out bursty pressure, but
> it is not a substitute for enough real RAM at high contention.

> [!WARNING]
> Compression, deduplication, and reclaim are CPU work that runs in the host
> kernel, not inside the Gold/Silver/Bronze tier model. If you lean harder on
> memory overcommit, expect some host cycles to move from idle capacity into
> memory management before you see any change in guest throughput.

#### zram

The role creates a systemd oneshot service that manages the zram device
explicitly using `zramctl`. This avoids relying on `systemd-zram-generator`
and keeps all three memory subsystems in a single service unit.

```bash
# Load the zram kernel module
modprobe zram num_devices=1

# Configure the device with zstd compression and 16G capacity
zramctl /dev/zram0 --algorithm zstd --size 16G

# Format and activate as swap with high priority
mkswap -f /dev/zram0
swapon --priority 100 --discard /dev/zram0
```

The swap priority of `100` ensures zram is always preferred over any physical
swap device. The `--discard` flag enables TRIM so that freed pages are
immediately released back to the host.

#### THP

```bash
echo madvise > /sys/kernel/mm/transparent_hugepage/enabled
echo madvise > /sys/kernel/mm/transparent_hugepage/defrag
```

Setting both to `madvise` means the kernel only allocates and compacts huge
pages when the application explicitly requests them via `madvise(MADV_HUGEPAGE)`.
This avoids the pathological case where `always` mode triggers aggressive
`khugepaged` compaction against memory that no process benefits from.

#### KSM

```bash
echo 1000 > /sys/kernel/mm/ksm/pages_to_scan
echo 20   > /sys/kernel/mm/ksm/sleep_millisecs
echo 1    > /sys/kernel/mm/ksm/run
```

The scan settings are deliberately conservative: 1000 pages per cycle with a
20 ms pause. The first full scan pass across all guest memory is slow (minutes
to hours on a fully deployed lab), but once the internal dedup tree is built
the steady-state CPU cost is near zero.

#### Wrap It In A Persistent Service

Rather than running these commands ad-hoc, the role installs a systemd
oneshot service so the policy survives reboot.

```bash
cat <<'EOF' >/etc/systemd/system/calabi-host-memory-oversubscription.service
[Unit]
Description=Apply Calabi host memory oversubscription policy
After=local-fs.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStartPre=-/usr/sbin/swapoff /dev/zram0
ExecStartPre=-/usr/sbin/zramctl --reset /dev/zram0
ExecStartPre=-/usr/sbin/modprobe -r zram
ExecStartPre=/usr/sbin/modprobe zram num_devices=1
ExecStart=/usr/sbin/zramctl /dev/zram0 --algorithm zstd --size 16G
ExecStart=/usr/sbin/mkswap -f /dev/zram0
ExecStart=/usr/sbin/swapon --priority 100 --discard /dev/zram0
ExecStop=-/usr/sbin/swapoff /dev/zram0
ExecStop=-/usr/sbin/zramctl --reset /dev/zram0
ExecStop=-/usr/sbin/modprobe -r zram
ExecStart=/usr/bin/bash -lc '\
if [ -e /sys/kernel/mm/transparent_hugepage/enabled ]; then echo madvise > /sys/kernel/mm/transparent_hugepage/enabled; fi; \
if [ -e /sys/kernel/mm/transparent_hugepage/defrag ]; then echo madvise > /sys/kernel/mm/transparent_hugepage/defrag; fi; \
if [ -e /sys/kernel/mm/ksm/pages_to_scan ]; then echo 1000 > /sys/kernel/mm/ksm/pages_to_scan; fi; \
if [ -e /sys/kernel/mm/ksm/sleep_millisecs ]; then echo 20 > /sys/kernel/mm/ksm/sleep_millisecs; fi; \
if [ -e /sys/kernel/mm/ksm/run ]; then echo 1 > /sys/kernel/mm/ksm/run; fi; \
true'

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now calabi-host-memory-oversubscription.service
```

#### Validate The Memory-Oversubscription State

```bash
# Service state
systemctl is-enabled calabi-host-memory-oversubscription.service
systemctl is-active calabi-host-memory-oversubscription.service

# zram device and swap
zramctl
swapon --show

# THP mode
cat /sys/kernel/mm/transparent_hugepage/enabled
cat /sys/kernel/mm/transparent_hugepage/defrag

# KSM state
cat /sys/kernel/mm/ksm/run
cat /sys/kernel/mm/ksm/pages_to_scan
cat /sys/kernel/mm/ksm/sleep_millisecs
```

Expected current state:

- service is enabled and active
- `zramctl` shows `/dev/zram0` with `zstd` algorithm and `16G` disk size
- `swapon` shows `/dev/zram0` at priority `100`
- THP enabled shows `[madvise]` (bracketed = active selection)
- THP defrag shows `[madvise]`
- KSM `run` is `1`, pages and sleep match the configured values

#### Monitor KSM Effectiveness

KSM deduplication savings grow over time as the scanner finds identical pages
across guests. Check convergence after the cluster is fully deployed and idle:

```bash
# Pages shared (unique pages backing merged regions)
cat /sys/kernel/mm/ksm/pages_shared

# Pages sharing (total pages being deduplicated, including copies)
cat /sys/kernel/mm/ksm/pages_sharing

# Pages not yet merged
cat /sys/kernel/mm/ksm/pages_unshared
```

If `pages_sharing` significantly exceeds `pages_shared`, KSM is saving
meaningful memory. If `pages_unshared` remains high relative to `pages_sharing`
for extended periods, the scan rate may be too conservative.

The project includes a monitoring script for continuous observation:

```bash
<project-root>/scripts/host-memory-overcommit-status.py \
  --host <hypervisor-public-ip> --user ec2-user
```

Use `--watch 30` for a live dashboard or `--delta 60` for a before-and-after
comparison across an interval.

The rationale is not to squeeze masters or infra. It is to improve host RAM
efficiency while keeping Bronze workers as the primary elasticity lever.

## 5. Remove The Default Libvirt Network

_This section describes the steps performed by `playbooks/bootstrap/site.yml`, primarily the `lab_libvirt` role._

Remove `virbr0` so the lab only uses the explicit OVS/libvirt design.

```bash
virsh net-destroy default || true
virsh net-autostart default --disable || true
virsh net-undefine default || true
```

## 6. Create The Lab Switch And VLAN Interfaces

_This section describes the steps performed by `playbooks/bootstrap/site.yml`, primarily the `lab_switch` role._

Create the OVS bridge, create the routed VLAN interfaces, and bring them up.

```bash
cat <<'EOF' >/usr/local/sbin/aws-metal-openshift-demo-net.sh
#!/usr/bin/env bash
set -euo pipefail

ovs-vsctl --may-exist add-br lab-switch

for vlan in 100 200 201 202 300 301 302; do
  ovs-vsctl --may-exist add-port lab-switch vlan${vlan} \
    -- set interface vlan${vlan} type=internal
done

ip link set lab-switch up
for vlan in 100 200 201 202 300 301 302; do
  ip link set vlan${vlan} up
done

ip address replace 172.16.0.1/24 dev vlan100
ip address replace 172.16.10.1/24 dev vlan200
ip address replace 172.16.11.1/24 dev vlan201
ip address replace 172.16.12.1/24 dev vlan202
ip address replace 172.16.20.1/24 dev vlan300
ip address replace 172.16.21.1/24 dev vlan301
EOF

chmod 0755 /usr/local/sbin/aws-metal-openshift-demo-net.sh
/usr/local/sbin/aws-metal-openshift-demo-net.sh

cat <<'EOF' >/etc/systemd/system/aws-metal-openshift-demo-net.service
[Unit]
Description=AWS metal OpenShift demo network
After=network-online.target openvswitch.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/aws-metal-openshift-demo-net.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now aws-metal-openshift-demo-net.service
```

## 7. Configure Firewalld And Host Routing

_This section describes the steps performed by `playbooks/bootstrap/site.yml`, primarily the `lab_firewall` role._

Create the lab firewall zone, enable forwarding, and NAT the lab out of the
host uplink.

```bash
firewall-cmd --permanent --new-zone=lab || true
firewall-cmd --permanent --zone=external --add-interface=enp125s0

for iface in vlan100 vlan200 vlan201 vlan202 vlan300 vlan301; do
  firewall-cmd --permanent --zone=lab --add-interface=${iface}
done

firewall-cmd --permanent --zone=external --add-masquerade
firewall-cmd --reload

cat <<'EOF' >/etc/sysctl.d/99-aws-metal-openshift-demo.conf
net.ipv4.ip_forward = 1
EOF

sysctl --system
```

## 8. Define The Libvirt Network Over OVS

_This section describes the steps performed by `playbooks/bootstrap/site.yml`, primarily the `lab_libvirt` role._

Define the `lab-switch` libvirt network and the portgroups used by the VMs.

```bash
cat <<'EOF' >/etc/libvirt/lab-switch.xml
<network>
  <name>lab-switch</name>
  <forward mode='bridge'/>
  <bridge name='lab-switch'/>
  <virtualport type='openvswitch'/>

  <portgroup name='mgmt-access' default='no'>
    <vlan>
      <tag id='100'/>
    </vlan>
  </portgroup>

  <portgroup name='ocp-trunk' default='no'>
    <vlan trunk='yes'>
      <tag id='200'/>
      <tag id='201'/>
      <tag id='202'/>
    </vlan>
  </portgroup>

  <portgroup name='data300-access' default='no'>
    <vlan>
      <tag id='300'/>
    </vlan>
  </portgroup>

  <portgroup name='data301-access' default='no'>
    <vlan>
      <tag id='301'/>
    </vlan>
  </portgroup>

  <portgroup name='data302-access' default='no'>
    <vlan>
      <tag id='302'/>
    </vlan>
  </portgroup>
</network>
EOF

virsh net-define /etc/libvirt/lab-switch.xml
virsh net-start lab-switch
virsh net-autostart lab-switch
```

## 9. Stage The Guest Base Image

_This section describes the guest-image staging logic performed by `playbooks/bootstrap/site.yml` after the main `virt-01` OS bootstrap work is complete. The current automation intentionally waits until RHSM registration, repo enablement, package updates, and any required reboot have finished before downloading or copying the RHEL guest QCOW2 to the hypervisor._

> [!NOTE]
> This image is the seed for every support VM. If the wrong image lands here,
> every guest built from this point forward inherits the problem.

Place the RHEL KVM guest image on the hypervisor so the support VMs can be
seeded onto their raw EBS devices.

```bash
mkdir -p /root/images
cp <rhel10-image-path> /root/images/rhel-10.1-x86_64-kvm.qcow2
```

When a Red Hat direct-download URL is available, the same image can be pulled
straight to the hypervisor instead of being copied from the operator
workstation.

```bash
mkdir -p /root/images
curl -L '<rhel10-kvm-direct-download-url>' \
  -o /root/images/rhel-10.1-x86_64-kvm.qcow2
```

## 10. Build The IdM VM

_This section describes the hypervisor-side steps performed by `playbooks/bootstrap/idm.yml`, primarily the `idm` role. In the current validated flow, it runs from `bastion-01` after bastion staging and after the optional AD build when enabled._

Seed the `idm-01` disk from the RHEL image, create cloud-init, and build the
VM on the management VLAN.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1

mkdir -p /var/lib/aws-metal-openshift-demo/idm-01
qemu-img convert -f qcow2 -O raw \
  <rhel10-image-path> \
  /dev/ebs/idm-01

SSH_PUBKEY="$(cat <operator-public-key>)"

cat <<'EOF' >/var/lib/aws-metal-openshift-demo/idm-01/meta-data
instance-id: idm-01
local-hostname: idm-01.workshop.lan
EOF

cat <<'EOF' >/var/lib/aws-metal-openshift-demo/idm-01/network-config
version: 2
ethernets:
  eth0:
    dhcp4: false
    addresses:
      - 172.16.0.10/24
    routes:
      - to: 0.0.0.0/0
        via: 172.16.0.1
    nameservers:
      search: [workshop.lan]
      addresses: [172.16.0.10, 8.8.8.8, 4.4.4.4]
EOF

cat <<EOF >/var/lib/aws-metal-openshift-demo/idm-01/user-data
#cloud-config
fqdn: idm-01.workshop.lan
manage_etc_hosts: true
users:
  - default
  - name: cloud-user
    groups: [wheel]
    sudo: ALL=(ALL) NOPASSWD:ALL
    lock_passwd: false
    passwd: $6$rounds=4096$temporary$BfY4OskkM6jv8v6eK9aT8W7F7Y9Q8nN2m5vQzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz
    ssh_authorized_keys:
      - ${SSH_PUBKEY}
runcmd:
  - [ sh, -c, 'echo nameserver 127.0.0.1 >/etc/resolv.conf' ]
EOF

cloud-localds \
  --network-config=/var/lib/aws-metal-openshift-demo/idm-01/network-config \
  /var/lib/aws-metal-openshift-demo/idm-01/seed.iso \
  /var/lib/aws-metal-openshift-demo/idm-01/user-data \
  /var/lib/aws-metal-openshift-demo/idm-01/meta-data

virt-install \
  --name idm-01.workshop.lan \
  --memory 8192 \
  --vcpus 2 \
  --cpu host-passthrough \
  --machine q35 \
  --import \
  --os-variant rhel10.0 \
  --graphics none \
  --console pty,target_type=serial \
  --network network=lab-switch,portgroup=mgmt-access,model=virtio \
  --controller type=scsi,model=virtio-scsi \
  --disk path=/dev/ebs/idm-01,device=disk,bus=scsi,rotation_rate=1 \
  --disk path=/var/lib/aws-metal-openshift-demo/idm-01/seed.iso,device=cdrom,bus=sata \
  --resource partition=/machine/silver \
  --cputune shares=333,emulatorpin.cpuset=2-5,26-29,50-53,74-77,\
vcpupin0.vcpu=0,vcpupin0.cpuset=6-23,30-47,54-71,78-95,\
vcpupin1.vcpu=1,vcpupin1.cpuset=6-23,30-47,54-71,78-95 \
  --noautoconsole
```

That places `idm-01` into the Silver performance domain:

- partition: `/machine/silver`
- shares: `333`
- vCPU threads: `guest_domain`
- emulator thread: `host_emulator`

The current automation also prefers a guest `poweroff` plus host-side
`virsh start` for the first post-update cycle so cloud-init media cleanup in
persistent XML becomes the next live device model immediately, instead of
surviving as an empty CD-ROM through an in-guest reboot.

## 11. Configure IdM In The Guest

_This section describes the guest-side steps performed by `playbooks/bootstrap/idm.yml`, primarily the `idm_guest` role. In the validated bastion-first flow, the bastion performs this work after the hypervisor-side IdM build completes._

Update the guest, install IdM, enable Cockpit and session recording, and create
the core users and groups used by OpenShift.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key cloud-user@172.16.0.10
sudo -i

dnf -y update
reboot

dnf -y install \
  ipa-server \
  ipa-server-dns \
  idm-pki-kra \
  ipa-server-trust-ad \
  cockpit \
  cockpit-files \
  cockpit-networkmanager \
  cockpit-podman \
  tlog \
  sssd \
  oddjob \
  oddjob-mkhomedir \
  insights-client \
  authselect-compat

insights-client --register

firewall-cmd --permanent --add-service=cockpit
firewall-cmd --permanent --add-service=dns
firewall-cmd --permanent --add-service=freeipa-4
firewall-cmd --permanent --add-service=freeipa-trust
firewall-cmd --reload

ipa-server-install -U \
  --realm=WORKSHOP.LAN \
  --domain=workshop.lan \
  --hostname=idm-01.workshop.lan \
  --ds-password='<lab-default-password>' \
  --admin-password='<lab-default-password>' \
  --setup-dns \
  --auto-forwarders \
  --no-host-dns

kinit admin <<< '<lab-default-password>'
ipa-kra-install -U -p '<lab-default-password>'

ipa dnsconfig-mod --forwarder=8.8.8.8 --forwarder=1.1.1.1
ipa group-add openshift-admin || true
ipa group-add virt-admin || true
ipa group-add developer || true

ipa group-add admins || true
ipa pwpolicy-add admins \
  --maxlife=3650 --minlife=0 --history=0 --minclasses=0 --minlength=8 \
  --priority=40 2>/dev/null || \
ipa pwpolicy-mod admins \
  --maxlife=3650 --minlife=0 --history=0 --minclasses=0 --minlength=8 \
  --priority=40

ipa pwpolicy-add openshift-admin \
  --maxlife=3650 --minlife=0 --history=0 --minclasses=0 --minlength=8 \
  --priority=50 2>/dev/null || \
ipa pwpolicy-mod openshift-admin \
  --maxlife=3650 --minlife=0 --history=0 --minclasses=0 --minlength=8 \
  --priority=50

ipa pwpolicy-add virt-admin \
  --maxlife=3650 --minlife=0 --history=0 --minclasses=0 --minlength=8 \
  --priority=60 2>/dev/null || \
ipa pwpolicy-mod virt-admin \
  --maxlife=3650 --minlife=0 --history=0 --minclasses=0 --minlength=8 \
  --priority=60

ipa pwpolicy-add developer \
  --maxlife=3650 --minlife=0 --history=0 --minclasses=0 --minlength=8 \
  --priority=70 2>/dev/null || \
ipa pwpolicy-mod developer \
  --maxlife=3650 --minlife=0 --history=0 --minclasses=0 --minlength=8 \
  --priority=70

ipa user-add sysop --first=Sys --last=Op --shell=/bin/bash --password <<< '<lab-default-password>'
ipa user-add virtadm --first=Virt --last=Admin --shell=/bin/bash --password <<< '<lab-default-password>'
ipa user-add dev --first=Dev --last=User --shell=/bin/bash --password <<< '<lab-default-password>'

ipa user-mod sysop --setattr=krbPasswordExpiration=20360313235039Z
ipa user-mod virtadm --setattr=krbPasswordExpiration=20360313235039Z
ipa user-mod dev --setattr=krbPasswordExpiration=20360313235039Z

ipa dnsrecord-add workshop.lan virt-01 --a-rec=172.16.0.1 2>/dev/null || \
ipa dnsrecord-mod workshop.lan virt-01 --a-rec=172.16.0.1
ipa dnszone-add 0.16.172.in-addr.arpa \
  --name-server=idm-01.workshop.lan. \
  --admin-email=hostmaster.workshop.lan \
  --dynamic-update=FALSE 2>/dev/null || true
ipa dnsrecord-add 0.16.172.in-addr.arpa 1 \
  --ptr-rec=virt-01.workshop.lan. 2>/dev/null || \
ipa dnsrecord-mod 0.16.172.in-addr.arpa 1 \
  --ptr-rec=virt-01.workshop.lan.

cat <<'EOF' >/etc/named/ipa-ext.conf
/* User customization for BIND named */
acl "trusted_network" {
  localhost;
  localnets;
  172.16.0.0/24;
  172.16.10.0/24;
  172.16.11.0/24;
  172.16.12.0/24;
  172.16.20.0/24;
  172.16.21.0/24;
  172.16.22.0/24;
};
EOF

cat <<'EOF' >/etc/named/ipa-options-ext.conf
/* User customization for BIND named */
listen-on-v6 { any; };
dnssec-validation yes;
allow-query { trusted_network; };
allow-recursion { trusted_network; };
allow-query-cache { trusted_network; };
EOF

named-checkconf /etc/named.conf
systemctl restart named
systemctl is-active named

ipa group-add-member admins --users=sysop
ipa group-add-member openshift-admin --users=sysop
ipa group-add-member virt-admin --users=virtadm
ipa group-add-member developer --users=dev

ipa sudorule-add admins-nopasswd-all \
  --desc='Permit admins group members to run any command on any host without authentication'
ipa sudorule-mod admins-nopasswd-all --hostcat=all
ipa sudorule-mod admins-nopasswd-all --cmdcat=all
ipa sudorule-mod admins-nopasswd-all --runasusercat=all
ipa sudorule-mod admins-nopasswd-all --runasgroupcat=all
ipa sudorule-add-user admins-nopasswd-all --groups=admins
ipa sudorule-add-option admins-nopasswd-all --sudooption='!authenticate'

systemctl enable --now cockpit.socket
systemctl enable --now oddjobd.service
authselect select sssd with-tlog with-mkhomedir with-sudo --force
systemctl restart sssd
sss_cache -E
sssctl domain-status workshop.lan
```

## 12. Build The Bastion VM

_This section describes the hypervisor-side steps performed by `playbooks/bootstrap/bastion.yml`, primarily the `bastion` role._

Create the bastion on VLAN 100. This becomes the execution host for the rest of
the lab.

> [!NOTE]
> The validated flow builds the bastion before IdM. The initial bastion build
> does not enroll the guest into IdM. That enrollment now happens later in
> [13B. Join The Bastion To IdM](#13b-join-the-bastion-to-idm).

```bash
mkdir -p /var/lib/aws-metal-openshift-demo/bastion-01
qemu-img convert -f qcow2 -O raw \
  <rhel10-image-path> \
  /dev/ebs/bastion-01

SSH_PUBKEY="$(cat <operator-public-key>)"

cat <<'EOF' >/var/lib/aws-metal-openshift-demo/bastion-01/meta-data
instance-id: bastion-01
local-hostname: bastion-01.workshop.lan
EOF

cat <<'EOF' >/var/lib/aws-metal-openshift-demo/bastion-01/network-config
version: 2
ethernets:
  eth0:
    dhcp4: false
    addresses:
      - 172.16.0.30/24
    routes:
      - to: 0.0.0.0/0
        via: 172.16.0.1
    nameservers:
      search: [workshop.lan]
      addresses: [172.16.0.10, 8.8.8.8, 4.4.4.4]
EOF

cat <<EOF >/var/lib/aws-metal-openshift-demo/bastion-01/user-data
#cloud-config
fqdn: bastion-01.workshop.lan
manage_etc_hosts: true
users:
  - default
  - name: cloud-user
    groups: [wheel]
    sudo: ALL=(ALL) NOPASSWD:ALL
    lock_passwd: false
    passwd: $6$rounds=4096$temporary$BfY4OskkM6jv8v6eK9aT8W7F7Y9Q8nN2m5vQzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz
    ssh_authorized_keys:
      - ${SSH_PUBKEY}
EOF

cloud-localds \
  --network-config=/var/lib/aws-metal-openshift-demo/bastion-01/network-config \
  /var/lib/aws-metal-openshift-demo/bastion-01/seed.iso \
  /var/lib/aws-metal-openshift-demo/bastion-01/user-data \
  /var/lib/aws-metal-openshift-demo/bastion-01/meta-data

virt-install \
  --name bastion-01.workshop.lan \
  --memory 16384 \
  --vcpus 4 \
  --cpu host-passthrough \
  --machine q35 \
  --import \
  --os-variant rhel10.0 \
  --graphics none \
  --console pty,target_type=serial \
  --network network=lab-switch,portgroup=mgmt-access,model=virtio \
  --controller type=scsi,model=virtio-scsi \
  --disk path=/dev/ebs/bastion-01,device=disk,bus=scsi,rotation_rate=1 \
  --disk path=/var/lib/aws-metal-openshift-demo/bastion-01/seed.iso,device=cdrom,bus=sata \
  --resource partition=/machine/bronze \
  --cputune shares=167,emulatorpin.cpuset=2-5,26-29,50-53,74-77,\
vcpupin0.vcpu=0,vcpupin0.cpuset=6-23,30-47,54-71,78-95,\
vcpupin1.vcpu=1,vcpupin1.cpuset=6-23,30-47,54-71,78-95,\
vcpupin2.vcpu=2,vcpupin2.cpuset=6-23,30-47,54-71,78-95,\
vcpupin3.vcpu=3,vcpupin3.cpuset=6-23,30-47,54-71,78-95 \
  --noautoconsole

ssh -i <operator-ssh-key> cloud-user@172.16.0.30 \
  "sudo dnf -y install \
     git ansible-core ansible-lint jq podman wget tar make insights-client \
     cockpit-files cockpit-packagekit cockpit-podman \
     cockpit-session-recording cockpit-image-builder \
     pcp pcp-system-tools oddjob oddjob-mkhomedir; \
   sudo insights-client --register; \
   sudo systemctl enable --now cockpit.socket; \
   sudo systemctl enable --now osbuild-composer.socket; \
   sudo systemctl enable --now pmcd pmlogger pmproxy; \
   sudo systemctl enable --now oddjobd"
```

That places `bastion-01` into the Bronze performance domain.

The current automation uses the same support-guest lifecycle as IdM: when the
first package update requires a restart, the guest powers off, the seed media
is cleaned from persistent XML while the domain is down, and the hypervisor
starts the domain again.

## 13. Stage The Project To The Bastion

_This section describes the steps performed by `playbooks/bootstrap/bastion-stage.yml`, primarily the `bastion_stage` role._

> [!IMPORTANT]
> This is the last step that runs from the operator workstation. After staging
> completes, all remaining work runs from `bastion-01`. Do not criss-cross
> between workstation and bastion for subsequent steps.

Copy the repo, the pull secret, and the SSH keys to the bastion so the rest of
the work happens from inside the lab. The current orchestration also creates a
ready-to-use shell environment for `cloud-user` and current IdM `admins`
members, including `$HOME/bin`, `$HOME/etc`, tool symlinks, and a login-time
`KUBECONFIG` export when the cluster artifacts exist.

The bastion staging phase also installs the execution-time Python requirements
needed for Windows orchestration, including `pywinrm`.

```bash
rsync -a --delete \
  --exclude generated \
  --exclude secrets \
  -e "ssh -i <operator-ssh-key>" \
  <project-root>/ \
  cloud-user@172.16.0.30:/tmp/aws-metal-openshift-demo/

scp -i <operator-ssh-key> <pull-secret-file> cloud-user@172.16.0.30:/tmp/pull-secret.txt
scp -i <operator-ssh-key> <operator-ssh-key> cloud-user@172.16.0.30:/tmp/hypervisor-admin.key
scp -i <operator-ssh-key> <operator-public-key> cloud-user@172.16.0.30:/tmp/hypervisor-admin.pub

ssh -i <operator-ssh-key> cloud-user@172.16.0.30 <<'EOF'
sudo mkdir -p /opt/openshift /opt/openshift/secrets
sudo rsync -a --delete \
  --exclude generated \
  --exclude secrets \
  /tmp/aws-metal-openshift-demo/ /opt/openshift/aws-metal-openshift-demo/
sudo mv /tmp/pull-secret.txt /opt/openshift/secrets/pull-secret.txt
sudo mv /tmp/hypervisor-admin.key /opt/openshift/secrets/hypervisor-admin.key
sudo mv /tmp/hypervisor-admin.pub /opt/openshift/secrets/hypervisor-admin.pub
sudo chmod 0600 /opt/openshift/secrets/hypervisor-admin.key
sudo chown -R cloud-user:cloud-user /opt/openshift
sudo dnf -y install python3-pip
sudo python3 -m pip install -r /opt/openshift/aws-metal-openshift-demo/requirements-pip.txt
EOF
```

After the cluster artifacts exist, the manual equivalent of the helper layout
is:

```bash
ssh -i <operator-ssh-key> cloud-user@172.16.0.30 <<'EOF'
set -euo pipefail
mkdir -p "$HOME/bin" "$HOME/etc"
ln -sfn /opt/openshift/aws-metal-openshift-demo/generated/tools/4.20.15/bin/oc "$HOME/bin/oc"
ln -sfn /opt/openshift/aws-metal-openshift-demo/generated/tools/4.20.15/bin/kubectl "$HOME/bin/kubectl"
ln -sfn /opt/openshift/aws-metal-openshift-demo/generated/tools/4.20.15/bin/openshift-install "$HOME/bin/openshift-install"
ln -sfn /usr/local/bin/track-mirror-progress "$HOME/bin/track-mirror-progress"
ln -sfn /usr/local/bin/track-mirror-progress-tmux "$HOME/bin/track-mirror-progress-tmux"
ln -sfn /opt/openshift/aws-metal-openshift-demo/scripts/run_bastion_playbook.sh "$HOME/bin/run-bastion-playbook"
ln -sfn /opt/openshift/aws-metal-openshift-demo/generated/ocp/auth/kubeconfig "$HOME/etc/kubeconfig"
ln -sfn /opt/openshift/aws-metal-openshift-demo/generated/ocp/idm-ca.crt "$HOME/etc/idm-ca.crt"
cat <<'PROFILE' | sudo tee /etc/profile.d/openshift-bastion.sh >/dev/null
case ":$PATH:" in
  *":$HOME/bin:"*) ;;
  *) PATH="$HOME/bin:$PATH" ;;
esac
case ":$PATH:" in
  *":/opt/openshift/aws-metal-openshift-demo/generated/tools/4.20.15/bin:"*) ;;
  *) PATH="/opt/openshift/aws-metal-openshift-demo/generated/tools/4.20.15/bin:$PATH" ;;
esac
if [ -z "${KUBECONFIG:-}" ] && [ -r "$HOME/etc/kubeconfig" ]; then
  export KUBECONFIG="$HOME/etc/kubeconfig"
fi
PROFILE
EOF
```

### Iterative Development With `push_and_run.sh`

After the initial staging, use the lightweight `scripts/push_and_run.sh` helper
for iterative code changes. It rsyncs only the role/playbook/vars tree
(excluding `inventory/`, `secrets/`, and `generated/` — all of which have
bastion-specific content that must not be overwritten) and runs the specified
playbook in a single blocking call.

For normal operator reruns of bastion-native playbooks, prefer
`scripts/run_remote_bastion_playbook.sh`. It refreshes the full staged tree
first and matches the documented golden path more closely than the lightweight
developer helper.

```bash
# From the operator workstation
cd <project-root>
./scripts/push_and_run.sh playbooks/day2/openshift-post-install-infra.yml
./scripts/push_and_run.sh playbooks/day2/openshift-post-install-ldap-auth.yml -e some_override=true
```

The script:

- syncs only code changes (not generated artifacts, secrets, or inventory)
- runs the playbook as `cloud-user` on the bastion in a blocking foreground
  SSH session
- shows only `PLAY RECAP` on success
- dumps the full output on failure

This reduces the edit → sync → run → check cycle to a single command.

**Token optimization for AI-assisted development:**

When using an AI assistant to develop against this codebase:

- **Batch all code edits locally before syncing.** Get the code right by
  reading it and reasoning about correctness, then sync and run once. Do not
  iterate through the bastion.
- **Check PLAY RECAP first.** Only read the full playbook log on failure.
  `push_and_run.sh` does this automatically.
- **Do not debug runtime infrastructure issues through the AI.** SSH key
  loading failures, SELinux context mismatches, and service connectivity
  problems are faster and cheaper to debug in a terminal. Report the findings
  back and let the AI adjust the code.
- **Use the right model tier for the task.** Use a reasoning-heavy model for
  planning, doc rewrites, and multi-source investigations. Switch to a faster
  model for mechanical execution: running playbooks, committing, syncing.

## 13A. Optionally Build AD DS And AD CS From Bastion

_This section describes the manual equivalent of the validated `ad-server` path. Unlike the automation docs, this section is written as a true operator runbook: prepare media on `virt-01`, create the VM, complete the first boot, then configure AD DS and AD CS directly inside Windows._

> [!IMPORTANT]
> This phase is optional and default-disabled in automation:
> `lab_build_ad_server: false`. Enable it only when you want the lab AD DS /
> AD CS server.

> [!NOTE]
> Before enabling this path, download Windows Server 2025 evaluation media from
> the Microsoft Evaluation Center:
> https://www.microsoft.com/en-us/evalcenter/download-windows-server-2025
> The currently validated selection is `English (United States)` ->
> `ISO download` -> `64-bit edition`.

The manual path below follows the same validated design as the automated AD
build:

- install Windows Server 2025 onto `/dev/ebs/ad-01`
- use `virtio-win.iso` for the required storage and network drivers
- complete the remaining guest-tools and virtio-driver work after the OS is up
- promote the server to `corp.lan`
- install AD CS and Web Enrollment
- seed the demo users and groups
- export the root CA

Validated guest identity:

- VM/domain: `ad-01.corp.lan`
- Windows hostname: `AD-01`
- IPv4: `172.16.0.40/24`
- gateway: `172.16.0.1`
- DNS: `172.16.0.10`, `8.8.8.8`

### Confirm The Required Media On `virt-01`

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1
ls -l /root/images/26100.32230.260111-0550.lt_release_svc_refresh_SERVER_EVAL_x64FRE_en-us.iso
ls -l /root/images/virtio-win.iso
ls -l /dev/ebs/ad-01
exit
```

If `virtio-win.iso` is not already staged, the current documented source is:

- `virtio-win` driver installation guidance:
  - https://virtio-win.github.io/Knowledge-Base/Driver-installation.html
- direct ISO download referenced there:
  - https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/latest-virtio/virtio-win.iso

### Prepare The Unattended Install Media On `virt-01`

Create a small `OEMDRV` ISO that provides the answer file to Windows Setup.
This keeps the manual path aligned with the validated unattended install.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
set -euo pipefail

mkdir -p /var/lib/aws-metal-openshift-demo/ad-01/autounattend
install -o qemu -g qemu -m 0644 \
  /root/images/26100.32230.260111-0550.lt_release_svc_refresh_SERVER_EVAL_x64FRE_en-us.iso \
  /var/lib/aws-metal-openshift-demo/ad-01/26100.32230.260111-0550.lt_release_svc_refresh_SERVER_EVAL_x64FRE_en-us.iso
install -o qemu -g qemu -m 0644 \
  /root/images/virtio-win.iso \
  /var/lib/aws-metal-openshift-demo/ad-01/virtio-win.iso
cat >/var/lib/aws-metal-openshift-demo/ad-01/autounattend/autounattend.xml <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="windowsPE">
    <component name="Microsoft-Windows-International-Core-WinPE"
               processorArchitecture="amd64"
               publicKeyToken="31bf3856ad364e35"
               language="neutral"
               versionScope="nonSxS">
      <SetupUILanguage><UILanguage>en-US</UILanguage></SetupUILanguage>
      <InputLocale>en-US</InputLocale>
      <SystemLocale>en-US</SystemLocale>
      <UILanguage>en-US</UILanguage>
      <UserLocale>en-US</UserLocale>
    </component>
    <component name="Microsoft-Windows-PnpCustomizationsWinPE"
               processorArchitecture="amd64"
               publicKeyToken="31bf3856ad364e35"
               language="neutral"
               versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <DriverPaths>
        <PathAndCredentials wcm:action="add" wcm:keyValue="1">
          <Path>E:\vioscsi\2k25\amd64</Path>
        </PathAndCredentials>
        <PathAndCredentials wcm:action="add" wcm:keyValue="2">
          <Path>E:\NetKVM\2k25\amd64</Path>
        </PathAndCredentials>
      </DriverPaths>
    </component>
    <component name="Microsoft-Windows-Setup"
               processorArchitecture="amd64"
               publicKeyToken="31bf3856ad364e35"
               language="neutral"
               versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <DiskConfiguration>
        <Disk wcm:action="add">
          <DiskID>0</DiskID>
          <WillWipeDisk>true</WillWipeDisk>
          <CreatePartitions>
            <CreatePartition wcm:action="add"><Order>1</Order><Size>260</Size><Type>EFI</Type></CreatePartition>
            <CreatePartition wcm:action="add"><Order>2</Order><Size>128</Size><Type>MSR</Type></CreatePartition>
            <CreatePartition wcm:action="add"><Order>3</Order><Extend>true</Extend><Type>Primary</Type></CreatePartition>
          </CreatePartitions>
          <ModifyPartitions>
            <ModifyPartition wcm:action="add"><Order>1</Order><PartitionID>1</PartitionID><Format>FAT32</Format><Label>EFI</Label></ModifyPartition>
            <ModifyPartition wcm:action="add"><Order>2</Order><PartitionID>2</PartitionID></ModifyPartition>
            <ModifyPartition wcm:action="add"><Order>3</Order><PartitionID>3</PartitionID><Format>NTFS</Format><Label>Windows</Label><Letter>C</Letter></ModifyPartition>
          </ModifyPartitions>
        </Disk>
      </DiskConfiguration>
      <ImageInstall>
        <OSImage>
          <InstallTo><DiskID>0</DiskID><PartitionID>3</PartitionID></InstallTo>
          <InstallFrom>
            <MetaData wcm:action="add"><Key>/IMAGE/INDEX</Key><Value>2</Value></MetaData>
          </InstallFrom>
        </OSImage>
      </ImageInstall>
      <UserData>
        <AcceptEula>true</AcceptEula>
        <ProductKey><WillShowUI>Never</WillShowUI></ProductKey>
      </UserData>
    </component>
  </settings>
  <settings pass="specialize">
    <component name="Microsoft-Windows-Shell-Setup"
               processorArchitecture="amd64"
               publicKeyToken="31bf3856ad364e35"
               language="neutral"
               versionScope="nonSxS">
      <ComputerName>AD-01</ComputerName>
      <TimeZone>UTC</TimeZone>
    </component>
    <component name="Microsoft-Windows-TerminalServices-LocalSessionManager"
               processorArchitecture="amd64"
               publicKeyToken="31bf3856ad364e35"
               language="neutral"
               versionScope="nonSxS">
      <fDenyTSConnections>false</fDenyTSConnections>
    </component>
  </settings>
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-International-Core"
               processorArchitecture="amd64"
               publicKeyToken="31bf3856ad364e35"
               language="neutral"
               versionScope="nonSxS">
      <InputLocale>en-US</InputLocale>
      <SystemLocale>en-US</SystemLocale>
      <UILanguage>en-US</UILanguage>
      <UserLocale>en-US</UserLocale>
    </component>
    <component name="Microsoft-Windows-Shell-Setup"
               processorArchitecture="amd64"
               publicKeyToken="31bf3856ad364e35"
               language="neutral"
               versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <OOBE>
        <HideEULAPage>true</HideEULAPage>
        <HideLocalAccountScreen>true</HideLocalAccountScreen>
        <HideOEMRegistrationScreen>true</HideOEMRegistrationScreen>
        <HideOnlineAccountScreens>true</HideOnlineAccountScreens>
        <HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE>
        <ProtectYourPC>3</ProtectYourPC>
        <SkipMachineOOBE>true</SkipMachineOOBE>
        <SkipUserOOBE>true</SkipUserOOBE>
      </OOBE>
      <UserAccounts>
        <AdministratorPassword>
          <Value>REPLACE_WITH_LAB_DEFAULT_PASSWORD</Value>
          <PlainText>true</PlainText>
        </AdministratorPassword>
      </UserAccounts>
      <AutoLogon>
        <Enabled>true</Enabled>
        <Username>Administrator</Username>
        <Password>
          <Value>REPLACE_WITH_LAB_DEFAULT_PASSWORD</Value>
          <PlainText>true</PlainText>
        </Password>
        <LogonCount>3</LogonCount>
      </AutoLogon>
      <FirstLogonCommands>
        <SynchronousCommand wcm:action="add">
          <Order>1</Order>
          <CommandLine>powershell -NoProfile -Command "Set-ExecutionPolicy RemoteSigned -Force"</CommandLine>
          <Description>Set PowerShell execution policy</Description>
        </SynchronousCommand>
        <SynchronousCommand wcm:action="add">
          <Order>2</Order>
          <CommandLine>powershell -NoProfile -Command "$adapter = Get-NetAdapter | Where-Object { $_.Status -ne 'Disabled' } | Sort-Object ifIndex | Select-Object -First 1; Get-NetIPAddress -InterfaceAlias $adapter.Name -AddressFamily IPv4 -ErrorAction SilentlyContinue | Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue; New-NetIPAddress -InterfaceAlias $adapter.Name -IPAddress '172.16.0.40' -PrefixLength 24 -DefaultGateway '172.16.0.1'; Set-DnsClientServerAddress -InterfaceAlias $adapter.Name -ServerAddresses @('172.16.0.10','8.8.8.8')"</CommandLine>
          <Description>Configure static IPv4 networking</Description>
        </SynchronousCommand>
        <SynchronousCommand wcm:action="add">
          <Order>3</Order>
          <CommandLine>powershell -NoProfile -Command "Set-DnsClientGlobalSetting -SuffixSearchList @('corp.lan')"</CommandLine>
          <Description>Set the DNS suffix search list</Description>
        </SynchronousCommand>
        <SynchronousCommand wcm:action="add">
          <Order>4</Order>
          <CommandLine>powershell -NoProfile -Command "Enable-PSRemoting -Force -SkipNetworkProfileCheck"</CommandLine>
          <Description>Enable PowerShell remoting</Description>
        </SynchronousCommand>
        <SynchronousCommand wcm:action="add">
          <Order>5</Order>
          <CommandLine>powershell -NoProfile -Command "Set-Item WSMan:\localhost\Service\Auth\Basic -Value $true"</CommandLine>
          <Description>Enable WinRM basic auth</Description>
        </SynchronousCommand>
        <SynchronousCommand wcm:action="add">
          <Order>6</Order>
          <CommandLine>powershell -NoProfile -Command "Set-Item WSMan:\localhost\Service\AllowUnencrypted -Value $true"</CommandLine>
          <Description>Allow unencrypted WinRM for lab</Description>
        </SynchronousCommand>
        <SynchronousCommand wcm:action="add">
          <Order>7</Order>
          <CommandLine>powershell -NoProfile -Command "New-NetFirewallRule -DisplayName 'WinRM HTTP' -Direction Inbound -Protocol TCP -LocalPort 5985 -Action Allow"</CommandLine>
          <Description>Open WinRM firewall port</Description>
        </SynchronousCommand>
        <SynchronousCommand wcm:action="add">
          <Order>8</Order>
          <CommandLine>powershell -NoProfile -Command "Restart-Service WinRM"</CommandLine>
          <Description>Restart WinRM service</Description>
        </SynchronousCommand>
        <SynchronousCommand wcm:action="add">
          <Order>9</Order>
          <CommandLine>reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v AutoAdminLogon /t REG_SZ /d 0 /f</CommandLine>
          <Description>Disable auto-logon</Description>
        </SynchronousCommand>
      </FirstLogonCommands>
    </component>
  </settings>
</unattend>
XML

sed -i "s/REPLACE_WITH_LAB_DEFAULT_PASSWORD/<lab-default-password>/g" \
  /var/lib/aws-metal-openshift-demo/ad-01/autounattend/autounattend.xml

xorriso -as mkisofs \
  -o /var/lib/aws-metal-openshift-demo/ad-01/ad-01-autounattend.iso \
  -V OEMDRV -J -R -graft-points \
  autounattend.xml=/var/lib/aws-metal-openshift-demo/ad-01/autounattend/autounattend.xml

chown qemu:qemu /var/lib/aws-metal-openshift-demo/ad-01/ad-01-autounattend.iso
EOF
```

### Create The VM On `virt-01`

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
set -euo pipefail

dd if=/dev/zero of=/dev/ebs/ad-01 bs=1M count=1 conv=notrunc

virt-install \
  --name ad-01.corp.lan \
  --osinfo win2k25 \
  --boot uefi,loader_secure=no \
  --machine q35 \
  --memory 8192 \
  --vcpus 4 \
  --cpu host-passthrough \
  --controller type=scsi,model=virtio-scsi \
  --controller type=virtio-serial,index=0 \
  --disk path=/dev/ebs/ad-01,format=raw,bus=scsi,cache=none,io=native,discard=unmap,rotation_rate=1,boot_order=2 \
  --disk path=/var/lib/aws-metal-openshift-demo/ad-01/26100.32230.260111-0550.lt_release_svc_refresh_SERVER_EVAL_x64FRE_en-us.iso,device=cdrom,readonly=on,boot_order=1 \
  --disk path=/var/lib/aws-metal-openshift-demo/ad-01/virtio-win.iso,device=cdrom,readonly=on \
  --disk path=/var/lib/aws-metal-openshift-demo/ad-01/ad-01-autounattend.iso,device=cdrom,readonly=on \
  --network network=lab-switch,portgroup=mgmt-access,model=virtio,mac=52:54:00:50:01:05 \
  --channel unix,target_type=virtio,name=org.qemu.guest_agent.0 \
  --rng builtin \
  --graphics vnc,listen=0.0.0.0 \
  --console pty,target_type=serial \
  --autostart \
  --resource partition=/machine/bronze \
  --cputune shares=167,emulatorpin.cpuset=2-5,26-29,50-53,74-77,\
vcpupin0.vcpu=0,vcpupin0.cpuset=6-23,30-47,54-71,78-95,\
vcpupin1.vcpu=1,vcpupin1.cpuset=6-23,30-47,54-71,78-95,\
vcpupin2.vcpu=2,vcpupin2.cpuset=6-23,30-47,54-71,78-95,\
vcpupin3.vcpu=3,vcpupin3.cpuset=6-23,30-47,54-71,78-95 \
  --noautoconsole
EOF
```

Use the Cockpit console or `virt-viewer` to watch first boot. On the validated
media path, UEFI may present a DVD boot menu first. If it does:

- choose the first DVD entry
- at `Press any key to boot from CD or DVD`, press `Enter`

Windows should then:

- load the boot-critical `vioscsi` and `NetKVM` drivers from `virtio-win.iso`
- partition `/dev/ebs/ad-01`
- install Server 2025
- come up as `AD-01`
- apply the static IP and WinRM settings from `autounattend.xml`

### Verify First WinRM Reachability

From the bastion:

```bash
curl -sI http://172.16.0.40:5985/wsman | head -n 1
```

You should see an HTTP response from `Microsoft-HTTPAPI/2.0`, which confirms
that the WinRM listener is up.

### Install Remaining Virtio Components And Guest Agent

Log in to the Windows console as `Administrator`, open an elevated PowerShell,
locate the virtio media drive letter, then install the guest-tools bundle, the
remaining drivers, and the QEMU guest agent:

```powershell
$virtio = Get-PSDrive -PSProvider FileSystem |
  ForEach-Object { $_.Root.TrimEnd('\') } |
  Where-Object { Test-Path "$_\guest-agent\qemu-ga-x86_64.msi" } |
  Select-Object -First 1

msiexec /i "$virtio\virtio-win-gt-x64.msi" /qn /norestart

pnputil /add-driver "$virtio\Balloon\2k25\amd64\*.inf" /install
pnputil /add-driver "$virtio\qemufwcfg\2k25\amd64\*.inf" /install
pnputil /add-driver "$virtio\vioserial\2k25\amd64\*.inf" /install
pnputil /add-driver "$virtio\viorng\2k25\amd64\*.inf" /install

msiexec /i "$virtio\guest-agent\qemu-ga-x86_64.msi" /qn /norestart
$svc = Get-Service | Where-Object {
  $_.Name -in @('QEMU-GA', 'qemu-ga') -or
  $_.DisplayName -like '*QEMU*Guest*Agent*'
} | Select-Object -First 1
Set-Service -Name $svc.Name -StartupType Automatic
Start-Service -Name $svc.Name
Get-CimInstance Win32_Service -Filter "Name='$($svc.Name)'"
```

### Promote The Server To `corp.lan`

Still in elevated PowerShell on `AD-01`:

```powershell
Install-WindowsFeature AD-Domain-Services,DNS -IncludeManagementTools

Install-ADDSForest `
  -DomainName 'corp.lan' `
  -DomainNetbiosName 'CORP' `
  -SafeModeAdministratorPassword (ConvertTo-SecureString '<lab-default-password>' -AsPlainText -Force) `
  -InstallDns `
  -Force
```

Let the server reboot. After it comes back, verify domain-controller state:

```powershell
Get-ADDomainController
Get-ADDomain
```

### Configure DNS Forwarding And AD CS

```powershell
Add-DnsServerConditionalForwarderZone `
  -Name 'workshop.lan' `
  -MasterServers @('172.16.0.10') `
  -ReplicationScope Forest

Install-WindowsFeature AD-Certificate,ADCS-Cert-Authority,ADCS-Web-Enrollment -IncludeManagementTools

Install-AdcsCertificationAuthority `
  -CAType EnterpriseRootCA `
  -CryptoProviderName 'RSA#Microsoft Software Key Storage Provider' `
  -KeyLength 4096 `
  -HashAlgorithmName SHA256 `
  -CACommonName 'CORP Enterprise Root CA' `
  -ValidityPeriod Years `
  -ValidityPeriodUnits 10 `
  -Force

Install-AdcsWebEnrollment -Force
certutil -ping
```

### Seed The Demo Groups And Users

```powershell
$base = 'CN=Users,DC=corp,DC=lan'

'OpenShift-Admins',
'OpenShift-Virt-Admins',
'Ansible-Automation-Admins',
'Developers' | ForEach-Object {
  if (-not (Get-ADGroup -Filter "Name -eq '$_'" -ErrorAction SilentlyContinue)) {
    New-ADGroup -Name $_ -GroupScope Global -GroupCategory Security -Path $base
  }
}

$users = @(
  @{ name='ad-directoryadmin'; first='Directory';     last='Admin';         groups=@('Domain Admins') },
  @{ name='ad-ocpadmin';      first='OpenShift';     last='Admin';         groups=@('OpenShift-Admins') },
  @{ name='ad-virtadmin';     first='Virtualization';last='Admin';         groups=@('OpenShift-Virt-Admins') },
  @{ name='ad-aapadmin';      first='Automation';    last='Admin';         groups=@('Ansible-Automation-Admins') },
  @{ name='ad-dev01';         first='Developer';     last='One';           groups=@('Developers') }
)

$pw = ConvertTo-SecureString '<lab-default-password>' -AsPlainText -Force
foreach ($u in $users) {
  if (-not (Get-ADUser -Filter "SamAccountName -eq '$($u.name)'" -ErrorAction SilentlyContinue)) {
    New-ADUser `
      -Name "$($u.first) $($u.last)" `
      -GivenName $u.first `
      -Surname $u.last `
      -SamAccountName $u.name `
      -UserPrincipalName "$($u.name)@corp.lan" `
      -AccountPassword $pw `
      -Enabled $true `
      -PasswordNeverExpires $true `
      -Path $base
  }
  foreach ($group in $u.groups) {
    $members = Get-ADGroupMember -Identity $group -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty SamAccountName
    if ($members -notcontains $u.name) {
      Add-ADGroupMember -Identity $group -Members $u.name
    }
  }
}
```

### Open The Required Windows Firewall Groups

```powershell
$displayGroups = @(
  'DNS Service',
  'Kerberos Key Distribution Center',
  'Active Directory Domain Services',
  'Certification Authority',
  'Windows Remote Management'
)

foreach ($group in $displayGroups) {
  $rules = Get-NetFirewallRule | Where-Object { $_.DisplayGroup -eq $group }
  if ($rules) {
    $rules | Enable-NetFirewallRule
  }
}
```

### Export The AD Root CA And Validate Final State

```powershell
certutil -ca.cert C:\Windows\Temp\corp-root-ca.cer
Get-ADDomain
Get-ADDomainController
Get-Service CertSvc
```

From `virt-01`, detach the installation media once the guest configuration is
complete:

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
for target in $(virsh domblklist ad-01.corp.lan --details | awk '$2 == "cdrom" { print $3 }'); do
  virsh change-media ad-01.corp.lan "$target" --eject --config --live --force || true
done
EOF
```

Validated AD outputs:

- AD domain: `corp.lan`
- Enterprise Root CA: `CORP Enterprise Root CA`
- groups:
  - `OpenShift-Admins`
  - `OpenShift-Virt-Admins`
  - `Ansible-Automation-Admins`
  - `Developers`
- users:
  - `ad-directoryadmin`
  - `ad-ocpadmin`
  - `ad-virtadmin`
  - `ad-aapadmin`
  - `ad-dev01`

Quick verification from the bastion and hypervisor:

```bash
curl -sI http://172.16.0.40:5985/wsman | head -n 1
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 'virsh domstate ad-01.corp.lan'
```

## 13B. Join The Bastion To IdM

_This section describes the manual equivalent of the bastion IdM-enrollment phase. At this point `bastion-01` already exists and `idm-01` is already configured. The remaining work is to trust the active IdM CA, enroll the bastion as an IPA client, and enable the authselect features used by the rest of the lab._

From `bastion-01`, make sure the active IdM CA is trusted locally before the
client install:

```bash
curl -o /tmp/idm-ca.crt http://idm-01.workshop.lan/ipa/config/ca.crt
sudo install -o root -g root -m 0644 \
  /tmp/idm-ca.crt /etc/ipa/ca.crt
sudo install -o root -g root -m 0644 \
  /tmp/idm-ca.crt /etc/pki/ca-trust/source/anchors/idm-rootCA.pem
sudo update-ca-trust extract
```

Enroll the bastion into IdM:

```bash
sudo dnf -y install \
  ipa-client \
  oddjob \
  oddjob-mkhomedir \
  sssd \
  authselect-compat

sudo ipa-client-install -U \
  --hostname=bastion-01.workshop.lan \
  --domain=workshop.lan \
  --realm=WORKSHOP.LAN \
  --server=idm-01.workshop.lan \
  --principal=admin \
  --password='<lab-default-password>' \
  --force-join \
  --mkhomedir \
  --enable-dns-updates \
  --no-ntp
```

Enable the same client-side login behavior the automation expects:

```bash
sudo systemctl enable --now oddjobd.service
sudo authselect select sssd with-mkhomedir with-sudo --force
sudo systemctl restart sssd
sudo sss_cache -E
```

Validate the bastion is now using IdM:

```bash
id admin@workshop.lan
getent passwd admin@workshop.lan
sudo sssctl domain-status workshop.lan
```

At this point the bastion is ready for IdM-backed operator access. The next
support-service phase is the mirror registry build.

---

### Bastion boundary — all remaining work runs from `bastion-01`

> [!WARNING]
> Everything below this line runs from the bastion. Do not switch back to the
> operator workstation for steps 13A-36 unless you are deliberately debugging
> the automation itself. Once you cross this boundary, stay on bastion.

## 14. Build The Mirror Registry VM

_This section describes the steps performed by `playbooks/lab/mirror-registry.yml`, principally the `mirror_registry` and `mirror_registry_guest` roles._

From the bastion, after the validated support-services order
(`bastion -> bastion-stage -> optional ad-server -> idm -> bastion-join`),
create the mirror-registry VM on `virt-01`, then configure the guest, join it
to IdM, and install the Quay-based mirror registry stack.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1

mkdir -p /var/lib/aws-metal-openshift-demo/mirror-registry/cloudinit
qemu-img convert -f qcow2 -O raw \
  <rhel10-image-path> \
  /dev/ebs/mirror-registry

SSH_PUBKEY="$(cat /opt/openshift/secrets/hypervisor-admin.pub)"

cat <<'EOF' >/var/lib/aws-metal-openshift-demo/mirror-registry/cloudinit/meta-data
instance-id: mirror-registry
local-hostname: mirror-registry.workshop.lan
EOF

cat <<'EOF' >/var/lib/aws-metal-openshift-demo/mirror-registry/cloudinit/network-config
version: 2
ethernets:
  eth0:
    dhcp4: false
    addresses:
      - 172.16.0.20/24
    routes:
      - to: 0.0.0.0/0
        via: 172.16.0.1
    nameservers:
      search: [workshop.lan]
      addresses: [172.16.0.10, 8.8.8.8, 4.4.4.4]
EOF

cat <<EOF >/var/lib/aws-metal-openshift-demo/mirror-registry/cloudinit/user-data
#cloud-config
fqdn: mirror-registry.workshop.lan
manage_etc_hosts: true
users:
  - default
  - name: cloud-user
    groups: [wheel]
    sudo: ALL=(ALL) NOPASSWD:ALL
    lock_passwd: false
    ssh_authorized_keys:
      - ${SSH_PUBKEY}
EOF

xorriso -as mkisofs \
  -o /var/lib/aws-metal-openshift-demo/mirror-registry/mirror-registry-cidata.iso \
  -V CIDATA -J -R -graft-points \
  user-data=/var/lib/aws-metal-openshift-demo/mirror-registry/cloudinit/user-data \
  meta-data=/var/lib/aws-metal-openshift-demo/mirror-registry/cloudinit/meta-data \
  network-config=/var/lib/aws-metal-openshift-demo/mirror-registry/cloudinit/network-config

chown qemu:qemu /var/lib/aws-metal-openshift-demo/mirror-registry/mirror-registry-cidata.iso

virt-install \
  --name mirror-registry.workshop.lan \
  --osinfo rhel10.0 \
  --boot uefi \
  --machine q35 \
  --memory 16384 \
  --vcpus 4 \
  --cpu host-passthrough \
  --controller type=scsi,model=virtio-scsi \
  --disk path=/dev/ebs/mirror-registry,format=raw,bus=scsi,cache=none,io=native,discard=unmap,rotation_rate=1 \
  --disk path=/var/lib/aws-metal-openshift-demo/mirror-registry/mirror-registry-cidata.iso,device=cdrom \
  --network network=lab-switch,portgroup=mgmt-access,model=virtio,mac=52:54:00:00:00:20 \
  --rng builtin \
  --import \
  --graphics none \
  --resource partition=/machine/bronze \
  --cputune shares=167,emulatorpin.cpuset=2-5,26-29,50-53,74-77,\
vcpupin0.vcpu=0,vcpupin0.cpuset=6-23,30-47,54-71,78-95,\
vcpupin1.vcpu=1,vcpupin1.cpuset=6-23,30-47,54-71,78-95,\
vcpupin2.vcpu=2,vcpupin2.cpuset=6-23,30-47,54-71,78-95,\
vcpupin3.vcpu=3,vcpupin3.cpuset=6-23,30-47,54-71,78-95,\
iothreadpin0.iothread=1,iothreadpin0.cpuset=2-5,26-29,50-53,74-77 \
  --iothreads iothreads=1 \
  --console pty,target_type=serial \
  --autostart \
  --noautoconsole
```

Configure the guest itself, install packages, join IdM, and install the mirror
registry appliance.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key cloud-user@172.16.0.20
sudo -i

dnf -y update
reboot

dnf -y install \
  cockpit \
  firewalld \
  ipa-client \
  certmonger \
  podman \
  jq \
  skopeo \
  openssl \
  tar \
  gzip

systemctl enable --now firewalld
systemctl enable --now cockpit.socket

firewall-cmd --permanent --add-service=cockpit
firewall-cmd --permanent --add-service=ssh
firewall-cmd --permanent --add-port=8443/tcp
firewall-cmd --reload

ipa-client-install -U \
  --hostname=mirror-registry.workshop.lan \
  --domain=workshop.lan \
  --realm=WORKSHOP.LAN \
  --server=idm-01.workshop.lan \
  --principal=admin \
  --password='<lab-default-password>' \
  --force-join \
  --mkhomedir \
  --enable-dns-updates

mkdir -p /usr/local/libexec/mirror-registry /opt/quay-install /root/bin /opt/openshift
curl -L -o /tmp/mirror-registry-amd64.tar.gz \
  https://mirror.openshift.com/pub/cgw/mirror-registry/latest/mirror-registry-amd64.tar.gz
tar -C /usr/local/libexec/mirror-registry -xzf /tmp/mirror-registry-amd64.tar.gz
install -m 0755 /usr/local/libexec/mirror-registry/mirror-registry /usr/local/bin/mirror-registry
```

Request an IdM-issued certificate for the registry and install the registry with
that certificate.

```bash
kinit admin <<< '<lab-default-password>'
ipa service-add HTTP/mirror-registry.workshop.lan || true

mkdir -p /var/lib/mirror-registry/install-certs
ipa-getcert request -w \
  -I mirror-registry-quay \
  -f /etc/pki/tls/certs/mirror-registry.workshop.lan.crt \
  -k /etc/pki/tls/private/mirror-registry.workshop.lan.key \
  -K HTTP/mirror-registry.workshop.lan \
  -D mirror-registry.workshop.lan \
  -g 2048

cat /etc/pki/tls/certs/mirror-registry.workshop.lan.crt \
    /etc/ipa/ca.crt \
  >/var/lib/mirror-registry/install-certs/ssl.cert
cp /etc/pki/tls/private/mirror-registry.workshop.lan.key \
  /var/lib/mirror-registry/install-certs/ssl.key
chmod 0644 /var/lib/mirror-registry/install-certs/ssl.*

mirror-registry install \
  --quayHostname mirror-registry.workshop.lan \
  --quayRoot /opt/quay-install \
  --initUser init \
  --initPassword <lab-default-password> \
  --sslCert /var/lib/mirror-registry/install-certs/ssl.cert \
  --sslKey /var/lib/mirror-registry/install-certs/ssl.key

update-ca-trust
mkdir -p /etc/containers/certs.d/mirror-registry.workshop.lan:8443
cp /etc/ipa/ca.crt /etc/pki/ca-trust/source/anchors/workshop-idm-ca.crt
cp /etc/ipa/ca.crt /etc/containers/certs.d/mirror-registry.workshop.lan:8443/ca.crt
update-ca-trust extract

podman login mirror-registry.workshop.lan:8443 \
  --username init \
  --password <lab-default-password>
```

After certificate issuance or renewal, the current automation also synchronizes
the staged cert and key into the live Quay config under
`/opt/quay-install/quay-config/` and restarts the Quay services. That step is
what ensures the served certificate actually matches the freshly issued IdM
certificate chain.

Like the other support guests, the current automation uses a poweroff/offline
cleanup/start cycle for the first update-triggered restart so the cloud-init
CD-ROM cleanup is reflected in the next live QEMU process.

## 15. Mirror OpenShift And Operator Content

_This section describes the mirroring portion of `playbooks/lab/mirror-registry.yml`, primarily the `mirror_registry_guest` role and the rendered `ImageSetConfiguration`._

The disconnected standard for this lab is now:

- `portable` — runs both `m2d` (pull to disk archive) and `d2m` (push into
  local Quay) in a single playbook invocation

The `import` mode (`d2m` only) remains available for re-importing an existing
archive without re-pulling from upstream.

Direct mirror-to-registry remains available for partial-disconnect validation,
but it is no longer the primary student workflow.

Install the matching client tools on the mirror registry, copy the Red Hat pull
secret into place, render the `ImageSetConfiguration`, and run `oc-mirror`.

```bash
dnf -y install jq
mkdir -p /opt/openshift/oc-mirror /opt/openshift/oc-mirror-archive /root/.config/containers

curl -L -o /tmp/openshift-client-linux.tar.gz \
  https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/4.20.15/openshift-client-linux.tar.gz
tar -C /usr/local/bin -xzf /tmp/openshift-client-linux.tar.gz oc kubectl

curl -L -o /tmp/oc-mirror.rhel9.tar.gz \
  https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/4.20.15/oc-mirror.rhel9.tar.gz
tar -C /usr/local/bin -xzf /tmp/oc-mirror.rhel9.tar.gz oc-mirror

cp /opt/openshift/secrets/pull-secret.txt /opt/openshift/pull-secret.json

jq -s '.[0] * .[1] | .auths = (.[0].auths + .[1].auths)' \
  /opt/openshift/pull-secret.json \
  /root/.config/containers/auth.json \
  >/opt/openshift/pull-secret-merged.json

cat <<'EOF' >/opt/openshift/imageset-config.yaml
apiVersion: mirror.openshift.io/v2alpha1
kind: ImageSetConfiguration
mirror:
  platform:
    channels:
      - name: stable-4.20
        minVersion: 4.20.15
        maxVersion: 4.20.15
    architectures:
      - amd64
  operators:
    - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.20
      packages:
        - name: kubevirt-hyperconverged
          channels: [{name: stable}]
        - name: local-storage-operator
          channels: [{name: stable}]
        - name: kubernetes-nmstate-operator
          channels: [{name: stable}]
        - name: loki-operator
          channels: [{name: stable-6.2}]
        - name: netobserv-operator
          channels: [{name: stable}]
        - name: openshift-pipelines-operator-rh
          channels: [{name: pipelines-1.20}]
        - name: ansible-automation-platform-operator
          channels: [{name: stable-2.6}]
        - name: web-terminal
          channels: [{name: fast}]
        - name: devworkspace-operator
          channels: [{name: fast}]
        - name: node-healthcheck-operator
          channels: [{name: alpha}]
        - name: fence-agents-remediation
          channels: [{name: alpha}]
        - name: odf-operator
          channels: [{name: stable-4.20}]
        - name: ocs-operator
          channels: [{name: stable-4.20}]
        - name: mcg-operator
          channels: [{name: stable-4.20}]
        - name: odf-csi-addons-operator
          channels: [{name: stable-4.20}]
        - name: rook-ceph-operator
          channels: [{name: stable-4.20}]
        - name: cephcsi-operator
          channels: [{name: stable-4.20}]
        - name: metallb-operator
          channels: [{name: stable}]
EOF

oc-mirror --v2 \
  --config /opt/openshift/imageset-config.yaml \
  --authfile /opt/openshift/pull-secret-merged.json \
  file:///opt/openshift/oc-mirror-archive
```

Import the resulting archive into the local registry. In the current
automation this runs as a single `portable` workflow (`m2d` then `d2m` in one
invocation). The manual equivalent is two separate commands — pull to disk,
then push into Quay:

```bash
oc-mirror --v2 \
  --config /opt/openshift/imageset-config.yaml \
  --authfile /root/.config/containers/auth.json \
  --from file:///opt/openshift/oc-mirror-archive \
  docker://mirror-registry.workshop.lan:8443/openshift
```

Track the workflow with the bastion helper that the orchestration now installs.

```bash
/usr/local/bin/track-mirror-progress
/usr/local/bin/track-mirror-progress-tmux
```

The tmux variant opens dedicated panes for:

- summary
- runner state
- storage/import state
- registry container state
- live bastion log tail

The same information can also be gathered manually without the helper.

From `bastion-01`, inspect the runner state and latest Ansible task.

```bash
tail -f /var/tmp/bastion-playbooks/mirror-registry.log
cat /var/tmp/bastion-playbooks/mirror-registry.pid
cat /var/tmp/bastion-playbooks/mirror-registry.rc
```

From `mirror-registry.workshop.lan`, inspect live `oc-mirror` activity, archive
growth, and guest disk usage.

```bash
pgrep -af oc-mirror
df -h /
du -sh /opt/openshift/oc-mirror-archive
du -sh /opt/openshift/oc-mirror
sudo du -sh /var/lib/containers/storage/volumes/quay-storage/_data
sudo du -sh /var/lib/containers/storage/volumes/sqlite-storage/_data
sudo podman ps
tail -f /var/log/oc-mirror-m2d.log
tail -f /var/log/oc-mirror-d2m.log
```

> [!TIP]
> The mirroring phase is the longest single step in the build (hours, not
> minutes). Use `track-mirror-progress-tmux` on the bastion to monitor it. If
> the guest runs out of disk mid-mirror, the archive is corrupted and you start
> over.

Approximate sizing guidance:

- `m2d` safe target: `archive_size * 1.5 + 20 GiB`
- same-host `d2m` safe target: `archive_size * 2.5 + 20 GiB`
- recommended same-host disk for both phases with margin:
  `archive_size * 3 + 20 GiB`

Observed on the live `4.20.15` run with the current operator set:

- `m2d` archive size: about `95 GiB`
- `m2d` safe target: about `162 GiB`
- same-host `d2m` safe target: about `256 GiB`
- recommended same-host disk for both phases with margin: about `303 GiB`
- practical lab decision: provision `400 GiB` for `mirror-registry`
- observed imported Quay content footprint after `d2m`: about `82 GiB`

## 16. Populate OpenShift DNS In IdM

_This section describes the steps performed by `playbooks/lab/openshift-dns.yml`, primarily the `idm_openshift_dns` role._

Create the forward and reverse DNS zones and records in IdM for the cluster,
nodes, and VIPs.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key cloud-user@172.16.0.10
sudo -i
kinit admin <<< '<lab-default-password>'

ipa dnszone-add ocp.workshop.lan \
  --name-server=idm-01.workshop.lan. \
  --admin-email=hostmaster.ocp.workshop.lan \
  --dynamic-update=FALSE || true

ipa dnszone-add 10.16.172.in-addr.arpa \
  --name-server=idm-01.workshop.lan. \
  --admin-email=hostmaster.ocp.workshop.lan \
  --dynamic-update=FALSE || true

ipa dnszone-add 11.16.172.in-addr.arpa \
  --name-server=idm-01.workshop.lan. \
  --admin-email=hostmaster.ocp.workshop.lan \
  --dynamic-update=FALSE || true

ipa dnsrecord-add ocp.workshop.lan api --a-rec=172.16.10.5 || true
ipa dnsrecord-add ocp.workshop.lan api-int --a-rec=172.16.10.5 || true
ipa dnsrecord-add ocp.workshop.lan '*.apps' --a-rec=172.16.10.7 || true
ipa dnsrecord-add ocp.workshop.lan ingress --a-rec=172.16.10.7 || true
```

Create the node A and PTR records.

```bash
for entry in \
  "ocp-master-01 11 11" \
  "ocp-master-02 12 12" \
  "ocp-master-03 13 13" \
  "ocp-infra-01 21 21" \
  "ocp-infra-02 22 22" \
  "ocp-infra-03 23 23" \
  "ocp-worker-01 31 31" \
  "ocp-worker-02 32 32" \
  "ocp-worker-03 33 33"; do
  set -- $entry
  name="$1"
  machine_octet="$2"
  storage_octet="$3"

  ipa dnsrecord-add ocp.workshop.lan "${name}" \
    --a-rec="172.16.10.${machine_octet}" || true
  ipa dnsrecord-add 10.16.172.in-addr.arpa "${machine_octet}" \
    --ptr-rec="${name}.ocp.workshop.lan." || true

  ipa dnsrecord-add ocp.workshop.lan "${name}-storage" \
    --a-rec="172.16.11.${storage_octet}" || true
  ipa dnsrecord-add 11.16.172.in-addr.arpa "${storage_octet}" \
    --ptr-rec="${name}-storage.ocp.workshop.lan." || true
done
```

## 17. Download Installer Binaries

_This section describes the steps performed by `playbooks/cluster/openshift-installer-binaries.yml`, primarily the `openshift_installer_binaries` role._

Download the exact matching OpenShift installer and client tools onto the
bastion.

```bash
mkdir -p /opt/openshift/generated/tools/4.20.15/downloads
mkdir -p /opt/openshift/generated/tools/4.20.15/bin

dnf -y install nmstate

curl -L -o /opt/openshift/generated/tools/4.20.15/downloads/openshift-install-linux.tar.gz \
  https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/4.20.15/openshift-install-linux.tar.gz

curl -L -o /opt/openshift/generated/tools/4.20.15/downloads/openshift-client-linux.tar.gz \
  https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/4.20.15/openshift-client-linux.tar.gz

tar -C /opt/openshift/generated/tools/4.20.15/bin -xzf \
  /opt/openshift/generated/tools/4.20.15/downloads/openshift-install-linux.tar.gz
tar -C /opt/openshift/generated/tools/4.20.15/bin -xzf \
  /opt/openshift/generated/tools/4.20.15/downloads/openshift-client-linux.tar.gz

chmod 0755 /opt/openshift/generated/tools/4.20.15/bin/openshift-install
chmod 0755 /opt/openshift/generated/tools/4.20.15/bin/oc
chmod 0755 /opt/openshift/generated/tools/4.20.15/bin/kubectl
```

## 18. Render Install Artifacts

_This section describes the steps performed by `playbooks/cluster/openshift-install-artifacts.yml`, primarily the `openshift_install_artifacts` role._

Write the `install-config.yaml`, `agent-config.yaml`, and the IdM CA file that
are used by the agent installer.

```bash
mkdir -p /opt/openshift/generated/ocp
curl -fsSL http://172.16.0.10/ipa/config/ca.crt >/opt/openshift/generated/ocp/idm-ca.crt

PULL_SECRET_JSON="$(jq -c . /opt/openshift/secrets/pull-secret.txt)"
SSH_PUBKEY="$(cat /opt/openshift/secrets/hypervisor-admin.pub)"

cat <<EOF >/opt/openshift/generated/ocp/install-config.yaml
apiVersion: v1
baseDomain: workshop.lan
metadata:
  name: ocp
platform:
  none: {}
controlPlane:
  name: master
  replicas: 3
  architecture: amd64
compute:
  - name: worker
    replicas: 6
    architecture: amd64
networking:
  networkType: OVNKubernetes
  machineNetwork:
    - cidr: 172.16.10.0/24
  clusterNetwork:
    - cidr: 10.128.0.0/14
      hostPrefix: 23
  serviceNetwork:
    - 172.30.0.0/16
pullSecret: 'REPLACE_FROM_PULL_SECRET_FILE'
sshKey: '${SSH_PUBKEY}'
additionalTrustBundle: |
EOF
cat /opt/openshift/generated/ocp/idm-ca.crt >>/opt/openshift/generated/ocp/install-config.yaml

python3 - <<'PY'
from pathlib import Path
path = Path("/opt/openshift/generated/ocp/install-config.yaml")
text = path.read_text()
pull = Path("/opt/openshift/secrets/pull-secret.txt").read_text().strip().replace("'", "''")
path.write_text(text.replace("REPLACE_FROM_PULL_SECRET_FILE", pull))
PY
```

Write the agent config with MAC-based NIC identification and explicit root disk
selection. The current automation uses the libvirt root-disk serial for each
node and renders that into `rootDeviceHints.serialNumber`.

```bash
cat <<'EOF' >/opt/openshift/generated/ocp/agent-config.yaml
apiVersion: v1alpha1
kind: AgentConfig
rendezvousIP: 172.16.10.11
hosts:
  - hostname: ocp-master-01.ocp.workshop.lan
    role: master
    interfaces:
      - name: nic0
        macAddress: "52:54:00:20:00:10"
    rootDeviceHints:
      serialNumber: "ocpmaster01root"
    networkConfig:
      interfaces:
        - name: nic0
          type: ethernet
          state: up
          identifier: mac-address
          mac-address: "52:54:00:20:00:10"
        - name: nic0.200
          type: vlan
          state: up
          vlan:
            base-iface: nic0
            id: 200
          ipv4:
            enabled: true
            address:
              - ip: 172.16.10.11
                prefix-length: 24
        - name: nic0.201
          type: vlan
          state: up
          vlan:
            base-iface: nic0
            id: 201
          ipv4:
            enabled: true
            address:
              - ip: 172.16.11.11
                prefix-length: 24
      dns-resolver:
        config:
          server:
            - 172.16.0.10
      routes:
        config:
          - destination: 0.0.0.0/0
            next-hop-address: 172.16.10.1
            next-hop-interface: nic0.200
  # Repeat the same pattern for the remaining 8 nodes.
EOF
```

## 19. Generate The Agent ISO

_This section describes the steps performed by `playbooks/cluster/openshift-agent-media.yml`, primarily the `openshift_agent_media` role._

Generate the agent media on the bastion, then copy the ISO to `virt-01` and
verify its checksum before using it.

```bash
/opt/openshift/generated/tools/4.20.15/bin/openshift-install agent create image \
  --dir /opt/openshift/generated/ocp

sha256sum /opt/openshift/generated/ocp/agent.x86_64.iso

ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 \
  "mkdir -p /var/lib/libvirt/images"

scp -i /opt/openshift/secrets/hypervisor-admin.key \
  /opt/openshift/generated/ocp/agent.x86_64.iso \
  root@172.16.0.1:/var/lib/libvirt/images/agent.x86_64.iso.tmp

ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 \
  "install -m 0644 /var/lib/libvirt/images/agent.x86_64.iso.tmp \
   /var/lib/libvirt/images/agent.x86_64.iso && \
   sha256sum /var/lib/libvirt/images/agent.x86_64.iso"
```

Create the generated attachment plan that says every node should boot from the
agent ISO.

```bash
cat <<'EOF' >/opt/openshift/generated/ocp/openshift_cluster_attachment_plan.yml
openshift_cluster_node_attachment_plan:
  ocp-master-01:
    access:
      attach_agent_boot_media: true
      agent_boot_media_path: /var/lib/libvirt/images/agent.x86_64.iso
  ocp-master-02:
    access:
      attach_agent_boot_media: true
      agent_boot_media_path: /var/lib/libvirt/images/agent.x86_64.iso
  ocp-master-03:
    access:
      attach_agent_boot_media: true
      agent_boot_media_path: /var/lib/libvirt/images/agent.x86_64.iso
  ocp-infra-01:
    access:
      attach_agent_boot_media: true
      agent_boot_media_path: /var/lib/libvirt/images/agent.x86_64.iso
  ocp-infra-02:
    access:
      attach_agent_boot_media: true
      agent_boot_media_path: /var/lib/libvirt/images/agent.x86_64.iso
  ocp-infra-03:
    access:
      attach_agent_boot_media: true
      agent_boot_media_path: /var/lib/libvirt/images/agent.x86_64.iso
  ocp-worker-01:
    access:
      attach_agent_boot_media: true
      agent_boot_media_path: /var/lib/libvirt/images/agent.x86_64.iso
  ocp-worker-02:
    access:
      attach_agent_boot_media: true
      agent_boot_media_path: /var/lib/libvirt/images/agent.x86_64.iso
  ocp-worker-03:
    access:
      attach_agent_boot_media: true
      agent_boot_media_path: /var/lib/libvirt/images/agent.x86_64.iso
EOF
```

## 20. Create The OpenShift VM Shells

_This section describes the steps performed by `playbooks/cluster/openshift-cluster.yml`, primarily the `openshift_cluster` role._

Create the 9 OpenShift VM shells on `virt-01`, attach the ISO, and set them to
boot CD-ROM first.

Current tier intent:

- Gold:
  - masters
- Silver:
  - infra
- Bronze:
  - workers

Current sizing:

- masters: `3 x 8 vCPU`
- infra: `3 x 16 vCPU`
- workers: `3 x 8 vCPU`

Current CPU pools:

- `guest_domain`: `6-23,30-47,54-71,78-95`
- `host_emulator`: `2-5,26-29,50-53,74-77`

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1

virt-install \
  --name ocp-master-01.ocp.workshop.lan \
  --osinfo rhel9.4 \
  --boot uefi \
  --machine q35 \
  --memory 24576 \
  --vcpus 8 \
  --cpu host-passthrough \
  --controller type=scsi,model=virtio-scsi \
  --disk path=/dev/ebs/ocp-master-01,format=raw,bus=scsi,cache=none,io=native,discard=unmap,rotation_rate=1 \
  --disk path=/var/lib/libvirt/images/agent.x86_64.iso,device=cdrom,bus=scsi \
  --network network=lab-switch,portgroup=ocp-trunk,model=virtio,mac=52:54:00:20:00:10 \
  --graphics vnc,listen=127.0.0.1 \
  --import \
  --resource partition=/machine/gold \
  --cputune shares=512,emulatorpin.cpuset=2-5,26-29,50-53,74-77,\
vcpupin0.vcpu=0,vcpupin0.cpuset=6-23,30-47,54-71,78-95,\
vcpupin1.vcpu=1,vcpupin1.cpuset=6-23,30-47,54-71,78-95,\
vcpupin2.vcpu=2,vcpupin2.cpuset=6-23,30-47,54-71,78-95,\
vcpupin3.vcpu=3,vcpupin3.cpuset=6-23,30-47,54-71,78-95,\
vcpupin4.vcpu=4,vcpupin4.cpuset=6-23,30-47,54-71,78-95,\
vcpupin5.vcpu=5,vcpupin5.cpuset=6-23,30-47,54-71,78-95,\
vcpupin6.vcpu=6,vcpupin6.cpuset=6-23,30-47,54-71,78-95,\
vcpupin7.vcpu=7,vcpupin7.cpuset=6-23,30-47,54-71,78-95 \
  --autostart \
  --noautoconsole

virt-xml ocp-master-01.ocp.workshop.lan --edit --boot cdrom,hd

# Repeat the same pattern for:
# - ocp-master-02, ocp-master-03
#   - partition=/machine/gold
#   - shares=512
# - ocp-infra-01..03
#   - partition=/machine/silver
#   - shares=333
#   - attach /dev/ebs/ocp-infra-0X-data as a second disk
#   - add --iothreads iothreads=1 and iothreadpin0.cpuset=2-5,26-29,50-53,74-77
# - ocp-worker-01..03
#   - partition=/machine/bronze
#   - shares=167
```

## 21. Wait For Installer Convergence

_This section describes the steps performed by `playbooks/cluster/openshift-install-wait.yml`._

After the VM shells are created and booted from `agent.x86_64.iso`, run the
installer wait phase from the bastion. This is the step that turns “VMs are
running” into “the cluster finished bootstrap and install.”

```bash
/opt/openshift/generated/tools/4.20.15/bin/openshift-install \
  --dir /opt/openshift/generated/ocp \
  wait-for bootstrap-complete --log-level=debug

/opt/openshift/generated/tools/4.20.15/bin/openshift-install \
  --dir /opt/openshift/generated/ocp \
  wait-for install-complete --log-level=debug
```

## 22. Validate Post-install State

_This section describes the steps performed by `playbooks/day2/openshift-post-install-validate.yml`, primarily the `openshift_post_install_validate` role._

Once installer convergence is complete and `auth/kubeconfig` exists, use the
generated kubeconfig from inside the lab and validate the cluster from
`virt-01`.

```bash
scp -i /opt/openshift/secrets/hypervisor-admin.key \
  /opt/openshift/generated/ocp/auth/kubeconfig \
  root@172.16.0.1:/var/tmp/ocp-kubeconfig

scp -i /opt/openshift/secrets/hypervisor-admin.key \
  /opt/openshift/generated/tools/4.20.15/bin/oc \
  root@172.16.0.1:/var/tmp/oc

ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
chmod 0755 /var/tmp/oc
export KUBECONFIG=/var/tmp/ocp-kubeconfig
/var/tmp/oc get clusterversion
/var/tmp/oc get co
/var/tmp/oc get nodes
/var/tmp/oc get csr
EOF
```

## 23. Detach Install Media And Normalize Boot

_This section describes the steps performed by `playbooks/maintenance/detach-install-media.yml`. In the automated path, this runs immediately after `openshift-install-wait.yml` in `site-lab.yml` and again as the first task in `openshift-post-install.yml` (safety net)._

> [!CAUTION]
> **Do not skip this step.** If the agent ISO is still attached when a cluster
> node reboots (vCPU resize, operator-triggered restart, or accidental power
> cycle), the node will re-enter the day-1 agent installer instead of booting
> from disk. This happened in production — see issue `007c920` in the issues
> ledger.

Once guests have completed day-1 provisioning, eject the attached installation
media and restore disk-only boot intent. This prevents support guests from
retaining sensitive cloud-init data and prevents OpenShift guests from booting
back into the agent installer after a restart.

For support guests, the preferred timing is earlier than the end of the build:
after the initial package update is staged but before the reboot required by
that update. That reboot clears the live empty CD-ROM shell that libvirt may
leave behind even after the media is ejected and the persistent XML is cleaned
up.

For OpenShift cluster guests, the important success condition is different:
eject `agent.x86_64.iso` and restore disk-first boot. The live or persistent
empty CD-ROM shell does not need to be removed immediately, and trying to do so
on a running node is not a reliable success criterion.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
for domain in \
  idm-01.workshop.lan \
  bastion-01.workshop.lan \
  mirror-registry.workshop.lan
do
  target=$(virsh domblklist "$domain" --details | awk '$2 == "cdrom" {print $3}')
  if [ -n "$target" ]; then
    virsh change-media "$domain" "$target" --eject --config --live || true
    virt-xml "$domain" --remove-device --disk "target=$target"
    virt-xml "$domain" --edit --boot hd
  fi
done

for domain in \
  ocp-master-01.ocp.workshop.lan \
  ocp-master-02.ocp.workshop.lan \
  ocp-master-03.ocp.workshop.lan \
  ocp-infra-01.ocp.workshop.lan \
  ocp-infra-02.ocp.workshop.lan \
  ocp-infra-03.ocp.workshop.lan \
  ocp-worker-01.ocp.workshop.lan \
  ocp-worker-02.ocp.workshop.lan \
  ocp-worker-03.ocp.workshop.lan
do
  target=$(virsh domblklist "$domain" --details \
    | awk '$2 == "cdrom" && $4 == "/var/lib/libvirt/images/agent.x86_64.iso" {print $3}')
  if [ -n "$target" ]; then
    virsh change-media "$domain" "$target" --eject --config --live || true
    virt-xml "$domain" --edit --boot hd
  fi
done
EOF
```

Verify support guests no longer carry persistent CD-ROM devices:

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
for domain in \
  idm-01.workshop.lan \
  bastion-01.workshop.lan \
  mirror-registry.workshop.lan
do
  echo "=== $domain ==="
  virsh dumpxml --inactive "$domain" | grep "device='cdrom'" || echo "no persistent cdrom"
done
EOF
```

Verify OpenShift guests have no attached agent ISO media and boot from disk:

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
for domain in \
  ocp-master-01.ocp.workshop.lan \
  ocp-master-02.ocp.workshop.lan \
  ocp-master-03.ocp.workshop.lan \
  ocp-infra-01.ocp.workshop.lan \
  ocp-infra-02.ocp.workshop.lan \
  ocp-infra-03.ocp.workshop.lan \
  ocp-worker-01.ocp.workshop.lan \
  ocp-worker-02.ocp.workshop.lan \
  ocp-worker-03.ocp.workshop.lan
do
  echo "=== $domain ==="
  virsh domblklist "$domain" --details | awk '$2 == "cdrom" {print}'
  virsh dumpxml --inactive "$domain" | grep "<boot dev='hd'/>" || echo "boot order needs review"
done
EOF
```

## 24. Configure LDAP Auth, Group Sync, And Infra Roles

_This section describes the steps performed by `playbooks/day2/openshift-post-install-ldap-auth.yml`, `playbooks/day2/openshift-post-install-infra.yml`, and the corresponding roles `openshift_post_install_ldap_auth` and `openshift_post_install_infra`._

The numbered sections below are capability walkthroughs, not the strict current
automation order. The automated `openshift-post-install.yml` sequence is:

1. disconnected OperatorHub pivot
2. infra conversion
3. IdM ingress certificate rollout
4. LDAP auth and group sync
5. NMState
6. ODF
7. OpenShift Virtualization
8. OpenShift Pipelines
9. Web Terminal
10. AAP
11. Network Observability
12. validation

Create the LDAP bind secret, configure OAuth to use IdM, sync the IdM groups,
grant cluster-admin to `openshift-admin`, label the infra nodes, and move
platform workloads (ingress, monitoring, image registry) onto them. In the
current orchestration, the disconnected OperatorHub pivot is part of the
default post-install baseline and runs before the LDAP/NMState steps.

Note: the automation does **not** taint infra nodes — workloads are steered via
`nodeSelector` / `nodePlacement` alone. Taints are applied later only for the
ODF storage set (`node.ocs.openshift.io/storage`).

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
export KUBECONFIG=/var/tmp/ocp-kubeconfig
cat <<'YAML' | /var/tmp/oc apply -f -
apiVersion: v1
kind: Secret
metadata:
  name: ldap-bind-password
  namespace: openshift-config
stringData:
  bindPassword: <lab-default-password>
YAML

cat <<'YAML' | /var/tmp/oc apply -f -
apiVersion: config.openshift.io/v1
kind: OAuth
metadata:
  name: cluster
spec:
  identityProviders:
    - name: Red Hat Identity Management
      mappingMethod: claim
      type: LDAP
      ldap:
        url: "ldaps://idm-01.workshop.lan/cn=users,cn=accounts,dc=workshop,dc=lan?uid?sub?(objectClass=person)"
        bindDN: "cn=Directory Manager"
        bindPassword:
          name: ldap-bind-password
        insecure: false
        attributes:
          id: [dn]
          preferredUsername: [uid]
          name: [cn]
          email: [mail]
YAML

cat <<'YAML' >/tmp/groupsync.yaml
kind: LDAPSyncConfig
apiVersion: v1
url: ldaps://idm-01.workshop.lan
bindDN: "cn=Directory Manager"
bindPassword:
  file: "/tmp/ldap-bind-password"
rfc2307:
  groupsQuery:
    baseDN: "cn=groups,cn=accounts,dc=workshop,dc=lan"
    scope: sub
    filter: "(|(cn=openshift-admin)(cn=virt-admin)(cn=developer))"
  groupUIDAttribute: dn
  groupNameAttributes: [cn]
  groupMembershipAttributes: [member]
  usersQuery:
    baseDN: "cn=users,cn=accounts,dc=workshop,dc=lan"
    scope: sub
  userUIDAttribute: dn
  userNameAttributes: [uid]
YAML

printf '<lab-default-password>\n' >/tmp/ldap-bind-password
oc adm groups sync --sync-config=/tmp/groupsync.yaml --confirm

cat <<'YAML' | /var/tmp/oc apply -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: openshift-admin-cluster-admin
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
subjects:
  - kind: Group
    apiGroup: rbac.authorization.k8s.io
    name: openshift-admin
YAML

/var/tmp/oc label node ocp-infra-01 node-role.kubernetes.io/infra='' --overwrite
/var/tmp/oc label node ocp-infra-02 node-role.kubernetes.io/infra='' --overwrite
/var/tmp/oc label node ocp-infra-03 node-role.kubernetes.io/infra='' --overwrite

# --- Move platform workloads to infra nodes ---

# Move the default IngressController
/var/tmp/oc patch ingresscontroller/default -n openshift-ingress-operator \
  --type=merge -p \
  '{"spec":{"nodePlacement":{"nodeSelector":{"matchLabels":{"node-role.kubernetes.io/infra":""}}}}}'

# Move cluster monitoring (Prometheus, Alertmanager, Thanos, etc.)
cat <<'YAML' | /var/tmp/oc apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: cluster-monitoring-config
  namespace: openshift-monitoring
data:
  config.yaml: |
    prometheusOperator:
      nodeSelector:
        node-role.kubernetes.io/infra: ""
    prometheusK8s:
      nodeSelector:
        node-role.kubernetes.io/infra: ""
    alertmanagerMain:
      nodeSelector:
        node-role.kubernetes.io/infra: ""
    kubeStateMetrics:
      nodeSelector:
        node-role.kubernetes.io/infra: ""
    openshiftStateMetrics:
      nodeSelector:
        node-role.kubernetes.io/infra: ""
    thanosQuerier:
      nodeSelector:
        node-role.kubernetes.io/infra: ""
    metricsServer:
      nodeSelector:
        node-role.kubernetes.io/infra: ""
YAML

# Move the internal image registry
/var/tmp/oc patch configs.imageregistry/cluster --type=merge \
  -p '{"spec":{"nodeSelector":{"node-role.kubernetes.io/infra":""}}}'

# Wait for ingress pods to land on infra nodes
/var/tmp/oc -n openshift-ingress wait pod --for=condition=Ready \
  --selector=ingresscontroller.operator.openshift.io/deployment-ingresscontroller=default \
  --timeout=10m

# Wait for monitoring operator to settle after the ConfigMap change
until [ "$(/var/tmp/oc get co monitoring -o jsonpath='{.status.conditions[?(@.type=="Progressing")].status}')" = "False" ]; do
  sleep 10
done
EOF
```

> [!IMPORTANT]
> **Wait for OAuth convergence before testing LDAP login.** The authentication
> CO can report `Available=True` while old OAuth pods are still serving. The
> `oc login` will fail with "unknown authority" or "invalid credentials" if the
> new IDP config has not fully rolled out. Wait for
> `authentication Progressing=False` first.

Verify the LDAP configuration by logging in with an IdM user. The OCP API
server TLS cert is signed by the cluster's own CA (not the IdM CA), so
`--insecure-skip-tls-verify` is used here.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
export KUBECONFIG=/var/tmp/ocp-kubeconfig

# Wait for the authentication operator to finish rolling the new OAuth config
until [ "$(/var/tmp/oc get co authentication -o jsonpath='{.status.conditions[?(@.type=="Progressing")].status}')" = "False" ]; do
  sleep 10
done

# Smoke test: login as an IdM user, verify identity, log out
/var/tmp/oc login https://api.ocp.workshop.lan:6443 \
  --insecure-skip-tls-verify \
  -u sysadmin -p '<lab-default-password>'
/var/tmp/oc whoami   # expect: sysadmin
/var/tmp/oc logout
export KUBECONFIG=/var/tmp/ocp-kubeconfig
EOF
```

Install a recurring group sync on the bastion.

```bash
cat <<'EOF' >/etc/cron.d/openshift-ldap-groupsync
*/30 * * * * root export KUBECONFIG=/var/tmp/ocp-kubeconfig && \
  /var/tmp/oc adm groups sync --sync-config=/tmp/groupsync.yaml --confirm >/var/log/openshift-ldap-groupsync.log 2>&1
EOF
```

## 25. Install Kubernetes NMState

_This section describes the steps performed by `playbooks/day2/openshift-post-install-nmstate.yml`, primarily the `openshift_post_install_nmstate` role._

Install the NMState operator and create the singleton `NMState` instance.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
export KUBECONFIG=/var/tmp/ocp-kubeconfig

oc create namespace openshift-nmstate || true

cat <<'YAML' | oc apply -f -
apiVersion: operators.coreos.com/v1
kind: OperatorGroup
metadata:
  name: openshift-nmstate
  namespace: openshift-nmstate
spec:
  targetNamespaces:
    - openshift-nmstate
YAML

cat <<'YAML' | oc apply -f -
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: kubernetes-nmstate-operator
  namespace: openshift-nmstate
spec:
  channel: stable
  installPlanApproval: Automatic
  name: kubernetes-nmstate-operator
  source: cs-redhat-operator-index-v4-20
  sourceNamespace: openshift-marketplace
YAML

oc wait --for=condition=Established crd/nmstates.nmstate.io --timeout=20m

cat <<'YAML' | oc apply -f -
apiVersion: nmstate.io/v1
kind: NMState
metadata:
  name: nmstate
YAML

oc -n openshift-nmstate wait --for=condition=Available deployment/nmstate-operator --timeout=20m
EOF
```

Create the VLAN policies used later by OpenShift Virtualization and VM
workloads.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
export KUBECONFIG=/var/tmp/ocp-kubeconfig

cat <<'YAML' | oc apply -f -
apiVersion: nmstate.io/v1
kind: NodeNetworkConfigurationPolicy
metadata:
  name: kubevirt-live-migration-vlan
spec:
  nodeSelector:
    node-role.kubernetes.io/worker: ""
  desiredState:
    interfaces:
      - name: vlan202
        description: OpenShift Virtualization live migration VLAN
        type: vlan
        state: up
        vlan:
          base-iface: enp1s0
          id: 202
        ipv4:
          enabled: false
        ipv6:
          enabled: false
YAML

cat <<'YAML' | oc apply -f -
apiVersion: nmstate.io/v1
kind: NodeNetworkConfigurationPolicy
metadata:
  name: vm-data-vlan-300
spec:
  nodeSelector:
    node-role.kubernetes.io/worker: ""
  desiredState:
    interfaces:
      - name: vlan300
        description: Routed VM data network A
        type: vlan
        state: up
        vlan:
          base-iface: enp1s0
          id: 300
        ipv4:
          enabled: false
        ipv6:
          enabled: false
YAML

cat <<'YAML' | oc apply -f -
apiVersion: nmstate.io/v1
kind: NodeNetworkConfigurationPolicy
metadata:
  name: vm-data-vlan-301
spec:
  nodeSelector:
    node-role.kubernetes.io/worker: ""
  desiredState:
    interfaces:
      - name: vlan301
        description: Routed VM data network B
        type: vlan
        state: up
        vlan:
          base-iface: enp1s0
          id: 301
        ipv4:
          enabled: false
        ipv6:
          enabled: false
YAML

cat <<'YAML' | oc apply -f -
apiVersion: nmstate.io/v1
kind: NodeNetworkConfigurationPolicy
metadata:
  name: vm-data-vlan-302
spec:
  nodeSelector:
    node-role.kubernetes.io/worker: ""
  desiredState:
    interfaces:
      - name: vlan302
        description: Isolated VM data network
        type: vlan
        state: up
        vlan:
          base-iface: enp1s0
          id: 302
        ipv4:
          enabled: false
        ipv6:
          enabled: false
YAML

oc wait nncp/kubevirt-live-migration-vlan --for=jsonpath='{.status.conditions[?(@.type=="Available")].status}'=True --timeout=20m
oc wait nncp/vm-data-vlan-300 --for=jsonpath='{.status.conditions[?(@.type=="Available")].status}'=True --timeout=20m
oc wait nncp/vm-data-vlan-301 --for=jsonpath='{.status.conditions[?(@.type=="Available")].status}'=True --timeout=20m
oc wait nncp/vm-data-vlan-302 --for=jsonpath='{.status.conditions[?(@.type=="Available")].status}'=True --timeout=20m
EOF
```

Design note:

- this lab currently uses interface-name matching with `enp1s0` because it is
  easy to read and explain
- nmstate also supports matching the parent uplink by MAC address
- a MAC-matched model is more robust across different hardware and interface
  naming schemes, but it requires generating a separate policy per node

## 26. Deploy ODF Declaratively

_This section describes the ODF portion of `playbooks/day2/openshift-post-install.yml`, primarily the `openshift_post_install_odf` role._

> [!WARNING]
> **ODF must run before Virtualization (27) and NetObserv (29).** CNV expects
> `ocs-storagecluster-ceph-rbd` to be available when it sets the default virt
> storage class. NetObserv needs NooBaa S3 for Loki. Running them out of order
> causes silent failures that are hard to diagnose.

Wipe stale Ceph bluestore labels from OSD backing devices, clean up any
duplicate OperatorGroups in the Local Storage namespace, label and taint the
infra nodes for storage, configure Local Storage discovery, create the
`LocalVolumeSet`, and apply the `StorageCluster`.

> [!CAUTION]
> **OSD device preparation on reused EBS volumes.** A conventional small
> head/tail wipe is not sufficient for reused ODF disks. The current recovery
> path wipes the first 2 GiB, fixed BlueStore label positions at `0`, `1`,
> `10`, `100`, and `1000 GiB`, and the device tail. It also purges
> `/var/lib/rook/*` and `/var/lib/ceph/*` on the infra nodes before reinstall.
> Destructive recovery is not part of a normal rerun. It must be explicitly
> forced.

The manual equivalent on the hypervisor:

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
for dev in /dev/ebs/ocp-infra-01-data /dev/ebs/ocp-infra-02-data /dev/ebs/ocp-infra-03-data; do
  size_mb=$(( $(blockdev --getsize64 "$dev") / 1024 / 1024 ))
  blkdiscard "$dev" || true
  wipefs --all --force "$dev" || true
  dd if=/dev/zero of="$dev" bs=4M count=512 oflag=direct conv=fsync,notrunc status=none
  for offset_mb in 0 1024 10240 102400 1024000; do
    if [ "$offset_mb" -lt "$size_mb" ]; then
      dd if=/dev/zero of="$dev" bs=1M seek=$offset_mb count=64 oflag=direct conv=fsync,notrunc status=none
    fi
  done
  if [ "$size_mb" -gt 256 ]; then
    dd if=/dev/zero of="$dev" bs=1M seek=$(( size_mb - 256 )) count=256 oflag=direct conv=fsync,notrunc status=none
  fi
done

for node in ocp-infra-01 ocp-infra-02 ocp-infra-03; do
  oc debug "node/${node}" -- chroot /host bash -lc 'rm -rf /var/lib/rook/* /var/lib/ceph/*'
done
EOF
```

> [!WARNING]
> **OperatorGroup cleanup.** OLM can leave behind auto-generated
> OperatorGroups when namespaces are recreated. If more than one OperatorGroup
> exists in `openshift-local-storage`, OLM refuses to process subscriptions
> (`MultipleOperatorGroupsFound`). The automation deletes any stale
> OperatorGroups before applying the subscription. If you are running this
> manually, check first.

Current default:

- `openshift_post_install_odf_multus_enabled: false`

Reason:

- this project runs ODF in a nested `KVM + OVS + libvirt` environment
- ODF public-network Multus/macvlan on VLAN 201 is not a safe default on that
  hypervisor path
- the stable default is therefore the pod network unless the hypervisor is
  intentionally engineered for the extra secondary-MAC/promiscuous-mode
  requirements

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
export KUBECONFIG=/var/tmp/ocp-kubeconfig

for node in ocp-infra-01 ocp-infra-02 ocp-infra-03; do
  oc label node "${node}" cluster.ocs.openshift.io/openshift-storage='' --overwrite
  oc adm taint node "${node}" node.ocs.openshift.io/storage=true:NoSchedule --overwrite
done

oc create namespace openshift-local-storage || true
oc create namespace openshift-storage || true

cat <<'YAML' | oc apply -f -
apiVersion: local.storage.openshift.io/v1alpha1
kind: LocalVolumeDiscovery
metadata:
  name: auto-discover-devices
  namespace: openshift-local-storage
spec:
  nodeSelector:
    nodeSelectorTerms:
      - matchExpressions:
          - key: node-role.kubernetes.io/infra
            operator: Exists
  tolerations:
    - key: node-role.kubernetes.io/infra
      operator: Exists
      effect: NoSchedule
    - key: node.ocs.openshift.io/storage
      operator: Equal
      value: "true"
      effect: NoSchedule
YAML

cat <<'YAML' | oc apply -f -
apiVersion: local.storage.openshift.io/v1alpha1
kind: LocalVolumeSet
metadata:
  name: ceph-osd
  namespace: openshift-local-storage
spec:
  storageClassName: ceph-osd
  volumeMode: Block
  fsType: ext4
  maxDeviceCount: 1
  deviceInclusionSpec:
    deviceTypes: [disk]
    minSize: 900Gi
    maxSize: 1000Gi
  nodeSelector:
    nodeSelectorTerms:
      - matchExpressions:
          - key: cluster.ocs.openshift.io/openshift-storage
            operator: Exists
  tolerations:
    - key: node-role.kubernetes.io/infra
      operator: Exists
      effect: NoSchedule
    - key: node.ocs.openshift.io/storage
      operator: Equal
      value: "true"
      effect: NoSchedule
YAML

cat <<'YAML' | oc apply -f -
apiVersion: ocs.openshift.io/v1
kind: StorageCluster
metadata:
  name: ocs-storagecluster
  namespace: openshift-storage
spec:
  manageNodes: false
  monDataDirHostPath: /var/lib/rook
  multiCloudGateway:
    reconcileStrategy: manage
  storageDeviceSets:
    - name: ocs-deviceset
      count: 1
      replica: 3
      portable: false
      dataPVCTemplate:
        spec:
          accessModes: [ReadWriteOnce]
          resources:
            requests:
              storage: 980Gi
          storageClassName: ceph-osd
          volumeMode: Block
      placement:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: cluster.ocs.openshift.io/openshift-storage
                    operator: Exists
        tolerations:
          - key: node-role.kubernetes.io/infra
            operator: Exists
            effect: NoSchedule
          - key: node.ocs.openshift.io/storage
            operator: Equal
            value: "true"
            effect: NoSchedule
YAML
EOF
```

## 27. Install OpenShift Virtualization

_This section describes the steps performed by `playbooks/day2/openshift-post-install-virtualization.yml`, primarily the `openshift_post_install_virtualization` role._

Install CNV, set its default storage class, and install the workload
availability operators.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
export KUBECONFIG=/var/tmp/ocp-kubeconfig

oc create namespace openshift-cnv || true

cat <<'YAML' | oc apply -f -
apiVersion: operators.coreos.com/v1
kind: OperatorGroup
metadata:
  name: kubevirt-hyperconverged
  namespace: openshift-cnv
spec:
  targetNamespaces:
    - openshift-cnv
YAML

cat <<'YAML' | oc apply -f -
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: kubevirt-hyperconverged
  namespace: openshift-cnv
spec:
  channel: stable
  installPlanApproval: Automatic
  name: kubevirt-hyperconverged
  source: cs-redhat-operator-index-v4-20
  sourceNamespace: openshift-marketplace
YAML

oc wait --for=condition=Established crd/hyperconvergeds.hco.kubevirt.io --timeout=20m

oc annotate storageclass ocs-storagecluster-ceph-rbd \
  storageclass.kubevirt.io/is-default-virt-class=true --overwrite

cat <<'YAML' | oc apply -f -
apiVersion: hco.kubevirt.io/v1beta1
kind: HyperConverged
metadata:
  name: kubevirt-hyperconverged
  namespace: openshift-cnv
spec:
  vmStateStorageClass: ocs-storagecluster-ceph-rbd
YAML

oc create namespace openshift-workload-availability || true

cat <<'YAML' | oc apply -f -
apiVersion: operators.coreos.com/v1
kind: OperatorGroup
metadata:
  name: openshift-workload-availability
  namespace: openshift-workload-availability
spec:
  targetNamespaces: []
YAML

cat <<'YAML' | oc apply -f -
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: node-healthcheck-operator
  namespace: openshift-workload-availability
spec:
  channel: stable
  installPlanApproval: Automatic
  name: node-healthcheck-operator
  source: cs-redhat-operator-index-v4-20
  sourceNamespace: openshift-marketplace
---
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: fence-agents-remediation
  namespace: openshift-workload-availability
spec:
  channel: stable
  installPlanApproval: Automatic
  name: fence-agents-remediation
  source: cs-redhat-operator-index-v4-20
  sourceNamespace: openshift-marketplace
YAML
EOF
```

## 28. Install The Web Terminal

_This section describes the steps performed by `playbooks/day2/openshift-post-install-web-terminal.yml`, primarily the `openshift_post_install_web_terminal` role._

Install the operator, build the custom tooling image in the mirror registry, and
patch the Web Terminal tooling template to use it.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
export KUBECONFIG=/var/tmp/ocp-kubeconfig

cat <<'YAML' | oc apply -f -
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: web-terminal
  namespace: openshift-operators
spec:
  channel: fast
  installPlanApproval: Automatic
  name: web-terminal
  source: cs-redhat-operator-index-v4-20
  sourceNamespace: openshift-marketplace
YAML
EOF
```

Build and push the tooling image from the mirror registry host.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key cloud-user@172.16.0.20 <<'EOF'
sudo -i
mkdir -p /var/tmp/web-terminal-tooling
cat <<'CONTAINERFILE' >/var/tmp/web-terminal-tooling/Containerfile
FROM registry.redhat.io/web-terminal/web-terminal-tooling-rhel9:latest
RUN microdnf install -y \
    bind-utils \
    iperf3 \
    iproute \
    iputils \
    jq \
    nmap-ncat \
    openldap-clients \
    procps-ng \
    traceroute && \
    microdnf clean all
CONTAINERFILE

podman build -t mirror-registry.workshop.lan:8443/init/web-terminal-tooling-custom:latest \
  /var/tmp/web-terminal-tooling
podman push mirror-registry.workshop.lan:8443/init/web-terminal-tooling-custom:latest
EOF
```

Patch the pull secret and the terminal tooling template.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
export KUBECONFIG=/var/tmp/ocp-kubeconfig
REGISTRY_AUTH="$(printf '%s' 'init:<lab-default-password>' | base64 -w0)"

oc extract secret/pull-secret -n openshift-config --to=/tmp/pull-secret --confirm
cat /tmp/pull-secret/.dockerconfigjson | jq --arg auth "${REGISTRY_AUTH}" \
  '.auths["mirror-registry.workshop.lan:8443"] = {"auth":$auth,"email":"init@workshop.lan"}' \
  >/tmp/dockerconfigjson
oc set data secret/pull-secret -n openshift-config \
  .dockerconfigjson="$(cat /tmp/dockerconfigjson)"

cat <<'YAML' | oc apply -f -
apiVersion: workspace.devfile.io/v1alpha2
kind: DevWorkspaceTemplate
metadata:
  name: web-terminal-tooling
  namespace: openshift-operators
spec:
  components:
    - name: web-terminal-tooling
      container:
        image: mirror-registry.workshop.lan:8443/init/web-terminal-tooling-custom:latest
YAML

oc -n openshift-terminal delete devworkspace --all || true
EOF
```

## 29. Install Network Observability And Loki

_This section describes the steps performed by `playbooks/day2/openshift-post-install-netobserv.yml`, primarily the `openshift_post_install_netobserv` role._

Install the operators, create an ODF-backed `LokiStack`, and create a tuned
`FlowCollector`.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
export KUBECONFIG=/var/tmp/ocp-kubeconfig

oc create namespace netobserv || true
oc create namespace openshift-netobserv-operator || true
oc create namespace openshift-operators-redhat || true

cat <<'YAML' | oc apply -f -
apiVersion: operators.coreos.com/v1
kind: OperatorGroup
metadata:
  name: openshift-netobserv-operator
  namespace: openshift-netobserv-operator
spec:
  targetNamespaces: []
---
apiVersion: operators.coreos.com/v1
kind: OperatorGroup
metadata:
  name: openshift-operators-redhat
  namespace: openshift-operators-redhat
spec:
  targetNamespaces: []
YAML

cat <<'YAML' | oc apply -f -
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: netobserv-operator
  namespace: openshift-netobserv-operator
spec:
  channel: stable
  installPlanApproval: Automatic
  name: netobserv-operator
  source: cs-redhat-operator-index-v4-20
  sourceNamespace: openshift-marketplace
---
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: loki-operator
  namespace: openshift-operators-redhat
spec:
  channel: stable-6.2
  installPlanApproval: Automatic
  name: loki-operator
  source: cs-redhat-operator-index-v4-20
  sourceNamespace: openshift-marketplace
YAML
EOF
```

Create the object storage secret, `LokiStack`, and `FlowCollector`.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
export KUBECONFIG=/var/tmp/ocp-kubeconfig

cat <<'YAML' | oc apply -f -
apiVersion: v1
kind: Secret
metadata:
  name: loki-object-storage
  namespace: netobserv
stringData:
  bucketnames: netobserv-loki
  endpoint: https://s3.openshift-storage.svc
  access_key_id: REPLACE_WITH_NOOBAA_ACCESS_KEY
  access_key_secret: REPLACE_WITH_NOOBAA_SECRET_KEY
  region: us-east-1
YAML

cat <<'YAML' | oc apply -f -
apiVersion: loki.grafana.com/v1
kind: LokiStack
metadata:
  name: netobserv-loki
  namespace: netobserv
spec:
  size: 1x.extra-small
  storage:
    schemas:
      - effectiveDate: "2024-01-01"
        version: v13
    secret:
      name: loki-object-storage
      type: s3
  storageClassName: ocs-storagecluster-ceph-rbd
  tenants:
    mode: openshift-network
YAML

cat <<'YAML' | oc apply -f -
apiVersion: flows.netobserv.io/v1beta2
kind: FlowCollector
metadata:
  name: cluster
spec:
  namespace: netobserv
  deploymentModel: Service
  agent:
    type: eBPF
    ebpf:
      sampling: 1
      privileged: true
      features:
        - PacketDrop
        - DNSTracking
        - FlowRTT
        - NetworkEvents
        - PacketTranslation
      excludeInterfaces:
        - lo
  processor:
    consumerReplicas: 1
    subnetLabels:
      openShiftAutoDetect: true
      customLabels:
        - name: EXT:management
          cidrs: [172.16.0.0/24]
        - name: EXT:data300
          cidrs: [172.16.20.0/24]
        - name: EXT:data301
          cidrs: [172.16.21.0/24]
        - name: EXT:isolated302
          cidrs: [172.16.22.0/24]
    metrics:
      disableAlerts: false
  consolePlugin:
    enable: true
  networkPolicy:
    enable: true
  prometheus:
    querier:
      enable: true
  loki:
    enable: true
    mode: LokiStack
    lokiStack:
      name: netobserv-loki
      namespace: netobserv
YAML
EOF
```

## 30. Install Ansible Automation Platform

_This section describes the steps performed by `playbooks/day2/openshift-post-install-aap.yml`, primarily the `openshift_post_install_aap` role._

Install AAP on OpenShift and configure it to use IdM LDAP authentication.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
export KUBECONFIG=/var/tmp/ocp-kubeconfig

oc create namespace aap || true

cat <<'YAML' | oc apply -f -
apiVersion: operators.coreos.com/v1
kind: OperatorGroup
metadata:
  name: aap
  namespace: aap
spec:
  targetNamespaces:
    - aap
---
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: ansible-automation-platform-operator
  namespace: aap
spec:
  channel: stable-2.6
  installPlanApproval: Automatic
  name: ansible-automation-platform-operator
  source: cs-redhat-operator-index-v4-20
  sourceNamespace: openshift-marketplace
YAML

cat <<'YAML' | oc apply -f -
apiVersion: v1
kind: Secret
metadata:
  name: workshop-aap-admin-password
  namespace: aap
stringData:
  password: <lab-default-password>
---
apiVersion: v1
kind: Secret
metadata:
  name: workshop-aap-idm-ca
  namespace: aap
stringData:
  bundle-ca.crt: |
YAML
EOF
```

Append the IdM CA and create the AAP instance.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 \
  "curl -fsSL http://172.16.0.10/ipa/config/ca.crt >>/tmp/aap-idm-ca.yaml"

ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
export KUBECONFIG=/var/tmp/ocp-kubeconfig
oc apply -f /tmp/aap-idm-ca.yaml

cat <<'YAML' | oc apply -f -
apiVersion: aap.ansible.com/v1alpha1
kind: AnsibleAutomationPlatform
metadata:
  name: workshop-aap
  namespace: aap
spec:
  admin_user: admin
  admin_password_secret: workshop-aap-admin-password
  postgres_storage_class: ocs-storagecluster-ceph-rbd
  postgres_storage_requirements:
    requests:
      storage: 20Gi
YAML
EOF
```

Configure AAP LDAP authentication against IdM.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
export KUBECONFIG=/var/tmp/ocp-kubeconfig
AAP_ROUTE="$(oc -n aap get route workshop-aap -o jsonpath='{.spec.host}')"
TOKEN="$(curl -sk -X POST https://${AAP_ROUTE}/api/gateway/v1/token/ \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<lab-default-password>"}' | jq -r .access)"

curl -sk -X POST https://${AAP_ROUTE}/api/gateway/v1/authenticators/ \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d @- <<'JSON'
{
  "name": "Red Hat Identity Management",
  "type": "ldap",
  "configuration": {
    "host": "idm-01.workshop.lan",
    "port": 636,
    "bind_dn": "cn=Directory Manager",
    "bind_password": "<lab-default-password>",
    "user_search_base_dn": "cn=users,cn=accounts,dc=workshop,dc=lan",
    "group_search_base_dn": "cn=groups,cn=accounts,dc=workshop,dc=lan",
    "group_type": "MemberDNGroupType",
    "group_type_params": {
      "member_attr": "member",
      "name_attr": "cn"
    }
  }
}
JSON
EOF
```

## 31. Install OpenShift Pipelines

_This section describes the steps performed by `playbooks/day2/openshift-post-install-pipelines.yml`, primarily the `openshift_post_install_pipelines` role._

Install Tekton, make sure there is a default storage class, and install the
Windows EFI installer pipeline.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
export KUBECONFIG=/var/tmp/ocp-kubeconfig

oc annotate storageclass ocs-storagecluster-ceph-rbd \
  storageclass.kubernetes.io/is-default-class=true --overwrite

cat <<'YAML' | oc apply -f -
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: openshift-pipelines-operator-rh
  namespace: openshift-operators
spec:
  channel: pipelines-1.20
  installPlanApproval: Automatic
  name: openshift-pipelines-operator-rh
  source: cs-redhat-operator-index-v4-20
  sourceNamespace: openshift-marketplace
YAML

oc create namespace windows-image-builder || true
oc adm policy add-role-to-user edit system:serviceaccount:windows-image-builder:pipeline -n windows-image-builder

curl -L \
  https://raw.githubusercontent.com/openshift-pipelines/tektoncd-catalog/p/pipelines/windows-efi-installer/4.20.7/windows-efi-installer.yaml \
  | oc apply -n windows-image-builder -f -
EOF
```

## 32. Launch A Windows EFI Build

_This section describes the steps performed by `playbooks/day2/openshift-windows-server-build.yml`, primarily the `openshift_windows_server_build` role._

After setting a real Windows ISO URL in `vars/day2/windows_server_build.yml`, render
and launch a Windows Server build PipelineRun.

```bash
cd /opt/openshift/aws-metal-openshift-demo
vi vars/day2/windows_server_build.yml
ansible-playbook -i inventory/hosts.yml playbooks/day2/openshift-windows-server-build.yml
```

## 33. Pivot OperatorHub To The Disconnected Catalog

_This section describes the steps performed by `playbooks/day2/openshift-disconnected-operatorhub.yml`, primarily the `openshift_disconnected_operatorhub` role._

> [!IMPORTANT]
> In the automated path this runs **before** any operator subscriptions
> (sections 25-32). If you are walking the manual process in order, you have
> already been using the disconnected catalog source names
> (`cs-redhat-operator-index-v4-20`). This section exists for reference and for
> rebuilds where the pivot needs to be reapplied. All subsequent
operator installs (sections 25-32) use the disconnected catalog source names
(`cs-redhat-operator-index-v4-20`, `cc-redhat-operator-index-v4-20`) instead
of the upstream `redhat-operators` / `community-operators` defaults.

Disable the default remote catalogs and apply the mirrored CatalogSource
manifests that `oc-mirror` produced during section 15.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
export KUBECONFIG=/var/tmp/ocp-kubeconfig

cat <<'YAML' | oc apply -f -
apiVersion: config.openshift.io/v1
kind: OperatorHub
metadata:
  name: cluster
spec:
  disableAllDefaultSources: true
YAML

for manifest in /opt/openshift/oc-mirror/working-dir/cluster-resources/cs-*.yaml; do
  oc apply -f "$manifest"
done
EOF
```

## 34. Roll Out An IdM Ingress Certificate

_This section describes the steps performed by `playbooks/day2/openshift-post-install-idm-certs.yml`, primarily the `openshift_post_install_idm_certs` role._

> [!WARNING]
> **Ordering matters.** In the automated path, the IdM ingress cert pivot runs
> early (phase 3, after infra conversion but before LDAP). Applying it late
> causes extended CO degradation — console CO health checks failed for 28
> minutes in the first live run. See issue `44a51e8` in the issues ledger.

The supported certificate customization path is the ingress wildcard, not the
cluster API serving certificate.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
export KUBECONFIG=/var/tmp/ocp-kubeconfig
ssh -i /opt/openshift/secrets/hypervisor-admin.key cloud-user@172.16.0.10 <<'INNER'
sudo -i
kinit admin <<< '<lab-default-password>'
ipa dnsrecord-add ocp.workshop.lan apps --a-rec=172.16.10.7 || true
ipa service-add HTTP/apps.ocp.workshop.lan || true

cat <<'PROFILE' >/root/ocp-wildcard-ingress-profile.cfg
auth.instance_id=raCertAuth
classId=caEnrollImpl
desc=OpenShift wildcard ingress certificate profile
enable=true
enableBy=ipara
input.i1.class_id=certReqInputImpl
input.i2.class_id=submitterInfoInputImpl
input.list=i1,i2
name=OpenShift Wildcard Ingress Certificate Enrollment
output.list=o1
output.o1.class_id=certOutputImpl
policyset.list=serverCertSet
policyset.serverCertSet.1.constraint.class_id=subjectNameConstraintImpl
policyset.serverCertSet.1.constraint.name=Subject Name Constraint
policyset.serverCertSet.1.constraint.params.accept=true
policyset.serverCertSet.1.constraint.params.pattern=CN=[^,]+,.+
policyset.serverCertSet.1.default.class_id=subjectNameDefaultImpl
policyset.serverCertSet.1.default.name=Subject Name Default
policyset.serverCertSet.1.default.params.name=CN=$request.req_subject_name.cn$, O=WORKSHOP.LAN
policyset.serverCertSet.10.constraint.class_id=noConstraintImpl
policyset.serverCertSet.10.constraint.name=No Constraint
policyset.serverCertSet.10.default.class_id=subjectKeyIdentifierExtDefaultImpl
policyset.serverCertSet.10.default.name=Subject Key Identifier Extension Default
policyset.serverCertSet.10.default.params.critical=false
policyset.serverCertSet.11.constraint.class_id=noConstraintImpl
policyset.serverCertSet.11.constraint.name=No Constraint
policyset.serverCertSet.11.default.class_id=userExtensionDefaultImpl
policyset.serverCertSet.11.default.name=User Supplied Extension Default
policyset.serverCertSet.11.default.params.userExtOID=2.5.29.17
policyset.serverCertSet.12.constraint.class_id=noConstraintImpl
policyset.serverCertSet.12.constraint.name=No Constraint
policyset.serverCertSet.12.default.class_id=commonNameToSANDefaultImpl
policyset.serverCertSet.12.default.name=Copy Common Name to Subject Alternative Name
policyset.serverCertSet.2.constraint.class_id=validityConstraintImpl
policyset.serverCertSet.2.constraint.name=Validity Constraint
policyset.serverCertSet.2.constraint.params.notAfterCheck=false
policyset.serverCertSet.2.constraint.params.notBeforeCheck=false
policyset.serverCertSet.2.constraint.params.range=740
policyset.serverCertSet.2.default.class_id=validityDefaultImpl
policyset.serverCertSet.2.default.name=Validity Default
policyset.serverCertSet.2.default.params.range=731
policyset.serverCertSet.2.default.params.startTime=0
policyset.serverCertSet.3.constraint.class_id=keyConstraintImpl
policyset.serverCertSet.3.constraint.name=Key Constraint
policyset.serverCertSet.3.constraint.params.keyParameters=1024,2048,3072,4096,8192
policyset.serverCertSet.3.constraint.params.keyType=RSA
policyset.serverCertSet.3.default.class_id=userKeyDefaultImpl
policyset.serverCertSet.3.default.name=Key Default
policyset.serverCertSet.4.constraint.class_id=noConstraintImpl
policyset.serverCertSet.4.constraint.name=No Constraint
policyset.serverCertSet.4.default.class_id=authorityKeyIdentifierExtDefaultImpl
policyset.serverCertSet.4.default.name=Authority Key Identifier Default
policyset.serverCertSet.5.constraint.class_id=noConstraintImpl
policyset.serverCertSet.5.constraint.name=No Constraint
policyset.serverCertSet.5.default.class_id=authInfoAccessExtDefaultImpl
policyset.serverCertSet.5.default.name=AIA Extension Default
policyset.serverCertSet.5.default.params.authInfoAccessADEnable_0=true
policyset.serverCertSet.5.default.params.authInfoAccessADLocationType_0=URIName
policyset.serverCertSet.5.default.params.authInfoAccessADLocation_0=http://ipa-ca.workshop.lan/ca/ocsp
policyset.serverCertSet.5.default.params.authInfoAccessADMethod_0=1.3.6.1.5.5.7.48.1
policyset.serverCertSet.5.default.params.authInfoAccessCritical=false
policyset.serverCertSet.5.default.params.authInfoAccessNumADs=1
policyset.serverCertSet.6.constraint.class_id=keyUsageExtConstraintImpl
policyset.serverCertSet.6.constraint.name=Key Usage Extension Constraint
policyset.serverCertSet.6.constraint.params.keyUsageCritical=true
policyset.serverCertSet.6.constraint.params.keyUsageCrlSign=false
policyset.serverCertSet.6.constraint.params.keyUsageDataEncipherment=true
policyset.serverCertSet.6.constraint.params.keyUsageDecipherOnly=false
policyset.serverCertSet.6.constraint.params.keyUsageDigitalSignature=true
policyset.serverCertSet.6.constraint.params.keyUsageEncipherOnly=false
policyset.serverCertSet.6.constraint.params.keyUsageKeyAgreement=false
policyset.serverCertSet.6.constraint.params.keyUsageKeyCertSign=false
policyset.serverCertSet.6.constraint.params.keyUsageKeyEncipherment=true
policyset.serverCertSet.6.constraint.params.keyUsageNonRepudiation=true
policyset.serverCertSet.6.default.class_id=keyUsageExtDefaultImpl
policyset.serverCertSet.6.default.name=Key Usage Default
policyset.serverCertSet.6.default.params.keyUsageCritical=true
policyset.serverCertSet.6.default.params.keyUsageCrlSign=false
policyset.serverCertSet.6.default.params.keyUsageDataEncipherment=true
policyset.serverCertSet.6.default.params.keyUsageDecipherOnly=false
policyset.serverCertSet.6.default.params.keyUsageDigitalSignature=true
policyset.serverCertSet.6.default.params.keyUsageEncipherOnly=false
policyset.serverCertSet.6.default.params.keyUsageKeyAgreement=false
policyset.serverCertSet.6.default.params.keyUsageKeyCertSign=false
policyset.serverCertSet.6.default.params.keyUsageKeyEncipherment=true
policyset.serverCertSet.6.default.params.keyUsageNonRepudiation=true
policyset.serverCertSet.7.constraint.class_id=noConstraintImpl
policyset.serverCertSet.7.constraint.name=No Constraint
policyset.serverCertSet.7.default.class_id=extendedKeyUsageExtDefaultImpl
policyset.serverCertSet.7.default.name=Extended Key Usage Extension Default
policyset.serverCertSet.7.default.params.exKeyUsageCritical=false
policyset.serverCertSet.7.default.params.exKeyUsageOIDs=1.3.6.1.5.5.7.3.1,1.3.6.1.5.5.7.3.2
policyset.serverCertSet.8.constraint.class_id=signingAlgConstraintImpl
policyset.serverCertSet.8.constraint.name=No Constraint
policyset.serverCertSet.8.constraint.params.signingAlgsAllowed=SHA1withRSA,SHA256withRSA,SHA384withRSA,SHA512withRSA,MD5withRSA,MD2withRSA,SHA1withDSA,SHA1withEC,SHA256withEC,SHA384withEC,SHA512withEC
policyset.serverCertSet.8.default.class_id=signingAlgDefaultImpl
policyset.serverCertSet.8.default.name=Signing Alg
policyset.serverCertSet.8.default.params.signingAlg=-
policyset.serverCertSet.9.constraint.class_id=noConstraintImpl
policyset.serverCertSet.9.constraint.name=No Constraint
policyset.serverCertSet.9.default.class_id=crlDistributionPointsExtDefaultImpl
policyset.serverCertSet.9.default.name=CRL Distribution Points Extension Default
policyset.serverCertSet.9.default.params.crlDistPointsCritical=false
policyset.serverCertSet.9.default.params.crlDistPointsEnable_0=true
policyset.serverCertSet.9.default.params.crlDistPointsIssuerName_0=CN=Certificate Authority,o=ipaca
policyset.serverCertSet.9.default.params.crlDistPointsIssuerType_0=DirectoryName
policyset.serverCertSet.9.default.params.crlDistPointsNum=1
policyset.serverCertSet.9.default.params.crlDistPointsPointName_0=http://ipa-ca.workshop.lan/ipa/crl/MasterCRL.bin
policyset.serverCertSet.9.default.params.crlDistPointsPointType_0=URIName
policyset.serverCertSet.9.default.params.crlDistPointsReasons_0=
policyset.serverCertSet.list=1,2,3,4,5,6,7,8,9,10,11,12
profileId=ocpWildcardIngress
visible=false
PROFILE

ipa certprofile-show ocpWildcardIngress >/dev/null 2>&1 || \
  ipa certprofile-import ocpWildcardIngress \
    --file /root/ocp-wildcard-ingress-profile.cfg \
    --desc "OpenShift wildcard ingress certificate profile" \
    --store=true
INNER
EOF

openssl req -new -newkey rsa:2048 -nodes \
  -keyout /tmp/apps.key \
  -out /tmp/apps.csr \
  -subj '/CN=apps.ocp.workshop.lan' \
  -addext 'subjectAltName=DNS:apps.ocp.workshop.lan,DNS:*.apps.ocp.workshop.lan'

scp -i /opt/openshift/secrets/hypervisor-admin.key \
  /tmp/apps.csr cloud-user@172.16.0.10:/tmp/apps.csr

ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
export KUBECONFIG=/var/tmp/ocp-kubeconfig
ssh -i /opt/openshift/secrets/hypervisor-admin.key cloud-user@172.16.0.10 <<'INNER'
sudo -i
kinit admin <<< '<lab-default-password>'
ipa cert-request /tmp/apps.csr \
  --principal=HTTP/apps.ocp.workshop.lan \
  --profile-id=ocpWildcardIngress \
  --certificate-out=/tmp/apps.crt
INNER
EOF

scp -i /opt/openshift/secrets/hypervisor-admin.key \
  cloud-user@172.16.0.10:/tmp/apps.crt /tmp/apps.crt

ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
export KUBECONFIG=/var/tmp/ocp-kubeconfig
oc -n openshift-config create configmap idm-ca-trust \
  --from-file=ca-bundle.crt=/var/tmp/idm-ca.crt \
  --dry-run=client -o yaml | oc apply -f -
oc patch proxy cluster --type=merge \
  -p '{"spec":{"trustedCA":{"name":"idm-ca-trust"}}}'
oc -n openshift-ingress create secret tls ingress-default-idm-tls \
  --cert=/var/tmp/apps.crt \
  --key=/var/tmp/apps.key \
  --dry-run=client -o yaml | oc apply -f -
cat <<'YAML' | oc apply -f -
apiVersion: operator.openshift.io/v1
kind: IngressController
metadata:
  name: default
  namespace: openshift-ingress-operator
spec:
  defaultCertificate:
    name: ingress-default-idm-tls
YAML
EOF
```

## 35. Cleanup

_This section describes the steps performed by `playbooks/maintenance/cleanup.yml` and the cleanup roles it aggregates._

> [!CAUTION]
> **This is destructive and not reversible.** It destroys VMs and wipes disks.
> The mirror-registry archive and all OpenShift cluster state will be gone. If
> you only want to rebuild the cluster, use `openshift_cluster_cleanup` instead
> of the full cleanup.

Destroy the OpenShift cluster shells, optionally wipe the disks, and clean up
the support VM and lab-switch state.

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 <<'EOF'
for domain in \
  ocp-master-01.ocp.workshop.lan \
  ocp-master-02.ocp.workshop.lan \
  ocp-master-03.ocp.workshop.lan \
  ocp-infra-01.ocp.workshop.lan \
  ocp-infra-02.ocp.workshop.lan \
  ocp-infra-03.ocp.workshop.lan \
  ocp-worker-01.ocp.workshop.lan \
  ocp-worker-02.ocp.workshop.lan \
  ocp-worker-03.ocp.workshop.lan; do
  virsh destroy "$domain" || true
  virsh undefine "$domain" --nvram || true
done

for disk in \
  /dev/ebs/ocp-master-01 /dev/ebs/ocp-master-02 /dev/ebs/ocp-master-03 \
  /dev/ebs/ocp-infra-01 /dev/ebs/ocp-infra-02 /dev/ebs/ocp-infra-03 \
  /dev/ebs/ocp-worker-01 /dev/ebs/ocp-worker-02 /dev/ebs/ocp-worker-03 \
  /dev/ebs/ocp-infra-01-data /dev/ebs/ocp-infra-02-data /dev/ebs/ocp-infra-03-data; do
  wipefs -a "$disk" || true
  dd if=/dev/zero of="$disk" bs=1M count=100 oflag=direct,dsync status=progress || true
done
EOF

rm -rf /opt/openshift/generated/ocp
```

## 36. Manual Debugging Examples

These commands are useful when teaching or troubleshooting the manual process.

Check cluster status from the correct side of the network boundary:

```bash
export KUBECONFIG=/opt/openshift/aws-metal-openshift-demo/generated/ocp/auth/kubeconfig
/opt/openshift/aws-metal-openshift-demo/generated/tools/4.20.15/bin/oc get clusterversion
/opt/openshift/aws-metal-openshift-demo/generated/tools/4.20.15/bin/oc get nodes
/opt/openshift/aws-metal-openshift-demo/generated/tools/4.20.15/bin/oc get co
```

Check libvirt state on `virt-01`:

```bash
ssh -i /opt/openshift/secrets/hypervisor-admin.key root@172.16.0.1 \
  "virsh list --all"
```

Check ODF storage state:

```bash
oc -n openshift-storage get storagecluster
oc -n openshift-storage get cephcluster
oc -n openshift-local-storage get localvolumediscovery
oc -n openshift-local-storage get localvolumeset
```

Check NetObserv and Loki:

```bash
oc -n netobserv get flowcollector
oc -n netobserv get lokistack
oc -n netobserv get pods
```

Check AAP:

```bash
oc -n aap get pods
oc -n aap get route
```

Check Tekton and Windows build lane:

```bash
oc -n openshift-pipelines get tektonconfig
oc -n windows-image-builder get pipeline
oc -n windows-image-builder get pipelinerun
```
