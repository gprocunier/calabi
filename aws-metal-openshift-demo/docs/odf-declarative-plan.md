# ODF Declarative Plan

Nearby docs:

<a href="./manual-process.md"><kbd>&nbsp;&nbsp;MANUAL PROCESS&nbsp;&nbsp;</kbd></a>
<a href="./openshift-cluster-matrix.md"><kbd>&nbsp;&nbsp;CLUSTER MATRIX&nbsp;&nbsp;</kbd></a>
<a href="./network-topology.md"><kbd>&nbsp;&nbsp;NETWORK TOPOLOGY&nbsp;&nbsp;</kbd></a>
<a href="./README.md"><kbd>&nbsp;&nbsp;DOCS MAP&nbsp;&nbsp;</kbd></a>

This page describes the ODF declarative inputs behind the day-2 storage phase.
The internal path uses generated Local Storage Operator and `StorageCluster`
manifests. The external path imports operator-provided Ceph cluster details and
creates an external `StorageCluster` without claiming local disks.

## Internal Mode

Internal mode is selected with:

```yaml
openshift_post_install_odf_mode: internal
```

It is the original local-storage path.

Files:

- `generated/odf/localvolumediscovery-auto-discover-devices.yaml`
- `generated/odf/localvolumeset-ceph-osd.yaml`
- `generated/odf/storagecluster-ocs-storagecluster.yaml`

Current assumptions in these manifests:

- storage nodes are `ocp-infra-01`, `ocp-infra-02`, and `ocp-infra-03`
- those nodes carry the label `cluster.ocs.openshift.io/openshift-storage=`
- those nodes keep the `node-role.kubernetes.io/infra=` label, but the only
  required ODF taint is:
  - `node.ocs.openshift.io/storage=true:NoSchedule`
- LSO discovery currently reports one usable ODF disk per infra node:
  - `/dev/sda`
  - size about `1 TiB`
- the root/OS disk is not selected

What each manifest does:

- `LocalVolumeDiscovery`
  - runs only on infra nodes
  - tolerates the ODF storage taint
  - is the known-good discovery config for this lab

- `LocalVolumeSet`
  - that creates a local block storage class named `ceph-osd`
  - targets only nodes labeled for ODF storage
  - tolerates the ODF storage taint so the provisioner runs on the storage nodes
  - constrains disk size to the expected 1 TiB data devices
  - uses `maxDeviceCount: 1` so only the extra ODF disk is claimed per infra node

- `StorageCluster`
  - builds ODF on top of `ceph-osd`
  - targets only ODF-labeled infra nodes
  - tolerates the ODF storage taint
  - uses `portable: false`
  - uses `replica: 3` for the three infra nodes

> [!WARNING]
> Confirm all three items below before applying these manifests. If discovery
> results have changed since the manifests were staged, the ODF deployment
> will fail or claim the wrong devices.

Before apply, confirm:

- `cluster.ocs.openshift.io/openshift-storage=` is present on all three infra nodes
- `LocalVolumeDiscoveryResult` for each infra node still shows `/dev/sda` as `Available`
- the live `LocalVolumeSet` named `ceph-osd` should be patched to match the saved manifest

## External Mode

External mode is selected with:

```yaml
openshift_post_install_odf_mode: external
```

It skips the Local Storage Operator path and instead:

- installs the ODF operator in `openshift-storage`
- creates the imported external-cluster details secret
- applies the external `StorageCluster`
- waits for the external `StorageCluster` to become available
- accepts the external Rook `CephCluster` phase used by imported clusters, such
  as `Connected`

External mode expects exactly one source for the external cluster details:

```yaml
openshift_post_install_odf_external_cluster_details_file: /absolute/path/to/external-cluster-details.json
```

or:

```yaml
openshift_post_install_odf_external_cluster_details_b64: <base64-encoded-json>
```

Use the base64 form when the play is handed from the workstation to bastion and
the local source file cannot be guaranteed to exist on both sides.

External mode may need cluster-level OVN host routing before ODF pods can reach
off-cluster Ceph endpoints. Profiles can request that with:

```yaml
openshift_post_install_odf_external_gateway_routing_via_host: true
openshift_post_install_odf_external_gateway_ip_forwarding: Global
```

Downstream roles should consume the effective ODF storage class variables
rather than hard-coding internal class names. External mode commonly uses a
class such as `ocs-external-storagecluster-ceph-rbd` instead of
`ocs-storagecluster-ceph-rbd`.
