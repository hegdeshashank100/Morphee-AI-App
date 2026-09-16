/**
 * stageManager.js — Unified Three.js Scene, Camera, Lighting & Multi-Avatar Stage Orchestrator.
 *
 * CRITICAL ARCHITECTURAL ROLE:
 * Owns the single shared THREE.WebGLRenderer, THREE.Scene, PerspectiveCamera, OrbitControls,
 * and studio lighting rig. Coordinates rendering for one or more AvatarInstance objects in
 * a single draw pass (ZERO WebGL context duplication).
 *
 * Provides diagnostic resource introspection (renderer.info) for leak testing.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AvatarInstance } from './avatarInstance.js';

// ── Default Framing Configuration ──
const DEFAULT_FRAMING_CONFIG = {
  marginLeft: 0.15,
  marginRight: 0.15,
  marginTop: 0.12,
  marginBottom: 0.10,
  minFramingDelta: 0.05,
  expandLerpAlpha: 0.08,
  contractLerpAlpha: 0.03,
  contractDelayMs: 500,
  minCameraZ: 1.6,
  maxCameraZ: 8.0,
  avatarHalfWidth: 0.35,
  avatarHeight: 1.55,
  avatarBaseY: 0.60
};

// Legacy fallback URL preserved for backward compatibility with manual.js
export const DEFAULT_VRM_URL = 'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/stable/AvatarSample_B.vrm';

export class StageManager {
  /**
   * @param {HTMLCanvasElement} canvas 
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
    this.defaultCamPos = new THREE.Vector3(0, 1.28, 1.85);
    this.defaultCamTarget = new THREE.Vector3(0, 1.18, 0);
    this.camera.position.copy(this.defaultCamPos);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 10.0;
    this.controls.target.copy(this.defaultCamTarget);

    this._setupLights();

    // Map of active AvatarInstance objects: Map<string, AvatarInstance>
    this.avatars = new Map();
    // Map of active AvatarInstance objects by TrackID: Map<number, AvatarInstance>
    this.trackAvatars = new Map();
    this.primaryAvatar = null;

    // ─── Dynamic Auto-Fit Group Framing System ───
    this._autoFraming = true;
    this._framingConfig = { ...DEFAULT_FRAMING_CONFIG };

    // Pre-allocated scratch vectors for framing math (ZERO per-frame allocation)
    this._scratchGroupMin = new THREE.Vector3();
    this._scratchGroupMax = new THREE.Vector3();
    this._scratchGroupCenter = new THREE.Vector3();

    // Smooth camera targets
    this._targetCamPos = new THREE.Vector3().copy(this.defaultCamPos);
    this._targetCamLookAt = new THREE.Vector3().copy(this.defaultCamTarget);
    this._currentLerpAlpha = this._framingConfig.expandLerpAlpha;

    // Population tracking for hysteresis
    this._lastPopulation = 0;
    this._lastPopulationChangeMs = 0;
    this._framingDirty = false;

    // Legacy compat
    this._targetCamZ = 1.85;
    this._targetCamTargetY = 1.18;

    this._clock = new THREE.Clock();
    this._rfLast = performance.now();
    this._rfSmoothed = 0;
    this.lastRenderMs = 0;
    this.onRenderFps = null;
    this._isLoopRunning = false;

    this._resizeHandler = () => this.resize();
    window.addEventListener('resize', this._resizeHandler);
  }

  _setupLights() {
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.6, 1.6, 1);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x9fd8ff, 0.5);
    fill.position.set(-0.8, 1.2, 0.4);
    this.scene.add(fill);

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambient);
  }

  resize() {
    const wrap = this.canvas.parentElement;
    if (!wrap) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w === 0 || h === 0) return;

    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Dynamically adjusts renderer pixel ratio for adaptive quality scaling.
   * @param {number} maxRatio 
   */
  setPixelRatio(maxRatio = 2.0) {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 2.0;
    const clamped = Math.min(dpr, maxRatio);
    if (this.renderer && typeof this.renderer.setPixelRatio === 'function') {
      this.renderer.setPixelRatio(clamped);
    }
  }

  /**
   * Toggles hardware anti-aliasing.
   * Recreates the single THREE.WebGLRenderer on the same canvas with zero resource leakage.
   * @param {boolean} enabled
   */
  setAntialiasing(enabled = true) {
    if (!this.canvas) return;
    const antialias = Boolean(enabled);
    if (this._antialiasing === antialias) return;
    this._antialiasing = antialias;

    const currentRatio = (this.renderer && typeof this.renderer.getPixelRatio === 'function') ? this.renderer.getPixelRatio() : 1;
    const width = this.canvas.parentElement ? this.canvas.parentElement.clientWidth : (this.canvas.width || 640);
    const height = this.canvas.parentElement ? this.canvas.parentElement.clientHeight : (this.canvas.height || 480);

    if (this.controls && typeof this.controls.dispose === 'function') {
      this.controls.dispose();
    }
    if (this.renderer && typeof this.renderer.dispose === 'function') {
      this.renderer.dispose();
    }

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias,
        alpha: true,
        powerPreference: 'high-performance'
      });
      if (typeof this.renderer.setPixelRatio === 'function') {
        this.renderer.setPixelRatio(currentRatio);
      }
      if (typeof this.renderer.setSize === 'function') {
        this.renderer.setSize(width, height, false);
      }
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;

      if (typeof OrbitControls !== 'undefined') {
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.minDistance = 0.3;
        this.controls.maxDistance = 4.0;
        this.controls.target.copy(this.defaultCamTarget);
      }
    } catch (err) {
      // Headless / Node environment without WebGL canvas context
      this.renderer = {
        domElement: this.canvas,
        pixelRatio: currentRatio,
        antialias,
        setSize: () => {},
        setPixelRatio: (r) => { this.renderer.pixelRatio = r; },
        getPixelRatio: () => this.renderer.pixelRatio,
        render: () => {},
        dispose: () => { this.renderer.disposed = true; }
      };
    }
  }

  /**
   * Loads or switches the primary avatar.
   * Disposes the previous primary avatar cleanly before loading the new one.
   * @param {string} [url] 
   * @returns {Promise<number>} expression count
   */
  async loadPrimaryAvatar(url = DEFAULT_VRM_URL) {
    // 1. If an existing primary avatar exists, clean it up completely
    if (this.primaryAvatar) {
      this.removeAvatar(this.primaryAvatar.id);
      this.primaryAvatar = null;
    }

    // 2. Create a new isolated AvatarInstance
    const newAvatar = new AvatarInstance('primary', 'Primary Avatar');
    const count = await newAvatar.load(url);

    // 3. Attach into the shared Three.js scene
    this.addAvatar(newAvatar);
    this.primaryAvatar = newAvatar;

    return count;
  }

  /**
   * Sets the primary avatar without disposing it directly (allowing cache management).
   * @param {AvatarInstance} avatar 
   */
  setPrimaryAvatar(avatar) {
    if (this.primaryAvatar && this.primaryAvatar !== avatar) {
      if (this.primaryAvatar.vrm?.scene) {
        this.scene.remove(this.primaryAvatar.vrm.scene);
      }
      this.avatars.delete(this.primaryAvatar.id);
    }
    this.addAvatar(avatar);
    this.primaryAvatar = avatar;
  }

  /**
   * Adds an AvatarInstance into the shared Three.js scene.
   * @param {AvatarInstance} avatar 
   */
  addAvatar(avatar) {
    if (!avatar?.vrm?.scene) return;
    if (!this.scene.children.includes(avatar.vrm.scene)) {
      this.scene.add(avatar.vrm.scene);
    }
    this.avatars.set(avatar.id, avatar);
  }

  /**
   * Removes and completely disposes an AvatarInstance from the stage.
   * @param {string} avatarId 
   */
  removeAvatar(avatarId) {
    const avatar = this.avatars.get(avatarId);
    if (!avatar) return;

    if (avatar.vrm?.scene) {
      this.scene.remove(avatar.vrm.scene);
    }
    avatar.dispose();
    this.avatars.delete(avatarId);

    if (this.primaryAvatar?.id === avatarId) {
      this.primaryAvatar = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MULTI-AVATAR TRACK MANAGEMENT & POSITIONING
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * Associates an AvatarInstance with a persistent TrackID on the shared stage.
   * @param {number} trackId 
   * @param {AvatarInstance} avatar 
   */
  addTrackAvatar(trackId, avatar) {
    if (!avatar?.vrm?.scene) return;

    // Detach any previous avatar for this track
    const existing = this.trackAvatars.get(trackId);
    if (existing && existing !== avatar) {
      if (existing.vrm?.scene) {
        this.scene.remove(existing.vrm.scene);
      }
      this.trackAvatars.delete(trackId);
      this.avatars.delete(`track_${trackId}`);
    }

    if (!this.scene.children.includes(avatar.vrm.scene)) {
      this.scene.add(avatar.vrm.scene);
    }
    avatar.visible = true;
    this.trackAvatars.set(trackId, avatar);
    this.avatars.set(`track_${trackId}`, avatar);

    if (!this.primaryAvatar) {
      this.primaryAvatar = avatar;
    }
  }

  /**
   * Removes an AvatarInstance for a TrackID from the active stage.
   * Does NOT force-destroy VRM if it is managed by AvatarCache.
   * @param {number} trackId 
   * @returns {AvatarInstance|null}
   */
  removeTrackAvatar(trackId) {
    const avatar = this.trackAvatars.get(trackId);
    if (!avatar) return null;

    if (avatar.vrm?.scene) {
      this.scene.remove(avatar.vrm.scene);
      avatar.visible = false;
      if (typeof avatar.resetPoseAndHands === 'function') {
        avatar.resetPoseAndHands();
      }
    }
    this.trackAvatars.delete(trackId);
    this.avatars.delete(`track_${trackId}`);

    if (this.primaryAvatar === avatar) {
      this.primaryAvatar = this.trackAvatars.values().next().value || null;
    }

    return avatar;
  }

  /**
   * Retrieves AvatarInstance for a persistent TrackID.
   * @param {number} trackId 
   * @returns {AvatarInstance|null}
   */
  getAvatarForTrack(trackId) {
    return this.trackAvatars.get(trackId) ?? null;
  }

  /**
   * Sets dynamic framing configuration.
   * @param {Object} config - Partial framing configuration to merge
   */
  setFramingConfig(config = {}) {
    Object.assign(this._framingConfig, config);
  }

  /**
   * Returns a copy of the current framing configuration.
   * @returns {Object}
   */
  getFramingConfig() {
    return { ...this._framingConfig };
  }

  /**
   * Returns the current dynamic framing state for telemetry and testing.
   * @returns {Object}
   */
  getFramingState() {
    return {
      targetCamPos: { x: this._targetCamPos.x, y: this._targetCamPos.y, z: this._targetCamPos.z },
      targetCamLookAt: { x: this._targetCamLookAt.x, y: this._targetCamLookAt.y, z: this._targetCamLookAt.z },
      targetCamZ: this._targetCamZ,
      autoFraming: this._autoFraming,
      currentLerpAlpha: this._currentLerpAlpha,
      lastPopulation: this._lastPopulation
    };
  }

  /**
   * Updates multi-avatar horizontal stage positioning, collision avoidance,
   * and dynamic auto-fit group framing.
   *
   * Maps physical tracked position into Three.js stage coordinates with smooth EMA.
   * Computes group bounding box and required camera distance to fit all avatars.
   *
   * @param {Array<Object>} trackedPersons - Surviving tracked persons from PersonTracker
   * @param {'auto'|'multi'|'single'} [trackingMode='auto']
   */
  updateTrackPositions(trackedPersons = [], trackingMode = 'auto') {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const persons = Array.isArray(trackedPersons) ? trackedPersons : [];
    const activePersons = persons.filter(
      p => p && (p.state === 'TRACKED' || p.state === 'INIT' || p.state === 'REACQUIRED' || p.state === 'COASTING')
    );

    const activeAvatars = [];
    for (const p of activePersons) {
      const av = this.trackAvatars.get(p.trackId);
      if (av && av.isLoaded) {
        activeAvatars.push({ person: p, avatar: av });
      }
    }

    const count = activeAvatars.length;
    const cfg = { ...DEFAULT_FRAMING_CONFIG, ...(this._framingConfig || {}) };

    if (!this.defaultCamPos) {
      this.defaultCamPos = new THREE.Vector3(0, 1.28, 1.85);
    }
    if (!this.defaultCamTarget) {
      this.defaultCamTarget = new THREE.Vector3(0, 1.18, 0);
    }
    if (!this._targetCamPos) {
      this._targetCamPos = new THREE.Vector3().copy(this.defaultCamPos);
    }
    if (!this._targetCamLookAt) {
      this._targetCamLookAt = new THREE.Vector3().copy(this.defaultCamTarget);
    }
    if (!this._scratchGroupMin) {
      this._scratchGroupMin = new THREE.Vector3();
      this._scratchGroupMax = new THREE.Vector3();
      this._scratchGroupCenter = new THREE.Vector3();
    }

    // ── Population change detection for hysteresis ──
    if (count !== (this._lastPopulation ?? 0)) {
      const expanding = count > (this._lastPopulation ?? 0);
      this._lastPopulationChangeMs = now;
      this._lastPopulation = count;
      // Use fast alpha for expansion, slow for contraction
      this._currentLerpAlpha = expanding ? cfg.expandLerpAlpha : cfg.contractLerpAlpha;
      this._framingDirty = true;
    }

    // ── Single-Person Mode or Single Avatar active ──
    if (count <= 1 || trackingMode === 'single') {
      const primary = activeAvatars[0]?.avatar || this.primaryAvatar;
      if (primary) {
        primary.visible = true;
        // Smoothly return to center stage (0, 0, 0)
        const curX = primary.stagePosition.x;
        const newX = curX * 0.85; // Exponential decay to 0
        primary.setStagePosition(newX, 0, 0);
      }
      if (trackingMode === 'single') {
        for (let i = 1; i < activeAvatars.length; i++) {
          activeAvatars[i].avatar.visible = false;
        }
      }
      // Single-person framing: return to default camera position
      this._targetCamPos.set(this.defaultCamPos.x, this.defaultCamPos.y, this.defaultCamPos.z);
      this._targetCamLookAt.set(this.defaultCamTarget.x, this.defaultCamTarget.y, this.defaultCamTarget.z);
      this._targetCamZ = this.defaultCamPos.z;
      return;
    }

    // ── Restore visibility for all active avatars in multi / auto mode ──
    for (const item of activeAvatars) {
      item.avatar.visible = true;
    }

    // ── Multi-Avatar Mode: Layout based on physical horizontal position ──
    const SPREAD_FACTOR = 2.4;
    const MIN_SEPARATION = 0.55;

    const items = activeAvatars.map(item => {
      const rawX = (item.person.centroid.x - 0.5) * SPREAD_FACTOR;
      return {
        trackId: item.person.trackId,
        avatar: item.avatar,
        targetX: rawX
      };
    });

    items.sort((a, b) => a.targetX - b.targetX);

    // Collision avoidance relaxation passes (15 passes ensure complete multi-body convergence)
    for (let pass = 0; pass < 15; pass++) {
      for (let i = 0; i < items.length - 1; i++) {
        const a = items[i];
        const b = items[i + 1];
        const dist = b.targetX - a.targetX;
        if (dist < MIN_SEPARATION) {
          const overlap = (MIN_SEPARATION - dist) * 0.5;
          a.targetX -= overlap;
          b.targetX += overlap;
        }
      }
    }

    // Smoothly apply position via EMA
    for (const item of items) {
      const curX = item.avatar.stagePosition.x;
      const smoothedX = curX * 0.82 + item.targetX * 0.18;
      item.avatar.setStagePosition(smoothedX, 0, 0);
    }

    // ── Dynamic Auto-Fit Group Framing ──
    this._computeGroupFraming(items, count, now);
  }

  /**
   * Computes group bounding box and required camera position to fit all avatars.
   * Uses pre-allocated scratch vectors for zero GC pressure.
   * @private
   */
  _computeGroupFraming(items, count, now) {
    const cfg = { ...DEFAULT_FRAMING_CONFIG, ...(this._framingConfig || {}) };

    // Compute group bounding box from avatar stage positions + visual extent
    const gMin = this._scratchGroupMin || new THREE.Vector3();
    const gMax = this._scratchGroupMax || new THREE.Vector3();
    const gCenter = this._scratchGroupCenter || new THREE.Vector3();

    gMin.set(Infinity, Infinity, 0);
    gMax.set(-Infinity, -Infinity, 0);

    for (const item of items) {
      const pos = item.avatar.stagePosition;
      const left = pos.x - cfg.avatarHalfWidth;
      const right = pos.x + cfg.avatarHalfWidth;
      const bottom = pos.y + cfg.avatarBaseY;
      const top = pos.y + cfg.avatarHeight;

      if (left < gMin.x) gMin.x = left;
      if (right > gMax.x) gMax.x = right;
      if (bottom < gMin.y) gMin.y = bottom;
      if (top > gMax.y) gMax.y = top;
    }

    // Group center
    gCenter.x = (gMin.x + gMax.x) * 0.5;
    gCenter.y = (gMin.y + gMax.y) * 0.5;

    // Group extent with safe margins
    const groupWidth = (gMax.x - gMin.x) * (1.0 + cfg.marginLeft + cfg.marginRight);
    const groupHeight = (gMax.y - gMin.y) * (1.0 + cfg.marginTop + cfg.marginBottom);

    // Required camera Z distance to fit group in view frustum
    const fov = this.camera?.fov || 30;
    const fovRad = fov * (Math.PI / 180);
    const aspect = this.camera?.aspect || 1;

    // Distance needed for vertical fit
    const distForHeight = (groupHeight * 0.5) / Math.tan(fovRad * 0.5);
    // Distance needed for horizontal fit
    const distForWidth = (groupWidth * 0.5) / (Math.tan(fovRad * 0.5) * aspect);

    let requiredZ = Math.max(distForHeight, distForWidth);
    requiredZ = Math.max(cfg.minCameraZ, Math.min(cfg.maxCameraZ, requiredZ));

    const defCamY = this.defaultCamPos?.y ?? 1.28;
    const defTgtY = this.defaultCamTarget?.y ?? 1.18;

    // Target camera position: centered on group, at required distance
    const newTargetX = gCenter.x;
    const newTargetY = gCenter.y * 0.5 + defCamY * 0.5; // Blend with default Y
    const newTargetZ = requiredZ;

    // Target look-at: group center vertically, preserve X centering
    const newLookAtX = gCenter.x;
    const newLookAtY = gCenter.y * 0.5 + defTgtY * 0.5;

    // ── Hysteresis: only update if framing change exceeds threshold ──
    const curZ = this._targetCamPos?.z ?? (this.defaultCamPos?.z ?? 0.9);
    const curX = this._targetCamPos?.x ?? (this.defaultCamPos?.x ?? 0);
    const deltaZ = Math.abs(newTargetZ - curZ);
    const deltaX = Math.abs(newTargetX - curX);

    // For contraction, apply delay
    const isContracting = newTargetZ < curZ;
    if (isContracting) {
      const elapsed = now - (this._lastPopulationChangeMs ?? 0);
      if (elapsed < cfg.contractDelayMs) {
        // Don't contract yet — hold current framing
        return;
      }
      this._currentLerpAlpha = cfg.contractLerpAlpha;
    }

    if (deltaZ > cfg.minFramingDelta || deltaX > cfg.minFramingDelta || this._framingDirty) {
      if (!this._targetCamPos) this._targetCamPos = new THREE.Vector3();
      if (!this._targetCamLookAt) this._targetCamLookAt = new THREE.Vector3();
      this._targetCamPos.set(newTargetX, newTargetY, newTargetZ);
      this._targetCamLookAt.set(newLookAtX, newLookAtY, 0);
      this._targetCamZ = newTargetZ;
      this._framingDirty = false;
    }
  }

  resetView() {
    this.camera.position.copy(this.defaultCamPos);
    this.controls.target.copy(this.defaultCamTarget);
    this.controls.update();
  }

  /**
   * Returns live WebGL resource information from Three.js renderer.
   * Used for memory profiling and leak verification.
   */
  getResourceInfo() {
    return {
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      activeAvatars: this.trackAvatars.size || this.avatars.size
    };
  }

  /**
   * Performs a single render pass with the active camera and scene.
   */
  render() {
    if (this.renderer && this.scene && this.camera) {
      const t0 = performance.now();
      this.renderer.render(this.scene, this.camera);
      this.lastRenderMs = performance.now() - t0;
    }
  }

  startRenderLoop() {
    if (this._isLoopRunning) return;
    this._isLoopRunning = true;

    const tick = () => {
      if (!this._isLoopRunning) return;
      requestAnimationFrame(tick);

      const delta = this._clock.getDelta();
      this.controls.update();

      // Camera auto-framing smooth lerp (position + look-at)
      if (this._autoFraming) {
        const alpha = this._currentLerpAlpha || 0.06;
        this.camera.position.x += (this._targetCamPos.x - this.camera.position.x) * alpha;
        this.camera.position.y += (this._targetCamPos.y - this.camera.position.y) * alpha * 0.5;
        this.camera.position.z += (this._targetCamPos.z - this.camera.position.z) * alpha;
        this.controls.target.x += (this._targetCamLookAt.x - this.controls.target.x) * alpha;
        this.controls.target.y += (this._targetCamLookAt.y - this.controls.target.y) * alpha * 0.5;
      }

      // Update VRM spring-bone physics for all active avatars
      const updatedAvatars = new Set();
      for (const avatar of this.trackAvatars.values()) {
        avatar.update(delta);
        updatedAvatars.add(avatar);
      }
      for (const avatar of this.avatars.values()) {
        if (!updatedAvatars.has(avatar)) {
          avatar.update(delta);
        }
      }

      // Single unified render pass for all avatars
      const tRender0 = performance.now();
      this.renderer.render(this.scene, this.camera);
      this.lastRenderMs = performance.now() - tRender0;
      this._trackFps();
    };

    tick();
  }

  stopRenderLoop() {
    this._isLoopRunning = false;
  }

  _trackFps() {
    const now = performance.now();
    const dt = now - this._rfLast;
    this._rfLast = now;
    if (dt <= 0) return;

    const inst = 1000 / dt;
    this._rfSmoothed = this._rfSmoothed ? this._rfSmoothed * 0.9 + inst * 0.1 : inst;
    if (this.onRenderFps) {
      this.onRenderFps(this._rfSmoothed);
    }
  }

  dispose() {
    this.stopRenderLoop();
    window.removeEventListener('resize', this._resizeHandler);

    // Dispose all active avatars
    for (const avatar of this.trackAvatars.values()) {
      if (avatar.vrm?.scene) {
        this.scene.remove(avatar.vrm.scene);
      }
      avatar.dispose();
    }
    this.trackAvatars.clear();

    for (const avatar of this.avatars.values()) {
      if (avatar.vrm?.scene) {
        this.scene.remove(avatar.vrm.scene);
      }
      avatar.dispose();
    }
    this.avatars.clear();
    this.primaryAvatar = null;

    this.controls.dispose();
    this.renderer.dispose();
  }
}
