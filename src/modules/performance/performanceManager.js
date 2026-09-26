/**
 * performanceManager.js — Real-Time Performance Monitor & Adaptive Workload Governor.
 *
 * CRITICAL ARCHITECTURAL ROLE:
 * Measures actual runtime performance (render FPS, frame times, inference latencies),
 * and dynamically adapts inference scheduling, tracking workloads, and rendering parameters
 * to maintain high responsiveness and stability targeting 60 FPS across varied hardware.
 *
 * FUNDAMENTAL INVARIANTS:
 * 1. Target is 60 FPS when hardware permits — 60 FPS is NEVER guaranteed or faked.
 * 2. Real moving metrics (dual-window rolling averages) drive tier transitions.
 * 3. Hysteresis cooldowns prevent rapid oscillation between quality tiers.
 * 4. Staggered inference scheduling prioritizes Face as primary identity anchor.
 * 5. SKIPPED INFERENCE NEVER DROPS TRACKS: PersonTracker identity continuity is strictly
 *    preserved; skipped passes reuse cached detections and velocity predictions.
 * 6. Single-person fast path preserves full fidelity for solo users.
 * 7. Two active TrackIDs never share an AvatarID, even under heavy throttling.
 */

export const PERFORMANCE_TIERS = {
  ULTRA: 'ULTRA',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW'
};

export const TIER_CONFIG = {
  [PERFORMANCE_TIERS.ULTRA]: {
    faceCadence: 1,       // Every frame (1:1)
    poseCadence: 1,       // Every frame (1:1)
    handCadence: 1,       // Every frame (1:1)
    pixelRatioMax: 2.0,
    springBoneSubsteps: 2,
    description: 'Full unconstrained fidelity'
  },
  [PERFORMANCE_TIERS.HIGH]: {
    faceCadence: 1,       // Every frame (1:1)
    poseCadence: 1,       // Every frame (1:1)
    handCadence: 1,       // Every frame (1:1)
    pixelRatioMax: 1.5,
    springBoneSubsteps: 1,
    description: 'High fidelity with standard sample count'
  },
  [PERFORMANCE_TIERS.MEDIUM]: {
    faceCadence: 1,       // Every frame (1:1 - face anchor prioritized)
    poseCadence: 2,       // Alternating frames (even)
    handCadence: 2,       // Alternating frames (odd)
    pixelRatioMax: 1.25,
    springBoneSubsteps: 1,
    description: 'Balanced: Staggered pose & hand inference'
  },
  [PERFORMANCE_TIERS.LOW]: {
    faceCadence: 1,       // Face prioritized
    poseCadence: 3,       // Every 3rd frame
    handCadence: 3,       // Every 3rd frame
    pixelRatioMax: 1.0,
    springBoneSubsteps: 1,
    description: 'Power-saver / throttled: Maximum CPU/GPU relief'
  }
};

// Pre-allocated circular ring buffer for O(1) sample push without GC churn
class FastRing {
  constructor(capacity) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity);
    this.count = 0;
    this.idx = 0;
  }
  push(val) {
    this.data[this.idx] = val;
    this.idx = (this.idx + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }
  mean() {
    if (this.count === 0) return 0;
    let s = 0;
    for (let i = 0; i < this.count; i++) s += this.data[i];
    return s / this.count;
  }
  get length() {
    return this.count;
  }
}

export class PerformanceManager {
  /**
   * @param {Object} [options]
   * @param {number} [options.targetFps=60] - Target control objective (60, 45, 30)
   * @param {'AUTO'|'ULTRA'|'HIGH'|'MEDIUM'|'LOW'} [options.mode='AUTO']
   * @param {number} [options.shortWindowSize=10] - Short rolling average sample count
   * @param {number} [options.mediumWindowSize=45] - Medium baseline sample count
   * @param {number} [options.degradeHoldFrames=30] - Sustained overload frames before downgrade
   * @param {number} [options.recoveryHoldFrames=60] - Sustained recovery frames before upgrade
   * @param {number} [options.minCooldownMs=1500] - Minimum time between tier shifts
   */
  constructor(options = {}) {
    this.targetFps = options.targetFps ?? 60;
    this.mode = options.mode ?? 'AUTO'; // 'AUTO' | 'ULTRA' | 'HIGH' | 'MEDIUM' | 'LOW'
    this.currentTier = (options.mode && PERFORMANCE_TIERS[options.mode]) ? options.mode : (options.currentTier ?? PERFORMANCE_TIERS.HIGH);

    // Rolling window sizes
    this.shortWindowSize = options.shortWindowSize ?? 10;
    this.mediumWindowSize = options.mediumWindowSize ?? 45;

    // Fast circular sample buffers for metrics (zero per-frame allocations)
    this._fpsHistory = new FastRing(this.mediumWindowSize);
    this._frameTimeHistory = new FastRing(this.mediumWindowSize);
    this._faceTimeHistory = new FastRing(this.shortWindowSize);
    this._poseTimeHistory = new FastRing(this.shortWindowSize);
    this._handTimeHistory = new FastRing(this.shortWindowSize);
    this._trackingTimeHistory = new FastRing(this.shortWindowSize);
    this._framingTimeHistory = new FastRing(this.shortWindowSize);
    this._renderTimeHistory = new FastRing(this.shortWindowSize);
    this._avatarUpdateTimeHistory = new FastRing(this.shortWindowSize);

    // Hysteresis counters & cooldown
    this.degradeHoldFrames = options.degradeHoldFrames ?? 30;
    this.recoveryHoldFrames = options.recoveryHoldFrames ?? 60;
    this.minCooldownMs = options.minCooldownMs ?? 1500;
    this._degradeCounter = 0;
    this._recoveryCounter = 0;
    this._lastTierChangeMs = 0;

    // Frame indexing for cadence scheduling
    this.frameIndex = 0;

    // Current smoothed metrics
    this.metrics = {
      fps: this.targetFps,
      frameTimeMs: 1000 / this.targetFps,
      faceInferMs: 0,
      poseInferMs: 0,
      handInferMs: 0,
      trackingMs: 0,
      framingMs: 0,
      renderMs: 0,
      avatarUpdateMs: 0,
      totalFrameTimeMs: 0,
      activePeople: 0,
      activeAvatars: 0
    };

    // User pixel ratio preference
    this.userPixelRatio = options.userPixelRatio ?? 1.5;

    // Callback when tier changes
    this.onTierChanged = null;
  }

  /**
   * Sets target FPS objective (30, 45, or 60).
   * @param {number} fps 
   */
  setTargetFps(fps) {
    const val = parseInt(fps, 10);
    if ([30, 45, 60].includes(val)) {
      this.targetFps = val;
      this._degradeCounter = 0;
      this._recoveryCounter = 0;
    }
  }

  /**
   * Sets operational mode ('AUTO', 'ULTRA', 'HIGH', 'MEDIUM', 'LOW').
   * @param {string} mode 
   */
  setMode(mode) {
    const upper = String(mode).toUpperCase();
    if (upper === 'AUTO' || PERFORMANCE_TIERS[upper]) {
      this.mode = upper;
      if (this.mode !== 'AUTO') {
        this._setTier(PERFORMANCE_TIERS[upper], 'User manual selection');
      }
    }
  }

  /**
   * Sets user's preferred upper bound pixel ratio.
   * @param {number} ratio
   */
  setUserPixelRatio(ratio) {
    const num = parseFloat(ratio);
    if (!isNaN(num) && num > 0) {
      this.userPixelRatio = num;
    }
  }

  /**
   * Returns effective pixel ratio, clamped to the active tier's pixelRatioMax.
   * @returns {number}
   */
  getEffectivePixelRatio() {
    const baseConfig = TIER_CONFIG[this.currentTier] || TIER_CONFIG[PERFORMANCE_TIERS.HIGH];
    const tierMax = baseConfig.pixelRatioMax;
    return Math.min(this.userPixelRatio ?? 2.0, tierMax);
  }

  /**
   * Internal helper to push a sample to a fixed-size buffer.
   * @private
   */
  _pushSample(buffer, value, maxLen) {
    buffer.push(value);
    if (buffer.length > maxLen) {
      buffer.shift();
    }
  }

  /**
   * Calculates arithmetic mean of an array.
   * @private
   */
  _mean(buffer) {
    if (!buffer || buffer.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += buffer[i];
    return sum / buffer.length;
  }

  /**
   * Records a frame's measurements and updates moving metrics.
   *
   * @param {Object} sample
   * @param {number} sample.fps - Instantaneous or smoothed render FPS
   * @param {number} sample.frameTimeMs - Duration of this frame (RAF dt)
   * @param {number} [sample.faceInferMs=0] - FaceLandmarker inference time
   * @param {number} [sample.poseInferMs=0] - PoseLandmarker inference time
   * @param {number} [sample.handInferMs=0] - HandLandmarker inference time
   * @param {number} [sample.trackingMs=0] - PersonTracker correlation time
   * @param {number} [sample.avatarUpdateMs=0] - Avatar kinematics update time
   * @param {number} [sample.activePeople=0] - Currently tracked people count
   * @param {number} [sample.activeAvatars=0] - Currently active 3D avatars
   * @param {number} [sample.timestampMs]
   */
  recordMetrics(sample) {
    this.frameIndex++;
    const now = sample.timestampMs ?? performance.now();

    // Store raw samples using O(1) circular buffers
    if (typeof sample.fps === 'number' && sample.fps > 0) this._fpsHistory.push(sample.fps);
    if (typeof sample.frameTimeMs === 'number' && sample.frameTimeMs > 0) this._frameTimeHistory.push(sample.frameTimeMs);
    if (typeof sample.faceInferMs === 'number') this._faceTimeHistory.push(sample.faceInferMs);
    if (typeof sample.poseInferMs === 'number') this._poseTimeHistory.push(sample.poseInferMs);
    if (typeof sample.handInferMs === 'number') this._handTimeHistory.push(sample.handInferMs);
    if (typeof sample.trackingMs === 'number') this._trackingTimeHistory.push(sample.trackingMs);
    if (typeof sample.framingMs === 'number') this._framingTimeHistory.push(sample.framingMs);
    if (typeof sample.avatarUpdateMs === 'number') this._avatarUpdateTimeHistory.push(sample.avatarUpdateMs);
    if (typeof sample.renderMs === 'number') this._renderTimeHistory.push(sample.renderMs);

    // Compute rolling averages
    this.metrics.fps = this._fpsHistory.mean();
    this.metrics.frameTimeMs = this._frameTimeHistory.mean();
    this.metrics.faceInferMs = this._faceTimeHistory.mean();
    this.metrics.poseInferMs = this._poseTimeHistory.mean();
    this.metrics.handInferMs = this._handTimeHistory.mean();
    this.metrics.trackingMs = this._trackingTimeHistory.mean();
    this.metrics.framingMs = this._framingTimeHistory.mean();
    this.metrics.avatarUpdateMs = this._avatarUpdateTimeHistory.mean();
    this.metrics.renderMs = this._renderTimeHistory.mean();
    this.metrics.totalFrameTimeMs = (
      this.metrics.faceInferMs +
      this.metrics.poseInferMs +
      this.metrics.handInferMs +
      this.metrics.trackingMs +
      this.metrics.framingMs +
      this.metrics.avatarUpdateMs +
      this.metrics.renderMs
    );
    this.metrics.activePeople = sample.activePeople ?? this.metrics.activePeople;
    this.metrics.activeAvatars = sample.activeAvatars ?? this.metrics.activeAvatars;

    // Evaluate dynamic adaptation if in AUTO mode
    if (this.mode === 'AUTO') {
      this._evaluateAdaptiveTier(now);
    }
  }

  /**
   * Evaluates hysteresis counters and performs tier transitions.
   * @private
   */
  _evaluateAdaptiveTier(now) {
    // Need at least shortWindowSize samples before adapting
    if (this._fpsHistory.length < this.shortWindowSize) return;

    // Cooldown check: prevent transitions within minCooldownMs
    if (now - this._lastTierChangeMs < this.minCooldownMs) return;

    // Single-Person Fast Path: If 1 person and FPS >= 24, maintain HIGH
    if (this.metrics.activePeople <= 1 && this.metrics.fps >= 24) {
      if (this.currentTier !== PERFORMANCE_TIERS.HIGH && this.currentTier !== PERFORMANCE_TIERS.ULTRA) {
        this._setTier(PERFORMANCE_TIERS.HIGH, 'Single-person fast path healthy');
      }
      this._degradeCounter = 0;
      this._recoveryCounter = 0;
      return;
    }

    const currentFps = this.metrics.fps;
    const degradeThreshold = Math.min(20, this.targetFps * 0.40); // Only degrade below 20 FPS
    const recoveryThreshold = Math.min(32, this.targetFps * 0.60); // Recover when >= 32 FPS

    // Overload check (sustained for degradeHoldFrames)
    if (currentFps < degradeThreshold) {
      this._degradeCounter++;
      this._recoveryCounter = 0;

      if (this._degradeCounter >= this.degradeHoldFrames) {
        this._stepDownTier(now);
        this._degradeCounter = 0;
      }
    }
    // Recovery check (sustained for recoveryHoldFrames)
    else if (currentFps >= recoveryThreshold) {
      this._recoveryCounter++;
      this._degradeCounter = 0;

      if (this._recoveryCounter >= this.recoveryHoldFrames) {
        this._stepUpTier(now);
        this._recoveryCounter = 0;
      }
    } else {
      // Within stable deadzone: reset transient counters
      this._degradeCounter = Math.max(0, this._degradeCounter - 1);
      this._recoveryCounter = Math.max(0, this._recoveryCounter - 1);
    }
  }

  /**
   * Steps down one tier towards LOW.
   * @private
   */
  _stepDownTier(now) {
    const order = [
      PERFORMANCE_TIERS.ULTRA,
      PERFORMANCE_TIERS.HIGH,
      PERFORMANCE_TIERS.MEDIUM,
      PERFORMANCE_TIERS.LOW
    ];
    const currentIndex = order.indexOf(this.currentTier);
    if (currentIndex < order.length - 1) {
      const newTier = order[currentIndex + 1];
      this._setTier(newTier, `FPS dropped to ${this.metrics.fps.toFixed(1)} (target: ${this.targetFps})`, now);
    }
  }

  /**
   * Steps up one tier towards ULTRA.
   * @private
   */
  _stepUpTier(now) {
    const order = [
      PERFORMANCE_TIERS.ULTRA,
      PERFORMANCE_TIERS.HIGH,
      PERFORMANCE_TIERS.MEDIUM,
      PERFORMANCE_TIERS.LOW
    ];
    const currentIndex = order.indexOf(this.currentTier);
    if (currentIndex > 0) {
      const newTier = order[currentIndex - 1];
      this._setTier(newTier, `FPS recovered to ${this.metrics.fps.toFixed(1)} (target: ${this.targetFps})`, now);
    }
  }

  /**
   * Sets active tier and notifies listeners.
   * @private
   */
  _setTier(newTier, reason = '', now = performance.now()) {
    if (this.currentTier === newTier) return;
    const prevTier = this.currentTier;
    this.currentTier = newTier;
    this._lastTierChangeMs = now;

    console.log(`[PerformanceManager] Tier transition: ${prevTier} -> ${newTier} | Reason: ${reason}`);

    if (this.onTierChanged) {
      this.onTierChanged({
        prevTier,
        currentTier: newTier,
        config: this.getConfig(),
        reason
      });
    }
  }

  /**
   * Returns active configuration parameters for current tier.
   * @returns {Object}
   */
  getConfig() {
    const base = TIER_CONFIG[this.currentTier] || TIER_CONFIG[PERFORMANCE_TIERS.HIGH];
    return {
      ...base,
      effectivePixelRatio: this.getEffectivePixelRatio()
    };
  }

  /**
   * Queries which inference tasks should run on the given frameIndex.
   * Implements strictly staggered / interleaved cadence so heavy models NEVER
   * execute in the same animation frame, preventing synchronous main-thread stalls.
   *
   * @param {number} [customIndex]
   * @param {Object} [options]
   * @param {boolean} [options.bodyTracking=true]
   * @param {boolean} [options.handTracking=true]
   * @returns {{ face: boolean, pose: boolean, hands: boolean }}
   */
  getSchedule(customIndex = null, options = {}) {
    const idx = customIndex ?? this.frameIndex;
    const config = this.getConfig();
    const hasPose = options.bodyTracking !== false;
    const hasHands = options.handTracking !== false;

    // Case 1: Face only (body and hands disabled)
    if (!hasPose && !hasHands) {
      return {
        face: (idx % config.faceCadence === 0),
        pose: false,
        hands: false
      };
    }

    // Case 2: Face + Pose only (hands disabled)
    if (hasPose && !hasHands) {
      if (this.currentTier === PERFORMANCE_TIERS.ULTRA) {
        return { face: true, pose: true, hands: false };
      }
      // Strict alternation: Even frames = Face, Odd frames = Pose
      return {
        face: (idx % 2 === 0),
        pose: (idx % 2 === 1),
        hands: false
      };
    }

    // Case 3: Face + Hands only (pose disabled)
    if (!hasPose && hasHands) {
      if (this.currentTier === PERFORMANCE_TIERS.ULTRA) {
        return { face: true, pose: false, hands: true };
      }
      return {
        face: (idx % 2 === 0),
        pose: false,
        hands: (idx % 2 === 1)
      };
    }

    // Case 4: Full tracking (Face + Pose + Hands)
    if (this.currentTier === PERFORMANCE_TIERS.ULTRA) {
      return { face: true, pose: true, hands: true };
    }

    // In HIGH / MEDIUM: 4-frame interleaved round-robin:
    // Slot 0: Face (20ms)
    // Slot 1: Pose (35ms)
    // Slot 2: Face (20ms)
    // Slot 3: Hands (35ms)
    // -> Face updates at 30Hz, Pose at 15Hz, Hands at 15Hz
    // -> NEVER do multiple heavy models run in the same frame!
    if (this.currentTier === PERFORMANCE_TIERS.HIGH || this.currentTier === PERFORMANCE_TIERS.MEDIUM) {
      const slot = idx % 4;
      return {
        face: (slot === 0 || slot === 2),
        pose: (slot === 1),
        hands: (slot === 3)
      };
    }

    // In LOW tier: 6-frame cycle with render-only rest frames
    const slot = idx % 6;
    return {
      face: (slot === 0 || slot === 4),
      pose: (slot === 2),
      hands: (slot === 5)
    };
  }

  /**
   * Telemetry summary for diagnostics and UI display.
   */
  getTelemetry() {
    return {
      targetFps: this.targetFps,
      actualFps: Math.round(this.metrics.fps),
      frameTimeMs: Number(this.metrics.frameTimeMs.toFixed(1)),
      faceInferMs: Number(this.metrics.faceInferMs.toFixed(1)),
      poseInferMs: Number(this.metrics.poseInferMs.toFixed(1)),
      handInferMs: Number(this.metrics.handInferMs.toFixed(1)),
      trackingMs: Number(this.metrics.trackingMs.toFixed(1)),
      framingMs: Number(this.metrics.framingMs.toFixed(2)),
      avatarUpdateMs: Number(this.metrics.avatarUpdateMs.toFixed(1)),
      renderMs: Number(this.metrics.renderMs.toFixed(2)),
      totalComputeMs: Number(this.metrics.totalFrameTimeMs.toFixed(1)),
      tier: this.currentTier,
      mode: this.mode,
      activePeople: this.metrics.activePeople,
      activeAvatars: this.metrics.activeAvatars,
      config: this.getConfig()
    };
  }
}

export const performanceManager = new PerformanceManager();
export default performanceManager;
