/**
 * cameraState.js — Lightweight Camera State Object for the 3D Camera Navigator.
 *
 * Holds desired camera parameters. The CameraNavigator UI writes to this,
 * and StageManager reads from it during the render loop to apply smooth lerp.
 *
 * Separate from tracking state — never stored inside PersonTracker.
 */

const DEFAULT_TARGET_X = 0;
const DEFAULT_TARGET_Y = 1.18;
const DEFAULT_TARGET_Z = 0;
const DEFAULT_ORBIT_YAW = 0;
const DEFAULT_ORBIT_PITCH = 0;
const DEFAULT_ZOOM = 1.0;
const DEFAULT_CAM_DISTANCE = 1.85;

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3.0;
const MIN_PITCH = -0.6;   // ~-34° down
const MAX_PITCH = 0.5;    // ~29° up
const MIN_YAW = -Math.PI * 0.6;
const MAX_YAW = Math.PI * 0.6;

// Target bounds (world-space approximate range)
const MIN_TARGET_X = -2.0;
const MAX_TARGET_X = 2.0;
const MIN_TARGET_Y = 0.2;
const MAX_TARGET_Y = 2.2;

export const cameraState = {
  /** @type {'AUTO'|'MANUAL'} */
  mode: 'AUTO',

  // Camera look-at target
  targetX: DEFAULT_TARGET_X,
  targetY: DEFAULT_TARGET_Y,
  targetZ: DEFAULT_TARGET_Z,

  // Orbit angles (radians)
  orbitYaw: DEFAULT_ORBIT_YAW,
  orbitPitch: DEFAULT_ORBIT_PITCH,

  // Zoom multiplier on base distance
  zoom: DEFAULT_ZOOM,

  // Base camera distance (from StageManager defaults)
  baseCamDistance: DEFAULT_CAM_DISTANCE,

  // Listener callback (called when mode changes)
  _onModeChange: null,

  /** Clamp helpers */
  _clampZoom(v) {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v));
  },
  _clampYaw(v) {
    return Math.max(MIN_YAW, Math.min(MAX_YAW, v));
  },
  _clampPitch(v) {
    return Math.max(MIN_PITCH, Math.min(MAX_PITCH, v));
  },
  _clampTargetX(v) {
    return Math.max(MIN_TARGET_X, Math.min(MAX_TARGET_X, v));
  },
  _clampTargetY(v) {
    return Math.max(MIN_TARGET_Y, Math.min(MAX_TARGET_Y, v));
  },

  /**
   * Switch to MANUAL mode. Called on first user interaction.
   */
  setManual() {
    if (this.mode !== 'MANUAL') {
      this.mode = 'MANUAL';
      if (this._onModeChange) this._onModeChange('MANUAL');
    }
  },

  /**
   * Switch to AUTO mode. StageManager resumes dynamic framing.
   */
  setAuto() {
    if (this.mode !== 'AUTO') {
      this.mode = 'AUTO';
      this.orbitYaw = DEFAULT_ORBIT_YAW;
      this.orbitPitch = DEFAULT_ORBIT_PITCH;
      this.zoom = DEFAULT_ZOOM;
      if (this._onModeChange) this._onModeChange('AUTO');
    }
  },

  /**
   * Reset all values to defaults and return to AUTO.
   */
  reset() {
    this.mode = 'AUTO';
    this.targetX = DEFAULT_TARGET_X;
    this.targetY = DEFAULT_TARGET_Y;
    this.targetZ = DEFAULT_TARGET_Z;
    this.orbitYaw = DEFAULT_ORBIT_YAW;
    this.orbitPitch = DEFAULT_ORBIT_PITCH;
    this.zoom = DEFAULT_ZOOM;
    if (this._onModeChange) this._onModeChange('AUTO');
  },

  /**
   * Computes desired camera position from orbit angles + zoom + target.
   * @returns {{ x: number, y: number, z: number }}
   */
  getDesiredCamPos() {
    const dist = this.baseCamDistance * this.zoom;
    const yaw = this.orbitYaw;
    const pitch = this.orbitPitch;
    return {
      x: this.targetX + Math.sin(yaw) * dist * Math.cos(pitch),
      y: this.targetY + Math.sin(pitch) * dist * 0.5 + 0.1,
      z: this.targetZ + Math.cos(yaw) * dist * Math.cos(pitch)
    };
  },

  /**
   * Returns desired camera look-at target.
   * @returns {{ x: number, y: number, z: number }}
   */
  getDesiredCamTarget() {
    return {
      x: this.targetX,
      y: this.targetY,
      z: this.targetZ
    };
  },

  /** Constants exposed for UI bounds */
  MIN_ZOOM,
  MAX_ZOOM,
  MIN_TARGET_X,
  MAX_TARGET_X,
  MIN_TARGET_Y,
  MAX_TARGET_Y,
  MIN_YAW,
  MAX_YAW,
  MIN_PITCH,
  MAX_PITCH,
  DEFAULT_TARGET_Y,
  DEFAULT_TARGET_X,
  DEFAULT_ZOOM
};
