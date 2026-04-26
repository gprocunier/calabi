/* calabi-observer.js — Calabi Observer Cockpit plugin frontend */

"use strict";

/* global cockpit, drawSparkline, drawStackedBar, drawRadialGauge */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var PROMETHEUS_CONTROL_PATH = "/usr/share/cockpit/calabi-observer/prometheus_control.py";
var METRICS_PATH = "/run/calabi-observer/metrics.json";
var TIER_COLORS = { gold: "#c9b037", silver: "#a8a9ad", bronze: "#cd7f32" };
var COLORS = {
    good: "#2e7d32", warn: "#b26a00", risk: "#ef6c00", crit: "#c62828",
    blue: "#1565c0", teal: "#00695c", purple: "#6a1b9a", amber: "#e65100",
    ksmSavings: "#2e7d32", ksmCpu: "#e65100",
    memUsed: "#1565c0", memCached: "#64b5f6", memKsm: "#2e7d32", memZram: "#00838f", memAvail: "#e0e0e0",
    zramCost: "#00695c", zramSaved: "#80cbc4", zramFree: "#dfe7eb",
    zramLine: "#00838f",
};
var TIER_ORDER = ["gold", "silver", "bronze"];
var HISTORY_SIZE = 120;
var GiB = 1073741824;
var MiB = 1048576;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

var state = {
    paused: false,
    history: [],          // rolling array of derived metrics
    prev: null,           // previous sample for delta computation
    current: null,        // most recent merged sample
    prometheusStatus: null,
    domains: null,        // cached domain list from last full sample
    tierTotals: null,
    domainCgroups: null,
    cpuPools: null,       // cached pool map from last full sample
    cpuPoolMap: null,     // cached per-CPU pool assignments from last full sample
    guestMemoryBytes: 0,
    guestVcpus: 0,
    metricFile: null,
    metricWatch: null,
    lastSampleTimestamp: 0,
    activeTab: "cpu",
    activeCpuSubTab: "performance",
    activeMemorySubTab: "ksm",
    hoverHelp: {
        x: null,
        y: null,
        text: null,
        timer: null,
        hideTimer: null,
        visible: false,
        tip: null,
    },
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

function humanRate(bytesPerSec) {
    return humanBytes(bytesPerSec) + "/s";
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
    if (e) e.replaceChildren();
    return e;
}

function historySlice(key) {
    return state.history.map(function (h) { return h[key]; });
}

function chooseRateScale(values, floor) {
    var maxVal = floor || 0;
    for (var i = 0; i < values.length; i++) {
        var v = values[i];
        if (v != null && !isNaN(v) && v > maxVal) maxVal = v;
    }
    if (maxVal <= 0) return floor || 1024;
    var steps = [1, 2, 4, 8];
    var unit = 1;
    while (true) {
        for (var si = 0; si < steps.length; si++) {
            var candidate = steps[si] * unit;
            if (candidate >= maxVal) return candidate;
        }
        unit *= 1024;
        if (unit > 1e15) return unit;
    }
}

function visualCard(label, value, fillPct, subtext, modifier, help, gaugeOpts) {
    var pctValue = Math.max(0, Math.min(fillPct || 0, 100));
    var attrs = { className: "observer-visual-card" };
    if (help) attrs["data-help"] = help;
    var children = [
        el("div", { className: "observer-visual-label", textContent: label }),
    ];
    if (gaugeOpts) {
        var gaugeCanvas = el("canvas", { className: "observer-gauge-canvas" });
        children.push(gaugeCanvas);
        children.push(el("div", { className: "observer-visual-value", textContent: value,
            style: "text-align:center; margin-top:-4px" }));
        requestAnimationFrame(function () {
            drawRadialGauge(gaugeCanvas, gaugeOpts.value, gaugeOpts.max || 100, {
                color: gaugeOpts.color || COLORS.blue,
                lineWidth: 8,
                valueText: "",
                track: "rgba(128,128,128,0.12)",
                gradient: gaugeOpts.gradient || null,
            });
        });
    } else {
        children.push(el("div", { className: "observer-visual-value", textContent: value }));
        children.push(el("div", { className: "observer-meter observer-meter--" + (modifier || "default") }, [
            el("div", { className: "observer-meter-fill", style: "width:" + pctValue.toFixed(1) + "%" }),
        ]));
    }
    children.push(el("div", { className: "observer-visual-subtext", textContent: subtext || "" }));
    return el("div", attrs, children);
}

function zramVisualCard(label, value, fillPct, meterClass, subtext, help, gaugeOpts) {
    var pctValue = Math.max(0, Math.min(fillPct || 0, 100));
    var attrs = { className: "zram-visual-card" };
    if (help) attrs["data-help"] = help;
    var children = [
        el("div", { className: "zram-visual-label", textContent: label }),
    ];
    if (gaugeOpts) {
        var gaugeCanvas = el("canvas", { className: "observer-gauge-canvas" });
        children.push(gaugeCanvas);
        children.push(el("div", { className: "zram-visual-value", textContent: value,
            style: "text-align:center; margin-top:-4px" }));
        requestAnimationFrame(function () {
            drawRadialGauge(gaugeCanvas, gaugeOpts.value, gaugeOpts.max || 100, {
                color: gaugeOpts.color || COLORS.teal,
                lineWidth: 8,
                valueText: "",
                track: "rgba(128,128,128,0.12)",
                gradient: gaugeOpts.gradient || null,
            });
        });
    } else {
        children.push(el("div", { className: "zram-visual-value", textContent: value }));
        children.push(el("div", { className: "zram-meter " + meterClass }, [
            el("div", { className: "zram-meter-fill", style: "width:" + pctValue.toFixed(1) + "%" }),
        ]));
    }
    children.push(el("div", { className: "zram-visual-subtext", textContent: subtext || "" }));
    return el("div", attrs, children);
}

function renderDispositionStrip(disposition) {
    var children = [
        el("div", { className: "disposition-strip-badge", textContent: disposition.label }),
    ];
    var fieldsContainer = el("div", { className: "disposition-strip-fields" });
    var fields = disposition.fields || [];
    for (var i = 0; i < fields.length; i++) {
        fieldsContainer.appendChild(el("span", { className: "disposition-strip-field" }, [
            el("span", { className: "disposition-strip-label", textContent: fields[i].label }),
            el("span", { className: "disposition-strip-value", textContent: " " + fields[i].value }),
        ]));
    }
    children.push(fieldsContainer);
    return el("div", { className: "disposition-strip disposition-strip--" + disposition.level }, children);
}

function shortDomainName(name) {
    var value = String(name || "");
    var firstDot = value.indexOf(".");
    return firstDot > 0 ? value.slice(0, firstDot) : value;
}

function setActiveTab(tabName) {
    state.activeTab = tabName || "cpu";
    try {
        window.localStorage.setItem("calabi-observer-tab", state.activeTab);
    } catch (_err) {
        // Ignore storage failures in restricted browser contexts.
    }
    document.querySelectorAll(".observer-tab").forEach(function (button) {
        button.classList.toggle("is-active", button.getAttribute("data-tab") === state.activeTab);
        button.setAttribute("aria-selected", button.getAttribute("data-tab") === state.activeTab ? "true" : "false");
    });
    document.querySelectorAll(".tab-panel").forEach(function (panel) {
        panel.classList.toggle("is-active", panel.getAttribute("data-tab-panel") === state.activeTab);
    });
    render();
    if (state.activeTab === "configuration") renderPrometheus();
    maintainHoverHelp();
}

function syncCpuSubTabs() {
    document.querySelectorAll(".cpu-subtab").forEach(function (button) {
        button.classList.toggle("is-active", button.getAttribute("data-cpu-tab") === state.activeCpuSubTab);
        button.setAttribute("aria-selected", button.getAttribute("data-cpu-tab") === state.activeCpuSubTab ? "true" : "false");
    });
    document.querySelectorAll(".cpu-subtab-panel").forEach(function (panel) {
        panel.classList.toggle("is-active", panel.getAttribute("data-cpu-panel") === state.activeCpuSubTab);
    });
}

function setActiveCpuSubTab(tabName) {
    state.activeCpuSubTab = tabName === "topology" ? "topology" : tabName === "ecc" ? "ecc" : "performance";
    try {
        window.localStorage.setItem("calabi-observer-cpu-tab", state.activeCpuSubTab);
    } catch (_err) {
        // Ignore storage failures in restricted browser contexts.
    }
    syncCpuSubTabs();
    if (state.activeTab === "cpu") render();
    maintainHoverHelp();
}

function syncMemorySubTabs() {
    document.querySelectorAll(".memory-subtab").forEach(function (button) {
        button.classList.toggle("is-active", button.getAttribute("data-memory-tab") === state.activeMemorySubTab);
        button.setAttribute("aria-selected", button.getAttribute("data-memory-tab") === state.activeMemorySubTab ? "true" : "false");
    });
    document.querySelectorAll(".memory-subtab-panel").forEach(function (panel) {
        panel.classList.toggle("is-active", panel.getAttribute("data-memory-panel") === state.activeMemorySubTab);
    });
}

function setActiveMemorySubTab(tabName) {
    state.activeMemorySubTab = tabName === "zram" ? "zram" : "ksm";
    try {
        window.localStorage.setItem("calabi-observer-memory-tab", state.activeMemorySubTab);
    } catch (_err) {
        // Ignore storage failures in restricted browser contexts.
    }
    syncMemorySubTabs();
    if (state.activeTab === "memory") render();
    maintainHoverHelp();
}

function initTabs() {
    try {
        state.activeTab = window.localStorage.getItem("calabi-observer-tab") || state.activeTab;
    } catch (_err) {
        state.activeTab = "cpu";
    }
    document.querySelectorAll(".observer-tab").forEach(function (button) {
        button.addEventListener("click", function () {
            setActiveTab(button.getAttribute("data-tab"));
        });
    });
    setActiveTab(state.activeTab);
}

function initCpuSubTabs() {
    try {
        state.activeCpuSubTab = window.localStorage.getItem("calabi-observer-cpu-tab") || state.activeCpuSubTab;
    } catch (_err) {
        state.activeCpuSubTab = "performance";
    }
    if (state.activeCpuSubTab !== "performance" && state.activeCpuSubTab !== "topology" && state.activeCpuSubTab !== "ecc") {
        state.activeCpuSubTab = "performance";
    }
    document.querySelectorAll(".cpu-subtab").forEach(function (button) {
        button.addEventListener("click", function () {
            setActiveCpuSubTab(button.getAttribute("data-cpu-tab"));
        });
    });
    syncCpuSubTabs();
}

function initMemorySubTabs() {
    try {
        state.activeMemorySubTab = window.localStorage.getItem("calabi-observer-memory-tab") || state.activeMemorySubTab;
    } catch (_err) {
        state.activeMemorySubTab = "ksm";
    }
    if (state.activeMemorySubTab !== "ksm" && state.activeMemorySubTab !== "zram") {
        state.activeMemorySubTab = "ksm";
    }
    document.querySelectorAll(".memory-subtab").forEach(function (button) {
        button.addEventListener("click", function () {
            setActiveMemorySubTab(button.getAttribute("data-memory-tab"));
        });
    });
    syncMemorySubTabs();
}

function ensureHoverTip() {
    if (state.hoverHelp.tip) return state.hoverHelp.tip;
    state.hoverHelp.tip = el("div", { className: "observer-hover-tip", role: "tooltip" });
    document.body.appendChild(state.hoverHelp.tip);
    return state.hoverHelp.tip;
}

function positionHoverTip(x, y) {
    var tip = ensureHoverTip();
    var left = Math.min(x + 14, window.innerWidth - 340);
    var top = Math.min(y + 16, window.innerHeight - 80);
    tip.style.left = Math.max(12, left) + "px";
    tip.style.top = Math.max(12, top) + "px";
}

function showHoverHelp() {
    var hover = state.hoverHelp;
    if (!hover.text || hover.x == null || hover.y == null) return;
    var tip = ensureHoverTip();
    tip.textContent = hover.text;
    positionHoverTip(hover.x, hover.y);
    tip.classList.add("is-visible");
    hover.visible = true;
}

function clearHoverHelp() {
    var hover = state.hoverHelp;
    if (hover.timer) {
        window.clearTimeout(hover.timer);
        hover.timer = null;
    }
    if (hover.hideTimer) window.clearTimeout(hover.hideTimer);
    hover.hideTimer = window.setTimeout(function () {
        var tip = ensureHoverTip();
        tip.classList.remove("is-visible");
        hover.visible = false;
        hover.text = null;
        hover.hideTimer = null;
    }, 2800);
}

function updateHoverHelpFromPoint(x, y) {
    var hover = state.hoverHelp;
    hover.x = x;
    hover.y = y;
    var target = document.elementFromPoint(x, y);
    var helpEl = target ? target.closest("[data-help]") : null;
    if (!helpEl) {
        clearHoverHelp();
        return;
    }

    var text = helpEl.getAttribute("data-help");
    if (hover.hideTimer) {
        window.clearTimeout(hover.hideTimer);
        hover.hideTimer = null;
    }
    if (hover.text === text) {
        if (hover.visible) positionHoverTip(x, y);
        return;
    }
    if (hover.timer) window.clearTimeout(hover.timer);
    hover.text = text;
    hover.visible = false;
    ensureHoverTip().classList.remove("is-visible");
    hover.timer = window.setTimeout(function () {
        hover.timer = null;
        showHoverHelp();
    }, 1500);
}

function maintainHoverHelp() {
    var hover = state.hoverHelp;
    if (hover.x != null && hover.y != null) {
        updateHoverHelpFromPoint(hover.x, hover.y);
    }
}

function initHoverHelp() {
    document.addEventListener("mousemove", function (event) {
        updateHoverHelpFromPoint(event.clientX, event.clientY);
    });
    document.addEventListener("mouseleave", clearHoverHelp);
    window.addEventListener("scroll", maintainHoverHelp, true);
}

function selectEl(id, options, current) {
    var select = el("select", { id: id });
    options.forEach(function (item) {
        var option = el("option", { value: item.value, textContent: item.label });
        if (item.value === current) option.selected = true;
        select.appendChild(option);
    });
    return select;
}

function prometheusControl(action, extraArgs) {
    var args = ["python3", PROMETHEUS_CONTROL_PATH, action].concat(extraArgs || []);
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
    var numCpus = curr.num_cpus || 1;

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

    // zram writeback deltas
    var zprev = prev.zram && prev.zram[0] ? prev.zram[0] : {};
    var zcurr = curr.zram && curr.zram[0] ? curr.zram[0] : {};
    if (zprev.bd_stat && zcurr.bd_stat) {
        deltas.zram_backed_delta_bytes = (zcurr.bd_stat.backed_bytes || 0) - (zprev.bd_stat.backed_bytes || 0);
        deltas.zram_writeback_reads_delta_bytes = (zcurr.bd_stat.read_bytes || 0) - (zprev.bd_stat.read_bytes || 0);
        deltas.zram_writeback_writes_delta_bytes = (zcurr.bd_stat.written_bytes || 0) - (zprev.bd_stat.written_bytes || 0);
        deltas.zram_writeback_reads_per_sec = deltas.zram_writeback_reads_delta_bytes / dt;
        deltas.zram_writeback_writes_per_sec = deltas.zram_writeback_writes_delta_bytes / dt;
    } else {
        deltas.zram_backed_delta_bytes = 0;
        deltas.zram_writeback_reads_delta_bytes = 0;
        deltas.zram_writeback_writes_delta_bytes = 0;
        deltas.zram_writeback_reads_per_sec = 0;
        deltas.zram_writeback_writes_per_sec = 0;
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

function renderKsmAttribution(curr, savedBytes) {
    var attribution = (curr.domain_ksm || []).slice().filter(function (entry) {
        return (entry.profit_bytes || 0) > 0;
    });
    if (!attribution.length) {
        return el("div", { className: "ksm-attribution ksm-attribution--empty" }, [
            el("div", { className: "ksm-attribution-title", textContent: "KSM Attribution" }),
            el("div", { className: "ksm-attribution-empty", textContent: "No per-domain KSM attribution available yet." }),
        ]);
    }

    var memAvailable = curr.meminfo && curr.meminfo.MemAvailable || 0;
    var zramHeadroom = 0;
    var z = curr.zram && curr.zram[0] ? curr.zram[0] : null;
    if (z) zramHeadroom = Math.max((z.disksize_bytes || 0) - (z.data_bytes || 0), 0);
    var lossMargin = memAvailable + zramHeadroom - savedBytes;
    var cliffCoverage = savedBytes > 0 ? (memAvailable + zramHeadroom) / savedBytes : 1;
    var cliffState = lossMargin >= 0 ? "Survivable" : "Deficit";
    var cliffClass = lossMargin >= 0 ? "ksm-cliff-card--ok" : "ksm-cliff-card--risk";
    var topProfit = attribution[0].profit_bytes || 0;
    var concentrationPct = savedBytes > 0 ? (topProfit / savedBytes) * 100 : 0;

    var tierProfit = {};
    attribution.forEach(function (entry) {
        var tier = entry.tier || "unknown";
        tierProfit[tier] = (tierProfit[tier] || 0) + (entry.profit_bytes || 0);
    });
    var maxTierProfit = Math.max.apply(null, TIER_ORDER.map(function (tier) {
        return tierProfit[tier] || 0;
    }).concat([1]));
    var tierBars = el("div", { className: "observer-visual-card ksm-tier-card" }, [
        el("div", { className: "observer-visual-label", textContent: "Tier Savings" }),
        el("div", { className: "ksm-tier-bars" }, TIER_ORDER.map(function (tier) {
            var value = tierProfit[tier] || 0;
            var width = maxTierProfit > 0 ? (value / maxTierProfit) * 100 : 0;
            return el("div", { className: "ksm-tier-row" }, [
                el("span", { className: "ksm-tier-label", textContent: tier }),
                el("span", { className: "ksm-tier-track" }, [
                    el("span", { className: "ksm-tier-fill ksm-tier-fill--" + tier, style: "width:" + width.toFixed(1) + "%" }),
                ]),
                el("span", { className: "ksm-tier-value", textContent: humanGiB(value) }),
            ]);
        })),
        el("div", { className: "observer-visual-subtext", textContent: attribution.length + " mergeable QEMU processes" }),
    ]);

    var row = el("div", { className: "ksm-attribution" }, [
        el("div", { className: "ksm-attribution-title", textContent: "KSM Attribution & Risk" }),
        el("div", { className: "observer-visual-grid observer-visual-grid--three" }, [
            visualCard("Top Dependency", shortDomainName(attribution[0].name), Math.min(concentrationPct, 100),
                humanGiB(topProfit) + " / " + pct(concentrationPct, 0) + " of KSM savings",
                concentrationPct > 35 ? "risk" : "savings",
                "Largest single VM contributor to host KSM savings."),
            el("div", { className: "observer-visual-card ksm-cliff-card " + cliffClass, "data-help": "Estimated host cushion if current KSM savings disappeared quickly." }, [
                el("div", { className: "observer-visual-label", textContent: "KSM Cliff Margin" }),
                el("div", { className: "observer-visual-value", textContent: cliffState }),
                el("div", { className: "ksm-cliff-margin", textContent: humanGiB(lossMargin) }),
                el("div", { className: "observer-visual-subtext", textContent: "coverage " + cliffCoverage.toFixed(2) + "x current KSM savings" }),
            ]),
            tierBars,
        ]),
    ]);

    var list = el("div", { className: "ksm-vm-inventory" });
    attribution.forEach(function (entry) {
        var depPct = (entry.dependency_ratio || 0) * 100;
        var width = savedBytes > 0 ? ((entry.profit_bytes || 0) / savedBytes) * 100 : 0;
        list.appendChild(el("div", { className: "ksm-vm-card" }, [
            el("div", { className: "ksm-vm-name", textContent: shortDomainName(entry.name), title: entry.name }),
            el("span", { className: "tier-badge tier-badge-" + entry.tier, textContent: entry.tier || "?" }),
            el("span", { className: "ksm-domain-value", textContent: humanGiB(entry.profit_bytes || 0) }),
            el("span", { className: "ksm-vm-value", textContent: pct(width, 1) }),
            el("span", { className: "ksm-vm-value", textContent: pct(depPct, 0) }),
            el("div", { className: "ksm-domain-bar" }, [
                el("div", { className: "ksm-domain-bar-fill", style: "width:" + Math.max(0, Math.min(width, 100)).toFixed(1) + "%" }),
            ]),
        ]));
    });
    row.appendChild(el("div", { className: "ksm-inventory-title", textContent: "VM Inventory" }));
    row.appendChild(list);
    return row;
}

function renderZramAttribution(curr, totalSwapBytes) {
    var attribution = (curr.domain_swap || []).slice().filter(function (entry) {
        return (entry.swap_bytes || 0) > 0;
    });
    if (!attribution.length) {
        return el("div", { className: "zram-attribution zram-attribution--empty" }, [
            el("div", { className: "ksm-attribution-title", textContent: "zram VM Pressure" }),
            el("div", { className: "ksm-attribution-empty", textContent: "No per-domain swap pressure is visible yet." }),
        ]);
    }

    var topSwap = attribution[0].swap_bytes || 0;
    var attributedSwap = attribution.reduce(function (sum, entry) {
        return sum + (entry.swap_bytes || 0);
    }, 0);
    var concentrationPct = attributedSwap > 0 ? (topSwap / attributedSwap) * 100 : 0;
    var tierSwap = {};
    attribution.forEach(function (entry) {
        var tier = entry.tier || "unknown";
        tierSwap[tier] = (tierSwap[tier] || 0) + (entry.swap_bytes || 0);
    });
    var maxTierSwap = Math.max.apply(null, TIER_ORDER.map(function (tier) {
        return tierSwap[tier] || 0;
    }).concat([1]));
    var tierBars = el("div", { className: "observer-visual-card ksm-tier-card" }, [
        el("div", { className: "observer-visual-label", textContent: "Tier Swap Pressure" }),
        el("div", { className: "ksm-tier-bars" }, TIER_ORDER.map(function (tier) {
            var value = tierSwap[tier] || 0;
            var width = maxTierSwap > 0 ? (value / maxTierSwap) * 100 : 0;
            return el("div", { className: "ksm-tier-row" }, [
                el("span", { className: "ksm-tier-label", textContent: tier }),
                el("span", { className: "ksm-tier-track" }, [
                    el("span", { className: "ksm-tier-fill ksm-tier-fill--" + tier, style: "width:" + width.toFixed(1) + "%" }),
                ]),
                el("span", { className: "ksm-tier-value", textContent: humanGiB(value) }),
            ]);
        })),
        el("div", { className: "observer-visual-subtext", textContent: attribution.length + " VMs with swapped QEMU memory" }),
    ]);

    var row = el("div", { className: "zram-attribution" }, [
        el("div", { className: "ksm-attribution-title", textContent: "zram VM Pressure" }),
        el("div", { className: "observer-visual-grid observer-visual-grid--three" }, [
            visualCard("Top Swapped VM", shortDomainName(attribution[0].name), Math.min(concentrationPct, 100),
                humanGiB(topSwap) + " / " + pct(concentrationPct, 0) + " of VM swap",
                concentrationPct > 35 ? "risk" : "memory",
                "Largest single VM contributor to host swap pressure."),
            visualCard("zram Occupancy", humanGiB(totalSwapBytes), 100,
                humanGiB(attributedSwap) + " attributed across " + attribution.length + " VMs",
                "occupancy",
                "Total zram swap occupancy with QEMU swap pressure attributed through /proc/<pid>/status."),
            tierBars,
        ]),
        el("div", { className: "ksm-inventory-title", textContent: "VM Inventory" }),
    ]);

    var list = el("div", { className: "ksm-vm-inventory" });
    attribution.forEach(function (entry) {
        var depPct = (entry.dependency_ratio || 0) * 100;
        var width = attributedSwap > 0 ? ((entry.swap_bytes || 0) / attributedSwap) * 100 : 0;
        list.appendChild(el("div", { className: "ksm-vm-card" }, [
            el("div", { className: "ksm-vm-name", textContent: shortDomainName(entry.name), title: entry.name }),
            el("span", { className: "tier-badge tier-badge-" + entry.tier, textContent: entry.tier || "?" }),
            el("span", { className: "ksm-domain-value", textContent: humanGiB(entry.swap_bytes || 0) }),
            el("span", { className: "ksm-vm-value", textContent: pct(width, 1) }),
            el("span", { className: "ksm-vm-value", textContent: pct(depPct, 0) }),
            el("div", { className: "ksm-domain-bar" }, [
                el("div", { className: "ksm-domain-bar-fill zram-domain-bar-fill", style: "width:" + Math.max(0, Math.min(width, 100)).toFixed(1) + "%" }),
            ]),
        ]));
    });
    row.appendChild(list);
    return row;
}

// ---------------------------------------------------------------------------
// Render: KSM Panel
// ---------------------------------------------------------------------------

function renderKSM(curr, deltas) {
    var container = clearEl("ksm-content");
    if (!container) return;

    var ksm = curr.ksm || {};
    var savedBytes = ksm.estimated_saved_bytes || 0;
    var hostMemoryBytes = curr.meminfo && curr.meminfo.MemTotal || savedBytes || 1;
    var savedGiB = savedBytes / GiB;
    var pagesSharing = ksm.pages_sharing || 0;
    var pagesShared = ksm.pages_shared || 0;
    var pagesVolatile = ksm.pages_volatile || 0;
    var pagesUnshared = ksm.pages_unshared || 0;
    var pagesToScan = ksm.pages_to_scan || 0;
    var sleepMs = ksm.sleep_millisecs || 0;

    var ksmdCorePct = deltas ? deltas.ksmd_cpu_core_pct || 0 : 0;
    var ksmdHostPct = deltas ? deltas.ksmd_cpu_host_pct || 0 : 0;

    // Verdict
    var verdict = ksmVerdict(savedGiB, ksmdHostPct);

    var mergeRatio = pagesShared > 0 ? pagesSharing / pagesShared : 0;
    var mergeRatioText = mergeRatio > 0 ? mergeRatio.toFixed(1) + "x" : "n/a";
    var totalMergeable = pagesSharing + pagesUnshared + pagesVolatile;
    var volatilityPct = totalMergeable > 0 ? (pagesVolatile / totalMergeable * 100) : 0;
    var scanThroughput = sleepMs > 0 ? Math.round(pagesToScan * (1000 / sleepMs)) : 0;
    var scansPerMin = deltas ? (deltas.ksm_scans_per_min || 0).toFixed(1) : "n/a";

    // Disposition strip (first element)
    var ksmStrip = {
        level: verdict.level === "effective" ? "good" : verdict.level === "marginal" ? "warn" :
               verdict.level === "waste" ? "critical" : "warn",
        label: verdict.label,
        fields: [
            { label: "saved", value: humanGiB(savedBytes) },
            { label: "cost", value: pct(ksmdHostPct, 2) },
            { label: "density", value: mergeRatioText },
            { label: "volatility", value: pct(volatilityPct) },
        ],
    };
    container.appendChild(renderDispositionStrip(ksmStrip));

    var ksmVisuals = el("div", { className: "observer-visual-grid" }, [
        visualCard("Saved Memory", humanGiB(savedBytes), Math.min((savedBytes / hostMemoryBytes) * 100, 100),
            pct((savedBytes / hostMemoryBytes) * 100, 1) + " of host RAM", "savings",
            "Estimated RAM saved by merging identical anonymous pages."),
        visualCard("ksmd Cost", pct(ksmdHostPct, 2), Math.min((ksmdHostPct / 5) * 100, 100),
            pct(ksmdCorePct, 2) + " core / " + fmtInt(scanThroughput) + " pg/s / +" + scansPerMin + " scans/min",
            "cost",
            "KSM scanner CPU, page scan rate, and completed scan cadence."),
        visualCard("Merge Density", mergeRatioText, Math.min((mergeRatio / 10) * 100, 100),
            fmtInt(pagesShared) + " shared pages", "efficiency",
            "How many duplicate pages each stable KSM page is eliminating."),
        visualCard("Volatility", pct(volatilityPct), volatilityPct,
            fmtInt(pagesVolatile) + " volatile pages", "risk",
            "Share of mergeable pages changing too quickly to stay merged."),
    ]);
    container.appendChild(ksmVisuals);
    container.appendChild(renderKsmAttribution(curr, savedBytes));

    // Sparklines row
    var sparkRow = el("div", { className: "sparkline-row" });

    // KSM savings sparkline
    var savingsData = historySlice("ksm_saved_gib");
    var savingsGroup = el("div", { className: "sparkline-group" });
    savingsGroup.appendChild(el("div", { className: "sparkline-label", textContent: "KSM Savings Trend" }));
    var savingsCanvas = el("canvas", { className: "sparkline-canvas" });
    savingsGroup.appendChild(savingsCanvas);
    savingsGroup.appendChild(el("div", { className: "sparkline-value", textContent: savedGiB.toFixed(1) + " GiB" }));
    sparkRow.appendChild(savingsGroup);

    // ksmd CPU sparkline
    var cpuData = historySlice("ksmd_cpu_host_pct");
    var cpuGroup = el("div", { className: "sparkline-group" });
    cpuGroup.appendChild(el("div", { className: "sparkline-label", textContent: "ksmd CPU Trend" }));
    var cpuCanvas = el("canvas", { className: "sparkline-canvas" });
    cpuGroup.appendChild(cpuCanvas);
    cpuGroup.appendChild(el("div", { className: "sparkline-value", textContent: pct(ksmdHostPct, 2) }));
    sparkRow.appendChild(cpuGroup);

    container.appendChild(sparkRow);

    // Recommendation
    var rec = ksmRecommendation(curr, deltas);
    container.appendChild(el("div", { className: "ksm-recommendation", textContent: rec }));

    // Deferred sparkline draws (after DOM insertion)
    requestAnimationFrame(function () {
        if (savingsData.length >= 2) {
            drawSparkline(savingsCanvas, savingsData, {
                color: COLORS.ksmSavings, fill: "rgba(46,125,50,0.12)",
                min: 0, spotColor: COLORS.ksmSavings,
            });
        }
        if (cpuData.length >= 2) {
            drawSparkline(cpuCanvas, cpuData, {
                color: COLORS.ksmCpu, fill: "rgba(230,81,0,0.10)",
                min: 0, spotColor: COLORS.ksmCpu,
            });
        }
    });
}

// ---------------------------------------------------------------------------
// Render: CPU Panel
// ---------------------------------------------------------------------------

function cpuPoolStats(curr, deltas) {
    var numCpus = curr.num_cpus || 1;
    var poolMap = curr.cpu_pool_map || {};
    var perCpu = deltas ? deltas.per_cpu_pct || {} : {};
    var stats = {};
    for (var poolName in POOL_COLORS) {
        stats[poolName] = { count: 0, totalUtil: 0, avgUtil: 0, hostPct: 0 };
    }
    for (var cpuId in poolMap) {
        var pool = poolMap[cpuId] || "unknown";
        if (!stats[pool]) stats[pool] = { count: 0, totalUtil: 0, avgUtil: 0, hostPct: 0 };
        var util = perCpu["cpu" + cpuId] || 0;
        stats[pool].count++;
        stats[pool].totalUtil += util;
    }
    for (var name in stats) {
        stats[name].avgUtil = stats[name].count > 0 ? stats[name].totalUtil / stats[name].count : 0;
        stats[name].hostPct = stats[name].totalUtil / numCpus;
    }
    return stats;
}

function tieredPoolHostPct(deltas) {
    var total = 0;
    if (!deltas || !deltas.tier_cpu) return total;
    for (var i = 0; i < TIER_ORDER.length; i++) {
        var tier = TIER_ORDER[i];
        total += deltas.tier_cpu[tier] ? deltas.tier_cpu[tier].host_pct || 0 : 0;
    }
    return total;
}

function averagePoolFrequencyGhz(sample, poolName) {
    var poolMap = sample.cpu_pool_map || {};
    var cpuFreq = sample.cpu_freq || {};
    var sum = 0;
    var count = 0;
    for (var cpuId in poolMap) {
        if (poolMap[cpuId] !== poolName) continue;
        var mhz = cpuFreq["cpu" + cpuId] || cpuFreq[cpuId] || 0;
        if (mhz > 0) {
            sum += mhz;
            count++;
        }
    }
    return count > 0 ? (sum / count) / 1000 : 0;
}

function domainEffectiveClockGhz(domain, domainCpuPct, avgGuestPoolGhz) {
    var vcpus = domain && domain.vcpus ? domain.vcpus : 0;
    if (!vcpus || !avgGuestPoolGhz) return 0;
    var deliveredFraction = Math.max(0, Math.min((domainCpuPct || 0) / (vcpus * 100), 1));
    return avgGuestPoolGhz * deliveredFraction;
}

function cpuThrottleEvents(deltas) {
    var events = 0;
    if (deltas && deltas.tier_cpu) {
        for (var i = 0; i < TIER_ORDER.length; i++) {
            var tier = TIER_ORDER[i];
            events += deltas.tier_cpu[tier] ? deltas.tier_cpu[tier].throttled_events || 0 : 0;
        }
    }
    return events;
}

function cpuDisposition(curr, deltas) {
    var numCpus = curr.num_cpus || 1;
    var hostCpuPct = deltas ? deltas.host_cpu_pct || 0 : 0;
    var stealPct = deltas ? deltas.host_steal_pct || 0 : 0;
    var pools = cpuPoolStats(curr, deltas);
    var guestPool = pools.guest_domain || { count: 0, avgUtil: 0 };
    var totalVcpus = state.guestVcpus || 0;
    var oversubRatio = guestPool.count > 0 ? totalVcpus / guestPool.count : 0;
    var tierThrottleEvents = cpuThrottleEvents(deltas);
    var mmHostPct = deltas ? deltas.mm_cpu_host_pct || 0 : 0;
    var tieredHostPct = tieredPoolHostPct(deltas);
    var overheadHostPct = (pools.host_housekeeping ? pools.host_housekeeping.hostPct : 0) +
        (pools.host_emulator ? pools.host_emulator.hostPct : 0) +
        (pools.host_reserved ? pools.host_reserved.hostPct : 0) +
        mmHostPct +
        tieredHostPct;

    var score = 0;
    if (hostCpuPct > 92) score += 3;
    else if (hostCpuPct > 80) score += 2;
    else if (hostCpuPct > 65) score += 1;

    if (guestPool.avgUtil > 90) score += 3;
    else if (guestPool.avgUtil > 75) score += 2;
    else if (guestPool.avgUtil > 60) score += 1;

    if (oversubRatio > 3) score += 2;
    else if (oversubRatio > 2) score += 1;

    if (stealPct > 2 || tierThrottleEvents > 20) score += 3;
    else if (stealPct > 0.5 || tierThrottleEvents > 0) score += 1;

    if (overheadHostPct > 10) score += 2;
    else if (overheadHostPct > 5) score += 1;

    var level = "good";
    var label = "NOMINAL";
    if (score >= 7) {
        level = "critical";
        label = "CONTENTION";
    } else if (score >= 4) {
        level = "risk";
        label = "ELEVATED";
    } else if (oversubRatio > 1.5 || hostCpuPct > 50) {
        level = "warn";
        label = "STABLE";
    }

    var contention = "none";
    if (stealPct > 2 || tierThrottleEvents > 20) {
        contention = "active";
    } else if (stealPct > 0.5 || tierThrottleEvents > 0) {
        contention = "minor";
    }

    return {
        level: level,
        label: label,
        fields: [
            { label: "host", value: pct(hostCpuPct, 1) },
            { label: "pool", value: pct(guestPool.avgUtil, 1) },
            { label: "density", value: oversubRatio > 0 ? oversubRatio.toFixed(2) + ":1" : "n/a" },
            { label: "steal", value: pct(stealPct, 2) },
            { label: "throttle", value: String(tierThrottleEvents) },
        ],
    };
}

function renderCPUOverview(curr, deltas) {
    var container = clearEl("cpu-overview-content");
    if (!container) return;

    var numCpus = curr.num_cpus || 1;
    var hostCpuPct = deltas ? deltas.host_cpu_pct || 0 : 0;
    var coresUsed = (hostCpuPct / 100) * numCpus;
    var totalVcpus = state.guestVcpus || 0;
    var pools = cpuPoolStats(curr, deltas);
    var guestPool = pools.guest_domain || { count: 0, avgUtil: 0 };
    var stealPct = deltas ? deltas.host_steal_pct || 0 : 0;
    var oversubRatio = guestPool.count > 0 ? totalVcpus / guestPool.count : 0;
    var tierThrottleEvents = cpuThrottleEvents(deltas);
    var disposition = cpuDisposition(curr, deltas);

    container.appendChild(renderDispositionStrip(disposition));

    container.appendChild(el("div", { className: "observer-visual-grid" }, [
        visualCard("Host CPU", pct(hostCpuPct), hostCpuPct,
            coresUsed.toFixed(1) + " / " + numCpus + " cores", "cpu",
            "Total host CPU consumed across all schedulable cores.",
            { value: hostCpuPct, max: 100, gradient: [
                { stop: 0, color: COLORS.good }, { stop: 0.65, color: COLORS.warn },
                { stop: 0.85, color: COLORS.risk }, { stop: 1, color: COLORS.crit }
            ]}),
        visualCard("Guest Pool Load", pct(guestPool.avgUtil, 1), guestPool.avgUtil,
            guestPool.count + " guest-domain CPUs", guestPool.avgUtil > 80 ? "risk" : "efficiency",
            "Average utilization of physical CPUs assigned to guest domains.",
            { value: guestPool.avgUtil, max: 100, gradient: [
                { stop: 0, color: COLORS.good }, { stop: 0.7, color: COLORS.warn },
                { stop: 0.9, color: COLORS.crit }
            ]}),
        visualCard("vCPU Density", oversubRatio > 0 ? oversubRatio.toFixed(2) + ":1" : "n/a",
            oversubRatio > 0 ? Math.min((oversubRatio / 3) * 100, 100) : 0,
            totalVcpus + " vCPUs / " + guestPool.count + " pCPUs", oversubRatio > 2 ? "risk" : "memory",
            "Guest vCPUs scheduled against the guest-domain physical CPU pool."),
        visualCard("Contention", pct(stealPct, 2), Math.min((stealPct / 5) * 100, 100),
            tierThrottleEvents + " tier throttle events", (stealPct > 1 || tierThrottleEvents > 0) ? "risk" : "efficiency",
            "Guest steal time plus cgroup throttle events."),
    ]));

    var hostCanvas = el("canvas", { className: "sparkline-canvas" });
    container.appendChild(el("div", { className: "sparkline-row" }, [
        el("div", { className: "sparkline-group" }, [
            el("div", { className: "sparkline-label", textContent: "Host CPU Trend" }),
            hostCanvas,
            el("div", { className: "sparkline-value", textContent: pct(hostCpuPct) }),
        ]),
    ]));

    appendCpuOverhead(container, curr, deltas, pools);

    requestAnimationFrame(function () {
        var hostData = historySlice("host_cpu_pct");
        if (hostData.length >= 2) {
            drawSparkline(hostCanvas, hostData, {
                color: COLORS.blue, fill: "rgba(21,101,192,0.10)",
                min: 0, max: 100, spotColor: COLORS.blue,
                refLine: { value: 80, color: COLORS.risk, dash: [4, 3] },
            });
        }
    });
}

function appendCpuOverhead(container, curr, deltas, pools) {
    var numCpus = curr.num_cpus || 1;
    pools = pools || cpuPoolStats(curr, deltas);
    var housekeeping = pools.host_housekeeping || { hostPct: 0, count: 0, avgUtil: 0 };
    var emulator = pools.host_emulator || { hostPct: 0, count: 0, avgUtil: 0 };
    var reserved = pools.host_reserved || { hostPct: 0, count: 0, avgUtil: 0 };
    var tieredHostPct = tieredPoolHostPct(deltas);
    var tieredCorePct = tieredHostPct * numCpus;
    var mmHostPct = deltas ? deltas.mm_cpu_host_pct || 0 : 0;
    var mmCorePct = deltas ? deltas.mm_cpu_core_pct || 0 : 0;
    var overheadTotal = housekeeping.hostPct + emulator.hostPct + reserved.hostPct + tieredHostPct + mmHostPct;

    container.appendChild(el("div", { className: "cpu-overhead-section" }, [
        el("div", { className: "cpu-overhead-header" }, [
            el("span", { className: "cpu-overhead-title", textContent: "CPU Overheads" }),
            el("span", { className: "cpu-overhead-summary", textContent: pct(overheadTotal, 2) + " host CPU across host and tiered pools" }),
        ]),
        el("div", { className: "observer-visual-grid" }, [
            visualCard("Tiered Pool", pct(tieredHostPct, 2), Math.min((tieredHostPct / 60) * 100, 100),
                pct(tieredCorePct, 1) + " of one core across gold/silver/bronze", tieredHostPct > 50 ? "risk" : "memory",
                "Total CPU utilization attributed to gold, silver, and bronze cgroup slices."),
            visualCard("Housekeeping Pool", pct(housekeeping.hostPct, 2), Math.min((housekeeping.hostPct / 10) * 100, 100),
                housekeeping.count + " CPUs / " + pct(housekeeping.avgUtil, 1) + " avg", housekeeping.hostPct > 5 ? "risk" : "cpu",
                "Host CPU consumed by housekeeping-assigned CPUs."),
            visualCard("Emulator Pool", pct(emulator.hostPct, 2), Math.min((emulator.hostPct / 10) * 100, 100),
                emulator.count + " CPUs / " + pct(emulator.avgUtil, 1) + " avg", emulator.hostPct > 5 ? "risk" : "cost",
                "CPU consumed by emulator-assigned CPUs."),
            visualCard("Kernel MM Threads", pct(mmHostPct, 2), Math.min((mmHostPct / 5) * 100, 100),
                pct(mmCorePct, 2) + " of one core / " + numCpus + " CPUs", mmHostPct > 2 ? "risk" : "efficiency",
                "ksmd, kswapd, and kcompactd CPU cost."),
            visualCard("Reserved Pool", pct(reserved.hostPct, 2), Math.min((reserved.hostPct / 10) * 100, 100),
                reserved.count + " CPUs / " + pct(reserved.avgUtil, 1) + " avg", reserved.hostPct > 5 ? "risk" : "memory",
                "CPU consumed by reserved host pool CPUs."),
        ]),
    ]));
}

function appendVmEffectiveClock(container, curr, deltas) {
    if (!state.domains || !state.domains.length) return;
    var avgGuestGhz = averagePoolFrequencyGhz(curr, "guest_domain");
    var domainRows = state.domains.map(function (domain) {
        var domainCpuPct = deltas && deltas.domain_cpu ? deltas.domain_cpu[domain.name] || 0 : 0;
        var ecc = domainEffectiveClockGhz(domain, domainCpuPct, avgGuestGhz);
        return { domain: domain, cpuPct: domainCpuPct, ecc: ecc };
    }).sort(function (a, b) {
        return b.ecc - a.ecc;
    });

    var grid = el("div", { className: "vm-ecc-grid" });
    domainRows.forEach(function (row) {
        var canvas = el("canvas", { className: "sparkline-canvas vm-ecc-sparkline", "data-ecc-domain": row.domain.name });
        var vcpuFraction = row.domain.vcpus > 0 ? row.cpuPct / (row.domain.vcpus * 100) : 0;
        grid.appendChild(el("div", { className: "vm-ecc-card" }, [
            el("div", { className: "vm-ecc-name", textContent: shortDomainName(row.domain.name), title: row.domain.name }),
            el("div", { className: "vm-ecc-value", textContent: row.ecc > 0 ? row.ecc.toFixed(2) + " GHz" : "idle" }),
            el("div", { className: "vm-ecc-detail", textContent: pct(vcpuFraction * 100, 0) + " vCPU occupancy / pool " + (avgGuestGhz > 0 ? avgGuestGhz.toFixed(2) + " GHz" : "n/a") }),
            canvas,
        ]));
    });

    container.appendChild(el("div", { className: "vm-ecc-section" }, [
        el("div", { className: "vm-ecc-header" }, [
            el("span", { className: "vm-ecc-title", textContent: "VM Effective Constrained Clock" }),
            el("span", { className: "vm-ecc-summary", textContent: "Host-side estimate from VM cgroup CPU usage and guest-domain pool frequency" }),
        ]),
        grid,
    ]));

    requestAnimationFrame(function () {
        domainRows.forEach(function (row) {
            var canvas = grid.querySelector('canvas[data-ecc-domain="' + row.domain.name + '"]');
            if (!canvas) return;
            var data = state.history.map(function (h) {
                if (h.ecc_ghz && h.ecc_ghz[row.domain.name] != null) return h.ecc_ghz[row.domain.name];
                var domainCpuPct = h.domain_cpu && h.domain_cpu[row.domain.name] ? h.domain_cpu[row.domain.name] : 0;
                return domainEffectiveClockGhz(row.domain, domainCpuPct, h.avg_guest_pool_ghz || avgGuestGhz);
            });
            if (data.length >= 2) {
                drawSparkline(canvas, data, {
                    color: TIER_COLORS[row.domain.tier] || COLORS.blue,
                    fill: "rgba(21,101,192,0.08)",
                    min: 0,
                    spotColor: TIER_COLORS[row.domain.tier] || COLORS.blue,
                });
            }
        });
    });
}

function renderECC(curr, deltas) {
    var container = clearEl("ecc-content");
    if (!container) return;
    if (!state.domains || !state.domains.length) {
        container.appendChild(el("div", { className: "panel-placeholder", textContent: "No domain data available." }));
        return;
    }

    var avgGuestGhz = averagePoolFrequencyGhz(curr, "guest_domain");
    var totalWeight = 0;
    var tierWeights = {};
    if (curr.tier_cgroups) {
        for (var ti = 0; ti < TIER_ORDER.length; ti++) {
            var tw = curr.tier_cgroups[TIER_ORDER[ti]];
            var w = tw && tw.cpu_weight ? tw.cpu_weight : 0;
            tierWeights[TIER_ORDER[ti]] = w;
            totalWeight += w;
        }
    }

    var contextItems = [
        el("span", {}, [el("strong", { textContent: "Pool freq" }), document.createTextNode(" " + (avgGuestGhz > 0 ? avgGuestGhz.toFixed(2) + " GHz" : "n/a"))]),
    ];
    for (var ci = 0; ci < TIER_ORDER.length; ci++) {
        var tn = TIER_ORDER[ci];
        var floorGhz = totalWeight > 0 ? avgGuestGhz * (tierWeights[tn] / totalWeight) : 0;
        contextItems.push(el("span", {}, [
            el("strong", { textContent: tn.charAt(0).toUpperCase() + tn.slice(1) + " floor" }),
            document.createTextNode(" " + floorGhz.toFixed(2) + " GHz"),
        ]));
    }
    container.appendChild(el("div", { className: "ecc-slo-context" }, contextItems));

    var domainRows = state.domains.map(function (domain) {
        var domainCpuPct = deltas && deltas.domain_cpu ? deltas.domain_cpu[domain.name] || 0 : 0;
        var ecc = domainEffectiveClockGhz(domain, domainCpuPct, avgGuestGhz);
        var tier = domain.tier || "unknown";
        var floorGhz = totalWeight > 0 && tierWeights[tier] ? avgGuestGhz * (tierWeights[tier] / totalWeight) : 0;
        return { domain: domain, cpuPct: domainCpuPct, ecc: ecc, floorGhz: floorGhz };
    }).sort(function (a, b) {
        return b.ecc - a.ecc;
    });

    var grid = el("div", { className: "vm-ecc-grid" });
    domainRows.forEach(function (row) {
        var canvas = el("canvas", { className: "sparkline-canvas vm-ecc-sparkline", "data-ecc-domain": row.domain.name });
        var vcpuFraction = row.domain.vcpus > 0 ? row.cpuPct / (row.domain.vcpus * 100) : 0;
        var tierBadge = el("span", { className: "tier-badge tier-badge-" + (row.domain.tier || "unknown"), textContent: row.domain.tier || "?" });
        grid.appendChild(el("div", { className: "vm-ecc-card" }, [
            el("div", { className: "vm-ecc-name" }, [
                document.createTextNode(shortDomainName(row.domain.name) + " "),
                tierBadge,
            ]),
            el("div", { className: "vm-ecc-value", textContent: row.ecc > 0 ? row.ecc.toFixed(2) + " GHz" : "idle" }),
            el("div", { className: "vm-ecc-detail", textContent: pct(vcpuFraction * 100, 0) + " vCPU occ / floor " + row.floorGhz.toFixed(2) + " GHz" }),
            canvas,
        ]));
    });
    container.appendChild(grid);

    requestAnimationFrame(function () {
        domainRows.forEach(function (row) {
            var canvas = grid.querySelector('canvas[data-ecc-domain="' + row.domain.name + '"]');
            if (!canvas) return;
            var data = state.history.map(function (h) {
                if (h.ecc_ghz && h.ecc_ghz[row.domain.name] != null) return h.ecc_ghz[row.domain.name];
                var domainCpuPct = h.domain_cpu && h.domain_cpu[row.domain.name] ? h.domain_cpu[row.domain.name] : 0;
                return domainEffectiveClockGhz(row.domain, domainCpuPct, h.avg_guest_pool_ghz || avgGuestGhz);
            });
            if (data.length >= 2) {
                drawSparkline(canvas, data, {
                    color: TIER_COLORS[row.domain.tier] || COLORS.blue,
                    fill: "rgba(21,101,192,0.08)",
                    min: 0,
                    spotColor: TIER_COLORS[row.domain.tier] || COLORS.blue,
                    refLine: row.floorGhz > 0 ? { value: row.floorGhz, color: COLORS.crit, dash: [4, 3] } : undefined,
                });
            }
        });
    });
}

function renderCPU(curr, deltas) {
    var container = clearEl("cpu-content");
    if (!container) return;

    var totalVcpus = state.guestVcpus || 0;
    var pools = cpuPoolStats(curr, deltas);
    var guestDomainCpus = pools.guest_domain ? pools.guest_domain.count : 0;

    if (totalVcpus > 0 && guestDomainCpus > 0) {
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
            var row = el("tr", { "data-tier": dom.tier }, [
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
    if (!rangeStr) return result;
    var parts = rangeStr.split(",");
    for (var i = 0; i < parts.length; i++) {
        var p = parts[i].trim();
        if (!p) continue;
        if (p.indexOf("-") !== -1) {
            var se = p.split("-");
            if (!se[0] || !se[1]) continue;
            for (var n = parseInt(se[0], 10); n <= parseInt(se[1], 10); n++) result.push(n);
        } else {
            var cpuId = parseInt(p, 10);
            if (!Number.isNaN(cpuId)) result.push(cpuId);
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
        container.appendChild(el("div", { className: "panel-placeholder",
            textContent: "No topology data available" }));
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
            textContent: "NUMA Node " + s + "  —  Socket " + s + " (" + socketCount + " threads, " + socketAvg.toFixed(1) + "% avg)" }));

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

function memoryDisposition(curr, deltas) {
    var mem = curr.meminfo || {};
    var ksm = curr.ksm || {};
    var total = mem.MemTotal || 1;
    var available = mem.MemAvailable || 0;
    var guestMem = state.guestMemoryBytes || 0;
    var ksmSaved = ksm.estimated_saved_bytes || 0;
    var zramSaved = curr.zram_estimated_saved_bytes || 0;
    var reclaimTotal = ksmSaved + zramSaved;
    var overcommitRatio = guestMem / total;
    var availablePct = (available / total) * 100;
    var reclaimPct = (reclaimTotal / total) * 100;

    var z = curr.zram && curr.zram[0] ? curr.zram[0] : null;
    var zramSwapUsed = z ? z.data_bytes || 0 : 0;
    if (z && curr.swap) {
        for (var i = 0; i < curr.swap.length; i++) {
            var swapName = curr.swap[i].name;
            if (swapName === z.name || swapName === "/dev/" + z.name) {
                zramSwapUsed = curr.swap[i].used_bytes || zramSwapUsed;
            }
        }
    }
    var zramSize = z ? z.disksize_bytes || 0 : 0;
    var zramHeadroom = zramSize > 0 ? Math.max(zramSize - zramSwapUsed, 0) : 0;
    var zramUtilPct = zramSize > 0 ? (zramSwapUsed / zramSize) * 100 : 0;
    var ksmCliffCoverage = ksmSaved > 0 ? (available + zramHeadroom) / ksmSaved : 99;

    var swapActivity = deltas ? (deltas.pswpin_per_sec || 0) + (deltas.pswpout_per_sec || 0) : 0;
    var directReclaim = deltas ? deltas.pgsteal_direct_per_sec || 0 : 0;
    var kswapdHostPct = deltas ? deltas.kswapd_cpu_host_pct || 0 : 0;
    var mmHostPct = deltas ? deltas.mm_cpu_host_pct || 0 : 0;

    var pressureScore = 0;
    if (availablePct < 5) pressureScore += 3;
    else if (availablePct < 10) pressureScore += 2;
    else if (availablePct < 15) pressureScore += 1;

    if (ksmCliffCoverage < 0.75) pressureScore += 3;
    else if (ksmCliffCoverage < 1.0) pressureScore += 2;
    else if (ksmCliffCoverage < 1.25) pressureScore += 1;

    if (zramUtilPct > 85) pressureScore += 2;
    else if (zramUtilPct > 70) pressureScore += 1;

    if (directReclaim > 100 || swapActivity > 5000 || kswapdHostPct > 2) pressureScore += 3;
    else if (directReclaim > 10 || swapActivity > 500 || kswapdHostPct > 0.5) pressureScore += 1;

    var level = "good";
    var label = "NOMINAL";
    if (pressureScore >= 7) {
        level = "critical";
        label = "PRESSURE";
    } else if (pressureScore >= 4) {
        level = "risk";
        label = "ELEVATED";
    } else if (overcommitRatio >= 1.3 || reclaimPct >= 15) {
        level = "warn";
        label = "STABLE";
    }

    var keepUp = "quiet";
    if (directReclaim > 100 || swapActivity > 5000 || kswapdHostPct > 2) {
        keepUp = "stalled";
    } else if (directReclaim > 10 || swapActivity > 500 || kswapdHostPct > 0.5) {
        keepUp = "active";
    }

    return {
        level: level,
        label: label,
        fields: [
            { label: "commit", value: overcommitRatio.toFixed(2) + "x" },
            { label: "avail", value: pct(availablePct, 1) },
            { label: "KSM", value: humanGiB(ksmSaved) },
            { label: "cliff", value: ksmCliffCoverage.toFixed(2) + "x" },
            { label: "reclaim", value: keepUp },
        ],
    };
}

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

    var reclaimTotal = ksmSaved + zramSaved;
    var disposition = memoryDisposition(curr, deltas);

    container.appendChild(renderDispositionStrip(disposition));

    var memVisuals = el("div", { className: "observer-visual-grid" }, [
        visualCard("Guest Commitment", overcommitRatio.toFixed(2) + "x",
            Math.min((overcommitRatio / 2) * 100, 100),
            humanGiB(guestMem) + " committed / " + humanGiB(total) + " host", overcommitRatio >= 1.5 ? "risk" : "memory",
            "Guest RAM allocations compared with physical host RAM.",
            { value: overcommitRatio, max: 2, gradient: [
                { stop: 0, color: COLORS.good }, { stop: 0.5, color: COLORS.warn },
                { stop: 0.75, color: COLORS.risk }, { stop: 1, color: COLORS.crit }
            ]}),
        visualCard("Available Memory", humanGiB(available),
            Math.min((available / total) * 100, 100),
            pct((available / total) * 100) + " of host RAM", "efficiency",
            "Kernel estimate of memory available without heavy reclaim.",
            { value: (available / total) * 100, max: 100, color: COLORS.good }),
        visualCard("Reclaim Contribution", humanGiB(reclaimTotal),
            Math.min((reclaimTotal / total) * 100, 100),
            "KSM " + humanGiB(ksmSaved) + " / zram " + humanGiB(zramSaved), "savings",
            "Memory pressure relief currently provided by KSM and zram."),
        visualCard("Cache + Reclaimable", humanGiB(cached),
            Math.min((cached / total) * 100, 100),
            pct((cached / total) * 100) + " of host RAM", "cpu",
            "File cache and kernel reclaimable memory that can be repurposed."),
    ]);
    container.appendChild(memVisuals);

    // Effective memory disposition bar. KSM and zram are avoided RAM, so the
    // reference is logical demand rather than physical host RAM.
    var barCanvas = el("canvas", { className: "mem-bar-canvas" });
    container.appendChild(barCanvas);
    var usedNonCached = Math.max(used - cached, 0);
    var dispositionTotal = usedNonCached + cached + ksmSaved + zramSaved + available;

    // Bar legend
    var barLegend = el("div", { className: "bar-legend" }, [
        el("span", { className: "legend-swatch", style: "background:" + COLORS.memUsed }),
        el("span", { textContent: "Resident used " + humanGiB(usedNonCached) + "  " }),
        el("span", { className: "legend-swatch", style: "background:" + COLORS.memCached }),
        el("span", { textContent: "Cached " + humanGiB(cached) + "  " }),
        el("span", { className: "legend-swatch", style: "background:" + COLORS.memKsm }),
        el("span", { textContent: "KSM avoided " + humanGiB(ksmSaved) + "  " }),
        el("span", { className: "legend-swatch", style: "background:" + COLORS.memZram }),
        el("span", { textContent: "zram avoided " + humanGiB(zramSaved) + "  " }),
        el("span", { className: "legend-swatch", style: "background:" + COLORS.memAvail }),
        el("span", { textContent: "Available " + humanGiB(available) }),
    ]);
    container.appendChild(barLegend);

    var thpMode = curr.thp ? curr.thp.enabled || "unknown" : "unknown";
    var thpLine = el("div", { className: "memory-status-row" }, [
        el("span", { className: "memory-status-title", textContent: "Transparent Huge Pages:" }),
        el("span", { className: "memory-status-badge", textContent: thpMode }),
    ]);
    container.appendChild(thpLine);

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

    appendMemoryOverhead(container, curr, deltas);

    // Deferred draws
    requestAnimationFrame(function () {
        var segments = [
            { value: usedNonCached, color: COLORS.memUsed },
            { value: cached, color: COLORS.memCached },
            { value: ksmSaved, color: COLORS.memKsm },
            { value: zramSaved, color: COLORS.memZram },
            { value: available, color: COLORS.memAvail },
        ];
        drawStackedBar(barCanvas, segments, dispositionTotal || total, { minSegmentWidth: 3 });
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
    var comprRatio = z.compressed_bytes > 0 ? z.data_bytes / z.compressed_bytes : 0;

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
    var comprRatio = z.compressed_bytes > 0 ? z.data_bytes / z.compressed_bytes : 0;
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
    var policy = curr.zram_policy || {};
    var service = policy.service || {};
    var timer = policy.timer || {};

    var savedBytes = z.estimated_saved_bytes || 0;
    var comprRatio = z.compressed_bytes > 0 ? (z.data_bytes / z.compressed_bytes) : 0;
    var allocatorEfficiency = (mm.mem_used_total || 0) > 0 ? ((mm.compr_data_size || 0) / mm.mem_used_total) : 0;
    var disksize = z.disksize_bytes || 0;
    var dataBytes = z.data_bytes || 0;
    var memUsed = z.mem_used_bytes || 0;
    var compressedBytes = z.compressed_bytes || 0;
    var samePages = mm.same_pages || 0;
    var pagesCompacted = mm.pages_compacted || 0;
    var maxUsed = mm.max_used_memory || 0;
    var incompressiblePages = mm.huge_pages || 0;
    var backingDev = z.backing_dev || "";
    var backedBytes = bd.backed_bytes || 0;
    var writebackReadRate = deltas ? deltas.zram_writeback_reads_per_sec || 0 : 0;
    var writebackWriteRate = deltas ? deltas.zram_writeback_writes_per_sec || 0 : 0;
    var writebackLimitEnabled = !!z.writeback_limit_enabled;
    var writebackLimitBytes = z.writeback_limit_bytes || 0;

    // Swap utilization (how much of the zram device is occupied)
    var swapUsed = dataBytes;
    if (curr.swap) {
        for (var si = 0; si < curr.swap.length; si++) {
            var sn = curr.swap[si].name;
            if (sn === z.name || sn === "/dev/" + z.name) {
                swapUsed = curr.swap[si].used_bytes;
            }
        }
    }
    var swapUtilPct = disksize > 0 ? (swapUsed / disksize) * 100 : 0;
    var freeLogical = Math.max(disksize - swapUsed, 0);

    // kswapd CPU cost
    var kswapdHostPct = deltas ? deltas.kswapd_cpu_host_pct || 0 : 0;
    var kswapdCorePct = deltas ? deltas.kswapd_cpu_core_pct || 0 : 0;

    // Swap I/O rates
    var pswpinRate = deltas ? deltas.pswpin_per_sec || 0 : 0;
    var pswpoutRate = deltas ? deltas.pswpout_per_sec || 0 : 0;
    var pgscanKswapd = deltas ? deltas.pgscan_kswapd_per_sec || 0 : 0;
    var pgstealDirect = deltas ? deltas.pgsteal_direct_per_sec || 0 : 0;

    // Disposition strip (first element)
    var zramStrip = {
        level: verdict.level === "effective" ? "good" : verdict.level === "standby" || verdict.level === "idle" ? "good" :
               verdict.level === "moderate" ? "warn" : verdict.level === "poor" ? "risk" : "critical",
        label: verdict.label,
        fields: [
            { label: "compression", value: comprRatio > 0 ? comprRatio.toFixed(2) + ":1" : "n/a" },
            { label: "occupancy", value: pct(swapUtilPct) },
            { label: "saved", value: humanBytes(savedBytes) },
            { label: "reclaim", value: pct(kswapdHostPct, 2) },
        ],
    };
    container.appendChild(renderDispositionStrip(zramStrip));

    var savingsPct = dataBytes > 0 ? (savedBytes / dataBytes) * 100 : 0;
    var comprPct = Math.min((comprRatio / 4) * 100, 100);
    var reclaimScore = Math.min(Math.max((kswapdHostPct / 5) * 100, 0), 100);

    var visualGrid = el("div", { className: "zram-visual-grid" }, [
        zramVisualCard("Compression Efficiency", comprRatio > 0 ? comprRatio.toFixed(2) + ":1" : "n/a",
            comprPct, "zram-meter--compression",
            humanBytes(dataBytes) + " data / " + humanBytes(compressedBytes) + " compressed",
            "How efficiently zram compresses swapped pages in RAM.",
            comprRatio > 0 ? { value: comprRatio, max: 4, color: COLORS.blue } : null),
        zramVisualCard("Swap Occupancy", pct(swapUtilPct),
            swapUtilPct, "zram-meter--occupancy",
            humanBytes(swapUsed) + " used / " + humanBytes(disksize),
            "How full the zram swap device is right now.",
            { value: swapUtilPct, max: 100, gradient: [
                { stop: 0, color: COLORS.good }, { stop: 0.7, color: COLORS.warn },
                { stop: 0.9, color: COLORS.crit }
            ]}),
        zramVisualCard("RAM Avoided", humanBytes(savedBytes),
            savingsPct, "zram-meter--savings",
            humanBytes(memUsed) + " current RAM cost",
            "Estimated RAM saved after paying zram metadata and compression cost."),
        zramVisualCard("Reclaim Pressure", pct(kswapdHostPct, 2),
            reclaimScore, "zram-meter--pressure",
            "direct reclaim " + Math.round(pgstealDirect) + " pg/s",
            "CPU pressure from kernel reclaim activity feeding swap/zram."),
    ]);
    container.appendChild(visualGrid);

    var utilizationCanvas = el("canvas", { className: "zram-utilization-canvas" });
    container.appendChild(el("div", { className: "zram-utilization" }, [
        el("div", { className: "zram-utilization-head" }, [
            el("span", { className: "zram-utilization-title", textContent: "zram Utilization Mix" }),
            el("span", { className: "zram-utilization-summary", textContent: humanBytes(memUsed) + " RAM cost / " + humanBytes(savedBytes) + " avoided / " + humanBytes(freeLogical) + " free" }),
        ]),
        utilizationCanvas,
        el("div", { className: "zram-utilization-legend" }, [
            el("span", {}, [el("i", { className: "zram-legend-dot zram-legend-dot--cost" }), " RAM cost"]),
            el("span", {}, [el("i", { className: "zram-legend-dot zram-legend-dot--saved" }), " avoided RAM"]),
            el("span", {}, [el("i", { className: "zram-legend-dot zram-legend-dot--free" }), " free logical capacity"]),
        ]),
    ]));
    container.appendChild(renderZramAttribution(curr, swapUsed));

    var writebackRate = writebackReadRate + writebackWriteRate;
    var writebackLine = el("div", {
        className: "zram-writeback-row " + (backingDev ? "zram-writeback-row--active" : "zram-writeback-row--disabled"),
    }, [
        el("span", { className: "zram-writeback-title", textContent: "Writeback" }),
        el("span", { className: "zram-writeback-badge", textContent: backingDev ? "ACTIVE" : "DISABLED" }),
        el("span", { className: "zram-writeback-path", textContent: backingDev || "No backing device" }),
        el("span", { className: "zram-writeback-detail", textContent: "backed " + humanBytes(backedBytes) }),
        el("span", { className: "zram-writeback-detail", textContent: writebackRate > 0 ? "I/O " + humanRate(writebackRate) : "I/O idle" }),
        el("span", { className: "zram-writeback-detail", textContent: writebackLimitEnabled ? "limit " + humanBytes(writebackLimitBytes) : "limit off" }),
    ]);
    container.appendChild(writebackLine);

    var sparkRow = el("div", { className: "sparkline-row" });

    var savingsGroup = el("div", { className: "sparkline-group" });
    savingsGroup.appendChild(el("div", { className: "sparkline-label", textContent: "Savings Trend" }));
    var savingsCanvas = el("canvas", { className: "sparkline-canvas" });
    savingsGroup.appendChild(savingsCanvas);
    savingsGroup.appendChild(el("div", { className: "sparkline-value", textContent: humanBytes(savedBytes) }));
    sparkRow.appendChild(savingsGroup);

    var ioGroup = el("div", { className: "sparkline-group" });
    ioGroup.appendChild(el("div", { className: "sparkline-label", textContent: "Swap I/O Pressure" }));
    var ioCanvas = el("canvas", { className: "sparkline-canvas" });
    ioGroup.appendChild(ioCanvas);
    ioGroup.appendChild(el("div", { className: "sparkline-value", textContent: Math.round(pswpinRate + pswpoutRate) + " pg/s" }));
    sparkRow.appendChild(ioGroup);

    var utilGroup = el("div", { className: "sparkline-group" });
    utilGroup.appendChild(el("div", { className: "sparkline-label", textContent: "kswapd CPU" }));
    var utilCanvas = el("canvas", { className: "sparkline-canvas" });
    utilGroup.appendChild(utilCanvas);
    utilGroup.appendChild(el("div", { className: "sparkline-value", textContent: pct(kswapdHostPct, 2) + " host" }));
    sparkRow.appendChild(utilGroup);

    container.appendChild(sparkRow);

    var metricsGrid = el("div", { className: "metrics-grid zram-detail-grid" }, [
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Algorithm / streams" }),
            el("span", { className: "metric-value", textContent: z.algorithm + " / " + z.streams }),
        ]),
        maxUsed > 0 ? el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Peak RAM cost" }),
            el("span", { className: "metric-value", textContent: humanBytes(maxUsed) }),
        ]) : null,
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Same pages (dedup)" }),
            el("span", { className: "metric-value", textContent: fmtInt(samePages) }),
        ]),
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Pages compacted" }),
            el("span", { className: "metric-value", textContent: fmtInt(pagesCompacted) }),
        ]),
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Allocator efficiency" }),
            el("span", { className: "metric-value", textContent: allocatorEfficiency > 0 ? allocatorEfficiency.toFixed(2) + ":1" : "n/a" }),
        ]),
        el("div", { className: "metric" }, [
            el("span", { className: "metric-label", textContent: "Incompressible pages" }),
            el("span", { className: "metric-value", textContent: fmtInt(incompressiblePages) }),
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
            el("span", { className: "metric-label", textContent: "Policy timer" }),
            el("span", { className: "metric-value", textContent: [timer.ActiveState, timer.SubState].filter(Boolean).join(" / ") || "not found" }),
        ]),
    ]);
    var detailOpen = verdict.level !== "standby" && verdict.level !== "idle";
    var detailToggle = el("div", {
        className: "zram-detail-toggle",
        role: "button",
        "aria-expanded": detailOpen ? "true" : "false",
        textContent: "Detail Metrics",
    });
    var detailBody = el("div", { className: "zram-detail-body" + (detailOpen ? " is-open" : "") });
    detailBody.appendChild(metricsGrid);
    detailToggle.addEventListener("click", function () {
        var open = detailBody.classList.toggle("is-open");
        detailToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    container.appendChild(detailToggle);
    container.appendChild(detailBody);

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
                color: COLORS.zramLine, fill: "rgba(0,131,143,0.10)",
                min: 0, spotColor: COLORS.zramLine,
            });
        }
        var ioData = historySlice("zram_swap_io_rate");
        if (ioData.length >= 2) {
            drawSparkline(ioCanvas, ioData, {
                color: COLORS.amber, fill: "rgba(230,81,0,0.08)",
                min: 0, spotColor: COLORS.amber,
            });
        }
        var utilData = historySlice("zram_kswapd_host_pct");
        if (utilData.length >= 2) {
            drawSparkline(utilCanvas, utilData, {
                color: COLORS.purple, fill: "rgba(106,27,154,0.08)",
                min: 0, spotColor: COLORS.purple,
            });
        }
        drawStackedBar(utilizationCanvas, [
            { value: Math.max(memUsed, 0), color: COLORS.zramCost },
            { value: Math.max(savedBytes, 0), color: COLORS.zramSaved },
            { value: Math.max(freeLogical, 0), color: COLORS.zramFree },
        ], Math.max(disksize, memUsed + savedBytes + freeLogical, 1), { barHeight: 14, radius: 7 });
    });
}

// ---------------------------------------------------------------------------
// Render: Memory Management Overhead Summary
// ---------------------------------------------------------------------------

function appendMemoryOverhead(container, curr, deltas) {
    var threads = ["ksmd", "kswapd0", "kswapd1", "kcompactd0", "kcompactd1"];
    var totalPct = deltas ? deltas.mm_cpu_core_pct || 0 : 0;
    var numCpus = curr.num_cpus || 1;
    var hostPct = totalPct / numCpus;

    var ksmdPct = deltas && deltas.mm_breakdown ? deltas.mm_breakdown.ksmd || 0 : 0;
    var kswapdPct = deltas && deltas.mm_breakdown ?
        (deltas.mm_breakdown.kswapd0 || 0) + (deltas.mm_breakdown.kswapd1 || 0) : 0;
    var kcompactdPct = deltas && deltas.mm_breakdown ?
        (deltas.mm_breakdown.kcompactd0 || 0) + (deltas.mm_breakdown.kcompactd1 || 0) : 0;

    var section = el("div", { className: "memory-overhead-section" }, [
        el("div", { className: "memory-overhead-header" }, [
            el("span", { className: "memory-overhead-title", textContent: "Memory Management Overhead" }),
            el("span", { className: "memory-overhead-summary", textContent: pct(hostPct, 2) + " host CPU / " + pct(totalPct, 2) + " of one core" }),
        ]),
    ]);

    var overheadVisuals = el("div", { className: "observer-visual-grid" }, [
        visualCard("Total MM CPU", pct(hostPct, 2), Math.min((hostPct / 5) * 100, 100),
            pct(totalPct, 2) + " of one core", hostPct > 2 ? "risk" : "cost",
            "Combined host CPU cost of memory management kernel threads."),
        visualCard("KSM Scanner", pct(ksmdPct / numCpus, 2), Math.min(((ksmdPct / numCpus) / 3) * 100, 100),
            pct(ksmdPct, 2) + " core", "savings",
            "CPU consumed by ksmd while searching for duplicate pages."),
        visualCard("Swap Reclaim", pct(kswapdPct / numCpus, 2), Math.min(((kswapdPct / numCpus) / 3) * 100, 100),
            pct(kswapdPct, 2) + " core", "pressure",
            "CPU consumed by kswapd reclaiming memory under pressure."),
        visualCard("Compaction", pct(kcompactdPct / numCpus, 2), Math.min(((kcompactdPct / numCpus) / 3) * 100, 100),
            pct(kcompactdPct, 2) + " core", "memory",
            "CPU spent compacting memory for larger contiguous allocations."),
    ]);
    section.appendChild(overheadVisuals);

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
    section.appendChild(sparkRow);
    container.appendChild(section);

    // Deferred sparkline draws
    requestAnimationFrame(function () {
        for (var k = 0; k < threads.length; k++) {
            var tn = threads[k];
            var tc = section.querySelector('canvas[data-thread="' + tn + '"]');
            if (tc) {
                var tdata = state.history.map(function (h) {
                    return h.mm_breakdown && h.mm_breakdown[tn] ? h.mm_breakdown[tn] : 0;
                });
                if (tdata.length >= 2) {
                    drawSparkline(tc, tdata, {
                        color: COLORS.amber, min: 0, spotColor: COLORS.amber,
                    });
                }
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Render: Prometheus Export Panel
// ---------------------------------------------------------------------------

function renderPrometheus() {
    var container = clearEl("prometheus-content");
    if (!container) return;

    var status = state.prometheusStatus;
    if (!status) {
        container.appendChild(el("div", { className: "panel-placeholder", textContent: "Waiting for status..." }));
        return;
    }
    if (status.error) {
        container.appendChild(el("div", { className: "calabi-error", textContent: status.error }));
        return;
    }

    var exporter = status.exporter || status.collector || {};
    var endpoint = status.endpoint || {};
    var snapshot = status.snapshot || {};
    var config = status.config || {};
    var firewall = status.firewall || {};
    var security = status.security || {};
    var exporterEnabled = exporter.enabled === "enabled" || exporter.UnitFileState === "enabled";
    var exporterActive = exporter.active === "active" || exporter.ActiveState === "active";
    var snapshotReady = !!snapshot.exists;
    var intervalSeconds = config.interval_seconds || 5;
    var listenAddress = config.listen_address || endpoint.listen_address || "127.0.0.1:9910";
    var scrapeUrl = endpoint.scrape_url || ("http://" + listenAddress + "/metrics");
    var firewallOpen = firewall.open === true;
    var firewallRequestedOpen = config.firewall === "open";
    var firewallExposed = firewallRequestedOpen && firewallOpen && !security.local_only;
    var tlsLabel = security.tls_enabled ? "TLS" : "TLS deferred";
    var authLabel = security.basic_auth_enabled ? "Basic auth" : "Auth deferred";

    var visualGrid = el("div", { className: "observer-visual-grid" }, [
        visualCard("Calabi Exporter", exporterEnabled ? "Enabled" : "Disabled", exporterEnabled ? 100 : 0,
            (exporterActive ? [exporter.active || exporter.ActiveState, exporter.substate || exporter.SubState].filter(Boolean).join(" / ") : "not running") +
                " / " + intervalSeconds + "s",
            exporterEnabled ? "efficiency" : "default",
            "Persistent daemon collecting Calabi metrics, writing the Cockpit snapshot, and serving cached Prometheus output."),
        visualCard("Metrics Endpoint", exporterActive ? "Serving" : "Stopped", exporterActive ? 100 : 0,
            scrapeUrl,
            exporterActive ? "efficiency" : "risk",
            "Prometheus scrapes this Calabi-owned endpoint; scrapes do not trigger collection."),
        visualCard("Snapshot", snapshotReady ? humanBytes(snapshot.size_bytes || 0) : "Absent", snapshotReady ? 100 : 0,
            snapshotReady ? "Cockpit metrics cache" : "Waiting for first exporter sample", snapshotReady ? "memory" : "default",
            "JSON snapshot watched by the Cockpit page."),
        visualCard("Security", security.local_only ? "Loopback" : (firewallExposed ? "Exposed" : "Bound"), security.local_only || !firewallExposed ? 100 : 45,
            tlsLabel + " / " + authLabel,
            firewallExposed ? "risk" : "efficiency",
            "The direct exporter binds to loopback by default; network exposure should be intentional."),
    ]);
    container.appendChild(visualGrid);

    var securityClass = security.local_only ? "prometheus-security--local" :
        (firewallOpen ? "prometheus-security--exposed" : "prometheus-security--bound");
    var securityText = security.local_only ? "Localhost only" :
        (firewallOpen ? "Network exposed" : "Bound, firewall closed");
    container.appendChild(el("div", { className: "prometheus-security " + securityClass }, [
        el("strong", { textContent: "Scrape Exposure" }),
        el("span", { textContent: securityText + " / " + tlsLabel + " / " + authLabel }),
    ]));

    var settings = el("div", { className: "prometheus-settings" }, [
        el("label", {}, [
            el("span", { textContent: "Collection interval (seconds)" }),
            el("input", {
                id: "prometheus-interval",
                type: "number",
                min: "2",
                max: "3600",
                step: "1",
                value: String(intervalSeconds),
            }),
        ]),
        el("label", {}, [
            el("span", { textContent: "Listen address" }),
            el("input", {
                id: "prometheus-listen",
                type: "text",
                value: listenAddress,
                placeholder: "127.0.0.1:9910",
            }),
        ]),
    ]);
    container.appendChild(settings);

    var actions = el("div", { className: "prometheus-actions" }, [
        el("button", { id: "prometheus-apply-btn", type: "button", textContent: "Apply Settings" }),
        el("button", {
            id: "prometheus-export-toggle-btn",
            type: "button",
            className: "prometheus-toggle " + (exporterEnabled && exporterActive ? "prometheus-toggle--on" : "prometheus-toggle--off"),
            textContent: exporterEnabled && exporterActive ? "Calabi Export On" : "Calabi Export Off",
        }),
        el("button", {
            id: "prometheus-firewall-toggle-btn",
            type: "button",
            className: "prometheus-toggle " + (firewallExposed ? "prometheus-toggle--danger" : "prometheus-toggle--safe"),
            textContent: firewallExposed ? "Scrape Port Open" : (firewallRequestedOpen ? "Scrape Port Local Only" : "Scrape Port Closed"),
        }),
        el("button", { id: "prometheus-export-btn", type: "button", textContent: "Refresh Snapshot" }),
    ]);
    container.appendChild(actions);

    var detail = el("div", { className: "prometheus-detail" }, [
        el("span", { textContent: "Scrape: " + scrapeUrl }),
        el("span", { textContent: "Health: " + (endpoint.health_url || ("http://" + listenAddress + "/healthz")) }),
        el("span", { textContent: "Snapshot: " + (snapshot.exists ? "ready" : "absent") }),
        el("span", { textContent: "TLS/basic auth: deferred; keep loopback unless protected externally" }),
        el("span", { textContent: "Firewall: " + (firewall.firewalld_running ? (firewallOpen ? "open" : "closed") : (firewall.message || "not active")) }),
        el("span", { textContent: "Exporter unit: " + (exporter.unit || "calabi-exporter.service") }),
    ]);
    container.appendChild(detail);

    var applyBtn = document.getElementById("prometheus-apply-btn");
    var exportToggleBtn = document.getElementById("prometheus-export-toggle-btn");
    var firewallToggleBtn = document.getElementById("prometheus-firewall-toggle-btn");
    var exportBtn = document.getElementById("prometheus-export-btn");
    if (exportBtn) exportBtn.disabled = false;

    function bind(btn, action) {
        if (!btn) return;
        btn.addEventListener("click", function () {
            btn.disabled = true;
            prometheusControl(action)
                .then(function (next) {
                    state.prometheusStatus = next;
                    renderPrometheus();
                })
                .catch(function (err) {
                    state.prometheusStatus = { error: "Prometheus control failed: " + err };
                    renderPrometheus();
                });
        });
    }
    if (applyBtn) {
        applyBtn.addEventListener("click", function () {
            var interval = document.getElementById("prometheus-interval").value;
            var listen = document.getElementById("prometheus-listen").value;
            applyBtn.disabled = true;
            prometheusControl("configure", [
                "--interval-seconds", interval,
                "--listen-address", listen,
                "--firewall", config.firewall || "closed",
            ])
                .then(function (next) {
                    state.prometheusStatus = next;
                    renderPrometheus();
                })
                .catch(function (err) {
                    state.prometheusStatus = { error: "Prometheus configure failed: " + err };
                    renderPrometheus();
                });
        });
    }
    if (exportToggleBtn) {
        exportToggleBtn.addEventListener("click", function () {
            exportToggleBtn.disabled = true;
            prometheusControl(exporterEnabled && exporterActive ? "disable" : "enable")
                .then(function (next) {
                    state.prometheusStatus = next;
                    renderPrometheus();
                })
                .catch(function (err) {
                    state.prometheusStatus = { error: "Prometheus export toggle failed: " + err };
                    renderPrometheus();
                });
        });
    }
    if (firewallToggleBtn) {
        firewallToggleBtn.addEventListener("click", function () {
            var interval = document.getElementById("prometheus-interval").value;
            var listen = document.getElementById("prometheus-listen").value;
            var nextFirewall = firewallRequestedOpen ? "closed" : "open";
            firewallToggleBtn.disabled = true;
            prometheusControl("configure", [
                "--interval-seconds", interval,
                "--listen-address", listen,
                "--firewall", nextFirewall,
            ])
                .then(function (next) {
                    state.prometheusStatus = next;
                    renderPrometheus();
                })
                .catch(function (err) {
                    state.prometheusStatus = { error: "Prometheus firewall toggle failed: " + err };
                    renderPrometheus();
                });
        });
    }
    bind(exportBtn, "export-once");
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

function render() {
    var curr = state.current;
    if (!curr) return;

    var deltas = state.history.length > 0 ? state.history[state.history.length - 1] : null;

    if (state.activeTab === "cpu") {
        renderCPUOverview(curr, deltas);
        if (state.activeCpuSubTab === "topology") {
            renderCPUMap(curr, deltas);
        } else if (state.activeCpuSubTab === "ecc") {
            renderECC(curr, deltas);
        } else {
            renderCPU(curr, deltas);
        }
    } else if (state.activeTab === "memory") {
        renderMemory(curr, deltas);
        if (state.activeMemorySubTab === "zram") {
            renderZram(curr, deltas);
        } else {
            renderKSM(curr, deltas);
        }
    } else if (state.activeTab === "configuration") {
        renderPrometheus();
    }
    maintainHoverHelp();
}

// ---------------------------------------------------------------------------
// Poll cycle
// ---------------------------------------------------------------------------

function processSample(data, isFull) {
    if (data.error) {
        showError(data.error);
        return;
    }
    if (state.paused) return;
    var sampleTimestamp = data.timestamp || 0;
    if (sampleTimestamp && sampleTimestamp === state.lastSampleTimestamp) {
        return;
    }
    state.lastSampleTimestamp = sampleTimestamp;
    clearError();
    isFull = isFull || data.fast_mode !== true;

    // Merge domain and pool info from full samples.
    if (data.domains) {
        state.domains = data.domains;
        state.tierTotals = data.tier_totals;
        state.domainCgroups = data.domain_cgroups;
        state.guestMemoryBytes = data.guest_memory_bytes || 0;
        state.guestVcpus = data.guest_vcpus || 0;
    }
    if (data.cpu_pools) {
        state.cpuPools = data.cpu_pools;
        state.cpuPoolMap = data.cpu_pool_map;
    }

    // Fast samples: backfill cached full-sample data if the daemon omits it.
    if (!isFull && !data.domain_cgroups && state.domainCgroups) {
        data.domain_cgroups = state.domainCgroups;
    }
    if (!data.cpu_pool_map && state.cpuPoolMap) {
        data.cpu_pool_map = state.cpuPoolMap;
    }
    if (!data.cpu_pools && state.cpuPools) {
        data.cpu_pools = state.cpuPools;
    }

    state.current = data;

    // Compute deltas
    if (state.prev) {
        var deltas = computeDeltas(state.prev, data);
        if (deltas) {
            // Build history entry
            var zramDev = data.zram && data.zram[0] ? data.zram[0] : {};
            var zramSwapUsed = zramDev.data_bytes || 0;
            if (data.swap && zramDev.name) {
                for (var swi = 0; swi < data.swap.length; swi++) {
                    var swn = data.swap[swi].name;
                    if (swn === zramDev.name || swn === "/dev/" + zramDev.name) {
                        zramSwapUsed = data.swap[swi].used_bytes;
                    }
                }
            }
            var avgGuestPoolGhz = averagePoolFrequencyGhz(data, "guest_domain");
            var eccGhz = {};
            if (state.domains) {
                for (var edi = 0; edi < state.domains.length; edi++) {
                    var ed = state.domains[edi];
                    var edCpuPct = deltas.domain_cpu && deltas.domain_cpu[ed.name] ? deltas.domain_cpu[ed.name] : 0;
                    eccGhz[ed.name] = domainEffectiveClockGhz(ed, edCpuPct, avgGuestPoolGhz);
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
                avg_guest_pool_ghz: avgGuestPoolGhz,
                ecc_ghz: eccGhz,
                mem_available_gib: (data.meminfo && data.meminfo.MemAvailable || 0) / GiB,
                mm_cpu_core_pct: deltas.mm_cpu_core_pct,
                mm_breakdown: deltas.mm_breakdown,
                domain_cpu: deltas.domain_cpu,
                tier_cpu: deltas.tier_cpu,
                zram_saved_gib: (zramDev.estimated_saved_bytes || 0) / GiB,
                zram_writeback_io_bps: (deltas.zram_writeback_reads_per_sec || 0) + (deltas.zram_writeback_writes_per_sec || 0),
                zram_writeback_read_bps: deltas.zram_writeback_reads_per_sec || 0,
                zram_writeback_write_bps: deltas.zram_writeback_writes_per_sec || 0,
                zram_kswapd_host_pct: deltas.kswapd_cpu_host_pct || 0,
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

function startPolling() {
    if (state.metricFile) return;
    state.metricFile = cockpit.file(METRICS_PATH, { superuser: "try" });
    state.metricWatch = state.metricFile.watch(function (content) {
        if (!content) return;
        try {
            processSample(JSON.parse(content), false);
        } catch (err) {
            showError("Metric snapshot parse failed: " + err);
        }
    });
    state.metricFile.read()
        .then(function (content) {
            if (content) processSample(JSON.parse(content), false);
        })
        .catch(function (err) {
            showError("Waiting for observer daemon snapshot: " + err);
        });
}

function stopPolling() {
    if (state.metricWatch && typeof state.metricWatch.remove === "function") {
        state.metricWatch.remove();
    } else if (state.metricFile && typeof state.metricFile.close === "function") {
        state.metricFile.close();
    }
    state.metricWatch = null;
    state.metricFile = null;
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

function refreshPrometheusStatus() {
    prometheusControl("status")
        .then(function (status) {
            state.prometheusStatus = status;
            renderPrometheus();
        })
        .catch(function (err) {
            state.prometheusStatus = { error: "Prometheus status failed: " + err };
            renderPrometheus();
        });
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

}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", function () {
    cockpit.translate();
    initCpuSubTabs();
    initMemorySubTabs();
    initTabs();
    initHoverHelp();
    initControls();
    refreshPrometheusStatus();
    startPolling();
});
