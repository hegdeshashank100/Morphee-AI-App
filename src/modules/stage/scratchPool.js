/**
 * scratchPool.js — Pre-allocated reusable Three.js objects for hot animation loop calculations.
 *
 * CRITICAL ARCHITECTURAL ROLE:
 * Eliminates thousands of per-frame object allocations (new THREE.Vector3(), new THREE.Quaternion())
 * inside the render loop, completely preventing V8 Garbage Collector pauses and frame stutter.
 *
 * IMPORTANT: Scratch objects are strictly for immediate, ephemeral math within a single
 * synchronous calculation block. They must NEVER be stored as long-term avatar state.
 * Distinct scratch variables are provided for nested operations to avoid cross-contamination.
 */

import * as THREE from 'three';

// ── Scratch Vectors ──
export const scratchVecA = new THREE.Vector3();
export const scratchVecB = new THREE.Vector3();
export const scratchVecC = new THREE.Vector3();
export const scratchVecD = new THREE.Vector3();
export const scratchVecE = new THREE.Vector3();
export const scratchVecF = new THREE.Vector3();
export const scratchVecG = new THREE.Vector3();
export const scratchVecH = new THREE.Vector3();

// ── Specific Arm & Pose Scratch Vectors (isolated from finger loops) ──
export const scratchShoulder = new THREE.Vector3();
export const scratchElbow = new THREE.Vector3();
export const scratchWrist = new THREE.Vector3();
export const scratchUpperDir = new THREE.Vector3();
export const scratchLowerDir = new THREE.Vector3();
export const scratchLocalDir = new THREE.Vector3();
export const scratchAxis = new THREE.Vector3();
export const scratchDownDir = new THREE.Vector3();

// ── Specific Hand & Wrist Scratch Vectors ──
export const scratchHandWrist = new THREE.Vector3();
export const scratchHandMcp = new THREE.Vector3();
export const scratchHandFwd = new THREE.Vector3();
export const scratchForearmDir = new THREE.Vector3();

// ── Specific Finger Curl Scratch Vectors ──
export const scratchJointV0 = new THREE.Vector3();
export const scratchJointV1 = new THREE.Vector3();
export const scratchJointV2 = new THREE.Vector3();
export const scratchJointV3 = new THREE.Vector3();
export const scratchSeg0 = new THREE.Vector3();
export const scratchSeg1 = new THREE.Vector3();
export const scratchSeg2 = new THREE.Vector3();

// ── Scratch Quaternions ──
export const scratchQuatA = new THREE.Quaternion();
export const scratchQuatB = new THREE.Quaternion();
export const scratchQuatC = new THREE.Quaternion();
export const scratchQuatUpperInv = new THREE.Quaternion();
export const scratchQuatTwist = new THREE.Quaternion();
export const scratchQuatTarget = new THREE.Quaternion();
export const scratchQuatDrop = new THREE.Quaternion();

// ── Scratch Euler & Matrix ──
export const scratchEuler = new THREE.Euler(0, 0, 0, 'YXZ');
export const scratchMatrix = new THREE.Matrix4();
export const scratchDecompPos = new THREE.Vector3();
export const scratchDecompScale = new THREE.Vector3();
