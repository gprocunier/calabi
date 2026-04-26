# Host Sizing And Resource Policy

> [!WARNING]
> This on-prem target is experimental. Treat the docs and playbooks in this
> subtree as an emerging alternate installation path, not yet the same
> confidence level as the validated AWS-target flow.

Nearby docs:

<a href="./prerequisites.md"><kbd>&nbsp;&nbsp;PREREQUISITES&nbsp;&nbsp;</kbd></a>
<a href="./automation-flow.md"><kbd>&nbsp;&nbsp;AUTOMATION FLOW&nbsp;&nbsp;</kbd></a>
<a href="./manual-process.md"><kbd>&nbsp;&nbsp;MANUAL PROCESS&nbsp;&nbsp;</kbd></a>
<a href="./override-mechanism.md"><kbd>&nbsp;&nbsp;OVERRIDES&nbsp;&nbsp;</kbd></a>
<a href="./portability-and-gap-analysis.md"><kbd>&nbsp;&nbsp;PORTABILITY / GAPS&nbsp;&nbsp;</kbd></a>
<a href="./README.md"><kbd>&nbsp;&nbsp;ON-PREM DOCS MAP&nbsp;&nbsp;</kbd></a>

## Scope

Use this guidance to decide whether your on-prem host is close enough to the
validated `m5.metal` baseline or whether you need to shrink the lab profile.

The current Calabi host design was validated on AWS `m5.metal`:

- 2 sockets
- 24 physical cores per socket
- SMT enabled
- 96 logical CPUs total
- 384 GiB RAM

That baseline is large enough to support:

- a 9-node OpenShift cluster
- support guests
- Gold / Silver / Bronze performance domains
- host-side CPU reservation
- zram + KSM + THP for memory efficiency

The farther your host drifts from that shape, the more deliberate your sizing
and scheduling decisions need to be.

## Current Baseline Assumptions

### CPU

The current CPU policy is static.

The source of truth today is:

- `aws-metal-openshift-demo/vars/global/host_resource_management.yml`

Current baseline split:

- `host_reserved`: 12 physical cores / 24 logical CPUs
- `guest_domain`: 36 physical cores / 72 logical CPUs

Inside `host_reserved`, the policy further splits:

- `host_housekeeping`: 4 physical cores
- `host_emulator`: 8 physical cores

The design assumes:

- symmetric allocation across sockets
- whole SMT core pairs, not isolated sibling threads
- enough spare host CPU for OVS, libvirt, emulator threads, and admin work

### Memory

The current memory policy is tuned for a large host:

- host RAM: 384 GiB
- zram: 16 GiB
- THP: `madvise`
- KSM: enabled

Treat that memory policy as an efficiency layer, not a substitute for missing
RAM.

### Guest shape

The validated cluster and support footprint is still substantial:

- 3 masters
- 3 infra
- 3 workers
- IdM
- bastion
- mirror registry
- optional AD

That means an on-prem host with “almost `m5.metal`” specs may still behave
very differently if:

- RAM is materially lower
- the CPU topology is less favorable
- storage latency is worse
- SMT is disabled
- NUMA layout is asymmetric

## CPU Considerations As Hardware Drifts From `m5.metal`

### If the host has fewer cores

You cannot safely carry the current static CPU pool values onto a smaller host.

You must recalculate:

- `host_reserved`
- `host_housekeeping`
- `host_emulator`
- `guest_domain`

What must remain true:

- preserve full SMT core pairs
- keep the split symmetric across sockets when possible
- leave enough host CPU for:
  - OVS and networking
  - libvirt/QEMU management
  - emulator threads
  - admin access under load

What should give way first on a smaller host:

- worker vCPU count
- infra vCPU count
- optional guests
- day-2 workload ambition

What should not be the first compromise:

- host housekeeping reserve
- emulator-thread reserve

If the host becomes host-starved, the whole lab becomes unstable even if the
guest definitions still fit on paper.

### If the host has the same core count but different topology

Examples:

- different socket count
- different SMT layout
- disabled SMT
- non-regular CPU numbering

Then the current static pool strings are wrong even if total CPU count is
similar.

You must recalculate the on-prem host policy from:

- socket layout
- cores per socket
- threads per core
- NUMA arrangement
- actual CPU numbering

The current docs and vars assume regular numbering and two sockets. A host that
breaks that assumption needs a fresh pool design, not a copied config.

### If the host has more cores than `m5.metal`

You can usually:

- preserve the current guest sizing
- widen `host_reserved` modestly if needed
- give more headroom to `guest_domain`

The risk on larger hosts is not lack of capacity. It is forgetting to revisit
the policy and leaving easy performance headroom unused.

## Memory Considerations As Hardware Drifts From `m5.metal`

### The current oversubscription policy is conservative

Current settings:

- zram `16G`
- THP `madvise`
- KSM enabled

That is a sensible efficiency layer on a 384 GiB host. It is not aggressive
memory overcommit.

### If the host has less RAM

Do not treat zram or KSM as a replacement for missing physical memory.

On smaller hosts, the right order of operations is:

1. reduce guest memory footprint
2. reduce optional workload footprint
3. decide whether the cluster shape itself must shrink
4. only then consider pushing oversubscription harder

Specific warning areas:

- infra nodes are memory-heavy once ingress, monitoring, registry, ODF, and
  later day-2 services converge
- ODF is especially unforgiving on undersized memory
- AAP, Keycloak, and additional operators add real pressure late in the run

### If the host has more RAM

You may not need to change the oversubscription settings at all.

The current policy remains safe because:

- THP `madvise` is conservative
- KSM only helps when memory pages are actually mergeable
- 16 GiB zram is not excessive on a large host

Larger hosts primarily buy margin, not a different memory policy.

## Storage Considerations

AWS `m5.metal` plus EBS gave the project an explicit disk model:

- one host root volume
- dedicated raw guest block devices
- stable `/dev/ebs/*` symlinks
- explicit per-volume `gp3` performance intent:
  - size
  - IOPS
  - throughput

For on-prem, storage matters in four ways:

### 1. Deterministic naming

The current lab expects stable raw device paths for guests.

If local storage enumeration is unstable, you need:

- custom udev rules
- WWN-based symlinks
- by-id or by-path mapping
- or an equivalent deterministic device-inventory layer

### 2. Isolation

Guest root and ODF data disks should remain separate logical devices.

The shipped on-prem target now assumes:

- one operator-provided LVM volume group
- one logical volume per guest disk
- compatibility symlinks published under `/dev/ebs/*`

Do not collapse this onto one large shared filesystem if the goal is to keep
the current libvirt/raw-disk behavior intact.

### 3. Aggregate performance

This is the biggest difference from AWS. Today, the repo preserves:

- guest disk capacity
- stable guest disk identity
- one LV per expected guest disk

Today, the repo does **not** preserve:

- per-disk `gp3` IOPS guarantees
- per-disk `gp3` throughput guarantees
- guest-specific storage QoS through libvirt `iotune`

That means you should treat the AWS `gp3` fields in the stock volume inventory
as workload-class hints, not as behavior the on-prem target currently enforces.

Your real on-prem storage contract today is:

- enough aggregate read and write performance for the full guest set
- enough queue depth and latency headroom for concurrent boot and install work
- no obvious starvation when mirror-registry, control-plane nodes, infra nodes,
  and day-2 operators are all active

Practical guidance:

- prefer local NVMe or high-quality SSD-backed storage
- avoid slow shared spinning media
- be cautious with oversubscribed SAN tiers unless you already trust them under
  virtualization-heavy mixed workloads
- treat ODF data disks as real storage consumers, not as decorative placeholders

Think in terms of an aggregate backend ceiling, not per-LV guarantees. The
current on-prem target assumes a backend that is fast enough for the whole lab
rather than one that enforces precise per-guest caps.

### 4. Rebuild hygiene

The project already assumes stale storage metadata can survive rebuilds.

That remains true on-prem, and often more so with local SSD/NVMe.

Important examples:

- support guest disks must be wiped on real rebuild boundaries
- ODF data disks may need explicit BlueStore label-position wipes

### Future performance isolation

If you later find that one guest class can starve the rest, the next place to
look is not LVM itself. It is per-guest presentation and throttling through
libvirt or the underlying host I/O controller.

Likely future directions:

- libvirt `iotune`
- per-tier guest storage weighting
- host-side cgroup I/O policy

Do that only after you have evidence that the backend is fast enough in
aggregate but still needs guest-to-guest isolation.

## Networking Considerations

Your on-prem host does not need AWS VPCs, but it does need an equivalent
network contract:

- management access to the hypervisor
- an uplink interface that OVS can build around
- VLAN-capable switching or equivalent trunking behavior
- consistent reachability for:
  - support VLANs
  - cluster VLANs
  - bastion management path

If your environment cannot supply the VLAN/trunk model cleanly, the current
network design will need more change than the CPU or memory policy.

## Practical On-Prem Sizing Guidance

### Current external-Ceph cluster profile

The current on-prem external-Ceph profile is intentionally smaller than the
full AWS 9-node OpenShift topology but still runs a meaningful day-2 stack:

- 3 control-plane nodes at `16384` MiB each
- 3 worker nodes at `32768` MiB each
- external ODF instead of internal infra-node ODF
- AAP, Keycloak, Web Terminal, NetObserv, and validation enabled
- OpenShift Virtualization and Pipelines disabled

The worker memory target is based on Kubernetes requested-memory scheduling.
Do not reduce it just because the hypervisor shows low pressure from KSM or
zram. Those host-side mechanisms can reduce physical pressure, but they do not
change OpenShift node allocatable memory or pod requests.

### “Near `m5.metal`” host

If your host is genuinely close to:

- 48 physical cores
- 384 GiB RAM
- fast local or SAN-backed block storage

then the current lab shape is realistic with limited adaptation.

Main work:

- recompute CPU pool strings for the actual topology
- preserve deterministic guest disk naming
- validate storage latency and rebuild hygiene

### Moderately smaller host

If your host is materially smaller than `m5.metal`, the safest changes are:

- reduce worker vCPU first
- reduce infra vCPU second
- disable optional guests and late day-2 services before cutting into control
  plane safety
- keep the host reserve generous enough that OVS/libvirt/admin paths do not
  become the bottleneck

### Much smaller host

At some point the answer is no longer “port Calabi unchanged.”

At that point you are really defining a smaller lab profile:

- fewer guests
- smaller cluster
- weaker day-2 baseline
- probably no ODF

That would be a different target, not just an alternate substrate.

## Recommended Rules For On-Prem Adoption

1. Recalculate CPU pools from the actual topology. Never copy the current pool
   strings blindly.
2. Preserve whole SMT pairs and per-socket symmetry where possible.
3. Keep host housekeeping and emulator reserves healthy; do not steal from them
   first.
4. Treat zram/KSM/THP as efficiency tools, not as a substitute for missing RAM.
5. Maintain deterministic raw-disk naming before trying to reuse the current
   guest definitions.
6. Shrink guest footprints before making the host policy more aggressive.

## Bottom Line

If an on-prem host is truly close to `m5.metal`, Calabi should port more as a
host-contract problem than as an OpenShift-orchestration problem.

If it is materially smaller or topologically different, the resource policy
must be redesigned first. The current static CPU pool model and the current
memory assumptions are safe only because the validated baseline had enough host
headroom to make them safe.
