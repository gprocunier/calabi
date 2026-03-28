#!/usr/bin/env python3
"""
host-memory-overcommit-status.py

Inspect the Calabi hypervisor and summarize the host-memory overcommit state:
- host memory availability
- active zram usage and estimated compression savings
- active KSM state and estimated dedup savings
- running guest configured RAM / vCPU totals grouped by performance tier

The script resolves the hypervisor connection from the Ansible inventory by
default, but allows explicit overrides so it can run from a staged runtime
workspace with private inventory or directly against a known host.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path


REMOTE_PROBE = r"""
import json
import os
import subprocess
import xml.etree.ElementTree as ET


def run(*argv, check=True):
    return subprocess.run(
        list(argv),
        check=check,
        capture_output=True,
        text=True,
    )


def run_shell(command, check=True):
    return subprocess.run(
        ["bash", "-lc", command],
        check=check,
        capture_output=True,
        text=True,
    )


def read_text(path):
    try:
        return open(path, "r", encoding="utf-8").read().strip()
    except FileNotFoundError:
        return None


def read_int(path):
    value = read_text(path)
    if value is None or value == "":
        return None
    return int(value)


def parse_meminfo():
    wanted = {
        "MemTotal",
        "MemFree",
        "MemAvailable",
        "Buffers",
        "Cached",
        "SwapCached",
        "AnonPages",
        "Shmem",
        "KReclaimable",
        "Slab",
        "PageTables",
        "KernelStack",
        "Active",
        "Inactive",
    }
    result = {}
    with open("/proc/meminfo", "r", encoding="utf-8") as handle:
        for line in handle:
            key, _, rest = line.partition(":")
            if key not in wanted:
                continue
            number = rest.strip().split()[0]
            result[key] = int(number) * 1024
    return result


def parse_ksm():
    base = "/sys/kernel/mm/ksm"
    keys = [
        "run",
        "pages_shared",
        "pages_sharing",
        "pages_unshared",
        "pages_volatile",
        "full_scans",
        "pages_to_scan",
        "sleep_millisecs",
        "stable_node_chains",
        "stable_node_dups",
        "ksm_zero_pages",
    ]
    result = {}
    for key in keys:
        path = os.path.join(base, key)
        result[key] = read_int(path)
    page_size = os.sysconf("SC_PAGE_SIZE")
    saved_pages = (result.get("pages_sharing") or 0) + (result.get("ksm_zero_pages") or 0)
    result["page_size"] = page_size
    result["estimated_saved_bytes"] = saved_pages * page_size
    return result


def classify_ksm_progress(ksm: dict) -> tuple[str, str]:
    run = int(ksm.get("run") or 0)
    full_scans = int(ksm.get("full_scans") or 0)
    pages_shared = int(ksm.get("pages_shared") or 0)
    pages_sharing = int(ksm.get("pages_sharing") or 0)
    pages_volatile = int(ksm.get("pages_volatile") or 0)
    pages_unshared = int(ksm.get("pages_unshared") or 0)

    if run <= 0:
        return "disabled", "KSM is not running"
    if full_scans <= 0:
        return "first-scan-pending", "KSM is enabled but has not completed a full scan yet"
    if pages_sharing > 0 or pages_shared > 0:
        return "deduping", "KSM has found and merged identical pages"
    if pages_volatile > 0 or pages_unshared > 0:
        return "scanning-no-savings-yet", "KSM is scanning but the workload is still too volatile to merge much"
    return "scanning-idle", "KSM has completed scans but is not currently showing dedup savings"


def snapshot_metrics(data: dict) -> dict[str, int]:
    ksm = data["ksm"]
    return {
        "guest_memory_bytes": int(data.get("guest_memory_bytes") or 0),
        "guest_vcpus": int(data.get("guest_vcpus") or 0),
        "zram_estimated_saved_bytes": int(data.get("zram_estimated_saved_bytes") or 0),
        "zram_mem_used_bytes": int(data.get("zram_mem_used_bytes") or 0),
        "swap_used_bytes": int(data.get("swap_used_bytes") or 0),
        "ksm_estimated_saved_bytes": int(ksm.get("estimated_saved_bytes") or 0),
        "ksm_full_scans": int(ksm.get("full_scans") or 0),
        "ksm_pages_shared": int(ksm.get("pages_shared") or 0),
        "ksm_pages_sharing": int(ksm.get("pages_sharing") or 0),
        "ksm_pages_volatile": int(ksm.get("pages_volatile") or 0),
        "mem_available_bytes": int(data["meminfo"].get("MemAvailable") or 0),
        "mem_used_bytes": int(data["meminfo"].get("MemTotal") or 0) - int(data["meminfo"].get("MemAvailable") or 0),
    }


def build_delta_report(before: dict, after: dict, interval_seconds: int) -> dict:
    before_metrics = snapshot_metrics(before)
    after_metrics = snapshot_metrics(after)
    delta = {}
    for key, before_value in before_metrics.items():
        delta[key] = after_metrics[key] - before_value
    delta["interval_seconds"] = interval_seconds
    delta["ksm_progress_before"], delta["ksm_progress_detail_before"] = classify_ksm_progress(before["ksm"])
    delta["ksm_progress_after"], delta["ksm_progress_detail_after"] = classify_ksm_progress(after["ksm"])
    return {
        "before": before,
        "after": after,
        "delta": delta,
    }


def yaml_scalar(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    if text == "":
        return '""'
    if any(ch in text for ch in [":", "#", "{", "}", "[", "]", ",", "\n", "\t"]) or text.strip() != text:
        return json.dumps(text)
    return text


def render_yamlish_value(value: object, indent: int = 0) -> list[str]:
    pad = "  " * indent
    if isinstance(value, dict):
        lines: list[str] = []
        for key, item in value.items():
            if isinstance(item, dict):
                lines.append(f"{pad}{key}:")
                lines.extend(render_yamlish_value(item, indent + 1))
            elif isinstance(item, list):
                lines.append(f"{pad}{key}:")
                for entry in item:
                    if isinstance(entry, (dict, list)):
                        lines.append(f"{pad}  -")
                        lines.extend(render_yamlish_value(entry, indent + 2))
                    else:
                        lines.append(f"{pad}  - {yaml_scalar(entry)}")
            else:
                lines.append(f"{pad}{key}: {yaml_scalar(item)}")
        return lines
    if isinstance(value, list):
        lines: list[str] = []
        for entry in value:
            if isinstance(entry, (dict, list)):
                lines.append(f"{pad}-")
                lines.extend(render_yamlish_value(entry, indent + 1))
            else:
                lines.append(f"{pad}- {yaml_scalar(entry)}")
        return lines
    return [f"{pad}{yaml_scalar(value)}"]


def parse_zram():
    result = []
    proc = run(
        "zramctl",
        "--bytes",
        "--noheadings",
        "--output",
        "NAME,DISKSIZE,DATA,COMPR,TOTAL,MEM-USED,ALGORITHM,STREAMS",
        check=False,
    )
    if proc.returncode != 0:
        return result
    for raw_line in proc.stdout.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) != 8:
            continue
        name, disksize, data, compr, total, mem_used, algorithm, streams = parts
        data_bytes = int(data)
        mem_used_bytes = int(mem_used)
        result.append(
            {
                "name": name,
                "disksize_bytes": int(disksize),
                "data_bytes": data_bytes,
                "compressed_bytes": int(compr),
                "total_bytes": int(total),
                "mem_used_bytes": mem_used_bytes,
                "algorithm": algorithm,
                "streams": int(streams),
                "estimated_saved_bytes": max(data_bytes - mem_used_bytes, 0),
            }
        )
    return result


def parse_swap():
    result = []
    proc = run(
        "swapon",
        "--bytes",
        "--noheadings",
        "--output",
        "NAME,SIZE,USED,PRIO",
        check=False,
    )
    if proc.returncode != 0:
        return result
    for raw_line in proc.stdout.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) < 4:
            continue
        name, size, used, prio = parts[:4]
        result.append(
            {
                "name": name,
                "size_bytes": int(size),
                "used_bytes": int(used),
                "priority": int(prio),
            }
        )
    return result


def classify_tier(name, partition):
    if partition == "/machine/gold":
        return "gold"
    if partition == "/machine/silver":
        return "silver"
    if partition == "/machine/bronze":
        return "bronze"
    lowered = name.lower()
    if lowered.startswith("ocp-master"):
        return "gold"
    if lowered.startswith("ocp-infra") or lowered.startswith("idm"):
        return "silver"
    return "bronze"


def parse_domains():
    proc = run("virsh", "list", "--state-running", "--name", check=False)
    if proc.returncode != 0:
        return []
    result = []
    for name in [line.strip() for line in proc.stdout.splitlines() if line.strip()]:
        xml = run("virsh", "dumpxml", name, check=False)
        if xml.returncode != 0:
            continue
        root = ET.fromstring(xml.stdout)
        memory_elem = root.find("memory")
        vcpu_elem = root.find("vcpu")
        partition_elem = root.find("./resource/partition")
        memory_kib = int(memory_elem.text.strip()) if memory_elem is not None and memory_elem.text else 0
        vcpus = int(vcpu_elem.text.strip()) if vcpu_elem is not None and vcpu_elem.text else 0
        partition = partition_elem.text.strip() if partition_elem is not None and partition_elem.text else ""
        tier = classify_tier(name, partition)
        result.append(
            {
                "name": name,
                "memory_bytes": memory_kib * 1024,
                "vcpus": vcpus,
                "partition": partition,
                "tier": tier,
            }
        )
    return result


domains = parse_domains()
tier_totals = {}
for entry in domains:
    bucket = tier_totals.setdefault(
        entry["tier"],
        {
            "domains": 0,
            "memory_bytes": 0,
            "vcpus": 0,
        },
    )
    bucket["domains"] += 1
    bucket["memory_bytes"] += entry["memory_bytes"]
    bucket["vcpus"] += entry["vcpus"]

payload = {
    "hostname": run("hostname").stdout.strip(),
    "meminfo": parse_meminfo(),
    "ksm": parse_ksm(),
    "zram": parse_zram(),
    "swap": parse_swap(),
    "domains": domains,
    "tier_totals": tier_totals,
}

payload["guest_memory_bytes"] = sum(item["memory_bytes"] for item in domains)
payload["guest_vcpus"] = sum(item["vcpus"] for item in domains)
payload["zram_estimated_saved_bytes"] = sum(item["estimated_saved_bytes"] for item in payload["zram"])
payload["zram_mem_used_bytes"] = sum(item["mem_used_bytes"] for item in payload["zram"])
payload["swap_used_bytes"] = sum(item["used_bytes"] for item in payload["swap"])
payload["ksm_progress_state"], payload["ksm_progress_detail"] = classify_ksm_progress(payload["ksm"])

print(json.dumps(payload))
"""


def human_bytes(value: int | float | None) -> str:
    if value is None:
        return "n/a"
    units = ["B", "KiB", "MiB", "GiB", "TiB"]
    amount = float(value)
    for unit in units:
        if abs(amount) < 1024.0 or unit == units[-1]:
            if unit == "B":
                return f"{int(amount)} {unit}"
            return f"{amount:.1f} {unit}"
        amount /= 1024.0
    return f"{amount:.1f} TiB"


def ratio(numerator: int | float, denominator: int | float) -> str:
    if not denominator:
        return "n/a"
    return f"{numerator / denominator:.2f}x"


def yaml_scalar(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    if text == "":
        return '""'
    if any(ch in text for ch in [":", "#", "{", "}", "[", "]", ",", "\n", "\t"]) or text.strip() != text:
        return json.dumps(text)
    return text


def render_yamlish_value(value: object, indent: int = 0) -> list[str]:
    pad = "  " * indent
    if isinstance(value, dict):
        lines: list[str] = []
        for key, item in value.items():
            if isinstance(item, dict):
                lines.append(f"{pad}{key}:")
                lines.extend(render_yamlish_value(item, indent + 1))
            elif isinstance(item, list):
                lines.append(f"{pad}{key}:")
                for entry in item:
                    if isinstance(entry, (dict, list)):
                        lines.append(f"{pad}  -")
                        lines.extend(render_yamlish_value(entry, indent + 2))
                    else:
                        lines.append(f"{pad}  - {yaml_scalar(entry)}")
            else:
                lines.append(f"{pad}{key}: {yaml_scalar(item)}")
        return lines
    if isinstance(value, list):
        lines: list[str] = []
        for entry in value:
            if isinstance(entry, (dict, list)):
                lines.append(f"{pad}-")
                lines.extend(render_yamlish_value(entry, indent + 1))
            else:
                lines.append(f"{pad}- {yaml_scalar(entry)}")
        return lines
    return [f"{pad}{yaml_scalar(value)}"]


def classify_ksm_progress(ksm: dict) -> tuple[str, str]:
    run = int(ksm.get("run") or 0)
    full_scans = int(ksm.get("full_scans") or 0)
    pages_shared = int(ksm.get("pages_shared") or 0)
    pages_sharing = int(ksm.get("pages_sharing") or 0)
    pages_volatile = int(ksm.get("pages_volatile") or 0)
    pages_unshared = int(ksm.get("pages_unshared") or 0)

    if run <= 0:
        return "disabled", "KSM is not running"
    if full_scans <= 0:
        return "first-scan-pending", "KSM is enabled but has not completed a full scan yet"
    if pages_sharing > 0 or pages_shared > 0:
        return "deduping", "KSM has found and merged identical pages"
    if pages_volatile > 0 or pages_unshared > 0:
        return "scanning-no-savings-yet", "KSM is scanning but the workload is still too volatile to merge much"
    return "scanning-idle", "KSM has completed scans but is not currently showing dedup savings"


def snapshot_metrics(data: dict) -> dict[str, int]:
    ksm = data["ksm"]
    return {
        "guest_memory_bytes": int(data.get("guest_memory_bytes") or 0),
        "guest_vcpus": int(data.get("guest_vcpus") or 0),
        "zram_estimated_saved_bytes": int(data.get("zram_estimated_saved_bytes") or 0),
        "zram_mem_used_bytes": int(data.get("zram_mem_used_bytes") or 0),
        "swap_used_bytes": int(data.get("swap_used_bytes") or 0),
        "ksm_estimated_saved_bytes": int(ksm.get("estimated_saved_bytes") or 0),
        "ksm_full_scans": int(ksm.get("full_scans") or 0),
        "ksm_pages_shared": int(ksm.get("pages_shared") or 0),
        "ksm_pages_sharing": int(ksm.get("pages_sharing") or 0),
        "ksm_pages_volatile": int(ksm.get("pages_volatile") or 0),
        "mem_available_bytes": int(data["meminfo"].get("MemAvailable") or 0),
        "mem_used_bytes": int(data["meminfo"].get("MemTotal") or 0) - int(data["meminfo"].get("MemAvailable") or 0),
    }


def build_delta_report(before: dict, after: dict, interval_seconds: int) -> dict:
    before_metrics = snapshot_metrics(before)
    after_metrics = snapshot_metrics(after)
    delta = {}
    for key, before_value in before_metrics.items():
        delta[key] = after_metrics[key] - before_value
    delta["interval_seconds"] = interval_seconds
    delta["ksm_progress_before"], delta["ksm_progress_detail_before"] = classify_ksm_progress(before["ksm"])
    delta["ksm_progress_after"], delta["ksm_progress_detail_after"] = classify_ksm_progress(after["ksm"])
    return {
        "before": before,
        "after": after,
        "delta": delta,
    }


def load_inventory_host(inventory_path: Path, host_name: str) -> dict[str, str]:
    if shutil.which("ansible-inventory") is None:
        raise RuntimeError("ansible-inventory is required to resolve host connection details")
    proc = subprocess.run(
        ["ansible-inventory", "-i", str(inventory_path), "--host", host_name],
        check=True,
        capture_output=True,
        text=True,
    )
    data = json.loads(proc.stdout)
    return {
        "host": data.get("ansible_host", ""),
        "user": data.get("ansible_user", ""),
        "key": data.get("ansible_ssh_private_key_file", ""),
        "common_args": data.get("ansible_ssh_common_args", ""),
    }


def build_ssh_command(target: dict[str, str]) -> list[str]:
    host = target["host"]
    if not host or host.startswith("<"):
        raise RuntimeError(
            "inventory does not contain a usable ansible_host; stage a runtime inventory or pass --host explicitly"
        )
    user = target["user"] or os.environ.get("CALABI_HYPERVISOR_USER", "")
    key = target["key"] or os.environ.get("CALABI_HYPERVISOR_KEY", "")
    common_args = target["common_args"] or os.environ.get("CALABI_HYPERVISOR_SSH_ARGS", "")

    try:
        socket.getaddrinfo(host, 22)
    except socket.gaierror as exc:
        raise RuntimeError(
            f"SSH host {host!r} is not locally resolvable; pass a reachable hostname/IP or omit --host to use inventory"
        ) from exc

    ssh_cmd = ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new"]
    if key:
        expanded_key = os.path.expanduser(key)
        if not os.path.exists(expanded_key):
            raise RuntimeError(
                f"SSH private key {expanded_key!r} does not exist; pass a valid key or omit --key to use inventory"
            )
        ssh_cmd.extend(["-i", expanded_key])
    if common_args:
        ssh_cmd.extend(shlex.split(common_args))
    destination = f"{user}@{host}" if user else host
    ssh_cmd.append(destination)
    ssh_cmd.extend(["sudo", "-n", "python3", "-"])
    return ssh_cmd


def fetch_status(args: argparse.Namespace) -> dict:
    target = {
        "host": args.host or "",
        "user": args.user or "",
        "key": args.key or "",
        "common_args": args.ssh_common_args or "",
    }
    if not target["host"]:
        inventory_target = load_inventory_host(Path(args.inventory), args.inventory_host)
        for key, value in inventory_target.items():
            if not target[key]:
                target[key] = value
    try:
        proc = subprocess.run(
            build_ssh_command(target),
            input=REMOTE_PROBE,
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "").strip()
        stdout = (exc.stdout or "").strip()
        details = stderr or stdout or str(exc)
        raise RuntimeError(f"failed to query host-memory status via SSH: {details}") from exc
    return json.loads(proc.stdout)


def render_status(data: dict) -> str:
    mem = data["meminfo"]
    ksm = data["ksm"]
    zram = data["zram"]
    tier_totals = data["tier_totals"]
    guest_mem = data["guest_memory_bytes"]
    host_total = mem["MemTotal"]
    status = {
        "host": {
            "name": data["hostname"],
            "memory": {
                "total": human_bytes(host_total),
                "available": human_bytes(mem["MemAvailable"]),
                "used": human_bytes(host_total - mem["MemAvailable"]),
                "guest_configured": human_bytes(guest_mem),
                "overcommit": ratio(guest_mem, host_total),
                "mix": {
                    "anon": human_bytes(mem.get("AnonPages")),
                    "cached": human_bytes(mem.get("Cached")),
                    "slab": human_bytes(mem.get("Slab")),
                    "pagetables": human_bytes(mem.get("PageTables")),
                },
            },
        },
        "reclaim": {
            "ksm": {
                "state": "on" if ksm.get("run") else "off",
                "progress": data.get("ksm_progress_state"),
                "detail": data.get("ksm_progress_detail"),
                "scan": {
                    "pages_to_scan": ksm.get("pages_to_scan"),
                    "sleep_millisecs": ksm.get("sleep_millisecs"),
                    "full_scans": ksm.get("full_scans"),
                },
                "counters": {
                    "pages_shared": ksm.get("pages_shared"),
                    "pages_sharing": ksm.get("pages_sharing"),
                    "pages_volatile": ksm.get("pages_volatile"),
                },
                "gains": {
                    "estimated_saved": human_bytes(ksm.get("estimated_saved_bytes")),
                },
            },
            "zram": [
                {
                    "device": device["name"],
                    "size": human_bytes(device["disksize_bytes"]),
                    "swap_used": human_bytes(next((item["used_bytes"] for item in data["swap"] if item["name"] == device["name"]), 0)),
                    "used": human_bytes(device["mem_used_bytes"]),
                    "saved": human_bytes(device["estimated_saved_bytes"]),
                    "algorithm": device["algorithm"],
                }
                for device in zram
            ]
            or ["none"],
        },
        "tiers": [
            {
                "name": tier_name,
                "domains": tier_totals.get(tier_name, {"domains": 0})["domains"],
                "memory": human_bytes(tier_totals.get(tier_name, {"memory_bytes": 0})["memory_bytes"]),
                "vcpus": tier_totals.get(tier_name, {"vcpus": 0})["vcpus"],
            }
            for tier_name in ["gold", "silver", "bronze"]
        ],
        "gains": {
            "ksm_saved": human_bytes(ksm.get("estimated_saved_bytes")),
            "zram_saved": human_bytes(data.get("zram_estimated_saved_bytes")),
            "observed_reclaimed": human_bytes((ksm.get("estimated_saved_bytes") or 0) + (data.get("zram_estimated_saved_bytes") or 0)),
            "notes": [
                "KSM savings are dedup savings, not reclaimed RSS. Use them as a trend line, not a hard capacity number.",
                "zram savings stay near zero until the host actually swaps cold pages into zram.",
                "progress is inferred from KSM counters; there is no native percent-complete metric.",
            ],
        },
    }
    return "\n".join(render_yamlish_value(status))


def render_delta_report(report: dict) -> str:
    before = report["before"]
    after = report["after"]
    delta = report["delta"]
    delta_view = {
        "host": {
            "name": after["hostname"],
            "interval_seconds": delta["interval_seconds"],
            "memory": {
                "available": human_bytes(delta["mem_available_bytes"]),
                "used": human_bytes(delta["mem_used_bytes"]),
                "guest_configured": {
                    "before": human_bytes(before["guest_memory_bytes"]),
                    "after": human_bytes(after["guest_memory_bytes"]),
                    "delta": human_bytes(delta["guest_memory_bytes"]),
                },
                "guest_vcpus": {
                    "before": before["guest_vcpus"],
                    "after": after["guest_vcpus"],
                    "delta": delta["guest_vcpus"],
                },
            },
        },
        "reclaim": {
            "ksm": {
                "before": {
                    "progress": before.get("ksm_progress_state"),
                    "detail": before.get("ksm_progress_detail"),
                },
                "after": {
                    "progress": after.get("ksm_progress_state"),
                    "detail": after.get("ksm_progress_detail"),
                },
                "scan": {
                    "full_scans_delta": delta["ksm_full_scans"],
                    "pages_shared_delta": delta["ksm_pages_shared"],
                    "pages_sharing_delta": delta["ksm_pages_sharing"],
                    "pages_volatile_delta": delta["ksm_pages_volatile"],
                },
                "gains": {
                    "ksm_saved_delta": human_bytes(delta["ksm_estimated_saved_bytes"]),
                    "note": "positive means more dedup savings; negative means the kernel reported less merge benefit over the interval",
                },
            },
            "zram": {
                "mem_used_delta": human_bytes(delta["zram_mem_used_bytes"]),
                "saved_delta": human_bytes(delta["zram_estimated_saved_bytes"]),
                "swap_used_delta": human_bytes(delta["swap_used_bytes"]),
            },
        },
    }
    return "\n".join(render_yamlish_value(delta_view))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Show Calabi host memory overcommit status")
    parser.add_argument(
        "--inventory",
        default=str(Path(__file__).resolve().parents[1] / "inventory" / "hosts.yml"),
        help="inventory file used to resolve the hypervisor connection",
    )
    parser.add_argument(
        "--inventory-host",
        default="metal-01",
        help="inventory host to inspect",
    )
    parser.add_argument("--host", help="override hypervisor host/IP")
    parser.add_argument("--user", help="override SSH user")
    parser.add_argument("--key", help="override SSH private key path")
    parser.add_argument("--ssh-common-args", help="extra SSH options")
    parser.add_argument("--watch", type=int, default=0, help="refresh interval in seconds")
    parser.add_argument("--delta", type=int, default=0, help="capture two snapshots separated by N seconds")
    parser.add_argument("--json", action="store_true", help="emit raw JSON instead of the text dashboard")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.delta > 0:
            before = fetch_status(args)
            time.sleep(args.delta)
            after = fetch_status(args)
            report = build_delta_report(before, after, args.delta)
            if args.json:
                print(json.dumps(report, indent=2, sort_keys=True))
            else:
                print(render_delta_report(report))
            return 0
        while True:
            data = fetch_status(args)
            if args.json:
                output = json.dumps(data, indent=2, sort_keys=True)
            else:
                output = render_status(data)
            if args.watch > 0:
                print("\033[2J\033[H", end="")
                print(output)
                time.sleep(args.watch)
                continue
            print(output)
            return 0
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
