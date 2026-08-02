import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Official three.js "facecap" rig: a glTF face mesh with 52 ARKit-style
// morph targets, whose names match MediaPipe's blendshape categoryName
// values directly (browDownLeft, jawOpen, mouthSmileLeft, ...).
const FACE_RIG_URL = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/facecap.glb';

export class FaceRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
    this.camera.position.set(0, 0.02, 0.62);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 1.5;
    this.controls.target.set(0, 0.02, 0);

    this._setupLights();

    this.faceMesh = null;
    this.faceGroup = null;
    this.morphDict = {};
    this.smoothed = {};

    this._rfLast = performance.now();
    this._rfSmoothed = 0;
    this.onRenderFps = null;

    window.addEventListener('resize', () => this.resize());
  }

  _setupLights() {
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(0.6, 0.8, 1);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x4fd1c5, 0.6);
    fill.position.set(-0.8, 0.2, 0.4);
    this.scene.add(fill);

    this.scene.add(new THREE.AmbientLight(0x8899aa, 0.5));
  }

  resize() {
    const wrap = this.canvas.parentElement;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async loadRig() {
    const loader = new GLTFLoader();
    const ktx2Loader = new KTX2Loader()
      .setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/basis/')
      .detectSupport(this.renderer);
    loader.setKTX2Loader(ktx2Loader);

    return new Promise((resolve, reject) => {
      loader.load(FACE_RIG_URL, (gltf) => {
        const root = gltf.scene;
        root.traverse((obj) => {
          if (obj.isMesh && obj.morphTargetDictionary && obj.morphTargetInfluences) {
            this.faceMesh = obj;
          }
        });
        if (!this.faceMesh) { reject(new Error('No morph-target mesh found in rig.')); return; }

        this.morphDict = this.faceMesh.morphTargetDictionary;
        for (const name in this.morphDict) this.smoothed[name] = 0;

        this.faceMesh.material = new THREE.MeshStandardMaterial({
          color: 0xcdd6dd, roughness: 0.55, metalness: 0.05
        });

        this.faceGroup = new THREE.Group();
        this.faceGroup.add(root);

        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3(); box.getSize(size);
        const center = new THREE.Vector3(); box.getCenter(center);
        root.position.sub(center);
        const maxDim = Math.max(size.x, size.y, size.z);
        root.scale.setScalar(0.42 / maxDim);

        this.scene.add(this.faceGroup);
        resolve(Object.keys(this.morphDict).length);
      }, undefined, reject);
    });
  }

  /**
   * @param {Array<{categoryName:string, score:number}>} categories
   * @param {number} smoothingAlpha  0..1, higher = less smoothing (more responsive)
   */
  applyBlendshapes(categories, smoothingAlpha) {
    if (!this.faceMesh) return;
    for (const c of categories) {
      const idx = this.morphDict[c.categoryName];
      if (idx === undefined) continue;
      const prev = this.smoothed[c.categoryName] ?? 0;
      const next = prev + (c.score - prev) * Math.max(smoothingAlpha, 0.05);
      this.smoothed[c.categoryName] = next;
      this.faceMesh.morphTargetInfluences[idx] = next;
    }
  }

  /**
   * @param {Float32Array|number[]} matrixData  column-major 4x4 from MediaPipe
   * @param {boolean} enabled
   */
  applyHeadPose(matrixData, enabled) {
    if (!this.faceGroup) return;
    if (!enabled) { this.faceGroup.rotation.set(0, 0, 0); return; }
    const m = new THREE.Matrix4().fromArray(matrixData);
    const quat = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    m.decompose(pos, quat, scl);
    const euler = new THREE.Euler().setFromQuaternion(quat, 'YXZ');
    // Axis correction between MediaPipe's camera-space transform and the rig's forward axis.
    this.faceGroup.rotation.set(euler.x, Math.PI - euler.y, -euler.z);
  }

  /**
   * Directly set a single morph target influence by blendshape name (no smoothing).
   * Used by the manual slider viewer, as opposed to applyBlendshapes() which is
   * for noisy live camera data and needs temporal smoothing.
   */
  setInfluence(name, value) {
    if (!this.faceMesh) return;
    const idx = this.morphDict[name];
    if (idx === undefined) return;
    this.faceMesh.morphTargetInfluences[idx] = value;
    this.smoothed[name] = value;
  }

  /** Combine two symmetric (Left/Right) blendshapes into one influence, e.g. for a single "Smile" slider. */
  setInfluencePair(nameLeft, nameRight, value) {
    this.setInfluence(nameLeft, value);
    this.setInfluence(nameRight, value);
  }

  resetAllInfluences() {
    if (!this.faceMesh) return;
    for (const name in this.morphDict) {
      this.faceMesh.morphTargetInfluences[this.morphDict[name]] = 0;
      this.smoothed[name] = 0;
    }
  }

  /** Manual neck/head pitch control in degrees, independent of camera-driven head pose. */
  setNeckPitch(degrees) {
    if (!this.faceGroup) return;
    this.faceGroup.rotation.x = THREE.MathUtils.degToRad(degrees);
  }

  resetView() {
    this.camera.position.set(0, 0.02, 0.62);
    this.controls.target.set(0, 0.02, 0);
    this.controls.update();
  }

  startRenderLoop() {
    const tick = () => {
      requestAnimationFrame(tick);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this._trackFps();
    };
    tick();
  }

  _trackFps() {
    const now = performance.now();
    const dt = now - this._rfLast;
    this._rfLast = now;
    const inst = 1000 / dt;
    this._rfSmoothed = this._rfSmoothed ? this._rfSmoothed * 0.9 + inst * 0.1 : inst;
    if (this.onRenderFps) this.onRenderFps(this._rfSmoothed);
  }
}
