/* sparkline.js — tiny canvas sparkline renderer for Calabi Observer */

"use strict";

/**
 * Draw a sparkline on a <canvas> element.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number[]} data - array of numeric values
 * @param {object} [opts]
 * @param {string} [opts.color="#06c"]       - stroke color
 * @param {string} [opts.fill]               - optional fill color (area under line)
 * @param {number} [opts.lineWidth=1.5]      - stroke width
 * @param {number} [opts.min]                - explicit y-axis minimum
 * @param {number} [opts.max]                - explicit y-axis maximum
 * @param {string} [opts.spotColor]          - if set, draw a dot on the last point
 * @param {number} [opts.spotRadius=2.5]     - radius of the last-point dot
 * @param {object} [opts.refLine]            - horizontal reference line
 * @param {number} opts.refLine.value        - y-axis value for the reference line
 * @param {string} opts.refLine.color        - stroke color
 * @param {number[]} [opts.refLine.dash]     - dash pattern (default [4,3])
 */
function drawSparkline(canvas, data, opts) {
    if (!canvas || !data || data.length < 2) return;

    opts = opts || {};
    var color = opts.color || "#06c";
    var fillColor = opts.fill || null;
    var lineWidth = opts.lineWidth || 1.5;
    var spotColor = opts.spotColor || null;
    var spotRadius = opts.spotRadius || 2.5;

    var dpr = window.devicePixelRatio || 1;
    var cw = canvas.clientWidth;
    var ch = canvas.clientHeight;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;

    var ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    var minVal = opts.min !== undefined ? opts.min : Math.min.apply(null, data);
    var maxVal = opts.max !== undefined ? opts.max : Math.max.apply(null, data);
    var range = maxVal - minVal;
    if (range === 0) range = 1;

    var pad = lineWidth;
    var drawH = ch - pad * 2;
    var drawW = cw - pad * 2;

    function xPos(i) {
        return pad + (i / (data.length - 1)) * drawW;
    }

    function yPos(v) {
        return pad + drawH - ((v - minVal) / range) * drawH;
    }

    ctx.clearRect(0, 0, cw, ch);

    // Fill area
    if (fillColor) {
        ctx.beginPath();
        ctx.moveTo(xPos(0), ch);
        for (var i = 0; i < data.length; i++) {
            ctx.lineTo(xPos(i), yPos(data[i]));
        }
        ctx.lineTo(xPos(data.length - 1), ch);
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();
    }

    // Stroke line
    ctx.beginPath();
    for (var j = 0; j < data.length; j++) {
        var x = xPos(j);
        var y = yPos(data[j]);
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    // Last-point dot
    if (spotColor) {
        var lastX = xPos(data.length - 1);
        var lastY = yPos(data[data.length - 1]);
        ctx.beginPath();
        ctx.arc(lastX, lastY, spotRadius, 0, Math.PI * 2);
        ctx.fillStyle = spotColor;
        ctx.fill();
    }

    // Reference line
    if (opts.refLine && opts.refLine.value !== undefined) {
        var ry = yPos(opts.refLine.value);
        if (ry >= pad && ry <= ch - pad) {
            ctx.save();
            ctx.strokeStyle = opts.refLine.color || "#c62828";
            ctx.lineWidth = 1;
            ctx.setLineDash(opts.refLine.dash || [4, 3]);
            ctx.beginPath();
            ctx.moveTo(pad, ry);
            ctx.lineTo(cw - pad, ry);
            ctx.stroke();
            ctx.restore();
        }
    }
}

/**
 * Draw a horizontal stacked bar.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{value: number, color: string, label?: string}>} segments
 * @param {number} total - the 100% reference value
 * @param {object} [opts]
 * @param {number} [opts.barHeight] - height of the bar (defaults to canvas height - 4)
 * @param {number} [opts.radius=3] - corner radius
 * @param {number} [opts.minSegmentWidth] - minimum visible width for non-zero segments
 */
function drawStackedBar(canvas, segments, total, opts) {
    if (!canvas || !segments || !total) return;

    opts = opts || {};
    var dpr = window.devicePixelRatio || 1;
    var cw = canvas.clientWidth;
    var ch = canvas.clientHeight;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;

    var ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    var barH = opts.barHeight || (ch - 4);
    var barY = (ch - barH) / 2;
    var radius = opts.radius !== undefined ? opts.radius : 3;
    var minSegmentWidth = opts.minSegmentWidth || 0;

    ctx.clearRect(0, 0, cw, ch);

    // Background track
    ctx.fillStyle = "#e8e8e8";
    roundRect(ctx, 0, barY, cw, barH, radius);
    ctx.fill();

    // Segments
    var x = 0;
    for (var i = 0; i < segments.length; i++) {
        var seg = segments[i];
        var w = (seg.value / total) * cw;
        if (minSegmentWidth > 0 && seg.value > 0 && w > 0 && w < minSegmentWidth) {
            w = minSegmentWidth;
        }
        if (x + w > cw) w = cw - x;
        if (w < 0.5) continue;
        ctx.fillStyle = seg.color;
        // First segment gets left radius, last gets right radius
        var rLeft = (i === 0) ? radius : 0;
        var rRight = (i === segments.length - 1 || x + w >= cw - 1) ? radius : 0;
        roundRectCustom(ctx, x, barY, w, barH, rLeft, rRight);
        ctx.fill();
        x += w;
    }
}

/**
 * Draw a radial arc gauge on a canvas element.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} value - current value
 * @param {number} max - maximum value (100 for percentages)
 * @param {object} [opts]
 * @param {string} [opts.color="#1565c0"]    - fill arc color
 * @param {string} [opts.track]              - track color (default: rgba based on theme)
 * @param {number} [opts.lineWidth=10]       - arc thickness
 * @param {string} [opts.label]              - text shown below value
 * @param {string} [opts.valueText]          - override displayed text (otherwise value.toFixed(1))
 * @param {string} [opts.textColor]          - value text color
 * @param {string} [opts.labelColor]         - label text color
 * @param {Array<{stop: number, color: string}>} [opts.gradient] - severity gradient stops
 */
function drawRadialGauge(canvas, value, max, opts) {
    if (!canvas) return;

    opts = opts || {};
    var dpr = window.devicePixelRatio || 1;
    var cw = canvas.clientWidth;
    var ch = canvas.clientHeight;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;

    var ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cw, ch);

    var lineWidth = opts.lineWidth || 10;
    var radius = Math.min(cw, ch) / 2 - lineWidth / 2 - 2;
    var cx = cw / 2;
    var cy = ch / 2 + radius * 0.12;

    // 270-degree arc: starts at 135° (bottom-left), ends at 405° (bottom-right)
    var startAngle = (135 * Math.PI) / 180;
    var endAngle = (405 * Math.PI) / 180;
    var totalAngle = endAngle - startAngle;

    var fraction = Math.max(0, Math.min(value / (max || 1), 1));
    var valueAngle = startAngle + totalAngle * fraction;

    // Track
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.strokeStyle = opts.track || "rgba(128, 128, 128, 0.15)";
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.stroke();

    // Fill arc
    if (fraction > 0.001) {
        if (opts.gradient && opts.gradient.length >= 2) {
            // Create a linear gradient mapped to the arc direction
            var gx1 = cx - radius;
            var gx2 = cx + radius;
            var grad = ctx.createLinearGradient(gx1, cy, gx2, cy);
            for (var gi = 0; gi < opts.gradient.length; gi++) {
                grad.addColorStop(opts.gradient[gi].stop, opts.gradient[gi].color);
            }
            ctx.strokeStyle = grad;
        } else {
            ctx.strokeStyle = opts.color || "#1565c0";
        }
        ctx.beginPath();
        ctx.arc(cx, cy, radius, startAngle, valueAngle);
        ctx.lineWidth = lineWidth;
        ctx.lineCap = "round";
        ctx.stroke();
    }

    // Value text
    var displayText = opts.valueText !== undefined ? opts.valueText : (value != null ? value.toFixed(1) : "—");
    var fontSize = Math.max(12, Math.floor(radius * 0.48));
    ctx.fillStyle = opts.textColor || "#f0f6fc";
    ctx.font = "800 " + fontSize + "px " + (opts.fontFamily || "system-ui, sans-serif");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(displayText, cx, cy - 2);

    // Label text
    if (opts.label) {
        var labelSize = Math.max(9, Math.floor(radius * 0.22));
        ctx.fillStyle = opts.labelColor || "rgba(128, 128, 128, 0.7)";
        ctx.font = "600 " + labelSize + "px system-ui, sans-serif";
        ctx.fillText(opts.label, cx, cy + fontSize * 0.55 + 2);
    }
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function roundRectCustom(ctx, x, y, w, h, rLeft, rRight) {
    ctx.beginPath();
    ctx.moveTo(x + rLeft, y);
    ctx.lineTo(x + w - rRight, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rRight);
    ctx.lineTo(x + w, y + h - rRight);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rRight, y + h);
    ctx.lineTo(x + rLeft, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rLeft);
    ctx.lineTo(x, y + rLeft);
    ctx.quadraticCurveTo(x, y, x + rLeft, y);
    ctx.closePath();
}
