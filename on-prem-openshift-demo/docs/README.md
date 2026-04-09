# On-Prem Documentation

> [!WARNING]
> This on-prem target is experimental. Treat the docs and playbooks in this
> subtree as an emerging alternate installation path, not yet the same
> confidence level as the validated AWS-target flow.

Nearby docs:

<a href="./prerequisites.md"><kbd>&nbsp;&nbsp;PREREQUISITES&nbsp;&nbsp;</kbd></a>
<a href="./automation-flow.md"><kbd>&nbsp;&nbsp;AUTOMATION FLOW&nbsp;&nbsp;</kbd></a>
<a href="./manual-process.md"><kbd>&nbsp;&nbsp;MANUAL PROCESS&nbsp;&nbsp;</kbd></a>
<a href="./portability-and-gap-analysis.md"><kbd>&nbsp;&nbsp;PORTABILITY / GAPS&nbsp;&nbsp;</kbd></a>
<a href="./host-sizing-and-resource-policy.md"><kbd>&nbsp;&nbsp;HOST SIZING&nbsp;&nbsp;</kbd></a>
<a href="../../aws-metal-openshift-demo/docs/README.md"><kbd>&nbsp;&nbsp;AWS DOCS MAP&nbsp;&nbsp;</kbd></a>

Use this docs set when you are building Calabi on an on-prem `virt-01`-like
host instead of provisioning that host through AWS.

Your on-prem contract is intentionally narrow:

- you provide a RHEL hypervisor host
- you provide an LVM2 volume group for guest storage
- the on-prem subtree creates the guest logical volumes and publishes the same
  `/dev/ebs/*` compatibility paths the stock guest and cluster roles already
  expect
- once that host contract is satisfied, the existing support-service, cluster,
  and day-2 orchestration is reused

Use these notes only for what is materially different from the AWS path. Once
you have bootstrapped the on-prem host and crossed the bastion boundary, return
to the stock docs under
<a href="../../aws-metal-openshift-demo/docs/README.md"><kbd>AWS DOCS MAP</kbd></a>.

## Start Here

1. <a href="./prerequisites.md"><kbd>PREREQUISITES</kbd></a>
2. <a href="./automation-flow.md"><kbd>AUTOMATION FLOW</kbd></a>
3. <a href="./manual-process.md"><kbd>MANUAL PROCESS</kbd></a>
4. <a href="./host-sizing-and-resource-policy.md"><kbd>HOST SIZING</kbd></a>
5. <a href="./portability-and-gap-analysis.md"><kbd>PORTABILITY / GAPS</kbd></a>

## What Is Different On-Prem

- there is no AWS tenant or host stack
- there is no live AWS volume discovery
- the guest storage contract comes from the LVM volume group you provide
- you must validate CPU, RAM, NUMA, and storage headroom against the current
  guest footprint before bootstrap

## Where The Normal Docs Take Over Again

For your manual workflow, the on-prem divergence is concentrated in the early
host-preparation and storage-preparation steps. After that, hand back to the
stock runbook at:

- <a href="../../aws-metal-openshift-demo/docs/manual-process.md#12-build-the-bastion-vm"><kbd>AWS MANUAL PROCESS: STEP 12</kbd></a> for the bastion build onward
- <a href="../../aws-metal-openshift-demo/docs/manual-process.md#13a-optionally-build-ad-ds-and-ad-cs-from-bastion"><kbd>AWS MANUAL PROCESS: STEP 13A</kbd></a> once the bastion is built and the project is staged

For automation, the on-prem entrypoints are:

- <a href="../playbooks/site-bootstrap.yml"><kbd>on-prem `site-bootstrap.yml`</kbd></a>
- <a href="../playbooks/site-lab.yml"><kbd>on-prem `site-lab.yml`</kbd></a>
