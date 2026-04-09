# On-Prem Automation Flow

> [!WARNING]
> This on-prem target is experimental. Treat the docs and playbooks in this
> subtree as an emerging alternate installation path, not yet the same
> confidence level as the validated AWS-target flow.

Nearby docs:

<a href="./prerequisites.md"><kbd>&nbsp;&nbsp;PREREQUISITES&nbsp;&nbsp;</kbd></a>
<a href="./manual-process.md"><kbd>&nbsp;&nbsp;MANUAL PROCESS&nbsp;&nbsp;</kbd></a>
<a href="./host-sizing-and-resource-policy.md"><kbd>&nbsp;&nbsp;HOST SIZING&nbsp;&nbsp;</kbd></a>
<a href="./portability-and-gap-analysis.md"><kbd>&nbsp;&nbsp;PORTABILITY / GAPS&nbsp;&nbsp;</kbd></a>
<a href="../../aws-metal-openshift-demo/docs/automation-flow.md"><kbd>&nbsp;&nbsp;AWS AUTOMATION FLOW&nbsp;&nbsp;</kbd></a>
<a href="./README.md"><kbd>&nbsp;&nbsp;ON-PREM DOCS MAP&nbsp;&nbsp;</kbd></a>

Use this page for the build order that is specific to the on-prem target.

Once you have prepared the host, provisioned the guest logical volumes, built
the bastion, and staged the project, return to the stock
<a href="../../aws-metal-openshift-demo/docs/automation-flow.md"><kbd>AWS AUTOMATION FLOW</kbd></a>
for the remaining support-service, cluster, and day-2 sequencing.

## Operator Model

Your execution model on-prem has three contexts:

- operator workstation
- on-prem `virt-01`-like hypervisor
- bastion-native execution from `bastion-01`

The on-prem target changes only the early phases:

- there is no AWS tenant or host-stack provisioning
- you start from a preinstalled host
- you provide an LVM volume group instead of AWS-attached guest EBS volumes

After the bastion is built and staged, the normal Calabi sequencing resumes.

## Phase Summary

- Phase 1, operator preflight:
  - validate secrets, content inputs, and local tooling
- Phase 2, on-prem host contract:
  - verify the host can act as `virt-01`
  - verify CPU / RAM / storage sizing
  - verify the LVM volume group exists and has enough free space
- Phase 3, on-prem bootstrap:
  - prepare the host
  - apply host CPU and memory policy
  - configure OVS, libvirt, and firewalling
  - create guest logical volumes
  - publish `/dev/ebs/*` compatibility symlinks
- Phase 4, bastion bootstrap:
  - build `bastion-01`
  - stage the on-prem and stock project trees onto bastion
- Phase 5, resume stock Calabi flow:
  - optional AD
  - IdM
  - bastion join
  - mirror registry
  - OpenShift cluster build
  - day-2

## Recommended Run Order

### Where each step runs

| Steps | Where | What happens |
| --- | --- | --- |
| 1-4 | Operator workstation / on-prem `virt-01` | preflight, host validation, VG validation, host bootstrap |
| 5 | Operator workstation | bastion build and staging |
| 6+ | `bastion-01` | resume the stock support-service, cluster, and day-2 flow |

> [!IMPORTANT]
> **Pick a side and stay on it.** The on-prem target still uses the normal
> workstation-to-bastion boundary. Do the early host-facing work from the
> operator workstation, then stay on bastion once you cross that boundary.

### Command shorthand

- `RUN LOCALLY` — from the operator workstation at `on-prem-openshift-demo`
- `RUN ON HYPERVISOR` — on the on-prem `virt-01`-like host only when the step
  explicitly says so
- `RUN ON BASTION` — from `bastion-01` after staging has completed

1. Validate the local inputs and the on-prem inventory.
   - `RUN LOCALLY`
     ```bash
     ansible-playbook --syntax-check playbooks/site-bootstrap.yml
     ansible-playbook --syntax-check playbooks/site-lab.yml
     ```
1. Verify the on-prem host contract.
   - check SSH reachability
   - check `virt-host-validate`
   - check storage visibility and the intended volume group
   - `RUN LOCALLY`
     ```bash
     ssh <hypervisor-admin-user>@<hypervisor-management-ip> \
       'hostnamectl --static && sudo virt-host-validate && sudo vgs'
     ```
1. Review sizing before bootstrap if the host is not `m5.metal`-like.
   - `RUN LOCALLY`
     - read <a href="./host-sizing-and-resource-policy.md"><kbd>HOST SIZING</kbd></a>
1. Bootstrap the on-prem host and provision guest LVs.
   - `RUN LOCALLY`
     ```bash
     ansible-playbook playbooks/bootstrap/site.yml
     ```
1. Build the bastion and stage the project.
   - `RUN LOCALLY`
     ```bash
     ansible-playbook playbooks/site-bootstrap.yml
     ```
1. Resume the stock lab flow.
   - `RUN ON BASTION`
     ```bash
     ansible-playbook -i inventory/hosts.yml playbooks/site-lab.yml
     ```
   - from this point, use the stock flow reference:
     - <a href="../../aws-metal-openshift-demo/docs/automation-flow.md#recommended-run-order"><kbd>AWS AUTOMATION FLOW: RECOMMENDED RUN ORDER</kbd></a>

## Handoff Point

After `playbooks/site-bootstrap.yml` finishes successfully in the on-prem
subtree:

- the host has been prepared
- guest LVs exist
- `/dev/ebs/*` compatibility paths exist
- the bastion has been built
- the on-prem and stock project trees have been staged

At that point, your next reference pages should usually be:

- <a href="../../aws-metal-openshift-demo/docs/automation-flow.md"><kbd>AWS AUTOMATION FLOW</kbd></a>
- <a href="../../aws-metal-openshift-demo/docs/manual-process.md#13a-optionally-build-ad-ds-and-ad-cs-from-bastion"><kbd>AWS MANUAL PROCESS: STEP 13A</kbd></a>
