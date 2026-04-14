# Documentation Map

Use this page when you know the task you need to accomplish but not yet the
right Calabi document. The repository [README](../README.md) explains what the
project is; this page routes you into the correct workflow lane.

This page answers:

- where do I start for my specific task?
- which docs explain design versus operation versus implementation?
- where in the codebase do those documents point?

## Current Validated Baseline

The docs below now reflect the current validated posture:

- `playbooks/site-bootstrap.yml` has been re-proven from a zero-VM boundary
- the current cluster/day-2 path has converged on the live lab
- the supported auth baseline is:
  - OpenShift: `HTPasswd` breakglass plus Keycloak OIDC
  - AAP: Keycloak OIDC, not direct LDAP
- AD-backed user login has been validated through:
  - Keycloak into OpenShift
  - Keycloak into AAP

The remaining certification bar is still one uninterrupted fresh
`playbooks/site-lab.yml` run on the current codebase without live repair during
that attempt.

## Experimental Alternate Target

If you are not provisioning `virt-01` through AWS and already have an on-prem
host that can satisfy the Calabi hypervisor contract, use the experimental
on-prem entry path for the divergent early steps:

<a href="../../on-prem-openshift-demo/docs/README.md"><kbd>&nbsp;&nbsp;ON-PREM DOCS&nbsp;&nbsp;</kbd></a>

Those pages cover:

- the on-prem host contract
- LVM-backed guest volume provisioning
- the on-prem bastion staging wrapper

They then hand you back to this main docs set once the bastion is built and the
normal Calabi sequencing resumes.

## Choose Your Path

| If you need to... | Start here | Then read |
| --- | --- | --- |
| build or rebuild the lab | [Prerequisites](./prerequisites.md) | [Automation Flow](./automation-flow.md), [Orchestration Plumbing](./orchestration-plumbing.md), [Manual Process](./manual-process.md) |
| understand the supported auth and policy model | [Authentication Model](./authentication-model.md) | [AD / IdM Policy Model](./ad-idm-policy-model.md) |
| understand the underlying design | [Network Topology](./network-topology.md) | [Host Resource Management](./host-resource-management.md), [AWS IaaS Resource Model](./iaas-resource-model.md), [OpenShift Cluster Matrix](./openshift-cluster-matrix.md), [ODF Declarative Plan](./odf-declarative-plan.md) |
| troubleshoot or resume work | [Investigating](./investigating.md) | [Issues Ledger](./issues.md), [Manual Process](./manual-process.md), [Secrets And Sanitization](./secrets-and-sanitization.md) |
| change the code | [Orchestration Guide](./orchestration-guide.md) | [`playbooks/site-bootstrap.yml`](../playbooks/site-bootstrap.yml), [`playbooks/site-lab.yml`](../playbooks/site-lab.yml) |

### Build And Rebuild

Use these when you need:

- the input checklist before the first build
- Red Hat Developer Subscription setup for content access
- the operator run order
- the internal execution and runner-state model
- the current supported authentication and authorization architecture
- the future AD-to-IdM authorization model
- the manual analog of the automation
- the outer AWS substrate model

Primary pages:

- [Prerequisites](./prerequisites.md)
- [Red Hat Developer Subscription](./redhat-developer-subscription.md)
- [Automation Flow](./automation-flow.md)
- [Orchestration Plumbing](./orchestration-plumbing.md)
- [Authentication Model](./authentication-model.md)
- [AD / IdM Policy Model](./ad-idm-policy-model.md)
- [Manual Process](./manual-process.md)
- [AWS IaaS Resource Model](./iaas-resource-model.md)

### Architecture And Policy

Use these when you need:

- VLAN and routing intent
- CPU pools, Gold/Silver/Bronze domains, and host sizing guidance
- node identities, MACs, and install matrix data
- storage deployment intent

Primary pages:

- [Network Topology](./network-topology.md)
- [Host Resource Management](./host-resource-management.md)
- [OpenShift Cluster Matrix](./openshift-cluster-matrix.md)
- [ODF Declarative Plan](./odf-declarative-plan.md)

### Operate And Recover

Use these when you need:

- live investigation checkpoints that are not finished yet
- already-fixed problems with commit references
- the manual equivalent of what automation is supposed to do
- the current secret-handling and Git hygiene model

Primary pages:

- [Investigating](./investigating.md)
- [Issues Ledger](./issues.md)
- [Manual Process](./manual-process.md)
- [Secrets And Sanitization](./secrets-and-sanitization.md)

### Change The Code

Use these when you need:

- playbook and role boundaries
- execution context
- where a given workflow lives in the repo

Primary pages:

- [Orchestration Guide](./orchestration-guide.md)
- [`playbooks/site-bootstrap.yml`](../playbooks/site-bootstrap.yml)
- [`playbooks/site-lab.yml`](../playbooks/site-lab.yml)

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

## Recommended Reading Order For New Maintainers

1. <a href="../README.md"><kbd>TOP README</kbd></a>
2. <a href="./prerequisites.md"><kbd>PREREQUISITES</kbd></a>
3. <a href="./automation-flow.md"><kbd>AUTOMATION FLOW</kbd></a>
4. <a href="./orchestration-plumbing.md"><kbd>ORCHESTRATION PLUMBING</kbd></a>
5. <a href="./authentication-model.md"><kbd>AUTH MODEL</kbd></a>
6. <a href="./ad-idm-policy-model.md"><kbd>AD / IDM POLICY MODEL</kbd></a>
7. <a href="./host-resource-management.md"><kbd>RESOURCE MANAGEMENT</kbd></a>
8. <a href="./network-topology.md"><kbd>NETWORK TOPOLOGY</kbd></a>
9. <a href="./orchestration-guide.md"><kbd>ORCHESTRATION GUIDE</kbd></a>
10. <a href="./manual-process.md"><kbd>MANUAL PROCESS</kbd></a>

## Recommended Reading Order For Operators

1. <a href="../README.md"><kbd>TOP README</kbd></a>
2. <a href="./prerequisites.md"><kbd>PREREQUISITES</kbd></a>
3. <a href="./automation-flow.md"><kbd>AUTOMATION FLOW</kbd></a>
4. <a href="./orchestration-plumbing.md"><kbd>ORCHESTRATION PLUMBING</kbd></a>
5. <a href="./authentication-model.md"><kbd>AUTH MODEL</kbd></a>
6. <a href="./manual-process.md"><kbd>MANUAL PROCESS</kbd></a>
7. <a href="./ad-idm-policy-model.md"><kbd>AD / IDM POLICY MODEL</kbd></a> for the planned future authorization model
8. <a href="./investigating.md"><kbd>INVESTIGATING</kbd></a> when things drift from the happy path
