import { LandmarkTracker } from './modules/landmarkTracker.js';
import { BodyTracker } from './modules/bodyTracker.js';
import { PersonTracker } from './modules/tracking/personTracker.js';
import { VrmRenderer as FaceRenderer } from './modules/vrmRenderer.js';
import { detectGPU, populateGPUInfo } from './modules/gpuDetect.js';
import { assetManager } from './modules/core/assetManager.js';
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
const dRigAudit = document.getElementById('dRigAudit');
const dHandTrackSupport = document.getElementById('dHandTrackSupport');
const dFingerBones = document.getElementById('dFingerBones');
const dDecayState = document.getElementById('dDecayState');
const dSelectMode = document.getElementById('dSelectMode');
const dEstCategory = document.getElementById('dEstCategory');
const dCategoryConf = document.getElementById('dCategoryConf');
const dAllocReason = document.getElementById('dAllocReason');

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
  });
});

import { avatarRegistry } from './modules/library/avatarRegistry.js';
import { avatarCache } from './modules/library/avatarCache.js';
import { avatarPreviewGenerator } from './modules/library/avatarPreviewGenerator.js';
import { avatarAssignmentManager } from './modules/tracking/avatarAssignmentManager.js';
import { performanceManager } from './modules/performance/performanceManager.js';
import { settingsManager } from './modules/core/settingsManager.js';
import { MultiPersonHUD } from './modules/ui/multiPersonHud.js';
import { enhanceSelects } from './modules/ui/customDropdown.js';

// ────────────────────────────────────────────────
// 3D RENDERER & HUD
// ────────────────────────────────────────────────
const faceRenderer = new FaceRenderer(renderCanvas);
faceRenderer.onRenderFps = (fps) => { mRenderFps.textContent = fps.toFixed(0); };
faceRenderer.resize();
faceRenderer.startRenderLoop();

const multiPersonHud = new MultiPersonHUD();

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
}

// ────────────────────────────────────────────────
// SETTINGS INITIALIZATION & SUBSCRIPTIONS
// ────────────────────────────────────────────────
// 1. Establish two-way binding between UI elements and settingsManager
settingsManager.bindUI(document);

// Enhance native styled selects with accessible dark custom UI
enhanceSelects('select.styled-select');

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
  setStatus('Stopped.');
}

// Color palette for multiple face overlays (sleek cyberpunk / telemetry tones)
const FACE_OVERLAY_COLORS = [
  '#4fd1c5', // Face 0: Cyan
  '#9f7aea', // Face 1: Purple
  '#f6ad55', // Face 2: Amber
  '#f687b3', // Face 3: Rose Pink
  '#63b3ed', // Face 4: Sky Blue
  '#48bb78', // Face 5: Emerald Green
  '#ed8936', // Face 6: Orange
  '#b794f4'  // Face 7: Violet
];

function drawLandmarksSparse(trackedPersons) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!trackedPersons || trackedPersons.length === 0) return;

  for (let f = 0; f < trackedPersons.length; f++) {
    const person = trackedPersons[f];
    const landmarks = person.face?.landmarks;
    if (!landmarks || !landmarks.length) continue;

    // Use trackId for consistent color assignment across frames
    const color = FACE_OVERLAY_COLORS[(person.trackId - 1) % FACE_OVERLAY_COLORS.length];
    ctx.fillStyle = color;

    // Draw all 478 nodes for each detected face
    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      ctx.beginPath();
      ctx.arc(lm.x * overlay.width, lm.y * overlay.height, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Persistent TrackID badge + Avatar Assignment + Tracking State!
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
      const headY = Math.max(16, topLm.y * overlay.height - 8);

      ctx.save();
      // Mirror compensation: un-mirror in local coordinates so text renders normally left-to-right!
      ctx.translate(headX, headY);
      ctx.scale(-1, 1);

      const boxW = textWidth + 14;
      const boxH = 18;
      ctx.fillStyle = 'rgba(14, 16, 21, 0.88)';
      ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(-boxW / 2, -boxH / 2, boxW, boxH);

      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }
}

function updateBlendshapeUI(categories) {
  const sorted = [...categories].sort((a, b) => b.score - a.score).slice(0, 12);
  blendList.innerHTML = '';
  for (const c of sorted) {
    const pct = Math.round(c.score * 100);
    const row = document.createElement('div');
    row.className = 'blend-item';
    row.innerHTML = `
      <div class="blend-name" title="${c.categoryName}">${c.categoryName}</div>
      <div class="blend-bar-track"><div class="blend-bar-fill" style="width:${pct}%"></div></div>
      <div class="blend-val">${pct}%</div>`;
    blendList.appendChild(row);
  }
}

// Tracking continuity state caches (preserves detections when inference is scheduled/skipped)
let lastFaceResult = { faces: [], blendshapes: [], transformationMatrices: [] };
let lastBodyResult = { poses: [], hands: [], poseCount: 0, handCount: 0 };
let lastLoopTimestamp = 0;

function loop() {
  if (!running) return;
  const now = performance.now();
  const dtFrame = lastLoopTimestamp > 0 ? (now - lastLoopTimestamp) : 16.6;
  lastLoopTimestamp = now;

  const smoothing = settingsManager.get('smoothing');
  const alpha = 1 - (smoothing / 100);
  const trackingMode = settingsManager.get('trackingMode');
  const bodyTracking = settingsManager.get('bodyTracking');
  const handTracking = settingsManager.get('handTracking');
  const headPoseEnabled = settingsManager.get('headPose');

  // 1. Query adaptive inference schedule from PerformanceManager
  const schedule = performanceManager.getSchedule();

  // 2. FaceLandmarker inference (prioritized as primary identity anchor)
  let faceResult = lastFaceResult;
  let faceInferMs = 0;
  if (schedule.face) {
    const tFace0 = performance.now();
    faceResult = tracker.detect(video, now);
    faceInferMs = performance.now() - tFace0;
    lastFaceResult = faceResult;
  }

  // 3. Body + Hand Tracking (staggered / alternating according to quality tier & settings)
  let bodyResult = lastBodyResult;
  let poseInferMs = 0;
  let handInferMs = 0;
  const runPose = bodyTracking && schedule.pose;
  const runHands = handTracking && schedule.hands;

  if (bodyTracker.poseLandmarker && (runPose || runHands)) {
    const tBody0 = performance.now();
    const rawBody = bodyTracker.detect(video, now, { runPose, runHands });
    const tBody1 = performance.now();
    const totalBodyMs = tBody1 - tBody0;
    poseInferMs = runPose ? (runHands ? totalBodyMs * 0.55 : totalBodyMs) : 0;
    handInferMs = runHands ? (runPose ? totalBodyMs * 0.45 : totalBodyMs) : 0;

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
  const syncResult = avatarAssignmentManager.sync(trackedPersons);

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

    // Apply hands tracking
    if (handTracking && person.hands && person.hands.length > 0) {
      avatar.applyHands(
        person.hands,
        person.pose ? person.pose.landmarks : null,
        person.pose ? person.pose.worldLandmarks : null,
        alpha
      );
    } else {
      // Smoothly decay hands when no hands detected or hand tracking disabled
      avatar.decayHands(dtFrame / 1000);
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

  // 8. Update performance telemetry in UI (distinguishing RENDER FPS from INFERENCE latency)
  const telem = performanceManager.getTelemetry();
  const totalInferMs = faceInferMs + poseInferMs + handInferMs;
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

    if (dFaceInfer) dFaceInfer.textContent = `${faceInferMs.toFixed(1)} ms`;
    if (dPoseInfer) dPoseInfer.textContent = `${poseInferMs.toFixed(1)} ms`;
    if (dHandInfer) dHandInfer.textContent = `${handInferMs.toFixed(1)} ms`;
    if (dTrackFrame) dTrackFrame.textContent = `${(trackingMs + framingMs).toFixed(1)} ms`;
    if (dRenderPass) dRenderPass.textContent = `${(faceRenderer.stageManager?.lastRenderMs || 1.2).toFixed(1)} ms`;

    // Update Rig Audit & Hand Retargeting telemetry
    const primaryAvatar = faceRenderer.stageManager.primaryAvatar;
    if (primaryAvatar?.rigAudit) {
      const rig = primaryAvatar.rigAudit;
      if (dRigAudit) dRigAudit.textContent = `VRM ${rig.vrmVersion} (${primaryAvatar.id})`;
      if (dHandTrackSupport) dHandTrackSupport.textContent = rig.supportedHandTracking;
      if (dFingerBones) dFingerBones.textContent = `${rig.fingerBonesCount} / 40 pts`;
    }
    const hasActiveHands = (primary?.hands?.length || 0) > 0;
    if (dDecayState) dDecayState.textContent = hasActiveHands ? 'Active Tracking' : 'Rest Decay / Neutral';

    // Update Auto Presentation Category telemetry
    const assignDiag = avatarAssignmentManager.getDiagnostics();
    const primaryAssign = assignDiag.assigned.find(a => a.trackId === primary?.trackId) || assignDiag.assigned[0];
    if (dSelectMode) dSelectMode.textContent = avatarAssignmentManager.selectionMode === 'auto_category' ? 'Auto Category' : 'Manual';
    if (dEstCategory) dEstCategory.textContent = primaryAssign?.category ? (primaryAssign.category.charAt(0).toUpperCase() + primaryAssign.category.slice(1)) : 'Neutral';
    if (dCategoryConf) dCategoryConf.textContent = primaryAssign?.categoryConfidence ? `${Math.round(primaryAssign.categoryConfidence * 100)}%` : '--';
    if (dAllocReason) dAllocReason.textContent = primaryAssign?.selectionReason || 'MANUAL';
  }

  // 9. Phase 11: Real-time Multi-Person Stage HUD update
  multiPersonHud.update(trackedPersons, avatarAssignmentManager, {
    trackingMode,
    maxPeople: settingsManager.get('maxPeople'),
    bodyTracking: settingsManager.get('bodyTracking'),
    handTracking: settingsManager.get('handTracking'),
    isHandSkipped,
    telemetry: telem
  });

  // Diagnostics API introspection for testing & automated verification
  const primaryAvatarInstance = faceRenderer.stageManager.primaryAvatar;
  const assignDiagObj = avatarAssignmentManager.getDiagnostics();
  const primaryAssignRec = assignDiagObj.assigned.find(a => a.trackId === primary?.trackId) || assignDiagObj.assigned[0];

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
      rigAudit: primaryAvatarInstance?.rigAudit || null,
      presentationDiagnostics: {
        selectionMode: avatarAssignmentManager.selectionMode,
        primaryCategory: primaryAssignRec?.category || 'neutral',
        primaryCategoryConfidence: primaryAssignRec?.categoryConfidence || 0,
        primarySelectionReason: primaryAssignRec?.selectionReason || 'MANUAL'
      },
      breakdown: {
        faceInferMs,
        poseInferMs,
        handInferMs,
        trackingMs,
        framingMs,
        avatarUpdateMs,
        renderMs: faceRenderer.stageManager?.lastRenderMs || 0
      }
    };
  }

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

