import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { assetManager } from './core/assetManager.js';

export class LandmarkTracker {
  constructor() {
    this.landmarker = null;
    this.maxFaces = 4;
    this.delegate = 'GPU';
  }

  /**
   * @param {'GPU'|'CPU'} delegate — GPU uses WebGL acceleration (CUDA on NVIDIA).
   * @param {number} maxFaces — Maximum simultaneous faces to detect (e.g. 1, 2, 4, 6, 8).
   */
  async init(delegate = 'GPU', maxFaces = 4) {
    this.delegate = delegate;
    this.maxFaces = Math.max(1, parseInt(maxFaces, 10) || 4);
    const wasmPath = await assetManager.getWasmPath();
    const modelAssetPath = await assetManager.getModelPath('face');
    const filesetResolver = await FilesetResolver.forVisionTasks(wasmPath);
    this.landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath,
        delegate: this.delegate
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode: 'VIDEO',
      numFaces: this.maxFaces
    });
  }

  /**
   * Dynamically updates the maximum number of detectable faces without full reinitialization.
   * @param {number} num — Target max faces (1, 2, 4, 6, 8, etc.)
   */
  async setMaxFaces(num) {
    const parsed = Math.max(1, parseInt(num, 10) || 1);
    this.maxFaces = parsed;
    if (this.landmarker && typeof this.landmarker.setOptions === 'function') {
      await this.landmarker.setOptions({ numFaces: parsed });
    }
  }

  /**
   * Executes inference on the current video frame.
   *
   * RESULT CONTRACT:
   * Returns clearly associated parallel arrays:
   *   result.faces[i]                    -> 478 3D normalized landmark points for detection i
   *   result.blendshapes[i]              -> ARKit blendshape category objects for detection i
   *   result.transformationMatrices[i]   -> 4x4 facial transformation matrix data (Float32Array/Array) for detection i
   *
   * IMPORTANT: Array indices (i) are ONLY per-frame detection result indices.
   * MediaPipe may reorder detections between frames. They are NOT persistent identities (TrackIDs).
   * Persistent spatial/temporal identity tracking will be resolved downstream by PersonTracker in Phase 5.
   *
   * @param {HTMLVideoElement} video
   * @param {number} timestampMs
   * @returns {{
   *   faces: Array<Array<{x: number, y: number, z: number}>>,
   *   blendshapes: Array<Array<{categoryName: string, score: number}>>,
   *   transformationMatrices: Array<Float32Array|Array<number>>,
   *   count: number,
   *   faceLandmarks: Array<Array<{x: number, y: number, z: number}>>,
   *   faceBlendshapes: Array<any>,
   *   facialTransformationMatrixes: Array<any>
   * }}
   */
  detect(video, timestampMs) {
    if (!this.landmarker) throw new Error('LandmarkTracker not initialized — call init() first.');
    const raw = this.landmarker.detectForVideo(video, timestampMs);

    const rawFaces = (raw && Array.isArray(raw.faceLandmarks)) ? raw.faceLandmarks : [];
    const rawBlendshapes = (raw && Array.isArray(raw.faceBlendshapes)) ? raw.faceBlendshapes : [];
    const rawMatrices = (raw && Array.isArray(raw.facialTransformationMatrixes)) ? raw.facialTransformationMatrixes : [];
    const count = rawFaces.length;

    // Fast zero-allocation return on empty / no face detected
    if (count === 0) {
      return {
        faces: [],
        blendshapes: [],
        transformationMatrices: [],
        count: 0,
        faceLandmarks: [],
        faceBlendshapes: [],
        facialTransformationMatrixes: []
      };
    }

    // Parallel array extraction with robust null/partial safety guards
    const faces = new Array(count);
    const blendshapes = new Array(count);
    const transformationMatrices = new Array(count);

    for (let i = 0; i < count; i++) {
      faces[i] = rawFaces[i] || [];

      const bs = rawBlendshapes[i];
      blendshapes[i] = (bs && Array.isArray(bs.categories)) ? bs.categories : [];

      const mat = rawMatrices[i];
      transformationMatrices[i] = (mat && (mat.data || Array.isArray(mat))) ? (mat.data || mat) : [];
    }

    return {
      faces,
      blendshapes,
      transformationMatrices,
      count,
      // Backward-compatible properties matching raw MediaPipe result
      faceLandmarks: rawFaces,
      faceBlendshapes: rawBlendshapes,
      facialTransformationMatrixes: rawMatrices
    };
  }
}
