# On-Prem Automation Flow

> [!WARNING]
> This on-prem target is experimental. Treat the docs and playbooks in this
> subtree as an emerging alternate installation path, not yet the same
> confidence level as the validated AWS-target flow.

Nearby docs:

<a href="./prerequisites.md"><kbd>&nbsp;&nbsp;PREREQUISITES&nbsp;&nbsp;</kbd></a>
<a href="./manual-process.md"><kbd>&nbsp;&nbsp;MANUAL PROCESS&nbsp;&nbsp;</kbd></a>
<a href="./override-mechanism.md"><kbd>&nbsp;&nbsp;OVERRIDES&nbsp;&nbsp;</kbd></a>
<a href="./host-sizing-and-resource-policy.md"><kbd>&nbsp;&nbsp;HOST SIZING&nbsp;&nbsp;</kbd></a>
<a href="./portability-and-gap-analysis.md"><kbd>&nbsp;&nbsp;PORTABILITY / GAPS&nbsp;&nbsp;</kbd></a>
<a href="../../aws-metal-openshift-demo/docs/automation-flow.md"><kbd>&nbsp;&nbsp;AWS AUTOMATION FLOW&nbsp;&nbsp;</kbd></a>
<a href="./README.md"><kbd>&nbsp;&nbsp;ON-PREM DOCS MAP&nbsp;&nbsp;</kbd></a>

This page covers the on-prem-only build order. After host bootstrap and
bastion staging, return to the stock
<a href="../../aws-metal-openshift-demo/docs/automation-flow.md"><kbd>AWS AUTOMATION FLOW</kbd></a>
for the remaining support-service, cluster, and day-2 sequencing.

## Execution Contexts

You will work in three places:

- operator workstation
- on-prem `virt-01`-like hypervisor
- bastion-native execution from `bastion-01`

Only the early phases differ from the AWS path:

- there is no AWS tenant or host-stack provisioning
- you start from a preinstalled host
- you provide an LVM volume group instead of AWS-attached guest EBS volumes

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
  - preserve a bastion-to-hypervisor handoff, but with explicit on-prem
    runtime host and user settings instead of the stock `ec2-user` assumption
- Phase 4, bastion bootstrap:
  - build `bastion-01`
  - stage the on-prem project tree onto bastion
  - then stage the stock AWS-target project tree through the local on-prem
    bastion-stage wrapper
- Phase 5, resume stock Calabi flow:
  - optional AD
  - IdM
  - bastion join
  - mirror registry
  - OpenShift cluster build
  - day-2

For hosts that should stop before cluster bring-up:

- support-services-only profiles such as:
  - <a href="../inventory/overrides/core-services.yml.example"><kbd>core-services.yml.example</kbd></a>
  - <a href="../inventory/overrides/core-services-ad.yml.example"><kbd>core-services-ad.yml.example</kbd></a>
- the reduced pre-cluster profile:
  - <a href="../inventory/overrides/precluster-64g.yml.example"><kbd>precluster-64g.yml.example</kbd></a>
- run `./scripts/run_local_playbook.sh`
  <a href="../playbooks/site-bootstrap.yml"><kbd>playbooks/site-bootstrap.yml</kbd></a>
  from the operator workstation
- then run
  <a href="../playbooks/site-precluster.yml"><kbd>playbooks/site-precluster.yml</kbd></a>
  from the staged on-prem tree on bastion or through the workstation wrapper

## Recommended Run Order

### Where each step runs

| Steps | Where | What happens |
| --- | --- | --- |
| 1-4 | Operator workstation / on-prem `virt-01` | preflight, host validation, VG validation, host bootstrap |
| 5 | Operator workstation | bastion build and staging |
| 6+ | `bastion-01` | resume the stock support-service, cluster, and day-2 flow |

> [!IMPORTANT]
> Keep the normal workstation-to-bastion boundary. Do the early host-facing
> work from the operator workstation, then stay on bastion once you cross that
> boundary.

### Command shorthand

- `RUN LOCALLY` — from the operator workstation at `on-prem-openshift-demo`
- `RUN ON HYPERVISOR` — on the on-prem `virt-01`-like host only when the step
  explicitly says so
- `RUN ON BASTION` — from `bastion-01` after staging has completed
- `./scripts/run_local_playbook.sh` — runs a workstation-side play with tracked
  PID/log/RC state under `~/.local/state/calabi-playbooks-onprem/`
- `./scripts/run_bastion_playbook.sh` — runs a bastion-side play with tracked
  PID/log/RC state under `/var/tmp/bastion-playbooks-onprem/`
- `./scripts/run_remote_bastion_playbook.sh` — refreshes bastion staging from
  the workstation, then hands the play off to the bastion-side tracked runner
- the remote-bastion wrapper restages both repo trees and the selected override
  file before handoff, so local override edits are part of the same run
- `./scripts/lab-dashboard.sh` — watches the tracked runner state locally
  before the bastion handoff and can continue tracking bastion-side state after
  handoff

1. Validate the local inputs and the on-prem inventory.
   - `RUN LOCALLY`
     ```bash
     ansible-playbook --syntax-check playbooks/site-bootstrap.yml
     ansible-playbook --syntax-check playbooks/site-precluster.yml
     ansible-playbook --syntax-check playbooks/site-lab.yml
     ```
1. Verify the on-prem host contract.
   - check SSH reachability
   - check `virt-host-validate`
   - check storage visibility and the intended volume group
   - confirm the bastion-side hypervisor path you intend to publish through:
     - `on_prem_bastion_hypervisor_host`
     - `on_prem_bastion_hypervisor_user`
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
     ./scripts/run_local_playbook.sh playbooks/bootstrap/site.yml
     ```
   - this host bootstrap now also applies the baseline host memory
     oversubscription policy:
     - `zram`
     - THP `madvise`
     - KSM
   - for the support-services-only AD profile, pass the override:
     ```bash
     ./scripts/run_local_playbook.sh playbooks/bootstrap/site.yml \
       -e @inventory/overrides/core-services-ad.yml.example
     ```
   - for the reduced pre-cluster profile, pass the override:
     ```bash
     ./scripts/run_local_playbook.sh playbooks/bootstrap/site.yml \
       -e @inventory/overrides/precluster-64g.yml
     ```
1. Build the bastion and stage the project.
   - `RUN LOCALLY`
     ```bash
     ./scripts/run_local_playbook.sh playbooks/site-bootstrap.yml
     ```
   - for the support-services-only AD profile, pass the override:
     ```bash
     ./scripts/run_local_playbook.sh playbooks/site-bootstrap.yml \
       -e @inventory/overrides/core-services-ad.yml.example
     ```
   - for the reduced pre-cluster profile, pass the same override:
     ```bash
     ./scripts/run_local_playbook.sh playbooks/site-bootstrap.yml \
       -e @inventory/overrides/precluster-64g.yml
     ```
   - this wrapper stages both:
     - `on-prem-openshift-demo/`
     - `aws-metal-openshift-demo/`
   - it also rewrites the bastion-side runtime inventory so bastion uses your
     explicit on-prem hypervisor user instead of `ec2-user`
1. Resume the stock lab flow.
   - `RUN ON BASTION`
     ```bash
     ./scripts/run_bastion_playbook.sh playbooks/site-lab.yml
     ```
   - alternatively, from the workstation:
     ```bash
     ./scripts/run_remote_bastion_playbook.sh playbooks/site-lab.yml
     ```
   - from this point, use the stock flow reference:
     - <a href="../../aws-metal-openshift-demo/docs/automation-flow.md#recommended-run-order"><kbd>AWS AUTOMATION FLOW: RECOMMENDED RUN ORDER</kbd></a>
   - current cluster-capable external Ceph profile:
     - <a href="../inventory/overrides/core-services-ad-plus-openshift-3node-external-ceph.yml.example"><kbd>core-services-ad-plus-openshift-3node-external-ceph.yml.example</kbd></a>
     - enables the supported day-2 baseline with external ODF
     - disables internal ODF, infra conversion, LDAP auth, OpenShift
       Virtualization, and Pipelines
     - carries the external Ceph cluster-details payload inline as base64, so
       the bastion-side run does not depend on an operator-local
       cluster-details file path
     - documents its phase-selection and resource-sizing contract in
       <a href="./override-mechanism.md"><kbd>OVERRIDE MECHANISM</kbd></a>

### Cluster-capable external Ceph run order

For the current 3-control-plane / 3-worker external Ceph profile, keep the
same override on every phase of the run:

```bash
cd <project-root>/on-prem-openshift-demo

./scripts/run_local_playbook.sh playbooks/site-bootstrap.yml \
  -e @inventory/overrides/core-services-ad-plus-openshift-3node-external-ceph.yml.example

./scripts/run_remote_bastion_playbook.sh playbooks/site-lab.yml \
  -e @inventory/overrides/core-services-ad-plus-openshift-3node-external-ceph.yml.example
```

If the support services are already healthy and only day-2 needs to continue,
run the shared day-2 play through the on-prem remote-bastion wrapper:

```bash
cd <project-root>/on-prem-openshift-demo

./scripts/run_remote_bastion_playbook.sh \
  ../aws-metal-openshift-demo/playbooks/day2/openshift-post-install.yml \
  -e @inventory/overrides/core-services-ad-plus-openshift-3node-external-ceph.yml.example
```

The wrapper refreshes staging and the override before handing off to bastion.
Do not run the shared day-2 play directly from the workstation against the
cluster API.

### Support-services-only run order

For hosts sized for support services but not cluster VMs, such as the
`core-services` and `core-services-ad` override profiles:

1. Run `./scripts/run_local_playbook.sh`
   <a href="../playbooks/site-bootstrap.yml"><kbd>playbooks/site-bootstrap.yml</kbd></a>
   locally with the selected support-services override.
1. From the staged on-prem tree on bastion, run:
   - `RUN ON BASTION`
     ```bash
     ./scripts/run_bastion_playbook.sh playbooks/site-precluster.yml \
       -e @inventory/overrides/core-services-ad.yml.example
     ```
   - alternatively, from the workstation:
     ```bash
     ./scripts/run_remote_bastion_playbook.sh playbooks/site-precluster.yml \
       -e @inventory/overrides/core-services-ad.yml.example
     ```
1. `site-precluster.yml` stops after:
   - optional `ad-server`
   - `idm`
   - optional `idm-ad-trust`
   - `bastion-join`
   - `mirror-registry`
1. Healthy support-service phases are now skipped on rerun when the existing
   AD, IdM, bastion base, and bastion-join state already matches the expected
   completed end state.
1. Stop there. Do not continue to `site-lab.yml` unless the host has been
   expanded to a cluster-capable profile.

### Reduced pre-cluster run order

For a smaller host that should stop at mirror-registry:

1. Run `./scripts/run_local_playbook.sh`
   <a href="../playbooks/site-bootstrap.yml"><kbd>playbooks/site-bootstrap.yml</kbd></a>
   locally with the override.
1. SSH to bastion after staging completes.
1. From the staged on-prem tree on bastion, run:
   - `RUN ON BASTION`
     ```bash
     ./scripts/run_bastion_playbook.sh playbooks/site-precluster.yml \
       -e @inventory/overrides/precluster-64g.yml
     ```
   - alternatively, from the workstation:
     ```bash
     ./scripts/run_remote_bastion_playbook.sh playbooks/site-precluster.yml \
       -e @inventory/overrides/precluster-64g.yml
     ```
1. Stop there. Do not continue to `site-lab.yml` unless the host profile has
   been expanded for cluster capacity.

## Handoff Point

After `./scripts/run_local_playbook.sh`
<a href="../playbooks/site-bootstrap.yml"><kbd>playbooks/site-bootstrap.yml</kbd></a>
finishes successfully in the on-prem subtree:

- the host has been prepared
- guest LVs exist
- `/dev/ebs/*` compatibility paths exist
- the bastion has been built
- the on-prem and stock project trees have been staged

At that point:

- for cluster-capable profiles, use:
  - <a href="../../aws-metal-openshift-demo/docs/automation-flow.md"><kbd>AWS AUTOMATION FLOW</kbd></a>
  - <a href="../../aws-metal-openshift-demo/docs/manual-process.md#13a-optionally-build-ad-ds-and-ad-cs-from-bastion"><kbd>AWS MANUAL PROCESS: STEP 13A</kbd></a>
- for support-services-only profiles such as `core-services` or
  `core-services-ad`, run
  <a href="../playbooks/site-precluster.yml"><kbd>playbooks/site-precluster.yml</kbd></a>
  and stop after mirror-registry
- for the reduced `precluster-64g` profile, also run
  <a href="../playbooks/site-precluster.yml"><kbd>playbooks/site-precluster.yml</kbd></a>
  and stop there
