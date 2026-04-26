#!/usr/bin/python3
"""
Narrow control surface for Calabi Observer Prometheus export.

Accepted actions and settings are fixed. No caller-controlled paths, unit names,
shell commands, or arbitrary exporter arguments are accepted.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import shutil
import subprocess
import sys
import tempfile
from typing import Any


EXPORTER_SERVICE = "calabi-exporter.service"
LEGACY_COLLECTOR_SERVICE = "calabi-observer-collector.service"
LEGACY_NODE_EXPORTER_SERVICE = "calabi-node-exporter.service"
LEGACY_TEXTFILE = "/var/lib/node_exporter/textfile_collector/calabi_observer.prom"
SNAPSHOT = "/run/calabi-observer/metrics.json"
CONFIG_DIR = "/etc/calabi-observer"
CONFIG_PATH = f"{CONFIG_DIR}/prometheus.json"
WEB_CONFIG_PATH = f"{CONFIG_DIR}/node_exporter-web.yml"
CALABI_EXPORTER = "/usr/share/cockpit/calabi-observer/calabi_exporter.py"
SAFE_PATH = "/usr/sbin:/usr/bin:/sbin:/bin"
DEFAULT_CONFIG = {
    "interval_seconds": 5,
    "listen_address": "127.0.0.1:9910",
    "firewall": "closed",
    "web_config_enabled": False,
}


def run(*argv: str) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["PATH"] = SAFE_PATH
    return subprocess.run(list(argv), check=False, capture_output=True, text=True, env=env)


def atomic_write(path: str, data: str, mode: int = 0o644) -> None:
    os.makedirs(os.path.dirname(path), mode=0o755, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{os.path.basename(path)}.", dir=os.path.dirname(path), text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def parse_listen_address(value: str) -> tuple[str, int]:
    value = value.strip()
    if value.startswith("["):
        host, sep, tail = value[1:].partition("]:")
        if not sep:
            raise ValueError("IPv6 listen addresses must use [addr]:port syntax.")
        port_text = tail
    else:
        host, sep, port_text = value.rpartition(":")
        if not sep:
            raise ValueError("Listen address must include a port, for example 127.0.0.1:9910.")
    if not port_text.isdigit():
        raise ValueError("Listen port must be numeric.")
    port = int(port_text)
    if port < 1 or port > 65535:
        raise ValueError("Listen port must be between 1 and 65535.")
    if host and host != "localhost":
        try:
            ipaddress.ip_address(host)
        except ValueError as exc:
            raise ValueError("Listen host must be an IP literal, localhost, or empty for all interfaces.") from exc
    return host, port


def listen_is_loopback(value: str) -> bool:
    host, _port = parse_listen_address(value)
    if host in ("127.0.0.1", "::1", "localhost"):
        return True
    if not host:
        return False
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def scrape_url(listen_address: str) -> str:
    host, port = parse_listen_address(listen_address)
    if not host:
        host = "0.0.0.0"
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    return f"http://{host}:{port}/metrics"


def normalize_config(raw: dict[str, Any]) -> dict[str, Any]:
    cfg = dict(DEFAULT_CONFIG)
    cfg.update({k: v for k, v in raw.items() if k in cfg})
    try:
        interval = int(cfg["interval_seconds"])
    except (TypeError, ValueError) as exc:
        raise ValueError("Collection interval must be an integer number of seconds.") from exc
    if interval < 2 or interval > 3600:
        raise ValueError("Collection interval must be between 2 and 3600 seconds.")
    cfg["interval_seconds"] = interval

    listen = str(cfg["listen_address"]).strip()
    parse_listen_address(listen)
    cfg["listen_address"] = listen

    if cfg["firewall"] not in ("closed", "open"):
        raise ValueError("Firewall policy must be closed or open.")
    cfg["web_config_enabled"] = bool(cfg["web_config_enabled"])
    return cfg


def read_config() -> dict[str, Any]:
    if not os.path.exists(CONFIG_PATH):
        return normalize_config({})
    with open(CONFIG_PATH, encoding="utf-8") as handle:
        raw = json.load(handle)
    if not isinstance(raw, dict):
        raise ValueError("Prometheus config must be a JSON object.")
    return normalize_config(raw)


def write_config(cfg: dict[str, Any]) -> None:
    atomic_write(CONFIG_PATH, json.dumps(cfg, indent=2, sort_keys=True) + "\n")


def file_state(path: str) -> dict[str, Any]:
    state: dict[str, Any] = {
        "path": path,
        "exists": os.path.exists(path),
    }
    if state["exists"]:
        st = os.stat(path)
        state.update({
            "size_bytes": st.st_size,
            "mtime": st.st_mtime,
            "mode": oct(st.st_mode & 0o777),
            "owner_uid": st.st_uid,
            "owner_gid": st.st_gid,
        })
    return state


def web_config_state() -> dict[str, Any]:
    state = file_state(WEB_CONFIG_PATH)
    state.update({
        "tls_enabled": False,
        "basic_auth_enabled": False,
        "secure_permissions": False,
        "supported": False,
        "message": "TLS/basic auth are deferred for the direct Calabi exporter.",
    })
    if not state["exists"]:
        return state
    state["secure_permissions"] = not bool(os.stat(WEB_CONFIG_PATH).st_mode & 0o022)
    with open(WEB_CONFIG_PATH, encoding="utf-8") as handle:
        data = handle.read()
    state["tls_enabled"] = "tls_server_config:" in data
    state["basic_auth_enabled"] = "basic_auth_users:" in data
    return state


def systemctl_show(unit: str, props: list[str]) -> dict[str, str]:
    proc = run("systemctl", "show", unit, "--no-pager", "--property", ",".join(props))
    result: dict[str, str] = {}
    if proc.returncode != 0:
        return result
    for line in proc.stdout.splitlines():
        key, sep, value = line.partition("=")
        if sep:
            result[key] = value
    return result


def service_state(unit: str) -> dict[str, Any]:
    data = systemctl_show(
        unit,
        [
            "LoadState",
            "UnitFileState",
            "ActiveState",
            "SubState",
            "Result",
            "ExecMainCode",
            "ExecMainStatus",
            "StateChangeTimestamp",
        ],
    )
    return {
        "unit": unit,
        "load": data.get("LoadState", ""),
        "enabled": data.get("UnitFileState", ""),
        "active": data.get("ActiveState", ""),
        "substate": data.get("SubState", ""),
        "result": data.get("Result", ""),
        "exec_main_code": data.get("ExecMainCode", ""),
        "exec_main_status": data.get("ExecMainStatus", ""),
        "state_change_timestamp": data.get("StateChangeTimestamp", ""),
        "LoadState": data.get("LoadState", ""),
        "UnitFileState": data.get("UnitFileState", ""),
        "ActiveState": data.get("ActiveState", ""),
        "SubState": data.get("SubState", ""),
        "Result": data.get("Result", ""),
    }


def firewall_state(cfg: dict[str, Any]) -> dict[str, Any]:
    _host, port = parse_listen_address(cfg["listen_address"])
    result = {
        "requested": cfg["firewall"],
        "port": port,
        "firewalld_available": bool(shutil.which("firewall-cmd", path=SAFE_PATH)),
        "firewalld_running": False,
        "open": False,
        "message": "",
    }
    if not result["firewalld_available"]:
        result["message"] = "firewall-cmd is not installed"
        return result
    state = run("firewall-cmd", "--state")
    if state.returncode != 0:
        result["message"] = "firewalld is not running"
        return result
    result["firewalld_running"] = True
    query = run("firewall-cmd", "--query-port", f"{port}/tcp")
    result["open"] = query.returncode == 0
    return result


def apply_firewall_policy(cfg: dict[str, Any], previous_cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    _host, port = parse_listen_address(cfg["listen_address"])
    result = {
        "requested": cfg["firewall"],
        "port": port,
        "firewalld_available": bool(shutil.which("firewall-cmd", path=SAFE_PATH)),
        "firewalld_running": False,
        "open": False,
        "changed": False,
        "message": "",
    }
    if not result["firewalld_available"]:
        result["message"] = "firewall-cmd is not installed"
        return result
    state = run("firewall-cmd", "--state")
    if state.returncode != 0:
        result["message"] = "firewalld is not running"
        return result
    result["firewalld_running"] = True

    port_spec = f"{port}/tcp"
    if previous_cfg:
        _previous_host, previous_port = parse_listen_address(previous_cfg["listen_address"])
        if previous_cfg["firewall"] == "open" and previous_port != port:
            previous_port_spec = f"{previous_port}/tcp"
            run("firewall-cmd", "--remove-port", previous_port_spec)
            run("firewall-cmd", "--permanent", "--remove-port", previous_port_spec)

    if cfg["firewall"] == "open" and not listen_is_loopback(cfg["listen_address"]):
        runtime = run("firewall-cmd", "--add-port", port_spec)
        permanent = run("firewall-cmd", "--permanent", "--add-port", port_spec)
        result["changed"] = runtime.returncode == 0 or permanent.returncode == 0
    else:
        runtime = run("firewall-cmd", "--remove-port", port_spec)
        permanent = run("firewall-cmd", "--permanent", "--remove-port", port_spec)
        result["changed"] = runtime.returncode == 0 or permanent.returncode == 0
        if cfg["firewall"] == "open":
            result["message"] = "listen address is loopback-only; firewall port was not opened"

    query = run("firewall-cmd", "--query-port", port_spec)
    result["open"] = query.returncode == 0
    return result


def apply_config(cfg: dict[str, Any]) -> dict[str, Any]:
    previous_cfg = read_config()
    cfg = normalize_config(cfg)
    write_config(cfg)
    firewall = apply_firewall_policy(cfg, previous_cfg)
    daemon_reload = run("systemctl", "daemon-reload")
    if daemon_reload.returncode != 0:
        raise RuntimeError(daemon_reload.stderr.strip() or daemon_reload.stdout.strip())

    exporter_active = systemctl_show(EXPORTER_SERVICE, ["ActiveState"]).get("ActiveState") == "active"
    if exporter_active:
        proc = run("systemctl", "restart", EXPORTER_SERVICE)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or proc.stdout.strip())
    return firewall


def unit_state() -> dict[str, Any]:
    cfg = read_config()
    exporter = service_state(EXPORTER_SERVICE)
    legacy_collector = service_state(LEGACY_COLLECTOR_SERVICE)
    legacy_node = service_state(LEGACY_NODE_EXPORTER_SERVICE)
    web_state = web_config_state()
    local_only = listen_is_loopback(cfg["listen_address"])
    endpoint = {
        "listen_address": cfg["listen_address"],
        "scrape_url": scrape_url(cfg["listen_address"]),
        "metrics_path": "/metrics",
        "health_path": "/healthz",
        "snapshot_path": "/snapshot.json",
    }
    endpoint["health_url"] = endpoint["scrape_url"].removesuffix("/metrics") + "/healthz"
    endpoint["snapshot_url"] = endpoint["scrape_url"].removesuffix("/metrics") + "/snapshot.json"
    return {
        "exporter": exporter,
        "endpoint": endpoint,
        "snapshot": file_state(SNAPSHOT),
        "config": cfg,
        "firewall": firewall_state(cfg),
        "web_config": web_state,
        "security": {
            "local_only": local_only,
            "tls_enabled": False,
            "basic_auth_enabled": False,
            "web_config_enabled": False,
            "tls_deferred": True,
        },
        "legacy": {
            "collector": legacy_collector,
            "node_exporter": legacy_node,
            "textfile": file_state(LEGACY_TEXTFILE),
        },
        "collector": exporter,
        "node_exporter": {
            "installed": legacy_node.get("load") == "loaded",
            "unit": LEGACY_NODE_EXPORTER_SERVICE,
            "active": legacy_node.get("active", ""),
            "enabled": legacy_node.get("enabled", ""),
        },
        "textfile": file_state(LEGACY_TEXTFILE),
    }


def json_error(message: str) -> int:
    json.dump({"ok": False, "error": message}, sys.stdout)
    sys.stdout.write("\n")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Control Calabi Observer direct Prometheus export.")
    sub = parser.add_subparsers(dest="action", required=True)
    for action in ("status", "enable", "disable", "export-once"):
        sub.add_parser(action)
    configure = sub.add_parser("configure")
    configure.add_argument("--interval-seconds", type=int)
    configure.add_argument("--listen-address")
    configure.add_argument("--firewall", choices=["closed", "open"])
    configure.add_argument("--web-config", choices=["enabled", "disabled"])
    args = parser.parse_args()

    try:
        if args.action == "configure":
            cfg = read_config()
            if args.interval_seconds is not None:
                cfg["interval_seconds"] = args.interval_seconds
            if args.listen_address is not None:
                cfg["listen_address"] = args.listen_address
            if args.firewall is not None:
                cfg["firewall"] = args.firewall
            if args.web_config is not None:
                cfg["web_config_enabled"] = args.web_config == "enabled"
            apply_config(cfg)
        elif args.action == "enable":
            apply_config(read_config())
            proc = run("systemctl", "enable", "--now", EXPORTER_SERVICE)
            if proc.returncode != 0:
                return json_error(proc.stderr.strip() or proc.stdout.strip())
        elif args.action == "disable":
            proc = run("systemctl", "disable", "--now", EXPORTER_SERVICE)
            if proc.returncode != 0:
                return json_error(proc.stderr.strip() or proc.stdout.strip())
        elif args.action == "export-once":
            proc = run(CALABI_EXPORTER, "--once")
            if proc.returncode != 0:
                return json_error(proc.stderr.strip() or proc.stdout.strip())
        result = unit_state()
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
        return json_error(str(exc))
    result["ok"] = True
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
