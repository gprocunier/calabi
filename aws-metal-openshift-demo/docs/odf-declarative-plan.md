# ODF Declarative Plan

Nearby docs:

<a href="./manual-process.md"><kbd>&nbsp;&nbsp;MANUAL PROCESS&nbsp;&nbsp;</kbd></a>
<a href="./openshift-cluster-matrix.md"><kbd>&nbsp;&nbsp;CLUSTER MATRIX&nbsp;&nbsp;</kbd></a>
<a href="./network-topology.md"><kbd>&nbsp;&nbsp;NETWORK TOPOLOGY&nbsp;&nbsp;</kbd></a>
<a href="./README.md"><kbd>&nbsp;&nbsp;DOCS MAP&nbsp;&nbsp;</kbd></a>

This is the holding area for the ODF manifests we want to apply once that path
is ready. They are staged for review, not applied by default.

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
