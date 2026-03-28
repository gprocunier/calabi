# Host Memory Oversubscription

Nearby docs:

<a href="./host-resource-management.md"><kbd>&nbsp;&nbsp;RESOURCE MANAGEMENT&nbsp;&nbsp;</kbd></a>
<a href="./manual-process.md"><kbd>&nbsp;&nbsp;MANUAL PROCESS&nbsp;&nbsp;</kbd></a>
<a href="./network-topology.md"><kbd>&nbsp;&nbsp;NETWORK TOPOLOGY&nbsp;&nbsp;</kbd></a>
<a href="./orchestration-guide.md"><kbd>&nbsp;&nbsp;ORCHESTRATION GUIDE&nbsp;&nbsp;</kbd></a>
<a href="./README.md"><kbd>&nbsp;&nbsp;DOCS MAP&nbsp;&nbsp;</kbd></a>

`playbooks/bootstrap/site.yml` applies a dedicated
`lab_host_memory_oversubscription` role immediately after
`lab_host_resource_management`.

That split is intentional:

- `lab_host_resource_management` defines the CPU pools and Gold/Silver/Bronze
  placement model
- `lab_host_memory_oversubscription` improves host RAM efficiency through three
  independent kernel mechanisms: zram compressed swap, Transparent Huge Pages,
  and Kernel Same-page Merging

This is not treated as fake RAM or as an excuse to reduce master or infra
sizing. The goal is to reclaim duplicate and cold guest memory on a host that
already showed low steady-state memory utilization with a fully deployed lab.

> [!WARNING]
> KSM and zram are host-kernel work, not Gold/Silver/Bronze work. The tiers
> still separate guest contention, but reclaim and compression can still steal
> CPU from the broader host pool unless you add more host-thread affinity
> controls later.

## Source Of Truth

The orchestration source of truth for memory policy is
`vars/global/host_memory_oversubscription.yml`.

Current defaults:

| Subsystem | Setting | Value | Purpose |
| --- | --- | --- | --- |
| zram | `enabled` | `true` | activate compressed swap device |
| zram | `device_name` | `zram0` | kernel device node |
| zram | `size` | `16G` | maximum uncompressed capacity of the device |
| zram | `compression_algorithm` | `zstd` | best ratio-to-speed tradeoff on modern kernels |
| zram | `swap_priority` | `100` | ensures zram is preferred over any physical swap |
| THP | `mode` | `madvise` | application-controlled huge page allocation |
| THP | `defrag_mode` | `madvise` | application-controlled compaction |
| KSM | `run` | `1` | scanner active |
| KSM | `pages_to_scan` | `1000` | pages examined per scan cycle |
| KSM | `sleep_millisecs` | `20` | pause between scan cycles |

The role defaults in `roles/lab_host_memory_oversubscription/defaults/main.yml`
set everything to disabled. The global vars file overrides those defaults to
enable the policy. This ensures that the role is always safe to include
and only activates when explicitly configured.

## How The Policy Is Applied

A single systemd oneshot service,
`calabi-host-memory-oversubscription.service`, applies all three subsystems at
boot. It uses `RemainAfterExit=yes` so systemd tracks the policy as active
for the lifetime of the host.

The service lifecycle for zram:

1. tear down any existing zram device (`swapoff`, `zramctl --reset`, `modprobe -r`)
2. load the zram module with `num_devices=1`
3. configure the device: `zramctl /dev/zram0 --algorithm zstd --size 16G`
4. format and activate: `mkswap`, `swapon --priority 100 --discard`

THP and KSM are applied in a follow-on `ExecStart` that writes directly to
`/sys/kernel/mm/transparent_hugepage/` and `/sys/kernel/mm/ksm/`.

A separate dedicated playbook, `playbooks/bootstrap/host-memory-oversubscription.yml`,
can apply or re-apply the memory policy independently without re-running the
full bootstrap sequence. This is the intended entry point for the Calabi Manager
"Host Memory Oversubscription" change scope.

## zram Compressed Swap

zram creates an in-memory block device that stores pages in compressed form. On
write, the kernel compresses the page into zram; on read, it decompresses on the
fly. The net effect is that cold anonymous pages that would otherwise consume
full-size RAM frames are stored at a fraction of their original size.

The `16G` size is the maximum uncompressed capacity of the device, not a
reservation. zram only consumes real RAM as pages are written into it. With
`zstd` compression the typical effective ratio on guest workloads is between
2:1 and 4:1, so 16G of logical swap capacity might cost 4-8G of physical RAM
when fully utilized.

> [!IMPORTANT]
> `16G` is a buffer, not a carved-out capacity loss. The host pays the
> physical cost only when memory pressure actually drives pages into swap.
> At steady state with low contention, zram consumes negligible real memory.

The swap priority of `100` ensures zram is always preferred over any physical
swap device. The `--discard` flag enables TRIM so that freed pages are
immediately released back to the host rather than lingering as stale compressed
blocks.

## Transparent Huge Pages

THP allows the kernel to back anonymous memory with 2 MiB pages instead of
the default 4 KiB pages. Fewer page-table entries means lower TLB miss rates
and measurable throughput improvement for memory-intensive workloads.

The policy sets THP to `madvise`, not `always`:

- `madvise` means the kernel only allocates huge pages when the application
  explicitly requests them via `madvise(MADV_HUGEPAGE)`. QEMU and the JVM both
  do this when configured to.
- `always` would apply huge pages to every anonymous mapping. That can trigger
  aggressive background compaction and allocation stalls that are worse than
  the TLB improvement.

The defrag mode is also set to `madvise` for the same reason: compaction
only runs when an application has signaled that it wants huge pages. This
avoids the pathological case where `khugepaged` burns CPU compacting memory
that no process actually benefits from.

> [!NOTE]
> For this workload, `madvise` is the conservative and correct default. The
> guest kernels inside each VM make their own independent THP decisions. The
> host-level setting controls the outer hypervisor kernel behavior only.

## Kernel Same-page Merging

KSM is a kernel thread (`ksmd`) that scans anonymous pages across all processes
looking for byte-identical content. When it finds duplicates, it merges them
into a single copy-on-write page, freeing the redundant frames.

This is especially effective in a nested virtualization environment where
multiple guests run identical operating system images. The RHEL CoreOS nodes
(`ocp-master`, `ocp-infra`, `ocp-worker`) share a large fraction of their
kernel and base-OS memory footprint. KSM finds and deduplicates those pages
without any guest-side configuration.

Current scan settings:

- `pages_to_scan = 1000`: examine 1000 pages per scan cycle
- `sleep_millisecs = 20`: pause 20 ms between cycles

These are deliberately conservative. Aggressive settings (higher page count,
shorter sleep) merge faster but consume more host CPU. The current values
prioritize low steady-state CPU overhead over fast initial convergence.

KSM convergence behavior:

- **First scan pass**: slow. The scanner must build its internal red-black tree
  of page checksums across all guest memory. On a fully deployed lab this can
  take minutes to hours depending on total guest memory.
- **Steady state**: cheap. Once the initial tree is built, incremental scans
  only process new or changed pages. CPU cost drops to near zero when guest
  memory is stable.
- **After guest reboot or migration**: the scanner re-examines changed pages.
  A full cluster reboot temporarily increases KSM CPU usage until the new
  steady state is reached.

> [!NOTE]
> The policy is most valuable in low-to-medium contention: it gives the kernel
> a cheaper way to reclaim duplicate memory before direct reclaim gets
> expensive. It is not meant to rescue sustained high contention.

## Why Bronze Is The Elastic Tier

The Bronze domain is already the least latency-sensitive part of the guest
estate:

- `ocp-worker-01..03`
- `bastion-01`
- `mirror-registry`
- `ad-01`

That makes Bronze the correct place to absorb most elasticity pressure before
touching masters or infra. The intended sizing policy is:

- keep masters stable
- keep infra stable
- use workers as the first expansion or contraction lever

## CPU Placement Caveat

KSM and reclaim activity are host/kernel work, not guest-tier work.

So while Gold/Silver/Bronze still model guest-vs-guest contention, enabling
`zram`, KSM, and THP does not automatically pin those host-kernel threads into
one guest tier. The current role improves memory efficiency without claiming
that all reclaim and merge work is strictly isolated inside `host_reserved`.

## Operational Validation

After bootstrap, validate the memory policy from the host:

```bash
# Service state
systemctl is-enabled calabi-host-memory-oversubscription.service
systemctl is-active calabi-host-memory-oversubscription.service

# zram device
zramctl
swapon --show

# THP mode
cat /sys/kernel/mm/transparent_hugepage/enabled
cat /sys/kernel/mm/transparent_hugepage/defrag

# KSM state
cat /sys/kernel/mm/ksm/run
cat /sys/kernel/mm/ksm/pages_to_scan
cat /sys/kernel/mm/ksm/sleep_millisecs

# KSM effectiveness
cat /sys/kernel/mm/ksm/pages_shared
cat /sys/kernel/mm/ksm/pages_sharing
cat /sys/kernel/mm/ksm/pages_unshared
```

Expected current behavior:

- service is enabled and active
- `zramctl` shows `/dev/zram0` with `zstd` algorithm and `16G` disk size
- `swapon` shows `/dev/zram0` at priority `100`
- THP enabled shows `[madvise]` (bracketed = active selection)
- THP defrag shows `[madvise]`
- KSM `run` is `1`
- `pages_shared` and `pages_sharing` grow over time as guests stabilize

The project includes a monitoring script for continuous observation:

```bash
scripts/host-memory-overcommit-status.py --host <virt-01-ip> --user ec2-user
```

This queries zram usage, KSM deduplication savings, per-guest memory
allocation, and tier-level totals. Use `--watch 30` for a live refresh or
`--delta 60` to capture a before-and-after snapshot across an interval.

## Signals That Memory Policy Needs Adjustment

zram under-sized:

- `zramctl` shows the device near its configured size limit
- swap utilization stays persistently high with poor compression ratio
- consider increasing `size` or investigating which guest is driving pressure

zram over-sized:

- the device rarely holds more than a few hundred MiB
- the host never enters memory pressure
- not harmful, but the 16G buffer is idle weight in the config

KSM scan rate too conservative:

- `pages_unshared` remains high relative to `pages_sharing` for extended
  periods after guest deployment
- initial convergence takes unreasonably long
- consider increasing `pages_to_scan` to `2000-4000` and observing CPU impact

KSM scan rate too aggressive:

- `ksmd` appears in `top` consuming visible CPU during steady state
- host-side CPU pressure appears on the reserved pool
- reduce `pages_to_scan` or increase `sleep_millisecs`

THP causing compaction pressure:

- `khugepaged` or `kcompactd` consuming persistent CPU
- this is unlikely with `madvise` mode but can appear if guest kernels
  aggressively request huge pages via virtio-balloon or similar
- switching to `never` is a safe fallback that disables THP entirely

## Related Documents

- <a href="./host-resource-management.md"><kbd>RESOURCE MANAGEMENT</kbd></a>
- <a href="./manual-process.md"><kbd>MANUAL PROCESS</kbd></a>
- <a href="./orchestration-guide.md"><kbd>ORCHESTRATION GUIDE</kbd></a>
