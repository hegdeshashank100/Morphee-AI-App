import { PoseLandmarker, HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

// Heavy = most accurate model (33 landmarks with highest precision 3D world coords)
const POSE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task';
const HAND_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class BodyTracker {
  constructor() {
    this.poseLandmarker = null;
    this.handLandmarker = null;
  }

  /**
   * @param {'GPU'|'CPU'} delegate  — GPU uses WebGL acceleration (CUDA on NVIDIA).
   */
  async init(delegate = 'GPU') {
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);

    this.poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.6,
      minPosePresenceConfidence: 0.6,
      minTrackingConfidence: 0.6
    });

    this.handLandmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6
    });
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {number} timestampMs
   * @returns {{ pose: PoseLandmarkerResult, hands: HandLandmarkerResult }}
   */
  detect(video, timestampMs) {
    const pose = this.poseLandmarker.detectForVideo(video, timestampMs);
    const hands = this.handLandmarker.detectForVideo(video, timestampMs);
    return { pose, hands };
  }
}
