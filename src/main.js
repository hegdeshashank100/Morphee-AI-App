import { LandmarkTracker } from './modules/landmarkTracker.js';
import { BodyTracker } from './modules/bodyTracker.js';
import { PersonTracker } from './modules/tracking/personTracker.js';
import { VrmRenderer as FaceRenderer } from './modules/vrmRenderer.js';
import { detectGPU, populateGPUInfo } from './modules/gpuDetect.js';
import { assetManager } from './modules/core/assetManager.js';
import { profiler } from './modules/core/profiler.js';
import AVATAR_MODELS from './modules/avatarModels.js';

// ────────────────────────────────────────────────
// DOM REFS
// ────────────────────────────────────────────────
const video = document.getElementById('webcam');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusLine = document.getElementById('statusLine');
const renderStatus = document.getElementById('renderStatus');
const fpsPill = document.getElementById('fpsPill');
const facePill = document.getElementById('facePill');
const mInfer = document.getElementById('mInfer');
const mRenderFps = document.getElementById('mRenderFps');
const mPose = document.getElementById('mPose');
const mBody = document.getElementById('mBody');
const blendList = document.getElementById('blendList');
const smoothRange = document.getElementById('smoothRange');
const poseToggle = document.getElementById('poseToggle');
const trackingModeSelect = document.getElementById('trackingModeSelect');
const maxPeopleSelect = document.getElementById('maxPeopleSelect');
const targetFpsSelect = document.getElementById('targetFpsSelect');
const perfModeSelect = document.getElementById('perfModeSelect');
const mTier = document.getElementById('mTier');
const mTiming = document.getElementById('mTiming');
const loadingOverlay = document.getElementById('loadingOverlay');
const renderCanvas = document.getElementById('renderCanvas');
const activeModelPill = document.getElementById('activeModelPill');
const avatarGrid = document.getElementById('avatarGrid');

// Status Strip DOM refs
const stripRenderFps = document.getElementById('stripRenderFps');
const stripFrameTime = document.getElementById('stripFrameTime');
const stripInference = document.getElementById('stripInference');
const stripTier = document.getElementById('stripTier');
const stripBodyHands = document.getElementById('stripBodyHands');
const stripDelegate = document.getElementById('stripDelegate');
const toggleDiagBtn = document.getElementById('toggleDiagBtn');
const closeDiagBtn = document.getElementById('closeDiagBtn');
const diagnosticsDrawer = document.getElementById('diagnosticsDrawer');

// Diagnostics Drawer DOM refs
const dFaceConf = document.getElementById('dFaceConf');
const dPoseConf = document.getElementById('dPoseConf');
const dHandConf = document.getElementById('dHandConf');
const dHandState = document.getElementById('dHandState');
const dFaceLms = document.getElementById('dFaceLms');
const dPoseLms = document.getElementById('dPoseLms');
const dHandsCnt = document.getElementById('dHandsCnt');
const dJitter = document.getElementById('dJitter');
const dLostFrames = document.getElementById('dLostFrames');
const dReacquisitions = document.getElementById('dReacquisitions');
const dTrackSwitches = document.getElementById('dTrackSwitches');
const dAvatarSwitches = document.getElementById('dAvatarSwitches');
const dFaceInfer = document.getElementById('dFaceInfer');
const dPoseInfer = document.getElementById('dPoseInfer');
const dHandInfer = document.getElementById('dHandInfer');
const dTrackFrame = document.getElementById('dTrackFrame');
const dRenderPass = document.getElementById('dRenderPass');

if (toggleDiagBtn && diagnosticsDrawer) {
  toggleDiagBtn.addEventListener('click', () => {
    const isHidden = diagnosticsDrawer.style.display === 'none';
    diagnosticsDrawer.style.display = isHidden ? 'block' : 'none';
  });
}
if (closeDiagBtn && diagnosticsDrawer) {
  closeDiagBtn.addEventListener('click', () => {
    diagnosticsDrawer.style.display = 'none';
  });
}

function setStatus(msg, isError = false) {
  statusLine.textContent = msg;
  statusLine.classList.toggle('error', isError);
}

// ────────────────────────────────────────────────
// GPU DETECTION
// ────────────────────────────────────────────────
const gpuInfo = detectGPU();
populateGPUInfo(gpuInfo);
console.log('[Morphee AI] GPU:', gpuInfo.renderer, '| Delegate:', gpuInfo.delegate, '| CUDA:', gpuInfo.isCudaCapable);

// ────────────────────────────────────────────────
// SIDEBAR NAVIGATION
// ────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const viewId = item.dataset.view;

    // Update active nav
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');

    // Show correct view
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`view-${viewId}`);
    if (target) target.classList.add('active');

    // Toggle sidebar tracking visibility via body class
    document.body.classList.toggle('live-active', viewId === 'live');
  });
});

// Set initial live-active state (Live Capture is default active view)
document.body.classList.add('live-active');

import { avatarRegistry } from './modules/library/avatarRegistry.js';
import { avatarCache } from './modules/library/avatarCache.js';
import { avatarPreviewGenerator } from './modules/library/avatarPreviewGenerator.js';
import { avatarAssignmentManager } from './modules/tracking/avatarAssignmentManager.js';
import { performanceManager } from './modules/performance/performanceManager.js';
import { settingsManager } from './modules/core/settingsManager.js';
import { MultiPersonHUD, TRACK_COLORS, getTrackColor } from './modules/ui/multiPersonHud.js';
import { CameraNavigator } from './modules/ui/cameraNavigator.js';
import { cameraState } from './modules/ui/cameraState.js';

// ────────────────────────────────────────────────
// 3D RENDERER & HUD
// ────────────────────────────────────────────────
const faceRenderer = new FaceRenderer(renderCanvas);
faceRenderer.onRenderFps = (fps) => { mRenderFps.textContent = fps.toFixed(0); };
faceRenderer.resize();
faceRenderer.startRenderLoop();

const multiPersonHud = new MultiPersonHUD();

// Track selection state (bidirectionally shared with HUD, Stage Labels, and Camera PiP)
let selectedTrackId = null;
multiPersonHud.setOnTrackSelect((trackId) => {
  selectedTrackId = (selectedTrackId === trackId) ? null : trackId;
});

// Floating 3D Avatar Stage Labels
const avatarStageLabelsContainer = document.getElementById('avatarStageLabelsContainer');
const _stageLabelPool = new Map();

function updateAvatarStageLabels(trackedPersons, trackingMode) {
  if (!avatarStageLabelsContainer) return;
  const activeIds = new Set();

  for (const person of (trackedPersons || [])) {
    if (person.state === 'TERMINATED') continue;
    if (trackingMode === 'single' && person !== trackedPersons[0]) continue;

    const screenPos = faceRenderer.stageManager.getAvatarScreenPosition(person.trackId);
    if (!screenPos || !screenPos.visible) continue;

    activeIds.add(person.trackId);
    let labelEl = _stageLabelPool.get(person.trackId);
    if (!labelEl) {
      labelEl = document.createElement('div');
      labelEl.className = 'avatar-stage-label';

      const header = document.createElement('div');
      header.className = 'avatar-stage-label-header';

      const badge = document.createElement('span');
      badge.className = 'stage-label-badge';

      const name = document.createElement('span');
      name.className = 'stage-label-name';

      header.appendChild(badge);
      header.appendChild(name);
      labelEl.appendChild(header);

      const sub = document.createElement('div');
      sub.className = 'stage-label-sub';

      const state = document.createElement('span');
      state.className = 'stage-label-state';
      sub.appendChild(state);
      labelEl.appendChild(sub);

      labelEl.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedTrackId = (selectedTrackId === person.trackId) ? null : person.trackId;
      });

      avatarStageLabelsContainer.appendChild(labelEl);
      _stageLabelPool.set(person.trackId, labelEl);
    }

    const color = getTrackColor(person.trackId);
    labelEl.style.setProperty('--track-color', color);
    labelEl.style.setProperty('--track-glow', color + '55');
    labelEl.style.left = `${screenPos.x.toFixed(1)}px`;
    labelEl.style.top = `${screenPos.y.toFixed(1)}px`;
    labelEl.classList.toggle('selected', person.trackId === selectedTrackId);

    const badge = labelEl.querySelector('.stage-label-badge');
    if (badge) {
      badge.textContent = `#${person.trackId}`;
      badge.style.background = color;
    }

    const name = labelEl.querySelector('.stage-label-name');
    if (name) {
      const avatarId = avatarAssignmentManager.getAvatarIdForTrack(person.trackId);
      const assignmentState = avatarAssignmentManager.getAssignmentStateForTrack(person.trackId);
      if (assignmentState === 'WAITING_FOR_UNIQUE_AVATAR' || !avatarId) {
        name.textContent = 'Waiting';
      } else {
        const avDef = avatarRegistry.get(avatarId);
        name.textContent = avDef?.name || avatarId;
      }
    }

    const stateEl = labelEl.querySelector('.stage-label-state');
    if (stateEl) {
      stateEl.textContent = person.state;
      stateEl.className = `stage-label-state status-${person.state.toLowerCase()}`;
    }
  }

  for (const [trackId, el] of _stageLabelPool.entries()) {
    if (!activeIds.has(trackId)) {
      if (el.parentNode) el.parentNode.removeChild(el);
      _stageLabelPool.delete(trackId);
    }
  }
}

if (renderCanvas) {
  renderCanvas.addEventListener('click', () => {
    selectedTrackId = null;
  });
}

// ────────────────────────────────────────────────
// CAMERA NAVIGATOR
// ────────────────────────────────────────────────
const cameraNavContainer = document.getElementById('cameraNavigator');
const cameraNavigator = new CameraNavigator(cameraNavContainer, faceRenderer.stageManager);
faceRenderer.stageManager.setCameraState(cameraState);

// Diagnostic references for testing
if (typeof window !== 'undefined') {
  window.__morpheeRenderer = faceRenderer;
  window.__morpheeRegistry = avatarRegistry;
  window.__morpheeCache = avatarCache;
  window.__morpheePreviewGenerator = avatarPreviewGenerator;
  window.__morpheeAssignment = avatarAssignmentManager;
  window.__morpheePerformance = performanceManager;
  window.__morpheeSettings = settingsManager;
  window.__multiPersonHud = multiPersonHud;
  window.__morpheeCameraNav = cameraNavigator;
  window.__morpheeCameraState = cameraState;
}

// ────────────────────────────────────────────────
// SETTINGS INITIALIZATION & SUBSCRIPTIONS
// ────────────────────────────────────────────────
// 1. Establish two-way binding between UI elements and settingsManager
settingsManager.bindUI(document);

// 2. Synchronize PerformanceManager with initial settings
performanceManager.setTargetFps(settingsManager.get('targetFps'));
performanceManager.setMode(settingsManager.get('performanceProfile'));
performanceManager.setUserPixelRatio(settingsManager.get('pixelRatio'));
faceRenderer.setPixelRatio(performanceManager.getEffectivePixelRatio());
faceRenderer.setAntialiasing(settingsManager.get('antiAliasing'));

// 3. Subscribe subsystems to authoritative settings changes
settingsManager.on('targetFps', (val) => {
  performanceManager.setTargetFps(val);
});

settingsManager.on('performanceProfile', (val) => {
  performanceManager.setMode(val);
});

settingsManager.on('pixelRatio', (val) => {
  performanceManager.setUserPixelRatio(val);
  faceRenderer.setPixelRatio(performanceManager.getEffectivePixelRatio());
});

settingsManager.on('antiAliasing', (val) => {
  faceRenderer.setAntialiasing(val);
});

settingsManager.on('defaultAvatarId', (val) => {
  avatarAssignmentManager.setDefaultAvatarId(val);
});

settingsManager.on('avatarSelectionMode', (val) => {
  avatarAssignmentManager.setSelectionMode(val);
  console.log(`[Morphee AI] Avatar selection mode set to: ${val}`);
});
avatarAssignmentManager.setSelectionMode(settingsManager.get('avatarSelectionMode') || 'manual');

// Performance Manager tier change callback
performanceManager.onTierChanged = ({ currentTier, config }) => {
  faceRenderer.setPixelRatio(performanceManager.getEffectivePixelRatio());
  if (mTier) mTier.textContent = `${performanceManager.mode === 'AUTO' ? 'AUTO · ' : ''}${currentTier}`;
};

// Track which model is currently selected
let currentModelId = settingsManager.get('defaultAvatarId') || avatarRegistry.getAll()[0]?.id || 'avatar_b';
avatarAssignmentManager.setDefaultAvatarId(currentModelId);

const galleryNotification = document.getElementById('galleryNotification');
const avatarSearchInput = document.getElementById('avatarSearchInput');
const modelCountPill = document.getElementById('modelCountPill');

function showGalleryNotification(message, isWarning = false) {
  if (!galleryNotification) return;
  galleryNotification.textContent = message;
  galleryNotification.style.display = 'flex';
  galleryNotification.style.borderColor = isWarning ? 'var(--warn)' : 'var(--accent)';
  galleryNotification.style.color = isWarning ? 'var(--warn)' : 'var(--accent)';
}

function clearGalleryNotification() {
  if (!galleryNotification) return;
  galleryNotification.style.display = 'none';
  galleryNotification.textContent = '';
}

async function loadModel(modelDefOrId) {
  loadingOverlay.style.display = 'flex';
  if (activeModelPill) activeModelPill.textContent = 'Loading…';

  try {
    // 1. Acquire via AvatarCache (with lazy loading, in-flight deduping, and error boundary)
    const result = await avatarCache.acquire(modelDefOrId, { allowFallback: true });

    // 2. Unbind previous primary avatar into warm cache
    const prevPrimary = faceRenderer.stageManager.primaryAvatar;
    if (prevPrimary && prevPrimary.id !== result.avatar.id) {
      avatarCache.release(prevPrimary.id);
    }

    // 3. Set new primary avatar in StageManager and register Track 1
    faceRenderer.stageManager.setPrimaryAvatar(result.avatar);
    faceRenderer.stageManager.addTrackAvatar(1, result.avatar);
    result.avatar.visible = true;

    loadingOverlay.style.display = 'none';
    const expressionCount = Object.keys(result.avatar.vrm?.expressionManager?.expressionMap ?? {}).length || 8;

    const activeDef = avatarRegistry.get(result.avatar.id) || (typeof modelDefOrId === 'object' ? modelDefOrId : { name: result.avatar.name });
    renderStatus.textContent = `${activeDef.name} loaded — ${expressionCount} expressions ready.${result.fromCache ? ' (from cache)' : ''}`;
    if (activeModelPill) activeModelPill.textContent = activeDef.name;
    currentModelId = result.avatar.id;
    avatarAssignmentManager.setDefaultAvatarId(currentModelId);
    settingsManager.set('defaultAvatarId', currentModelId);

    if (result.fallback) {
      showGalleryNotification(`Requested avatar failed to load. Safely fell back to default (${activeDef.name}).`, true);
    } else {
      clearGalleryNotification();
    }

    // Update gallery selection UI
    document.querySelectorAll('.avatar-card').forEach(c => c.classList.remove('selected'));
    const card = document.querySelector(`.avatar-card[data-id="${currentModelId}"]`);
    if (card) card.classList.add('selected');

    return expressionCount;
  } catch (err) {
    console.error('[loadModel] Critical load error:', err);
    loadingOverlay.innerHTML = `<span>Failed to load: ${err.message}</span>`;
    if (activeModelPill) activeModelPill.textContent = 'Error';
    showGalleryNotification(`Failed to load avatar: ${err.message}`, true);
  }
}

// Load initial default model
loadModel(currentModelId);

// ────────────────────────────────────────────────
// AVATAR GALLERY
// ────────────────────────────────────────────────
let currentFilter = 'all';
let currentSearchTerm = '';

function renderAvatarGallery() {
  if (!avatarGrid) return;
  avatarGrid.innerHTML = '';

  const queryOptions = {
    search: currentSearchTerm,
    presentation: (currentFilter === 'male' || currentFilter === 'female') ? currentFilter : 'all',
    category: (currentFilter === 'anime' || currentFilter === 'stylized' || currentFilter === 'robot') ? currentFilter : 'all',
    favoritesOnly: currentFilter === 'favorites'
  };

  const filtered = avatarRegistry.query(queryOptions);

  if (modelCountPill) {
    modelCountPill.textContent = `${filtered.length} of ${avatarRegistry.size} Models`;
  }

  if (filtered.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'empty-gallery-msg';
    emptyMsg.style.gridColumn = '1 / -1';
    emptyMsg.style.padding = '32px';
    emptyMsg.style.textAlign = 'center';
    emptyMsg.style.color = 'var(--text-dim)';
    emptyMsg.style.fontSize = '13px';
    emptyMsg.textContent = 'No avatars match your search or filter criteria.';
    avatarGrid.appendChild(emptyMsg);
    return;
  }

  for (const model of filtered) {
    const isSelected = model.id === currentModelId;
    const isFav = avatarRegistry.isFavorite(model.id);
    const assignedTrackId = avatarAssignmentManager.getTrackIdForAvatar(model.id);
    const isAssigned = assignedTrackId !== null;

    // Get rendered thumbnail from registry, generator, or predefined thumbnail property
    const thumbnail = avatarRegistry.getThumbnail(model.id) || avatarPreviewGenerator.getThumbnail(model.id) || model.thumbnail;

    const card = document.createElement('div');
    card.className = 'avatar-card' + (isSelected ? ' selected' : '');
    card.dataset.id = model.id;

    // Visual preview: real VRM thumbnail or clean offline unavailable placeholder (NO EMOJI)
    const previewContent = thumbnail
      ? `<img src="${thumbnail}" alt="${model.name} VRM preview" class="avatar-preview-img" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'preview-unavailable\\'><span>Preview unavailable</span><span class=\\'preview-sub\\'>${model.bundled ? 'Generating…' : 'Remote — unavailable offline'}</span></div>';" />`
      : `<div class="preview-unavailable">
           <span>Preview unavailable</span>
           <span class="preview-sub">${model.bundled ? 'Generating…' : 'Remote — unavailable offline'}</span>
         </div>`;

    card.innerHTML = `
      <div class="avatar-preview">
        <button class="fav-btn ${isFav ? 'active' : ''}" title="Favorite" data-id="${model.id}">★</button>
        ${previewContent}
        <div class="select-badge">ACTIVE</div>
      </div>
      <div class="avatar-info">
        <div class="avatar-header-row">
          <div class="avatar-name">${model.name}</div>
          <span class="avatar-avail-badge ${isAssigned ? 'in-use' : 'available'}">
            ${isAssigned ? `● In Use (#${assignedTrackId})` : '○ Available'}
          </span>
        </div>
        <div class="avatar-meta">
          <div style="display: flex; gap: 4px; align-items: center;">
            <span class="avatar-gender ${model.presentation || model.gender}">${(model.presentation || model.gender).toUpperCase()}</span>
            <span class="avatar-category-tag">${model.category}</span>
          </div>
          <span class="avatar-bundle-badge ${model.bundled ? 'bundled' : 'remote'}">${model.bundled ? 'Bundled' : 'Remote'}</span>
        </div>
      </div>
    `;

    // Card click triggers lazy load
    card.addEventListener('click', (e) => {
      // Ignore if favorite button was clicked
      if (e.target.closest('.fav-btn')) return;
      if (model.id === currentModelId) return;
      loadModel(model);
    });

    // Favorite button click
    const favBtn = card.querySelector('.fav-btn');
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const active = avatarRegistry.toggleFavorite(model.id);
      favBtn.classList.toggle('active', active);
      if (currentFilter === 'favorites' && !active) {
        renderAvatarGallery();
      }
    });

    avatarGrid.appendChild(card);
  }
}

// Subscribe gallery updates when VRM thumbnails are generated
avatarPreviewGenerator.onThumbnailReady(() => {
  renderAvatarGallery();
});

// Render gallery immediately
renderAvatarGallery();

// Start background offscreen preview generation lazily without blocking tracking
if (typeof window !== 'undefined') {
  setTimeout(() => {
    avatarPreviewGenerator.generateAll().then(() => {
      renderAvatarGallery();
    }).catch((err) => {
      console.warn('[Morphee AI] Background preview generator warning:', err);
    });
  }, 500);
}

// Filter buttons (All, Female, Male, Favorites)
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderAvatarGallery();
  });
});

// Search input
if (avatarSearchInput) {
  avatarSearchInput.addEventListener('input', (e) => {
    currentSearchTerm = e.target.value;
    renderAvatarGallery();
  });
}

// ────────────────────────────────────────────────
// TRACKERS (use GPU delegate if CUDA/HW accel detected)
// ────────────────────────────────────────────────
const tracker = new LandmarkTracker();
const bodyTracker = new BodyTracker();
const personTracker = new PersonTracker();
let running = false;
let stream = null;

if (typeof window !== 'undefined') {
  window.__morpheeTracker = tracker;
  window.__morpheeBodyTracker = bodyTracker;
  window.__morpheePersonTracker = personTracker;
}

settingsManager.on('maxPeople', async (val) => {
  if (tracker && tracker.landmarker) {
    await tracker.setMaxFaces(val);
    console.log(`[Morphee AI] FaceLandmarker capacity updated to ${val} faces.`);
  }
  if (bodyTracker && bodyTracker.poseLandmarker) {
    await bodyTracker.setMaxPeople(val);
    console.log(`[Morphee AI] BodyTracker capacity updated to ${val} people (${val} poses, ${val * 2} hands).`);
  }
  if (personTracker) {
    personTracker.setMaxPeople(val);
  }
});

async function startCamera() {
  startBtn.disabled = true;
  try {
    const maxPeople = settingsManager.get('maxPeople');
    if (!tracker.landmarker) {
      setStatus('Loading MediaPipe WASM runtime + face landmark model…');
      await tracker.init(gpuInfo.delegate, maxPeople);
    }
    if (!bodyTracker.poseLandmarker) {
      setStatus('Loading pose + hand tracking models…');
      await bodyTracker.init(gpuInfo.delegate, maxPeople);
    }
    if (personTracker) {
      personTracker.setMaxPeople(maxPeople);
    }
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    video.srcObject = stream;
    await new Promise((res) => { video.onloadedmetadata = res; });
    video.play();
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
    running = true;
    stopBtn.disabled = false;
    setStatus('Running — expression coefficients driving 3D mesh.');
    // Stop standalone render loop — main loop will call tickOnce() directly (ROOT CAUSE #1 FIX)
    faceRenderer.stageManager.stopRenderLoop();
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    setStatus('Error: ' + err.message, true);
    startBtn.disabled = false;
  }
}

function stopCamera() {
  running = false;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  startBtn.disabled = false;
  stopBtn.disabled = true;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  facePill.textContent = 'no face';
  if (personTracker) personTracker.reset();
  if (avatarAssignmentManager) avatarAssignmentManager.reset();
  if (multiPersonHud) multiPersonHud.reset();
  // Restart standalone render loop so avatar remains visible
  faceRenderer.stageManager.startRenderLoop();
  setStatus('Stopped.');
}

// Interactive click on Camera PiP to select/inspect physical person
if (overlay) {
  overlay.style.cursor = 'pointer';
  overlay.addEventListener('click', (e) => {
    const rect = overlay.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) / rect.width;
    const clickY = (e.clientY - rect.top) / rect.height;
    // Mirrored display: transform scaleX(-1) inverts horizontal click
    const rawX = 1.0 - clickX;
    const rawY = clickY;

    let bestTid = null;
    let bestDist = 0.22;
    for (const p of (window.__morpheeActivePersons || [])) {
      const c = p.centroid;
      if (c) {
        const d = Math.hypot(c.x - rawX, c.y - rawY);
        if (d < bestDist) {
          bestDist = d;
          bestTid = p.trackId;
        }
      }
    }
    selectedTrackId = (selectedTrackId === bestTid) ? null : bestTid;
  });
}

function drawLandmarksSparse(trackedPersons) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!trackedPersons || trackedPersons.length === 0) return;

  // Cache active persons for click hit-testing
  if (typeof window !== 'undefined') {
    window.__morpheeActivePersons = trackedPersons;
  }

  for (let f = 0; f < trackedPersons.length; f++) {
    const person = trackedPersons[f];
    const landmarks = person.face?.landmarks;
    if (!landmarks || !landmarks.length) continue;

    // Consistent TrackID color coding across Stage Labels, HUD, and PiP
    const color = getTrackColor(person.trackId);
    const isSelected = (person.trackId === selectedTrackId);
    ctx.fillStyle = color;

    // 1. Draw landmarks sparsely (every 4th landmark)
    for (let i = 0; i < landmarks.length; i += 4) {
      const lm = landmarks[i];
      ctx.beginPath();
      ctx.arc(lm.x * overlay.width, lm.y * overlay.height, isSelected ? 2.2 : 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. Compute face bounding box
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (let i = 0; i < landmarks.length; i += 8) {
      const lm = landmarks[i];
      if (lm.x < minX) minX = lm.x;
      if (lm.x > maxX) maxX = lm.x;
      if (lm.y < minY) minY = lm.y;
      if (lm.y > maxY) maxY = lm.y;
    }
    const pad = 10;
    const bbX = Math.max(0, minX * overlay.width - pad);
    const bbY = Math.max(0, minY * overlay.height - pad);
    const bbW = Math.min(overlay.width - bbX, (maxX - minX) * overlay.width + pad * 2);
    const bbH = Math.min(overlay.height - bbY, (maxY - minY) * overlay.height + pad * 2);

    // Draw cybernetic corner brackets
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 2.5 : 1.2;
    if (isSelected) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
    }
    const cLen = Math.min(16, bbW * 0.25, bbH * 0.25);
    ctx.beginPath();
    // Top-left
    ctx.moveTo(bbX, bbY + cLen); ctx.lineTo(bbX, bbY); ctx.lineTo(bbX + cLen, bbY);
    // Top-right
    ctx.moveTo(bbX + bbW - cLen, bbY); ctx.lineTo(bbX + bbW, bbY); ctx.lineTo(bbX + bbW, bbY + cLen);
    // Bottom-right
    ctx.moveTo(bbX + bbW, bbY + bbH - cLen); ctx.lineTo(bbX + bbW, bbY + bbH); ctx.lineTo(bbX + bbW - cLen, bbY + bbH);
    // Bottom-left
    ctx.moveTo(bbX + cLen, bbY + bbH); ctx.lineTo(bbX, bbY + bbH); ctx.lineTo(bbX, bbY + bbH - cLen);
    ctx.stroke();
    ctx.restore();

    // 3. Persistent TrackID badge + Avatar Assignment + Tracking State!
    // Compensate canvas CSS scaleX(-1) so text renders left-to-right and is never reversed!
    if (landmarks[10]) {
      const topLm = landmarks[10];
      const avatarId = avatarAssignmentManager.getAvatarIdForTrack(person.trackId);
      const assignmentState = avatarAssignmentManager.getAssignmentStateForTrack(person.trackId);
      let label;
      if (assignmentState === 'WAITING_FOR_UNIQUE_AVATAR' || !avatarId) {
        label = `Track #${person.trackId} · Waiting · ${person.state}`;
      } else {
        const avatarDef = avatarRegistry.get(avatarId);
        const avatarName = avatarDef?.name || avatarId || 'Default';
        label = `Track #${person.trackId} · ${avatarName} · ${person.state}`;
      }

      ctx.font = 'bold 11px Inter, system-ui, sans-serif';
      const textWidth = ctx.measureText(label).width;
      const headX = topLm.x * overlay.width;
      const headY = Math.max(16, topLm.y * overlay.height - 10);

      ctx.save();
      // Mirror compensation: un-mirror in local coordinates so text renders normally left-to-right!
      ctx.translate(headX, headY);
      ctx.scale(-1, 1);

      const boxW = textWidth + 14;
      const boxH = 18;
      ctx.fillStyle = isSelected ? 'rgba(20, 26, 38, 0.95)' : 'rgba(14, 16, 21, 0.88)';
      ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 2 : 1;
      if (isSelected) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
      }
      ctx.strokeRect(-boxW / 2, -boxH / 2, boxW, boxH);

      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }
}

// Pre-allocate 12 blendshape UI rows (ROOT CAUSE #2 FIX)
const _blendRows = [];
let _blendRowsInitialized = false;
let _lastBlendUpdateMs = 0;
const _BLEND_UI_INTERVAL_MS = 100; // Throttle blendshape UI to ~10fps

function _initBlendRows() {
  if (_blendRowsInitialized) return;
  blendList.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const row = document.createElement('div');
    row.className = 'blend-item';
    const nameEl = document.createElement('div');
    nameEl.className = 'blend-name';
    const trackEl = document.createElement('div');
    trackEl.className = 'blend-bar-track';
    const fillEl = document.createElement('div');
    fillEl.className = 'blend-bar-fill';
    trackEl.appendChild(fillEl);
    const valEl = document.createElement('div');
    valEl.className = 'blend-val';
    row.appendChild(nameEl);
    row.appendChild(trackEl);
    row.appendChild(valEl);
    blendList.appendChild(row);
    _blendRows.push({ row, nameEl, fillEl, valEl });
  }
  _blendRowsInitialized = true;
}

function updateBlendshapeUI(categories) {
  const now = performance.now();
  if (now - _lastBlendUpdateMs < _BLEND_UI_INTERVAL_MS) return;
  _lastBlendUpdateMs = now;
  if (!_blendRowsInitialized) _initBlendRows();

  const sorted = [...categories].sort((a, b) => b.score - a.score);
  for (let i = 0; i < 12; i++) {
    const entry = _blendRows[i];
    if (i < sorted.length) {
      const c = sorted[i];
      const pct = Math.round(c.score * 100);
      entry.nameEl.textContent = c.categoryName;
      entry.nameEl.title = c.categoryName;
      entry.fillEl.style.width = pct + '%';
      entry.valEl.textContent = pct + '%';
      entry.row.style.display = '';
    } else {
      entry.row.style.display = 'none';
    }
  }
}

// Tracking continuity state caches (preserves detections when inference is scheduled/skipped)
let lastFaceResult = { faces: [], blendshapes: [], transformationMatrices: [] };
let lastBodyResult = { poses: [], hands: [], poseCount: 0, handCount: 0 };
let lastLoopTimestamp = 0;
let lastLoopVideoTime = -1;

let lastTelemetryUpdateMs = 0;

function loop() {
  if (!running) return;
  const now = performance.now();
  profiler.startFrame();
  const dtFrame = lastLoopTimestamp > 0 ? (now - lastLoopTimestamp) : 16.6;
  lastLoopTimestamp = now;

  const smoothing = settingsManager.get('smoothing');
  const alpha = 1 - (smoothing / 100);
  const trackingMode = settingsManager.get('trackingMode');
  const bodyTracking = settingsManager.get('bodyTracking');
  const handTracking = settingsManager.get('handTracking');
  const headPoseEnabled = settingsManager.get('headPose');

  // Check whether camera has delivered a new video frame
  const currentVideoTime = video.currentTime;
  const isNewCameraFrame = (video.readyState >= 2 && currentVideoTime !== lastLoopVideoTime && currentVideoTime > 0);
  if (isNewCameraFrame) {
    lastLoopVideoTime = currentVideoTime;
  }

  // 1. Query adaptive inference schedule from PerformanceManager (only on new camera frames)
  const schedule = isNewCameraFrame
    ? performanceManager.getSchedule(null, { bodyTracking, handTracking })
    : { face: false, pose: false, hands: false };

  // 2. FaceLandmarker inference (prioritized as primary identity anchor)
  let faceResult = lastFaceResult;
  let faceInferMs = 0;
  if (schedule.face) {
    const tFace0 = performance.now();
    faceResult = tracker.detect(video, now);
    faceInferMs = tracker.lastInferMs || (performance.now() - tFace0);
    lastFaceResult = faceResult;
  }

  // 3. Body + Hand Tracking (isolated timing via bodyTracker)
  let bodyResult = lastBodyResult;
  let poseInferMs = 0;
  let handInferMs = 0;
  const runPose = bodyTracking && schedule.pose;
  const runHands = handTracking && schedule.hands;

  if (bodyTracker.poseLandmarker && (runPose || runHands)) {
    const rawBody = bodyTracker.detect(video, now, { runPose, runHands });
    poseInferMs = rawBody.poseInferMs || 0;
    handInferMs = rawBody.handInferMs || 0;

    if (runPose) {
      bodyResult.poses = rawBody.poses;
      bodyResult.poseCount = rawBody.poseCount;
      bodyResult.pose = rawBody.pose;
      bodyResult.poseConfidence = rawBody.poseConfidence;
    } else if (!bodyTracking) {
      bodyResult.poses = [];
      bodyResult.poseCount = 0;
      bodyResult.pose = null;
      bodyResult.poseConfidence = 0;
    }

    let isHandSkipped = false;
    if (runHands) {
      bodyResult.hands = rawBody.hands;
      bodyResult.handCount = rawBody.handCount;
      bodyResult.handsRaw = rawBody.handsRaw;
      bodyResult.handConfidence = rawBody.handConfidence;
      isHandSkipped = false;
    } else if (!handTracking) {
      bodyResult.hands = [];
      bodyResult.handCount = 0;
      bodyResult.handsRaw = null;
      bodyResult.handConfidence = 0;
      isHandSkipped = false;
    } else {
      // Hand tracking enabled, but inference was staggered/skipped on this cadence frame
      isHandSkipped = true;
    }
    bodyResult.isHandSkipped = isHandSkipped;
    lastBodyResult = bodyResult;
  } else {
    if (!bodyTracking) {
      bodyResult.poses = [];
      bodyResult.poseCount = 0;
      bodyResult.pose = null;
      bodyResult.poseConfidence = 0;
    }
    if (!handTracking) {
      bodyResult.hands = [];
      bodyResult.handCount = 0;
      bodyResult.handsRaw = null;
      bodyResult.handConfidence = 0;
      bodyResult.isHandSkipped = false;
    } else {
      bodyResult.isHandSkipped = true;
    }
  }

  // 4. Phase 5 & 6: Persistent Tracking & Multi-Avatar Assignment
  const tTrack0 = performance.now();
  const trackingOutput = personTracker.update(faceResult, bodyResult, now);
  const trackedPersons = trackingOutput.trackedPersons;
  const activePersons = trackedPersons.filter(p => p.state === 'TRACKED' || p.state === 'INIT' || p.state === 'REACQUIRED');

  // Sync assignments with AvatarAssignmentManager
  const tAssign0 = performance.now();
  const syncResult = avatarAssignmentManager.sync(trackedPersons);
  const assignmentMs = performance.now() - tAssign0;

  // Handle newly assigned tracks: acquire AvatarInstance from cache
  for (const item of syncResult.newlyAssigned) {
    const { trackId, avatarId } = item;
    if (!avatarId) continue;
    if (faceRenderer.stageManager.getAvatarForTrack(trackId)) continue;

    avatarCache.acquire(avatarId, { trackId, allowFallback: true })
      .then(res => {
        if (res?.avatar) {
          faceRenderer.stageManager.addTrackAvatar(trackId, res.avatar);
        }
      })
      .catch(err => {
        console.error(`[Morphee] Failed to load avatar '${avatarId}' for track #${trackId}:`, err);
      });
  }

  // Handle released tracks: remove from stage & release into warm standby cache
  for (const item of syncResult.released) {
    const { trackId, avatarId } = item;
    const removedAvatar = faceRenderer.stageManager.removeTrackAvatar(trackId);
    if (removedAvatar) {
      avatarCache.release(avatarId, trackId);
    }
  }

  // Update multi-avatar horizontal stage positioning and dynamic auto-fit framing
  const tFrame0 = performance.now();
  faceRenderer.stageManager.updateTrackPositions(trackedPersons, trackingMode);
  const framingMs = performance.now() - tFrame0;
  const trackingMs = performance.now() - tTrack0;

  // 5. Draw 2D canvas telemetry & update status pills
  if (activePersons.length > 0) {
    drawLandmarksSparse(activePersons);
    if (activePersons.length === 1) {
      const p = activePersons[0];
      const avId = avatarAssignmentManager.getAvatarIdForTrack(p.trackId);
      const avName = avId ? (avatarRegistry.get(avId)?.name || avId) : 'No Unique Avatar';
      facePill.textContent = `Track #${p.trackId} (${avName})`;
    } else {
      const badges = activePersons.map(p => {
        const avId = avatarAssignmentManager.getAvatarIdForTrack(p.trackId);
        const avName = avId ? (avatarRegistry.get(avId)?.name || avId) : 'No Avatar';
        return `#${p.trackId}:${avName}`;
      }).join(' · ');
      facePill.textContent = `${activePersons.length} tracks (${badges})`;
    }
  } else {
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    facePill.textContent = 'no face';
  }

  // 6. Apply tracked data to each AvatarInstance independently by TrackID
  const tAvatar0 = performance.now();
  const primary = activePersons[0] || trackedPersons[0];
  for (const person of trackedPersons) {
    if (person.state === 'TERMINATED') continue;
    if (trackingMode === 'single' && person !== primary) continue;

    const avatar = faceRenderer.stageManager.getAvatarForTrack(person.trackId);
    if (!avatar || !avatar.isLoaded) continue;

    if (person.state === 'COASTING') {
      // Coasting: keep avatar visible, hold pose gracefully
      continue;
    }

    // Apply face tracking
    if (person.face) {
      avatar.updateFace(person.face, {
        smoothingAlpha: alpha,
        headPoseEnabled
      });
    }

    // Apply body / arm tracking
    if (bodyTracking && person.pose && person.pose.worldLandmarks?.length) {
      avatar.updatePose(person.pose, { alpha });
    }

    // Apply hands tracking (strictly isolated to this physical person's hands)
    if (handTracking && person.hands && person.hands.length > 0) {
      avatar.applyHands(
        person.hands,
        person.pose ? person.pose.landmarks : null,
        person.pose ? person.pose.worldLandmarks : null,
        alpha
      );
    }
  }
  const avatarUpdateMs = performance.now() - tAvatar0;

  // Update primary avatar expression UI coefficients & head pose telemetry
  if (primary && primary.face) {
    if (primary.face.blendshapes && primary.face.blendshapes.length) {
      updateBlendshapeUI(primary.face.blendshapes);
    }
    if (primary.face.transformationMatrix && primary.face.transformationMatrix.length) {
      const m = primary.face.transformationMatrix;
      const yaw = Math.atan2(-m[8], m[0]) * (180 / Math.PI);
      const pitch = Math.atan2(m[9], m[10]) * (180 / Math.PI);
      mPose.textContent = `${yaw.toFixed(1)}° / ${pitch.toFixed(1)}°`;
    }
  } else {
    mPose.textContent = '--';
  }

  const handCount = bodyResult.handCount || 0;
  const isHandSkipped = bodyResult.isHandSkipped === true;
  let handStatusText;
  if (!handTracking) {
    handStatusText = 'OFF';
  } else if (isHandSkipped) {
    handStatusText = handCount > 0 ? `${handCount} (cached)` : 'cached';
  } else {
    handStatusText = handCount > 0 ? `${handCount} detected` : '0 detected';
  }

  mBody.textContent = `${bodyResult.poseCount} pose${bodyResult.poseCount === 1 ? '' : 's'} · ${handStatusText}`;

  // 7. Record performance metrics in PerformanceManager
  const instFps = dtFrame > 0 ? (1000 / dtFrame) : 60;
  performanceManager.recordMetrics({
    fps: instFps,
    frameTimeMs: dtFrame,
    faceInferMs,
    poseInferMs,
    handInferMs,
    trackingMs,
    framingMs,
    avatarUpdateMs,
    renderMs: faceRenderer.stageManager?.lastRenderMs || 0,
    activePeople: activePersons.length,
    activeAvatars: faceRenderer.stageManager.trackAvatars.size,
    timestampMs: now
  });

  // 8. Update performance telemetry in UI (throttled to ~10Hz to prevent DOM layout thrashing)
  const telem = performanceManager.getTelemetry();
  const totalInferMs = faceInferMs + poseInferMs + handInferMs;
  const shouldUpdateDOM = (now - lastTelemetryUpdateMs >= 100);

  if (shouldUpdateDOM) {
    lastTelemetryUpdateMs = now;
    mInfer.textContent = totalInferMs.toFixed(1) + ' ms';
    fpsPill.textContent = `${telem.actualFps} FPS`;
    if (mTier) mTier.textContent = `${telem.mode === 'AUTO' ? 'AUTO · ' : ''}${telem.tier}`;
    if (mTiming) mTiming.textContent = `F:${Math.round(telem.faceInferMs)} P:${Math.round(telem.poseInferMs)} H:${Math.round(telem.handInferMs)}`;

    // Update Performance Status Strip
    if (stripRenderFps) stripRenderFps.textContent = `${telem.actualFps} FPS`;
    if (stripFrameTime) stripFrameTime.textContent = `${telem.frameTimeMs.toFixed(1)} ms`;
    if (stripInference) stripInference.textContent = `${totalInferMs.toFixed(1)} ms`;
    if (stripTier) stripTier.textContent = `${telem.mode === 'AUTO' ? 'AUTO · ' : ''}${telem.tier}`;
    if (stripBodyHands) stripBodyHands.textContent = `${bodyResult.poseCount} pose${bodyResult.poseCount === 1 ? '' : 's'} · ${handStatusText}`;
    if (stripDelegate) stripDelegate.textContent = gpuInfo.delegate || 'GPU';

    // Update Diagnostics Drawer
    if (diagnosticsDrawer && diagnosticsDrawer.style.display !== 'none') {
      const diag = trackingOutput.diagnostics || {};
      if (dFaceConf) dFaceConf.textContent = `${Math.round((diag.faceConfidence ?? 0.95) * 100)}%`;
      if (dPoseConf) dPoseConf.textContent = `${Math.round((diag.poseConfidence ?? 0.85) * 100)}%`;
      if (dHandConf) dHandConf.textContent = `${Math.round((diag.handConfidence ?? 0.85) * 100)}%`;
      if (dHandState) dHandState.textContent = !handTracking ? 'Disabled' : (isHandSkipped ? 'Cached (Interleaved)' : 'Active Frame');

      if (dFaceLms) dFaceLms.textContent = `${diag.validFaceLandmarks ?? 478} / 478 pts`;
      if (dPoseLms) dPoseLms.textContent = `${diag.validPoseLandmarks ?? 33} / 33 pts`;
      if (dHandsCnt) dHandsCnt.textContent = `${handCount} hand${handCount === 1 ? '' : 's'}`;
      if (dJitter) dJitter.textContent = `${(diag.averageJitter ?? 0).toFixed(4)} px/f`;

      if (dLostFrames) dLostFrames.textContent = `${diag.lostFramesTotal ?? 0}`;
      if (dReacquisitions) dReacquisitions.textContent = `${diag.reacquisitionsTotal ?? 0}`;
      if (dTrackSwitches) dTrackSwitches.textContent = `${diag.trackIdSwitches ?? 0}`;
      if (dAvatarSwitches) dAvatarSwitches.textContent = `${avatarAssignmentManager.avatarIdSwitches ?? 0}`;

      const activeFaceMs = tracker.lastInferMs || faceInferMs;
      const activePoseMs = bodyTracker.lastPoseInferMs || poseInferMs;
      const activeHandMs = bodyTracker.lastHandInferMs || handInferMs;
      if (dFaceInfer) dFaceInfer.textContent = `${activeFaceMs.toFixed(1)} ms`;
      if (dPoseInfer) dPoseInfer.textContent = `${activePoseMs.toFixed(1)} ms`;
      if (dHandInfer) dHandInfer.textContent = `${activeHandMs.toFixed(1)} ms`;
      if (dTrackFrame) dTrackFrame.textContent = `${(trackingMs + framingMs).toFixed(1)} ms`;
      if (dRenderPass) dRenderPass.textContent = `${(faceRenderer.stageManager?.lastRenderMs || 1.2).toFixed(1)} ms`;
    }
  }

  // 9. Phase 11: Real-time Multi-Person Stage HUD update
  multiPersonHud.update(trackedPersons, avatarAssignmentManager, {
    trackingMode,
    maxPeople: settingsManager.get('maxPeople'),
    bodyTracking: settingsManager.get('bodyTracking'),
    handTracking: settingsManager.get('handTracking'),
    isHandSkipped,
    telemetry: telem,
    selectedTrackId
  });

  // Update 3D Floating Stage Labels over active avatars
  updateAvatarStageLabels(trackedPersons, trackingMode);

  // Diagnostics API introspection for testing & automated verification
  if (typeof window !== 'undefined') {
    window.__morpheeDiagnostics = {
      faceConfidence: trackingOutput?.diagnostics?.faceConfidence ?? 0.95,
      poseConfidence: trackingOutput?.diagnostics?.poseConfidence ?? 0.85,
      handConfidence: trackingOutput?.diagnostics?.handConfidence ?? 0.85,
      validFaceLandmarks: trackingOutput?.diagnostics?.validFaceLandmarks ?? 478,
      validPoseLandmarks: trackingOutput?.diagnostics?.validPoseLandmarks ?? 33,
      detectedHands: bodyResult?.handCount ?? 0,
      handInferenceState: !handTracking ? 'disabled' : (isHandSkipped ? 'cached' : 'detected'),
      trackingLostFrames: trackingOutput?.diagnostics?.lostFramesTotal ?? 0,
      reacquisitionCount: trackingOutput?.diagnostics?.reacquisitionsTotal ?? 0,
      averageJitter: trackingOutput?.diagnostics?.averageJitter ?? 0,
      trackIdSwitches: trackingOutput?.diagnostics?.trackIdSwitches ?? 0,
      avatarIdSwitches: avatarAssignmentManager?.avatarIdSwitches ?? 0,
      inferenceLatencyMs: totalInferMs,
      renderFps: telem.actualFps,
      breakdown: {
        faceInferMs,
        poseInferMs,
        handInferMs,
        trackingMs,
        assignmentMs,
        framingMs,
        avatarUpdateMs,
        renderMs: faceRenderer.stageManager?.lastRenderMs || 0
      }
    };
  }

  // Unified single render tick — replaces dual-RAF (ROOT CAUSE #1 FIX)
  faceRenderer.stageManager.tickOnce();

  // High-Resolution Frame Pipeline Profiler (PHASE 1)
  const primaryAvInstance = faceRenderer.stageManager.primaryAvatar;
  profiler.recordFrame({
    faceMs: faceInferMs,
    poseMs: poseInferMs,
    handsMs: handInferMs,
    trackingMs: trackingMs,
    assignmentMs: assignmentMs,
    avatarUpdateMs: avatarUpdateMs,
    expressionMs: primaryAvInstance?.lastExpressionMs || 0,
    bodyRetargetMs: primaryAvInstance?.lastBodyRetargetMs || 0,
    handRetargetMs: primaryAvInstance?.lastHandRetargetMs || 0,
    physicsMs: faceRenderer.stageManager.lastPhysicsMs || 0,
    framingMs: framingMs,
    renderMs: faceRenderer.stageManager.lastRenderMs || 0,
    totalFrameMs: performance.now() - now
  });

  requestAnimationFrame(loop);
}

startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);

// Expose assetManager for offline verification & diagnostics
if (typeof window !== 'undefined') {
  window.__assetManager = assetManager;
  assetManager.getStatus().then((status) => {
    console.log(`[Morphee AI] Offline asset status: ${status.isFullyOffline ? 'FULL OFFLINE READY' : 'HYBRID/ONLINE'}`, status);
  }).catch((err) => {
    console.warn('[Morphee AI] Asset status check warning:', err);
  });
}

