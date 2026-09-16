/**
 * settingsManager.js — Single Authoritative Settings & Configuration Architecture.
 *
 * CRITICAL ARCHITECTURAL ROLE:
 * Serves as the single source of truth for all user preferences, runtime tracking modes,
 * performance targets, and rendering controls.
 *
 * DATA FLOW:
 * UI Controls ──► SettingsManager (Persistence & Validation) ──► Subsystems (Trackers, Stage, Perf)
 *
 * FUNDAMENTAL INVARIANTS:
 * 1. Exactly ONE source of truth: UI and subsystems never keep independent conflicting states.
 * 2. Strict input validation: Out-of-bounds or corrupted values safely fall back to defaults.
 * 3. Bidirectional synchronization: Programmatic updates reflect in the DOM; DOM changes update state.
 * 4. Safe persistence: User preferences saved to localStorage with in-memory fallback for Node/tests.
 * 5. Invariant preservation: Never breaks Phase 6 no-duplicate avatar or Phase 7/8 continuity invariants.
 */

export const TRACKING_MODES = {
  AUTO: 'auto',
  MULTI: 'multi',
  SINGLE: 'single'
};

export const VALID_MAX_PEOPLE = [1, 2, 4, 6, 8];
export const VALID_TARGET_FPS = [30, 45, 60];
export const VALID_PROFILES = ['AUTO', 'ULTRA', 'HIGH', 'MEDIUM', 'LOW'];
export const VALID_PIXEL_RATIOS = [1.0, 1.25, 1.5, 2.0];

export const DEFAULT_SETTINGS = {
  trackingMode: TRACKING_MODES.AUTO,
  maxPeople: 4,
  targetFps: 60,
  performanceProfile: 'AUTO',
  quality: 'AUTO',
  antiAliasing: true,
  pixelRatio: 1.5,
  bodyTracking: true,
  handTracking: true,
  headPose: true,
  faceLandmarkDensity: 'refined',
  smoothing: 55,
  defaultAvatarId: 'avatar_b',
  avatarSelectionMode: 'manual'
};

const STORAGE_KEY = 'morphee_ai_settings_v1';

export class SettingsManager {
  /**
   * @param {Object} [initialSettings]
   * @param {Storage|null} [storage] - Defaults to window.localStorage if available
   */
  constructor(initialSettings = {}, storage = null) {
    this._storage = storage !== undefined ? storage : (typeof window !== 'undefined' && window.localStorage ? window.localStorage : null);
    this._settings = { ...DEFAULT_SETTINGS };
    this._listeners = new Set();
    this._keyListeners = new Map();
    this._boundElements = new Map(); // key -> Set<HTMLElement>

    // 1. Load from storage
    this._loadFromStorage();

    // 2. Apply initial overrides if provided
    if (initialSettings && typeof initialSettings === 'object') {
      this.setMany(initialSettings, { skipPersist: true });
    }
  }

  /**
   * Normalizes and validates a single setting value.
   * Returns sanitized value or default if invalid.
   *
   * @param {string} key
   * @param {*} value
   * @returns {*}
   */
  validate(key, value) {
    switch (key) {
      case 'trackingMode': {
        const str = String(value || '').toLowerCase();
        return [TRACKING_MODES.AUTO, TRACKING_MODES.MULTI, TRACKING_MODES.SINGLE].includes(str)
          ? str
          : DEFAULT_SETTINGS.trackingMode;
      }
      case 'maxPeople': {
        const num = parseInt(value, 10);
        return VALID_MAX_PEOPLE.includes(num) ? num : DEFAULT_SETTINGS.maxPeople;
      }
      case 'targetFps': {
        const num = parseInt(value, 10);
        return VALID_TARGET_FPS.includes(num) ? num : DEFAULT_SETTINGS.targetFps;
      }
      case 'performanceProfile':
      case 'quality': {
        const str = String(value || '').toUpperCase();
        return VALID_PROFILES.includes(str) ? str : DEFAULT_SETTINGS.performanceProfile;
      }
      case 'antiAliasing':
      case 'bodyTracking':
      case 'handTracking':
      case 'headPose': {
        return Boolean(value);
      }
      case 'pixelRatio': {
        const num = parseFloat(value);
        return (!isNaN(num) && num >= 0.5 && num <= 3.0) ? num : DEFAULT_SETTINGS.pixelRatio;
      }
      case 'faceLandmarkDensity': {
        const str = String(value || '').toLowerCase();
        return ['refined', 'standard'].includes(str) ? str : DEFAULT_SETTINGS.faceLandmarkDensity;
      }
      case 'smoothing': {
        const num = parseInt(value, 10);
        return (!isNaN(num) && num >= 0 && num <= 90) ? num : DEFAULT_SETTINGS.smoothing;
      }
      case 'defaultAvatarId': {
        return (typeof value === 'string' && value.trim().length > 0) ? value.trim() : DEFAULT_SETTINGS.defaultAvatarId;
      }
      case 'avatarSelectionMode': {
        const str = String(value || '').toLowerCase();
        return ['manual', 'auto_category'].includes(str) ? str : DEFAULT_SETTINGS.avatarSelectionMode;
      }
      default:
        return value;
    }
  }

  /**
   * Loads verified settings from localStorage.
   * Invalid or missing keys safely fall back to DEFAULT_SETTINGS.
   * @private
   */
  _loadFromStorage() {
    if (!this._storage) return;
    try {
      const raw = this._storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [key, val] of Object.entries(parsed)) {
          if (key in DEFAULT_SETTINGS) {
            this._settings[key] = this.validate(key, val);
          }
        }
        // Keep performanceProfile and quality in lockstep
        if (parsed.performanceProfile) {
          this._settings.quality = this._settings.performanceProfile;
        } else if (parsed.quality) {
          this._settings.performanceProfile = this._settings.quality;
        }
      }
    } catch (err) {
      console.warn('[SettingsManager] Failed to load settings from storage. Using defaults:', err.message);
    }
  }

  /**
   * Persists current settings to storage.
   * @private
   */
  _saveToStorage() {
    if (!this._storage) return;
    try {
      this._storage.setItem(STORAGE_KEY, JSON.stringify(this._settings));
    } catch (err) {
      console.warn('[SettingsManager] Failed to save settings to storage:', err.message);
    }
  }

  /**
   * Retrieves a setting value.
   * @param {string} key
   * @returns {*}
   */
  get(key) {
    return this._settings[key];
  }

  /**
   * Returns a copy of all current settings.
   * @returns {Object}
   */
  getAll() {
    return { ...this._settings };
  }

  /**
   * Sets a single setting with validation, persistence, and event notification.
   *
   * @param {string} key
   * @param {*} rawValue
   * @param {Object} [options]
   * @param {boolean} [options.skipNotify=false]
   * @param {boolean} [options.skipPersist=false]
   * @param {boolean} [options.skipDomSync=false]
   * @returns {*} The sanitized applied value
   */
  set(key, rawValue, options = {}) {
    if (!(key in DEFAULT_SETTINGS)) {
      console.warn(`[SettingsManager] Unknown setting key: '${key}'`);
    }

    const value = this.validate(key, rawValue);
    const prevValue = this._settings[key];

    // No-op if value is identical
    if (prevValue === value) {
      return value;
    }

    this._settings[key] = value;

    // Keep quality and performanceProfile synchronized
    if (key === 'performanceProfile') {
      this._settings.quality = value;
    } else if (key === 'quality') {
      this._settings.performanceProfile = value;
    }

    // Persist
    if (!options.skipPersist) {
      this._saveToStorage();
    }

    // Update bound DOM controls
    if (!options.skipDomSync) {
      this._syncElementFor(key, value);
      if (key === 'performanceProfile' || key === 'quality') {
        this._syncElementFor('performanceProfile', value);
        this._syncElementFor('quality', value);
      }
    }

    // Notify listeners
    if (!options.skipNotify) {
      this._notify(key, value, prevValue);
    }

    return value;
  }

  /**
   * Applies multiple setting updates atomically.
   * @param {Object} updates
   * @param {Object} [options]
   */
  setMany(updates, options = {}) {
    if (!updates || typeof updates !== 'object') return;
    for (const [k, v] of Object.entries(updates)) {
      this.set(k, v, options);
    }
  }

  /**
   * Resets all settings to default values.
   */
  reset() {
    this._settings = { ...DEFAULT_SETTINGS };
    this._saveToStorage();
    for (const [key, value] of Object.entries(this._settings)) {
      this._syncElementFor(key, value);
      this._notify(key, value, undefined);
    }
  }

  /**
   * Registers a subscriber for all setting changes.
   * @param {Function} listener — (key, value, allSettings) => void
   * @returns {Function} Unsubscribe function
   */
  onChange(listener) {
    if (typeof listener === 'function') {
      this._listeners.add(listener);
      return () => this._listeners.delete(listener);
    }
    return () => {};
  }

  /**
   * Registers a subscriber for changes to a specific setting key.
   * @param {string} key
   * @param {Function} listener — (value, prevValue, allSettings) => void
   * @returns {Function} Unsubscribe function
   */
  on(key, listener) {
    if (typeof listener !== 'function') return () => {};
    if (!this._keyListeners.has(key)) {
      this._keyListeners.set(key, new Set());
    }
    this._keyListeners.get(key).add(listener);
    return () => {
      const set = this._keyListeners.get(key);
      if (set) set.delete(listener);
    };
  }

  /**
   * Internal notification dispatcher.
   * @private
   */
  _notify(key, value, prevValue) {
    const all = this.getAll();
    for (const listener of this._listeners) {
      try {
        listener(key, value, all);
      } catch (err) {
        console.error(`[SettingsManager] Error in global listener for '${key}':`, err);
      }
    }

    const keySet = this._keyListeners.get(key);
    if (keySet) {
      for (const listener of keySet) {
        try {
          listener(value, prevValue, all);
        } catch (err) {
          console.error(`[SettingsManager] Error in key listener for '${key}':`, err);
        }
      }
    }
  }

  /**
   * Synchronizes internal value to bound DOM element(s).
   * @private
   */
  _syncElementFor(key, value) {
    const elements = this._boundElements.get(key);
    if (!elements) return;

    for (const el of elements) {
      if (!el) continue;
      if (el.type === 'checkbox') {
        if (el.checked !== Boolean(value)) {
          el.checked = Boolean(value);
        }
      } else if (el.type === 'range') {
        if (Number(el.value) !== Number(value)) {
          el.value = value;
        }
      } else {
        if (String(el.value) !== String(value)) {
          el.value = value;
        }
      }
    }
  }

  /**
   * Binds an individual DOM element to a settings key.
   * Establishes bidirectional event and value synchronization.
   *
   * @param {string} key
   * @param {HTMLElement|string} elementOrId
   */
  bind(key, elementOrId) {
    const el = typeof elementOrId === 'string'
      ? (typeof document !== 'undefined' ? document.getElementById(elementOrId) : null)
      : elementOrId;

    if (!el) return;

    if (!this._boundElements.has(key)) {
      this._boundElements.set(key, new Set());
    }
    this._boundElements.get(key).add(el);

    // 1. Initialize DOM element to current settings value
    this._syncElementFor(key, this.get(key));

    // 2. Listen to user interaction on the element
    const eventType = (el.type === 'range') ? 'input' : 'change';
    const handler = () => {
      let val;
      if (el.type === 'checkbox') {
        val = el.checked;
      } else if (el.type === 'range') {
        val = Number(el.value);
      } else {
        val = el.value;
      }
      this.set(key, val, { skipDomSync: true });
    };

    el.addEventListener(eventType, handler);
  }

  /**
   * Scans a container (or document) and automatically binds known Morphee AI control IDs.
   *
   * @param {Document|HTMLElement} [container]
   */
  bindUI(container = (typeof document !== 'undefined' ? document : null)) {
    if (!container) return;

    const CONTROL_MAPPINGS = [
      { key: 'trackingMode', id: 'trackingModeSelect' },
      { key: 'maxPeople', id: 'maxPeopleSelect' },
      { key: 'targetFps', id: 'targetFpsSelect' },
      { key: 'performanceProfile', id: 'perfModeSelect' },
      { key: 'smoothing', id: 'smoothRange' },
      { key: 'headPose', id: 'poseToggle' },
      { key: 'antiAliasing', id: 'settingAA' },
      { key: 'pixelRatio', id: 'settingPixelRatio' },
      { key: 'faceLandmarkDensity', id: 'settingFaceDensity' },
      { key: 'bodyTracking', id: 'settingBody' },
      { key: 'handTracking', id: 'settingHands' },
      { key: 'avatarSelectionMode', id: 'avatarSelectModeSelect' }
    ];

    for (const mapping of CONTROL_MAPPINGS) {
      const el = container.querySelector ? container.querySelector(`#${mapping.id}`) : (container.getElementById ? container.getElementById(mapping.id) : null);
      if (el) {
        this.bind(mapping.key, el);
      }
    }

    // Also support any element with `data-setting="<key>"`
    if (container.querySelectorAll) {
      const customElements = container.querySelectorAll('[data-setting]');
      for (const el of customElements) {
        const key = el.dataset.setting;
        if (key && key in DEFAULT_SETTINGS) {
          this.bind(key, el);
        }
      }
    }
  }
}

export const settingsManager = new SettingsManager();
export default settingsManager;
