/**
 * multiPersonHud.js — Real-Time Multi-Person Tracking HUD & Stage Overlay.
 *
 * CRITICAL ARCHITECTURAL ROLE:
 * Real-time presentation layer communicating:
 * - Active tracked people count vs maximum capacity
 * - Persistent physical TrackIDs (TrackID is identity, NEVER MediaPipe index)
 * - Assigned 3D VRM Avatar names (Hana, Yuki, etc.)
 * - Tracking states: TRACKED, COASTING, REACQUIRED, WAITING_FOR_UNIQUE_AVATAR, INIT
 * - Telemetry footprints (Face, Pose, Hands)
 * - Global configuration: Tracking Mode (Auto/Multi/Single), FPS, Tier, Toggles
 *
 * PERFORMANCE DESIGN:
 * - Pre-allocates a pool of 8 person card DOM nodes on initialization.
 * - In-place updates of textContent and classList — zero per-frame DOM creation/destruction.
 * - Zero layout thrashing, zero GC churn, zero external network dependencies.
 */

import { avatarRegistry } from '../library/avatarRegistry.js';
import { ASSIGNMENT_STATE } from '../tracking/avatarAssignmentManager.js';

export const HUD_STATE = {
  TRACKED: 'TRACKED',
  INIT: 'INIT',
  COASTING: 'COASTING',
  REACQUIRED: 'REACQUIRED',
  WAITING: 'WAITING_FOR_UNIQUE_AVATAR'
};

export class MultiPersonHUD {
  /**
   * @param {Object} [options]
   * @param {HTMLElement} [options.container] - Target container element for the HUD
   * @param {number} [options.maxCards=8] - Maximum card pool capacity
   */
  constructor(options = {}) {
    this.container = options.container || document.getElementById('stageHudOverlay');
    this.maxCards = options.maxCards || 8;

    /** @type {Map<number, HTMLElement>} Cached card elements keyed by pool index */
    this._cardPool = [];
    
    /** @type {HTMLElement|null} Global status bar element */
    this._globalStatusEl = null;
    
    /** @type {HTMLElement|null} Cards container element */
    this._cardsContainer = null;
    
    /** @type {HTMLElement|null} Single-person compact bar */
    this._singlePersonBar = null;

    /** Current tracking mode */
    this._trackingMode = 'auto';

    /** Previous active count for detecting transitions */
    this._prevActiveCount = 0;

    if (this.container) {
      this._initDOM();
    }
  }

  /**
   * Bind to an existing container if not provided at construction.
   * @param {HTMLElement} container 
   */
  bindContainer(container) {
    this.container = container;
    this._initDOM();
  }

  /**
   * Builds the pre-allocated DOM pool inside container.
   * @private
   */
  _initDOM() {
    if (!this.container) return;
    this.container.innerHTML = '';

    // 1. Global Top HUD Bar
    this._globalStatusEl = document.createElement('div');
    this._globalStatusEl.className = 'hud-global-bar';
    this._globalStatusEl.setAttribute('role', 'status');

    const globalLeft = document.createElement('div');
    globalLeft.className = 'hud-global-left';
    
    const liveDot = document.createElement('span');
    liveDot.className = 'hud-live-dot';
    liveDot.setAttribute('aria-hidden', 'true');
    globalLeft.appendChild(liveDot);

    const modePill = document.createElement('span');
    modePill.className = 'hud-mode-pill';
    modePill.id = 'hudModePill';
    modePill.textContent = 'AUTO';
    globalLeft.appendChild(modePill);

    const popPill = document.createElement('span');
    popPill.className = 'hud-population-pill';
    popPill.id = 'hudPopulationPill';
    popPill.textContent = '0 TRACKED';
    globalLeft.appendChild(popPill);

    const globalRight = document.createElement('div');
    globalRight.className = 'hud-global-right';

    const tierTag = document.createElement('span');
    tierTag.className = 'hud-metric-tag';
    tierTag.id = 'hudTierTag';
    tierTag.textContent = 'HIGH TIER';
    globalRight.appendChild(tierTag);

    const fpsTag = document.createElement('span');
    fpsTag.className = 'hud-metric-tag';
    fpsTag.id = 'hudFpsTag';
    fpsTag.textContent = '-- FPS';
    globalRight.appendChild(fpsTag);

    const bodyTag = document.createElement('span');
    bodyTag.className = 'hud-toggle-tag';
    bodyTag.id = 'hudBodyTag';
    bodyTag.textContent = 'BODY ON';
    globalRight.appendChild(bodyTag);

    const handTag = document.createElement('span');
    handTag.className = 'hud-toggle-tag';
    handTag.id = 'hudHandTag';
    handTag.textContent = 'HANDS ON';
    globalRight.appendChild(handTag);

    this._globalStatusEl.appendChild(globalLeft);
    this._globalStatusEl.appendChild(globalRight);
    this.container.appendChild(this._globalStatusEl);

    // 2. Single-Person Compact Indicator Bar
    this._singlePersonBar = document.createElement('div');
    this._singlePersonBar.className = 'hud-single-bar';
    this._singlePersonBar.id = 'hudSingleBar';
    this._singlePersonBar.style.display = 'none';

    const singleDot = document.createElement('span');
    singleDot.className = 'hud-single-dot';
    this._singlePersonBar.appendChild(singleDot);

    const singleTitle = document.createElement('span');
    singleTitle.className = 'hud-single-title';
    singleTitle.textContent = 'Person 1 · Track #1';
    this._singlePersonBar.appendChild(singleTitle);

    const singleAvatar = document.createElement('span');
    singleAvatar.className = 'hud-single-avatar';
    singleAvatar.textContent = 'Hana';
    this._singlePersonBar.appendChild(singleAvatar);

    const singleState = document.createElement('span');
    singleState.className = 'hud-single-state status-tracked';
    singleState.textContent = 'TRACKED';
    this._singlePersonBar.appendChild(singleState);

    this.container.appendChild(this._singlePersonBar);

    // 3. Multi-Person Cards Deck (Pre-allocated pool of cards)
    this._cardsContainer = document.createElement('div');
    this._cardsContainer.className = 'hud-cards-deck';
    this._cardsContainer.setAttribute('role', 'region');
    this._cardsContainer.setAttribute('aria-label', 'Active Tracked Persons');

    this._cardPool = [];

    for (let i = 0; i < this.maxCards; i++) {
      const card = document.createElement('div');
      card.className = 'hud-person-card';
      card.id = `hud-card-${i}`;
      card.style.display = 'none';

      // Header
      const header = document.createElement('div');
      header.className = 'hud-card-header';

      const ident = document.createElement('div');
      ident.className = 'hud-person-ident';

      const personLabelEl = document.createElement('span');
      personLabelEl.className = 'hud-person-label';
      personLabelEl.textContent = `Person ${i + 1}`;
      ident.appendChild(personLabelEl);

      const trackIdEl = document.createElement('span');
      trackIdEl.className = 'hud-track-id';
      trackIdEl.textContent = 'Track #--';
      ident.appendChild(trackIdEl);

      header.appendChild(ident);

      const badgeEl = document.createElement('span');
      badgeEl.className = 'hud-card-badge status-tracked';
      badgeEl.textContent = 'TRACKED';
      header.appendChild(badgeEl);

      card.appendChild(header);

      // Body
      const body = document.createElement('div');
      body.className = 'hud-card-body';

      const avatarRow = document.createElement('div');
      avatarRow.className = 'hud-avatar-row';

      const icon = document.createElement('span');
      icon.className = 'hud-avatar-icon';
      icon.textContent = '🎭';
      avatarRow.appendChild(icon);

      const avatarNameEl = document.createElement('span');
      avatarNameEl.className = 'hud-avatar-name';
      avatarNameEl.textContent = 'Hana';
      avatarRow.appendChild(avatarNameEl);

      body.appendChild(avatarRow);

      const waitingNoticeEl = document.createElement('div');
      waitingNoticeEl.className = 'hud-waiting-notice';
      waitingNoticeEl.style.display = 'none';
      waitingNoticeEl.textContent = 'Waiting for unique avatar — identity retained';
      body.appendChild(waitingNoticeEl);

      card.appendChild(body);

      // Footer
      const footer = document.createElement('div');
      footer.className = 'hud-card-footer';

      const fpFaceEl = document.createElement('span');
      fpFaceEl.className = 'hud-footprint-tag fp-face active';
      fpFaceEl.textContent = 'Face ✓';
      footer.appendChild(fpFaceEl);

      const fpPoseEl = document.createElement('span');
      fpPoseEl.className = 'hud-footprint-tag fp-pose active';
      fpPoseEl.textContent = 'Pose ✓';
      footer.appendChild(fpPoseEl);

      const fpHandsEl = document.createElement('span');
      fpHandsEl.className = 'hud-footprint-tag fp-hands active';
      fpHandsEl.textContent = 'Hands (0)';
      footer.appendChild(fpHandsEl);

      card.appendChild(footer);
      this._cardsContainer.appendChild(card);

      this._cardPool.push({
        element: card,
        trackIdEl,
        personLabelEl,
        badgeEl,
        avatarNameEl,
        waitingNoticeEl,
        fpFaceEl,
        fpPoseEl,
        fpHandsEl
      });
    }

    this.container.appendChild(this._cardsContainer);
  }

  /**
   * Main real-time update method invoked each tracking loop iteration.
   * Performs zero DOM allocations — updates cached properties in-place.
   *
   * @param {Array<Object>} trackedPersons - Surviving person tracks from PersonTracker
   * @param {Object} assignmentManager - AvatarAssignmentManager instance
   * @param {Object} [options]
   * @param {string} [options.trackingMode='auto'] - 'auto' | 'multi' | 'single'
   * @param {number} [options.maxPeople=4] - Configured max capacity
   * @param {Object} [options.telemetry] - PerformanceManager telemetry
   * @param {boolean} [options.bodyTracking=true]
   * @param {boolean} [options.handTracking=true]
   */
  update(trackedPersons = [], assignmentManager = null, options = {}) {
    if (!this.container) return;

    const trackingMode = options.trackingMode || this._trackingMode;
    const maxPeople = options.maxPeople || 4;
    const bodyTracking = options.bodyTracking !== false;
    const handTracking = options.handTracking !== false;
    const telemetry = options.telemetry || null;

    // Filter non-terminated tracks (exclude TERMINATED tracks)
    const activeTracks = (trackedPersons || []).filter(p => p && p.state !== 'TERMINATED');
    const activeCount = activeTracks.length;

    // 1. Update Global Status Bar
    this._updateGlobalBar(activeCount, maxPeople, trackingMode, telemetry, bodyTracking, handTracking);

    // 2. Mode-dependent display adaptation:
    // In SINGLE mode: Show only the primary track
    // In AUTO mode: If 1 person, use compact representation; if 2+ people, use expanded deck
    // In MULTI mode: Always use expanded deck (or empty idle message if 0)
    const useSingleCompact = (trackingMode === 'single' && activeCount > 0) ||
                             (trackingMode === 'auto' && activeCount === 1);

    if (useSingleCompact && activeTracks.length > 0) {
      this._renderSingleCompact(activeTracks[0], assignmentManager, options);
      if (this._cardsContainer) this._cardsContainer.style.display = 'none';
      if (this._singlePersonBar) this._singlePersonBar.style.display = 'flex';
      // Hide card pool
      for (let i = 0; i < this.maxCards; i++) {
        this._cardPool[i].element.style.display = 'none';
      }
    } else {
      if (this._singlePersonBar) this._singlePersonBar.style.display = 'none';
      if (this._cardsContainer) this._cardsContainer.style.display = activeCount > 0 ? 'flex' : 'none';
      this._renderMultiDeck(activeTracks, assignmentManager, options);
    }

    this._prevActiveCount = activeCount;
  }

  /**
   * Updates global top HUD bar telemetry.
   * @private
   */
  _updateGlobalBar(activeCount, maxPeople, mode, telemetry, bodyOn, handOn) {
    const modeEl = document.getElementById('hudModePill');
    const popEl = document.getElementById('hudPopulationPill');
    const tierEl = document.getElementById('hudTierTag');
    const fpsEl = document.getElementById('hudFpsTag');
    const bodyEl = document.getElementById('hudBodyTag');
    const handEl = document.getElementById('hudHandTag');

    if (modeEl) {
      modeEl.textContent = mode.toUpperCase();
      modeEl.className = `hud-mode-pill mode-${mode}`;
    }

    if (popEl) {
      popEl.textContent = `${activeCount} / ${maxPeople} ACTIVE`;
      popEl.classList.toggle('pop-full', activeCount >= maxPeople);
    }

    if (tierEl && telemetry) {
      tierEl.textContent = `${telemetry.tier} TIER`;
      tierEl.className = `hud-metric-tag tier-${(telemetry.tier || 'HIGH').toLowerCase()}`;
    }

    if (fpsEl && telemetry) {
      fpsEl.textContent = `${telemetry.actualFps || '--'} FPS`;
    }

    if (bodyEl) {
      bodyEl.textContent = bodyOn ? 'BODY ON' : 'BODY OFF';
      bodyEl.className = `hud-toggle-tag ${bodyOn ? 'toggle-on' : 'toggle-off'}`;
    }

    if (handEl) {
      handEl.textContent = handOn ? 'HANDS ON' : 'HANDS OFF';
      handEl.className = `hud-toggle-tag ${handOn ? 'toggle-on' : 'toggle-off'}`;
    }
  }

  /**
   * Renders the single-person compact indicator bar.
   * @private
   */
  _renderSingleCompact(person, assignmentManager, options = {}) {
    if (!this._singlePersonBar) return;
    const titleEl = this._singlePersonBar.querySelector('.hud-single-title');
    const avatarEl = this._singlePersonBar.querySelector('.hud-single-avatar');
    const stateEl = this._singlePersonBar.querySelector('.hud-single-state');

    const avatarId = assignmentManager ? assignmentManager.getAvatarIdForTrack(person.trackId) : null;
    const assignmentState = assignmentManager ? assignmentManager.getAssignmentStateForTrack(person.trackId) : null;
    const avatarName = avatarId ? (avatarRegistry.get(avatarId)?.name || avatarId) : 'Waiting for avatar';

    if (titleEl) titleEl.textContent = `Track #${person.trackId} ·`;
    if (avatarEl) avatarEl.textContent = `${avatarName}`;

    if (stateEl) {
      this._applyStateBadge(stateEl, person.state, assignmentState);
    }
  }

  /**
   * Renders the multi-person cards deck using the pre-allocated pool.
   * @private
   */
  _renderMultiDeck(activeTracks, assignmentManager, options = {}) {
    const count = Math.min(activeTracks.length, this.maxCards);
    const handTracking = options.handTracking !== false;
    const isHandSkipped = options.isHandSkipped === true;

    for (let i = 0; i < this.maxCards; i++) {
      const card = this._cardPool[i];
      if (i < count) {
        const person = activeTracks[i];
        card.element.style.display = 'flex';

        // Identity: Person N + persistent TrackID
        card.personLabelEl.textContent = `Person ${i + 1}`;
        card.trackIdEl.textContent = `Track #${person.trackId}`;

        // Avatar Assignment & Waiting Status
        const avatarId = assignmentManager ? assignmentManager.getAvatarIdForTrack(person.trackId) : null;
        const assignmentState = assignmentManager ? assignmentManager.getAssignmentStateForTrack(person.trackId) : null;

        if (assignmentState === ASSIGNMENT_STATE.WAITING_FOR_UNIQUE_AVATAR || !avatarId) {
          card.avatarNameEl.textContent = 'Waiting for unique avatar';
          card.avatarNameEl.classList.add('waiting');
          card.waitingNoticeEl.style.display = 'block';
          card.element.classList.add('card-waiting');
        } else {
          const avatarDef = avatarRegistry.get(avatarId);
          const avName = avatarDef ? avatarDef.name : avatarId;
          card.avatarNameEl.textContent = avName;
          card.avatarNameEl.classList.remove('waiting');
          card.waitingNoticeEl.style.display = 'none';
          card.element.classList.remove('card-waiting');
        }

        // Tracking State Badge
        this._applyStateBadge(card.badgeEl, person.state, assignmentState);

        // Card Container State Styling (Coasting, Reacquired, Tracked)
        card.element.classList.toggle('card-coasting', person.state === 'COASTING');
        card.element.classList.toggle('card-reacquired', person.state === 'REACQUIRED');

        // Footprint Presence Indicators
        const hasFace = !!(person.face && person.face.landmarks && person.face.landmarks.length > 0);
        const hasPose = !!(person.pose && person.pose.landmarks && person.pose.landmarks.length > 0);
        const handCount = person.hands ? person.hands.length : 0;

        card.fpFaceEl.className = `hud-footprint-tag fp-face ${hasFace ? 'active' : 'inactive'}`;
        card.fpFaceEl.textContent = hasFace ? 'Face ✓' : 'Face --';

        card.fpPoseEl.className = `hud-footprint-tag fp-pose ${hasPose ? 'active' : 'inactive'}`;
        card.fpPoseEl.textContent = hasPose ? 'Pose ✓' : 'Pose --';

        if (!handTracking) {
          card.fpHandsEl.className = 'hud-footprint-tag fp-hands inactive';
          card.fpHandsEl.textContent = 'Hands OFF';
        } else if (isHandSkipped) {
          card.fpHandsEl.className = `hud-footprint-tag fp-hands ${handCount > 0 ? 'active' : 'inactive'}`;
          card.fpHandsEl.textContent = handCount > 0 ? `Hands (${handCount} cached)` : 'Hands (cached)';
        } else {
          card.fpHandsEl.className = `hud-footprint-tag fp-hands ${handCount > 0 ? 'active' : 'inactive'}`;
          card.fpHandsEl.textContent = handCount > 0 ? `Hands (${handCount})` : 'Hands: 0 detected';
        }
      } else {
        // Hide unused pool card
        card.element.style.display = 'none';
      }
    }
  }

  /**
   * Helper to format and apply badge styling.
   * @private
   */
  _applyStateBadge(badgeEl, trackingState, assignmentState) {
    if (!badgeEl) return;

    if (assignmentState === ASSIGNMENT_STATE.WAITING_FOR_UNIQUE_AVATAR) {
      badgeEl.textContent = trackingState === 'COASTING' ? 'COASTING · WAITING' : 'WAITING FOR AVATAR';
      badgeEl.className = 'hud-card-badge status-waiting';
      return;
    }

    switch (trackingState) {
      case 'COASTING':
        badgeEl.textContent = 'COASTING (OCCLUDED)';
        badgeEl.className = 'hud-card-badge status-coasting';
        break;
      case 'REACQUIRED':
        badgeEl.textContent = 'REACQUIRED';
        badgeEl.className = 'hud-card-badge status-reacquired';
        break;
      case 'INIT':
        badgeEl.textContent = 'INITIALIZING';
        badgeEl.className = 'hud-card-badge status-init';
        break;
      case 'TRACKED':
      default:
        badgeEl.textContent = 'TRACKED';
        badgeEl.className = 'hud-card-badge status-tracked';
        break;
    }
  }

  /**
   * Cleanly reset HUD display to empty/idle.
   */
  reset() {
    if (this._singlePersonBar) this._singlePersonBar.style.display = 'none';
    if (this._cardsContainer) this._cardsContainer.style.display = 'none';
    for (let i = 0; i < this.maxCards; i++) {
      if (this._cardPool[i]) {
        this._cardPool[i].element.style.display = 'none';
      }
    }
    const popEl = document.getElementById('hudPopulationPill');
    if (popEl) popEl.textContent = '0 / 4 ACTIVE';
  }
}

export { MultiPersonHUD as MultiPersonHud };
export default MultiPersonHUD;

