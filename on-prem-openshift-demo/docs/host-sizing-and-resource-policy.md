# Host Sizing And Resource Policy

Nearby docs:

<a href="./prerequisites.md"><kbd>&nbsp;&nbsp;PREREQUISITES&nbsp;&nbsp;</kbd></a>
<a href="./automation-flow.md"><kbd>&nbsp;&nbsp;AUTOMATION FLOW&nbsp;&nbsp;</kbd></a>
<a href="./manual-process.md"><kbd>&nbsp;&nbsp;MANUAL PROCESS&nbsp;&nbsp;</kbd></a>
<a href="./portability-and-gap-analysis.md"><kbd>&nbsp;&nbsp;PORTABILITY / GAPS&nbsp;&nbsp;</kbd></a>
<a href="./README.md"><kbd>&nbsp;&nbsp;ON-PREM DOCS MAP&nbsp;&nbsp;</kbd></a>

## Why This Matters

Use this page to decide whether your on-prem host is close enough to the
validated `m5.metal` baseline or whether you need to deliberately shrink the
lab profile.

The current Calabi host design was validated on AWS `m5.metal`:

- 2 sockets
- 24 physical cores per socket
- SMT enabled
- 96 logical CPUs total
- 384 GiB RAM

That hardware shape is large enough to support:

- a 9-node OpenShift cluster
- support guests
- Gold / Silver / Bronze performance domains
- host-side CPU reservation
- zram + KSM + THP for memory efficiency

The farther your on-prem host drifts from that shape, the more careful your
sizing and scheduling policy must become.

## Current Baseline Assumptions

### CPU

The current CPU policy is static, not auto-derived.

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

The current memory policy is also tuned for a large host.

Current baseline assumptions:

- host RAM: 384 GiB
- zram: 16 GiB
- THP: `madvise`
- KSM: enabled

The important point is that the current memory policy is an efficiency layer,
not a substitute for insufficient RAM.

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

This is the most obvious pressure case.

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

This is the easiest drift case.

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

AWS `m5.metal` plus EBS gave the project a very explicit disk model:

- one host root volume
- dedicated raw guest block devices
- stable `/dev/ebs/*` symlinks

For you as the operator, on-prem storage matters in three ways:

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

### 3. Rebuild hygiene

The project already assumes stale storage metadata can survive rebuilds.

That remains true on-prem, and often more so with local SSD/NVMe.

Important examples:

- support guest disks must be wiped on real rebuild boundaries
- ODF data disks may need explicit BlueStore label-position wipes

## Networking Considerations

Your on-prem host does not need AWS VPCs, but it does need an equivalent network
contract:

- management access to the hypervisor
- an uplink interface that OVS can build around
- VLAN-capable switching or equivalent trunking behavior
- consistent reachability for:
  - support VLANs
  - cluster VLANs
  - bastion management path

If your on-prem environment cannot supply the VLAN/trunk model cleanly, the
current network design will need more change than the current CPU or memory
policy.

## Practical On-Prem Sizing Guidance

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
