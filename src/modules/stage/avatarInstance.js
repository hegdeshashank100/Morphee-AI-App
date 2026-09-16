/**
 * avatarInstance.js — Self-contained VRM Avatar Controller & Kinematics Engine.
 *
 * CRITICAL ARCHITECTURAL ROLE:
 * Encapsulates an individual 3D VRM model instance, humanoid skeleton references,
 * isolated expression states, isolated EMA smoothing filters, and kinematics solvers.
 *
 * GUARANTEES:
 * 1. Zero state contamination between Avatar Instances (Avatar A will never overwrite Avatar B).
 * 2. Zero per-frame memory allocations inside the render loop (uses scratchPool.js).
 * 3. Exact preservation of baseline mathematical heuristics:
 *    - Proportional blink suppression during smiling (prevents squint-lock).
 *    - Per-channel EMA smoothing (blinks, gaze, mouth, emotions).
 *    - 'YXZ' Euler mirror-corrected head pose.
 *    - Arm unit-vector IK kinematics with angular deadzones and out-of-frame relaxation.
 *    - Dual-hand mirror correction and dot-product finger curls.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import {
  scratchShoulder, scratchElbow, scratchWrist,
  scratchUpperDir, scratchLowerDir, scratchLocalDir, scratchAxis, scratchDownDir,
  scratchHandWrist, scratchHandMcp, scratchHandFwd, scratchForearmDir,
  scratchJointV0, scratchJointV1, scratchJointV2, scratchJointV3,
  scratchSeg0, scratchSeg1, scratchSeg2,
  scratchQuatA, scratchQuatB, scratchQuatUpperInv, scratchQuatTwist, scratchQuatTarget, scratchQuatDrop,
  scratchEuler, scratchMatrix, scratchDecompPos, scratchDecompScale
} from './scratchPool.js';
import { disposeVRM } from './vramDisposer.js';
import { validateAvatarRig } from './avatarRigValidator.js';

// ── Pose Landmark Indices (MediaPipe Pose) ──
const POSE_IDX = {
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13,    rightElbow: 14,
  leftWrist: 15,    rightWrist: 16,
  leftHip: 23,      rightHip: 24
};

// ── VRM Normalized T-Pose Rest Directions ──
const ARM_REST_DIR = {
  leftUpperArm:  new THREE.Vector3( 1, 0, 0),
  rightUpperArm: new THREE.Vector3(-1, 0, 0)
};

// ── Finger Landmark Indices & Bone Names ──
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

/** Convert a MediaPipe Pose WORLD landmark to Three.js space into a destination vector (zero allocation) */
function poseToScratch(lm, outVec) {
  // MediaPipe Pose: +X is right, +Y is DOWN (head ~0.35, hips ~0.70), +Z is towards camera.
  // Three.js humanoid space: +X is right, +Y is UP, +Z is towards camera.
  // Invert Y (-lm.y) so that raising physical arms moves avatar arms UP.
  outVec.set(lm.x, -lm.y, -lm.z * 0.3);
  return outVec;
}

export class AvatarInstance {
  /**
   * @param {string} id - Unique identifier (e.g. 'avatar_b', or assigned track ID)
   * @param {string} [name='Avatar']
   */
  constructor(id, name = 'Avatar') {
    this.id = id;
    this.name = name;
    this.url = null;

    // 3D Model references
    this.vrm = null;
    this.headBone = null;
    this.isLoaded = false;
    this.rigAudit = null;

    // Fully isolated per-avatar state (guarantees multi-avatar independence)
    this.expressionState = {};
    this._armQuatState = {};
    this._fingerCurlState = {};
    this._wristQuatState = {};
    this._lastHandSeen = { left: 0, right: 0 };

    // Lateral stage placement coordinates
    this.stagePosition = new THREE.Vector3(0, 0, 0);
  }

  get visible() {
    return this.vrm?.scene?.visible ?? false;
  }

  set visible(val) {
    if (this.vrm?.scene) {
      this.vrm.scene.visible = val;
    }
  }

  /**
   * Loads a VRM avatar from URL and prepares its humanoid skeleton and expressions.
   * @param {string} url 
   * @param {function} [onProgress]
   * @returns {Promise<number>} Number of ready expressions
   */
  async load(url, onProgress = undefined) {
    // If an existing VRM was already loaded into this instance, dispose it first
    if (this.vrm) {
      this.dispose();
    }

    this.url = url;
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          try {
            const vrm = gltf.userData.vrm;
            if (!vrm) {
              reject(new Error('GLTF userData does not contain valid VRM specification.'));
              return;
            }

            // Optimize geometry & joint structures for performance
            VRMUtils.removeUnnecessaryVertices(gltf.scene);
            VRMUtils.removeUnnecessaryJoints(gltf.scene);
            VRMUtils.rotateVRM0(vrm);

            this.vrm = vrm;
            this.headBone = vrm.humanoid?.getNormalizedBoneNode('head') ?? null;
            this.isLoaded = true;

            // Audit humanoid bone rig and retargeting capabilities at load/activation time
            this.rigAudit = validateAvatarRig(vrm, this.id);
            if (this.rigAudit.warnings.length > 0) {
              console.info(`[AvatarInstance] Rig audit for '${this.id}':`, this.rigAudit.warnings.join('; '));
            }

            // Reset all isolated state caches
            this.expressionState = {};
            this._armQuatState = {};
            this._fingerCurlState = {};
            this._wristQuatState = {};
            this._lastHandSeen = { left: 0, right: 0 };

            // Synchronize stage position
            this.vrm.scene.position.copy(this.stagePosition);

            const expressionNames = vrm.expressionManager
              ? Object.keys(vrm.expressionManager.expressionMap ?? {})
              : [];

            resolve(expressionNames.length || 8);
          } catch (err) {
            reject(err);
          }
        },
        onProgress,
        reject
      );
    });
  }

  /**
   * Set stage position for spatial multi-avatar layout.
   * @param {number} x 
   * @param {number} [y=0] 
   * @param {number} [z=0] 
   */
  setStagePosition(x, y = 0, z = 0) {
    this.stagePosition.set(x, y, z);
    if (this.vrm?.scene) {
      this.vrm.scene.position.copy(this.stagePosition);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FACE EXPRESSION MAPPING (ARKit blendshapes -> VRM)
  // ─────────────────────────────────────────────────────────────────────────
  applyBlendshapes(categories, smoothingAlpha = 0.3) {
    if (!this.vrm?.expressionManager || !categories) return;

    const score = (name) => categories.find((c) => c.categoryName === name)?.score ?? 0;

    // ── Raw scores from MediaPipe ──
    const jawOpen     = score('jawOpen');
    const smileRaw    = (score('mouthSmileLeft') + score('mouthSmileRight')) / 2;
    const frownRaw    = (score('mouthFrownLeft') + score('mouthFrownRight')) / 2;
    const browDownRaw = (score('browDownLeft') + score('browDownRight')) / 2;
    const browUpRaw   = score('browInnerUp');
    const eyeWideRaw  = (score('eyeWideLeft') + score('eyeWideRight')) / 2;
    const pucker      = score('mouthPucker');
    const funnel      = score('mouthFunnel');
    const stretch     = (score('mouthStretchLeft') + score('mouthStretchRight')) / 2;
    const rawBlinkL   = score('eyeBlinkLeft');
    const rawBlinkR   = score('eyeBlinkRight');

    // ── Eye gaze ──
    const lookUpL   = score('eyeLookUpLeft');
    const lookUpR   = score('eyeLookUpRight');
    const lookDownL = score('eyeLookDownLeft');
    const lookDownR = score('eyeLookDownRight');
    const lookInL   = score('eyeLookInLeft');
    const lookInR   = score('eyeLookInRight');
    const lookOutL  = score('eyeLookOutLeft');
    const lookOutR  = score('eyeLookOutRight');

    const gazeRight = (lookInL + lookOutR) / 2;
    const gazeLeft  = (lookOutL + lookInR) / 2;
    const gazeUp    = (lookUpL + lookUpR) / 2;
    const gazeDown  = (lookDownL + lookDownR) / 2;

    // ── Emotion expressions — CAPPED to prevent squint domination ──
    const EMOTION_CAP = 0.35;
    const happy     = Math.min(THREE.MathUtils.clamp(smileRaw * 1.4, 0, 1), EMOTION_CAP);
    const sad       = Math.min(THREE.MathUtils.clamp(frownRaw * 1.4, 0, 1), EMOTION_CAP);
    const angry     = Math.min(THREE.MathUtils.clamp(browDownRaw * 1.4, 0, 1), EMOTION_CAP);
    const surprised = Math.min(Math.max(browUpRaw, eyeWideRaw) * 1.3, EMOTION_CAP);

    // ── Blink suppression during strong smile ──
    const smileActivity = smileRaw;
    let blinkL = rawBlinkL;
    let blinkR = rawBlinkR;
    if (smileActivity > 0.3) {
      const suppress = THREE.MathUtils.clamp((smileActivity - 0.3) / 0.4, 0, 1);
      blinkL *= (1 - suppress);
      blinkR *= (1 - suppress);
    }
    blinkL = blinkL > 0.4 ? THREE.MathUtils.clamp((blinkL - 0.3) * 2, 0, 1) : 0;
    blinkR = blinkR > 0.4 ? THREE.MathUtils.clamp((blinkR - 0.3) * 2, 0, 1) : 0;

    // ── Target map ──
    const target = {
      happy, sad, angry, surprised,
      aa: jawOpen,
      ih: stretch,
      ou: pucker,
      oh: funnel,
      blinkLeft:  blinkL,
      blinkRight: blinkR,
      lookUp:     gazeUp,
      lookDown:   gazeDown,
      lookLeft:   gazeLeft,
      lookRight:  gazeRight
    };

    const em = this.vrm.expressionManager;
    const BLINK_KEYS = new Set(['blinkLeft', 'blinkRight']);
    const MOUTH_KEYS = new Set(['aa', 'ih', 'ou', 'oh']);
    const GAZE_KEYS  = new Set(['lookUp', 'lookDown', 'lookLeft', 'lookRight']);

    for (const name in target) {
      let a;
      if (BLINK_KEYS.has(name))       a = 0.7;
      else if (GAZE_KEYS.has(name))   a = 0.6;
      else if (MOUTH_KEYS.has(name))  a = Math.max(smoothingAlpha, 0.45);
      else                            a = Math.max(smoothingAlpha * 0.5, 0.12);

      let val = target[name];
      if (val < 0.05) val = 0; // Noise dead-zone

      const prev = this.expressionState[name] ?? 0;
      const next = prev + (val - prev) * a;
      this.expressionState[name] = next;
      em.setValue(name, next);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HEAD POSE (Matrix -> Euler -> Bone Rotation)
  // ─────────────────────────────────────────────────────────────────────────
  applyHeadPose(matrixData, enabled = true) {
    if (!this.headBone) return;
    if (!enabled) {
      this.headBone.rotation.set(0, 0, 0);
      return;
    }

    // Decompose column-major 4x4 using scratch matrix and scratch euler (zero allocations)
    scratchMatrix.fromArray(matrixData);
    scratchMatrix.decompose(scratchDecompPos, scratchQuatA, scratchDecompScale);
    scratchEuler.setFromQuaternion(scratchQuatA, 'YXZ');

    // Negate all axes: pitch for correct up/down, yaw+roll for mirror
    this.headBone.rotation.set(-scratchEuler.x, -scratchEuler.y, -scratchEuler.z);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BODY / ARMS (Pose worldLandmarks -> Quaternions)
  // ─────────────────────────────────────────────────────────────────────────
  applyPose(worldLandmarks, alpha = 0.3) {
    if (!this.vrm?.humanoid || !worldLandmarks) return;

    const dampQuat = (bone, targetQ, baseAlpha) => {
      const angle = bone.quaternion.angleTo(targetQ);
      if (angle < 0.015) return; // Tiny deadzone
      const a = angle < 0.06 ? baseAlpha * 0.3 : baseAlpha;
      bone.quaternion.slerp(targetQ, a);
    };

    for (const side of ['left', 'right']) {
      const pShoulder = worldLandmarks[POSE_IDX[`${side}Shoulder`]];
      const pElbow    = worldLandmarks[POSE_IDX[`${side}Elbow`]];
      const pWrist    = worldLandmarks[POSE_IDX[`${side}Wrist`]];

      const upperBone = this.vrm.humanoid.getNormalizedBoneNode(`${side}UpperArm`);
      const lowerBone = this.vrm.humanoid.getNormalizedBoneNode(`${side}LowerArm`);
      const restDir   = ARM_REST_DIR[`${side}UpperArm`];

      // Gracefully relax arms if landmarks drop out or visibility < 0.1
      if (!pWrist || !pElbow || (pWrist.visibility ?? 1) < 0.1 || (pElbow.visibility ?? 1) < 0.1) {
        if (upperBone) {
          // In Three.js, downward vector pointing toward floor is -Y
          scratchDownDir.set(restDir.x * 0.15, -0.98, 0).normalize();
          scratchQuatDrop.setFromUnitVectors(restDir, scratchDownDir);
          dampQuat(upperBone, scratchQuatDrop, alpha * 0.3);
        }
        if (lowerBone) {
          scratchQuatA.set(0, 0, 0, 1);
          dampQuat(lowerBone, scratchQuatA, alpha * 0.3);
        }
        continue;
      }

      // Convert landmarks into scratch vectors
      poseToScratch(pShoulder, scratchShoulder);
      poseToScratch(pElbow, scratchElbow);
      poseToScratch(pWrist, scratchWrist);

      scratchUpperDir.copy(scratchElbow).sub(scratchShoulder).normalize();
      scratchLowerDir.copy(scratchWrist).sub(scratchElbow).normalize();
      if (scratchUpperDir.lengthSq() === 0 || scratchLowerDir.lengthSq() === 0) continue;

      // Upper arm
      if (upperBone) {
        scratchQuatTarget.setFromUnitVectors(restDir, scratchUpperDir);
        dampQuat(upperBone, scratchQuatTarget, alpha);
      }

      // Lower arm (elbow hinge)
      if (lowerBone && upperBone) {
        scratchQuatUpperInv.copy(upperBone.quaternion).invert();
        scratchLocalDir.copy(scratchLowerDir).applyQuaternion(scratchQuatUpperInv).normalize();
        const bend = THREE.MathUtils.clamp(restDir.angleTo(scratchLocalDir), 0, THREE.MathUtils.degToRad(150));
        scratchAxis.crossVectors(restDir, scratchLocalDir);
        if (scratchAxis.lengthSq() < 1e-6) scratchAxis.set(0, 1, 0);
        scratchAxis.normalize();
        scratchQuatTarget.setFromAxisAngle(scratchAxis, bend);
        dampQuat(lowerBone, scratchQuatTarget, alpha);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HANDS & FINGERS
  // ─────────────────────────────────────────────────────────────────────────
  applyHands(handsInput, poseImageLandmarks, poseWorldLandmarks, alpha = 0.4) {
    if (!this.vrm?.humanoid || !handsInput) return;
    if (this.rigAudit && this.rigAudit.supportedHandTracking === 'NONE') return;

    // Normalize hands input: can be an Array of hand objects or a MediaPipe handsResult object
    let handsList = [];
    if (Array.isArray(handsInput)) {
      handsList = handsInput.map(h => ({
        lm: h.landmarks,
        worldLm: h.worldLandmarks,
        handedness: (typeof h.handedness === 'string' ? h.handedness : h.handedness?.[0]?.categoryName || '').toLowerCase()
      }));
    } else if (handsInput.landmarks && Array.isArray(handsInput.landmarks)) {
      handsList = handsInput.landmarks.map((lm, i) => ({
        lm,
        worldLm: handsInput.worldLandmarks?.[i],
        handedness: (handsInput.handednesses?.[i]?.[0]?.categoryName || '').toLowerCase()
      }));
    }

    if (handsList.length === 0) return;

    const seenSides = new Set();

    for (let h = 0; h < handsList.length; h++) {
      const { lm, worldLm, handedness } = handsList[h];
      if (!lm) continue;

      // Determine side with mirror correction
      let side = handedness;
      if (!poseImageLandmarks) {
        side = (side === 'left') ? 'right' : 'left';
      } else {
        const w = lm[0];
        const dL = Math.hypot(w.x - poseImageLandmarks[15].x, w.y - poseImageLandmarks[15].y);
        const dR = Math.hypot(w.x - poseImageLandmarks[16].x, w.y - poseImageLandmarks[16].y);
        side = dL < dR ? 'left' : 'right';
      }
      if (!side || (side !== 'left' && side !== 'right')) continue;
      seenSides.add(side);
      this._lastHandSeen[side] = performance.now();

      // ── Wrist Rotation ──
      const handBone = this.vrm.humanoid.getNormalizedBoneNode(`${side}Hand`);
      if (handBone && worldLm && poseWorldLandmarks) {
        // Invert Y to match Three.js coordinate system
        scratchHandWrist.set(worldLm[0].x, -worldLm[0].y, -worldLm[0].z);
        scratchHandMcp.set(worldLm[9].x, -worldLm[9].y, -worldLm[9].z);
        scratchHandFwd.copy(scratchHandMcp).sub(scratchHandWrist).normalize();

        const pElbow = poseWorldLandmarks[POSE_IDX[`${side}Elbow`]];
        const pWrist = poseWorldLandmarks[POSE_IDX[`${side}Wrist`]];
        if (pElbow && pWrist) {
          scratchElbow.set(pElbow.x, -pElbow.y, -pElbow.z * 0.3);
          scratchWrist.set(pWrist.x, -pWrist.y, -pWrist.z * 0.3);
          scratchForearmDir.copy(scratchWrist).sub(scratchElbow).normalize();

          if (scratchForearmDir.lengthSq() > 0 && scratchHandFwd.lengthSq() > 0) {
            scratchQuatTwist.setFromUnitVectors(scratchForearmDir, scratchHandFwd);
            const twistAngle = 2 * Math.acos(Math.abs(THREE.MathUtils.clamp(scratchQuatTwist.w, -1, 1)));
            const maxWrist = THREE.MathUtils.degToRad(90);

            scratchQuatTarget.copy(scratchQuatTwist);
            if (twistAngle > maxWrist) {
              scratchQuatTarget.slerp(scratchQuatTwist, maxWrist / twistAngle);
            }

            const diff = handBone.quaternion.angleTo(scratchQuatTarget);
            if (diff > 0.03) {
              const a = diff < 0.1 ? alpha * 0.25 : alpha * 0.7;
              handBone.quaternion.slerp(scratchQuatTarget, a);
            }
          }
        }
      }

      // If rig does not support finger tracking, skip fingers
      if (this.rigAudit && this.rigAudit.supportedFingerTracking === false) {
        continue;
      }

      // ── Per-joint Finger Curl ──
      for (const finger in FINGER_LANDMARKS) {
        const [i0, i1, i2, i3] = FINGER_LANDMARKS[finger];
        const useWorld = !!worldLm;

        if (useWorld) {
          scratchJointV0.set(worldLm[i0].x, -worldLm[i0].y, -worldLm[i0].z);
          scratchJointV1.set(worldLm[i1].x, -worldLm[i1].y, -worldLm[i1].z);
          scratchJointV2.set(worldLm[i2].x, -worldLm[i2].y, -worldLm[i2].z);
          scratchJointV3.set(worldLm[i3].x, -worldLm[i3].y, -worldLm[i3].z);
        } else {
          scratchJointV0.set(lm[i0].x, -lm[i0].y, -(lm[i0].z || 0));
          scratchJointV1.set(lm[i1].x, -lm[i1].y, -(lm[i1].z || 0));
          scratchJointV2.set(lm[i2].x, -lm[i2].y, -(lm[i2].z || 0));
          scratchJointV3.set(lm[i3].x, -lm[i3].y, -(lm[i3].z || 0));
        }

        scratchSeg0.copy(scratchJointV1).sub(scratchJointV0).normalize();
        scratchSeg1.copy(scratchJointV2).sub(scratchJointV1).normalize();
        scratchSeg2.copy(scratchJointV3).sub(scratchJointV2).normalize();

        const a01 = Math.acos(THREE.MathUtils.clamp(scratchSeg0.dot(scratchSeg1), -1, 1));
        const a12 = Math.acos(THREE.MathUtils.clamp(scratchSeg1.dot(scratchSeg2), -1, 1));

        const maxBend = Math.PI * 0.5;
        const c0 = THREE.MathUtils.clamp(a01 / maxBend, 0, 1);
        const c1 = THREE.MathUtils.clamp(a12 / maxBend, 0, 1);

        const dz = (x) => x < 0.12 ? 0 : x;
        const jointCurls = [dz(c0), dz(c1), dz(c1 * 0.7)];
        const bones = FINGER_BONE_NAMES[finger];
        const maxRot = THREE.MathUtils.degToRad(75);

        for (let j = 0; j < bones.length; j++) {
          const bone = this.vrm.humanoid.getNormalizedBoneNode(`${side}${bones[j]}`);
          if (!bone) continue;

          const key  = `${side}_${finger}_${j}`;
          const prev = this._fingerCurlState[key] ?? 0;
          const diff = Math.abs(jointCurls[j] - prev);
          const a = diff < 0.05 ? alpha * 0.1 : alpha * 0.5;

          const curl = prev + (jointCurls[j] - prev) * a;
          this._fingerCurlState[key] = curl;

          if (finger === 'thumb') {
            const sign = side === 'left' ? 1 : -1;
            bone.rotation.set(0, curl * maxRot * sign, curl * maxRot * sign);
          } else {
            bone.rotation.set(0, 0, curl * (side === 'left' ? maxRot : -maxRot));
          }
        }
      }
    }

    // Decay unseen side if only one hand was tracked
    for (const side of ['left', 'right']) {
      if (!seenSides.has(side)) {
        this.decayHandSide(side, 0.016);
      }
    }
  }

  /**
   * Smoothly decays wrist orientation and finger curls for a specific hand side
   * back to neutral zero rest pose when hand tracking drops out.
   * @param {'left'|'right'} side
   * @param {number} [dt=0.016] - Delta time in seconds
   * @param {number} [decayRate=5.0] - Exponential decay rate
   */
  decayHandSide(side, dt = 0.016, decayRate = 5.0) {
    if (!this.vrm?.humanoid) return;
    const decayFactor = Math.min(dt * decayRate, 0.5);

    // 1. Decay wrist rotation toward identity
    const handBone = this.vrm.humanoid.getNormalizedBoneNode(`${side}Hand`);
    if (handBone) {
      scratchQuatA.set(0, 0, 0, 1);
      handBone.quaternion.slerp(scratchQuatA, decayFactor);
    }

    // 2. Decay finger curls toward 0
    const maxRot = THREE.MathUtils.degToRad(75);
    for (const finger in FINGER_BONE_NAMES) {
      const bones = FINGER_BONE_NAMES[finger];
      for (let j = 0; j < bones.length; j++) {
        const key = `${side}_${finger}_${j}`;
        const prev = this._fingerCurlState[key] ?? 0;
        if (prev <= 0.001) {
          this._fingerCurlState[key] = 0;
          continue;
        }
        const next = Math.max(0, prev - (prev * decayFactor) - 0.01 * decayFactor);
        this._fingerCurlState[key] = next;

        const bone = this.vrm.humanoid.getNormalizedBoneNode(`${side}${bones[j]}`);
        if (bone) {
          if (finger === 'thumb') {
            const sign = side === 'left' ? 1 : -1;
            bone.rotation.set(0, next * maxRot * sign, next * maxRot * sign);
          } else {
            bone.rotation.set(0, 0, next * (side === 'left' ? maxRot : -maxRot));
          }
        }
      }
    }
  }

  /**
   * Smoothly decays both hands to neutral uncurled rest pose.
   * @param {number} [dt=0.016]
   * @param {number} [decayRate=5.0]
   */
  decayHands(dt = 0.016, decayRate = 5.0) {
    this.decayHandSide('left', dt, decayRate);
    this.decayHandSide('right', dt, decayRate);
  }

  /**
   * Resets all arm kinematics, wrist rotations, and finger curls to neutral rest pose.
   * Completely wipes residual pose to prevent frozen hand/arm state.
   */
  resetPoseAndHands() {
    if (!this.vrm?.humanoid) return;
    scratchQuatA.set(0, 0, 0, 1);

    for (const side of ['left', 'right']) {
      const upperBone = this.vrm.humanoid.getNormalizedBoneNode(`${side}UpperArm`);
      const lowerBone = this.vrm.humanoid.getNormalizedBoneNode(`${side}LowerArm`);
      const handBone = this.vrm.humanoid.getNormalizedBoneNode(`${side}Hand`);
      const restDir = ARM_REST_DIR[`${side}UpperArm`];

      if (upperBone) {
        scratchDownDir.set(restDir.x * 0.15, -0.98, 0).normalize();
        scratchQuatDrop.setFromUnitVectors(restDir, scratchDownDir);
        upperBone.quaternion.copy(scratchQuatDrop);
      }
      if (lowerBone) {
        lowerBone.quaternion.copy(scratchQuatA);
      }
      if (handBone) {
        handBone.quaternion.copy(scratchQuatA);
      }

      for (const finger in FINGER_BONE_NAMES) {
        const bones = FINGER_BONE_NAMES[finger];
        for (let j = 0; j < bones.length; j++) {
          const key = `${side}_${finger}_${j}`;
          this._fingerCurlState[key] = 0;
          const bone = this.vrm.humanoid.getNormalizedBoneNode(`${side}${bones[j]}`);
          if (bone) {
            bone.rotation.set(0, 0, 0);
          }
        }
      }
    }
    this._wristQuatState = {};
    this._armQuatState = {};
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONVENIENCE MULTI-AVATAR TRACKING INTERFACES
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * Updates face expressions and head pose for this avatar.
   * @param {Object} faceData - { blendshapes, transformationMatrix }
   * @param {Object} [options]
   * @param {number} [options.smoothingAlpha=0.3]
   * @param {boolean} [options.headPoseEnabled=true]
   */
  updateFace(faceData, options = {}) {
    if (!faceData) return;
    const { smoothingAlpha = 0.3, headPoseEnabled = true } = options;
    if (faceData.blendshapes && faceData.blendshapes.length) {
      this.applyBlendshapes(faceData.blendshapes, smoothingAlpha);
    }
    if (faceData.transformationMatrix && faceData.transformationMatrix.length) {
      this.applyHeadPose(faceData.transformationMatrix, headPoseEnabled);
    }
  }

  /**
   * Updates body and arm kinematics for this avatar.
   * @param {Object} poseData - { worldLandmarks, landmarks }
   * @param {Object} [options]
   * @param {number} [options.alpha=0.3]
   */
  updatePose(poseData, options = {}) {
    if (!poseData) return;
    const { alpha = 0.3 } = options;
    if (poseData.worldLandmarks && poseData.worldLandmarks.length) {
      this.applyPose(poseData.worldLandmarks, alpha);
    }
  }

  /**
   * Updates hands and finger curls for this avatar.
   * @param {Object} handsResult - Hands detection result
   * @param {Array} [poseImageLandmarks]
   * @param {Array} [poseWorldLandmarks]
   * @param {Object} [options]
   * @param {number} [options.alpha=0.4]
   */
  updateHands(handsResult, poseImageLandmarks = null, poseWorldLandmarks = null, options = {}) {
    if (!handsResult) return;
    const { alpha = 0.4 } = options;
    this.applyHands(handsResult, poseImageLandmarks, poseWorldLandmarks, alpha);
  }

  /**
   * Convenience tracking update directly from a TrackedPerson object.
   * @param {Object} trackedPerson
   * @param {Object} [options]
   */
  updateFromTrackedPerson(trackedPerson, options = {}) {
    if (!trackedPerson) return;
    const { smoothingAlpha = 0.3, headPoseEnabled = true, poseAlpha = 0.3, handAlpha = 0.4 } = options;

    if (trackedPerson.face) {
      this.updateFace(trackedPerson.face, { smoothingAlpha, headPoseEnabled });
    }

    if (trackedPerson.pose) {
      this.updatePose(trackedPerson.pose, { alpha: poseAlpha });
    }

    if (trackedPerson.hands && trackedPerson.hands.length > 0) {
      const handsResult = {
        landmarks: trackedPerson.hands.map(h => h.landmarks),
        worldLandmarks: trackedPerson.hands.map(h => h.worldLandmarks),
        handednesses: trackedPerson.hands.map(h => [{ categoryName: h.handedness }])
      };
      this.updateHands(
        handsResult,
        trackedPerson.pose ? trackedPerson.pose.landmarks : null,
        trackedPerson.pose ? trackedPerson.pose.worldLandmarks : null,
        { alpha: handAlpha }
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MANUAL CONTROLS & UTILITIES (preserves manual.html slider mode)
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

  /**
   * Evaluates VRM spring-bone physics simulation for this avatar.
   * @param {number} delta - Elapsed time in seconds
   */
  update(delta) {
    if (this.vrm) {
      this.vrm.update(delta);
    }
  }

  /**
   * Completely disposes GPU and memory resources for this avatar.
   */
  dispose() {
    this.resetPoseAndHands();
    if (this.vrm) {
      disposeVRM(this.vrm);
      this.vrm = null;
      this.headBone = null;
      this.isLoaded = false;
      this.rigAudit = null;
      this.expressionState = {};
      this._armQuatState = {};
      this._fingerCurlState = {};
      this._wristQuatState = {};
    }
  }
}
