import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// MediaPipe's WASM binaries and model asset are fetched from CDN at runtime.
// This is standard practice for tasks-vision (they are large binary assets,
// not bundled by npm) and works from any deployed origin — no server needed.
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export class LandmarkTracker {
  constructor() {
    this.landmarker = null;
  }

  /**
   * @param {'GPU'|'CPU'} delegate  — GPU uses WebGL acceleration (CUDA on NVIDIA).
   */
  async init(delegate = 'GPU') {
    const filesetResolver = await FilesetResolver.forVisionTasks(WASM_BASE);
    this.landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: delegate
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode: 'VIDEO',
      numFaces: 1
    });
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {number} timestampMs
   * @returns FaceLandmarkerResult
   */
  detect(video, timestampMs) {
    if (!this.landmarker) throw new Error('LandmarkTracker not initialized — call init() first.');
    return this.landmarker.detectForVideo(video, timestampMs);
  }
}
