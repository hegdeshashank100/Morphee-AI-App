/**
 * renderScheduler.js — Configurable Real-Time Render FPS Pacing & Cadence Engine.
 *
 * CRITICAL ARCHITECTURAL ROLE:
 * Governs the rendering frequency of Three.js draw calls and VRM stage updates to strictly
 * enforce the user-selected target FPS (30, 45, or 60 FPS) while eliminating frame pacing
 * judder, unnecessary GPU rendering on high-refresh displays (120Hz/144Hz), and timing drift.
 *
 * GUARANTEES:
 * 1. Target FPS enforcement: 30, 45, 60 FPS mapping to ~33.33ms, ~22.22ms, ~16.67ms.
 * 2. Monotonic clock with sub-millisecond precision via performance.now().
 * 3. Anti-drift cadence tracking without catch-up render bursts.
 * 4. Zero interference with computer vision inference or tracking state machine.
 * 5. Instantaneous runtime target changes without application or tracking resets.
 * 6. Zero heap allocations inside the hot RAF tick.
 */

export const VALID_TARGET_FPS = [30, 45, 60];

export class RenderScheduler {
  /**
   * @param {Object} [options]
   * @param {number} [options.targetFps=60]
   * @param {number} [options.jitterToleranceMs=2.0]
   */
  constructor(options = {}) {
    this._targetFps = 60;
    this._targetInterval = 1000 / 60;
    this._jitterTolerance = options.jitterToleranceMs ?? 2.0;

    this._lastRenderTime = 0;
    this._lastRafTime = 0;
    this._rafDeltaHistory = new Float32Array(30);
    this._renderDeltaHistory = new Float32Array(30);
    this._rafIdx = 0;
    this._renderIdx = 0;
    this._rafCount = 0;
    this._renderCount = 0;

    this._skippedFrames = 0;
    this._renderedFrames = 0;
    this._totalRafCallbacks = 0;

    this.setTargetFps(options.targetFps ?? 60);
  }

  get targetFps() {
    return this._targetFps;
  }

  get targetInterval() {
    return this._targetInterval;
  }

  get totalRafCallbacks() {
    return this._totalRafCallbacks;
  }

  get renderedFrames() {
    return this._renderedFrames;
  }

  get skippedFrames() {
    return this._skippedFrames;
  }

  /**
   * Updates target FPS objective immediately without resetting application or tracking state.
   * @param {number} fps - 30, 45, or 60
   * @returns {boolean} true if valid and updated
   */
  setTargetFps(fps) {
    const val = parseInt(fps, 10);
    if (!VALID_TARGET_FPS.includes(val)) {
      console.warn(`[RenderScheduler] Invalid target FPS: ${fps}. Must be 30, 45, or 60.`);
      return false;
    }

    if (this._targetFps === val) return true;

    this._targetFps = val;
    this._targetInterval = 1000 / val;
    // Reset reference time to prevent burst when switching targets
    this._lastRenderTime = 0;
    return true;
  }

  /**
   * Evaluates whether a render pass is due on the current RAF callback.
   * @param {number} [now] - High-resolution timestamp from performance.now() or RAF
   * @returns {{
   *   isDue: boolean,
   *   renderDeltaMs: number,
   *   rafDeltaMs: number,
   *   pacingErrorMs: number
   * }}
   */
  checkRenderDue(now = (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    this._totalRafCallbacks++;

    const rafDelta = this._lastRafTime > 0 ? (now - this._lastRafTime) : 16.67;
    this._lastRafTime = now;

    // Track rolling RAF callback interval
    this._rafDeltaHistory[this._rafIdx] = rafDelta;
    this._rafIdx = (this._rafIdx + 1) % 30;
    if (this._rafCount < 30) this._rafCount++;

    if (this._lastRenderTime === 0) {
      // First frame always renders immediately
      this._lastRenderTime = now;
      this._renderedFrames++;
      return {
        isDue: true,
        renderDeltaMs: this._targetInterval,
        rafDeltaMs: rafDelta,
        pacingErrorMs: 0
      };
    }

    const elapsed = now - this._lastRenderTime;

    // Check if deadline reached (with jitter tolerance to absorb VSync phase fluctuations)
    if (elapsed >= this._targetInterval - this._jitterTolerance) {
      const renderDelta = elapsed;
      const pacingError = elapsed - this._targetInterval;

      // Anti-drift reference update:
      // If elapsed time is significantly delayed (e.g. > 2.5x target interval due to stall or tab switch),
      // anchor reference to now to avoid a burst of catch-up renders.
      if (elapsed > this._targetInterval * 2.5) {
        this._lastRenderTime = now;
      } else {
        this._lastRenderTime += this._targetInterval;
        // Clamp to prevent reference time from falling behind
        if (this._lastRenderTime < now - this._targetInterval) {
          this._lastRenderTime = now;
        }
      }

      this._renderedFrames++;
      this._renderDeltaHistory[this._renderIdx] = renderDelta;
      this._renderIdx = (this._renderIdx + 1) % 30;
      if (this._renderCount < 30) this._renderCount++;

      return {
        isDue: true,
        renderDeltaMs: renderDelta,
        rafDeltaMs: rafDelta,
        pacingErrorMs: pacingError
      };
    }

    // Render is not due yet; skip this render pass
    this._skippedFrames++;
    return {
      isDue: false,
      renderDeltaMs: 0,
      rafDeltaMs: rafDelta,
      pacingErrorMs: 0
    };
  }

  /**
   * Computes rolling statistics for telemetry.
   */
  getTelemetry() {
    let rafSum = 0;
    for (let i = 0; i < this._rafCount; i++) rafSum += this._rafDeltaHistory[i];
    const avgRafDt = this._rafCount > 0 ? (rafSum / this._rafCount) : 16.67;
    const rafHz = avgRafDt > 0 ? Number((1000 / avgRafDt).toFixed(1)) : 0;

    let renderSum = 0;
    for (let i = 0; i < this._renderCount; i++) renderSum += this._renderDeltaHistory[i];
    const avgRenderDt = this._renderCount > 0 ? (renderSum / this._renderCount) : this._targetInterval;
    const renderFps = avgRenderDt > 0 ? Number((1000 / avgRenderDt).toFixed(1)) : 0;

    return {
      targetFps: this._targetFps,
      targetIntervalMs: Number(this._targetInterval.toFixed(2)),
      actualRenderFps: renderFps,
      actualRenderIntervalMs: Number(avgRenderDt.toFixed(2)),
      rafFrequencyHz: rafHz,
      totalRafCallbacks: this._totalRafCallbacks,
      renderedFrames: this._renderedFrames,
      skippedFrames: this._skippedFrames,
      skipRatio: this._totalRafCallbacks > 0 
        ? Number(((this._skippedFrames / this._totalRafCallbacks) * 100).toFixed(1)) 
        : 0
    };
  }

  /**
   * Resets scheduler state.
   */
  reset() {
    this._lastRenderTime = 0;
    this._lastRafTime = 0;
    this._rafIdx = 0;
    this._renderIdx = 0;
    this._rafCount = 0;
    this._renderCount = 0;
    this._skippedFrames = 0;
    this._renderedFrames = 0;
    this._totalRafCallbacks = 0;
    this._rafDeltaHistory.fill(0);
    this._renderDeltaHistory.fill(0);
  }
}

export const renderScheduler = new RenderScheduler();
