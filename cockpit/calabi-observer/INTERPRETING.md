# Interpreting Calabi Observer

This document explains what each panel reports, what the numbers mean, and
how to use them to make tuning decisions.

<a href="./README.md"><kbd>&nbsp;&nbsp;OBSERVER README&nbsp;&nbsp;</kbd></a>
<a href="../../aws-metal-openshift-demo/docs/host-resource-management.md"><kbd>&nbsp;&nbsp;RESOURCE MANAGEMENT&nbsp;&nbsp;</kbd></a>
<a href="../../aws-metal-openshift-demo/docs/host-memory-oversubscription.md"><kbd>&nbsp;&nbsp;HOST MEMORY&nbsp;&nbsp;</kbd></a>

## KSM Cost-Benefit

This is the panel you should look at first after a fresh lab deployment. It
answers: **is KSM saving more memory than it costs in CPU?**

### The Verdict Gauge

The horizontal gauge shows three zones:

| Zone | Color | Meaning |
| --- | --- | --- |
| EFFECTIVE | green | KSM is earning its keep |
| MARGINAL | amber | borderline -- savings are modest or CPU cost is creeping up |
| WASTE | red | KSM is spending more CPU than the memory it recovers is worth |

The verdict is computed from an efficiency ratio:

```
efficiency = memory_saved_GiB / ksmd_cpu_host_percent
```

- **EFFECTIVE**: savings > 5 GiB and CPU < 2%, or efficiency > 10
- **MARGINAL**: efficiency between 2 and 10, or savings < 2 GiB
- **WASTE**: efficiency < 2, or CPU > 5% with savings < 1 GiB

An **INACTIVE** verdict means ksmd is consuming no measurable CPU and reporting
no savings. This is normal before guests are started or if KSM is disabled.

### Key Metrics

**Memory saved** is `(pages_sharing + ksm_zero_pages) * page_size`. This is how
much RAM would be consumed if every shared page had its own physical frame.
`pages_sharing` counts content-identical pages merged into copy-on-write
references. `ksm_zero_pages` counts all-zero pages that KSM has collapsed
(requires `use_zero_pages=1` in the kernel).

**ksmd CPU** is the delta of cumulative CPU time consumed by the `ksmd` kernel
thread between poll intervals, expressed as both percent-of-one-core and
percent-of-host. On `m5.metal` with 96 logical CPUs, 1% of one core is roughly
0.01% of the host. The host percentage is what matters for capacity planning.

**Merge ratio** is `pages_sharing / pages_shared`. A ratio of 8:1 means each
unique shared page has 8 other pages referencing it. For 9 RHCOS guests
running the same base OS image, expect 6-10x once the scanner converges.

**Volatility** is the fraction of scanned pages that changed before KSM could
merge them. High volatility (> 30%) means the workload is churning memory
faster than the scanner can process it. This is normal during cluster
install, rolling updates, or etcd compaction. It should drop during steady
state.

**Scan throughput** is `pages_to_scan * (1000 / sleep_millisecs)`, the
theoretical maximum pages per second the scanner can examine. With the default
settings (1000 pages, 20ms sleep), this is 50,000 pages/second.

**Full scans** and **scans/min** show how quickly the scanner is cycling
through all of guest memory. A full scan rate below 1/min on a fully deployed
lab means the scanner is working through a large memory footprint. This is
normal during initial convergence.

### Sparklines

- **KSM Savings** (green): memory saved in GiB over the last 10 minutes. Should
  climb and stabilize after guest deployment.
- **ksmd CPU** (amber): host CPU percentage over the last 10 minutes. Should
  spike during initial scanning and then flatten to near-zero during steady
  state.

### Recommendations

The panel generates contextual text based on the current state:

- *"KSM is performing its initial scan"* -- first full scan hasn't completed.
  Wait before tuning.
- *"KSM is highly effective. No tuning needed."* -- savings > 10 GiB, CPU < 1%.
  Leave it alone.
- *"Consider: increase sleep_millisecs..."* -- CPU cost outweighs savings.
  Follow the recommendation.
- *"The workload may not benefit from KSM."* -- multiple full scans completed
  with minimal sharing. The guests may not have enough shared content, or the
  content is changing too fast.

### What Good Looks Like

On a fully deployed lab with 9 RHCOS guests and 3 support guests:

- Savings: 10-30 GiB (depends on guest OS convergence)
- ksmd CPU: < 0.05% of host during steady state
- Merge ratio: 6-10x
- Volatility: < 10% during steady state
- Verdict: EFFECTIVE

### When To Worry

- Verdict stays MARGINAL or WASTE after guests have been stable for 30+ minutes
- ksmd CPU stays above 1% of host during steady state
- Merge ratio stays below 2x after multiple full scans
- Savings stay below 1 GiB with a fully deployed lab

## CPU Performance Domains

This panel shows whether the Gold/Silver/Bronze tier model is distributing CPU
as intended.

### Host CPU Summary

The top line shows aggregate host CPU utilization and a sparkline. On
`m5.metal` with 96 logical CPUs, 10% host utilization means roughly 10 cores
are busy. This is the same metric you would see from `top` or `sar`.

### vCPU Oversubscription

Three metrics help you gauge CPU pressure:

**vCPU oversubscription ratio** is `total_guest_vCPUs / guest_domain_pCPUs`.
With the current default layout (106 vCPUs, 72 pCPUs), this is about 1.47:1.
The ratio is color-coded:

| Color | Range | Meaning |
| --- | --- | --- |
| green | <= 1.0 | no oversubscription -- every vCPU could run simultaneously |
| amber | 1.0 - 2.0 | moderate -- normal for a lab, contention is managed by tier weights |
| red | > 2.0 | aggressive -- watch for `%steal` and tier throttling |

**Total guest vCPUs** shows the aggregate and the guest domain pool size for
context.

**Host steal time** is the percentage of CPU time the hypervisor reported as
stolen from guest execution. On bare metal (not nested inside another
hypervisor), this should be 0%. On AWS metal instances it is occasionally
nonzero during host-level maintenance events but should not persist.

### Tier Stacked Bar

The horizontal bar shows how much of the host CPU each tier is consuming,
color-coded Gold/Silver/Bronze. The bar represents 100% of the host. During
steady state, expect Gold (masters) to be modest, Silver (infra) moderate, and
Bronze (workers) variable depending on workload.

### Tier Legend

Below the bar, each tier shows:

- **Weight**: the configured `CPUWeight` value (512/333/167)
- **Host %**: actual CPU consumption as a percentage of the host
- **Throttled badge**: appears when `nr_throttled` increments between samples

Throttling means a tier's processes were delayed because the tier exceeded its
proportional share while sibling tiers were competing. Occasional throttling
during bursts is normal. Sustained throttling on Gold indicates the masters are
being starved, which is a problem.

### Per-Domain Table

Each running VM shows:

| Column | Source |
| --- | --- |
| VM | domain name from libvirt |
| Tier | Gold/Silver/Bronze badge from libvirt partition |
| vCPU | configured vCPU count from domain XML |
| CPU (cores) | actual cores consumed (from cgroup `usage_usec` delta) |
| CPU % | same value as a percentage of one core |
| Trend | 10-minute sparkline |

**CPU (cores)** is the most useful column. A VM with 8 vCPUs consuming 2.5
cores is using about 31% of its allocated capacity. A VM consuming more cores
than its vCPU count means the emulator thread and IOThreads are adding overhead
beyond the vCPU execution.

### What Good Looks Like

- Gold tier (masters): low steady-state CPU (< 5 cores total for 3 masters),
  occasional spikes during API activity, no throttling
- Silver tier (infra + IdM): moderate CPU depending on ingress traffic and
  monitoring workload, occasional throttling during spikes is acceptable
- Bronze tier (workers): variable, depends entirely on scheduled workload
- No tier shows sustained throttling

### When To Worry

- Gold tier is throttled while Silver or Bronze are consuming significant CPU
- A single VM is consuming more CPU cores than its vCPU count by a wide margin
- Steal time persists above 1%

## CPU Pool Topology

This is the per-CPU heatmap. It shows all 96 logical CPUs organized by NUMA
node, with SMT thread pairs aligned vertically.

### Reading The Heatmap

Each cell represents one logical CPU. The color encodes two things:

1. **Hue** identifies the pool assignment:
   - Blue = Host Housekeeping (CPUs 0-1, 24-25, 48-49, 72-73)
   - Purple = Host Emulator (CPUs 2-5, 26-29, 50-53, 74-77)
   - Green = Guest Domain (CPUs 6-23, 30-47, 54-71, 78-95)

2. **Opacity** encodes utilization: dim = idle, bright = busy. A fully
   saturated cell means that CPU is near 100% utilized.

Cells at 80%+ utilization show their utilization number inside the cell.

Hover over any cell to see: CPU number, pool assignment, exact utilization
percentage, and current clock frequency.

### NUMA Topology

The heatmap is split into two blocks: NUMA Node 0 (Socket 0) and NUMA Node 1
(Socket 1). Each block has two rows:

- **T0**: primary threads (socket 0: CPUs 0-23, socket 1: CPUs 24-47)
- **T1**: SMT siblings (socket 0: CPUs 48-71, socket 1: CPUs 72-95)

The pool assignments are symmetric across sockets: each socket contributes 6
physical cores to host reserved and 18 to the guest domain.

### Per-Pool Frequency

Below each NUMA block, the average clock frequency per pool is shown. This is
useful for spotting frequency scaling issues. Under load, guest domain CPUs
should be running at or near maximum turbo frequency. Idle housekeeping CPUs
will typically show lower frequencies due to power management.

### What Good Looks Like

- Guest domain CPUs (green) show variable utilization, with brightness
  correlated to guest workload
- Host housekeeping CPUs (blue) are mostly dim -- busy only during admin
  activity
- Host emulator CPUs (purple) are mostly dim with brief spikes during guest
  disk I/O
- Utilization is reasonably balanced across both NUMA nodes

### When To Worry

- Host housekeeping CPUs are persistently bright -- the host control plane is
  under pressure, consider expanding the reserved pool
- Guest domain CPUs are uniformly saturated -- the guest pool may be
  undersized, or a workload is consuming more than expected
- One NUMA node is significantly hotter than the other -- possible NUMA
  affinity imbalance in guest placement

## Memory Overview

This panel shows the host memory picture and how much of it is committed to
guests.

### Overcommit Summary

The top line shows:

- **Total**: physical RAM on the host
- **Committed**: sum of all guest memory allocations (from `virsh dumpxml`)
- **Overcommit ratio**: committed / total. Color-coded:
  - Green (< 1.0): guests fit entirely in RAM
  - Amber (1.0-1.5): moderate overcommit, memory efficiency features are load-bearing
  - Red (> 1.5): aggressive overcommit, KSM and zram must deliver savings
- **Available**: free memory as reported by the kernel (includes reclaimable cache)

### Memory Waterfall Bar

A horizontal stacked bar breaking the host RAM into:

- **Used** (dark blue): anonymous pages and non-reclaimable kernel memory
- **Cached** (light blue): page cache and reclaimable slab
- **Available** (grey): memory the kernel considers allocatable without swapping

The bar represents MemTotal. The KSM and zram savings shown in the legend are
_virtual_ -- they represent memory that would be consumed without those
features but is not directly visible in the bar segments. Think of them as
explaining why Available is larger than it would otherwise be.

### Reclaim Gains

Four metrics quantify what the memory efficiency features are delivering:

- **KSM dedup**: bytes saved by page merging (same as the KSM panel)
- **KSM zero pages**: bytes saved by collapsing all-zero pages
- **Total reclaim**: KSM + zram savings combined
- **THP mode**: current Transparent Huge Pages setting (should show `madvise`)

### Per-Tier Memory Table

Shows each tier's committed memory, number of VMs, and percentage of host RAM.
This is the memory analog of the CPU tier bars -- it tells you where the memory
commitments are concentrated.

### What Good Looks Like

- Overcommit ratio between 0.8 and 1.3
- Available memory > 20 GiB on a 384 GiB host
- KSM dedup contributing 10-30 GiB
- THP mode is `madvise`
- Gold and Silver tiers have stable memory commitments

### When To Worry

- Available memory drops below 10 GiB persistently
- Overcommit ratio > 1.5 without substantial KSM savings
- Total reclaim is negligible -- the memory efficiency features are not
  compensating for the overcommit

## zram Cost-Benefit

This panel answers: **is zram providing useful memory pressure relief, or is it
adding overhead with poor compression?**

### The Verdict Gauge

Five zones, left to right:

| Zone | Color | Meaning |
| --- | --- | --- |
| THRASHING | red | high swap I/O rate -- the host is under severe memory pressure |
| POOR | dark amber | data is being swapped but compression ratio is bad (< 1.5:1) |
| MODERATE | amber | compression ratio is decent (1.5-2.5:1) |
| EFFECTIVE | green | good compression (> 2.5:1) with real savings |
| STANDBY | grey | zram device exists but no pages have been swapped into it |

**STANDBY is the expected verdict** during normal operation. It means the host
has enough free memory that the kernel never needs to push pages into swap.
This is the healthy state -- zram is configured and ready but not needed.

**EFFECTIVE** means the host entered memory pressure at some point and zram
absorbed it efficiently. Check whether the pressure is transient (burst during
cluster install or rolling update) or sustained.

**THRASHING** (swap I/O > 5000 pages/sec) means the kernel is actively
swapping pages in and out. This is a sign of sustained memory pressure that
zram alone cannot solve. Consider reducing guest memory commitments.

### Sparklines

- **zram Savings**: memory saved by compression over time. Should be near zero
  during STANDBY and climb only during pressure events.
- **Swap I/O**: combined page-in and page-out rate. Spikes are normal during
  transient pressure. Sustained high rates indicate a capacity problem.
- **Swap Utilization**: percentage of the zram device capacity in use.

### Metrics

**Compression ratio** is `data_bytes / mem_used_bytes`. How much RAM zram needs
to store the data that was swapped into it. With `zstd` on typical guest
memory:

- 3:1 or better is excellent (guest kernel pages compress well)
- 2:1 is good
- < 1.5:1 is poor (incompressible data, possibly encrypted pages)

**Algorithm / streams**: the compression algorithm (`zstd`) and parallelism
level (typically matches CPU count).

**Original data** vs **Compressed to** vs **RAM consumed**: the raw numbers
behind the compression ratio. Original data is the uncompressed size of
everything stored in zram. Compressed is the compressed payload. RAM consumed
includes compression metadata overhead.

**Same pages**: pages that were entirely duplicate content and stored without
compression (just a reference). Similar to KSM but at the zram level.

**kswapd CPU**: the CPU cost of the kernel reclaim thread that feeds pages into
swap. This is the zram analog of ksmd CPU in the KSM panel.

**Swap in/out rates**: pages per second being read from and written to swap.
A high out rate means the kernel is actively pushing pages into zram. A high
in rate means applications are faulting on pages that were previously swapped
out.

**kswapd scan rate**: pages per second being scanned by kswapd looking for
reclaim candidates. This is upstream of actual reclaim -- high scan rates with
low steal rates mean the kernel is having difficulty finding pages to reclaim.

**Direct reclaim**: pages per second reclaimed synchronously in the
application's allocation path. This is the expensive kind of reclaim -- the
application stalls until memory is freed. Any sustained direct reclaim rate
above zero indicates memory pressure that is directly impacting application
performance. This metric is highlighted in amber when nonzero.

### Capacity Bar

Shows the zram device capacity breakdown:

- **Compressed** (teal): actual RAM consumed by compressed data
- **Saved** (light teal): the difference between original data and compressed
  data
- **Free** (grey): unused device capacity

### Recommendations

Contextual text similar to the KSM panel:

- *"zram is configured and standing by"* -- STANDBY, no action needed
- *"Compression ratio is excellent"* -- EFFECTIVE with good ratio
- *"High swap I/O rate indicates significant memory pressure"* -- THRASHING,
  reduce guest memory or add RAM
- *"Direct reclaim is active"* -- applications are stalling on memory
  allocation

### What Good Looks Like

- Verdict: STANDBY during normal operation
- Compression ratio: 2.5:1 or better when pages are present
- Swap I/O: zero during steady state, brief spikes during transients
- Direct reclaim: zero

### When To Worry

- Verdict stays at THRASHING or POOR for more than a few minutes
- Direct reclaim is persistently nonzero
- Swap utilization climbs above 50% of device capacity and stays there
- kswapd CPU exceeds 0.5% of host during steady state

## Memory Management Overhead

This panel shows the CPU cost of the kernel threads responsible for memory
reclaim, page merging, and memory compaction.

### Threads Tracked

| Thread | Role |
| --- | --- |
| `ksmd` | KSM scanner -- finds and merges identical pages |
| `kswapd0` | NUMA node 0 background reclaim (feeds pages to swap) |
| `kswapd1` | NUMA node 1 background reclaim |
| `kcompactd0` | NUMA node 0 memory compaction (defragments physical memory for huge pages) |
| `kcompactd1` | NUMA node 1 memory compaction |

### Reading The Summary

The top line shows each thread's CPU as a percentage of one core, plus the
combined total as both core-percent and host-percent. For example:

```
ksmd: 0.12%  kswapd0: 0.01%  kswapd1: 0.00%  kcompactd0: 0.00%  kcompactd1: 0.00%
total: 0.13% core (0.00% host)
```

This means the five threads combined are consuming 0.13% of one core, which is
negligible on a 96-core host.

### Sparklines

Each thread has its own 10-minute sparkline. The shape tells you whether
overhead is steady, bursty, or trending upward.

### What Good Looks Like

- ksmd: < 0.5% core during steady state, spikes during guest deployments
- kswapd0/1: near zero unless memory pressure is present
- kcompactd0/1: near zero (with THP in `madvise` mode, compaction is rare)
- Total: < 1% core, essentially invisible at the host level

### When To Worry

- ksmd stays above 2% core during steady state -- consider reducing
  `pages_to_scan` or increasing `sleep_millisecs`
- kswapd shows sustained activity -- the host is under memory pressure, check
  the Memory Overview and zram panels
- kcompactd shows sustained activity -- THP compaction is running, which is
  unusual with `madvise` mode. Check if a guest is requesting huge pages
  aggressively
- Total overhead exceeds 5% core -- the memory management subsystem is
  consuming meaningful CPU that could be serving guests

## Cross-Panel Correlation

The panels are designed to be read together. Here are common patterns:

### Healthy Steady State

- KSM: EFFECTIVE, 15+ GiB saved, near-zero CPU
- CPU: low utilization, no throttling, Gold tier idle
- Memory: overcommit ratio ~1.2, plenty of available memory
- zram: STANDBY
- Overhead: all threads near zero

### Post-Deployment Convergence

- KSM: climbing savings, elevated ksmd CPU (0.5-2% core), first-scan-pending
  or low full scan count
- CPU: elevated as guests are booting and pulling images
- Memory: available memory dropping as guests consume their allocations
- zram: may briefly enter MODERATE as transient pressure occurs
- Overhead: ksmd elevated, others near zero

**Action**: wait. KSM needs time to build its scan tree. Savings will appear
after the first full scan completes.

### Memory Pressure Event

- KSM: savings may increase (good) or decrease (pages being unshared)
- CPU: may show elevated utilization and throttling
- Memory: available memory low, overcommit ratio climbing
- zram: MODERATE or EFFECTIVE, swap I/O increasing
- Overhead: kswapd active, possibly kcompactd

**Action**: check which guests or tiers are driving the pressure. The CPU
panel's per-domain table shows who is consuming the most. The Memory panel's
per-tier table shows where memory is committed. Consider reducing worker count
or size (Bronze is the elastic tier).

### Over-Tuned KSM

- KSM: MARGINAL or WASTE, CPU cost visible but savings modest
- CPU: ksmd visible in overhead panel
- Memory: overcommit ratio low, plenty of available memory
- zram: STANDBY

**Action**: if the host has plenty of free memory and KSM isn't finding much
to merge, consider increasing `sleep_millisecs` to reduce scan frequency. KSM
is most valuable when memory is tight; on an undercommitted host it is doing
work for minimal benefit.
