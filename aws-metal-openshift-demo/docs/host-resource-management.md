# Host Resource Management

Nearby docs:

<a href="./manual-process.md"><kbd>&nbsp;&nbsp;MANUAL PROCESS&nbsp;&nbsp;</kbd></a>
<a href="./network-topology.md"><kbd>&nbsp;&nbsp;NETWORK TOPOLOGY&nbsp;&nbsp;</kbd></a>
<a href="./openshift-cluster-matrix.md"><kbd>&nbsp;&nbsp;CLUSTER MATRIX&nbsp;&nbsp;</kbd></a>
<a href="./orchestration-guide.md"><kbd>&nbsp;&nbsp;ORCHESTRATION GUIDE&nbsp;&nbsp;</kbd></a>
<a href="./host-memory-oversubscription.md"><kbd>&nbsp;&nbsp;HOST MEMORY&nbsp;&nbsp;</kbd></a>
<a href="./README.md"><kbd>&nbsp;&nbsp;DOCS MAP&nbsp;&nbsp;</kbd></a>

This explains why `virt-01` is sized and scheduled the way it is,
especially once the host is busy.

The root model comes from Greg Procunier's cgroup-tiering thesis for
OpenStack:

- `https://github.com/gprocunier/openstack-cgroup-tiering`

This is the single-host version of that idea. The OpenStack-specific
scheduler and placement pieces are gone, but the core idea is still the same:

- keep host and guest execution domains distinct
- let guests compete in weighted performance domains instead of a flat pool
- preserve idle borrowing while making degradation behavior intentional

So the implementation here is best read as a fixed-workload, single-host
adaptation of the original cgroup-tiering model, not a separate design that
started from zero.

The practical goal:

- keep ordinary host-side work away from guest vCPU execution as much as
  practical
- let all guest vCPU threads compete in one shared execution pool
- make contention behavior intentional by placing guests into Gold, Silver, and
  Bronze performance domains instead of a flat scheduler pool

The implementation is built from standard Linux, systemd, libvirt, and
`virt-install` controls. The unusual part is the composition of those mundane
controls into a single scheduling policy.

## Current Implemented State

The current codebase intentionally keeps the guest-side policy stronger than
the host-side policy.

Implemented:

- `machine-gold.slice`, `machine-silver.slice`, and `machine-bronze.slice`
- manager-level systemd `CPUAffinity=` for host-managed services
- libvirt `partition` placement into the tier slices
- libvirt `shares`
- libvirt `vcpupin`
- libvirt `emulatorpin`
- libvirt `iothreadpin` for selected guests
- a dedicated host memory oversubscription role that applies:
  - `zram`
  - KSM
  - THP `madvise`

Intentionally not enabled by default:

- kernel boot arguments:
  - `systemd.cpu_affinity=...`
  - `irqaffinity=...`
- `IRQBALANCE_BANNED_CPULIST=...`

> [!NOTE]
> These stronger host-isolation controls were trialed and backed out. They
> made host-side admin workflows (SSH, Cockpit, OVS diagnostics) less
> predictable under load. The settled design keeps VM tiering but avoids
> over-constraining the entire host control plane.

## Host Memory Oversubscription

A separate `lab_host_memory_oversubscription` role applies zram compressed
swap, Transparent Huge Pages, and Kernel Same-page Merging to improve host
RAM efficiency. This is documented in its own file:

<a href="./host-memory-oversubscription.md"><kbd>&nbsp;&nbsp;HOST MEMORY OVERSUBSCRIPTION&nbsp;&nbsp;</kbd></a>

## Design Summary

```mermaid
flowchart TB
    host[virt-01 host]
    host --> reserved["Host reserved CPUs\nsystemd-managed host work"]
    host --> guest["Guest execution CPUs\nshared VM vCPU pool"]

    reserved --> housekeeping["Housekeeping subset\nOVS, libvirt daemons,\ngeneral host services"]
    reserved --> emulator["Emulator subset\nQEMU emulator threads\nand selected IOThreads"]

    guest --> gold["Gold domain\nmasters"]
    guest --> silver["Silver domain\ninfra plus IdM"]
    guest --> bronze["Bronze domain\nworkers plus bastion plus mirror"]
```

At runtime:

- host services are constrained by manager `CPUAffinity` to the reserved pool
- guest vCPU threads are pinned to the guest execution pool
- QEMU emulator threads are pinned to the emulator subset of the reserved pool
- systemd tier slices provide relative weight when tier siblings contend

## Hardware Topology

`virt-01` currently runs on AWS `m5.metal`:

- 2 sockets / 2 NUMA nodes
- 24 physical cores per socket
- 2 SMT threads per core
- 96 logical CPUs total

The CPU numbering is regular:

- socket 0 primary threads: `0-23`
- socket 0 SMT siblings: `48-71`
- socket 1 primary threads: `24-47`
- socket 1 SMT siblings: `72-95`

Examples:

- core pair `0,48`
- core pair `5,53`
- core pair `24,72`
- core pair `47,95`

That regularity matters because the policy always reserves or allocates whole
SMT core pairs, never isolated sibling threads.

## Current CPU Pools

The orchestration source of truth is
`vars/global/host_resource_management.yml`.

Current pool definitions:

- `host_reserved`: `0-5,24-29,48-53,72-77`
- `host_housekeeping`: `0-1,24-25,48-49,72-73`
- `host_emulator`: `2-5,26-29,50-53,74-77`
- `guest_domain`: `6-23,30-47,54-71,78-95`

Pool meaning:

| Pool | CPUs | Physical cores | Purpose |
| --- | --- | --- | --- |
| `host_reserved` | `0-5,24-29,48-53,72-77` | 12 | effective host pool exposed to manager `CPUAffinity` |
| `host_housekeeping` | `0-1,24-25,48-49,72-73` | 4 | host networking, OVS, libvirt daemons, general userspace host work |
| `host_emulator` | `2-5,26-29,50-53,74-77` | 8 | QEMU emulator threads and explicit IOThreads |
| `guest_domain` | `6-23,30-47,54-71,78-95` | 36 | shared guest vCPU execution pool |

This preserves:

- `6` physical host cores per socket
- `18` physical guest cores per socket

Or, across the full host:

- `12` physical / `24` logical CPUs for host work
- `36` physical / `72` logical CPUs for guest vCPU execution

### Current Host Policy

The host policy deliberately stops short of hard scheduler isolation:

- systemd manager `CPUAffinity` is enabled for `host_reserved`
- dedicated tier slices are installed and weighted
- no kernel affinity boot args are managed by default
- no guest-domain `irqbalance` ban is managed by default

In other words, the host keeps a preferred execution pool, but the design does
not currently try to force early-boot IRQ and scheduler behavior into a narrow
housekeeping regime.

## Performance Domains

All guest vCPU threads share the same `guest_domain` cpuset. The Gold, Silver,
and Bronze domains are not separate cpusets; they are sibling scheduling
domains with different relative weight.

| Tier | systemd partition | `CPUWeight` | libvirt `shares` | Intended class |
| --- | --- | --- | --- | --- |
| Gold | `/machine/gold` | `512` | `512` | control plane |
| Silver | `/machine/silver` | `333` | `333` | infra and support services |
| Bronze | `/machine/bronze` | `167` | `167` | general workload capacity |

```mermaid
flowchart LR
    guest["guest_domain CPUs\n6-23,30-47,54-71,78-95"]
    guest --> gold["/machine/gold\nCPUWeight=512"]
    guest --> silver["/machine/silver\nCPUWeight=333"]
    guest --> bronze["/machine/bronze\nCPUWeight=167"]
```

> [!IMPORTANT]
> These are relative shares under contention, not hard reservations. Idle CPU
> in Gold or Silver can still be borrowed by Bronze. The model improves
> graceful degradation; it does not create deterministic latency guarantees.

## Guest Tier Mapping

Current role-to-tier mapping:

| Guest class | Tier | Reason |
| --- | --- | --- |
| `ocp-master-01..03` | Gold | API, etcd, control-plane stability |
| `ocp-infra-01..03` | Silver | ingress, monitoring, registry, ODF-adjacent workload |
| `idm-01` | Silver | authentication, DNS, CA, bastion dependency |
| `ocp-worker-01..03` | Bronze | least critical general scheduling pool |
| `mirror-registry` | Bronze | important, but deferrable relative to cluster control plane |
| `bastion-01` | Bronze | operator access host, but not part of cluster control path |
| `ad-01` | Bronze | Windows AD for hybrid identity testing, not cluster-critical |

```mermaid
flowchart TD
    gold[Gold]
    silver[Silver]
    bronze[Bronze]

    gold --> master1[ocp-master-01]
    gold --> master2[ocp-master-02]
    gold --> master3[ocp-master-03]

    silver --> infra1[ocp-infra-01]
    silver --> infra2[ocp-infra-02]
    silver --> infra3[ocp-infra-03]
    silver --> idm[idm-01]

    bronze --> worker1[ocp-worker-01]
    bronze --> worker2[ocp-worker-02]
    bronze --> worker3[ocp-worker-03]
    bronze --> mirror[mirror-registry]
    bronze --> bastion[bastion-01]
    bronze --> ad[ad-01]
```

## Thread Placement Model

The thread-placement model is as important as the weights.

```mermaid
flowchart LR
    qemu[QEMU domain]
    qemu --> vcpu[vCPU threads]
    qemu --> emu[emulator thread]
    qemu --> io[optional IOThread]

    vcpu --> guest[guest_domain]
    emu --> hostemu[host_emulator]
    io --> hostemu
```

Current intent by thread class:

- vCPU threads:
  - pinned to `guest_domain`
- emulator thread:
  - pinned to `host_emulator`
- explicit IOThread:
  - pinned to `host_emulator`
- ordinary host services:
  - inherit the manager-level `host_reserved` mask

The tier slices intentionally do not set `AllowedCPUs=`. CPU placement is
controlled by libvirt thread pinning so that guest execution can live on
`guest_domain` while emulator-side noise remains on `host_emulator`.

## Current `virt-install` Policy

Guest creation uses `virt-install` directly. For each VM, the orchestration
derives the tier from inventory and then applies:

- `--resource partition=...`
- `--cputune shares=...`
- `vcpupinN.cpuset={{ guest_domain }}`
- `emulatorpin.cpuset={{ host_emulator }}`
- `--iothreads ...` plus `iothreadpin...` when the guest is marked for
  explicit IOThreads

Selected guests currently receive one IOThread:

- `ocp-infra-01`
- `ocp-infra-02`
- `ocp-infra-03`
- `mirror-registry`

That is a pragmatic first pass for storage-heavy guests. It is not a claim that
all host-side IO noise has been fully isolated.

## Current Capacity Picture On `m5.metal`

`m5.metal` provides 96 logical CPUs and 384 GiB RAM. The current layout
commits 122 vCPUs and 360 GiB of guest memory across 13 guests. This is a
deliberate oversubscription on CPU managed by the Gold/Silver/Bronze tier
model, with memory sitting just under a 1:1 commit ratio where KSM and zram
provide the safety margin.

Present configured guest allocations:

| Class | Count | vCPU | Memory | Total vCPU | Total Memory |
| --- | --- | --- | --- | --- | --- |
| masters | 3 | 8 | 24 GiB | 24 | 72 GiB |
| infra | 3 | 16 | 64 GiB | 48 | 192 GiB |
| workers | 3 | 12 | 16 GiB | 36 | 48 GiB |
| IdM | 1 | 2 | 8 GiB | 2 | 8 GiB |
| mirror-registry | 1 | 4 | 16 GiB | 4 | 16 GiB |
| bastion | 1 | 4 | 16 GiB | 4 | 16 GiB |
| ad | 1 | 4 | 8 GiB | 4 | 8 GiB |
| **total** | **13 guests** | | | **122** | **360 GiB** |

Against the host:

- guest execution pool: `72` logical CPUs
- current aggregate guest vCPU count: `122`
- current vCPU oversubscription ratio: `1.69:1`
- host physical RAM: `384` GiB
- current memory commit ratio: `0.94:1`

### vCPU Oversubscription Context

| Scenario | Worker shape | Total guest vCPU | Ratio vs 72-logical guest pool | Notes |
| --- | --- | --- | --- | --- |
| historical validated baseline | `3 x 4` | 98 | `1.36:1` | known good baseline before worker uplift |
| previous repo default | `3 x 8` | 110 | `1.53:1` | first uplift from the original 4-vCPU workers |
| current repo default | `3 x 12` | 122 | `1.69:1` | chosen default, validated with memory oversub in place |

The move to `3 x 12` workers was made possible by the memory oversubscription
work (KSM, zram, THP). The host demonstrated low steady-state memory
utilization and minimal `%steal` at the previous `3 x 8` shape, giving
confidence to push workers to the larger allocation.

### Memory Commit Context

The `0.94:1` memory commit ratio means guest allocations nearly fill host RAM
before accounting for the host kernel, page cache, and host-side services.
In practice the host remains comfortable because:

- not all guest memory is active simultaneously (cold pages exist in every VM)
- KSM deduplicates 10-30 GiB of shared RHCOS kernel and base-OS pages
- zram provides a compressed swap buffer for cold anonymous pages under pressure
- the host kernel's own page cache and slab are reclaimable

The infra nodes at 64 GiB each are the dominant memory consumers (192 GiB
total, 53% of host RAM). This is driven by ODF (Ceph OSD memory), monitoring
stack, and ingress router workloads that all land on infra.

> [!NOTE]
> The memory commit ratio is deliberately kept below 1.0 so that the host
> does not depend on KSM or zram for basic stability. Those features improve
> headroom and absorb transient pressure, but the base allocation fits
> without them.

## Resizing Guidance For Other Metal Hosts

> [!WARNING]
> The design is portable, but the CPU sets are not. If you move to a different
> metal host shape, you must recompute every pool mask. Copy-pasting the
> `m5.metal` values onto a different topology will produce wrong pinning.

### Invariants To Keep

- reserve whole physical cores, not lone SMT siblings
- keep the reserved pool symmetric across sockets
- keep one shared guest vCPU pool
- use Gold, Silver, and Bronze as sibling weighted domains inside that one
  guest pool
- keep emulator threads out of the guest pool

### Starting Method

For a new host:

1. Determine:
   - sockets
   - physical cores per socket
   - SMT sibling numbering
2. Choose a host reservation per socket as whole physical cores.
3. Split that reservation into:
   - `2` housekeeping cores per socket
   - the remainder as emulator/helper cores per socket
4. Allocate all remaining whole cores to `guest_domain`.
5. Recompute:
   - host CPU masks
   - guest CPU mask
   - effective guest-pool logical CPU count
   - projected guest-vCPU oversubscription ratios

### Reasonable Starting Reservations

| Host shape | Starting host reservation per socket | Notes |
| --- | --- | --- |
| `<= 16` physical cores/socket | `4` | `2` housekeeping + `2` emulator is the minimum sensible split |
| `24` physical cores/socket | `6` | current `m5.metal` design: `2` housekeeping + `4` emulator |
| `>= 32` physical cores/socket | `6` or `8` | start at `6`; move to `8` only if real host-side pressure justifies it |

### When The Host Gets Smaller

On a smaller metal host, reduce guest ambition before weakening the host pool
too aggressively.

Preferred order of compromise:

1. keep masters stable
2. reduce worker target growth
3. reduce support-guest size where tolerable
4. only then consider squeezing the host reservation further

### When The Host Gets Larger

On a larger metal host, grow the guest pool first. Do not change the tier
weights just because more cores are available.

Preferred order of expansion:

1. increase `guest_domain`
2. validate host-side pressure remains healthy
3. increase worker vCPUs
4. rebalance weights only if measurement says the contention model is wrong

## Operational Validation

After bootstrap and guest creation, validate both the host policy and the guest
placement.

Host checks:

```bash
grep -E '^(DefaultCPUAccounting|CPUAffinity)=' \
  /etc/systemd/system.conf.d/90-aws-metal-openshift-demo-host-resource-management.conf

systemctl show machine-gold.slice machine-silver.slice machine-bronze.slice \
  -p CPUAccounting -p CPUWeight

grep Cpus_allowed_list /proc/1/status

cat /proc/cmdline
```

Expected current behavior:

- manager `CPUAffinity` present
- tier slices present with expected weights
- PID 1 confined to `host_reserved`
- no `systemd.cpu_affinity=` or `irqaffinity=` boot args by default

Guest placement checks:

```bash
virsh dumpxml idm-01.workshop.lan | egrep 'partition|shares|iothreads'
virsh vcpupin idm-01.workshop.lan
virsh emulatorpin idm-01.workshop.lan
systemctl status machine-silver.slice
```

Expected current behavior:

- persistent XML contains the tier partition
- persistent XML contains the expected `shares`
- vCPU pinning lands in `guest_domain`
- emulator pinning lands in `host_emulator`

## Signals That The Model Needs Adjustment

Host reservation too small:

- `sshd` and Cockpit become sticky under modest admin activity
- OVS or libvirt daemons show persistent pressure on reserved CPUs
- emulator-thread contention appears during IO-heavy guest activity

Host reservation too large:

- guest pool is undersized relative to lab demand
- workers remain cramped even though host services stay quiet
- `%steal` rises while host-side reserved CPUs remain mostly idle

Tier weights need reevaluation:

- masters are still impacted during cluster churn
- infra services dominate at the expense of worker throughput
- Bronze never benefits from obvious idle capacity above it

## Related Documents

- <a href="./host-memory-oversubscription.md"><kbd>HOST MEMORY OVERSUBSCRIPTION</kbd></a>
- <a href="./automation-flow.md"><kbd>AUTOMATION FLOW</kbd></a>
- <a href="./orchestration-guide.md"><kbd>ORCHESTRATION GUIDE</kbd></a>
- <a href="./manual-process.md"><kbd>MANUAL PROCESS</kbd></a>
- `<project-root>/../the-story-so-far.md`
