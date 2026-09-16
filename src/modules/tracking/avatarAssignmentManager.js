/**
 * avatarAssignmentManager.js — Persistent Multi-Person Avatar Identity & Assignment Engine.
 *
 * CRITICAL ARCHITECTURAL ROLE:
 * Maintains a persistent, 1-to-1 mapping between physical person identities (TrackIDs)
 * and 3D VRM avatars (AvatarIDs).
 *
 * FUNDAMENTAL INVARIANTS:
 * 1. A physical person keeps their avatar because their TrackID persists.
 * 2. Avatar assignment MUST NEVER be based on MediaPipe detection index.
 * 3. Detection order reversals [A, B] -> [B, A] do NOT affect avatar mapping.
 * 4. Trajectory crossings do NOT swap avatars.
 * 5. Coasting tracks retain their assigned avatar throughout the grace period.
 * 6. Terminated tracks release their avatar back to the available pool.
 * 7. The user-selected default avatar is assigned to the first active tracked person.
 * 8. Additional people receive unique available avatars from the avatar registry.
 * 9. NO AVATAR DUPLICATION: Two active tracks NEVER share an AvatarID.
 *    If active tracks exceed available unique avatars, the excess track enters
 *    'WAITING_FOR_UNIQUE_AVATAR' without terminating its PersonTracker identity.
 * 10. DYNAMIC CAPACITY: Adding new avatar definitions to the registry automatically
 *     scales unique-person capacity (e.g. 8 definitions -> 8 unique people).
 */

import { avatarRegistry as defaultRegistry } from '../library/avatarRegistry.js';

export const ASSIGNMENT_STATE = {
  ASSIGNED: 'ASSIGNED',
  WAITING_FOR_UNIQUE_AVATAR: 'WAITING_FOR_UNIQUE_AVATAR',
  UNTRACKED: 'UNTRACKED'
};

export class AvatarAssignmentManager {
  /**
   * @param {Object} [options]
   * @param {string} [options.defaultAvatarId='avatar_b'] - Default avatar ID (Hana)
   * @param {Object} [options.registry] - Optional AvatarRegistry instance
   */
  constructor(options = {}) {
    this.defaultAvatarId = options.defaultAvatarId ?? 'avatar_b';
    this.registry = options.registry ?? defaultRegistry;

    /**
     * Map of TrackID -> { avatarId: string|null, assignmentState: string }
     * @type {Map<number, { avatarId: string|null, assignmentState: string }>}
     */
    this._trackAssignments = new Map();

    /**
     * Acquisition order of track IDs
     * @type {number[]}
     */
    this._trackOrder = [];

    /**
     * Avatar selection mode: 'manual' (default) | 'auto_category'
     * @type {'manual'|'auto_category'}
     */
    this.selectionMode = options.selectionMode ?? 'manual';

    /** Diagnostic counter for avatar assignment switches */
    this.avatarIdSwitches = 0;
  }

  /**
   * Official privacy & non-biological presentation heuristic disclaimer.
   * @returns {string}
   */
  getPrivacyDisclaimer() {
    return 'Optional body-proportion heuristic for assigning avatars based on shoulder-to-torso geometry. Does not claim or perform biological-sex detection or biometric identification.';
  }

  /**
   * Sets the avatar selection mode.
   * @param {'manual'|'auto_category'} mode
   */
  setSelectionMode(mode) {
    if (mode === 'auto_category' || mode === 'manual') {
      this.selectionMode = mode;
    }
  }

  /**
   * Updates preferred default avatar.
   * If the primary active track is currently using the previous default,
   * it updates the assignment accordingly.
   * @param {string} avatarId 
   */
  setDefaultAvatarId(avatarId) {
    if (!avatarId || this.defaultAvatarId === avatarId) return;
    this.defaultAvatarId = avatarId;
  }

  /**
   * Retrieves assigned AvatarID for a given TrackID.
   * Returns null if track has no avatar or is waiting for a unique avatar.
   * @param {number} trackId 
   * @returns {string|null}
   */
  getAvatarIdForTrack(trackId) {
    return this._trackAssignments.get(trackId)?.avatarId ?? null;
  }

  /**
   * Retrieves assignment state for a given TrackID ('ASSIGNED' | 'WAITING_FOR_UNIQUE_AVATAR' | 'UNTRACKED').
   * @param {number} trackId 
   * @returns {string}
   */
  getAssignmentStateForTrack(trackId) {
    return this._trackAssignments.get(trackId)?.assignmentState ?? ASSIGNMENT_STATE.UNTRACKED;
  }

  /**
   * Retrieves TrackID currently assigned to a given AvatarID.
   * @param {string} avatarId 
   * @returns {number|null}
   */
  getTrackIdForAvatar(avatarId) {
    for (const [trackId, record] of this._trackAssignments.entries()) {
      if (record.avatarId === avatarId) return trackId;
    }
    return null;
  }

  /**
   * Returns a copy of current active assignments as Map<trackId, avatarId>.
   * Omits tracks that have avatarId === null (waiting).
   * @returns {Map<number, string>}
   */
  getAssignments() {
    const map = new Map();
    for (const [trackId, record] of this._trackAssignments.entries()) {
      if (record.avatarId) {
        map.set(trackId, record.avatarId);
      }
    }
    return map;
  }

  /**
   * Returns copy of all track records including waiting tracks.
   * @returns {Map<number, { avatarId: string|null, assignmentState: string }>}
   */
  getAllTrackAssignments() {
    const map = new Map();
    for (const [trackId, record] of this._trackAssignments.entries()) {
      map.set(trackId, { ...record });
    }
    return map;
  }

  /**
   * Gets list of all currently available avatar IDs from the registry
   * that are NOT assigned to any active or coasting track.
   * @returns {string[]}
   */
  getAvailableAvatarIds() {
    const allDefs = this.registry?.getAll ? this.registry.getAll() : [];
    const assignedIds = new Set();
    for (const record of this._trackAssignments.values()) {
      if (record.avatarId) {
        assignedIds.add(record.avatarId);
      }
    }
    
    // Prioritize default avatar if not yet assigned
    const available = [];
    if (!assignedIds.has(this.defaultAvatarId)) {
      available.push(this.defaultAvatarId);
    }

    for (const def of allDefs) {
      if (def.id !== this.defaultAvatarId && !assignedIds.has(def.id)) {
        available.push(def.id);
      }
    }

    return available;
  }

  /**
   * Synchronizes avatar assignments with the surviving tracks from PersonTracker.
   * Handles track creation, coasting reservation, termination release, and waiting queue.
   *
   * ABSOLUTE INVARIANT:
   * Two simultaneously active tracks NEVER share an AvatarID.
   *
   * @param {Array<Object>|Iterable<Object>} trackedPersons - Surviving tracks from PersonTracker.update()
   * @returns {{
   *   assignments: Map<number, string>,
   *   allAssignments: Map<number, { avatarId: string|null, assignmentState: string }>,
   *   newlyAssigned: Array<{ trackId: number, avatarId: string, assignmentState: string }>,
   *   released: Array<{ trackId: number, avatarId: string }>,
   *   waiting: Array<{ trackId: number, assignmentState: string }>
   * }}
   */
  sync(trackedPersons = []) {
    const list = Array.from(trackedPersons);
    const survivingTrackIds = new Set(
      list
        .filter(t => t.state !== 'TERMINATED')
        .map(t => t.trackId)
    );

    const released = [];
    const newlyAssigned = [];
    const waiting = [];

    // 1. Release avatars for tracks that have terminated or disappeared
    for (const [assignedTrackId, record] of Array.from(this._trackAssignments.entries())) {
      if (!survivingTrackIds.has(assignedTrackId)) {
        this._trackAssignments.delete(assignedTrackId);
        this._trackOrder = this._trackOrder.filter(id => id !== assignedTrackId);
        if (record.avatarId) {
          released.push({ trackId: assignedTrackId, avatarId: record.avatarId });
        }
      }
    }

    // 2. Service previously waiting tracks if any avatar was freed
    const existingWaitingTracks = Array.from(this._trackAssignments.entries())
      .filter(([trackId, record]) => survivingTrackIds.has(trackId) && record.assignmentState === ASSIGNMENT_STATE.WAITING_FOR_UNIQUE_AVATAR)
      .sort((a, b) => a[0] - b[0]); // Deterministic queue order

    for (const [waitingTrackId, record] of existingWaitingTracks) {
      const preferred = (this.selectionMode === 'auto_category' && record.preferredCategory)
        ? record.preferredCategory
        : null;
      const allocation = this._allocateUniqueAvatar(preferred);
      const freedAvatarId = typeof allocation === 'string' ? allocation : allocation?.avatarId;
      if (freedAvatarId) {
        record.avatarId = freedAvatarId;
        record.assignmentState = ASSIGNMENT_STATE.ASSIGNED;
        record.selectionReason = allocation?.reason || 'MANUAL';
        newlyAssigned.push({
          trackId: waitingTrackId,
          avatarId: freedAvatarId,
          assignmentState: ASSIGNMENT_STATE.ASSIGNED,
          selectionReason: record.selectionReason
        });
      }
    }

    // 3. Identify new tracks that do not yet exist in track assignments
    const unassignedTracks = list.filter(
      t => t.state !== 'TERMINATED' && !this._trackAssignments.has(t.trackId)
    );

    // Sort unassigned tracks by trackId to maintain deterministic assignment order
    unassignedTracks.sort((a, b) => a.trackId - b.trackId);

    for (const track of unassignedTracks) {
      let preferredCategory = null;
      let estimated = null;

      if (this.selectionMode === 'auto_category') {
        estimated = this._estimateCategory(track);
        // Confidence threshold: only use category when confidence > 0.65
        if (estimated && estimated.confidence > 0.65 && estimated.category !== 'neutral') {
          preferredCategory = estimated.category;
        }
      }

      const allocation = this._allocateUniqueAvatar(preferredCategory);
      const assignedAvatarId = typeof allocation === 'string' ? allocation : allocation?.avatarId;
      const selectionReason = allocation?.reason || (preferredCategory ? 'CATEGORY_MATCH' : 'MANUAL');

      if (assignedAvatarId) {
        // Unique avatar successfully allocated
        this._trackAssignments.set(track.trackId, {
          avatarId: assignedAvatarId,
          assignmentState: ASSIGNMENT_STATE.ASSIGNED,
          preferredCategory,
          estimatedCategory: estimated?.category || 'neutral',
          category: estimated?.category || 'neutral',
          categoryConfidence: estimated?.confidence || 0,
          ratio: estimated?.ratio || 0,
          selectionReason
        });
        this._trackOrder.push(track.trackId);
        newlyAssigned.push({
          trackId: track.trackId,
          avatarId: assignedAvatarId,
          assignmentState: ASSIGNMENT_STATE.ASSIGNED,
          selectionReason
        });
      } else {
        // NO UNIQUE AVATAR AVAILABLE: Enter explicit WAITING state (NO DUPLICATION!)
        this._trackAssignments.set(track.trackId, {
          avatarId: null,
          assignmentState: ASSIGNMENT_STATE.WAITING_FOR_UNIQUE_AVATAR,
          preferredCategory,
          estimatedCategory: estimated?.category || 'neutral',
          category: estimated?.category || 'neutral',
          categoryConfidence: estimated?.confidence || 0,
          ratio: estimated?.ratio || 0,
          selectionReason: 'NO_AVATARS_AVAILABLE'
        });
        this._trackOrder.push(track.trackId);
        waiting.push({
          trackId: track.trackId,
          assignmentState: ASSIGNMENT_STATE.WAITING_FOR_UNIQUE_AVATAR
        });
      }
    }

    return {
      assignments: this.getAssignments(),
      allAssignments: this.getAllTrackAssignments(),
      newlyAssigned,
      released,
      waiting
    };
  }

  /**
   * Estimates presentation/gender category heuristic from MediaPipe pose proportions.
   *
   * PRIVACY & METHODOLOGY DISCLAIMER:
   * This is an OPTIONAL presentation heuristic based solely on geometric body landmark
   * proportions (shoulder width to torso height ratio).
   * It DOES NOT claim reliable biological-sex detection.
   * It DOES NOT use facial recognition, facial landmarks, or biometric identity.
   *
   * @param {Object} person - TrackedPerson instance
   * @returns {{ category: 'female'|'male'|'neutral', confidence: number, ratio: number }}
   */
  _estimateCategory(person) {
    const defaultResult = { category: 'neutral', confidence: 0.0, ratio: 0.0 };
    if (!person) return defaultResult;

    // Support both direct pose landmarks and person.pose.landmarks / person.pose.worldLandmarks
    const landmarks = person.pose?.landmarks || person.pose?.worldLandmarks || person.landmarks;
    if (!landmarks || landmarks.length < 25) {
      return defaultResult;
    }

    const ls = landmarks[11]; // Left shoulder
    const rs = landmarks[12]; // Right shoulder
    const lh = landmarks[23]; // Left hip
    const rh = landmarks[24]; // Right hip

    if (!ls || !rs || !lh || !rh) {
      return defaultResult;
    }

    // Visibility / presence confidence check
    const vis11 = ls.visibility !== undefined ? ls.visibility : (ls.score !== undefined ? ls.score : 1.0);
    const vis12 = rs.visibility !== undefined ? rs.visibility : (rs.score !== undefined ? rs.score : 1.0);
    const vis23 = lh.visibility !== undefined ? lh.visibility : (lh.score !== undefined ? lh.score : 1.0);
    const vis24 = rh.visibility !== undefined ? rh.visibility : (rh.score !== undefined ? rh.score : 1.0);
    const avgVis = (vis11 + vis12 + vis23 + vis24) / 4;

    if (avgVis < 0.4) {
      return { category: 'neutral', confidence: avgVis, ratio: 0.0 };
    }

    // Euclidean distance in X-Y plane
    const shoulderDx = rs.x - ls.x;
    const shoulderDy = rs.y - ls.y;
    const shoulderDist = Math.sqrt(shoulderDx * shoulderDx + shoulderDy * shoulderDy);

    const shoulderMidX = (ls.x + rs.x) * 0.5;
    const shoulderMidY = (ls.y + rs.y) * 0.5;
    const hipMidX = (lh.x + rh.x) * 0.5;
    const hipMidY = (lh.y + rh.y) * 0.5;

    const torsoDx = hipMidX - shoulderMidX;
    const torsoDy = hipMidY - shoulderMidY;
    const torsoHeight = Math.sqrt(torsoDx * torsoDx + torsoDy * torsoDy);

    if (torsoHeight < 0.05) {
      return { category: 'neutral', confidence: 0.0, ratio: 0.0 };
    }

    const ratio = shoulderDist / torsoHeight;

    // Heuristic classification:
    // Narrower biacromial diameter relative to trunk -> female presentation tendency (< 0.85)
    // Broader biacromial diameter relative to trunk -> male presentation tendency (> 0.95)
    let category = 'neutral';
    let conf = avgVis;

    if (ratio < 0.85) {
      category = 'female';
      const margin = Math.min(1.0, (0.85 - ratio) / 0.15);
      conf = Math.min(1.0, avgVis * (0.70 + margin * 0.30));
    } else if (ratio > 0.95) {
      category = 'male';
      const margin = Math.min(1.0, (ratio - 0.95) / 0.20);
      conf = Math.min(1.0, avgVis * (0.70 + margin * 0.30));
    } else {
      category = 'neutral';
      conf = 0.5;
    }

    return { category, confidence: Math.round(conf * 100) / 100, ratio: Math.round(ratio * 100) / 100 };
  }

  /**
   * Allocates an unassigned, unique avatar ID from available definitions.
   * If preferredCategory is provided ('female'|'male'), prioritizes matching avatars.
   * Falls back to any available avatar if no category match is available.
   * If all unique avatars in registry are currently assigned, returns null.
   *
   * STRICT INVARIANT: Never duplicates an avatar ID among active tracks.
   * @param {string|null} [preferredCategory=null]
   * @private
   * @returns {string|null}
   */
  _allocateUniqueAvatar(preferredCategory = null) {
    const assignedIds = new Set();
    for (const record of this._trackAssignments.values()) {
      if (record.avatarId) {
        assignedIds.add(record.avatarId);
      }
    }

    const allDefs = this.registry?.getAll ? this.registry.getAll() : [];
    const availableDefs = allDefs.filter(d => !assignedIds.has(d.id));

    if (availableDefs.length === 0) {
      // No unique avatar available: NO DUPLICATION POLICY
      return { avatarId: null, reason: 'NO_AVATARS_AVAILABLE' };
    }

    // 1. If preferredCategory specified, look for matching presentation/gender
    if (preferredCategory && (preferredCategory === 'female' || preferredCategory === 'male')) {
      const isMatch = (d) => {
        const p = (d.presentation || '').toLowerCase();
        const g = (d.gender || '').toLowerCase();
        if (preferredCategory === 'female') {
          return p === 'female' || p === 'female-presenting' || g === 'female';
        }
        if (preferredCategory === 'male') {
          return p === 'male' || p === 'male-presenting' || g === 'male';
        }
        return false;
      };

      const match = availableDefs.find(isMatch);
      if (match) {
        return { avatarId: match.id, reason: 'CATEGORY_MATCH' };
      }
      // Log category pool exhaustion and continue to fallback
      console.info(`[AvatarAssignmentManager] Category pool exhausted for '${preferredCategory}'; falling back to next available unique avatar.`);
    }

    // 2. If default avatar is unassigned, assign it
    if (!assignedIds.has(this.defaultAvatarId)) {
      return {
        avatarId: this.defaultAvatarId,
        reason: preferredCategory ? 'CATEGORY_POOL_EXHAUSTED_DEFAULT_FALLBACK' : 'DEFAULT_ASSIGNMENT'
      };
    }

    // 3. Otherwise assign the first available unique avatar in registry order
    return {
      avatarId: availableDefs[0].id,
      reason: preferredCategory ? 'CATEGORY_POOL_EXHAUSTED_NEXT_AVAILABLE' : 'NEXT_AVAILABLE'
    };
  }

  /**
   * Explicitly releases an assigned track.
   * @param {number} trackId 
   * @returns {string|null} Released avatar ID or null
   */
  releaseTrack(trackId) {
    const record = this._trackAssignments.get(trackId);
    if (record) {
      this._trackAssignments.delete(trackId);
      this._trackOrder = this._trackOrder.filter(id => id !== trackId);
      return record.avatarId;
    }
    return null;
  }

  /**
   * Resets all assignments and track ordering.
   */
  reset() {
    this._trackAssignments.clear();
    this._trackOrder = [];
    this.avatarIdSwitches = 0;
  }

  /**
   * Diagnostics telemetry for testing and UI display.
   */
  getDiagnostics() {
    const activeAssigned = [];
    const waitingTracks = [];

    for (const [trackId, record] of this._trackAssignments.entries()) {
      if (record.avatarId) {
        activeAssigned.push({
          trackId,
          avatarId: record.avatarId,
          state: record.assignmentState,
          category: record.category || 'neutral',
          categoryConfidence: record.categoryConfidence || 0,
          selectionReason: record.selectionReason || 'MANUAL'
        });
      } else {
        waitingTracks.push({
          trackId,
          state: record.assignmentState,
          category: record.category || 'neutral',
          categoryConfidence: record.categoryConfidence || 0
        });
      }
    }

    return {
      totalTracks: this._trackAssignments.size,
      totalAssigned: activeAssigned.length,
      totalWaiting: waitingTracks.length,
      avatarIdSwitches: this.avatarIdSwitches,
      defaultAvatarId: this.defaultAvatarId,
      selectionMode: this.selectionMode,
      assigned: activeAssigned,
      waiting: waitingTracks
    };
  }
}

export const avatarAssignmentManager = new AvatarAssignmentManager();
export default avatarAssignmentManager;
