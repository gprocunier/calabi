# OpenShift Cluster Matrix

Nearby docs:

<a href="./automation-flow.md"><kbd>&nbsp;&nbsp;AUTOMATION FLOW&nbsp;&nbsp;</kbd></a>
<a href="./network-topology.md"><kbd>&nbsp;&nbsp;NETWORK TOPOLOGY&nbsp;&nbsp;</kbd></a>
<a href="./host-resource-management.md"><kbd>&nbsp;&nbsp;RESOURCE MANAGEMENT&nbsp;&nbsp;</kbd></a>
<a href="./manual-process.md"><kbd>&nbsp;&nbsp;MANUAL PROCESS&nbsp;&nbsp;</kbd></a>
<a href="./README.md"><kbd>&nbsp;&nbsp;DOCS MAP&nbsp;&nbsp;</kbd></a>

Keep this open when you need the cluster facts in one place: hostnames, MAC
addresses, VLAN IPs, VIPs, and the identity data the later agent-based install
path depends on.

## Cluster identity

- Cluster name: `ocp`
- Base domain: `workshop.lan`
- Full cluster domain: `ocp.workshop.lan`

## DNS and VIPs

- API: `api.ocp.workshop.lan` -> `172.16.10.5`
- API internal: `api-int.ocp.workshop.lan` -> `172.16.10.5`
- Apps wildcard: `*.apps.ocp.workshop.lan` -> `172.16.10.7`

## Guest network intent

- Each OpenShift guest has one trunk NIC attached to `lab-switch` / `ocp-trunk`
- VLAN `200` is the OpenShift machine network
- VLAN `201` is the storage-segregation network
- VLAN `202` is reserved for OpenShift Virtualization live migration
- The later agent/NMState content should match the NIC by MAC address, then create:
  - a VLAN subinterface for `200` with the node's machine-network IP and default route
  - a VLAN subinterface for `201` with the node's storage-network IP and no default route
  - any later live-migration network attachment on `202` via day-2
    NMState/Multus rather than install-time host networking

## Shared services

- DNS/NTP/IdM: `idm-01.workshop.lan` / `172.16.0.10`
- Mirror registry: `mirror-registry.workshop.lan` / `172.16.0.20`

## Node sizing

- control plane nodes: `8 vCPU / 24 GiB`
- infra nodes: `16 vCPU / 64 GiB`
- worker nodes: `12 vCPU / 16 GiB`

## Nodes

| Role | Hostname | FQDN | MAC | VLAN 200 IP | VLAN 201 IP |
| --- | --- | --- | --- | --- | --- |
| control-plane | `ocp-master-01` | `ocp-master-01.ocp.workshop.lan` | `52:54:00:20:00:10` | `172.16.10.11/24` | `172.16.11.11/24` |
| control-plane | `ocp-master-02` | `ocp-master-02.ocp.workshop.lan` | `52:54:00:20:00:11` | `172.16.10.12/24` | `172.16.11.12/24` |
| control-plane | `ocp-master-03` | `ocp-master-03.ocp.workshop.lan` | `52:54:00:20:00:12` | `172.16.10.13/24` | `172.16.11.13/24` |
| infra | `ocp-infra-01` | `ocp-infra-01.ocp.workshop.lan` | `52:54:00:20:00:21` | `172.16.10.21/24` | `172.16.11.21/24` |
| infra | `ocp-infra-02` | `ocp-infra-02.ocp.workshop.lan` | `52:54:00:20:00:22` | `172.16.10.22/24` | `172.16.11.22/24` |
| infra | `ocp-infra-03` | `ocp-infra-03.ocp.workshop.lan` | `52:54:00:20:00:23` | `172.16.10.23/24` | `172.16.11.23/24` |
| worker | `ocp-worker-01` | `ocp-worker-01.ocp.workshop.lan` | `52:54:00:20:00:31` | `172.16.10.31/24` | `172.16.11.31/24` |
| worker | `ocp-worker-02` | `ocp-worker-02.ocp.workshop.lan` | `52:54:00:20:00:32` | `172.16.10.32/24` | `172.16.11.32/24` |
| worker | `ocp-worker-03` | `ocp-worker-03.ocp.workshop.lan` | `52:54:00:20:00:33` | `172.16.10.33/24` | `172.16.11.33/24` |
