# Documentation Map

Start with the navigation buttons below. They are the quickest way to get to
the part of the project you actually need.

<a href="./prerequisites.md"><kbd>&nbsp;&nbsp;PREREQUISITES&nbsp;&nbsp;</kbd></a>
<a href="./redhat-developer-subscription.md"><kbd>&nbsp;&nbsp;DEVELOPER SUBSCRIPTION&nbsp;&nbsp;</kbd></a>
<a href="./automation-flow.md"><kbd>&nbsp;&nbsp;BUILD / REBUILD&nbsp;&nbsp;</kbd></a>
<a href="./manual-process.md"><kbd>&nbsp;&nbsp;MANUAL FLOW&nbsp;&nbsp;</kbd></a>
<a href="./iaas-resource-model.md"><kbd>&nbsp;&nbsp;IAAS MODEL&nbsp;&nbsp;</kbd></a>
<a href="./host-resource-management.md"><kbd>&nbsp;&nbsp;RESOURCE DESIGN&nbsp;&nbsp;</kbd></a>
<a href="./host-memory-oversubscription.md"><kbd>&nbsp;&nbsp;HOST MEMORY&nbsp;&nbsp;</kbd></a>
<a href="./network-topology.md"><kbd>&nbsp;&nbsp;NETWORK DESIGN&nbsp;&nbsp;</kbd></a>
<a href="./openshift-cluster-matrix.md"><kbd>&nbsp;&nbsp;CLUSTER MATRIX&nbsp;&nbsp;</kbd></a>
<a href="./orchestration-guide.md"><kbd>&nbsp;&nbsp;CODE GUIDE&nbsp;&nbsp;</kbd></a>
<a href="./investigating.md"><kbd>&nbsp;&nbsp;INVESTIGATING&nbsp;&nbsp;</kbd></a>
<a href="./issues.md"><kbd>&nbsp;&nbsp;ISSUES LEDGER&nbsp;&nbsp;</kbd></a>
<a href="./secrets-and-sanitization.md"><kbd>&nbsp;&nbsp;SECRETS&nbsp;&nbsp;</kbd></a>

The root `README.md` explains what the project is. This page answers:

- where do I start for my specific task?
- which docs explain design versus operation versus implementation?
- where in the codebase do those documents point?

## Choose Your Path

### I Want To Build Or Rebuild The Lab

<a href="./prerequisites.md"><kbd>&nbsp;&nbsp;PREREQUISITES&nbsp;&nbsp;</kbd></a>
<a href="./redhat-developer-subscription.md"><kbd>&nbsp;&nbsp;DEVELOPER SUBSCRIPTION&nbsp;&nbsp;</kbd></a>
<a href="./automation-flow.md"><kbd>&nbsp;&nbsp;AUTOMATION FLOW&nbsp;&nbsp;</kbd></a>
<a href="./manual-process.md"><kbd>&nbsp;&nbsp;MANUAL PROCESS&nbsp;&nbsp;</kbd></a>
<a href="./iaas-resource-model.md"><kbd>&nbsp;&nbsp;AWS IAAS MODEL&nbsp;&nbsp;</kbd></a>

Pick these when you need:

- the input checklist before the first build
- Red Hat Developer Subscription setup for content access
- the operator run order
- the manual analog of the automation
- the outer AWS substrate model

### I Want To Understand The Design

<a href="./network-topology.md"><kbd>&nbsp;&nbsp;NETWORK TOPOLOGY&nbsp;&nbsp;</kbd></a>
<a href="./host-resource-management.md"><kbd>&nbsp;&nbsp;RESOURCE MANAGEMENT&nbsp;&nbsp;</kbd></a>
<a href="./openshift-cluster-matrix.md"><kbd>&nbsp;&nbsp;CLUSTER MATRIX&nbsp;&nbsp;</kbd></a>
<a href="./odf-declarative-plan.md"><kbd>&nbsp;&nbsp;ODF PLAN&nbsp;&nbsp;</kbd></a>

Pick these when you need:

- VLAN and routing intent
- CPU pools, Gold/Silver/Bronze domains, and host sizing guidance
- node identities, MACs, and install matrix data
- storage deployment intent

### I Want To Troubleshoot Or Resume Work

<a href="./investigating.md"><kbd>&nbsp;&nbsp;INVESTIGATING&nbsp;&nbsp;</kbd></a>
<a href="./issues.md"><kbd>&nbsp;&nbsp;ISSUES LEDGER&nbsp;&nbsp;</kbd></a>
<a href="./manual-process.md"><kbd>&nbsp;&nbsp;MANUAL PROCESS&nbsp;&nbsp;</kbd></a>
<a href="./secrets-and-sanitization.md"><kbd>&nbsp;&nbsp;SECRETS AND SANITIZATION&nbsp;&nbsp;</kbd></a>

Pick these when you need:

- live investigation checkpoints that are not finished yet
- already-fixed problems with commit references
- the manual equivalent of what automation is supposed to do
- the current secret-handling and Git hygiene model

### I Want To Change The Code

<a href="./orchestration-guide.md"><kbd>&nbsp;&nbsp;ORCHESTRATION GUIDE&nbsp;&nbsp;</kbd></a>
<a href="../playbooks/site-bootstrap.yml"><kbd>&nbsp;&nbsp;SITE-BOOTSTRAP&nbsp;&nbsp;</kbd></a>
<a href="../playbooks/site-lab.yml"><kbd>&nbsp;&nbsp;SITE-LAB&nbsp;&nbsp;</kbd></a>

Pick these when you need:

- playbook and role boundaries
- execution context
- where a given workflow lives in the repo

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
4. <a href="./host-resource-management.md"><kbd>RESOURCE MANAGEMENT</kbd></a>
5. <a href="./network-topology.md"><kbd>NETWORK TOPOLOGY</kbd></a>
6. <a href="./orchestration-guide.md"><kbd>ORCHESTRATION GUIDE</kbd></a>
7. <a href="./manual-process.md"><kbd>MANUAL PROCESS</kbd></a>

## Recommended Reading Order For Operators

1. <a href="../README.md"><kbd>TOP README</kbd></a>
2. <a href="./prerequisites.md"><kbd>PREREQUISITES</kbd></a>
3. <a href="./automation-flow.md"><kbd>AUTOMATION FLOW</kbd></a>
4. <a href="./manual-process.md"><kbd>MANUAL PROCESS</kbd></a>
5. <a href="./investigating.md"><kbd>INVESTIGATING</kbd></a> when things drift from the happy path
