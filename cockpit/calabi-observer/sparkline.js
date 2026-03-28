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
