#!/usr/bin/env python3
"""
collector.py — Calabi Observer metrics collector.

Runs as root inside calabi-exporter.service. It also remains
CLI-callable for diagnostics. Emits a single JSON blob with host memory, KSM,
zram, cgroup, kernel-thread CPU, and optionally per-domain libvirt data.

Trust model:
    This script runs as root inside the direct exporter service.
    It is strictly read-only: it reads /proc, /sys, cgroup v2 trees,
    and runs virsh queries in full mode.  It writes nothing to disk, creates no temp
    files, and modifies no system state.  The only accepted flag is
    --fast; all other arguments are rejected.

Usage:
    python3 collector.py          # full collection (includes virsh)
    python3 collector.py --fast   # skip virsh, sysfs/procfs/cgroups only
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def read_text(path: str) -> str | None:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read().strip()
    except (FileNotFoundError, PermissionError):
        return None


def read_int(path: str) -> int | None:
    value = read_text(path)
    if value is None or value == "":
        return None
    return int(value)


def run(*argv: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        list(argv), check=check, capture_output=True, text=True,
    )


def systemctl_show(unit: str, properties: list[str]) -> dict[str, str]:
    proc = run(
        "systemctl",
        "show",
        unit,
        "--no-pager",
        "--property",
        ",".join(properties),
        check=False,
    )
    if proc.returncode != 0:
        return {
            "LoadState": "not-found",
            "ActiveState": "inactive",
            "SubState": "not-found",
            "UnitFileState": "not-found",
        }
    result: dict[str, str] = {}
    for line in proc.stdout.splitlines():
        key, sep, value = line.partition("=")
        if sep:
            result[key] = value
    return result


@dataclass
class CollectorCache:
    cpu_topology: dict | None = None
    kernel_thread_pids: dict[str, int] = field(default_factory=dict)
    domains: list[dict] = field(default_factory=list)


_DEFAULT_CACHE = CollectorCache()


# ---------------------------------------------------------------------------
# /proc/meminfo
# ---------------------------------------------------------------------------

MEMINFO_KEYS = {
    "MemTotal", "MemFree", "MemAvailable", "Buffers", "Cached",
    "SwapCached", "AnonPages", "Shmem", "KReclaimable", "Slab",
    "PageTables", "KernelStack", "Active", "Inactive",
}


def parse_meminfo() -> dict[str, int]:
    result: dict[str, int] = {}
    with open("/proc/meminfo", "r", encoding="utf-8") as fh:
        for line in fh:
            key, _, rest = line.partition(":")
            if key in MEMINFO_KEYS:
                result[key] = int(rest.strip().split()[0]) * 1024
    return result


# ---------------------------------------------------------------------------
# KSM  (/sys/kernel/mm/ksm/*)
# ---------------------------------------------------------------------------

KSM_KEYS = [
    "run", "pages_shared", "pages_sharing", "pages_unshared",
    "pages_volatile", "full_scans", "pages_to_scan", "sleep_millisecs",
    "stable_node_chains", "stable_node_dups", "ksm_zero_pages",
    "use_zero_pages",
]


def parse_ksm() -> dict:
    base = "/sys/kernel/mm/ksm"
    result: dict = {}
    for key in KSM_KEYS:
        result[key] = read_int(os.path.join(base, key))
    page_size = os.sysconf("SC_PAGE_SIZE")
    sharing = result.get("pages_sharing") or 0
    zero = result.get("ksm_zero_pages") or 0
    result["page_size"] = page_size
    result["estimated_saved_bytes"] = (sharing + zero) * page_size
    return result


def classify_ksm_progress(ksm: dict) -> tuple[str, str]:
    run_val = int(ksm.get("run") or 0)
    full_scans = int(ksm.get("full_scans") or 0)
    pages_shared = int(ksm.get("pages_shared") or 0)
    pages_sharing = int(ksm.get("pages_sharing") or 0)
    pages_volatile = int(ksm.get("pages_volatile") or 0)
    pages_unshared = int(ksm.get("pages_unshared") or 0)

    if run_val <= 0:
        return "disabled", "KSM is not running"
    if full_scans <= 0:
        return "first-scan-pending", "KSM has not completed a full scan yet"
    if pages_sharing > 0 or pages_shared > 0:
        return "deduping", "KSM is actively merging identical pages"
    if pages_volatile > 0 or pages_unshared > 0:
        return "scanning-no-savings-yet", "KSM scanning but workload too volatile to merge"
    return "scanning-idle", "KSM completed scans, no dedup savings currently"


# ---------------------------------------------------------------------------
# THP
# ---------------------------------------------------------------------------

def parse_thp() -> dict:
    enabled = read_text("/sys/kernel/mm/transparent_hugepage/enabled") or ""
    defrag = read_text("/sys/kernel/mm/transparent_hugepage/defrag") or ""
    # Extract the active mode from bracketed output like "[madvise]"
    active_enabled = ""
    for token in enabled.split():
        if token.startswith("[") and token.endswith("]"):
            active_enabled = token[1:-1]
    active_defrag = ""
    for token in defrag.split():
        if token.startswith("[") and token.endswith("]"):
            active_defrag = token[1:-1]
    return {
        "enabled_raw": enabled,
        "defrag_raw": defrag,
        "enabled": active_enabled,
        "defrag": active_defrag,
    }


# ---------------------------------------------------------------------------
# zram
# ---------------------------------------------------------------------------

def active_bracketed_value(raw: str) -> str:
    for token in raw.split():
        if token.startswith("[") and token.endswith("]"):
            return token[1:-1]
    return raw.split()[0] if raw.split() else ""


def parse_zram() -> list[dict]:
    result: list[dict] = []
    for sysfs_path in sorted(glob.glob("/sys/block/zram*")):
        device = os.path.basename(sysfs_path)
        name = f"/dev/{device}"

        disksize = read_int(f"{sysfs_path}/disksize") or 0
        algorithm = active_bracketed_value(read_text(f"{sysfs_path}/comp_algorithm") or "")
        streams = read_int(f"{sysfs_path}/max_comp_streams") or 0

        mm_stat = read_text(f"{sysfs_path}/mm_stat")
        mm_parts = mm_stat.split() if mm_stat else []
        data_bytes = int(mm_parts[0]) if len(mm_parts) >= 1 else 0
        compressed_bytes = int(mm_parts[1]) if len(mm_parts) >= 2 else 0
        mem_used_bytes = int(mm_parts[2]) if len(mm_parts) >= 3 else 0

        entry: dict = {
            "name": name,
            "disksize_bytes": disksize,
            "data_bytes": data_bytes,
            "compressed_bytes": compressed_bytes,
            "total_bytes": mem_used_bytes,
            "mem_used_bytes": mem_used_bytes,
            "algorithm": algorithm,
            "streams": streams,
            "estimated_saved_bytes": max(data_bytes - mem_used_bytes, 0),
        }

        # mm_stat: orig_data compr_data mem_used mem_limit max_used
        #          same_pages pages_compacted huge_pages huge_pages_since
        if len(mm_parts) >= 9:
            entry["mm_stat"] = {
                "orig_data_size": int(mm_parts[0]),
                "compr_data_size": int(mm_parts[1]),
                "mem_used_total": int(mm_parts[2]),
                "mem_limit": int(mm_parts[3]),
                "max_used_memory": int(mm_parts[4]),
                "same_pages": int(mm_parts[5]),
                "pages_compacted": int(mm_parts[6]),
                "huge_pages": int(mm_parts[7]),
                "huge_pages_since": int(mm_parts[8]),
            }

        # io_stat: failed_reads failed_writes invalid_io notify_free
        io_stat = read_text(f"{sysfs_path}/io_stat")
        if io_stat:
            io_parts = io_stat.split()
            if len(io_parts) >= 4:
                entry["io_stat"] = {
                    "failed_reads": int(io_parts[0]),
                    "failed_writes": int(io_parts[1]),
                    "invalid_io": int(io_parts[2]),
                    "notify_free": int(io_parts[3]),
                }

        backing_dev = read_text(f"{sysfs_path}/backing_dev")
        if backing_dev and backing_dev != "none":
            entry["backing_dev"] = backing_dev

        writeback_limit_enabled = read_text(f"{sysfs_path}/writeback_limit_enable")
        if writeback_limit_enabled is not None:
            entry["writeback_limit_enabled"] = writeback_limit_enabled.strip() == "1"

        writeback_limit = read_text(f"{sysfs_path}/writeback_limit")
        if writeback_limit:
            page_size = os.sysconf("SC_PAGE_SIZE")
            entry["writeback_limit_bytes"] = int(writeback_limit) * page_size

        # zram bd_stat: pages currently on backing device, pages read, pages written.
        zram_bd_stat = read_text(f"{sysfs_path}/bd_stat")
        if zram_bd_stat:
            bd_parts = zram_bd_stat.split()
            if len(bd_parts) >= 3:
                page_size = os.sysconf("SC_PAGE_SIZE")
                entry["bd_stat"] = {
                    "backed_bytes": int(bd_parts[0]) * page_size,
                    "read_bytes": int(bd_parts[1]) * page_size,
                    "written_bytes": int(bd_parts[2]) * page_size,
                    "backed_pages": int(bd_parts[0]),
                    "read_pages": int(bd_parts[1]),
                    "written_pages": int(bd_parts[2]),
                    "page_size": page_size,
                }

        # Generic block stat remains useful for debugging but is not zram writeback.
        block_stat = read_text(f"{sysfs_path}/stat")
        if block_stat:
            block_parts = block_stat.split()
            if len(block_parts) >= 11:
                entry["block_stat"] = {
                    "reads_completed": int(block_parts[0]),
                    "reads_merged": int(block_parts[1]),
                    "sectors_read": int(block_parts[2]),
                    "read_ms": int(block_parts[3]),
                    "writes_completed": int(block_parts[4]),
                    "writes_merged": int(block_parts[5]),
                    "sectors_written": int(block_parts[6]),
                    "write_ms": int(block_parts[7]),
                    "io_in_progress": int(block_parts[8]),
                    "io_ms": int(block_parts[9]),
                    "weighted_io_ms": int(block_parts[10]),
                }

        result.append(entry)
    return result


def parse_zram_policy() -> dict:
    props = [
        "LoadState",
        "UnitFileState",
        "ActiveState",
        "SubState",
        "Result",
        "ExecMainStatus",
        "FragmentPath",
        "NextElapseUSecRealtime",
        "LastTriggerUSecRealtime",
    ]
    return {
        "service": systemctl_show("calabi-zram-writeback-policy.service", props),
        "timer": systemctl_show("calabi-zram-writeback-policy.timer", props),
    }


def parse_vmstat_swap() -> dict:
    """Read swap and page reclaim counters from /proc/vmstat."""
    wanted = {
        "pswpin", "pswpout", "pgfault", "pgmajfault",
        "pgsteal_kswapd", "pgsteal_direct",
        "pgscan_kswapd", "pgscan_direct",
        "pgscan_anon", "pgscan_file",
        "pgsteal_anon", "pgsteal_file",
    }
    result: dict = {}
    with open("/proc/vmstat", "r", encoding="utf-8") as fh:
        for line in fh:
            parts = line.split()
            if len(parts) == 2 and parts[0] in wanted:
                result[parts[0]] = int(parts[1])
    return result


# ---------------------------------------------------------------------------
# swap
# ---------------------------------------------------------------------------

def parse_swap() -> list[dict]:
    result: list[dict] = []
    try:
        with open("/proc/swaps", "r", encoding="utf-8") as fh:
            lines = fh.readlines()[1:]
    except (FileNotFoundError, PermissionError):
        return result
    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) < 4:
            continue
        name, _swap_type, size_kib, used_kib, prio = parts[:5]
        result.append({
            "name": name,
            "size_bytes": int(size_kib) * 1024,
            "used_bytes": int(used_kib) * 1024,
            "priority": int(prio),
        })
    return result


# ---------------------------------------------------------------------------
# Kernel thread CPU accounting  (/proc/<pid>/stat)
# ---------------------------------------------------------------------------

KERNEL_THREADS = ["ksmd", "kswapd0", "kswapd1", "kcompactd0", "kcompactd1"]


def read_kernel_thread_stat(pid: int, expected_comm: str, clock_ticks: int) -> dict | None:
    try:
        with open(f"/proc/{pid}/stat", "r", encoding="utf-8") as fh:
            content = fh.read()
    except (FileNotFoundError, PermissionError):
        return None
    parsed = parse_kernel_thread_stat_content(content, clock_ticks)
    if parsed and parsed.get("comm") == expected_comm:
        parsed.pop("comm", None)
        return parsed
    return None


def parse_kernel_thread_stat_content(content: str, clock_ticks: int) -> dict | None:
    rparen = content.rfind(")")
    if rparen < 0:
        return None
    lparen = content.find("(")
    if lparen < 0:
        return None
    comm = content[lparen + 1:rparen]
    rest = content[rparen + 2:].split()
    if len(rest) < 13:
        return None
    utime = int(rest[11])
    stime = int(rest[12])
    pid_str = content[:lparen].strip()
    return {
        "comm": comm,
        "pid": int(pid_str),
        "utime_ticks": utime,
        "stime_ticks": stime,
        "total_ticks": utime + stime,
        "clock_ticks_per_sec": clock_ticks,
        "total_seconds": (utime + stime) / clock_ticks,
    }


def scan_kernel_thread_cpu(clock_ticks: int, cache: CollectorCache | None) -> dict:
    result: dict = {}
    pids: dict[str, int] = {}
    for stat_path in glob.glob("/proc/[0-9]*/stat"):
        try:
            with open(stat_path, "r", encoding="utf-8") as fh:
                content = fh.read()
        except (FileNotFoundError, PermissionError):
            continue
        parsed = parse_kernel_thread_stat_content(content, clock_ticks)
        if not parsed or parsed["comm"] not in KERNEL_THREADS:
            continue
        comm = parsed.pop("comm")
        pids[comm] = parsed["pid"]
        result[comm] = parsed
    if cache is not None:
        cache.kernel_thread_pids = pids
    return result


def parse_kernel_thread_cpu(cache: CollectorCache | None = None) -> dict:
    """Read cumulative CPU ticks for key kernel memory-management threads."""
    clock_ticks = os.sysconf("SC_CLK_TCK")
    result: dict = {}
    if cache is not None and cache.kernel_thread_pids:
        stale = False
        for comm, pid in cache.kernel_thread_pids.items():
            stat = read_kernel_thread_stat(pid, comm, clock_ticks)
            if stat is None:
                stale = True
                break
            result[comm] = stat
        if not stale:
            for name in KERNEL_THREADS:
                if name not in result:
                    result[name] = None
            return result

    result = scan_kernel_thread_cpu(clock_ticks, cache)
    # Fill in missing threads as null
    for name in KERNEL_THREADS:
        if name not in result:
            result[name] = None
    return result


# ---------------------------------------------------------------------------
# Host CPU  (/proc/stat first line)
# ---------------------------------------------------------------------------

def parse_host_cpu() -> dict:
    """Parse aggregate and per-CPU lines from /proc/stat."""
    aggregate: dict = {}
    per_cpu: dict[str, dict] = {}
    with open("/proc/stat", "r", encoding="utf-8") as fh:
        for line in fh:
            if not line.startswith("cpu"):
                continue
            parts = line.split()
            label = parts[0]
            vals = {
                "user": int(parts[1]),
                "nice": int(parts[2]),
                "system": int(parts[3]),
                "idle": int(parts[4]),
                "iowait": int(parts[5]),
                "irq": int(parts[6]),
                "softirq": int(parts[7]),
                "steal": int(parts[8]) if len(parts) > 8 else 0,
            }
            if label == "cpu":
                aggregate = vals
            else:
                # "cpu0" .. "cpu95"
                per_cpu[label] = vals
    return {"aggregate": aggregate, "per_cpu": per_cpu}


def parse_cpu_freq() -> dict[str, float]:
    """Return per-CPU frequency in MHz from /proc/cpuinfo.

    Returns {"cpu0": 3201.5, "cpu1": 3199.8, ...}
    """
    result: dict[str, float] = {}
    cpu_idx = 0
    with open("/proc/cpuinfo", "r", encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("processor"):
                cpu_idx = int(line.split(":")[1].strip())
            elif line.startswith("cpu MHz"):
                mhz = float(line.split(":")[1].strip())
                result[f"cpu{cpu_idx}"] = mhz
    return result


# ---------------------------------------------------------------------------
# CPU topology and pool auto-detection
# ---------------------------------------------------------------------------


def compact_cpu_range(cpus: list[int]) -> str:
    """Convert [0,1,2,3,6,7,8] to '0-3,6-8'."""
    if not cpus:
        return ""
    ranges: list[str] = []
    start = cpus[0]
    end = cpus[0]
    for c in cpus[1:]:
        if c == end + 1:
            end = c
        else:
            ranges.append(f"{start}-{end}" if start != end else str(start))
            start = end = c
    ranges.append(f"{start}-{end}" if start != end else str(start))
    return ",".join(ranges)


def detect_cpu_topology() -> dict:
    """Auto-detect CPU socket/core/thread topology from sysfs."""
    num_cpus = os.cpu_count() or 1
    sockets: dict[int, dict[int, list[int]]] = {}

    for cpu_id in range(num_cpus):
        pkg = read_int(
            f"/sys/devices/system/cpu/cpu{cpu_id}/topology/physical_package_id"
        )
        core = read_int(
            f"/sys/devices/system/cpu/cpu{cpu_id}/topology/core_id"
        )
        if pkg is None or core is None:
            continue
        sockets.setdefault(pkg, {}).setdefault(core, []).append(cpu_id)

    num_sockets = len(sockets) or 1
    cores_per_socket = (
        max(len(cores) for cores in sockets.values()) if sockets else 1
    )
    threads_per_core = (
        max(
            len(cpus)
            for cores in sockets.values()
            for cpus in cores.values()
        )
        if sockets
        else 1
    )

    socket_map: dict[str, dict[str, str]] = {}
    for pkg_id, cores in sorted(sockets.items()):
        primary: list[int] = []
        smt: list[int] = []
        for _core_id, cpus in sorted(cores.items()):
            s = sorted(cpus)
            primary.append(s[0])
            smt.extend(s[1:])
        socket_map[str(pkg_id)] = {
            "primary": compact_cpu_range(sorted(primary)),
            "smt": compact_cpu_range(sorted(smt)),
        }

    return {
        "sockets": num_sockets,
        "cores_per_socket": cores_per_socket,
        "threads_per_core": threads_per_core,
        "socket_map": socket_map,
    }


def detect_cpu_pools() -> dict:
    """Auto-detect CPU pool assignments from running libvirt domain XML.

    Reads all vcpupin entries (→ guest_domain) and emulatorpin entries
    (→ host_emulator) from running domains.  Derives host_reserved as the
    complement of guest_domain, and host_housekeeping as host_reserved minus
    host_emulator.
    """
    num_cpus = os.cpu_count() or 1
    all_cpus = set(range(num_cpus))

    guest_domain: set[int] = set()
    host_emulator: set[int] = set()

    proc = run("virsh", "list", "--state-running", "--name", check=False)
    if proc.returncode == 0:
        names = [l.strip() for l in proc.stdout.splitlines() if l.strip()]
        for name in names:
            xml_proc = run("virsh", "dumpxml", name, check=False)
            if xml_proc.returncode != 0:
                continue
            try:
                root = ET.fromstring(xml_proc.stdout)
            except ET.ParseError:
                continue
            for vcpupin in root.findall(".//cputune/vcpupin"):
                cpuset = vcpupin.get("cpuset", "")
                if cpuset:
                    guest_domain.update(expand_cpu_range(cpuset))
            emulatorpin = root.find(".//cputune/emulatorpin")
            if emulatorpin is not None:
                cpuset = emulatorpin.get("cpuset", "")
                if cpuset:
                    host_emulator.update(expand_cpu_range(cpuset))

    if not guest_domain:
        # No running domains — cannot determine pools
        return {
            "host_reserved": compact_cpu_range(sorted(all_cpus)),
            "host_housekeeping": compact_cpu_range(sorted(all_cpus)),
            "host_emulator": "",
            "guest_domain": "",
        }

    host_reserved = all_cpus - guest_domain
    host_housekeeping = host_reserved - host_emulator

    return {
        "host_reserved": compact_cpu_range(sorted(host_reserved)),
        "host_housekeeping": compact_cpu_range(sorted(host_housekeeping)),
        "host_emulator": compact_cpu_range(sorted(host_emulator)),
        "guest_domain": compact_cpu_range(sorted(guest_domain)),
    }


def expand_cpu_range(range_str: str) -> list[int]:
    """Expand '0-5,24-29' into [0,1,2,3,4,5,24,25,26,27,28,29]."""
    result: list[int] = []
    for part in range_str.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start, end = part.split("-", 1)
            if not start.strip() or not end.strip():
                continue
            result.extend(range(int(start), int(end) + 1))
        else:
            result.append(int(part))
    return result


def build_cpu_pool_map(pools: dict) -> dict[int, str]:
    """Map each CPU id to its most-specific pool assignment."""
    cpu_map: dict[int, str] = {}
    # Assign in order of specificity: reserved first, then overlay more specific
    for cpu_id in expand_cpu_range(pools.get("guest_domain", "")):
        cpu_map[cpu_id] = "guest_domain"
    for cpu_id in expand_cpu_range(pools.get("host_reserved", "")):
        cpu_map[cpu_id] = "host_reserved"
    for cpu_id in expand_cpu_range(pools.get("host_emulator", "")):
        cpu_map[cpu_id] = "host_emulator"
    for cpu_id in expand_cpu_range(pools.get("host_housekeeping", "")):
        cpu_map[cpu_id] = "host_housekeeping"
    return cpu_map


# ---------------------------------------------------------------------------
# Cgroup v2 CPU stats  (/sys/fs/cgroup/machine.slice/...)
# ---------------------------------------------------------------------------

TIER_NAMES = ["gold", "silver", "bronze"]


def parse_cgroup_cpu_stat(path: str) -> dict | None:
    """Parse a cgroup v2 cpu.stat file."""
    text = read_text(path)
    if text is None:
        return None
    result: dict = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) == 2:
            try:
                result[parts[0]] = int(parts[1])
            except ValueError:
                result[parts[0]] = parts[1]
    return result


def parse_tier_cgroups() -> dict:
    """Read cpu.stat and cpu.weight for each performance-domain tier slice."""
    result: dict = {}
    for tier in TIER_NAMES:
        base = f"/sys/fs/cgroup/machine.slice/machine-{tier}.slice"
        cpu_stat = parse_cgroup_cpu_stat(f"{base}/cpu.stat")
        cpu_weight = read_int(f"{base}/cpu.weight")
        result[tier] = {
            "cpu_weight": cpu_weight,
            "cpu_stat": cpu_stat,
        }
    return result


def systemd_escape(name: str) -> str:
    """Escape a string the way systemd does for cgroup scope names.

    Hyphens become \\x2d, other non-alnum/non-dot chars become \\xNN.
    """
    out: list[str] = []
    for ch in name:
        if ch.isalnum() or ch == ".":
            out.append(ch)
        else:
            out.append(f"\\x{ord(ch):02x}")
    return "".join(out)


def parse_domain_cgroups(domains: list[dict] | None = None) -> dict:
    """Read cpu.stat for each running domain's cgroup scope.

    If a domain list is provided, resolve paths by name.
    Otherwise, discover all QEMU scopes by scanning the cgroup tree.
    """
    result: dict = {}

    if domains:
        # Targeted lookup from known domain list
        for domain in domains:
            name = domain["name"]
            tier = domain["tier"]
            if tier in TIER_NAMES:
                scope_base = f"/sys/fs/cgroup/machine.slice/machine-{tier}.slice"
                cpu_stat = _find_domain_cgroup(scope_base, name)
            else:
                cpu_stat = None
                for candidate in TIER_NAMES:
                    scope_base = f"/sys/fs/cgroup/machine.slice/machine-{candidate}.slice"
                    cpu_stat = _find_domain_cgroup(scope_base, name)
                    if cpu_stat is not None:
                        break
            result[name] = cpu_stat
    else:
        # Discovery mode: scan all tier slices for QEMU scopes
        for tier in TIER_NAMES:
            scope_base = f"/sys/fs/cgroup/machine.slice/machine-{tier}.slice"
            for scope_dir in glob.glob(f"{scope_base}/machine-qemu*.scope"):
                cpu_stat = parse_cgroup_cpu_stat(f"{scope_dir}/cpu.stat")
                # Extract domain name from scope dir name
                # Format: machine-qemu\x2d<N>\x2d<escaped-name>.scope
                dirname = os.path.basename(scope_dir)
                name = _unescape_scope_name(dirname)
                if name and cpu_stat is not None:
                    result[name] = cpu_stat

    return result


def read_ksm_stat(pid: int) -> dict | None:
    text = read_text(f"/proc/{pid}/ksm_stat")
    if not text:
        return None
    result: dict = {}
    for line in text.splitlines():
        key, _, value = line.partition(" ")
        if not key or not value:
            continue
        value = value.strip()
        if value in ("yes", "no"):
            result[key] = value == "yes"
            continue
        try:
            result[key] = int(value)
        except ValueError:
            result[key] = value
    return result


def qemu_pid_by_uuid() -> dict[str, int]:
    result: dict[str, int] = {}
    for cmdline_path in glob.glob("/proc/[0-9]*/cmdline"):
        pid_text = cmdline_path.split("/")[2]
        try:
            with open(cmdline_path, "rb") as fh:
                raw = fh.read()
        except (FileNotFoundError, PermissionError):
            continue
        if b"qemu" not in raw or b"-uuid" not in raw:
            continue
        args = [part.decode("utf-8", "replace") for part in raw.split(b"\0") if part]
        for idx, arg in enumerate(args):
            if arg == "-uuid" and idx + 1 < len(args):
                result[args[idx + 1]] = int(pid_text)
                break
    return result


def parse_domain_ksm(domains: list[dict], by_uuid: dict[str, int] | None = None) -> list[dict]:
    if by_uuid is None:
        by_uuid = qemu_pid_by_uuid()
    result: list[dict] = []
    for domain in domains:
        uuid = domain.get("uuid")
        pid = by_uuid.get(uuid or "")
        if not pid:
            continue
        stat = read_ksm_stat(pid)
        if not stat:
            continue
        profit = int(stat.get("ksm_process_profit") or 0)
        mergeable_pages = int(stat.get("ksm_rmap_items") or 0)
        merging_pages = int(stat.get("ksm_merging_pages") or 0)
        guest_memory = int(domain.get("memory_bytes") or 0)
        result.append({
            "name": domain["name"],
            "tier": domain["tier"],
            "uuid": uuid,
            "pid": pid,
            "profit_bytes": profit,
            "mergeable_pages": mergeable_pages,
            "merging_pages": merging_pages,
            "zero_pages": int(stat.get("ksm_zero_pages") or 0),
            "merge_density": (merging_pages / mergeable_pages) if mergeable_pages > 0 else 0,
            "dependency_ratio": (profit / guest_memory) if guest_memory > 0 else 0,
            "mergeable": bool(stat.get("ksm_mergeable")),
            "merge_any": bool(stat.get("ksm_merge_any")),
        })
    result.sort(key=lambda item: item["profit_bytes"], reverse=True)
    return result


def read_process_vmswap_bytes(pid: int) -> int | None:
    text = read_text(f"/proc/{pid}/status")
    if not text:
        return None
    for line in text.splitlines():
        if line.startswith("VmSwap:"):
            parts = line.split()
            if len(parts) >= 2:
                return int(parts[1]) * 1024
    return 0


def parse_domain_swap(domains: list[dict], by_uuid: dict[str, int] | None = None) -> list[dict]:
    if by_uuid is None:
        by_uuid = qemu_pid_by_uuid()
    result: list[dict] = []
    for domain in domains:
        uuid = domain.get("uuid")
        pid = by_uuid.get(uuid or "")
        if not pid:
            continue
        swapped = read_process_vmswap_bytes(pid)
        if swapped is None:
            continue
        guest_memory = int(domain.get("memory_bytes") or 0)
        result.append({
            "name": domain["name"],
            "tier": domain["tier"],
            "uuid": uuid,
            "pid": pid,
            "swap_bytes": swapped,
            "dependency_ratio": (swapped / guest_memory) if guest_memory > 0 else 0,
        })
    result.sort(key=lambda item: item["swap_bytes"], reverse=True)
    return result


def _find_domain_cgroup(scope_base: str, name: str) -> dict | None:
    """Find and read cpu.stat for a specific domain under a tier slice."""
    escaped = systemd_escape(name)
    pattern = f"{scope_base}/machine-qemu*{escaped}.scope"
    for match in glob.glob(pattern):
        cpu_stat = parse_cgroup_cpu_stat(f"{match}/cpu.stat")
        if cpu_stat is not None:
            return cpu_stat
    # Fallback: libvirt/qemu/<name>.scope
    return parse_cgroup_cpu_stat(
        f"{scope_base}/libvirt/qemu/{name}.scope/cpu.stat"
    )


def _unescape_scope_name(dirname: str) -> str | None:
    """Extract domain name from a systemd scope directory name.

    Input:  machine-qemu\\x2d154\\x2dexample\\x2dguest.scope
    Output: example-guest
    """
    import re
    # Strip machine- prefix and .scope suffix
    s = dirname
    if s.startswith("machine-"):
        s = s[len("machine-"):]
    if s.endswith(".scope"):
        s = s[:-len(".scope")]
    # Strip qemu\x2d<N>\x2d prefix (qemu + escaped-hyphen + digits + escaped-hyphen)
    s = re.sub(r"^qemu\\x2d\d+\\x2d", "", s)
    # Unescape \xNN sequences
    def _replace_hex(m):
        return chr(int(m.group(1), 16))
    s = re.sub(r"\\x([0-9a-fA-F]{2})", _replace_hex, s)
    return s if s else None


# ---------------------------------------------------------------------------
# libvirt domains (slow — involves virsh forks)
# ---------------------------------------------------------------------------

def classify_tier(name: str, partition: str) -> str:
    if partition == "/machine/gold":
        return "gold"
    if partition == "/machine/silver":
        return "silver"
    if partition == "/machine/bronze":
        return "bronze"
    return "unknown"


def parse_domains() -> list[dict]:
    proc = run("virsh", "list", "--state-running", "--name", check=False)
    if proc.returncode != 0:
        return []
    result: list[dict] = []
    for name in [l.strip() for l in proc.stdout.splitlines() if l.strip()]:
        xml_proc = run("virsh", "dumpxml", name, check=False)
        if xml_proc.returncode != 0:
            continue
        root = ET.fromstring(xml_proc.stdout)
        memory_elem = root.find("memory")
        vcpu_elem = root.find("vcpu")
        partition_elem = root.find("./resource/partition")
        uuid_elem = root.find("uuid")
        memory_kib = (
            int(memory_elem.text.strip())
            if memory_elem is not None and memory_elem.text else 0
        )
        vcpus = (
            int(vcpu_elem.text.strip())
            if vcpu_elem is not None and vcpu_elem.text else 0
        )
        partition = (
            partition_elem.text.strip()
            if partition_elem is not None and partition_elem.text else ""
        )
        uuid = (
            uuid_elem.text.strip()
            if uuid_elem is not None and uuid_elem.text else ""
        )
        tier = classify_tier(name, partition)
        result.append({
            "name": name,
            "uuid": uuid,
            "memory_bytes": memory_kib * 1024,
            "vcpus": vcpus,
            "partition": partition,
            "tier": tier,
        })
    return result


# ---------------------------------------------------------------------------
# Main collection
# ---------------------------------------------------------------------------

def collect(fast: bool = False, cache: CollectorCache | None = None) -> dict:
    timestamp = time.time()
    cache = cache or _DEFAULT_CACHE

    meminfo = parse_meminfo()
    ksm = parse_ksm()
    ksm_state, ksm_detail = classify_ksm_progress(ksm)
    thp = parse_thp()
    zram = parse_zram()
    zram_policy = parse_zram_policy()
    swap = parse_swap()
    vmstat_swap = parse_vmstat_swap()
    kernel_threads = parse_kernel_thread_cpu(cache)
    host_cpu = parse_host_cpu()
    cpu_freq = parse_cpu_freq()
    tier_cgroups = parse_tier_cgroups()

    if cache.cpu_topology is None:
        cache.cpu_topology = detect_cpu_topology()
    cpu_topology = cache.cpu_topology

    payload: dict = {
        "timestamp": timestamp,
        "fast_mode": fast,
        "meminfo": meminfo,
        "ksm": ksm,
        "ksm_progress_state": ksm_state,
        "ksm_progress_detail": ksm_detail,
        "thp": thp,
        "zram": zram,
        "zram_policy": zram_policy,
        "swap": swap,
        "vmstat_swap": vmstat_swap,
        "kernel_threads": kernel_threads,
        "host_cpu": host_cpu,
        "cpu_freq": cpu_freq,
        "tier_cgroups": tier_cgroups,
        "num_cpus": os.cpu_count() or 1,
        "cpu_topology": cpu_topology,
    }

    if not fast:
        # Slow poll: detect pools from virsh (requires running domains)
        cpu_pools = detect_cpu_pools()
        cpu_pool_map = build_cpu_pool_map(cpu_pools)
        payload["cpu_pools"] = cpu_pools
        payload["cpu_pool_map"] = {str(k): v for k, v in cpu_pool_map.items()}

        domains = parse_domains()
        cache.domains = domains
        tier_totals: dict = {}
        for entry in domains:
            bucket = tier_totals.setdefault(
                entry["tier"],
                {"domains": 0, "memory_bytes": 0, "vcpus": 0},
            )
            bucket["domains"] += 1
            bucket["memory_bytes"] += entry["memory_bytes"]
            bucket["vcpus"] += entry["vcpus"]

        by_uuid = qemu_pid_by_uuid()
        domain_cgroups = parse_domain_cgroups(domains)
        domain_ksm = parse_domain_ksm(domains, by_uuid)
        domain_swap = parse_domain_swap(domains, by_uuid)

        payload["domains"] = domains
        payload["tier_totals"] = tier_totals
        payload["domain_cgroups"] = domain_cgroups
        payload["domain_ksm"] = domain_ksm
        payload["domain_swap"] = domain_swap
        payload["guest_memory_bytes"] = sum(
            d["memory_bytes"] for d in domains
        )
        payload["guest_vcpus"] = sum(d["vcpus"] for d in domains)
    else:
        # Fast mode: skip virsh but still read per-domain cgroup CPU
        # via discovery (scanning cgroup tree for QEMU scopes)
        domain_cgroups = parse_domain_cgroups()
        payload["domain_cgroups"] = domain_cgroups
        if cache.domains:
            by_uuid = qemu_pid_by_uuid()
            payload["domain_ksm"] = parse_domain_ksm(cache.domains, by_uuid)
            payload["domain_swap"] = parse_domain_swap(cache.domains, by_uuid)

    payload["zram_estimated_saved_bytes"] = sum(
        d["estimated_saved_bytes"] for d in zram
    )
    payload["zram_mem_used_bytes"] = sum(
        d["mem_used_bytes"] for d in zram
    )
    payload["swap_used_bytes"] = sum(d["used_bytes"] for d in swap)

    return payload


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Calabi Observer metrics collector",
    )
    parser.add_argument(
        "--fast", action="store_true",
        help="skip virsh domain queries, sysfs/procfs/cgroups only",
    )
    args = parser.parse_args()
    try:
        data = collect(fast=args.fast)
        json.dump(data, sys.stdout)
        sys.stdout.write("\n")
        return 0
    except Exception as exc:
        json.dump({"error": str(exc)}, sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
