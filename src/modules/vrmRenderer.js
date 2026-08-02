import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// Default CC0 sample avatar — can be overridden by passing a URL to loadRig().
const DEFAULT_VRM_URL = 'https://raw.githubusercontent.com/josephrocca/ChatVRM-js/main/avatars/AvatarSample_B.vrm';

// ═══════════════════════════════════════════════════════════════════════════
// EXPRESSION MAPPING   (ARKit/MediaPipe blendshapes → VRM expression presets)
// ═══════════════════════════════════════════════════════════════════════════
//
// KEY INSIGHT — VRM expression presets (happy, sad, angry, surprised) are
// artist-authored animations that affect MULTIPLE parts of the face at once.
// The "happy" preset typically includes eye squinting + mouth corners up +
// cheek raise.  If we ALSO set blinkLeft/blinkRight, the squint from "happy"
// and the blink COMPOUND, slamming the eyes shut.
//
// SOLUTION:
//   1.  Cap emotion presets so their built-in eye effects stay subtle.
//   2.  Suppress blink when significant mouth/emotion activity is present.
//   3.  Use per-channel temporal smoothing to eliminate flickering.
//   4.  Map eye-gaze blendshapes (lookUp/Down/Left/Right) for responsive eyes.
//
function applyArkitToVrmExpressions(vrm, categories, alpha, state) {
  const score = (name) => categories.find((c) => c.categoryName === name)?.score ?? 0;

  // ── Raw scores from MediaPipe ─────────────────────────────────────────
  const jawOpen    = score('jawOpen');
  const smileRaw   = (score('mouthSmileLeft') + score('mouthSmileRight')) / 2;
  const frownRaw   = (score('mouthFrownLeft') + score('mouthFrownRight')) / 2;
  const browDownRaw = (score('browDownLeft') + score('browDownRight')) / 2;
  const browUpRaw   = score('browInnerUp');
  const eyeWideRaw  = (score('eyeWideLeft') + score('eyeWideRight')) / 2;
  const pucker     = score('mouthPucker');
  const funnel     = score('mouthFunnel');
  const stretch    = (score('mouthStretchLeft') + score('mouthStretchRight')) / 2;
  const rawBlinkL  = score('eyeBlinkLeft');
  const rawBlinkR  = score('eyeBlinkRight');

  // ── Eye gaze ──────────────────────────────────────────────────────────
  const lookUpL    = score('eyeLookUpLeft');
  const lookUpR    = score('eyeLookUpRight');
  const lookDownL  = score('eyeLookDownLeft');
  const lookDownR  = score('eyeLookDownRight');
  const lookInL    = score('eyeLookInLeft');
  const lookInR    = score('eyeLookInRight');
  const lookOutL   = score('eyeLookOutLeft');
  const lookOutR   = score('eyeLookOutRight');

  // VRM uses lookLeft/lookRight/lookUp/lookDown (both eyes combined).
  // MediaPipe "In" = towards nose; for left eye that's looking RIGHT, for right eye that's looking LEFT.
  const gazeRight = ((lookInL + lookOutR) / 2);
  const gazeLeft  = ((lookOutL + lookInR) / 2);
  const gazeUp    = ((lookUpL + lookUpR) / 2);
  const gazeDown  = ((lookDownL + lookDownR) / 2);

  // ── Emotion expressions — CAPPED to prevent eye-squint domination ─────
  const EMOTION_CAP = 0.35;
  const happy     = Math.min(THREE.MathUtils.clamp(smileRaw * 1.4, 0, 1), EMOTION_CAP);
  const sad       = Math.min(THREE.MathUtils.clamp(frownRaw * 1.4, 0, 1), EMOTION_CAP);
  const angry     = Math.min(THREE.MathUtils.clamp(browDownRaw * 1.4, 0, 1), EMOTION_CAP);
  const surprised = Math.min(Math.max(browUpRaw, eyeWideRaw) * 1.3, EMOTION_CAP);

  // ── Blink — suppress only during strong smile (which causes false blinks) ─
  // Relaxed threshold so normal talking doesn't kill blinks.
  const smileActivity = smileRaw;
  let blinkL = rawBlinkL;
  let blinkR = rawBlinkR;
  if (smileActivity > 0.3) {
    // During smiling, MediaPipe's blink confidence is unreliable (cheek push)
    // Scale down blink proportionally to smile intensity
    const suppress = THREE.MathUtils.clamp((smileActivity - 0.3) / 0.4, 0, 1);
    blinkL *= (1 - suppress);
    blinkR *= (1 - suppress);
  }
  // Only register blinks above a confidence floor
  blinkL = blinkL > 0.4 ? THREE.MathUtils.clamp((blinkL - 0.3) * 2, 0, 1) : 0;
  blinkR = blinkR > 0.4 ? THREE.MathUtils.clamp((blinkR - 0.3) * 2, 0, 1) : 0;

  // ── Target map ────────────────────────────────────────────────────────
  const target = {
    happy,
    sad,
    angry,
    surprised,
    aa:         jawOpen,
    ih:         stretch,
    ou:         pucker,
    oh:         funnel,
    blinkLeft:  blinkL,
    blinkRight: blinkR,
    lookUp:     gazeUp,
    lookDown:   gazeDown,
    lookLeft:   gazeLeft,
    lookRight:  gazeRight
  };

  // ── Temporal smoothing (exponential moving average) ───────────────────
  const em = vrm.expressionManager;
  if (!em) return;

  const BLINK_KEYS = new Set(['blinkLeft', 'blinkRight']);
  const MOUTH_KEYS = new Set(['aa', 'ih', 'ou', 'oh']);
  const GAZE_KEYS  = new Set(['lookUp', 'lookDown', 'lookLeft', 'lookRight']);

  for (const name in target) {
    // Per-channel alpha:  blinks/gaze are snappy, mouth is responsive, emotions are smooth
    let a;
    if (BLINK_KEYS.has(name))       a = 0.7;
    else if (GAZE_KEYS.has(name))   a = 0.6;  // Eyes need to feel alive and responsive
    else if (MOUTH_KEYS.has(name))  a = Math.max(alpha, 0.45);
    else                            a = Math.max(alpha * 0.5, 0.12);

    // Dead-zone: squash noise floor
    let val = target[name];
    if (val < 0.05) val = 0;

    const prev = state[name] ?? 0;
    const next = prev + (val - prev) * a;
    state[name] = next;
    em.setValue(name, next);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POSE CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════
const POSE_IDX = {
  leftShoulder: 11,  rightShoulder: 12,
  leftElbow: 13,     rightElbow: 14,
  leftWrist: 15,     rightWrist: 16,
  leftHip: 23,       rightHip: 24
};

// VRM normalized T-pose rest directions
const ARM_REST_DIR = {
  leftUpperArm:  new THREE.Vector3( 1, 0, 0),
  rightUpperArm: new THREE.Vector3(-1, 0, 0)
};

// ═══════════════════════════════════════════════════════════════════════════
// FINGER CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════
const FINGER_LANDMARKS = {
  thumb:  [1, 2, 3, 4],
  index:  [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring:   [13, 14, 15, 16],
  little: [17, 18, 19, 20]
};
const FINGER_BONE_NAMES = {
  thumb:  ['ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal'],
  index:  ['IndexProximal', 'IndexIntermediate', 'IndexDistal'],
  middle: ['MiddleProximal', 'MiddleIntermediate', 'MiddleDistal'],
  ring:   ['RingProximal', 'RingIntermediate', 'RingDistal'],
  little: ['LittleProximal', 'LittleIntermediate', 'LittleDistal']
};

// ═══════════════════════════════════════════════════════════════════════════
// COORDINATE HELPERS
// ═══════════════════════════════════════════════════════════════════════════
/** Convert a MediaPipe Pose WORLD landmark to Three.js space. */
function poseToThree(lm) {
  return new THREE.Vector3(lm.x, lm.y, -lm.z * 0.3);
}

// ═══════════════════════════════════════════════════════════════════════════
// VRM RENDERER
// ═══════════════════════════════════════════════════════════════════════════
export class VrmRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
    this.defaultCamPos = new THREE.Vector3(0, 1.35, 0.9);
    this.defaultCamTarget = new THREE.Vector3(0, 1.32, 0);
    this.camera.position.copy(this.defaultCamPos);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 3;
    this.controls.target.copy(this.defaultCamTarget);

    this._setupLights();

    this.vrm = null;
    this.headBone = null;
    this.expressionState = {};
    this._armQuatState = {};
    this._fingerCurlState = {};
    this._wristQuatState = {};

    this._clock = new THREE.Clock();
    this._rfLast = performance.now();
    this._rfSmoothed = 0;
    this.onRenderFps = null;

    window.addEventListener('resize', () => this.resize());
  }

  _setupLights() {
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.6, 1.6, 1);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x9fd8ff, 0.5);
    fill.position.set(-0.8, 1.2, 0.4);
    this.scene.add(fill);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  }

  resize() {
    const wrap = this.canvas.parentElement;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async loadRig(url) {
    const modelUrl = url || DEFAULT_VRM_URL;

    // Remove previous model if switching avatars
    if (this.vrm) {
      this.scene.remove(this.vrm.scene);
      this.vrm = null;
      this.headBone = null;
      this.expressionState = {};
      this._armQuatState = {};
      this._fingerCurlState = {};
      this._wristQuatState = {};
    }

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    return new Promise((resolve, reject) => {
      loader.load(modelUrl, (gltf) => {
        const vrm = gltf.userData.vrm;
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.removeUnnecessaryJoints(gltf.scene);
        VRMUtils.rotateVRM0(vrm);

        this.vrm = vrm;
        this.scene.add(vrm.scene);
        this.headBone = vrm.humanoid?.getNormalizedBoneNode('head') ?? null;

        const expressionNames = vrm.expressionManager
          ? Object.keys(vrm.expressionManager.expressionMap ?? {})
          : [];
        resolve(expressionNames.length || 8);
      }, undefined, reject);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FACE EXPRESSIONS
  // ─────────────────────────────────────────────────────────────────────────
  applyBlendshapes(categories, smoothingAlpha) {
    if (!this.vrm) return;
    applyArkitToVrmExpressions(this.vrm, categories, smoothingAlpha, this.expressionState);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HEAD POSE
  // ─────────────────────────────────────────────────────────────────────────
  applyHeadPose(matrixData, enabled) {
    if (!this.headBone) return;
    if (!enabled) { this.headBone.rotation.set(0, 0, 0); return; }

    const m = new THREE.Matrix4().fromArray(matrixData);
    const quat = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    m.decompose(pos, quat, scl);
    const euler = new THREE.Euler().setFromQuaternion(quat, 'YXZ');

    // Negate all axes: pitch for correct up/down, yaw+roll for mirror
    this.headBone.rotation.set(-euler.x, -euler.y, -euler.z);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BODY / ARMS  (Pose worldLandmarks)
  // ─────────────────────────────────────────────────────────────────────────
  applyPose(worldLandmarks, alpha = 0.3) {
    if (!this.vrm?.humanoid || !worldLandmarks) return;

    // Smooth quaternion interpolation with small deadzone
    const dampQuat = (bone, targetQ, baseAlpha) => {
      const angle = bone.quaternion.angleTo(targetQ);
      if (angle < 0.015) return;  // Tiny deadzone — only ignore truly static noise
      const a = angle < 0.06 ? baseAlpha * 0.3 : baseAlpha;  // Gentle damping for small movements
      bone.quaternion.slerp(targetQ, a);
    };

    // ── Arms ─────────────────────────────────────────────────────────────
    for (const side of ['left', 'right']) {
      const pShoulder = worldLandmarks[POSE_IDX[`${side}Shoulder`]];
      const pElbow    = worldLandmarks[POSE_IDX[`${side}Elbow`]];
      const pWrist    = worldLandmarks[POSE_IDX[`${side}Wrist`]];

      const upperBone = this.vrm.humanoid.getNormalizedBoneNode(`${side}UpperArm`);
      const lowerBone = this.vrm.humanoid.getNormalizedBoneNode(`${side}LowerArm`);
      const restDir   = ARM_REST_DIR[`${side}UpperArm`];

      // If the arm is completely out of camera frame, gracefully relax to sides
      if (!pWrist || !pElbow || (pWrist.visibility ?? 1) < 0.1 || (pElbow.visibility ?? 1) < 0.1) {
        if (upperBone) {
          const downDir = new THREE.Vector3(restDir.x * 0.15, 0.98, 0).normalize();
          const dropQ = new THREE.Quaternion().setFromUnitVectors(restDir, downDir);
          dampQuat(upperBone, dropQ, alpha * 0.3);
        }
        if (lowerBone) {
          dampQuat(lowerBone, new THREE.Quaternion(), alpha * 0.3);
        }
        continue;
      }

      const shoulder = poseToThree(pShoulder);
      const elbow    = poseToThree(pElbow);
      const wrist    = poseToThree(pWrist);

      const upperDir = elbow.clone().sub(shoulder).normalize();
      const lowerDir = wrist.clone().sub(elbow).normalize();
      if (upperDir.lengthSq() === 0 || lowerDir.lengthSq() === 0) continue;

      // Upper arm
      if (upperBone) {
        const tgt = new THREE.Quaternion().setFromUnitVectors(restDir, upperDir);
        dampQuat(upperBone, tgt, alpha);
      }

      // Lower arm (elbow hinge)
      if (lowerBone && upperBone) {
        const inv = upperBone.quaternion.clone().invert();
        const local = lowerDir.clone().applyQuaternion(inv).normalize();
        const bend = THREE.MathUtils.clamp(restDir.angleTo(local), 0, THREE.MathUtils.degToRad(150));
        const axis = new THREE.Vector3().crossVectors(restDir, local);
        if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0);
        axis.normalize();
        const tgt = new THREE.Quaternion().setFromAxisAngle(axis, bend);
        dampQuat(lowerBone, tgt, alpha);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HANDS + FINGERS
  // ─────────────────────────────────────────────────────────────────────────
  applyHands(handsResult, poseImageLandmarks, poseWorldLandmarks, alpha = 0.4) {
    if (!this.vrm?.humanoid || !handsResult?.landmarks) return;

    for (let h = 0; h < handsResult.landmarks.length; h++) {
      const lm = handsResult.landmarks[h];
      const worldLm = handsResult.worldLandmarks?.[h];

      // ── Determine which side ──
      let side = handsResult.handednesses?.[h]?.[0]?.categoryName?.toLowerCase();

      // MediaPipe HandLandmarker ASSUMES the input image is mirrored.
      // Since we feed raw (non-mirrored) webcam, the label is SWAPPED.
      // "Left" from MediaPipe = actually the user's RIGHT hand.
      if (!poseImageLandmarks) {
        side = (side === 'left') ? 'right' : 'left';
      } else {
        // Pose-wrist proximity is more robust (works regardless of mirror convention)
        const w = lm[0];
        const dL = Math.hypot(w.x - poseImageLandmarks[15].x, w.y - poseImageLandmarks[15].y);
        const dR = Math.hypot(w.x - poseImageLandmarks[16].x, w.y - poseImageLandmarks[16].y);
        side = dL < dR ? 'left' : 'right';
      }
      if (!side) continue;

      // ── Wrist rotation ──
      // Simple, stable approach: compute a single twist quaternion from 
      // the forearm direction to the hand's forward direction.
      const handBone = this.vrm.humanoid.getNormalizedBoneNode(`${side}Hand`);

      if (handBone && worldLm && poseWorldLandmarks) {
        const handToThree = (pt) => new THREE.Vector3(pt.x, pt.y, -pt.z);

        const wWrist = handToThree(worldLm[0]);
        const wMcp   = handToThree(worldLm[9]);
        const handFwd = wMcp.clone().sub(wWrist).normalize();

        // Get forearm direction from pose landmarks
        const pElbow = poseToThree(poseWorldLandmarks[POSE_IDX[`${side}Elbow`]]);
        const pWrist = poseToThree(poseWorldLandmarks[POSE_IDX[`${side}Wrist`]]);
        const forearmDir = pWrist.clone().sub(pElbow).normalize();

        if (forearmDir.lengthSq() > 0 && handFwd.lengthSq() > 0) {
          // The wrist twist is the rotation FROM forearm TO hand direction
          const twistQ = new THREE.Quaternion().setFromUnitVectors(forearmDir, handFwd);

          // Clamp to reasonable wrist range (~90 degrees max)
          const twistAngle = 2 * Math.acos(Math.abs(THREE.MathUtils.clamp(twistQ.w, -1, 1)));
          const maxWrist = THREE.MathUtils.degToRad(90);

          let targetQ = twistQ;
          if (twistAngle > maxWrist) {
            targetQ = new THREE.Quaternion().slerp(twistQ, maxWrist / twistAngle);
          }

          // Smooth the wrist
          const diff = handBone.quaternion.angleTo(targetQ);
          if (diff > 0.03) {
            const a = diff < 0.1 ? alpha * 0.25 : alpha * 0.7;
            handBone.quaternion.slerp(targetQ, a);
          }
        }
      }

      // ── Per-joint finger curl ──
      for (const finger in FINGER_LANDMARKS) {
        const [i0, i1, i2, i3] = FINGER_LANDMARKS[finger];

        // Use world landmarks if available (true 3D metric), fallback to image landmarks
        const useWorld = !!worldLm;
        const v = (idx) => useWorld 
          ? new THREE.Vector3(worldLm[idx].x, worldLm[idx].y, worldLm[idx].z)
          : new THREE.Vector3(lm[idx].x, -lm[idx].y, -(lm[idx].z || 0));

        const seg0 = v(i1).sub(v(i0)).normalize(); // base → mid
        const seg1 = v(i2).sub(v(i1)).normalize(); // mid → dip
        const seg2 = v(i3).sub(v(i2)).normalize(); // dip → tip

        // Angle at each joint (0 = straight)
        const a01 = Math.acos(THREE.MathUtils.clamp(seg0.dot(seg1), -1, 1));
        const a12 = Math.acos(THREE.MathUtils.clamp(seg1.dot(seg2), -1, 1));

        // Normalise to 0..1 curl (90° = fully curled fist)
        const maxBend = Math.PI * 0.5;
        const c0 = THREE.MathUtils.clamp(a01 / maxBend, 0, 1);
        const c1 = THREE.MathUtils.clamp(a12 / maxBend, 0, 1);

        // Dead zone — prevent twitching when hand is flat/open
        const dz = (x) => x < 0.12 ? 0 : x;
        const jointCurls = [dz(c0), dz(c1), dz(c1 * 0.7)];

        const bones = FINGER_BONE_NAMES[finger];
        const maxRot = THREE.MathUtils.degToRad(75);

        for (let j = 0; j < bones.length; j++) {
          const bone = this.vrm.humanoid.getNormalizedBoneNode(`${side}${bones[j]}`);
          if (!bone) continue;

          const key  = `${side}_${finger}_${j}`;
          const prev = this._fingerCurlState[key] ?? 0;
          
          // Responsive smoothing — fast enough to feel real, smooth enough to avoid jitter
          const diff = Math.abs(jointCurls[j] - prev);
          const a = diff < 0.05 ? alpha * 0.1 : alpha * 0.5;
          
          const curl = prev + (jointCurls[j] - prev) * a;
          this._fingerCurlState[key] = curl;

          if (finger === 'thumb') {
             // Thumbs fold inwards across the palm
             const sign = side === 'left' ? 1 : -1;
             bone.rotation.set(0, curl * maxRot * sign, curl * maxRot * sign);
          } else {
             // VRM normalized finger bones: Left hand curls with +Z, Right hand with -Z
             bone.rotation.set(0, 0, curl * (side === 'left' ? maxRot : -maxRot));
          }
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UTILITY
  // ─────────────────────────────────────────────────────────────────────────
  setInfluence(name, value) {
    if (!this.vrm?.expressionManager) return;
    this.vrm.expressionManager.setValue(name, value);
    this.expressionState[name] = value;
  }

  setInfluencePair(nameLeft, nameRight, value) {
    this.setInfluence(nameLeft, value);
    this.setInfluence(nameRight, value);
  }

  resetAllInfluences() {
    if (!this.vrm?.expressionManager) return;
    const map = this.vrm.expressionManager.expressionMap ?? {};
    for (const name in map) this.vrm.expressionManager.setValue(name, 0);
    this.expressionState = {};
  }

  setNeckPitch(degrees) {
    if (!this.headBone) return;
    this.headBone.rotation.x = THREE.MathUtils.degToRad(degrees);
  }

  resetView() {
    this.camera.position.copy(this.defaultCamPos);
    this.controls.target.copy(this.defaultCamTarget);
    this.controls.update();
  }

  startRenderLoop() {
    const tick = () => {
      requestAnimationFrame(tick);
      const delta = this._clock.getDelta();
      this.controls.update();
      if (this.vrm) this.vrm.update(delta);
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
