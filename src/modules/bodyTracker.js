import { PoseLandmarker, HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { assetManager } from './core/assetManager.js';

export class BodyTracker {
  constructor() {
    this.poseLandmarker = null;
    this.handLandmarker = null;
    this.maxPeople = 4;
    this.delegate = 'GPU';
  }

  /**
   * @param {'GPU'|'CPU'} delegate — GPU uses WebGL acceleration (CUDA on NVIDIA).
   * @param {number} maxPeople — Maximum simultaneous people/poses to track (1, 2, 4, 6, 8).
   */
  async init(delegate = 'GPU', maxPeople = 4) {
    this.delegate = delegate;
    this.maxPeople = Math.max(1, parseInt(maxPeople, 10) || 4);
    const wasmPath = await assetManager.getWasmPath();
    const poseModelPath = await assetManager.getModelPath('pose');
    const handModelPath = await assetManager.getModelPath('hand');
    const fileset = await FilesetResolver.forVisionTasks(wasmPath);

    this.poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: poseModelPath, delegate: this.delegate },
      runningMode: 'VIDEO',
      numPoses: this.maxPeople,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    // Each person can have up to 2 hands
    const numHands = this.maxPeople * 2;
    this.handLandmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: handModelPath, delegate: this.delegate },
      runningMode: 'VIDEO',
      numHands: numHands,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
  }

  /**
   * Dynamically updates maxPeople capacity without reloading models.
   * @param {number} num — Target max people (1, 2, 4, 6, 8)
   */
  async setMaxPeople(num) {
    const parsed = Math.max(1, parseInt(num, 10) || 1);
    this.maxPeople = parsed;
    const numHands = parsed * 2;

    const promises = [];
    if (this.poseLandmarker && typeof this.poseLandmarker.setOptions === 'function') {
      promises.push(this.poseLandmarker.setOptions({ numPoses: parsed }));
    }
    if (this.handLandmarker && typeof this.handLandmarker.setOptions === 'function') {
      promises.push(this.handLandmarker.setOptions({ numHands: numHands }));
    }
    if (promises.length) {
      await Promise.all(promises);
    }
  }

  /**
   * Performs multi-person pose and hand inference on current video frame.
   *
   * ARCHITECTURAL NOTICE:
   * MediaPipe detection indices are frame-local result indices and MUST NOT be used as persistent person identity.
   * Pose and hand array indices (0, 1, ..., N-1) represent raw per-frame detection slots only.
   * MediaPipe may reorder detections between consecutive frames.
   * Persistent spatial/temporal identity tracking will be resolved downstream by PersonTracker in Phase 5.
   *
   * @param {HTMLVideoElement} video
   * @param {number} timestampMs
   * @returns {{
   *   poses: Array<{
   *     detectionIndex: number,
   *     landmarks: Array<{x: number, y: number, z: number, visibility?: number}>,
   *     worldLandmarks: Array<{x: number, y: number, z: number, visibility?: number}>
   *   }>,
   *   hands: Array<{
   *     detectionIndex: number,
   *     landmarks: Array<{x: number, y: number, z: number}>,
   *     worldLandmarks: Array<{x: number, y: number, z: number}>,
   *     handedness: 'Left' | 'Right' | 'Unknown',
   *     score: number,
   *     wrist: {x: number, y: number, z: number} | null
   *   }>,
   *   poseCount: number,
   *   handCount: number,
   *   pose: {
   *     landmarks: Array<Array<{x: number, y: number, z: number, visibility?: number}>>,
   *     worldLandmarks: Array<Array<{x: number, y: number, z: number, visibility?: number}>>
   *   },
   *   handsRaw: any
   * }}
   */
  detect(video, timestampMs, options = {}) {
    const runPose = options.runPose !== false;
    const runHands = options.runHands !== false;

    if (runPose && !this.poseLandmarker) {
      throw new Error('BodyTracker not initialized — call init() first.');
    }
    if (runHands && !this.handLandmarker) {
      throw new Error('BodyTracker not initialized — call init() first.');
    }

    const rawPose = (runPose && this.poseLandmarker) ? this.poseLandmarker.detectForVideo(video, timestampMs) : null;
    const rawHands = (runHands && this.handLandmarker) ? this.handLandmarker.detectForVideo(video, timestampMs) : null;

    // ── Safe Extraction of Poses ──
    const rawPoseLandmarks = (rawPose && Array.isArray(rawPose.landmarks)) ? rawPose.landmarks : [];
    const rawPoseWorldLandmarks = (rawPose && Array.isArray(rawPose.worldLandmarks)) ? rawPose.worldLandmarks : [];
    const poseCount = rawPoseLandmarks.length;

    const poses = new Array(poseCount);
    for (let i = 0; i < poseCount; i++) {
      poses[i] = {
        detectionIndex: i,
        landmarks: rawPoseLandmarks[i] || [],
        worldLandmarks: rawPoseWorldLandmarks[i] || []
      };
    }

    // ── Safe Extraction of Hands ──
    const rawHandLandmarks = (rawHands && Array.isArray(rawHands.landmarks)) ? rawHands.landmarks : [];
    const rawHandWorldLandmarks = (rawHands && Array.isArray(rawHands.worldLandmarks)) ? rawHands.worldLandmarks : [];
    const rawHandedness = (rawHands && (Array.isArray(rawHands.handedness) || Array.isArray(rawHands.handednesses)))
      ? (rawHands.handedness || rawHands.handednesses)
      : [];
    const handCount = rawHandLandmarks.length;

    const hands = new Array(handCount);
    for (let j = 0; j < handCount; j++) {
      const lm = rawHandLandmarks[j] || [];
      const worldLm = rawHandWorldLandmarks[j] || [];
      const handCat = (rawHandedness[j] && rawHandedness[j][0]) ? rawHandedness[j][0] : null;
      const handedness = handCat?.categoryName || 'Unknown';
      const score = typeof handCat?.score === 'number' ? handCat.score : 1.0;

      // Spatial metadata for Phase 5 association (Section 4)
      const wrist = lm.length > 0 ? { x: lm[0].x, y: lm[0].y, z: lm[0].z } : null;

      hands[j] = {
        detectionIndex: j,
        landmarks: lm,
        worldLandmarks: worldLm,
        handedness: handedness,
        score: score,
        wrist: wrist
      };
    }

    // ── Safe Backward-Compatibility Aliases ──
    // Enables existing single-person avatar animation in main.js & avatarInstance.js
    const legacyPose = {
      landmarks: rawPoseLandmarks,
      worldLandmarks: rawPoseWorldLandmarks
    };

    const legacyHands = rawHands || {
      landmarks: rawHandLandmarks,
      worldLandmarks: rawHandWorldLandmarks,
      handedness: rawHandedness,
      handednesses: rawHandedness
    };

    // Compute average confidence scores for diagnostic telemetry
    let poseConfidence = 0;
    if (poseCount > 0 && poses[0]?.landmarks?.length) {
      let visSum = 0, visCnt = 0;
      for (const lm of poses[0].landmarks) {
        if (typeof lm.visibility === 'number') {
          visSum += lm.visibility;
          visCnt++;
        }
      }
      poseConfidence = visCnt > 0 ? (visSum / visCnt) : 0.85;
    }

    let handConfidence = 0;
    if (handCount > 0) {
      let scoreSum = 0;
      for (const h of hands) scoreSum += (h.score || 0.8);
      handConfidence = scoreSum / handCount;
    }

    return {
      poses,
      hands,
      poseCount,
      handCount,
      poseConfidence,
      handConfidence,
      // Compatibility aliases:
      pose: legacyPose,
      handsRaw: legacyHands
    };
  }
}
