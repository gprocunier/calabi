# Network Topology

Nearby docs:

<a href="./iaas-resource-model.md"><kbd>&nbsp;&nbsp;IAAS MODEL&nbsp;&nbsp;</kbd></a>
<a href="./openshift-cluster-matrix.md"><kbd>&nbsp;&nbsp;CLUSTER MATRIX&nbsp;&nbsp;</kbd></a>
<a href="./host-resource-management.md"><kbd>&nbsp;&nbsp;RESOURCE MANAGEMENT&nbsp;&nbsp;</kbd></a>
<a href="./odf-declarative-plan.md"><kbd>&nbsp;&nbsp;ODF PLAN&nbsp;&nbsp;</kbd></a>
<a href="./README.md"><kbd>&nbsp;&nbsp;DOCS MAP&nbsp;&nbsp;</kbd></a>

This page shows the network shape the lab is trying to reproduce on one host.
The point is not just connectivity. The topology needs to stay relatable to a
real multi-host deployment.

The VLAN count is deliberate. The lab is not trying to prove that OpenShift can
boot with the fewest possible segments. It is trying to preserve the service
boundaries that matter in a real environment:

- management traffic stays separate from cluster traffic
- the machine network remains distinct from storage and migration paths
- guest data VLANs can be modeled without pretending they are all the same
- a non-routable segment still exists for cases where pure layer-2 adjacency is
  the point

That is why this page matters even on one host. The value is not the number of
interfaces. The value is that the network shape is still something you could
explain to a platform or network team without apologizing for it.

## Why The VLAN Model Looks Like This

`VLAN 100` is the management plane. It carries the support services and the
operator-facing entrypoints that make the rest of the lab possible: `idm-01`,
`mirror-registry`, `bastion-01`, and the routed SVI on `virt-01`.

`VLAN 200` is the cluster machine network. This is where the control-plane and
worker node identities live, and where the API and ingress VIPs belong.
Keeping this separate from management makes the cluster look like a real
deployment instead of a pile of hosts sharing one flat access network.

`VLAN 201` exists because storage traffic is worth keeping explicit. ODF and
Ceph-adjacent designs are easier to reason about when storage is not collapsed
into the same network as everything else.

`VLAN 202` is reserved for live migration style traffic. Even when that path is
not heavily exercised yet, keeping it in the design prevents the lab from
teaching the wrong lesson about where migration traffic should live.

`VLANs 300` and `301` are guest data segments. They are there to keep room for
real application or tenant-style data paths instead of forcing every workload
onto the machine or management networks.

`VLAN 302` stays non-routable on purpose. Some network stories are about pure
L2 adjacency, isolation, or broadcast domain behavior. A routed SVI there would
change the meaning of the segment.

## Infrastructure View

```mermaid
flowchart LR
    internet[(Internet)]
    uplink["AWS VPC / EC2 uplink"]

    subgraph host["virt-01 / RHEL 10.1 hypervisor"]
        nat["firewalld masquerade<br/>external zone"]
        ovs["OVS bridge<br/>lab-switch"]

        subgraph mgmt["VLAN 100 management"]
            svi100["SVI vlan100<br/>172.16.0.1/24"]
            idm["idm-01.workshop.lan<br/>172.16.0.10"]
            mirror["mirror-registry.workshop.lan<br/>172.16.0.20"]
            bastion["bastion-01.workshop.lan<br/>172.16.0.30"]
        end

        subgraph machine["VLAN 200 machine network"]
            svi200["SVI vlan200<br/>172.16.10.1/24"]
            api["API/API-int VIP<br/>172.16.10.5"]
            ingress["Ingress VIP<br/>172.16.10.7"]
        end

        subgraph storage["VLAN 201 storage"]
            svi201["SVI vlan201<br/>172.16.11.1/24"]
        end

        subgraph migration["VLAN 202 live migration"]
            svi202["SVI vlan202<br/>172.16.12.1/24"]
        end

        subgraph data300["VLAN 300 guest data"]
            svi300["SVI vlan300<br/>172.16.20.1/24"]
        end

        subgraph data301["VLAN 301 guest data"]
            svi301["SVI vlan301<br/>172.16.21.1/24"]
        end

        subgraph data302["VLAN 302 isolated guest data"]
            vlan302["Non-routable L2 segment"]
        end
    end

    internet --> uplink --> nat --> ovs

    ovs --> mgmt
    ovs --> machine
    ovs --> storage
    ovs --> migration
    ovs --> data300
    ovs --> data301
    ovs --- data302
```

## OpenShift Guest VLAN View

```mermaid
flowchart LR
    trunk["libvirt portgroup<br/>ocp-trunk"]

    subgraph vlan200["VLAN 200 / machine network"]
        m1_200["ocp-master-01<br/>nic0.200<br/>172.16.10.11"]
        m2_200["ocp-master-02<br/>nic0.200<br/>172.16.10.12"]
        m3_200["ocp-master-03<br/>nic0.200<br/>172.16.10.13"]
        i1_200["ocp-infra-01<br/>nic0.200<br/>172.16.10.21"]
        i2_200["ocp-infra-02<br/>nic0.200<br/>172.16.10.22"]
        i3_200["ocp-infra-03<br/>nic0.200<br/>172.16.10.23"]
        w1_200["ocp-worker-01<br/>nic0.200<br/>172.16.10.31"]
        w2_200["ocp-worker-02<br/>nic0.200<br/>172.16.10.32"]
        w3_200["ocp-worker-03<br/>nic0.200<br/>172.16.10.33"]
    end

    subgraph vlan201["VLAN 201 / ODF storage"]
        m1_201["ocp-master-01<br/>nic0.201<br/>172.16.11.11"]
        m2_201["ocp-master-02<br/>nic0.201<br/>172.16.11.12"]
        m3_201["ocp-master-03<br/>nic0.201<br/>172.16.11.13"]
        i1_201["ocp-infra-01<br/>nic0.201<br/>172.16.11.21"]
        i2_201["ocp-infra-02<br/>nic0.201<br/>172.16.11.22"]
        i3_201["ocp-infra-03<br/>nic0.201<br/>172.16.11.23"]
        w1_201["ocp-worker-01<br/>nic0.201<br/>172.16.11.31"]
        w2_201["ocp-worker-02<br/>nic0.201<br/>172.16.11.32"]
        w3_201["ocp-worker-03<br/>nic0.201<br/>172.16.11.33"]
    end

    subgraph vlan202["VLAN 202 / live migration"]
        m1_202["ocp-master-01<br/>nic0.202<br/>reserved"]
        m2_202["ocp-master-02<br/>nic0.202<br/>reserved"]
        m3_202["ocp-master-03<br/>nic0.202<br/>reserved"]
        i1_202["ocp-infra-01<br/>nic0.202<br/>reserved"]
        i2_202["ocp-infra-02<br/>nic0.202<br/>reserved"]
        i3_202["ocp-infra-03<br/>nic0.202<br/>reserved"]
        w1_202["ocp-worker-01<br/>nic0.202<br/>reserved"]
        w2_202["ocp-worker-02<br/>nic0.202<br/>reserved"]
        w3_202["ocp-worker-03<br/>nic0.202<br/>reserved"]
    end

    trunk --> vlan200
    trunk --> vlan201
    trunk --> vlan202
```
