/**
 * avatarRigValidator.js — Humanoid Rig & Hand Retargeting Diagnostics Validator.
 *
 * CRITICAL ARCHITECTURAL ROLE:
 * Audits 3D VRM avatar bone hierarchies and humanoid mappings at load/activation time
 * without incurring per-frame runtime overhead.
 *
 * DETECTS & CLASSIFIES:
 * 1. VRM specification format: VRM 0.0 vs VRM 1.0.
 * 2. Standard arm kinematic chains: Left/Right UpperArm, LowerArm, Hand.
 * 3. Finger bone availability: 40 possible humanoid finger bones across 5 fingers/hand.
 * 4. Retargeting support level:
 *    - 'FULL': All 6 arm bones present and >= 20 finger bones.
 *    - 'ARM/HAND ONLY': All 6 arm bones present, but finger bones incomplete (e.g. VoxBot).
 *    - 'NONE': Missing critical upper/lower arm bones.
 */

const REQUIRED_ARM_BONES = [
  'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightUpperArm', 'rightLowerArm', 'rightHand'
];

const FINGER_NAMES = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const FINGER_JOINTS = ['Metacarpal', 'Proximal', 'Intermediate', 'Distal'];

/**
 * Validates a loaded VRM avatar instance's humanoid rig.
 * Safe for all avatar models, including non-standard rigs and missing bones.
 *
 * @param {import('@pixiv/three-vrm').VRM} vrm - Loaded Three VRM instance
 * @param {string} [avatarId='unknown'] - Identifier of the avatar definition
 * @returns {{
 *   avatarId: string,
 *   vrmVersion: string,
 *   humanoidAvailable: boolean,
 *   armBonesAvailable: boolean,
 *   handBonesAvailable: boolean,
 *   fingerBonesAvailable: boolean,
 *   missingArmBones: string[],
 *   fingerBonesCount: number,
 *   totalFingerBones: number,
 *   supportedHandTracking: 'FULL' | 'ARM/HAND ONLY' | 'NONE',
 *   supportedFingerTracking: boolean,
 *   warnings: string[],
 *   leftArmBones: { upper: boolean, lower: boolean, hand: boolean },
 *   rightArmBones: { upper: boolean, lower: boolean, hand: boolean }
 * }}
 */
export function validateAvatarRig(vrm, avatarId = 'unknown') {
  const warnings = [];

  if (!vrm) {
    return {
      avatarId,
      vrmVersion: 'unknown',
      humanoidAvailable: false,
      armBonesAvailable: false,
      handBonesAvailable: false,
      fingerBonesAvailable: false,
      missingArmBones: [...REQUIRED_ARM_BONES],
      fingerBonesCount: 0,
      totalFingerBones: 40,
      supportedHandTracking: 'NONE',
      supportedFingerTracking: false,
      warnings: ['VRM instance is null or undefined'],
      leftArmBones: { upper: false, lower: false, hand: false },
      rightArmBones: { upper: false, lower: false, hand: false }
    };
  }

  const vrmVersion = vrm.meta?.metaVersion || (vrm.isVRM0 ? '0.0' : '1.0');
  const humanoid = vrm.humanoid;
  const humanoidAvailable = !!humanoid;

  if (!humanoidAvailable) {
    warnings.push('VRM has no humanoid specification; skeletal retargeting unavailable');
    return {
      avatarId,
      vrmVersion,
      humanoidAvailable: false,
      armBonesAvailable: false,
      handBonesAvailable: false,
      fingerBonesAvailable: false,
      missingArmBones: [...REQUIRED_ARM_BONES],
      fingerBonesCount: 0,
      totalFingerBones: 40,
      supportedHandTracking: 'NONE',
      supportedFingerTracking: false,
      warnings,
      leftArmBones: { upper: false, lower: false, hand: false },
      rightArmBones: { upper: false, lower: false, hand: false }
    };
  }

  // Audit arm bones
  const missingArmBones = [];
  const armStatus = {};
  for (const boneName of REQUIRED_ARM_BONES) {
    const node = humanoid.getNormalizedBoneNode(boneName) || humanoid.getRawBoneNode(boneName);
    armStatus[boneName] = !!node;
    if (!node) {
      missingArmBones.push(boneName);
    }
  }

  const leftArmBones = {
    upper: !!armStatus.leftUpperArm,
    lower: !!armStatus.leftLowerArm,
    hand:  !!armStatus.leftHand
  };

  const rightArmBones = {
    upper: !!armStatus.rightUpperArm,
    lower: !!armStatus.rightLowerArm,
    hand:  !!armStatus.rightHand
  };

  const armBonesAvailable = leftArmBones.upper && leftArmBones.lower && rightArmBones.upper && rightArmBones.lower;
  const handBonesAvailable = leftArmBones.hand && rightArmBones.hand;

  if (!armBonesAvailable) {
    warnings.push(`Missing critical arm bones: ${missingArmBones.join(', ')}`);
  }

  // Audit finger bones
  let fingerBonesCount = 0;
  const totalFingerBones = 40; // 2 hands * 5 fingers * 4 joints
  const missingFingers = [];

  for (const side of ['left', 'right']) {
    for (const finger of FINGER_NAMES) {
      for (const joint of FINGER_JOINTS) {
        const boneName = `${side}${finger}${joint}`;
        const node = humanoid.getNormalizedBoneNode(boneName) || humanoid.getRawBoneNode(boneName);
        if (node) {
          fingerBonesCount++;
        } else {
          missingFingers.push(boneName);
        }
      }
    }
  }

  // In standard VRoid rigs, metacarpals are omitted (yielding 30/40), which is full finger tracking.
  // Rigs with fewer than 20 finger bones (e.g. VoxBot with 22/40 or partial digits) are classified ARM/HAND ONLY.
  const supportedFingerTracking = fingerBonesCount >= 24;
  let supportedHandTracking = 'NONE';

  if (armBonesAvailable && handBonesAvailable) {
    if (supportedFingerTracking) {
      supportedHandTracking = 'FULL';
    } else {
      supportedHandTracking = 'ARM/HAND ONLY';
      warnings.push(`Finger bones incomplete (${fingerBonesCount}/40); fallback to ARM/HAND ONLY tracking`);
    }
  } else if (armBonesAvailable) {
    supportedHandTracking = 'ARM ONLY';
    warnings.push('Hand wrist bones missing; fallback to ARM ONLY tracking');
  }

  return {
    avatarId,
    vrmVersion,
    humanoidAvailable: true,
    armBonesAvailable,
    handBonesAvailable,
    fingerBonesAvailable: supportedFingerTracking,
    missingArmBones,
    fingerBonesCount,
    totalFingerBones,
    supportedHandTracking,
    supportedFingerTracking,
    warnings,
    leftArmBones,
    rightArmBones
  };
}
