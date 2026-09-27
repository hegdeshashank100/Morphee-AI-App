/**
 * profiler.js — High-Resolution Frame Pipeline Profiler & Benchmark Engine.
 *
 * CRITICAL PERFORMANCE CONTRACT:
 * 1. Zero heap allocations during active per-frame measurement (uses pre-allocated Float32Array ring buffers).
 * 2. Measures every pipeline stage independently using performance.now().
 * 3. Measures actual render frame intervals and software execution times separately.
 * 4. Collects exact statistics: avg, median, p95, p99, worst frame.
 * 5. Tracks latency budget violation counters (>16.67ms, >33.33ms, >50ms, >100ms).
 */

const METRIC_KEYS = [
  'totalFrameMs',
  'frameIntervalMs',
  'pacingErrorMs',
  'faceMs',
  'poseMs',
  'handsMs',
  'trackingMs',
  'assignmentMs',
  'avatarUpdateMs',
  'expressionMs',
  'bodyRetargetMs',
  'handRetargetMs',
  'physicsMs',
  'framingMs',
  'renderMs'
];

export class FrameProfiler {
  /**
   * @param {number} [windowSize=120]
   */
  constructor(windowSize = 120) {
    this.windowSize = Math.max(10, windowSize);
    this.totalFramesMeasured = 0;

    // Latency bucket counters (budget violations)
    this.countOver16ms = 0; // > 16.67ms (drops below 60fps)
    this.countOver33ms = 0; // > 33.33ms (drops below 30fps)
    this.countOver50ms = 0; // > 50.00ms (drops below 20fps)
    this.countOver100ms = 0; // > 100.0ms (drops below 10fps)

    this._frameStartTime = 0;
    this._idx = 0;
    this._count = 0;

    // Truthful Render Scheduler metrics
    this.targetFps = 60;
    this.rafFrequencyHz = 60;
    this.schedulerSkippedFrames = 0;
    this.schedulerRenderedFrames = 0;

    // Pre-allocated typed arrays for zero-allocation recording
    this._buffers = {};
    for (const key of METRIC_KEYS) {
      this._buffers[key] = new Float32Array(this.windowSize);
    }

    // Pre-allocated scratch buffer for statistical sorting (zero allocation in getStats)
    this._scratchSortBuffer = new Float32Array(this.windowSize);
  }

  /**
   * Backward-compatible accessor for callers inspecting history length.
   */
  get history() {
    return {
      length: this._count
    };
  }

  /**
   * Marks the start of a frame.
   */
  startFrame() {
    this._frameStartTime = performance.now();
  }

  /**
   * Records completed metrics for a single frame with ZERO heap allocations.
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

    if (typeof metrics.targetFps === 'number') this.targetFps = metrics.targetFps;
    if (typeof metrics.rafFrequencyHz === 'number') this.rafFrequencyHz = metrics.rafFrequencyHz;
    if (typeof metrics.schedulerSkippedFrames === 'number') this.schedulerSkippedFrames = metrics.schedulerSkippedFrames;
    if (typeof metrics.schedulerRenderedFrames === 'number') this.schedulerRenderedFrames = metrics.schedulerRenderedFrames;

    const idx = this._idx;
    this._buffers.totalFrameMs[idx] = totalFrameMs;
    this._buffers.frameIntervalMs[idx] = metrics.frameIntervalMs ?? 0;
    this._buffers.pacingErrorMs[idx] = metrics.pacingErrorMs ?? 0;
    this._buffers.faceMs[idx] = metrics.faceMs || 0;
    this._buffers.poseMs[idx] = metrics.poseMs || 0;
    this._buffers.handsMs[idx] = metrics.handsMs || 0;
    this._buffers.trackingMs[idx] = metrics.trackingMs || 0;
    this._buffers.assignmentMs[idx] = metrics.assignmentMs || 0;
    this._buffers.avatarUpdateMs[idx] = metrics.avatarUpdateMs || 0;
    this._buffers.expressionMs[idx] = metrics.expressionMs || 0;
    this._buffers.bodyRetargetMs[idx] = metrics.bodyRetargetMs || 0;
    this._buffers.handRetargetMs[idx] = metrics.handRetargetMs || 0;
    this._buffers.physicsMs[idx] = metrics.physicsMs || 0;
    this._buffers.framingMs[idx] = metrics.framingMs || 0;
    this._buffers.renderMs[idx] = metrics.renderMs || 0;

    this._idx = (this._idx + 1) % this.windowSize;
    if (this._count < this.windowSize) {
      this._count++;
    }
  }

  /**
   * Resets all history and bucket counters.
   */
  reset() {
    this._idx = 0;
    this._count = 0;
    this.totalFramesMeasured = 0;
    this.countOver16ms = 0;
    this.countOver33ms = 0;
    this.countOver50ms = 0;
    this.countOver100ms = 0;
    this.schedulerSkippedFrames = 0;
    this.schedulerRenderedFrames = 0;
    for (const key of METRIC_KEYS) {
      this._buffers[key].fill(0);
    }
  }

  /**
   * Computes statistical aggregates for a given metric key.
   * Uses pre-allocated scratch buffer for zero persistent GC churn.
   * @param {string} key - e.g. 'totalFrameMs', 'faceMs', 'renderMs', 'frameIntervalMs', 'pacingErrorMs'
   */
  getStats(key = 'totalFrameMs') {
    const n = this._count;
    if (n === 0) {
      return { avg: 0, median: 0, p95: 0, p99: 0, worst: 0, samples: 0 };
    }

    const buf = this._buffers[key];
    if (!buf) {
      return { avg: 0, median: 0, p95: 0, p99: 0, worst: 0, samples: 0 };
    }

    const sortBuf = this._scratchSortBuffer;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = buf[i];
      sortBuf[i] = v;
      sum += v;
    }

    // Sort valid subset
    const sub = sortBuf.subarray(0, n);
    sub.sort();

    const avg = sum / n;
    const median = sub[Math.floor(n * 0.5)];
    const p95 = sub[Math.min(n - 1, Math.floor(n * 0.95))];
    const p99 = sub[Math.min(n - 1, Math.floor(n * 0.99))];
    const worst = sub[n - 1];

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
    const breakdown = {};
    for (const k of METRIC_KEYS) {
      breakdown[k] = this.getStats(k);
    }

    const totalStats = breakdown.totalFrameMs;
    const intervalStats = breakdown.frameIntervalMs;
    // Calculate FPS based on real frame intervals if available, else totalFrameMs
    const effectiveFrameTime = (intervalStats.avg > 0) ? intervalStats.avg : totalStats.avg;
    const currentFps = effectiveFrameTime > 0 ? Number((1000 / effectiveFrameTime).toFixed(1)) : 0;

    const totalSched = this.schedulerRenderedFrames + this.schedulerSkippedFrames;
    const skipRatio = totalSched > 0 ? Number(((this.schedulerSkippedFrames / totalSched) * 100).toFixed(1)) : 0;

    return {
      fps: currentFps,
      targetFps: this.targetFps,
      rafFrequencyHz: this.rafFrequencyHz,
      totalFramesMeasured: this.totalFramesMeasured,
      scheduler: {
        rendered: this.schedulerRenderedFrames,
        skipped: this.schedulerSkippedFrames,
        skipRatio
      },
      windowSamples: this._count,
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
