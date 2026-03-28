/* calabi-observer.js — Calabi Observer Cockpit plugin frontend */

"use strict";

/* global cockpit, drawSparkline, drawStackedBar */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var COLLECTOR_PATH = "/usr/share/cockpit/calabi-observer/collector.py";
var TIER_COLORS = { gold: "#c9b037", silver: "#a8a9ad", bronze: "#cd7f32" };
var TIER_ORDER = ["gold", "silver", "bronze"];
var HISTORY_SIZE = 120;
var GiB = 1073741824;
var MiB = 1048576;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

var state = {
    fastInterval: 5000,
    slowInterval: 60000,
    paused: false,
    history: [],          // rolling array of derived metrics
    prev: null,           // previous sample for delta computation
    current: null,        // most recent merged sample
    domains: null,        // cached domain list from last slow poll
    tierTotals: null,
    domainCgroups: null,
    guestMemoryBytes: 0,
    guestVcpus: 0,
    fastTimer: null,
    slowTimer: null,
    debug: window.location.search.indexOf("debug=1") >= 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function humanBytes(bytes) {
    if (bytes == null || isNaN(bytes)) return "n/a";
    var units = ["B", "KiB", "MiB", "GiB", "TiB"];
    var val = Math.abs(bytes);
    var sign = bytes < 0 ? "-" : "";
    for (var i = 0; i < units.length; i++) {
        if (val < 1024 || i === units.length - 1) {
            return sign + (i === 0 ? val.toFixed(0) : val.toFixed(1)) + " " + units[i];
        }
        val /= 1024;
    }
    return sign + val.toFixed(1) + " TiB";
}

function humanGiB(bytes) {
    if (bytes == null || isNaN(bytes)) return "n/a";
    return (bytes / GiB).toFixed(1) + " GiB";
}

function pct(v, digits) {
    if (v == null || isNaN(v)) return "n/a";
    return v.toFixed(digits !== undefined ? digits : 1) + "%";
}

function fmtInt(v) {
    if (v == null || isNaN(v)) return "n/a";
    return v.toLocaleString();
}

function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
        for (var k in attrs) {
            if (k === "className") e.className = attrs[k];
            else if (k === "textContent") e.textContent = attrs[k];
            else if (k === "title") e.title = attrs[k];
            else if (k.indexOf("data-") === 0) e.setAttribute(k, attrs[k]);
            else e.setAttribute(k, attrs[k]);
        }
    }
    if (children) {
        if (!Array.isArray(children)) children = [children];
        for (var i = 0; i < children.length; i++) {
            var c = children[i];
            if (typeof c === "string") e.appendChild(document.createTextNode(c));
            else if (c) e.appendChild(c);
        }
    }
    return e;
}

function clearEl(id) {
    var e = document.getElementById(id);
    if (e) e.innerHTML = "";
    return e;
}

function historySlice(key) {
    return state.history.map(function (h) { return h[key]; });
}

// ---------------------------------------------------------------------------
// Data collection
// ---------------------------------------------------------------------------

function fetchData(fast) {
    var args = ["python3", COLLECTOR_PATH];
    if (fast) args.push("--fast");
    return cockpit.spawn(args, { superuser: "require", err: "message" })
        .then(function (output) {
            return JSON.parse(output);
        });
}

// ---------------------------------------------------------------------------
// Delta computation
// ---------------------------------------------------------------------------

function computeDeltas(prev, curr) {
    var dt = curr.timestamp - prev.timestamp;
    if (dt <= 0) return null;

    var deltas = { dt: dt, timestamp: curr.timestamp };
    var numCpus = curr.num_cpus || 96;

    // ksmd CPU
    var ksmdPrev = prev.kernel_threads && prev.kernel_threads.ksmd;
    var ksmdCurr = curr.kernel_threads && curr.kernel_threads.ksmd;
    if (ksmdPrev && ksmdCurr) {
        var ksmdDelta = ksmdCurr.total_seconds - ksmdPrev.total_seconds;
        deltas.ksmd_cpu_core_pct = (ksmdDelta / dt) * 100;
        deltas.ksmd_cpu_host_pct = deltas.ksmd_cpu_core_pct / numCpus;
    } else {
        deltas.ksmd_cpu_core_pct = 0;
        deltas.ksmd_cpu_host_pct = 0;
    }

    // Total memory management CPU (ksmd + kswapd + kcompactd)
    var mmThreads = ["ksmd", "kswapd0", "kswapd1", "kcompactd0", "kcompactd1"];
    var mmTotal = 0;
    var mmBreakdown = {};
    for (var i = 0; i < mmThreads.length; i++) {
        var name = mmThreads[i];
        var tp = prev.kernel_threads && prev.kernel_threads[name];
        var tc = curr.kernel_threads && curr.kernel_threads[name];
        if (tp && tc) {
            var d = (tc.total_seconds - tp.total_seconds) / dt * 100;
            mmBreakdown[name] = d;
            mmTotal += d;
        } else {
            mmBreakdown[name] = 0;
        }
    }
    deltas.mm_cpu_core_pct = mmTotal;
    deltas.mm_cpu_host_pct = mmTotal / numCpus;
    deltas.mm_breakdown = mmBreakdown;

    // Per-tier CPU from cgroup
    deltas.tier_cpu = {};
    for (var ti = 0; ti < TIER_ORDER.length; ti++) {
        var tier = TIER_ORDER[ti];
        var prevTier = prev.tier_cgroups && prev.tier_cgroups[tier];
        var currTier = curr.tier_cgroups && curr.tier_cgroups[tier];
        if (prevTier && prevTier.cpu_stat && currTier && currTier.cpu_stat) {
            var usageDelta = (currTier.cpu_stat.usage_usec || 0) - (prevTier.cpu_stat.usage_usec || 0);
            var corePct = (usageDelta / (dt * 1e6)) * 100;
            var throttledDelta = (currTier.cpu_stat.nr_throttled || 0) - (prevTier.cpu_stat.nr_throttled || 0);
            var throttledUsecDelta = (currTier.cpu_stat.throttled_usec || 0) - (prevTier.cpu_stat.throttled_usec || 0);
            deltas.tier_cpu[tier] = {
                core_pct: corePct,
                host_pct: corePct / numCpus,
                throttled_events: throttledDelta,
                throttled_usec: throttledUsecDelta,
            };
        } else {
            deltas.tier_cpu[tier] = { core_pct: 0, host_pct: 0, throttled_events: 0, throttled_usec: 0 };
        }
    }

    // Per-domain CPU from cgroup
    deltas.domain_cpu = {};
    if (curr.domain_cgroups && prev.domain_cgroups) {
        for (var dname in curr.domain_cgroups) {
            var dc = curr.domain_cgroups[dname];
            var dp = prev.domain_cgroups[dname];
            if (dc && dp && dc.usage_usec != null && dp.usage_usec != null) {
                var domDelta = (dc.usage_usec - dp.usage_usec);
                deltas.domain_cpu[dname] = (domDelta / (dt * 1e6)) * 100;
            }
        }
    }

    // Host CPU from /proc/stat (aggregate)
    var prevAgg = prev.host_cpu && prev.host_cpu.aggregate ? prev.host_cpu.aggregate : prev.host_cpu || {};
    var currAgg = curr.host_cpu && curr.host_cpu.aggregate ? curr.host_cpu.aggregate : curr.host_cpu || {};
    if (prevAgg.idle !== undefined && currAgg.idle !== undefined) {
        var fields = ["user", "nice", "system", "idle", "iowait", "irq", "softirq", "steal"];
        var totalPrev = 0, totalCurr = 0;
        var idlePrev = (prevAgg.idle || 0) + (prevAgg.iowait || 0);
        var idleCurr = (currAgg.idle || 0) + (currAgg.iowait || 0);
        for (var fi = 0; fi < fields.length; fi++) {
            totalPrev += prevAgg[fields[fi]] || 0;
            totalCurr += currAgg[fields[fi]] || 0;
        }
        var totalD = totalCurr - totalPrev;
        var idleD = idleCurr - idlePrev;
        deltas.host_cpu_pct = totalD > 0 ? ((totalD - idleD) / totalD) * 100 : 0;
        var stealD = (currAgg.steal || 0) - (prevAgg.steal || 0);
        deltas.host_steal_pct = totalD > 0 ? (stealD / totalD) * 100 : 0;
    } else {
        deltas.host_cpu_pct = 0;
        deltas.host_steal_pct = 0;
    }

    // Per-CPU utilization
    var prevPerCpu = prev.host_cpu && prev.host_cpu.per_cpu ? prev.host_cpu.per_cpu : {};
    var currPerCpu = curr.host_cpu && curr.host_cpu.per_cpu ? curr.host_cpu.per_cpu : {};
    deltas.per_cpu_pct = {};
    var cpuFields = ["user", "nice", "system", "idle", "iowait", "irq", "softirq", "steal"];
    for (var cpuKey in currPerCpu) {
        var pc = currPerCpu[cpuKey];
        var pp = prevPerCpu[cpuKey];
        if (pc && pp) {
            var cpuTotalP = 0, cpuTotalC = 0;
            var cpuIdleP = (pp.idle || 0) + (pp.iowait || 0);
            var cpuIdleC = (pc.idle || 0) + (pc.iowait || 0);
            for (var cfi = 0; cfi < cpuFields.length; cfi++) {
                cpuTotalP += pp[cpuFields[cfi]] || 0;
                cpuTotalC += pc[cpuFields[cfi]] || 0;
            }
            var cpuTD = cpuTotalC - cpuTotalP;
            var cpuID = cpuIdleC - cpuIdleP;
            deltas.per_cpu_pct[cpuKey] = cpuTD > 0 ? ((cpuTD - cpuID) / cpuTD) * 100 : 0;
        }
    }

    // KSM scan rate
    var ksmPrev = prev.ksm || {};
    var ksmCurr = curr.ksm || {};
    deltas.ksm_scans_delta = (ksmCurr.full_scans || 0) - (ksmPrev.full_scans || 0);
    deltas.ksm_scans_per_min = dt > 0 ? (deltas.ksm_scans_delta / dt) * 60 : 0;

    // KSM savings
    deltas.ksm_saved_bytes = ksmCurr.estimated_saved_bytes || 0;

    // Memory available
    deltas.mem_available = curr.meminfo ? curr.meminfo.MemAvailable || 0 : 0;

    // zram metrics
    var z = curr.zram && curr.zram[0] ? curr.zram[0] : {};
    deltas.zram_saved_bytes = z.estimated_saved_bytes || 0;
    deltas.zram_data_bytes = z.data_bytes || 0;
    deltas.zram_mem_used_bytes = z.mem_used_bytes || 0;
    deltas.zram_compr_ratio = z.mem_used_bytes > 0 ? z.data_bytes / z.mem_used_bytes : 0;

    // zram bd_stat I/O deltas (reads/writes per second)
    var zprev = prev.zram && prev.zram[0] ? prev.zram[0] : {};
    var zcurr = curr.zram && curr.zram[0] ? curr.zram[0] : {};
    if (zprev.bd_stat && zcurr.bd_stat) {
        deltas.zram_reads_per_sec = ((zcurr.bd_stat.reads_completed || 0) - (zprev.bd_stat.reads_completed || 0)) / dt;
        deltas.zram_writes_per_sec = ((zcurr.bd_stat.writes_completed || 0) - (zprev.bd_stat.writes_completed || 0)) / dt;
    } else {
        deltas.zram_reads_per_sec = 0;
        deltas.zram_writes_per_sec = 0;
    }

    // Swap page-in/page-out rates from /proc/vmstat
    var vmPrev = prev.vmstat_swap || {};
    var vmCurr = curr.vmstat_swap || {};
    deltas.pswpin_per_sec = dt > 0 ? ((vmCurr.pswpin || 0) - (vmPrev.pswpin || 0)) / dt : 0;
    deltas.pswpout_per_sec = dt > 0 ? ((vmCurr.pswpout || 0) - (vmPrev.pswpout || 0)) / dt : 0;
    deltas.pgsteal_kswapd_per_sec = dt > 0 ? ((vmCurr.pgsteal_kswapd || 0) - (vmPrev.pgsteal_kswapd || 0)) / dt : 0;
    deltas.pgsteal_direct_per_sec = dt > 0 ? ((vmCurr.pgsteal_direct || 0) - (vmPrev.pgsteal_direct || 0)) / dt : 0;
    deltas.pgscan_kswapd_per_sec = dt > 0 ? ((vmCurr.pgscan_kswapd || 0) - (vmPrev.pgscan_kswapd || 0)) / dt : 0;

    // kswapd CPU for zram cost
    deltas.kswapd_cpu_core_pct = (deltas.mm_breakdown.kswapd0 || 0) + (deltas.mm_breakdown.kswapd1 || 0);
    deltas.kswapd_cpu_host_pct = deltas.kswapd_cpu_core_pct / numCpus;

    return deltas;
}

// ---------------------------------------------------------------------------
// KSM verdict logic
// ---------------------------------------------------------------------------

function ksmVerdict(savedGiB, hostCpuPct) {
    if (savedGiB <= 0 && hostCpuPct <= 0.01) {
        return { level: "inactive", label: "INACTIVE", cls: "verdict-inactive" };
    }
    var efficiency = hostCpuPct > 0.01 ? savedGiB / hostCpuPct : 9999;
    if ((savedGiB > 5 && hostCpuPct < 2) || efficiency > 10) {
        return { level: "effective", label: "EFFECTIVE", cls: "verdict-good" };
    }
    if (efficiency < 2 || (hostCpuPct > 5 && savedGiB < 1)) {
        return { level: "waste", label: "WASTE", cls: "verdict-bad" };
    }
    return { level: "marginal", label: "MARGINAL", cls: "verdict-warn" };
}

function ksmRecommendation(curr, deltas) {
    var ksm = curr.ksm || {};
    var progress = curr.ksm_progress_state;
    var savedGiB = (ksm.estimated_saved_bytes || 0) / GiB;
    var hostCpu = deltas ? deltas.ksmd_cpu_host_pct || 0 : 0;
    var fullScans = ksm.full_scans || 0;
    var sleepMs = ksm.sleep_millisecs || 20;
    var pagesToScan = ksm.pages_to_scan || 1000;

    if (progress === "disabled") {
        return "KSM is disabled. Enable with: echo 1 > /sys/kernel/mm/ksm/run";
    }
    if (progress === "first-scan-pending") {
        return "KSM is performing its initial scan. Savings will appear after the first full scan completes.";
    }
    if (savedGiB > 10 && hostCpu < 1) {
        return "KSM is highly effective. No tuning needed.";
    }
    if (savedGiB > 5 && hostCpu < 3) {
        return "KSM is moderately effective. Current settings are reasonable.";
    }
    if (savedGiB < 2 && hostCpu > 2) {
        return "KSM is spending more CPU than it saves memory. Consider: increase sleep_millisecs from " +
            sleepMs + " to " + (sleepMs * 2) + ", or decrease pages_to_scan from " + pagesToScan +
            " to " + Math.floor(pagesToScan / 2) + ".";
    }
    if (savedGiB < 0.5 && fullScans > 5) {
        return "KSM has completed " + fullScans + " scans but found minimal sharing. " +
            "The workload may not benefit from KSM.";
    }
    return "KSM is active and scanning.";
}

// ---------------------------------------------------------------------------
// Render: KSM Panel
// ---------------------------------------------------------------------------

function renderKSM(curr, deltas) {
    var container = clearEl("ksm-content");
    if (!container) return;

    var ksm = curr.ksm || {};
    var savedBytes = ksm.estimated_saved_bytes || 0;
    var savedGiB = savedBytes / GiB;
    var pagesSharing = ksm.pages_sharing || 0;
    var pagesShared = ksm.pages_shared || 0;
    var pagesVolatile = ksm.pages_volatile || 0;
    var pagesUnshared = ksm.pages_unshared || 0;
    var zeroPages = ksm.ksm_zero_pages || 0;
    var fullScans = ksm.full_scans || 0;
    var pagesToScan = ksm.pages_to_scan || 0;
    var sleepMs = ksm.sleep_millisecs || 0;

    var ksmdCorePct = deltas ? deltas.ksmd_cpu_core_pct || 0 : 0;
    var ksmdHostPct = deltas ? deltas.ksmd_cpu_host_pct || 0 : 0;

    // Verdict
    var verdict = ksmVerdict(savedGiB, ksmdHostPct);

    // Verdict gauge bar
    var gauge = el("div", { className: "ksm-gauge" }, [
        el("div", { className: "ksm-gauge-zone ksm-gauge-bad", textContent: "WASTE" }),
        el("div", { className: "ksm-gauge-zone ksm-gauge-warn", textContent: "MARGINAL" }),
        el("div", { className: "ksm-gauge-zone ksm-gauge-good", textContent: "EFFECTIVE" }),
    ]);

    // Position indicator
    var indicatorPct;
    if (verdict.level === "waste") indicatorPct = 12;
    else if (verdict.level === "marginal") indicatorPct = 50;
    else if (verdict.level === "effective") indicatorPct = 83;
    else indicatorPct = 50;

    var indicator = el("div", { className: "ksm-gauge-indicator" });
    indicator.style.left = indicatorPct + "%";
    gauge.appendChild(indicator);

    container.appendChild(gauge);

    // Summary line
    var summaryText = "Saving " + humanGiB(savedBytes) + " at " + pct(ksmdHostPct, 2) + " host CPU";
    var summaryLine = el("div", { className: "ksm-summary" }, [
        el("span", { className: "ksm-verdict " + verdict.cls, textContent: verdict.label }),
        el("span", { textContent: "  " + summaryText }),
    ]);
    container.appendChild(summaryLine);

    // Sparklines row
    var sparkRow = el("div", { className: "sparkline-row" });

    // KSM savings sparkline
    var savingsData = historySlice("ksm_saved_gib");
    var savingsGroup = el("div", { className: "sparkline-group" });
    savingsGroup.appendChild(el("div", { className: "sparkline-label", textContent: "KSM Savings" }));
    var savingsCanvas = el("canvas", { className: "sparkline-canvas" });
    savingsGroup.appendChild(savingsCanvas);
    savingsGroup.appendChild(el("div", { className: "sparkline-value", textContent: savedGiB.toFixed(1) + " GiB" }));
    sparkRow.appendChild(savingsGroup);

    // ksmd CPU sparkline
    var cpuData = historySlice("ksmd_cpu_host_pct");
    var cpuGroup = el("div", { className: "sparkline-group" });
    cpuGroup.appendChild(el("div", { className: "sparkline-label", textContent: "ksmd CPU (host)" }));
    var cpuCanvas = el("canvas", { className: "sparkline-canvas" });
    cpuGroup.appendChild(cpuCanvas);
    cpuGroup.appendChild(el("div", { className: "sparkline-value", textContent: pct(ksmdHostPct, 2) }));
    sparkRow.appendChild(cpuGroup);

    container.appendChild(sparkRow);

    // Metrics grid
    var mergeRatio = pagesShared > 0 ? (pagesSharing / pagesShared).toFixed(1) + "x" : "n/a";
    var totalMergeable = pagesSharing + pagesUnshared + pagesVolatile;
    var volatilityPct = totalMergeable > 0 ? (pagesVolatile / totalMergeable * 100) : 0;
    var scanThroughput = sleepMs > 0 ? Math.round(pagesToScan * (1000 / sleepMs)) : 0;
    var scansPerMin = deltas ? (deltas.ksm_scans_per_min || 0).toFixed(1) : "n/a";

    var metricsGrid = el("div", { className: "metrics-grid" }, [
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Merge ratio" }),
            el("span", { className: "metric-value", textContent: mergeRatio }),
        ]),
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Scan rate" }),
            el("span", { className: "metric-value", textContent: fmtInt(scanThroughput) + " pg/s" }),
        ]),
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Full scans" }),
            el("span", { className: "metric-value", textContent: fmtInt(fullScans) + " (+" + scansPerMin + "/min)" }),
        ]),
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Volatility" }),
            el("span", { className: "metric-value", textContent: pct(volatilityPct) }),
        ]),
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Zero pages" + (ksm.use_zero_pages === 0 ? " (disabled)" : "") }),
            el("span", { className: "metric-value", textContent: fmtInt(zeroPages) }),
        ]),
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "ksmd CPU (core)" }),
            el("span", { className: "metric-value", textContent: pct(ksmdCorePct, 2) }),
        ]),
    ]);
    container.appendChild(metricsGrid);

    // Recommendation
    var rec = ksmRecommendation(curr, deltas);
    container.appendChild(el("div", { className: "ksm-recommendation", textContent: rec }));

    // Deferred sparkline draws (after DOM insertion)
    requestAnimationFrame(function () {
        if (savingsData.length >= 2) {
            drawSparkline(savingsCanvas, savingsData, {
                color: "#2e7d32", fill: "rgba(46,125,50,0.12)",
                min: 0, spotColor: "#2e7d32",
            });
        }
        if (cpuData.length >= 2) {
            drawSparkline(cpuCanvas, cpuData, {
                color: "#e65100", fill: "rgba(230,81,0,0.10)",
                min: 0, spotColor: "#e65100",
            });
        }
    });
}

// ---------------------------------------------------------------------------
// Render: CPU Panel
// ---------------------------------------------------------------------------

function renderCPU(curr, deltas) {
    var container = clearEl("cpu-content");
    if (!container) return;

    var numCpus = curr.num_cpus || 96;
    var hostCpuPct = deltas ? deltas.host_cpu_pct || 0 : 0;
    var coresUsed = (hostCpuPct / 100) * numCpus;

    // Host summary + sparkline
    var hostRow = el("div", { className: "cpu-host-row" });
    hostRow.appendChild(el("span", { className: "cpu-host-summary",
        textContent: "Host: " + pct(hostCpuPct) + " utilized (" + coresUsed.toFixed(1) + " / " + numCpus + " cores)" }));
    var hostCanvas = el("canvas", { className: "sparkline-canvas sparkline-inline" });
    hostRow.appendChild(hostCanvas);
    container.appendChild(hostRow);

    // vCPU oversubscription summary
    var totalVcpus = state.guestVcpus || 0;
    var poolMap = curr.cpu_pool_map || {};
    var guestDomainCpus = 0;
    for (var cpuId in poolMap) {
        if (poolMap[cpuId] === "guest_domain") guestDomainCpus++;
    }
    var stealPct = deltas ? deltas.host_steal_pct || 0 : 0;

    if (totalVcpus > 0 && guestDomainCpus > 0) {
        var oversubRatio = totalVcpus / guestDomainCpus;
        var ratioClass = oversubRatio <= 1.0 ? "ratio-green" : oversubRatio <= 2.0 ? "ratio-amber" : "ratio-red";

        var oversubGrid = el("div", { className: "metrics-grid" });
        oversubGrid.appendChild(el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "vCPU oversubscription" }),
            el("span", { className: "metric-value " + ratioClass, textContent: oversubRatio.toFixed(2) + ":1" }),
        ]));
        oversubGrid.appendChild(el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Total guest vCPUs" }),
            el("span", { className: "metric-value", textContent: totalVcpus + " vCPUs / " + guestDomainCpus + " pCPUs" }),
        ]));
        oversubGrid.appendChild(el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Host steal time" }),
            el("span", { className: "metric-value" + (stealPct > 1 ? " metric-warn" : ""),
                textContent: pct(stealPct, 2) }),
        ]));

        container.appendChild(oversubGrid);

        // Per-tier vCPU density — own row
        if (state.tierTotals) {
            var tierGrid = el("div", { className: "metrics-grid" });
            for (var oti = 0; oti < TIER_ORDER.length; oti++) {
                var oTier = TIER_ORDER[oti];
                var tt = state.tierTotals[oTier];
                if (!tt) continue;
                var tierVcpus = tt.vcpus || 0;
                var tierDomains = tt.domains || 0;
                tierGrid.appendChild(el("div", { className: "metric" }, [
                    el("span", { className: "metric-label", textContent: oTier.charAt(0).toUpperCase() + oTier.slice(1) + " tier" }),
                    el("span", { className: "metric-value", textContent: tierVcpus + " vCPUs across " + tierDomains + " VMs" }),
                ]));
            }
            container.appendChild(tierGrid);
        }
    }

    // Tier bars
    var tierBarCanvas = el("canvas", { className: "tier-bar-canvas" });
    container.appendChild(tierBarCanvas);

    // Tier legend
    var tierLegend = el("div", { className: "tier-legend" });
    for (var ti = 0; ti < TIER_ORDER.length; ti++) {
        var tier = TIER_ORDER[ti];
        var tc = deltas && deltas.tier_cpu[tier] ? deltas.tier_cpu[tier] : { core_pct: 0, host_pct: 0, throttled_events: 0 };
        var weight = curr.tier_cgroups && curr.tier_cgroups[tier] ? curr.tier_cgroups[tier].cpu_weight || 0 : 0;
        var legendItem = el("div", { className: "tier-legend-item" }, [
            el("span", { className: "tier-dot", style: "background:" + TIER_COLORS[tier] }),
            el("span", { textContent: tier.charAt(0).toUpperCase() + tier.slice(1) +
                " (W:" + weight + ") " + pct(tc.host_pct) + " host" }),
        ]);
        if (tc.throttled_events > 0) {
            legendItem.appendChild(el("span", { className: "throttle-badge",
                textContent: tc.throttled_events + " throttled" }));
        }
        tierLegend.appendChild(legendItem);
    }
    container.appendChild(tierLegend);

    // Per-domain table
    if (state.domains && state.domains.length > 0) {
        var table = el("table", { className: "domain-table" });
        var thead = el("thead", null, [
            el("tr", null, [
                el("th", { textContent: "VM" }),
                el("th", { textContent: "Tier" }),
                el("th", { textContent: "vCPU" }),
                el("th", { textContent: "CPU (cores)" }),
                el("th", { textContent: "CPU %" }),
                el("th", { textContent: "Trend" }),
            ]),
        ]);
        table.appendChild(thead);

        var tbody = el("tbody");
        var sorted = state.domains.slice().sort(function (a, b) {
            var ao = TIER_ORDER.indexOf(a.tier);
            var bo = TIER_ORDER.indexOf(b.tier);
            if (ao !== bo) return ao - bo;
            var acpu = deltas && deltas.domain_cpu[a.name] ? deltas.domain_cpu[a.name] : 0;
            var bcpu = deltas && deltas.domain_cpu[b.name] ? deltas.domain_cpu[b.name] : 0;
            return bcpu - acpu;
        });

        for (var di = 0; di < sorted.length; di++) {
            var dom = sorted[di];
            var domCpuPct = deltas && deltas.domain_cpu[dom.name] ? deltas.domain_cpu[dom.name] : 0;
            var domCores = domCpuPct / 100;
            var tierBadge = el("span", { className: "tier-badge tier-badge-" + dom.tier, textContent: dom.tier });
            var sparkTd = el("td");
            var sparkCanvas = el("canvas", { className: "sparkline-canvas sparkline-small",
                "data-domain": dom.name });
            sparkTd.appendChild(sparkCanvas);
            var row = el("tr", null, [
                el("td", { textContent: dom.name }),
                el("td", null, [tierBadge]),
                el("td", { textContent: dom.vcpus.toString() }),
                el("td", { textContent: domCores.toFixed(2) }),
                el("td", { textContent: pct(domCpuPct) }),
                sparkTd,
            ]);
            tbody.appendChild(row);
        }
        table.appendChild(tbody);
        container.appendChild(table);
    }

    // Deferred draws
    requestAnimationFrame(function () {
        var hostData = historySlice("host_cpu_pct");
        if (hostData.length >= 2) {
            drawSparkline(hostCanvas, hostData, {
                color: "#1565c0", fill: "rgba(21,101,192,0.10)",
                min: 0, max: 100, spotColor: "#1565c0",
            });
        }

        // Tier stacked bar
        if (deltas) {
            var segments = [];
            for (var i = 0; i < TIER_ORDER.length; i++) {
                var t = TIER_ORDER[i];
                var val = deltas.tier_cpu[t] ? deltas.tier_cpu[t].host_pct : 0;
                segments.push({ value: Math.max(val, 0), color: TIER_COLORS[t] });
            }
            drawStackedBar(tierBarCanvas, segments, 100);
        }

        // Per-domain sparklines
        if (state.domains) {
            for (var j = 0; j < state.domains.length; j++) {
                var dName = state.domains[j].name;
                var dCanvas = container.querySelector('canvas[data-domain="' + dName + '"]');
                if (dCanvas) {
                    var dData = state.history.map(function (h) {
                        return h.domain_cpu && h.domain_cpu[dName] ? h.domain_cpu[dName] : 0;
                    });
                    if (dData.length >= 2) {
                        drawSparkline(dCanvas, dData, {
                            color: TIER_COLORS[state.domains[j].tier] || "#666",
                            min: 0, spotColor: TIER_COLORS[state.domains[j].tier],
                        });
                    }
                }
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Render: CPU Pool Topology
// ---------------------------------------------------------------------------

var POOL_COLORS = {
    host_housekeeping: { base: "#1565c0", label: "Host Housekeeping" },
    host_emulator:     { base: "#7b1fa2", label: "Host Emulator" },
    host_reserved:     { base: "#ef6c00", label: "Host Reserved" },
    guest_domain:      { base: "#2e7d32", label: "Guest Domain" },
};

function expandCpuRange(rangeStr) {
    var result = [];
    var parts = rangeStr.split(",");
    for (var i = 0; i < parts.length; i++) {
        var p = parts[i].trim();
        if (p.indexOf("-") !== -1) {
            var se = p.split("-");
            for (var n = parseInt(se[0], 10); n <= parseInt(se[1], 10); n++) result.push(n);
        } else {
            result.push(parseInt(p, 10));
        }
    }
    return result;
}

function cpuCellColor(pool, utilPct) {
    var c = POOL_COLORS[pool] || { base: "#666" };
    // Convert hex to RGB, then apply alpha based on utilization
    var hex = c.base;
    var r = parseInt(hex.substr(1, 2), 16);
    var g = parseInt(hex.substr(3, 2), 16);
    var b = parseInt(hex.substr(5, 2), 16);
    // Minimum opacity 0.15 for idle, scales to 1.0 at 100%
    var alpha = 0.15 + (utilPct / 100) * 0.85;
    return "rgba(" + r + "," + g + "," + b + "," + alpha.toFixed(2) + ")";
}

function renderCPUMap(curr, deltas) {
    var container = clearEl("cpu-map-content");
    if (!container) return;

    var poolMap = curr.cpu_pool_map;
    var topology = curr.cpu_topology;
    var perCpu = deltas ? deltas.per_cpu_pct || {} : {};
    var cpuFreq = curr.cpu_freq || {};

    if (!poolMap || !topology || !topology.socket_map) {
        container.innerHTML = '<div class="panel-placeholder">No topology data available</div>';
        return;
    }

    var cps = topology.cores_per_socket || 24;

    // Pool utilization summary
    var poolStats = {};
    for (var poolName in POOL_COLORS) {
        poolStats[poolName] = { count: 0, totalUtil: 0 };
    }
    for (var cpuId in poolMap) {
        var pn = poolMap[cpuId];
        if (!poolStats[pn]) poolStats[pn] = { count: 0, totalUtil: 0 };
        poolStats[pn].count++;
        var cpuKey = "cpu" + cpuId;
        poolStats[pn].totalUtil += (perCpu[cpuKey] || 0);
    }

    // Legend
    var legend = el("div", { className: "cpu-map-legend" });
    var poolOrder = ["host_housekeeping", "host_emulator", "host_reserved", "guest_domain"];
    for (var pi = 0; pi < poolOrder.length; pi++) {
        var pk = poolOrder[pi];
        var pc = POOL_COLORS[pk];
        if (!pc) continue;
        var ps = poolStats[pk] || { count: 0, totalUtil: 0 };
        if (ps.count === 0) continue;  // skip pools with no assigned CPUs
        var avgUtil = ps.totalUtil / ps.count;
        var item = el("div", { className: "cpu-map-legend-item" });
        var swatch = el("span", { className: "cpu-map-swatch" });
        swatch.style.background = pc.base;
        item.appendChild(swatch);
        item.appendChild(document.createTextNode(
            pc.label + " (" + ps.count + " CPUs, " + avgUtil.toFixed(1) + "% avg)"
        ));
        legend.appendChild(item);
    }
    container.appendChild(legend);

    // Render each socket
    for (var s = 0; s < topology.sockets; s++) {
        var sk = String(s);
        var sData = topology.socket_map[sk];
        if (!sData) continue;

        var primary = expandCpuRange(sData.primary);
        var smt = expandCpuRange(sData.smt);

        var socketDiv = el("div", { className: "cpu-map-numa" });

        // Compute NUMA-level avg util
        var socketTotal = 0;
        var socketCount = primary.length + smt.length;
        for (var si = 0; si < primary.length; si++) {
            socketTotal += (perCpu["cpu" + primary[si]] || 0);
        }
        for (var si2 = 0; si2 < smt.length; si2++) {
            socketTotal += (perCpu["cpu" + smt[si2]] || 0);
        }
        var socketAvg = socketCount > 0 ? socketTotal / socketCount : 0;
        socketDiv.appendChild(el("div", { className: "cpu-map-numa-label",
            textContent: "NUMA Node " + s + "  \u2014  Socket " + s + " (" + socketCount + " threads, " + socketAvg.toFixed(1) + "% avg)" }));

        // Core number header
        var headerRow = el("div", { className: "cpu-map-row cpu-map-header" });
        headerRow.appendChild(el("div", { className: "cpu-map-label" }));
        for (var ci = 0; ci < cps; ci++) {
            headerRow.appendChild(el("div", { className: "cpu-map-hdr-cell", textContent: String(ci) }));
        }
        socketDiv.appendChild(headerRow);

        // Per-pool frequency accumulators for this NUMA node
        var numaPoolFreq = {};  // pool -> { sum, count }

        // Helper to build a cell and accumulate freq stats
        function makeCell(cpuNum) {
            var cpuKey = "cpu" + cpuNum;
            var util = perCpu[cpuKey] || 0;
            var pool = poolMap[String(cpuNum)] || "unknown";
            var freqMhz = cpuFreq[cpuKey] || 0;
            var freqGhz = freqMhz / 1000;

            // Accumulate per-pool freq for this NUMA node
            if (!numaPoolFreq[pool]) numaPoolFreq[pool] = { sum: 0, count: 0 };
            if (freqMhz > 0) {
                numaPoolFreq[pool].sum += freqMhz;
                numaPoolFreq[pool].count++;
            }

            var tip = "cpu" + cpuNum + " [" + (POOL_COLORS[pool] ? POOL_COLORS[pool].label : pool) + "] " +
                util.toFixed(1) + "%" + (freqMhz > 0 ? " @ " + freqGhz.toFixed(2) + " GHz" : "");
            var cell = el("div", { className: "cpu-map-cell" + (util >= 80 ? " cpu-map-cell-hot" : ""), title: tip });
            cell.style.background = cpuCellColor(pool, util);
            if (util >= 80) cell.textContent = Math.round(util);
            return cell;
        }

        // Primary thread row (T0)
        var row0 = el("div", { className: "cpu-map-row" });
        row0.appendChild(el("div", { className: "cpu-map-label", textContent: "T0" }));
        for (var c0 = 0; c0 < primary.length; c0++) row0.appendChild(makeCell(primary[c0]));
        socketDiv.appendChild(row0);

        // SMT thread row (T1)
        var row1 = el("div", { className: "cpu-map-row" });
        row1.appendChild(el("div", { className: "cpu-map-label", textContent: "T1" }));
        for (var c1 = 0; c1 < smt.length; c1++) row1.appendChild(makeCell(smt[c1]));
        socketDiv.appendChild(row1);

        // Per-pool average frequency line
        var freqLine = el("div", { className: "cpu-map-freq-row" });
        for (var fi = 0; fi < poolOrder.length; fi++) {
            var fpk = poolOrder[fi];
            var fpc = POOL_COLORS[fpk];
            if (!fpc) continue;
            var fpf = numaPoolFreq[fpk];
            if (!fpf || fpf.count === 0) continue;
            var avgGhz = (fpf.sum / fpf.count) / 1000;
            var fItem = el("span", { className: "cpu-map-freq-item" });
            var fSwatch = el("span", { className: "cpu-map-swatch" });
            fSwatch.style.background = fpc.base;
            fItem.appendChild(fSwatch);
            fItem.appendChild(document.createTextNode(" " + fpc.label.split(" ").pop() + " " + avgGhz.toFixed(2) + " GHz"));
            freqLine.appendChild(fItem);
        }
        socketDiv.appendChild(freqLine);

        container.appendChild(socketDiv);
    }
}

// ---------------------------------------------------------------------------
// Render: Memory Panel
// ---------------------------------------------------------------------------

function renderMemory(curr, deltas) {
    var container = clearEl("mem-content");
    if (!container) return;

    var mem = curr.meminfo || {};
    var ksm = curr.ksm || {};
    var total = mem.MemTotal || 1;
    var available = mem.MemAvailable || 0;
    var cached = (mem.Cached || 0) + (mem.KReclaimable || 0);
    var ksmSaved = ksm.estimated_saved_bytes || 0;
    var zramSaved = curr.zram_estimated_saved_bytes || 0;
    var used = total - available;
    var guestMem = state.guestMemoryBytes || 0;
    var overcommitRatio = guestMem / total;

    // Overcommit summary
    var overcommitClass = overcommitRatio < 1.0 ? "ratio-green" : overcommitRatio < 1.5 ? "ratio-amber" : "ratio-red";
    var summaryLine = el("div", { className: "mem-summary" }, [
        el("span", { textContent: "Host: " + humanGiB(total) + " total" }),
        el("span", { textContent: " | " + humanGiB(guestMem) + " committed" }),
        el("span", { textContent: " | " }),
        el("span", { className: overcommitClass,
            textContent: overcommitRatio.toFixed(2) + "x overcommit" }),
        el("span", { textContent: " | Available: " + humanGiB(available) }),
    ]);
    container.appendChild(summaryLine);

    // Waterfall bar
    var barCanvas = el("canvas", { className: "mem-bar-canvas" });
    container.appendChild(barCanvas);

    // Bar legend
    var barLegend = el("div", { className: "bar-legend" }, [
        el("span", { className: "legend-swatch", style: "background:#1565c0" }),
        el("span", { textContent: "Used " + humanGiB(used - cached) + "  " }),
        el("span", { className: "legend-swatch", style: "background:#64b5f6" }),
        el("span", { textContent: "Cached " + humanGiB(cached) + "  " }),
        el("span", { className: "legend-swatch", style: "background:#2e7d32" }),
        el("span", { textContent: "KSM " + humanGiB(ksmSaved) + "  " }),
        el("span", { className: "legend-swatch", style: "background:#00838f" }),
        el("span", { textContent: "zram " + humanGiB(zramSaved) + "  " }),
        el("span", { className: "legend-swatch", style: "background:#e0e0e0" }),
        el("span", { textContent: "Available " + humanGiB(available) }),
    ]);
    container.appendChild(barLegend);

    // Reclaim gains
    var gainsGrid = el("div", { className: "metrics-grid" }, [
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "KSM dedup" }),
            el("span", { className: "metric-value", textContent: humanGiB(ksmSaved) +
                " (" + fmtInt(ksm.pages_sharing || 0) + " pages)" }),
        ]),
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "KSM zero pages" }),
            el("span", { className: "metric-value", textContent: humanGiB((ksm.ksm_zero_pages || 0) * (ksm.page_size || 4096)) +
                " (" + fmtInt(ksm.ksm_zero_pages || 0) + " pages)" }),
        ]),
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Total reclaim" }),
            el("span", { className: "metric-value", textContent: humanGiB(ksmSaved + zramSaved) }),
        ]),
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "THP mode" }),
            el("span", { className: "metric-value", textContent: (curr.thp ? curr.thp.enabled : "n/a") }),
        ]),
    ]);
    container.appendChild(gainsGrid);

    // Per-tier memory table
    if (state.tierTotals) {
        var tierTable = el("table", { className: "domain-table tier-mem-table" });
        tierTable.appendChild(el("thead", null, [
            el("tr", null, [
                el("th", { textContent: "Tier" }),
                el("th", { textContent: "VMs" }),
                el("th", { textContent: "Committed" }),
                el("th", { textContent: "% of Host" }),
            ]),
        ]));
        var ttbody = el("tbody");
        for (var tti = 0; tti < TIER_ORDER.length; tti++) {
            var ttn = TIER_ORDER[tti];
            var tt = state.tierTotals[ttn] || { domains: 0, memory_bytes: 0 };
            ttbody.appendChild(el("tr", null, [
                el("td", null, [el("span", { className: "tier-badge tier-badge-" + ttn, textContent: ttn })]),
                el("td", { textContent: tt.domains.toString() }),
                el("td", { textContent: humanGiB(tt.memory_bytes) }),
                el("td", { textContent: pct(tt.memory_bytes / total * 100) }),
            ]));
        }
        tierTable.appendChild(ttbody);
        container.appendChild(tierTable);
    }

    // Deferred draws
    requestAnimationFrame(function () {
        var usedNonCached = Math.max(used - cached, 0);
        var segments = [
            { value: usedNonCached, color: "#1565c0" },
            { value: cached, color: "#64b5f6" },
            { value: available, color: "#e0e0e0" },
        ];
        drawStackedBar(barCanvas, segments, total);
    });
}

// ---------------------------------------------------------------------------
// zram verdict logic
// ---------------------------------------------------------------------------

function zramVerdict(z, deltas) {
    if (!z || !z.disksize_bytes) {
        return { level: "disabled", label: "NO DEVICE", cls: "verdict-inactive" };
    }
    var dataBytes = z.data_bytes || 0;
    var savedGiB = (z.estimated_saved_bytes || 0) / GiB;
    var swapInRate = deltas ? deltas.pswpin_per_sec || 0 : 0;
    var swapOutRate = deltas ? deltas.pswpout_per_sec || 0 : 0;
    var swapActivity = swapInRate + swapOutRate;
    var comprRatio = z.mem_used_bytes > 0 ? z.data_bytes / z.mem_used_bytes : 0;

    if (dataBytes < 4096 * 10) {
        return { level: "standby", label: "STANDBY", cls: "verdict-standby" };
    }
    if (swapActivity > 5000) {
        return { level: "thrashing", label: "THRASHING", cls: "verdict-bad" };
    }
    if (comprRatio >= 2.5 && savedGiB > 0.1) {
        return { level: "effective", label: "EFFECTIVE", cls: "verdict-good" };
    }
    if (comprRatio >= 1.5) {
        return { level: "moderate", label: "MODERATE", cls: "verdict-warn" };
    }
    if (comprRatio > 0 && comprRatio < 1.5) {
        return { level: "poor", label: "POOR COMPRESSION", cls: "verdict-bad" };
    }
    return { level: "idle", label: "IDLE", cls: "verdict-inactive" };
}

function zramRecommendation(z, deltas) {
    if (!z || !z.disksize_bytes) {
        return "No zram device configured.";
    }
    var dataBytes = z.data_bytes || 0;
    var savedGiB = (z.estimated_saved_bytes || 0) / GiB;
    var comprRatio = z.mem_used_bytes > 0 ? z.data_bytes / z.mem_used_bytes : 0;
    var swapInRate = deltas ? deltas.pswpin_per_sec || 0 : 0;
    var swapOutRate = deltas ? deltas.pswpout_per_sec || 0 : 0;
    var swapActivity = swapInRate + swapOutRate;
    var directReclaim = deltas ? deltas.pgsteal_direct_per_sec || 0 : 0;

    if (dataBytes < 4096 * 10) {
        return "zram is configured and standing by. No memory pressure is driving pages into swap. " +
            "This is expected when available memory is sufficient.";
    }
    if (swapActivity > 5000) {
        return "High swap I/O rate (" + Math.round(swapActivity) + " pg/s) indicates significant memory pressure. " +
            "Consider reducing guest memory commitments or adding physical RAM.";
    }
    if (directReclaim > 100) {
        return "Direct reclaim is active (" + Math.round(directReclaim) + " pg/s), meaning applications are " +
            "stalling on memory allocation. zram is absorbing pressure but the host is under strain.";
    }
    if (comprRatio >= 2.5) {
        return "Compression ratio is excellent (" + comprRatio.toFixed(1) + ":1). zram is efficiently " +
            "absorbing " + savedGiB.toFixed(1) + " GiB of memory pressure.";
    }
    if (comprRatio >= 1.5) {
        return "Compression ratio is moderate (" + comprRatio.toFixed(1) + ":1). The swapped pages " +
            "are compressible but not highly redundant.";
    }
    if (comprRatio > 0) {
        return "Compression ratio is poor (" + comprRatio.toFixed(1) + ":1). The swapped pages " +
            "are not very compressible — zram is providing limited benefit for the data it holds.";
    }
    return "zram is active.";
}

// ---------------------------------------------------------------------------
// Render: zram Cost-Benefit Panel
// ---------------------------------------------------------------------------

function renderZram(curr, deltas) {
    var container = clearEl("zram-content");
    if (!container) return;

    var z = curr.zram && curr.zram[0] ? curr.zram[0] : null;
    if (!z) {
        container.appendChild(el("div", { className: "panel-placeholder", textContent: "No zram device detected." }));
        return;
    }

    var verdict = zramVerdict(z, deltas);
    var mm = z.mm_stat || {};
    var io = z.io_stat || {};
    var bd = z.bd_stat || {};

    var savedBytes = z.estimated_saved_bytes || 0;
    var comprRatio = z.mem_used_bytes > 0 ? (z.data_bytes / z.mem_used_bytes) : 0;
    var disksize = z.disksize_bytes || 0;
    var dataBytes = z.data_bytes || 0;
    var memUsed = z.mem_used_bytes || 0;
    var compressedBytes = z.compressed_bytes || 0;
    var samePages = mm.same_pages || 0;
    var pagesCompacted = mm.pages_compacted || 0;
    var maxUsed = mm.max_used_memory || 0;

    // Swap utilization (how much of the zram device is occupied)
    var swapUsed = 0;
    if (curr.swap) {
        for (var si = 0; si < curr.swap.length; si++) {
            var sn = curr.swap[si].name;
            if (sn === z.name || sn === "/dev/" + z.name) {
                swapUsed = curr.swap[si].used_bytes;
            }
        }
    }
    var swapUtilPct = disksize > 0 ? (swapUsed / disksize) * 100 : 0;

    // kswapd CPU cost
    var kswapdHostPct = deltas ? deltas.kswapd_cpu_host_pct || 0 : 0;
    var kswapdCorePct = deltas ? deltas.kswapd_cpu_core_pct || 0 : 0;

    // Swap I/O rates
    var pswpinRate = deltas ? deltas.pswpin_per_sec || 0 : 0;
    var pswpoutRate = deltas ? deltas.pswpout_per_sec || 0 : 0;
    var pgscanKswapd = deltas ? deltas.pgscan_kswapd_per_sec || 0 : 0;
    var pgstealDirect = deltas ? deltas.pgsteal_direct_per_sec || 0 : 0;

    // Verdict gauge
    var gauge = el("div", { className: "zram-gauge" }, [
        el("div", { className: "zram-gauge-zone zram-gauge-thrash", textContent: "THRASHING" }),
        el("div", { className: "zram-gauge-zone zram-gauge-poor", textContent: "POOR" }),
        el("div", { className: "zram-gauge-zone zram-gauge-moderate", textContent: "MODERATE" }),
        el("div", { className: "zram-gauge-zone zram-gauge-good", textContent: "EFFECTIVE" }),
        el("div", { className: "zram-gauge-zone zram-gauge-standby", textContent: "STANDBY" }),
    ]);
    var indicatorPct;
    switch (verdict.level) {
        case "thrashing": indicatorPct = 8; break;
        case "poor": indicatorPct = 27; break;
        case "moderate": indicatorPct = 47; break;
        case "effective": indicatorPct = 67; break;
        case "standby": case "idle": case "disabled": indicatorPct = 88; break;
        default: indicatorPct = 50;
    }
    var indicator = el("div", { className: "zram-gauge-indicator" });
    indicator.style.left = indicatorPct + "%";
    gauge.appendChild(indicator);
    container.appendChild(gauge);

    // Summary line
    var summaryText;
    if (verdict.level === "standby" || verdict.level === "disabled") {
        summaryText = z.algorithm + " | " + humanBytes(disksize) + " device | no memory pressure";
    } else {
        summaryText = "Saving " + humanGiB(savedBytes) + " at " + comprRatio.toFixed(1) + ":1 compression" +
            " | kswapd: " + pct(kswapdHostPct, 2) + " host CPU";
    }
    container.appendChild(el("div", { className: "ksm-summary" }, [
        el("span", { className: "ksm-verdict " + verdict.cls, textContent: verdict.label }),
        el("span", { textContent: "  " + summaryText }),
    ]));

    // Sparklines row
    var sparkRow = el("div", { className: "sparkline-row" });

    // zram savings sparkline
    var savingsGroup = el("div", { className: "sparkline-group" });
    savingsGroup.appendChild(el("div", { className: "sparkline-label", textContent: "zram Savings" }));
    var savingsCanvas = el("canvas", { className: "sparkline-canvas" });
    savingsGroup.appendChild(savingsCanvas);
    savingsGroup.appendChild(el("div", { className: "sparkline-value", textContent: humanGiB(savedBytes) }));
    sparkRow.appendChild(savingsGroup);

    // Swap I/O rate sparkline
    var ioGroup = el("div", { className: "sparkline-group" });
    ioGroup.appendChild(el("div", { className: "sparkline-label", textContent: "Swap I/O (pg/s)" }));
    var ioCanvas = el("canvas", { className: "sparkline-canvas" });
    ioGroup.appendChild(ioCanvas);
    ioGroup.appendChild(el("div", { className: "sparkline-value",
        textContent: "in: " + Math.round(pswpinRate) + "  out: " + Math.round(pswpoutRate) }));
    sparkRow.appendChild(ioGroup);

    // Swap utilization sparkline
    var utilGroup = el("div", { className: "sparkline-group" });
    utilGroup.appendChild(el("div", { className: "sparkline-label", textContent: "Swap Utilization" }));
    var utilCanvas = el("canvas", { className: "sparkline-canvas" });
    utilGroup.appendChild(utilCanvas);
    utilGroup.appendChild(el("div", { className: "sparkline-value", textContent: pct(swapUtilPct) + " of " + humanBytes(disksize) }));
    sparkRow.appendChild(utilGroup);

    container.appendChild(sparkRow);

    // Capacity bar: data stored vs device size
    var capBarCanvas = el("canvas", { className: "mem-bar-canvas" });
    container.appendChild(capBarCanvas);
    container.appendChild(el("div", { className: "bar-legend" }, [
        el("span", { className: "legend-swatch", style: "background:#00838f" }),
        el("span", { textContent: "Compressed " + humanBytes(memUsed) + "  " }),
        el("span", { className: "legend-swatch", style: "background:#80deea" }),
        el("span", { textContent: "Saved " + humanGiB(savedBytes) + "  " }),
        el("span", { className: "legend-swatch", style: "background:#e0e0e0" }),
        el("span", { textContent: "Free " + humanBytes(Math.max(disksize - swapUsed, 0)) }),
    ]));

    // Metrics grid
    var metricsGrid = el("div", { className: "metrics-grid" }, [
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Compression ratio" }),
            el("span", { className: "metric-value", textContent: comprRatio > 0 ? comprRatio.toFixed(2) + ":1" : "n/a" }),
        ]),
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Algorithm / streams" }),
            el("span", { className: "metric-value", textContent: z.algorithm + " / " + z.streams }),
        ]),
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Original data" }),
            el("span", { className: "metric-value", textContent: humanBytes(dataBytes) }),
        ]),
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Compressed to" }),
            el("span", { className: "metric-value", textContent: humanBytes(compressedBytes) }),
        ]),
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "RAM consumed" }),
            el("span", { className: "metric-value", textContent: humanBytes(memUsed) + (maxUsed > 0 ? " (peak: " + humanBytes(maxUsed) + ")" : "") }),
        ]),
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Same pages (dedup)" }),
            el("span", { className: "metric-value", textContent: fmtInt(samePages) }),
        ]),
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Pages compacted" }),
            el("span", { className: "metric-value", textContent: fmtInt(pagesCompacted) }),
        ]),
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "kswapd CPU (host)" }),
            el("span", { className: "metric-value", textContent: pct(kswapdHostPct, 2) + " (" + pct(kswapdCorePct, 2) + " core)" }),
        ]),
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Swap in rate" }),
            el("span", { className: "metric-value", textContent: Math.round(pswpinRate) + " pg/s" }),
        ]),
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Swap out rate" }),
            el("span", { className: "metric-value", textContent: Math.round(pswpoutRate) + " pg/s" }),
        ]),
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "kswapd scan rate" }),
            el("span", { className: "metric-value", textContent: Math.round(pgscanKswapd) + " pg/s" }),
        ]),
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Direct reclaim" }),
            el("span", { className: "metric-value",
                textContent: Math.round(pgstealDirect) + " pg/s",
                className: "metric-value" + (pgstealDirect > 0 ? " metric-warn" : "") }),
        ]),
    ]);
    container.appendChild(metricsGrid);

    // I/O errors (if any)
    if (io.failed_reads > 0 || io.failed_writes > 0 || io.invalid_io > 0) {
        container.appendChild(el("div", { className: "zram-io-errors" },
            [el("span", { textContent: "I/O errors: " + io.failed_reads + " failed reads, " +
                io.failed_writes + " failed writes, " + io.invalid_io + " invalid I/O" })]));
    }

    // Recommendation
    var rec = zramRecommendation(z, deltas);
    container.appendChild(el("div", { className: "ksm-recommendation", textContent: rec }));

    // Deferred sparkline draws
    requestAnimationFrame(function () {
        var savingsData = historySlice("zram_saved_gib");
        if (savingsData.length >= 2) {
            drawSparkline(savingsCanvas, savingsData, {
                color: "#00838f", fill: "rgba(0,131,143,0.10)",
                min: 0, spotColor: "#00838f",
            });
        }
        var ioData = historySlice("zram_swap_io_rate");
        if (ioData.length >= 2) {
            drawSparkline(ioCanvas, ioData, {
                color: "#e65100", fill: "rgba(230,81,0,0.08)",
                min: 0, spotColor: "#e65100",
            });
        }
        var utilData = historySlice("zram_swap_util_pct");
        if (utilData.length >= 2) {
            drawSparkline(utilCanvas, utilData, {
                color: "#1565c0", fill: "rgba(21,101,192,0.08)",
                min: 0, max: 100, spotColor: "#1565c0",
            });
        }

        // Capacity bar
        var segments = [
            { value: memUsed, color: "#00838f" },
            { value: Math.max(savedBytes, 0), color: "#80deea" },
            { value: Math.max(disksize - swapUsed, 0), color: "#e0e0e0" },
        ];
        drawStackedBar(capBarCanvas, segments, disksize || 1);
    });
}

// ---------------------------------------------------------------------------
// Render: Memory Management Overhead Panel
// ---------------------------------------------------------------------------

function renderOverhead(curr, deltas) {
    var container = clearEl("overhead-content");
    if (!container) return;

    var threads = ["ksmd", "kswapd0", "kswapd1", "kcompactd0", "kcompactd1"];
    var totalPct = deltas ? deltas.mm_cpu_core_pct || 0 : 0;
    var numCpus = curr.num_cpus || 96;
    var hostPct = totalPct / numCpus;

    // Summary
    var parts = [];
    for (var i = 0; i < threads.length; i++) {
        var name = threads[i];
        var val = deltas && deltas.mm_breakdown ? deltas.mm_breakdown[name] || 0 : 0;
        parts.push(name + ": " + pct(val, 2));
    }
    container.appendChild(el("div", { className: "overhead-summary" },
        [el("span", { textContent: parts.join("   ") + "   total: " + pct(totalPct, 2) +
            " core (" + pct(hostPct, 2) + " host)" })]));

    // Sparklines
    var sparkRow = el("div", { className: "sparkline-row sparkline-wrap" });
    for (var j = 0; j < threads.length; j++) {
        var tname = threads[j];
        var group = el("div", { className: "sparkline-group sparkline-narrow" });
        group.appendChild(el("div", { className: "sparkline-label", textContent: tname }));
        var canvas = el("canvas", { className: "sparkline-canvas", "data-thread": tname });
        group.appendChild(canvas);
        var tval = deltas && deltas.mm_breakdown ? deltas.mm_breakdown[tname] || 0 : 0;
        group.appendChild(el("div", { className: "sparkline-value", textContent: pct(tval, 2) }));
        sparkRow.appendChild(group);
    }
    container.appendChild(sparkRow);

    // Deferred sparkline draws
    requestAnimationFrame(function () {
        for (var k = 0; k < threads.length; k++) {
            var tn = threads[k];
            var tc = container.querySelector('canvas[data-thread="' + tn + '"]');
            if (tc) {
                var tdata = state.history.map(function (h) {
                    return h.mm_breakdown && h.mm_breakdown[tn] ? h.mm_breakdown[tn] : 0;
                });
                if (tdata.length >= 2) {
                    drawSparkline(tc, tdata, {
                        color: "#e65100", min: 0, spotColor: "#e65100",
                    });
                }
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

function render() {
    var curr = state.current;
    if (!curr) return;

    var deltas = state.history.length > 0 ? state.history[state.history.length - 1] : null;

    renderKSM(curr, deltas);
    renderCPU(curr, deltas);
    renderCPUMap(curr, deltas);
    renderMemory(curr, deltas);
    renderZram(curr, deltas);
    renderOverhead(curr, deltas);
}

// ---------------------------------------------------------------------------
// Poll cycle
// ---------------------------------------------------------------------------

function processSample(data, isFull) {
    if (data.error) {
        showError(data.error);
        return;
    }
    clearError();

    // Merge domain info from full polls
    if (isFull && data.domains) {
        state.domains = data.domains;
        state.tierTotals = data.tier_totals;
        state.domainCgroups = data.domain_cgroups;
        state.guestMemoryBytes = data.guest_memory_bytes || 0;
        state.guestVcpus = data.guest_vcpus || 0;
    }

    // Fast polls now include live domain_cgroups from cgroup discovery.
    // Only fall back to cached data if the collector didn't return any.
    if (!isFull && !data.domain_cgroups && state.domainCgroups) {
        data.domain_cgroups = state.domainCgroups;
    }

    state.current = data;

    // Compute deltas
    if (state.prev) {
        var deltas = computeDeltas(state.prev, data);
        if (deltas) {
            // Build history entry
            var zramDev = data.zram && data.zram[0] ? data.zram[0] : {};
            var zramSwapUsed = 0;
            if (data.swap && zramDev.name) {
                for (var swi = 0; swi < data.swap.length; swi++) {
                    var swn = data.swap[swi].name;
                    if (swn === zramDev.name || swn === "/dev/" + zramDev.name) {
                        zramSwapUsed = data.swap[swi].used_bytes;
                    }
                }
            }
            var entry = {
                timestamp: data.timestamp,
                ksm_saved_gib: (data.ksm && data.ksm.estimated_saved_bytes || 0) / GiB,
                ksmd_cpu_core_pct: deltas.ksmd_cpu_core_pct,
                ksmd_cpu_host_pct: deltas.ksmd_cpu_host_pct,
                host_cpu_pct: deltas.host_cpu_pct,
                host_steal_pct: deltas.host_steal_pct,
                per_cpu_pct: deltas.per_cpu_pct,
                mem_available_gib: (data.meminfo && data.meminfo.MemAvailable || 0) / GiB,
                mm_cpu_core_pct: deltas.mm_cpu_core_pct,
                mm_breakdown: deltas.mm_breakdown,
                domain_cpu: deltas.domain_cpu,
                tier_cpu: deltas.tier_cpu,
                zram_saved_gib: (zramDev.estimated_saved_bytes || 0) / GiB,
                zram_swap_io_rate: (deltas.pswpin_per_sec || 0) + (deltas.pswpout_per_sec || 0),
                zram_swap_util_pct: zramDev.disksize_bytes > 0 ? (zramSwapUsed / zramDev.disksize_bytes) * 100 : 0,
            };
            state.history.push(entry);
            if (state.history.length > HISTORY_SIZE) {
                state.history.shift();
            }
        }
    }

    state.prev = data;

    // Update status dot
    var dot = document.getElementById("poll-status");
    if (dot) {
        dot.className = "status-dot status-dot--ok";
        dot.title = "Last sample: " + new Date(data.timestamp * 1000).toLocaleTimeString();
    }

    if (state.debug) {
        console.log("[calabi-observer] sample", data);
    }

    render();
}

function pollFast() {
    if (state.paused) return;
    fetchData(true)
        .then(function (data) { processSample(data, false); })
        .catch(function (err) { showError("Fast poll failed: " + err); });
}

function pollSlow() {
    if (state.paused) return;
    fetchData(false)
        .then(function (data) { processSample(data, true); })
        .catch(function (err) { showError("Full poll failed: " + err); });
}

function startPolling() {
    // Immediate full poll
    pollSlow();
    state.slowTimer = window.setInterval(pollSlow, state.slowInterval);
    // Fast poll starts after a short delay
    window.setTimeout(function () {
        pollFast();
        state.fastTimer = window.setInterval(pollFast, state.fastInterval);
    }, 2000);
}

function stopPolling() {
    if (state.fastTimer) { window.clearInterval(state.fastTimer); state.fastTimer = null; }
    if (state.slowTimer) { window.clearInterval(state.slowTimer); state.slowTimer = null; }
}

function restartPolling() {
    stopPolling();
    if (!state.paused) startPolling();
}

// ---------------------------------------------------------------------------
// Error display
// ---------------------------------------------------------------------------

function showError(msg) {
    var banner = document.getElementById("error-banner");
    if (banner) {
        banner.textContent = msg;
        banner.hidden = false;
    }
    var dot = document.getElementById("poll-status");
    if (dot) {
        dot.className = "status-dot status-dot--error";
        dot.title = msg;
    }
}

function clearError() {
    var banner = document.getElementById("error-banner");
    if (banner) banner.hidden = true;
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function initControls() {
    var pauseBtn = document.getElementById("pause-btn");
    if (pauseBtn) {
        pauseBtn.addEventListener("click", function () {
            state.paused = !state.paused;
            pauseBtn.textContent = state.paused ? "Resume" : "Pause";
            if (state.paused) {
                stopPolling();
                var dot = document.getElementById("poll-status");
                if (dot) { dot.className = "status-dot status-dot--paused"; dot.title = "Paused"; }
            } else {
                restartPolling();
            }
        });
    }

    var intervalSelect = document.getElementById("interval-select");
    if (intervalSelect) {
        intervalSelect.addEventListener("change", function () {
            state.fastInterval = parseInt(intervalSelect.value, 10) || 5000;
            restartPolling();
        });
    }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", function () {
    cockpit.translate();
    initControls();
    startPolling();
});
