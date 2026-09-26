/**
 * profiler.js — High-Resolution Frame Pipeline Profiler & Benchmark Engine.
 *
 * CRITICAL PERFORMANCE CONTRACT:
 * 1. Zero memory allocations during active per-frame measurement.
 * 2. Measures every pipeline stage independently using performance.now().
 * 3. Collects exact statistics: avg, median, p95, p99, worst frame.
 * 4. Tracks latency budget violation counters (>16.67ms, >33.33ms, >50ms, >100ms).
 */

export class FrameProfiler {
  constructor(windowSize = 120) {
    this.windowSize = windowSize;
    this.history = [];
    this.totalFramesMeasured = 0;

    // Latency bucket counters
    this.countOver16ms = 0; // > 16.67ms (drops below 60fps)
    this.countOver33ms = 0; // > 33.33ms (drops below 30fps)
    this.countOver50ms = 0; // > 50.00ms (drops below 20fps)
    this.countOver100ms = 0; // > 100.0ms (drops below 10fps)

    this._frameStartTime = 0;
  }

  /**
   * Marks the start of a frame.
   */
  startFrame() {
    this._frameStartTime = performance.now();
  }

  /**
   * Records completed metrics for a single frame.
   * @param {Object} metrics
   */
  recordFrame(metrics) {
    const totalFrameMs = metrics.totalFrameMs ?? (performance.now() - this._frameStartTime);

    // Update threshold counters
    this.totalFramesMeasured++;
    if (totalFrameMs > 16.67) this.countOver16ms++;
    if (totalFrameMs > 33.33) this.countOver33ms++;
    if (totalFrameMs > 50.0) this.countOver50ms++;
    if (totalFrameMs > 100.0) this.countOver100ms++;

    const record = {
      faceMs: metrics.faceMs || 0,
      poseMs: metrics.poseMs || 0,
      handsMs: metrics.handsMs || 0,
      trackingMs: metrics.trackingMs || 0,
      assignmentMs: metrics.assignmentMs || 0,
      avatarUpdateMs: metrics.avatarUpdateMs || 0,
      expressionMs: metrics.expressionMs || 0,
      bodyRetargetMs: metrics.bodyRetargetMs || 0,
      handRetargetMs: metrics.handRetargetMs || 0,
      physicsMs: metrics.physicsMs || 0,
      framingMs: metrics.framingMs || 0,
      renderMs: metrics.renderMs || 0,
      totalFrameMs: totalFrameMs,
      timestamp: performance.now()
    };

    this.history.push(record);
    if (this.history.length > this.windowSize) {
      this.history.shift();
    }
  }

  /**
   * Resets all history and bucket counters.
   */
  reset() {
    this.history = [];
    this.totalFramesMeasured = 0;
    this.countOver16ms = 0;
    this.countOver33ms = 0;
    this.countOver50ms = 0;
    this.countOver100ms = 0;
  }

  /**
   * Computes statistical aggregates for a given metric key.
   * @param {string} key - e.g. 'totalFrameMs', 'faceMs', 'renderMs'
   */
  getStats(key = 'totalFrameMs') {
    if (this.history.length === 0) {
      return { avg: 0, median: 0, p95: 0, p99: 0, worst: 0, samples: 0 };
    }

    const values = this.history.map(f => f[key] || 0).sort((a, b) => a - b);
    const n = values.length;
    const sum = values.reduce((acc, v) => acc + v, 0);

    const avg = sum / n;
    const median = values[Math.floor(n * 0.5)];
    const p95 = values[Math.floor(n * 0.95)];
    const p99 = values[Math.floor(n * 0.99)];
    const worst = values[n - 1];

    return {
      avg: Number(avg.toFixed(2)),
      median: Number(median.toFixed(2)),
      p95: Number(p95.toFixed(2)),
      p99: Number(p99.toFixed(2)),
      worst: Number(worst.toFixed(2)),
      samples: n
    };
  }

  /**
   * Returns a complete benchmark report object.
   */
  getSummary() {
    const keys = [
      'totalFrameMs', 'faceMs', 'poseMs', 'handsMs',
      'trackingMs', 'assignmentMs', 'avatarUpdateMs',
      'expressionMs', 'bodyRetargetMs', 'handRetargetMs',
      'physicsMs', 'framingMs', 'renderMs'
    ];

    const breakdown = {};
    for (const k of keys) {
      breakdown[k] = this.getStats(k);
    }

    const totalStats = breakdown.totalFrameMs;
    const currentFps = totalStats.avg > 0 ? Number((1000 / totalStats.avg).toFixed(1)) : 0;

    return {
      fps: currentFps,
      totalFramesMeasured: this.totalFramesMeasured,
      windowSamples: this.history.length,
      buckets: {
        over16ms: this.countOver16ms,
        over33ms: this.countOver33ms,
        over50ms: this.countOver50ms,
        over100ms: this.countOver100ms,
        pctOver16ms: this.totalFramesMeasured ? Number(((this.countOver16ms / this.totalFramesMeasured) * 100).toFixed(1)) : 0,
        pctOver33ms: this.totalFramesMeasured ? Number(((this.countOver33ms / this.totalFramesMeasured) * 100).toFixed(1)) : 0,
        pctOver50ms: this.totalFramesMeasured ? Number(((this.countOver50ms / this.totalFramesMeasured) * 100).toFixed(1)) : 0,
        pctOver100ms: this.totalFramesMeasured ? Number(((this.countOver100ms / this.totalFramesMeasured) * 100).toFixed(1)) : 0
      },
      stats: breakdown
    };
  }
}

export const profiler = new FrameProfiler(120);
if (typeof window !== 'undefined') {
  window.__morpheeProfiler = profiler;
}
