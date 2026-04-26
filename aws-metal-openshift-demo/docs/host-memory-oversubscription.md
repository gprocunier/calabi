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
| zram.writeback | `enabled` | `false` | optional advanced override for a dedicated writeback device |
| zram.writeback | `manage_lvm` | `false` | create and manage a dedicated LV for writeback |
| zram.writeback | `volume_group` | `calabi_lab_vg` | VG used when `manage_lvm` is enabled |
| zram.writeback | `logical_volume` | `zram-writeback` | LV name used when `manage_lvm` is enabled |
| zram.writeback | `size` | `32G` | dedicated writeback LV size for the managed-LVM path |
| zram.writeback | `backing_device` | `""` | dedicated block device used only when writeback is enabled |
| zram.writeback.policy | `enabled` | `false` | run periodic writeback from a systemd timer |
| zram.writeback.policy | `interval` | `30m` | timer cadence for each writeback pass |
| zram.writeback.policy | `mode` | `incompressible` | conservative default writeback mode |
| zram.writeback.policy | `idle_age_seconds` | `21600` | age threshold only for `idle` or `huge_idle` modes |
| zram.writeback.policy | `per_run_budget_mib` | `256` | writeback budget applied before each timer run |
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
3. configure the compression algorithm
4. optionally attach a dedicated writeback backing device before initialization
5. set the zram disk size
6. format and activate: `mkswap`, `swapon --priority 100 --discard`

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

An optional advanced override can also attach a dedicated block device through
`/sys/block/zram0/backing_dev` before zram is initialized. This is disabled by
default and intended for hosts that deliberately repurpose a device for zram
writeback experimentation or cold-page pressure relief.

For on-prem hosts, the override can manage that device as a dedicated logical
volume in `calabi_lab_vg`. The shipped managed-LVM defaults use a `32G`
`zram-writeback` LV, which is a reasonable starting point for the current
~128 GiB host class because it adds a modest cold-page spill tier without
pretending to create planned RAM capacity.

Applicability:

- The zram writeback capability itself is **not** on-prem-only. The role can
  attach any dedicated block device when `manage_lvm: false` and
  `backing_device` is set explicitly.
- The managed-LVM convenience path is effectively on-prem-specific in this repo
  because it assumes the local `calabi_lab_vg` layout used by the on-prem
  deployment flow.
- The repo currently ships a ready-to-use on-prem example override for this
  capability. It does **not** ship an AWS-target override or AWS-specific
  backing-device provisioning for writeback.

> [!WARNING]
> Enabling a writeback backing device does not turn disk into planned memory
> capacity. It is an emergency pressure-relief tier and should not be counted
> in steady-state cluster sizing.

> [!NOTE]
> The current role only attaches the backing device when the override is
> enabled. Periodic writeback is a separate opt-in policy block and remains off
> by default.

> [!WARNING]
> The writeback backing device must be dedicated. Do not point the override at
> a mounted filesystem or an active swap device. The role explicitly fails if
> the configured device is already mounted or active as swap.

> [!WARNING]
> The managed-LVM path creates the writeback LV when requested, but it does
> **not** resize an existing writeback LV in place. If the LV already exists at
> a different size, the role fails fast rather than mutating storage
> automatically.

Example override shape:

```yaml
lab_host_memory_oversubscription_settings:
  zram:
    writeback:
      enabled: true
      manage_lvm: true
      volume_group: calabi_lab_vg
      logical_volume: zram-writeback
      size: 32G
      policy:
        enabled: true
        interval: 30m
        mode: incompressible
        per_run_budget_mib: 256
```

If you prefer to point at an already-provisioned block device instead, leave
`manage_lvm: false` and set `backing_device` directly.

The managed LV or explicit device must be dedicated to zram writeback. Do not
point the override at a mounted filesystem or an active swap device.

For the current on-prem deployment, the shipped example is:

- `on-prem-openshift-demo/inventory/overrides/core-services-ad-128g.yml.example`

## Periodic Writeback Policy

When `zram.writeback.policy.enabled` is true, the role installs:

- `calabi-zram-writeback-policy.service`
- `calabi-zram-writeback-policy.timer`

The timer triggers a small writeback pass at the configured interval. Before
each run, the helper script applies the configured per-run budget through
`writeback_limit` so the host does not dump an unlimited amount of data to the
backing device in one burst.

Recommended starting point for the current ~128 GiB host class:

- mode: `incompressible`
- interval: `30m`
- per-run budget: `256 MiB`

That mode is intentional. The current kernel on the on-prem host exposes zram
writeback support, but age-based idle tracking may not be available on every
target kernel. The role therefore only allows `idle` or `huge_idle` modes when
`CONFIG_ZRAM_TRACK_ENTRY_ACTIME=y` is present on the running kernel.

Treat this timer as pressure relief, not planned memory inventory.

Additional caveats:

- The timer only becomes useful after a backing device is attached. Enabling
  the policy block without a working writeback device is not a valid
  configuration.
- The current default mode, `incompressible`, is intentionally conservative.
  It avoids broad idle-page sweeps on kernels that lack age-based tracking.
- The timer applies a per-run `writeback_limit` budget to reduce the chance of
  sudden I/O bursts, but heavy writeback can still add latency to the backing
  storage tier under memory pressure.
- On hosts that still keep a separate physical swap device enabled, zram
  writeback does not remove that device from the reclaim path automatically.
  Disk-backed swap remains a separate policy decision.

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
cat /sys/block/zram0/backing_dev
systemctl is-enabled calabi-zram-writeback-policy.timer
systemctl is-active calabi-zram-writeback-policy.timer
cat /sys/block/zram0/bd_stat

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
- `backing_dev` matches the configured override when writeback is enabled
- the writeback timer is enabled and active when policy is enabled
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
