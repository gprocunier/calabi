# On-Prem Override Mechanism

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

Use this page when you need to understand what the example override files are
for, which knobs are safe to edit, and how the on-prem wrappers carry those
values across the workstation-to-bastion handoff.

## What Overrides Do

The on-prem subtree reuses the stock AWS-metal support-service, cluster, and
day-2 playbooks after the host and bastion staging work is complete. Overrides
are the compatibility layer that changes the lab shape without forking those
shared playbooks.

An override can define:

- the guest logical volumes that should exist on the on-prem hypervisor
- support-service enablement, such as AD and mirror execution
- extra OVS bridges and libvirt networks
- OpenShift node count, MAC addresses, memory, vCPU, and extra NICs
- installer network data, DNS names, VIPs, and static node addresses
- day-2 phase selection
- external ODF details and effective storage class names
- host CPU and memory policy for the selected hardware class

Pass an override with `-e @...`:

```bash
cd <project-root>/on-prem-openshift-demo

./scripts/run_local_playbook.sh playbooks/site-bootstrap.yml \
  -e @inventory/overrides/core-services-ad-plus-openshift-3node-external-ceph.yml.example

./scripts/run_remote_bastion_playbook.sh playbooks/site-lab.yml \
  -e @inventory/overrides/core-services-ad-plus-openshift-3node-external-ceph.yml.example
```

The remote-bastion wrapper refreshes bastion staging before the bastion-side
play starts. That staging includes the selected override file, so local edits
to the override are part of the same run.

## Current Example Profiles

The examples under `inventory/overrides/` are intended as starting points:

- `core-services.yml.example` builds the support-service baseline without AD.
- `core-services-ad.yml.example` adds the optional AD path.
- `core-services-ad-128g.yml.example` is the current support-services+AD
  profile for a smaller on-prem host with managed zram writeback.
- `precluster-64g.yml.example` is a reduced pre-cluster profile that should
  stop after mirror-registry.
- `core-services-ad-plus-openshift-3node-external-ceph.yml.example` is the
  current cluster-capable on-prem profile: AD, bastion, IdM, mirror-registry,
  a 3-control-plane / 3-worker OpenShift cluster, and external Ceph consumed
  through ODF external mode.

Do not treat the example names as magic. The behavior comes from the variables
inside the file.

## Enable Toggles And Force Toggles

Day-2 uses two kinds of toggles.

`openshift_post_install_enable_*` variables decide whether a phase is part of
the run at all. If an enable toggle is false, the phase is skipped even on a
fresh cluster.

`openshift_post_install_force_*` variables decide whether an enabled phase
should rerun even when its convergence probe says it is already healthy. Force
toggles are for deliberate repair or rebuild work, not normal continuation.

Example:

```yaml
openshift_post_install_enable_disconnected_operatorhub: true
openshift_post_install_force_disconnected_operatorhub: false
```

That means the disconnected OperatorHub phase is part of the intended day-2
profile, but a rerun should skip it if the mirrored catalog sources already
look healthy.

For the current external-Ceph profile:

- disconnected OperatorHub is enabled
- IdM ingress certs are enabled
- breakglass auth is enabled
- NMState is enabled
- ODF is enabled in external mode
- Keycloak, OIDC auth, Web Terminal, AAP, NetObserv, and validation are enabled
- infra conversion is disabled
- internal ODF assumptions are disabled by selecting external ODF mode
- LDAP auth is disabled
- OpenShift Virtualization is disabled
- OpenShift Pipelines is disabled
- all force toggles default to false

## External ODF Inputs

External ODF is selected with:

```yaml
openshift_post_install_odf_mode: external
```

In that mode, the day-2 ODF phase installs the ODF operator, creates the
imported external-cluster details secret, and creates the external
`StorageCluster`. It does not run the Local Storage Operator path, does not
create local OSD devices, and does not require storage-node labels or taints.

Provide exactly one external cluster-details source:

```yaml
openshift_post_install_odf_external_cluster_details_file: /absolute/path/to/external-cluster-details.json
```

or:

```yaml
openshift_post_install_odf_external_cluster_details_b64: <base64-encoded-json>
```

The cluster-capable on-prem example uses the base64 form because it survives
the workstation-to-bastion handoff. A local file path is useful during private
operator testing, but it is not portable unless that same path exists in the
same place wherever the play runs.

Do not publish real Ceph secrets, keys, or object-store credentials in a public
override. Replace the payload with a sanitized example before release.

## External ODF Networking

External Ceph endpoints are outside the OpenShift pod network. The current
external ODF profile therefore also requests OVN host routing before the
external `StorageCluster` is applied:

```yaml
openshift_post_install_odf_external_gateway_routing_via_host: true
openshift_post_install_odf_external_gateway_ip_forwarding: Global
```

The day-2 role converges the cluster `Network` operator configuration before
ODF external rollout. This ordering matters: without host routing and global IP
forwarding, ODF pods can fail to reach the external Ceph monitors or metrics
endpoint even when the OpenShift nodes themselves can reach that network.

## Effective Storage Classes

External mode may create different storage class names than the internal ODF
path. Downstream roles should consume the effective ODF variables rather than
hard-coding internal names.

The cluster-capable external-Ceph profile sets:

```yaml
openshift_post_install_odf_default_storage_class_rbd: >-
  {{ openshift_post_install_odf_storage_cluster_name | default('ocs-external-storagecluster') }}-ceph-rbd
openshift_post_install_odf_required_storage_classes:
  - "{{ openshift_post_install_odf_default_storage_class_rbd }}"
```

Keycloak and AAP then reference that effective RBD class for their databases.
NetObserv uses the effective object storage path and clears the internal-ODF
node selector and tolerations because external ODF does not create dedicated
storage nodes:

```yaml
openshift_post_install_netobserv_loki_node_selector: {}
openshift_post_install_netobserv_loki_tolerations: []
```

## Resource Sizing In The Current Cluster Profile

The current external-Ceph profile intentionally sizes the OpenShift workers
for the full enabled day-2 set:

- masters: `16384` MiB each
- workers: `32768` MiB each
- bastion: `8192` MiB
- mirror-registry: `8192` MiB and 4 vCPU
- IdM: `8192` MiB and 4 vCPU
- AD: `8192` MiB and 4 vCPU

This is driven by Kubernetes scheduling pressure, not just host memory
pressure. KSM and zram may make the hypervisor look comfortable while pods
still fail to schedule because requested memory does not fit on the workers.

## Mirror Registry Tunables

The external-Ceph profile also sets the current mirror parallelism defaults:

```yaml
mirror_registry_oc_mirror_parallel_images: 16
mirror_registry_oc_mirror_parallel_layers: 12
```

These values apply to the mirror-to-disk and disk-to-mirror `oc-mirror` lanes.
Reduce them if the mirror registry guest or backing storage is saturated.

## Choosing A Boundary

Use `site-bootstrap.yml` when changing host, storage, bastion, or staging
inputs. Use `site-lab.yml` when changing support-service, cluster, mirror, or
day-2 inputs after bastion exists.

For a clean OpenShift rebuild that preserves healthy support services, use the
cluster cleanup path first, then rerun `site-lab.yml` with the same override.
Do not use force toggles as a substitute for teardown when the existing
cluster is broken.
