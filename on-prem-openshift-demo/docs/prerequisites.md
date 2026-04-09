# On-Prem Prerequisites

> [!WARNING]
> This on-prem target is experimental. Treat the docs and playbooks in this
> subtree as an emerging alternate installation path, not yet the same
> confidence level as the validated AWS-target flow.

Nearby docs:

<a href="./automation-flow.md"><kbd>&nbsp;&nbsp;AUTOMATION FLOW&nbsp;&nbsp;</kbd></a>
<a href="./manual-process.md"><kbd>&nbsp;&nbsp;MANUAL PROCESS&nbsp;&nbsp;</kbd></a>
<a href="./host-sizing-and-resource-policy.md"><kbd>&nbsp;&nbsp;HOST SIZING&nbsp;&nbsp;</kbd></a>
<a href="./portability-and-gap-analysis.md"><kbd>&nbsp;&nbsp;PORTABILITY / GAPS&nbsp;&nbsp;</kbd></a>
<a href="../../aws-metal-openshift-demo/docs/prerequisites.md"><kbd>&nbsp;&nbsp;AWS PREREQUISITES&nbsp;&nbsp;</kbd></a>
<a href="./README.md"><kbd>&nbsp;&nbsp;ON-PREM DOCS MAP&nbsp;&nbsp;</kbd></a>

This page covers only the prerequisites that differ from the AWS path. For the
shared Red Hat, Microsoft, and lab-input guidance, keep
<a href="../../aws-metal-openshift-demo/docs/prerequisites.md"><kbd>AWS PREREQUISITES</kbd></a>
nearby.

## What You Need On The Operator Workstation

- a local checkout of this repo
- `ansible-core`
- `rsync`
- `ssh` and a working SSH keypair
- enough local disk to stage the repo, pull secret, and generated artifacts

Unlike the AWS path, the on-prem target does **not** require:

- `aws` CLI
- CloudFormation permissions
- EBS quota
- Elastic IP allocation

Install the required collection with:

```bash
cd <project-root>
ansible-galaxy collection install -r aws-metal-openshift-demo/requirements.yml
```

## What You Need On The On-Prem Hypervisor

Assume you are starting from a freshly installed RHEL host that will act as
`virt-01`.

Required host contract:

- RHEL host with virtualization support
- nested KVM available and stable
- libvirt / KVM capable hardware
- an uplink that OVS can build around
- SSH reachability from the operator workstation
- enough local storage and RAM for the selected guest footprint
- a lab-management path from bastion back to the hypervisor, with explicit
  on-prem runtime settings for:
  - `on_prem_bastion_hypervisor_host`
  - `on_prem_bastion_hypervisor_user`

The current inventory example is:

- <a href="../inventory/hosts.yml"><kbd>on-prem-openshift-demo/inventory/hosts.yml</kbd></a>

The current group-wide on-prem settings live in:

- <a href="../inventory/group_vars/all.yml"><kbd>on-prem-openshift-demo/inventory/group_vars/all.yml</kbd></a>

Keep the access paths separate:

- `inventory/hosts.yml` describes how **you** reach the hypervisor from the
  operator workstation
- `on_prem_bastion_hypervisor_host` and `on_prem_bastion_hypervisor_user`
  describe how **bastion** reaches that same hypervisor on the lab network

## The LVM Storage Contract

You must provide one LVM2 volume group that backs the guest logical volumes.

Required inputs:

- `on_prem_lvm_volume_group`
- optional `on_prem_lvm_lv_name_prefix`
- optional `on_prem_lvm_guest_symlink_root`

The on-prem bootstrap validates that volume group and checks free space before
any `lvcreate` runs.

Current full-footprint guest storage requirement from the stock volume
inventory is approximately:

- `5950 GiB` for all current guest logical volumes

That includes:

- bastion
- IdM
- mirror registry
- optional AD
- 3 control-plane nodes
- 3 infra nodes
- 3 worker nodes
- 3 ODF data disks

If you are not building the optional AD guest, subtract:

- `60 GiB`

This storage figure does **not** include:

- host root disk sizing
- RHEL guest image cache
- mirror-content workspace overhead
- general operator headroom

Do not size the volume group to the raw sum and stop there.

Treat the AWS `gp3` performance settings as workload hints. The current on-prem
path preserves capacity and stable disk identity. It does **not** yet translate
per-volume AWS `gp3` IOPS and throughput settings into libvirt or host-level
storage QoS controls.

Plan for:

- fast local SSD or NVMe storage, or a proven SAN-backed block tier
- enough aggregate I/O for concurrent guest boot, mirror-registry activity, and
  OpenShift node churn
- headroom beyond the raw LV capacity sum so the backend is not saturated under
  normal cluster and day-2 load

## CPU And Memory Baseline

The current validated host baseline is still AWS `m5.metal`-like:

- `96` logical CPUs
- `384 GiB` RAM
- symmetric socket / SMT layout

If the on-prem host drifts from that shape, read:

- <a href="./host-sizing-and-resource-policy.md"><kbd>HOST SIZING</kbd></a>

Do not copy the current CPU-pool strings blindly onto a smaller or differently
numbered host.

## Red Hat And Content Inputs

You still need the same Red Hat content inputs as the AWS path:

- pull secret
- RHSM credentials
- RHEL 10.1 guest image source

The host image source is now your on-prem RHEL install, not an AWS AMI.

Keep the stock guidance nearby:

- <a href="../../aws-metal-openshift-demo/docs/prerequisites.md#what-you-need-from-red-hat"><kbd>AWS PREREQUISITES: RED HAT INPUTS</kbd></a>

## Optional Microsoft Inputs

If you plan to enable AD DS / AD CS, the optional Windows media requirements do
not change.

Use the same source and placement guidance as the stock path:

- <a href="../../aws-metal-openshift-demo/docs/prerequisites.md#optional-what-you-need-from-microsoft"><kbd>AWS PREREQUISITES: MICROSOFT INPUTS</kbd></a>

## Quick On-Prem Preflight

Before bootstrap, validate:

```bash
ssh <hypervisor-admin-user>@<hypervisor-management-ip> 'hostnamectl --static'
ssh <hypervisor-admin-user>@<hypervisor-management-ip> 'sudo vgs'
ssh <hypervisor-admin-user>@<hypervisor-management-ip> 'sudo virt-host-validate'
test -f ~/pull-secret.txt
test -f ~/.ssh/id_ed25519
```

From the repo:

```bash
cd <project-root>/on-prem-openshift-demo
ansible-playbook --syntax-check playbooks/site-bootstrap.yml
ansible-playbook --syntax-check playbooks/site-lab.yml
```

## Where To Go Next

- for the on-prem build order: <a href="./automation-flow.md"><kbd>AUTOMATION FLOW</kbd></a>
- for the on-prem run order: <a href="./manual-process.md"><kbd>MANUAL PROCESS</kbd></a>
- for resource drift and oversubscription guidance: <a href="./host-sizing-and-resource-policy.md"><kbd>HOST SIZING</kbd></a>
- for the stock docs once the host contract is satisfied: <a href="../../aws-metal-openshift-demo/docs/README.md"><kbd>AWS DOCS MAP</kbd></a>
