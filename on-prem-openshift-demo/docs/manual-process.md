# On-Prem Manual Process

> [!WARNING]
> This on-prem target is experimental. Treat the docs and playbooks in this
> subtree as an emerging alternate installation path, not yet the same
> confidence level as the validated AWS-target flow.

Nearby docs:

<a href="./prerequisites.md"><kbd>&nbsp;&nbsp;PREREQUISITES&nbsp;&nbsp;</kbd></a>
<a href="./automation-flow.md"><kbd>&nbsp;&nbsp;AUTOMATION FLOW&nbsp;&nbsp;</kbd></a>
<a href="./host-sizing-and-resource-policy.md"><kbd>&nbsp;&nbsp;HOST SIZING&nbsp;&nbsp;</kbd></a>
<a href="./portability-and-gap-analysis.md"><kbd>&nbsp;&nbsp;PORTABILITY / GAPS&nbsp;&nbsp;</kbd></a>
<a href="../../aws-metal-openshift-demo/docs/manual-process.md"><kbd>&nbsp;&nbsp;AWS MANUAL PROCESS&nbsp;&nbsp;</kbd></a>
<a href="./README.md"><kbd>&nbsp;&nbsp;ON-PREM DOCS MAP&nbsp;&nbsp;</kbd></a>

This page covers only the on-prem-specific portion of the operator workflow.
Once the host is prepared, guest storage exists, and bastion staging is done,
return to the stock
<a href="../../aws-metal-openshift-demo/docs/manual-process.md"><kbd>AWS MANUAL PROCESS</kbd></a>.

## Table Of Contents

- [1. Prepare The Operator Workstation](#1-prepare-the-operator-workstation)
- [2. Verify The On-Prem `virt-01` Host Contract](#2-verify-the-on-prem-virt-01-host-contract)
- [3. Prepare The Guest Storage Volume Group](#3-prepare-the-guest-storage-volume-group)
- [4. Configure The On-Prem Inventory And Group Vars](#4-configure-the-on-prem-inventory-and-group-vars)
- [5. Bootstrap The Host And Provision Guest LVs](#5-bootstrap-the-host-and-provision-guest-lvs)
- [6. Build The Bastion And Stage The Project](#6-build-the-bastion-and-stage-the-project)
- [7. Hand Back To The Stock Runbook](#7-hand-back-to-the-stock-runbook)

## 1. Prepare The Operator Workstation

The on-prem path uses the same controller-side secret and content inputs as the
AWS path, except there is no public-cloud CLI or stack deployment step.

Required local inputs:

- repo checkout
- SSH keypair
- pull secret
- RHSM credentials
- optional local lab credentials

Keep these stock pages nearby:

- <a href="../../aws-metal-openshift-demo/docs/prerequisites.md#what-you-need-from-red-hat"><kbd>AWS PREREQUISITES: RED HAT INPUTS</kbd></a>
- <a href="../../aws-metal-openshift-demo/docs/secrets-and-sanitization.md"><kbd>SECRETS</kbd></a>

Install the collection dependencies and syntax-check the on-prem entrypoints:

```bash
cd <project-root>/aws-metal-openshift-demo
ansible-galaxy collection install -r requirements.yml

cd <project-root>/on-prem-openshift-demo
ansible-playbook --syntax-check playbooks/site-bootstrap.yml
ansible-playbook --syntax-check playbooks/site-precluster.yml
ansible-playbook --syntax-check playbooks/site-lab.yml
```

## 2. Verify The On-Prem `virt-01` Host Contract

The on-prem target starts after the host already exists. Before bootstrap,
confirm that host can stand in for `virt-01`:

- SSH reachable from the operator workstation
- RHEL installed and updated to the desired baseline
- nested KVM available
- an uplink interface is present for OVS integration
- local storage is visible and the guest VG exists or can be created
- you know what bastion-side host and user you want to publish through:
  - `on_prem_bastion_hypervisor_host`
  - `on_prem_bastion_hypervisor_user`

Minimal verification:

```bash
ssh <hypervisor-admin-user>@<hypervisor-management-ip> <<'EOF'
hostnamectl --static
sudo virt-host-validate
sudo lsblk
sudo vgs
EOF
```

If CPU, RAM, or NUMA shape differs from the validated `m5.metal` baseline,
read the host-sizing guidance before bootstrap:

- <a href="./host-sizing-and-resource-policy.md"><kbd>HOST SIZING</kbd></a>

## 3. Prepare The Guest Storage Volume Group

On-prem guest disks are created as logical volumes inside an operator-provided
volume group.

The current lab footprint expects roughly:

- `5950 GiB` of guest LV capacity for the full current design

That is only the raw guest-disk sum. Leave additional headroom for:

- host root growth
- image cache
- mirror-content staging
- rebuild hygiene

Example check:

```bash
ssh <hypervisor-admin-user>@<hypervisor-management-ip> <<'EOF'
sudo vgs
sudo lvs
EOF
```

If the volume group does not exist yet, create it before bootstrap using your
site-local storage procedure. This repo does **not** own PV creation.

What the repo does own:

- validating the volume group exists
- validating free space before provisioning
- creating the missing guest LVs
- publishing the `/dev/ebs/*` compatibility symlinks the stock guest roles use

If you want the on-prem subtree to seed a dedicated guest VG from one explicit
lab disk, use the optional override inputs:

- `on_prem_lvm_seed_enabled: true`
- `on_prem_lvm_seed_device: /dev/nvme0n1`
- `on_prem_lvm_seed_force: false`

That path is opt-in and additive. It does not change the stock on-prem
defaults, and it fails closed unless you explicitly enable it. When forced, it
uses the same destructive whole-device wipe profile the project uses for ODF
backing-disk recovery before creating the guest VG.

## 4. Configure The On-Prem Inventory And Group Vars

The current on-prem target keeps the stock `aws_metal` inventory-group name on
purpose so the existing support/day-2 playbooks do not need to fork.

Edit these files before the first run:

- <a href="../inventory/hosts.yml"><kbd>inventory/hosts.yml</kbd></a>
- <a href="../inventory/group_vars/all.yml"><kbd>inventory/group_vars/all.yml</kbd></a>

For hosts that should stop before cluster build, start from one of:

- <a href="../inventory/overrides/core-services.yml.example"><kbd>inventory/overrides/core-services.yml.example</kbd></a>
- <a href="../inventory/overrides/core-services-ad.yml.example"><kbd>inventory/overrides/core-services-ad.yml.example</kbd></a>
- <a href="../inventory/overrides/precluster-64g.yml.example"><kbd>inventory/overrides/precluster-64g.yml.example</kbd></a>

What must be correct:

- `ansible_host`
- `ansible_user`
- `ansible_ssh_private_key_file`
- `on_prem_lvm_volume_group`
- `on_prem_bastion_hypervisor_host`
- `on_prem_bastion_hypervisor_user`
- any optional `on_prem_lvm_lv_name_prefix`
- any project-local credential overrides

If you are using the reduced `precluster-64g` profile, copy the example
override and edit the actual device path before the first run:

```bash
cd <project-root>/on-prem-openshift-demo
cp inventory/overrides/precluster-64g.yml.example \
  inventory/overrides/precluster-64g.yml
```

At this stage, the on-prem subtree reuses the stock guest and day-2 vars and
playbooks from `aws-metal-openshift-demo` through local wrappers. It does not
modify the AWS-target codepath.

## 5. Bootstrap The Host And Provision Guest LVs

This is the main on-prem divergence from the AWS path.

Run:

```bash
cd <project-root>/on-prem-openshift-demo

./scripts/run_local_playbook.sh playbooks/bootstrap/site.yml
```

For the reduced pre-cluster profile:

```bash
cd <project-root>/on-prem-openshift-demo

./scripts/run_local_playbook.sh playbooks/bootstrap/site.yml \
  -e @inventory/overrides/precluster-64g.yml
```

For the support-services-only AD profile:

```bash
cd <project-root>/on-prem-openshift-demo

./scripts/run_local_playbook.sh playbooks/bootstrap/site.yml \
  -e @inventory/overrides/core-services-ad.yml.example
```

This is the on-prem equivalent of the early AWS host steps:

- host base configuration
- host CPU and memory policy
- OVS / libvirt host setup
- guest base-image staging
- LVM guest LV validation and creation
- `/dev/ebs/*` compatibility symlink publication

> [!NOTE]
> The shared host bootstrap now updates `redhat-release` before the full system
> update. This ensures the current Red Hat Post-Quantum Cryptography public
> keys are present before DNF validates newer packages. See:
> <https://access.redhat.com/solutions/3449341>

When it succeeds, the host should satisfy the same effective guest-disk
contract the stock guest roles already expect.

Useful verification:

```bash
ssh <hypervisor-admin-user>@<hypervisor-management-ip> <<'EOF'
sudo lvs
sudo ls -l /dev/ebs
EOF
```

## 6. Build The Bastion And Stage The Project

The current on-prem `site-bootstrap.yml`:

- runs the on-prem bootstrap host prep
- reuses the stock bastion build
- stages both the on-prem subtree and the stock AWS-target subtree onto bastion
  through the local on-prem bastion-stage wrapper
- rewrites the bastion-side runtime inventory so the bastion can SSH back to
  the hypervisor without requiring `ec2-user`

Run:

```bash
cd <project-root>/on-prem-openshift-demo

./scripts/run_local_playbook.sh playbooks/site-bootstrap.yml
```

For the reduced pre-cluster profile:

```bash
cd <project-root>/on-prem-openshift-demo

./scripts/run_local_playbook.sh playbooks/site-bootstrap.yml \
  -e @inventory/overrides/precluster-64g.yml
```

For the support-services-only AD profile:

```bash
cd <project-root>/on-prem-openshift-demo

./scripts/run_local_playbook.sh playbooks/site-bootstrap.yml \
  -e @inventory/overrides/core-services-ad.yml.example
```

After this, the bastion should exist and the project should be staged.

## 7. Hand Back To The Stock Runbook

At this point, the on-prem-specific portion is over.

Choose the next stock runbook entry based on what you already completed:

- if you want the manual bastion-forward process:
  - <a href="../../aws-metal-openshift-demo/docs/manual-process.md#13a-optionally-build-ad-ds-and-ad-cs-from-bastion"><kbd>Resume at AWS manual step 13A</kbd></a>
- if you are still walking the support-services flow by hand from the bastion build:
  - <a href="../../aws-metal-openshift-demo/docs/manual-process.md#12-build-the-bastion-vm"><kbd>Resume at AWS manual step 12</kbd></a>

For automation rather than the hand-run sequence on a cluster-capable host,
use:

```bash
cd <project-root>/on-prem-openshift-demo
./scripts/run_remote_bastion_playbook.sh playbooks/site-lab.yml
```

For support-services-only profiles such as `core-services` or
`core-services-ad`, stop after the support-service path instead of continuing
into cluster build:

```bash
cd <project-root>/on-prem-openshift-demo
./scripts/run_remote_bastion_playbook.sh playbooks/site-precluster.yml \
  -e @inventory/overrides/core-services-ad.yml.example
```

Or, from the staged on-prem tree on bastion:

```bash
cd <staged-on-prem-project-root>
./scripts/run_bastion_playbook.sh playbooks/site-precluster.yml \
  -e @inventory/overrides/core-services-ad.yml.example
```

That path stops after:

- optional `ad-server`
- `idm`
- optional `idm-ad-trust`
- `bastion-join`
- `mirror-registry`

For the reduced `precluster-64g` profile, also stop at mirror-registry instead
of continuing into cluster build:

```bash
cd <staged-on-prem-project-root>
./scripts/run_bastion_playbook.sh playbooks/site-precluster.yml \
  -e @inventory/overrides/precluster-64g.yml
```
