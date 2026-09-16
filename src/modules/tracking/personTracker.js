/**
 * PersonTracker — Spatial & Temporal Identity Tracker for Morphee AI
 *
 * ARCHITECTURAL NOTICE:
 * MediaPipe detection indices are frame-local result slots and MUST NOT be used as persistent person identities.
 * PersonTracker correlates raw multi-face, multi-pose, and multi-hand detections across consecutive frames using:
 *  - Spatial centroid distance & bounding box IoU
 *  - Velocity prediction (p_pred = p + v * dt)
 *  - Ambiguity & crossing shields (directional momentum preservation)
 *  - Track state machine: INIT -> TRACKED -> COASTING -> REACQUIRED -> TERMINATED
 *
 * ABSOLUTE CONSTRAINTS:
 *  - Purely spatial/temporal tracking.
 *  - ZERO facial recognition, appearance classification, or biometric embeddings.
 */

export class TrackedPerson {
  /**
   * @param {number} trackId
   * @param {{x: number, y: number}} centroid
   * @param {{x: number, y: number, width: number, height: number}} bbox
   * @param {number} scale
   * @param {number} timestampMs
   */
  constructor(trackId, centroid, bbox, scale, timestampMs) {
    this.trackId = trackId;
    this.state = 'INIT'; // 'INIT' | 'TRACKED' | 'COASTING' | 'REACQUIRED' | 'TERMINATED'
    
    // Spatial state
    this.centroid = { x: centroid.x, y: centroid.y };
    this.prevCentroid = { x: centroid.x, y: centroid.y };
    this.predictedCentroid = { x: centroid.x, y: centroid.y };
    this.velocity = { vx: 0, vy: 0 }; // Normalized units per second
    this.bbox = { ...bbox };
    this.scale = scale;
    
    // Lifespan & tracking stats
    this.age = 1;
    this.totalTrackedFrames = 1;
    this.missedFrames = 0;
    this.confidence = 1.0;
    this.createdAtMs = timestampMs;
    this.lastSeenMs = timestampMs;

    // Associated detection data (per-frame)
    this.face = null;
    this.pose = null;
    this.hands = [];
  }

  /**
   * Predicts next position based on current velocity and time delta.
   * @param {number} dtSec
   */
  predict(dtSec) {
    const dt = Math.min(Math.max(dtSec, 0.001), 0.5);
    this.predictedCentroid.x = this.centroid.x + this.velocity.vx * dt;
    this.predictedCentroid.y = this.centroid.y + this.velocity.vy * dt;
    return this.predictedCentroid;
  }

  /**
   * Updates track with newly matched face detection.
   * @param {Object} detection
   * @param {number} dtSec
   * @param {number} timestampMs
   */
  update(detection, dtSec, timestampMs) {
    const dt = Math.min(Math.max(dtSec, 0.001), 0.5);

    // Instantaneous velocity calculation
    const instVx = (detection.centroid.x - this.centroid.x) / dt;
    const instVy = (detection.centroid.y - this.centroid.y) / dt;

    // Exponential Moving Average (EMA) smoothing for velocity (alpha = 0.45)
    this.velocity.vx = this.velocity.vx * 0.55 + instVx * 0.45;
    this.velocity.vy = this.velocity.vy * 0.55 + instVy * 0.45;

    this.prevCentroid.x = this.centroid.x;
    this.prevCentroid.y = this.centroid.y;
    this.centroid.x = detection.centroid.x;
    this.centroid.y = detection.centroid.y;
    this.bbox = { ...detection.bbox };
    this.scale = detection.scale;

    // State machine transitions
    let wasReacquired = false;
    if (this.state === 'INIT') {
      this.state = 'TRACKED';
    } else if (this.state === 'COASTING') {
      this.state = 'REACQUIRED';
      wasReacquired = true;
    } else if (this.state === 'REACQUIRED') {
      this.state = 'TRACKED';
    }

    this.wasReacquired = wasReacquired;
    this.displacement = Math.hypot(detection.centroid.x - this.prevCentroid.x, detection.centroid.y - this.prevCentroid.y);
    this.missedFrames = 0;
    this.age++;
    this.totalTrackedFrames++;
    this.lastSeenMs = timestampMs;
    this.confidence = 0.95;

    // Attach raw face detection data
    this.face = {
      detectionIndex: detection.detectionIndex,
      landmarks: detection.landmarks,
      blendshapes: detection.blendshapes,
      transformationMatrix: detection.transformationMatrix
    };
  }

  /**
   * Coast track during temporary occlusion.
   * @param {number} dtSec
   * @param {number} timestampMs
   */
  coast(dtSec, timestampMs) {
    this.missedFrames++;
    this.age++;
    this.state = 'COASTING';

    const dt = Math.min(Math.max(dtSec, 0.001), 0.5);
    // Continue moving along velocity, but decay speed
    this.centroid.x += this.velocity.vx * dt;
    this.centroid.y += this.velocity.vy * dt;
    this.velocity.vx *= 0.85;
    this.velocity.vy *= 0.85;

    // Lower confidence proportionally to missed frames
    this.confidence = Math.max(0.2, 1.0 - (this.missedFrames * 0.05));
    this.face = null;
    this.pose = null;
    this.hands = [];
  }

  /**
   * Convenience tracking metadata summary for diagnostic & telemetry consumers.
   */
  get tracking() {
    return {
      centroid: { ...this.centroid },
      bbox: { ...this.bbox },
      scale: this.scale,
      velocity: { ...this.velocity },
      age: this.age,
      missedFrames: this.missedFrames,
      confidence: this.confidence
    };
  }
}

export class PersonTracker {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxMissedFrames=20]  — Coasting grace period (~600ms at 30 FPS).
   * @param {number} [options.maxGatingDistance=0.35] — Max normalized spatial matching distance.
   * @param {number} [options.maxPeople=4]
   */
  constructor(options = {}) {
    this.maxMissedFrames = options.maxMissedFrames ?? 20;
    this.maxGatingDistance = options.maxGatingDistance ?? 0.35;
    this.maxPeople = options.maxPeople ?? 4;

    this.tracks = new Map(); // trackId -> TrackedPerson
    this.nextTrackId = 1;
    this.lastTimestampMs = 0;
    this.totalTracksCreated = 0;

    // Rich diagnostic metrics
    this.lostFramesTotal = 0;
    this.reacquisitionsTotal = 0;
    this.trackIdSwitches = 0;
    this.averageJitter = 0;
    this.lastPrimaryTrackId = null;
    this.diagnostics = {};
  }

  /**
   * Updates maximum tracked capacity.
   * @param {number} num
   */
  setMaxPeople(num) {
    this.maxPeople = Math.max(1, parseInt(num, 10) || 4);
  }

  /**
   * Clears all tracks and resets TrackID counter.
   */
  reset() {
    this.tracks.clear();
    this.nextTrackId = 1;
    this.lastTimestampMs = 0;
    this.totalTracksCreated = 0;
    this.lostFramesTotal = 0;
    this.reacquisitionsTotal = 0;
    this.trackIdSwitches = 0;
    this.averageJitter = 0;
    this.lastPrimaryTrackId = null;
    this.diagnostics = {};
  }

  /**
   * Extracts spatial tracking features from raw face detections.
   * @private
   * @param {Object} faceResult
   * @returns {Array<Object>}
   */
  _extractFaceFeatures(faceResult) {
    if (!faceResult || !Array.isArray(faceResult.faces) || faceResult.faces.length === 0) {
      return [];
    }

    const count = faceResult.faces.length;
    const features = [];

    for (let i = 0; i < count; i++) {
      const landmarks = faceResult.faces[i];
      if (!landmarks || landmarks.length === 0) continue;

      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;

      // Sample key boundary landmarks for high-speed bounding box
      // (10=forehead, 152=chin, 234=right cheek, 454=left cheek, 1=nose)
      for (let j = 0; j < landmarks.length; j += 4) {
        const lm = landmarks[j];
        if (lm.x < minX) minX = lm.x;
        if (lm.x > maxX) maxX = lm.x;
        if (lm.y < minY) minY = lm.y;
        if (lm.y > maxY) maxY = lm.y;
      }

      const width = Math.max(0.01, maxX - minX);
      const height = Math.max(0.01, maxY - minY);
      const centroid = {
        x: (minX + maxX) * 0.5,
        y: (minY + maxY) * 0.5
      };
      const scale = Math.sqrt(width * height);

      features.push({
        detectionIndex: i,
        centroid,
        bbox: { x: minX, y: minY, width, height },
        scale,
        landmarks,
        blendshapes: faceResult.blendshapes?.[i] || [],
        transformationMatrix: faceResult.transformationMatrices?.[i] || []
      });
    }

    return features;
  }

  /**
   * Calculates spatial & velocity cost between a track and candidate face detection.
   * Includes crossing / ambiguity shield (Section 6).
   * @private
   */
  _computeMatchingCost(track, detection) {
    const pred = track.predictedCentroid;
    const det = detection.centroid;

    // Euclidean distance from predicted position
    const dist = Math.hypot(det.x - pred.x, det.y - pred.y);
    if (dist > this.maxGatingDistance) {
      return Infinity; // Gated out
    }

    // Bounding Box IoU
    const b1 = track.bbox;
    const b2 = detection.bbox;
    const interX1 = Math.max(b1.x, b2.x);
    const interY1 = Math.max(b1.y, b2.y);
    const interX2 = Math.min(b1.x + b1.width, b2.x + b2.width);
    const interY2 = Math.min(b1.y + b1.height, b2.y + b2.height);
    const interArea = Math.max(0, interX2 - interX1) * Math.max(0, interY2 - interY1);
    const unionArea = (b1.width * b1.height) + (b2.width * b2.height) - interArea;
    const iou = unionArea > 0 ? interArea / unionArea : 0;

    // Scale difference penalty
    const maxScale = Math.max(track.scale, detection.scale, 0.001);
    const scaleDiff = Math.abs(track.scale - detection.scale) / maxScale;

    let cost = (dist * 0.60) + ((1 - iou) * 0.25) + (scaleDiff * 0.15);

    // ── Ambiguity / Crossing Shield (Section 6) ──
    // Directional velocity momentum: reward candidate consistent with velocity direction
    const speed = Math.hypot(track.velocity.vx, track.velocity.vy);
    if (speed > 0.05) {
      const dirX = det.x - track.centroid.x;
      const dirY = det.y - track.centroid.y;
      const dispLen = Math.hypot(dirX, dirY);
      if (dispLen > 0.005) {
        const cosAngle = (track.velocity.vx * dirX + track.velocity.vy * dirY) / (speed * dispLen);
        if (cosAngle > 0.3) {
          cost -= 0.12 * cosAngle; // Momentum bonus (aligns with physical trajectory)
        } else if (cosAngle < -0.3) {
          cost += 0.20 * Math.abs(cosAngle); // Momentum penalty (reverses trajectory)
        }
      }
    }

    return Math.max(0, cost);
  }

  /**
   * Primary frame update method.
   *
   * @param {Object} faceResult — Normalized Phase 3 face results
   * @param {Object} bodyResult — Normalized Phase 4 pose and hand results
   * @param {number} timestampMs — Current frame timestamp in ms
   * @returns {{
   *   trackedPersons: Array<TrackedPerson>,
   *   activeCount: number,
   *   diagnostics: Object
   * }}
   */
  update(faceResult, bodyResult, timestampMs = performance.now()) {
    const dtSec = this.lastTimestampMs > 0 ? (timestampMs - this.lastTimestampMs) / 1000 : 0.033;
    this.lastTimestampMs = timestampMs;

    const faceDetections = this._extractFaceFeatures(faceResult);
    const activeTracks = Array.from(this.tracks.values()).filter(t => t.state !== 'TERMINATED');

    // Step 1: Predict positions for all existing tracks
    for (const track of activeTracks) {
      track.predict(dtSec);
    }

    // Step 2: Gated Cost Matrix & Greedy Global Assignment
    const matchedTrackIds = new Set();
    const matchedDetectionIndices = new Set();

    if (activeTracks.length > 0 && faceDetections.length > 0) {
      const costList = [];

      for (let t = 0; t < activeTracks.length; t++) {
        const track = activeTracks[t];
        for (let d = 0; d < faceDetections.length; d++) {
          const det = faceDetections[d];
          const cost = this._computeMatchingCost(track, det);
          if (cost < Infinity) {
            costList.push({ track, det, cost });
          }
        }
      }

      // Sort candidate pairs by ascending cost
      costList.sort((a, b) => a.cost - b.cost);

      for (const match of costList) {
        if (!matchedTrackIds.has(match.track.trackId) && !matchedDetectionIndices.has(match.det.detectionIndex)) {
          match.track.update(match.det, dtSec, timestampMs);
          if (match.track.wasReacquired) {
            this.reacquisitionsTotal++;
            match.track.wasReacquired = false;
          }
          const jitter = match.track.displacement || 0;
          this.averageJitter = this.averageJitter * 0.9 + jitter * 0.1;
          matchedTrackIds.add(match.track.trackId);
          matchedDetectionIndices.add(match.det.detectionIndex);
        }
      }
    }

    // Step 3: Handle unmatched existing tracks (Coasting vs Termination)
    for (const track of activeTracks) {
      if (!matchedTrackIds.has(track.trackId)) {
        this.lostFramesTotal++;
        if (track.missedFrames < this.maxMissedFrames) {
          track.coast(dtSec, timestampMs);
        } else {
          track.state = 'TERMINATED';
          this.tracks.delete(track.trackId);
        }
      }
    }

    // Step 4: Spawn new tracks for unmatched face detections (up to maxPeople capacity)
    for (const det of faceDetections) {
      if (!matchedDetectionIndices.has(det.detectionIndex)) {
        if (this.tracks.size < this.maxPeople) {
          const newId = this.nextTrackId++;
          const newTrack = new TrackedPerson(newId, det.centroid, det.bbox, det.scale, timestampMs);
          newTrack.face = {
            detectionIndex: det.detectionIndex,
            landmarks: det.landmarks,
            blendshapes: det.blendshapes,
            transformationMatrix: det.transformationMatrix
          };
          this.tracks.set(newId, newTrack);
          this.totalTracksCreated++;
        }
      }
    }

    // Step 5: Spatial Association of Poses (Section 11)
    this._associatePoses(bodyResult);

    // Step 6: Spatial Association of Hands (Section 12)
    this._associateHands(bodyResult);

    // Filter surviving active tracks for downstream consumers
    const survivingTracks = Array.from(this.tracks.values()).filter(t => t.state !== 'TERMINATED');
    const activeCount = survivingTracks.filter(t => t.state === 'TRACKED' || t.state === 'INIT' || t.state === 'REACQUIRED').length;

    // Track primary TrackID switches
    const primaryTrack = survivingTracks.find(t => t.state === 'TRACKED' || t.state === 'INIT' || t.state === 'REACQUIRED') || survivingTracks[0];
    const currentPrimaryId = primaryTrack ? primaryTrack.trackId : null;
    if (this.lastPrimaryTrackId !== null && currentPrimaryId !== null && currentPrimaryId !== this.lastPrimaryTrackId) {
      this.trackIdSwitches++;
    }
    this.lastPrimaryTrackId = currentPrimaryId;

    // Extract landmark counts and confidences for diagnostic telemetry
    const validFaceLandmarks = primaryTrack?.face?.landmarks?.length || (faceDetections[0]?.landmarks?.length || 0);
    const validPoseLandmarks = primaryTrack?.pose?.landmarks?.length || (bodyResult?.poses?.[0]?.landmarks?.length || 0);
    const detectedHandsCount = bodyResult?.handCount ?? (bodyResult?.hands?.length || 0);
    const faceConf = faceDetections.length > 0 ? 0.96 : (survivingTracks.some(t => t.state === 'COASTING') ? 0.45 : 0);
    const poseConf = bodyResult?.poseConfidence ?? (validPoseLandmarks > 0 ? 0.88 : 0);
    const handConf = bodyResult?.handConfidence ?? (detectedHandsCount > 0 ? 0.90 : 0);

    this.diagnostics = {
      totalTracksCreated: this.totalTracksCreated,
      activeTracks: activeCount,
      coastingTracks: survivingTracks.filter(t => t.state === 'COASTING').length,
      lostFramesTotal: this.lostFramesTotal,
      reacquisitionsTotal: this.reacquisitionsTotal,
      trackIdSwitches: this.trackIdSwitches,
      averageJitter: parseFloat(this.averageJitter.toFixed(4)),
      faceConfidence: parseFloat(faceConf.toFixed(2)),
      poseConfidence: parseFloat(poseConf.toFixed(2)),
      handConfidence: parseFloat(handConf.toFixed(2)),
      validFaceLandmarks,
      validPoseLandmarks,
      detectedHandsCount,
      timestampMs
    };

    return {
      trackedPersons: survivingTracks,
      activeCount,
      diagnostics: this.diagnostics
    };
  }

  /**
   * Spatially associates detected poses with active tracked persons.
   * Compares face centroid with pose nose (0) and shoulder midpoint (11, 12).
   * @private
   */
  _associatePoses(bodyResult) {
    if (!bodyResult || !Array.isArray(bodyResult.poses) || bodyResult.poses.length === 0) {
      return;
    }

    const availablePoses = [...bodyResult.poses];
    const tracksList = Array.from(this.tracks.values()).filter(t => t.state !== 'TERMINATED');

    for (const track of tracksList) {
      if (availablePoses.length === 0) break;

      let bestPoseIndex = -1;
      let minDistance = Infinity;

      for (let p = 0; p < availablePoses.length; p++) {
        const pose = availablePoses[p];
        const lm = pose.landmarks;
        if (!lm || lm.length < 13) continue;

        // Neck / Shoulder midpoint anchor
        const nose = lm[0];
        const lShoulder = lm[11];
        const rShoulder = lm[12];
        const anchorX = (nose.x * 0.4) + ((lShoulder.x + rShoulder.x) * 0.5 * 0.6);
        const anchorY = (nose.y * 0.4) + ((lShoulder.y + rShoulder.y) * 0.5 * 0.6);

        // Distance to track face centroid
        const dist = Math.hypot(anchorX - track.centroid.x, anchorY - track.centroid.y);

        // Spatial association gate (head must be within 0.35 of upper torso)
        if (dist < 0.35 && dist < minDistance) {
          minDistance = dist;
          bestPoseIndex = p;
        }
      }

      if (bestPoseIndex !== -1) {
        const matchedPose = availablePoses.splice(bestPoseIndex, 1)[0];
        track.pose = {
          detectionIndex: matchedPose.detectionIndex,
          landmarks: matchedPose.landmarks,
          worldLandmarks: matchedPose.worldLandmarks
        };
      } else if (track.state !== 'COASTING') {
        track.pose = null;
      }
    }
  }

  /**
   * Spatially associates detected hands with active tracked persons.
   * Associates up to 2 hands per tracked person.
   * Handles camera-perspective vs anatomical handedness matching and preserves cached hands on skipped cadence frames.
   * @private
   */
  _associateHands(bodyResult) {
    if (!bodyResult) return;

    // Check if hand inference was skipped on this frame by adaptive scheduling
    const isHandSkipped = bodyResult.isHandSkipped === true || bodyResult.hands === undefined;

    // When hand inference is skipped, preserve existing cached hands on tracks
    if (isHandSkipped) {
      return;
    }

    const availableHands = Array.isArray(bodyResult.hands) ? [...bodyResult.hands] : [];
    const activeTracks = Array.from(this.tracks.values()).filter(t => t.state !== 'TERMINATED');

    // If hand inference explicitly ran but returned 0 hands, clear hands
    if (availableHands.length === 0) {
      for (const track of activeTracks) {
        track.hands = [];
      }
      return;
    }

    // Reset hands for fresh re-association from the newly detected hands
    for (const track of activeTracks) {
      track.hands = [];
    }

    // Fast-path: Single tracked person receives all detected hands (up to 2)
    if (activeTracks.length === 1) {
      const soloTrack = activeTracks[0];
      for (const hand of availableHands) {
        if (soloTrack.hands.length >= 2) break;
        soloTrack.hands.push({
          detectionIndex: hand.detectionIndex,
          handedness: hand.handedness,
          landmarks: hand.landmarks,
          worldLandmarks: hand.worldLandmarks,
          wrist: hand.wrist,
          score: hand.score
        });
      }
      return;
    }

    // Multi-person spatial association
    for (const hand of availableHands) {
      if (!hand.wrist) continue;

      let bestTrack = null;
      let minDistance = Infinity;

      for (const track of activeTracks) {
        if (track.hands.length >= 2) continue;

        let minTrackDist = Infinity;

        // Compare against pose wrists (both left and right to prevent mirror/handedness mismatch)
        if (track.pose && track.pose.landmarks && track.pose.landmarks.length >= 17) {
          const poseLm = track.pose.landmarks;
          if (poseLm[15]) { // Left wrist
            const d = Math.hypot(hand.wrist.x - poseLm[15].x, hand.wrist.y - poseLm[15].y);
            if (d < minTrackDist) minTrackDist = d;
          }
          if (poseLm[16]) { // Right wrist
            const d = Math.hypot(hand.wrist.x - poseLm[16].x, hand.wrist.y - poseLm[16].y);
            if (d < minTrackDist) minTrackDist = d;
          }
          if (poseLm[11] && poseLm[12]) { // Mid-torso
            const tx = (poseLm[11].x + poseLm[12].x) * 0.5;
            const ty = (poseLm[11].y + poseLm[12].y) * 0.5 + 0.25;
            const d = Math.hypot(hand.wrist.x - tx, hand.wrist.y - ty);
            if (d < minTrackDist) minTrackDist = d;
          }
        }

        // Centroid fallback
        const headDist = Math.hypot(hand.wrist.x - track.centroid.x, hand.wrist.y - (track.centroid.y + 0.35));
        if (headDist < minTrackDist) minTrackDist = headDist;

        // Generous spatial gate (0.65) to support raised and extended arms
        if (minTrackDist < 0.65 && minTrackDist < minDistance) {
          minDistance = minTrackDist;
          bestTrack = track;
        }
      }

      if (bestTrack) {
        bestTrack.hands.push({
          detectionIndex: hand.detectionIndex,
          handedness: hand.handedness,
          landmarks: hand.landmarks,
          worldLandmarks: hand.worldLandmarks,
          wrist: hand.wrist,
          score: hand.score
        });
      }
    }
  }
}
