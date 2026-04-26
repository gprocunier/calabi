# On-Prem Documentation

> [!WARNING]
> This on-prem target is experimental. Treat the docs and playbooks in this
> subtree as an emerging alternate installation path, not yet the same
> confidence level as the validated AWS-target flow.

Use these pages when you are building Calabi on an on-prem `virt-01`-like
host.

What you provide:

- you provide a RHEL hypervisor host
- you provide an LVM2 volume group for guest storage
- the on-prem subtree creates the guest logical volumes and publishes the same
  `/dev/ebs/*` compatibility paths the stock guest and cluster roles already
  expect
- you define both:
  - how the operator workstation reaches the hypervisor
  - how bastion reaches that same hypervisor on the lab network
- once that host contract is satisfied, the stock support-service, cluster, and
  day-2 orchestration is reused

These pages only cover the on-prem differences. After host bootstrap and
bastion staging, return to
<a href="../../aws-metal-openshift-demo/docs/README.md"><kbd>AWS DOCS MAP</kbd></a>.

## Start Here

| If you need to... | Start here | Then read |
| --- | --- | --- |
| verify the host contract | [Prerequisites](./prerequisites.md) | [Host Sizing And Resource Policy](./host-sizing-and-resource-policy.md) |
| run the alternate automation path | [Automation Flow](./automation-flow.md) | `./scripts/run_local_playbook.sh` <a href="../playbooks/site-bootstrap.yml"><kbd>playbooks/site-bootstrap.yml</kbd></a>, `./scripts/run_remote_bastion_playbook.sh` <a href="../playbooks/site-lab.yml"><kbd>playbooks/site-lab.yml</kbd></a> |
| choose or edit an override profile | [Override Mechanism](./override-mechanism.md) | [`inventory/overrides/`](../inventory/overrides/), [Automation Flow](./automation-flow.md) |
| run only the pre-cluster support path on a smaller host | [Prerequisites](./prerequisites.md) | [`inventory/overrides/precluster-64g.yml.example`](../inventory/overrides/precluster-64g.yml.example), `./scripts/run_remote_bastion_playbook.sh` <a href="../playbooks/site-precluster.yml"><kbd>playbooks/site-precluster.yml</kbd></a> |
| run the current 3-control-plane / 3-worker external Ceph profile | [Automation Flow](./automation-flow.md) | [`inventory/overrides/core-services-ad-plus-openshift-3node-external-ceph.yml.example`](../inventory/overrides/core-services-ad-plus-openshift-3node-external-ceph.yml.example), <a href="../../aws-metal-openshift-demo/docs/automation-flow.md"><kbd>AWS AUTOMATION FLOW</kbd></a> |
| run the current ~128 GiB host profile with AD and managed zram writeback | [Host Sizing And Resource Policy](./host-sizing-and-resource-policy.md) | [`inventory/overrides/core-services-ad-128g.yml.example`](../inventory/overrides/core-services-ad-128g.yml.example), [Manual Process](./manual-process.md) |
| compare automation with the manual path | [Manual Process](./manual-process.md) | [Portability And Gap Analysis](./portability-and-gap-analysis.md) |
| return to the main validated flow | [AWS Docs Map](../../aws-metal-openshift-demo/docs/README.md) | [AWS Manual Process Step 12](../../aws-metal-openshift-demo/docs/manual-process.md#12-build-the-bastion-vm) |

## What Is Different On-Prem

- there is no AWS tenant or host stack
- there is no live AWS volume discovery
- the guest storage contract comes from the LVM volume group you provide
- you must validate CPU, RAM, NUMA, and storage headroom against the current
  guest footprint before bootstrap

## Where The Normal Docs Take Over Again

For the manual path, the on-prem-specific work ends once the host is prepared,
guest storage exists, and bastion staging is complete. Then continue in the
stock runbook at:

- <a href="../../aws-metal-openshift-demo/docs/manual-process.md#12-build-the-bastion-vm"><kbd>AWS MANUAL PROCESS: STEP 12</kbd></a> if you want the bastion build onward
- <a href="../../aws-metal-openshift-demo/docs/manual-process.md#13a-optionally-build-ad-ds-and-ad-cs-from-bastion"><kbd>AWS MANUAL PROCESS: STEP 13A</kbd></a> once the bastion is built and the project is staged

For automation, the on-prem operator entrypoints are:

- `./scripts/run_local_playbook.sh`
  <a href="../playbooks/site-bootstrap.yml"><kbd>playbooks/site-bootstrap.yml</kbd></a>
- `./scripts/run_remote_bastion_playbook.sh`
  <a href="../playbooks/site-precluster.yml"><kbd>playbooks/site-precluster.yml</kbd></a>
- `./scripts/run_remote_bastion_playbook.sh`
  <a href="../playbooks/site-lab.yml"><kbd>playbooks/site-lab.yml</kbd></a>

The current cluster-capable external Ceph example override embeds the external
cluster-details payload inline as base64, so it is portable across workstation
to bastion handoff and does not depend on an operator-local cluster-details
file path at runtime.

For the detailed override contract, including `enable_*` versus `force_*`
phase toggles, external ODF inputs, effective storage classes, resource sizing,
and mirror-registry parallelism, read:

- <a href="./override-mechanism.md"><kbd>OVERRIDE MECHANISM</kbd></a>

## Primary Pages In This Branch

- [Prerequisites](./prerequisites.md)
- [Automation Flow](./automation-flow.md)
- [Override Mechanism](./override-mechanism.md)
- [Manual Process](./manual-process.md)
- [Host Sizing And Resource Policy](./host-sizing-and-resource-policy.md)
- [Portability And Gap Analysis](./portability-and-gap-analysis.md)
