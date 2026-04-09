# Portability And Gap Analysis

> [!WARNING]
> This on-prem target is experimental. Treat the docs and playbooks in this
> subtree as an emerging alternate installation path, not yet the same
> confidence level as the validated AWS-target flow.

Nearby docs:

<a href="./prerequisites.md"><kbd>&nbsp;&nbsp;PREREQUISITES&nbsp;&nbsp;</kbd></a>
<a href="./automation-flow.md"><kbd>&nbsp;&nbsp;AUTOMATION FLOW&nbsp;&nbsp;</kbd></a>
<a href="./manual-process.md"><kbd>&nbsp;&nbsp;MANUAL PROCESS&nbsp;&nbsp;</kbd></a>
<a href="./host-sizing-and-resource-policy.md"><kbd>&nbsp;&nbsp;HOST SIZING&nbsp;&nbsp;</kbd></a>
<a href="./README.md"><kbd>&nbsp;&nbsp;ON-PREM DOCS MAP&nbsp;&nbsp;</kbd></a>

## Executive Summary

This page separates what is already portable from what still depends on the
current AWS-shaped host contract.

The repo now ships an initial on-prem target under:

- <a href="../playbooks/site-bootstrap.yml"><kbd>on-prem-openshift-demo/playbooks/site-bootstrap.yml</kbd></a>
- <a href="../playbooks/site-lab.yml"><kbd>on-prem-openshift-demo/playbooks/site-lab.yml</kbd></a>

The AWS-specific part is mostly the substrate that creates `virt-01` and its
attached guest block devices. Once your host exists and presents the expected
network, storage, and execution contract, the rest of the lab behaves like a
host-local KVM/libvirt/Open vSwitch environment.

That means:

- the support guest build flow is mostly portable
- the disconnected OpenShift install flow is mostly portable
- the bastion split and day-2 flow are mostly portable
- the main work is replacing the AWS host-acquisition contract with an on-prem
  host-preparation contract

## Current Portability Boundary

### AWS-bound today

These pieces are directly tied to AWS or to assumptions created by the AWS
layer:

- `aws-metal-openshift-demo/cloudformation/`
  - tenant stack
  - host stack
  - combined virt-lab stack
  - volume inventory source
- `aws-metal-openshift-demo/playbooks/bootstrap/site.yml`
  - AWS instance discovery
  - AWS volume discovery
  - live EBS mapping bootstrap
- `aws-metal-openshift-demo/docs/iaas-resource-model.md`
  - entirely AWS-specific by design
- `aws-metal-openshift-demo/docs/prerequisites.md`
  - currently assumes AWS account, EBS quota, Elastic IP, and AWS CLI

### Portable in practice once the host exists

These parts are already fundamentally host-local:

- KVM/libvirt guest provisioning
- Open vSwitch and lab VLAN topology
- support guest configuration:
  - IdM
  - bastion
  - mirror registry
  - AD
- bastion staging and workstation-to-bastion handoff
- mirrored-content and disconnected install flows
- OpenShift cluster stand-up
- day-2 operator and auth automation
- Keycloak / OpenShift / AAP auth model

### Host assumptions that must still be satisfied

Your on-prem server can reuse most of the current orchestration only if it
provides the same effective host contract as `virt-01`:

- RHEL host with the required virtualization and networking stack
- nested KVM available and stable
- enough CPU, RAM, and storage headroom for the selected cluster shape
- deterministic guest block-device naming
- a working uplink for management traffic
- a VLAN-capable or equivalent Open vSwitch model
- an operator path to the host from the workstation

## The Three Real Gaps

### 1. Outer host acquisition

Today AWS creates:

- the host itself
- public access path
- guest block devices
- stable volume inventory input

On-prem, those responsibilities move outside the current CloudFormation layer.

You need your own answer for:

- how `virt-01` is installed
- how the operator reaches it
- how guest disks are attached
- how those disks are named consistently

### 2. Hypervisor identity

The code still uses the inventory group name `aws_metal` almost everywhere.

That does **not** mean the lab is deeply AWS-only. In practice it means:

- playbooks target one hypervisor host through the `aws_metal` group
- some tasks derive the hypervisor host via `groups['aws_metal']`

The current on-prem path does this:

- keep the inventory group name `aws_metal` even for an on-prem host

Cleaner long-term path:

- rename or abstract that inventory group to something neutral like
  `lab_hypervisor`

### 3. Deterministic guest block-device naming

This is the biggest practical portability dependency.

The guest definitions and several roles assume stable block-device names such as:

- `/dev/ebs/idm-01`
- `/dev/ebs/bastion-01`
- `/dev/ebs/mirror-registry`
- `/dev/ebs/ocp-master-01`
- `/dev/ebs/ocp-infra-01-data`

Those names are fed by:

- `aws-metal-openshift-demo/cloudformation/virt-01-volume-inventory.yml`
- `aws-metal-openshift-demo/roles/lab_host_base/tasks/main.yml`
- guest vars under `aws-metal-openshift-demo/vars/guests/`

The current on-prem target now satisfies this by:

- creating guest logical volumes from an operator-provided LVM volume group
- publishing `/dev/ebs/*` compatibility symlinks

That keeps the existing guest and cluster roles reusable even though the
backing devices are now on-prem LVs rather than AWS EBS volumes.

Those backing devices may be:

- local NVMe
- RAID LUNs
- SAN-backed block devices
- local SSDs presented by HBA order

What the current on-prem target does **not** carry over yet is the AWS `gp3`
performance contract. It preserves the disk layout and naming contract, but it
does not currently convert per-volume AWS IOPS and throughput settings into
libvirt `iotune` or any other host-level storage QoS policy.

## Current On-Prem Bring-Up Model

The current shipped on-prem target takes the lowest-risk path:

1. Install a RHEL host manually so it becomes the on-prem equivalent of
   `virt-01`.
2. Provide an LVM volume group with enough free space for the guest footprint.
3. Let on-prem bootstrap create the guest LVs and deterministic
   `/dev/ebs/*` compatibility symlinks.
4. Keep the inventory host in the `aws_metal` group initially.
5. Set the operator-side and bastion-side hypervisor SSH users explicitly.
6. Skip the AWS host-acquisition layer and run only the host/bootstrap and lab
   orchestration from the point where the host contract is satisfied.

For the current branch, that split is now explicit:

- `inventory/hosts.yml` is the operator-workstation path to the hypervisor
- `on_prem_bastion_hypervisor_host` and `on_prem_bastion_hypervisor_user`
  define the bastion-side return path to that same host

In that model, most of the current playbooks work with little or no
orchestration change.

The tradeoff is that the current target is capacity-first, not QoS-first:

- it validates space
- it provisions the expected guest disks
- it preserves stable guest disk identity
- it expects you to provide a backend with enough aggregate performance

The current branch also keeps the AWS-target tree pristine. The on-prem target
reuses the stock support-service and day-2 code through local wrappers in
`on-prem-openshift-demo/` rather than by modifying the validated AWS path.

## What Would Need To Change For A First-Class On-Prem Target

If you want a more neutral long-term target rather than “prepare the host to
look like current `virt-01`,” the code should eventually change in these
places:

### Replace AWS bootstrap discovery in `playbooks/bootstrap/site.yml`

Current AWS-bound pre-tasks:

- discover current instance ID
- query live attached EBS volumes from AWS
- derive active guest volume mapping from AWS

First-class on-prem target should instead consume:

- a neutral host inventory file
- a neutral guest volume inventory file
- a host-local or inventory-driven mapping source

### Split the current volume inventory away from CloudFormation

Today the effective source of truth is under:

- `aws-metal-openshift-demo/cloudformation/virt-01-volume-inventory.yml`

For on-prem, that should become a neutral lab volume inventory with fields like:

- guest name
- device path or stable symlink
- capacity
- purpose
- optional performance hints

### Abstract the hypervisor inventory group

Current code references `aws_metal` directly in many playbooks and roles.

That should become a neutral group for:

- hypervisor playbooks
- host-local guest preparation
- maintenance flows

### Abstract the login/user assumption

The current on-prem branch now removes the runtime requirement for `ec2-user`
on the hypervisor by rendering a bastion-side inventory with explicit
on-prem host and user values.

Longer term, the remaining cleanup is mostly about making that host-user
contract more neutral and less `aws_metal`-named in the stock codebase.

## What Does Not Need To Be Redesigned

Assuming your on-prem host satisfies the same effective lab contract, these do
not need a conceptual redesign:

- support guest architecture
- bastion execution boundary
- OpenShift disconnected installation approach
- mirrored-content strategy
- auth architecture:
  - IdM
  - AD trust
  - Keycloak OIDC
  - AAP OIDC
- day-2 operator layout
- CPU tiering concept
- memory oversubscription concept

## Recommended On-Prem Adoption Strategy

### Phase 1: Host mimicry

Do not start by generalizing the codebase.

Start by proving that an on-prem host can mimic the current `virt-01` contract:

- same guest naming
- same `/dev/ebs/*` symlink layout
- same inventory group
- same bastion boundary

That gives the fastest proof of portability.

### Phase 2: Neutralize the substrate

Once you have proven the host-mimicry path, make the substrate neutral:

- move guest-disk inventory out of `cloudformation/`
- stop requiring AWS discovery in `playbooks/bootstrap/site.yml`
- rename `aws_metal` to a neutral hypervisor group
- move `ec2-user` assumptions behind explicit variables

### Phase 3: Publish a more neutral on-prem target

The repo now has an initial alternate target. The remaining work is to make it
less compatibility-driven and more neutral, with:

- on-prem prerequisites
- on-prem host-preparation workflow
- neutralized inventory and storage model

## Bottom Line

The bulk of Calabi was already portable once a `virt-01`-like host existed.
The current on-prem target proves that by replacing the outer AWS host and
storage acquisition steps while reusing the stock support-service, cluster, and
day-2 orchestration.

If you already have a freshly installed on-prem server with `m5.metal`-like
capacity and you prepare it to satisfy the current `virt-01` contract, most of
the Calabi playbooks should not need significant tinkering.

The hard part is not OpenShift or the support services. The hard part is
preserving the current host substrate contract without AWS.
