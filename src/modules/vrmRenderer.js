/**
 * vrmRenderer.js — Refactored Decoupled VRM Renderer Facade & Compatibility Bridge.
 *
 * PHASE 1 ARCHITECTURE REFACTOR:
 * This module refactors the original monolithic VrmRenderer to delegate to:
 *   - StageManager: Unified Three.js Scene, Renderer, Camera, Lights, and Multi-Avatar Loop.
 *   - AvatarInstance: Isolated per-character VRM controller, bone solver, and EMA state.
 *   - ScratchPool: Zero-allocation vectors and quaternions for hot per-frame math.
 *   - VramDisposer: Deep recursive BufferGeometry, Material, and Texture cleanup.
 *
 * 100% BACKWARD COMPATIBLE:
 * Preserves the exact public API for src/main.js and src/manual.js while achieving
 * complete architectural decoupling and zero progressive VRAM leaks.
 */

import { StageManager, DEFAULT_VRM_URL } from './stage/stageManager.js';
import { AvatarInstance } from './stage/avatarInstance.js';
import { disposeVRM } from './stage/vramDisposer.js';
import * as scratchPool from './stage/scratchPool.js';

export { StageManager, AvatarInstance, disposeVRM, scratchPool, DEFAULT_VRM_URL };

export class VrmRenderer {
  /**
   * @param {HTMLCanvasElement} canvas 
   */
  constructor(canvas) {
    this.stageManager = new StageManager(canvas);

    // Direct access bridges for compatibility
    this.canvas = this.stageManager.canvas;
    this.scene = this.stageManager.scene;
    this.camera = this.stageManager.camera;
    this.renderer = this.stageManager.renderer;
    this.controls = this.stageManager.controls;
  }

  get vrm() {
    return this.stageManager.primaryAvatar?.vrm ?? null;
  }

  get headBone() {
    return this.stageManager.primaryAvatar?.headBone ?? null;
  }

  get expressionState() {
    return this.stageManager.primaryAvatar?.expressionState ?? {};
  }

  get onRenderFps() {
    return this.stageManager.onRenderFps;
  }

  set onRenderFps(callback) {
    this.stageManager.onRenderFps = callback;
  }

  resize() {
    this.stageManager.resize();
  }

  setPixelRatio(maxRatio = 2.0) {
    this.stageManager.setPixelRatio(maxRatio);
  }

  setAntialiasing(enabled = true) {
    this.stageManager.setAntialiasing(enabled);
    this.renderer = this.stageManager.renderer;
    this.controls = this.stageManager.controls;
  }

  /**
   * Loads or switches the VRM model.
   * Leverages deep VRAM disposal to ensure zero progressive memory leaks.
   * @param {string} [url] 
   * @returns {Promise<number>}
   */
  async loadRig(url = DEFAULT_VRM_URL) {
    return this.stageManager.loadPrimaryAvatar(url);
  }

  applyBlendshapes(categories, smoothingAlpha = 0.3) {
    if (this.stageManager.primaryAvatar) {
      this.stageManager.primaryAvatar.applyBlendshapes(categories, smoothingAlpha);
    }
  }

  applyHeadPose(matrixData, enabled = true) {
    if (this.stageManager.primaryAvatar) {
      this.stageManager.primaryAvatar.applyHeadPose(matrixData, enabled);
    }
  }

  applyPose(worldLandmarks, alpha = 0.3) {
    if (this.stageManager.primaryAvatar) {
      this.stageManager.primaryAvatar.applyPose(worldLandmarks, alpha);
    }
  }

  applyHands(handsResult, poseImageLandmarks, poseWorldLandmarks, alpha = 0.4) {
    if (this.stageManager.primaryAvatar) {
      this.stageManager.primaryAvatar.applyHands(handsResult, poseImageLandmarks, poseWorldLandmarks, alpha);
    }
  }

  setInfluence(name, value) {
    if (this.stageManager.primaryAvatar) {
      this.stageManager.primaryAvatar.setInfluence(name, value);
    }
  }

  setInfluencePair(nameLeft, nameRight, value) {
    if (this.stageManager.primaryAvatar) {
      this.stageManager.primaryAvatar.setInfluencePair(nameLeft, nameRight, value);
    }
  }

  resetAllInfluences() {
    if (this.stageManager.primaryAvatar) {
      this.stageManager.primaryAvatar.resetAllInfluences();
    }
  }

  setNeckPitch(degrees) {
    if (this.stageManager.primaryAvatar) {
      this.stageManager.primaryAvatar.setNeckPitch(degrees);
    }
  }

  resetView() {
    this.stageManager.resetView();
  }

  startRenderLoop() {
    this.stageManager.startRenderLoop();
  }

  stopRenderLoop() {
    this.stageManager.stopRenderLoop();
  }

  /**
   * Diagnostic WebGL memory introspection for testing.
   */
  getResourceInfo() {
    return this.stageManager.getResourceInfo();
  }

  dispose() {
    this.stageManager.dispose();
  }
}
