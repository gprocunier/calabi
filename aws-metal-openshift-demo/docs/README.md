# Documentation Map

Use this page when you know the task you need to accomplish but not yet the
right Calabi document. The repository [README](../README.md) explains what the
project is; this page routes you into the correct workflow lane.

The docs below reflect the current validated posture:

- `./scripts/run_local_playbook.sh`
  <a href="../playbooks/site-bootstrap.yml"><kbd>playbooks/site-bootstrap.yml</kbd></a>
  has been re-proven from a zero-VM boundary
- the current cluster/day-2 path has converged on the live lab
- the supported auth baseline is:
  - OpenShift: `HTPasswd` breakglass plus Keycloak OIDC
  - AAP: Keycloak OIDC, not direct LDAP
- AD-backed user login has been validated through:
  - Keycloak into OpenShift
  - Keycloak into AAP

The remaining certification bar is still one uninterrupted fresh
`./scripts/run_remote_bastion_playbook.sh`
<a href="../playbooks/site-lab.yml"><kbd>playbooks/site-lab.yml</kbd></a> run
on the current codebase without live repair during that attempt.

## Choose Your Path

| If you need to... | Start here | Then read |
| --- | --- | --- |
| build or rebuild the lab (`Golden Path`) | [Prerequisites](./prerequisites.md) | [Automation Flow](./automation-flow.md), [Orchestration Plumbing](./orchestration-plumbing.md) |
| learn how the automation works under the hood (`Teaching Reference`) | [Manual Process](./manual-process.md) | [Automation Flow](./automation-flow.md), [Authentication Model](./authentication-model.md) |
| understand the supported auth and policy model | [Authentication Model](./authentication-model.md) | [AD / IdM Policy Model](./ad-idm-policy-model.md) (`Teaching Reference`) |
| understand the underlying design (`Teaching Reference`) | [Network Topology](./network-topology.md) | [Host Resource Management](./host-resource-management.md), [AWS IaaS Resource Model](./iaas-resource-model.md), [OpenShift Cluster Matrix](./openshift-cluster-matrix.md), [ODF Declarative Plan](./odf-declarative-plan.md) |
| troubleshoot or resume work | [Investigating](./investigating.md) | [Issues Ledger](./issues.md), [Secrets And Sanitization](./secrets-and-sanitization.md) |
| change the code (`Teaching Reference`) | [Orchestration Guide](./orchestration-guide.md) | `./scripts/run_local_playbook.sh` <a href="../playbooks/site-bootstrap.yml"><kbd>playbooks/site-bootstrap.yml</kbd></a>, `./scripts/run_remote_bastion_playbook.sh` <a href="../playbooks/site-lab.yml"><kbd>playbooks/site-lab.yml</kbd></a> |
| run the on-prem external-Ceph path | [On-Prem Docs](../../on-prem-openshift-demo/docs/README.md) | [On-Prem Override Mechanism](../../on-prem-openshift-demo/docs/override-mechanism.md), [Automation Flow](./automation-flow.md) |

## AWS Golden Path Reading Order

1. <a href="../README.md"><kbd>TOP README</kbd></a>
2. <a href="./prerequisites.md"><kbd>PREREQUISITES</kbd></a>
3. <a href="./automation-flow.md"><kbd>AUTOMATION FLOW</kbd></a>
4. <a href="./orchestration-plumbing.md"><kbd>ORCHESTRATION PLUMBING</kbd></a>
5. <a href="./authentication-model.md"><kbd>AUTH MODEL</kbd></a>
6. <a href="./investigating.md"><kbd>INVESTIGATING</kbd></a> when recovery or drift enters the picture

## Maintainer Reading Order

1. <a href="../README.md"><kbd>TOP README</kbd></a>
2. <a href="./README.md"><kbd>DOCS MAP</kbd></a>
3. <a href="./authentication-model.md"><kbd>AUTH MODEL</kbd></a>
4. <a href="./ad-idm-policy-model.md"><kbd>AD / IDM POLICY MODEL</kbd></a>
5. <a href="./network-topology.md"><kbd>NETWORK TOPOLOGY</kbd></a>
6. <a href="./host-resource-management.md"><kbd>RESOURCE MANAGEMENT</kbd></a>
7. <a href="./orchestration-guide.md"><kbd>ORCHESTRATION GUIDE</kbd></a>
8. <a href="./manual-process.md"><kbd>MANUAL PROCESS</kbd></a> as the teaching reference for the automated flow

## Experimental Paths

If you are not provisioning `virt-01` through AWS and already have an on-prem
host that can satisfy the Calabi hypervisor contract, you can try the
experimental on-prem entry path for the divergent early steps.

> [!WARNING]
> Unvalidated. This path is provided for developers who want to try the on-prem
> entry flow. It is not the supported deployment path.

<a href="../../on-prem-openshift-demo/docs/README.md"><kbd>&nbsp;&nbsp;ON-PREM DOCS&nbsp;&nbsp;</kbd></a>

Those pages cover:

- the on-prem host contract
- LVM-backed guest volume provisioning
- the on-prem bastion staging wrapper
- override-driven profile selection, including the external-Ceph day-2 profile

They then hand you back to this main docs set once the bastion is built and the
normal Calabi sequencing resumes.

## Directory Intent

| Path | Purpose |
| --- | --- |
| `cloudformation/` | outer AWS tenant and host scaffolding |
| `docs/` | operator, design, and maintainer documentation |
| `playbooks/bootstrap/` | hypervisor and support-guest bring-up |
| `playbooks/lab/` | bastion-side support services for the disconnected lab |
| `playbooks/cluster/` | installer tooling, agent media, cluster VM shells, install wait |
| `playbooks/day2/` | post-install operator and platform configuration |
| `playbooks/maintenance/` | cleanup, suspend, install-media normalization |
| `roles/` | implementation details behind the playbooks |
| `vars/global/` | cross-cutting defaults and environment-wide intent |
| `vars/guests/` | support-guest and cluster-shell sizing and policy |
| `vars/cluster/` | cluster identity and installer-specific inputs |
| `vars/day2/` | day-2 feature toggles and defaults |
| `scripts/` | operator helper scripts for bastion staging and monitoring |
