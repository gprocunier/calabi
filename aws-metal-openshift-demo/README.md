# Calabi

Use the navigation buttons below to jump straight to the part you want.

<a href="./docs/prerequisites.md"><kbd>&nbsp;&nbsp;PREREQUISITES&nbsp;&nbsp;</kbd></a>
<a href="./docs/automation-flow.md"><kbd>&nbsp;&nbsp;AUTOMATION FLOW&nbsp;&nbsp;</kbd></a>
<a href="./docs/manual-process.md"><kbd>&nbsp;&nbsp;MANUAL PROCESS&nbsp;&nbsp;</kbd></a>
<a href="./docs/host-resource-management.md"><kbd>&nbsp;&nbsp;RESOURCE MANAGEMENT&nbsp;&nbsp;</kbd></a>
<a href="./docs/network-topology.md"><kbd>&nbsp;&nbsp;NETWORK TOPOLOGY&nbsp;&nbsp;</kbd></a>
<a href="./docs/orchestration-guide.md"><kbd>&nbsp;&nbsp;CODE GUIDE&nbsp;&nbsp;</kbd></a>
<a href="./docs/README.md"><kbd>&nbsp;&nbsp;DOCS MAP&nbsp;&nbsp;</kbd></a>

This is the working implementation of the lab: one AWS `m5.metal` RHEL host,
nested virtualization, support services, a full disconnected OpenShift build,
and the day-2 automation around it.

If you need the input checklist before a first build, start with
<a href="./docs/prerequisites.md"><kbd>PREREQUISITES</kbd></a>.

## What This Repo Is

- outer AWS IaaS scaffolding for `virt-01`
- host bootstrap for KVM, libvirt, OVS, firewalld, Cockpit, and PCP
- support guests:
  - `idm-01`
  - `bastion-01`
  - `mirror-registry`
- disconnected OpenShift install flow
- day-2 operator and platform configuration
- teardown and media-cleanup workflows

Build starts outside on the operator workstation, lands on `virt-01`, and then
shifts to bastion for the inside-facing lab and cluster work. The fuller run
order lives in <a href="./docs/automation-flow.md"><kbd>AUTOMATION FLOW</kbd></a>.

## Validated Baseline

Latest fully validated cluster baseline, confirmed before host performance
domains were introduced:

- OpenShift `4.20.15`
- `3` masters at `8 vCPU / 24 GiB`
- `3` infra nodes at `16 vCPU / 48 GiB`
- `3` workers at `4 vCPU / 16 GiB`

The repo now also contains the newer host performance-domain design for
`virt-01`. That work does not replace the baseline above; it builds on it by
adding more intentional CPU management under contention and by making a worker
uplift to `8 vCPU / 16 GiB` a reasonable next default. See
<a href="./docs/host-resource-management.md"><kbd>RESOURCE MANAGEMENT</kbd></a> for the
current CPU-management design, worker-uplift rationale, and rollout guidance.

## Where To Change Things

| If you need to change... | Start here |
| --- | --- |
| AWS substrate and EBS intent | `cloudformation/` and <a href="./docs/iaas-resource-model.md"><kbd>IAAS MODEL</kbd></a> |
| Hypervisor bootstrap | `playbooks/bootstrap/site.yml` and `roles/lab_*` |
| Support guests | `playbooks/bootstrap/*.yml`, `roles/idm*`, `roles/bastion*`, `roles/mirror_registry*` |
| Cluster VM shells | `playbooks/cluster/openshift-cluster.yml`, `roles/openshift_cluster/`, `vars/guests/openshift_cluster_vm.yml` |
| Host CPU and VM tiering | `vars/global/host_resource_management.yml`, `roles/lab_host_resource_management/`, <a href="./docs/host-resource-management.md"><kbd>RESOURCE MANAGEMENT</kbd></a> |
| Day-2 behavior | `playbooks/day2/`, `roles/openshift_post_install_*`, `vars/day2/` |
| Troubleshooting context | <a href="./docs/investigating.md"><kbd>INVESTIGATING</kbd></a> and <a href="./docs/issues.md"><kbd>ISSUES LEDGER</kbd></a> |
