/**
 * cameraNavigator.js — 3D Camera Navigator Widget
 *
 * Pure HTML/SVG/CSS compact widget for controlling the 3D camera.
 * Provides draggable target box, orbit/target modes, zoom, auto/manual toggle.
 * Zero WebGL — uses pointer events on SVG minimap.
 *
 * Reads/writes to cameraState. StageManager reads cameraState during render loop.
 */

import { cameraState } from './cameraState.js';

// ── SVG Avatar Silhouette (lightweight static path) ──
const AVATAR_SILHOUETTE_SVG = `
  <ellipse cx="90" cy="28" rx="16" ry="18" fill="none" stroke="rgba(79,209,197,0.25)" stroke-width="1.5"/>
  <path d="M90 46 L90 95 M70 65 L110 65 M90 95 L72 130 M90 95 L108 130"
        stroke="rgba(79,209,197,0.2)" stroke-width="1.5" fill="none" stroke-linecap="round"/>
`;

export class CameraNavigator {
  /**
   * @param {HTMLElement} container - The element to mount the navigator into
   * @param {Object} stageManager - Reference to StageManager for head bone access
   */
  constructor(container, stageManager) {
    this._container = container;
    this._stageManager = stageManager;
    this._interactionMode = 'TARGET'; // 'TARGET' | 'ORBIT'
    this._isDragging = false;
    this._dragStartX = 0;
    this._dragStartY = 0;
    this._dragStartValX = 0;
    this._dragStartValY = 0;

    // Bind methods for event listener cleanup
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);

    this._buildUI();
    this._attachEvents();

    // Listen for mode changes to update pill
    cameraState._onModeChange = (mode) => this._updateModePill(mode);
  }

  _buildUI() {
    const el = this._container;
    el.className = 'cam-nav';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Camera Navigator — drag target box or use arrow keys');
    el.setAttribute('tabindex', '0');

    el.innerHTML = `
      <div class="cam-nav-header">
        <span class="cam-nav-title">CAMERA</span>
        <span class="cam-nav-mode-pill" id="camNavModePill">AUTO</span>
      </div>
      <div class="cam-nav-minimap" id="camNavMinimap">
        <svg viewBox="0 0 180 140" class="cam-nav-svg" id="camNavSvg">
          <!-- Avatar silhouette -->
          ${AVATAR_SILHOUETTE_SVG}
          <!-- Draggable target box -->
          <rect id="camNavTargetBox" class="cam-nav-target-box"
                x="55" y="10" width="70" height="55"
                rx="4" ry="4"/>
        </svg>
      </div>
      <div class="cam-nav-mode-toggle">
        <button class="cam-nav-mode-btn active" id="camNavTargetBtn" aria-label="Target mode">TARGET</button>
        <button class="cam-nav-mode-btn" id="camNavOrbitBtn" aria-label="Orbit mode">ORBIT</button>
      </div>
      <div class="cam-nav-zoom-row">
        <span class="cam-nav-zoom-label">Zoom</span>
        <input type="range" id="camNavZoom" class="cam-nav-zoom-slider"
               min="30" max="300" value="100" step="5"
               aria-label="Camera zoom">
      </div>
      <div class="cam-nav-actions">
        <button class="cam-nav-action-btn" id="camNavFocusBtn" aria-label="Focus on avatar head">Focus</button>
        <button class="cam-nav-action-btn cam-nav-reset-btn" id="camNavResetBtn" aria-label="Reset camera to default">⟳ Reset</button>
      </div>
    `;

    // Cache DOM refs
    this._modePill = el.querySelector('#camNavModePill');
    this._minimap = el.querySelector('#camNavMinimap');
    this._svg = el.querySelector('#camNavSvg');
    this._targetBox = el.querySelector('#camNavTargetBox');
    this._targetBtn = el.querySelector('#camNavTargetBtn');
    this._orbitBtn = el.querySelector('#camNavOrbitBtn');
    this._zoomSlider = el.querySelector('#camNavZoom');
    this._focusBtn = el.querySelector('#camNavFocusBtn');
    this._resetBtn = el.querySelector('#camNavResetBtn');
  }

  _attachEvents() {
    // Target box drag
    this._targetBox.addEventListener('pointerdown', (e) => this._onPointerDown(e));

    // Mode toggle buttons
    this._targetBtn.addEventListener('click', () => this._setInteractionMode('TARGET'));
    this._orbitBtn.addEventListener('click', () => this._setInteractionMode('ORBIT'));

    // Zoom slider
    this._zoomSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10) / 100;
      cameraState.zoom = cameraState._clampZoom(val);
      cameraState.setManual();
    });

    // Focus button
    this._focusBtn.addEventListener('click', () => this._focusOnHead());

    // Reset button
    this._resetBtn.addEventListener('click', () => {
      cameraState.reset();
      this._zoomSlider.value = 100;
      this._updateTargetBoxPosition();
    });

    // Keyboard controls
    this._container.addEventListener('keydown', this._onKeyDown);
  }

  // ── Interaction Mode ──
  _setInteractionMode(mode) {
    this._interactionMode = mode;
    this._targetBtn.classList.toggle('active', mode === 'TARGET');
    this._orbitBtn.classList.toggle('active', mode === 'ORBIT');
  }

  // ── Mode Pill Update ──
  _updateModePill(mode) {
    if (this._modePill) {
      this._modePill.textContent = mode;
      this._modePill.classList.toggle('manual', mode === 'MANUAL');
    }
  }

  // ── Pointer Drag (target box) ──
  _onPointerDown(e) {
    e.preventDefault();
    e.stopPropagation();
    this._isDragging = true;
    this._dragStartX = e.clientX;
    this._dragStartY = e.clientY;

    if (this._interactionMode === 'TARGET') {
      this._dragStartValX = cameraState.targetX;
      this._dragStartValY = cameraState.targetY;
    } else {
      this._dragStartValX = cameraState.orbitYaw;
      this._dragStartValY = cameraState.orbitPitch;
    }

    this._targetBox.classList.add('dragging');
    this._targetBox.setPointerCapture(e.pointerId);

    document.addEventListener('pointermove', this._onPointerMove);
    document.addEventListener('pointerup', this._onPointerUp);
  }

  _onPointerMove(e) {
    if (!this._isDragging) return;
    e.preventDefault();

    const dx = e.clientX - this._dragStartX;
    const dy = e.clientY - this._dragStartY;

    // Scale pixel movement to world/angle values
    const minimapRect = this._minimap.getBoundingClientRect();
    const scaleX = (cameraState.MAX_TARGET_X - cameraState.MIN_TARGET_X) / minimapRect.width;
    const scaleY = (cameraState.MAX_TARGET_Y - cameraState.MIN_TARGET_Y) / minimapRect.height;

    if (this._interactionMode === 'TARGET') {
      // Horizontal → targetX, Vertical → targetY (inverted Y for screen coords)
      cameraState.targetX = cameraState._clampTargetX(this._dragStartValX + dx * scaleX);
      cameraState.targetY = cameraState._clampTargetY(this._dragStartValY - dy * scaleY);
    } else {
      // ORBIT: Horizontal → yaw, Vertical → pitch
      const yawScale = (cameraState.MAX_YAW - cameraState.MIN_YAW) / minimapRect.width;
      const pitchScale = (cameraState.MAX_PITCH - cameraState.MIN_PITCH) / minimapRect.height;
      cameraState.orbitYaw = cameraState._clampYaw(this._dragStartValX + dx * yawScale);
      cameraState.orbitPitch = cameraState._clampPitch(this._dragStartValY - dy * pitchScale);
    }

    cameraState.setManual();
    this._updateTargetBoxPosition();
  }

  _onPointerUp(e) {
    this._isDragging = false;
    this._targetBox.classList.remove('dragging');
    document.removeEventListener('pointermove', this._onPointerMove);
    document.removeEventListener('pointerup', this._onPointerUp);
  }

  // ── Update target box SVG position from cameraState ──
  _updateTargetBoxPosition() {
    if (!this._targetBox) return;

    // Map world-space target to minimap SVG coords
    const svgWidth = 180;
    const svgHeight = 140;
    const boxW = 70;
    const boxH = 55;

    // Normalized position [0,1]
    const normX = (cameraState.targetX - cameraState.MIN_TARGET_X) /
                  (cameraState.MAX_TARGET_X - cameraState.MIN_TARGET_X);
    const normY = 1.0 - (cameraState.targetY - cameraState.MIN_TARGET_Y) /
                  (cameraState.MAX_TARGET_Y - cameraState.MIN_TARGET_Y);

    // SVG coordinates (constrained)
    const maxX = svgWidth - boxW;
    const maxY = svgHeight - boxH;
    const svgX = Math.max(0, Math.min(maxX, normX * maxX));
    const svgY = Math.max(0, Math.min(maxY, normY * maxY));

    this._targetBox.setAttribute('x', svgX.toFixed(1));
    this._targetBox.setAttribute('y', svgY.toFixed(1));
  }

  // ── Focus on Head ──
  _focusOnHead() {
    if (!this._stageManager) return;

    const primary = this._stageManager.primaryAvatar;
    if (primary && primary.headBone) {
      // Get head bone world position
      const worldPos = primary.headBone.getWorldPosition(
        new (window.THREE?.Vector3 || function() { this.x = 0; this.y = 1.5; this.z = 0; })()
      );
      cameraState.targetX = cameraState._clampTargetX(worldPos.x || 0);
      cameraState.targetY = cameraState._clampTargetY(worldPos.y || 1.5);
      cameraState.targetZ = worldPos.z || 0;
      cameraState.zoom = cameraState._clampZoom(0.6); // Close-up
      cameraState.setManual();
      this._zoomSlider.value = Math.round(cameraState.zoom * 100);
      this._updateTargetBoxPosition();
    } else {
      // Fallback: target approximate head position
      cameraState.targetX = 0;
      cameraState.targetY = 1.55;
      cameraState.targetZ = 0;
      cameraState.zoom = cameraState._clampZoom(0.6);
      cameraState.setManual();
      this._zoomSlider.value = Math.round(cameraState.zoom * 100);
      this._updateTargetBoxPosition();
    }
  }

  // ── Keyboard Controls ──
  _onKeyDown(e) {
    // Don't intercept when input/select/textarea is focused
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    // Only handle when navigator itself is focused
    if (!this._container.contains(document.activeElement) &&
        document.activeElement !== this._container) return;

    const STEP_TARGET = 0.08;
    const STEP_ORBIT = 0.06;
    const STEP_ZOOM = 0.1;

    let handled = false;

    if (this._interactionMode === 'TARGET') {
      switch (e.key) {
        case 'ArrowLeft':
          cameraState.targetX = cameraState._clampTargetX(cameraState.targetX - STEP_TARGET);
          handled = true;
          break;
        case 'ArrowRight':
          cameraState.targetX = cameraState._clampTargetX(cameraState.targetX + STEP_TARGET);
          handled = true;
          break;
        case 'ArrowUp':
          cameraState.targetY = cameraState._clampTargetY(cameraState.targetY + STEP_TARGET);
          handled = true;
          break;
        case 'ArrowDown':
          cameraState.targetY = cameraState._clampTargetY(cameraState.targetY - STEP_TARGET);
          handled = true;
          break;
      }
    } else {
      // ORBIT mode
      switch (e.key) {
        case 'ArrowLeft':
          cameraState.orbitYaw = cameraState._clampYaw(cameraState.orbitYaw - STEP_ORBIT);
          handled = true;
          break;
        case 'ArrowRight':
          cameraState.orbitYaw = cameraState._clampYaw(cameraState.orbitYaw + STEP_ORBIT);
          handled = true;
          break;
        case 'ArrowUp':
          cameraState.orbitPitch = cameraState._clampPitch(cameraState.orbitPitch + STEP_ORBIT);
          handled = true;
          break;
        case 'ArrowDown':
          cameraState.orbitPitch = cameraState._clampPitch(cameraState.orbitPitch - STEP_ORBIT);
          handled = true;
          break;
      }
    }

    // Zoom + reset (both modes)
    switch (e.key) {
      case '+': case '=':
        cameraState.zoom = cameraState._clampZoom(cameraState.zoom - STEP_ZOOM);
        this._zoomSlider.value = Math.round(cameraState.zoom * 100);
        handled = true;
        break;
      case '-': case '_':
        cameraState.zoom = cameraState._clampZoom(cameraState.zoom + STEP_ZOOM);
        this._zoomSlider.value = Math.round(cameraState.zoom * 100);
        handled = true;
        break;
      case 'r': case 'R':
        cameraState.reset();
        this._zoomSlider.value = 100;
        this._updateTargetBoxPosition();
        handled = true;
        break;
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      cameraState.setManual();
      this._updateTargetBoxPosition();
    }
  }

  /**
   * Update the silhouette/target position to reflect current camera state.
   * Called externally if needed (e.g., when StageManager changes auto-framing target).
   */
  syncFromState() {
    this._updateTargetBoxPosition();
    this._updateModePill(cameraState.mode);
    this._zoomSlider.value = Math.round(cameraState.zoom * 100);
  }

  dispose() {
    this._container.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('pointermove', this._onPointerMove);
    document.removeEventListener('pointerup', this._onPointerUp);
    cameraState._onModeChange = null;
  }
}
