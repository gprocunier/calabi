# Portability And Gap Analysis

## Executive Summary

Calabi is already close to an on-prem design.

The AWS-specific part is mostly the substrate that creates `virt-01` and its
attached guest block devices. Once the host exists and presents the expected
network, storage, and execution contract, the rest of the lab largely behaves
like a host-local KVM/libvirt/Open vSwitch environment.

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

An on-prem server can reuse most of the current orchestration only if it
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

You need an alternate answer for:

- how `virt-01` is installed
- how the operator reaches it
- how guest disks are attached
- how those disks are named consistently

### 2. Hypervisor identity

The code still uses the inventory group name `aws_metal` almost everywhere.

That does **not** mean the lab is deeply AWS-only. In practice it means:

- playbooks target one hypervisor host through the `aws_metal` group
- some tasks derive the hypervisor host via `groups['aws_metal']`

Minimal on-prem path:

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

On-prem, you need an equivalent deterministic disk contract, even if the
backing devices are:

- local NVMe
- RAID LUNs
- SAN-backed block devices
- local SSDs presented by HBA order

## Minimal Viable On-Prem Bring-Up

If the goal is “make Calabi run on an on-prem box with as little code change as
possible,” the lowest-risk path is:

1. Install a RHEL host manually so it becomes the on-prem equivalent of
   `virt-01`.
2. Attach all required guest disks ahead of time.
3. Create deterministic symlinks that match the current `/dev/ebs/*` contract,
   even if the backing disks are not AWS EBS.
4. Keep the inventory host in the `aws_metal` group initially.
5. Override `ansible_user` if the host does not use `ec2-user`.
6. Skip the AWS host-acquisition layer and run only the host/bootstrap and lab
   orchestration from the point where the host contract is satisfied.

In that model, most of the current playbooks should work with little or no
orchestration change.

## What Would Need To Change For A First-Class On-Prem Target

If the goal is a real alternate installation target rather than “prepare the
host to look like current `virt-01`,” the code should eventually change in
these places:

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

Current host defaults and helper scripts still assume `ec2-user` in places.

For an on-prem target, the host-user contract should be explicit:

- inventory-controlled SSH user
- docs that no longer assume AWS image defaults

## What Does Not Need To Be Redesigned

Assuming the on-prem host satisfies the same effective lab contract, these do
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

Once the host-mimicry path is proven, make the substrate neutral:

- move guest-disk inventory out of `cloudformation/`
- stop requiring AWS discovery in `playbooks/bootstrap/site.yml`
- rename `aws_metal` to a neutral hypervisor group
- move `ec2-user` assumptions behind explicit variables

### Phase 3: Publish a first-class on-prem target

Only after the first two phases should the repo grow an actual alternate
installation target with:

- on-prem prerequisites
- on-prem host-preparation workflow
- neutralized inventory and storage model

## Bottom Line

Your instinct is mostly correct.

If you already have a freshly installed on-prem server with `m5.metal`-like
capacity and you prepare it to satisfy the current `virt-01` contract, most of
the Calabi playbooks should not need significant tinkering.

The hard part is not OpenShift or the support services.
The hard part is preserving the current host substrate contract without AWS.
