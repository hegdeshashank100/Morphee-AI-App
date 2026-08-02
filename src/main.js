import { LandmarkTracker } from './modules/landmarkTracker.js';
import { BodyTracker } from './modules/bodyTracker.js';
import { VrmRenderer as FaceRenderer } from './modules/vrmRenderer.js';
import { detectGPU, populateGPUInfo } from './modules/gpuDetect.js';
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
const loadingOverlay = document.getElementById('loadingOverlay');
const renderCanvas = document.getElementById('renderCanvas');
const activeModelPill = document.getElementById('activeModelPill');
const avatarGrid = document.getElementById('avatarGrid');

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

// ────────────────────────────────────────────────
// 3D RENDERER
// ────────────────────────────────────────────────
const faceRenderer = new FaceRenderer(renderCanvas);
faceRenderer.onRenderFps = (fps) => { mRenderFps.textContent = fps.toFixed(0); };
faceRenderer.resize();
faceRenderer.startRenderLoop();

// Track which model is currently selected
let currentModelId = AVATAR_MODELS[0].id;

async function loadModel(modelDef) {
  loadingOverlay.style.display = 'flex';
  if (activeModelPill) activeModelPill.textContent = 'Loading…';

  try {
    const count = await faceRenderer.loadRig(modelDef.url);
    loadingOverlay.style.display = 'none';
    renderStatus.textContent = `${modelDef.name} loaded — ${count} expressions ready.`;
    if (activeModelPill) activeModelPill.textContent = modelDef.name;
    currentModelId = modelDef.id;

    // Update gallery selection UI
    document.querySelectorAll('.avatar-card').forEach(c => c.classList.remove('selected'));
    const card = document.querySelector(`.avatar-card[data-id="${modelDef.id}"]`);
    if (card) card.classList.add('selected');
  } catch (err) {
    console.error(err);
    loadingOverlay.innerHTML = `<span>Failed to load: ${err.message}</span>`;
    if (activeModelPill) activeModelPill.textContent = 'Error';
  }
}

// Load default model
loadModel(AVATAR_MODELS[0]);

// ────────────────────────────────────────────────
// AVATAR GALLERY
// ────────────────────────────────────────────────
function renderAvatarGallery(filter = 'all') {
  if (!avatarGrid) return;
  avatarGrid.innerHTML = '';

  const filtered = filter === 'all'
    ? AVATAR_MODELS
    : AVATAR_MODELS.filter(m => m.gender === filter);

  for (const model of filtered) {
    const card = document.createElement('div');
    card.className = 'avatar-card' + (model.id === currentModelId ? ' selected' : '');
    card.dataset.id = model.id;
    card.innerHTML = `
      <div class="avatar-preview">
        <span class="avatar-emoji">${model.emoji}</span>
        <div class="select-badge">ACTIVE</div>
      </div>
      <div class="avatar-info">
        <div class="avatar-name">${model.name}</div>
        <div class="avatar-meta">
          <span class="avatar-gender ${model.gender}">${model.gender}</span>
          <span>${model.source}</span>
        </div>
      </div>
    `;
    card.addEventListener('click', () => {
      if (model.id === currentModelId) return; // Already loaded
      loadModel(model);
    });
    avatarGrid.appendChild(card);
  }
}

renderAvatarGallery();

// Filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderAvatarGallery(btn.dataset.filter);
  });
});

// ────────────────────────────────────────────────
// TRACKERS (use GPU delegate if CUDA/HW accel detected)
// ────────────────────────────────────────────────
const tracker = new LandmarkTracker();
const bodyTracker = new BodyTracker();
let running = false;
let stream = null;

async function startCamera() {
  startBtn.disabled = true;
  try {
    if (!tracker.landmarker) {
      setStatus('Loading MediaPipe WASM runtime + face landmark model…');
      await tracker.init(gpuInfo.delegate);
    }
    if (!bodyTracker.poseLandmarker) {
      setStatus('Loading pose + hand tracking models…');
      await bodyTracker.init(gpuInfo.delegate);
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
  setStatus('Stopped.');
}

function drawLandmarksSparse(landmarks) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.fillStyle = '#4fd1c5';
  // Draw all 478 nodes for maximum accuracy visualization
  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i];
    ctx.beginPath();
    ctx.arc(lm.x * overlay.width, lm.y * overlay.height, 1.5, 0, Math.PI * 2);
    ctx.fill();
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

function loop() {
  if (!running) return;
  const now = performance.now();
  const t0 = performance.now();
  const result = tracker.detect(video, now);
  mInfer.textContent = (performance.now() - t0).toFixed(1) + ' ms';

  const alpha = smoothRange ? (1 - smoothRange.value / 100) : 0.3; // Global temporal smoothing alpha

  if (result.faceLandmarks && result.faceLandmarks.length > 0) {
    drawLandmarksSparse(result.faceLandmarks[0]);
    facePill.textContent = 'face locked';

    if (result.faceBlendshapes && result.faceBlendshapes.length) {
      const categories = result.faceBlendshapes[0].categories;
      updateBlendshapeUI(categories);
      faceRenderer.applyBlendshapes(categories, alpha);
    }

    if (result.facialTransformationMatrixes && result.facialTransformationMatrixes.length) {
      const m = result.facialTransformationMatrixes[0].data;
      faceRenderer.applyHeadPose(m, poseToggle.checked);
      const yaw = Math.atan2(-m[8], m[0]) * (180 / Math.PI);
      const pitch = Math.atan2(m[9], m[10]) * (180 / Math.PI);
      mPose.textContent = `${yaw.toFixed(1)}° / ${pitch.toFixed(1)}°`;
    }
  } else {
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    facePill.textContent = 'no face';
  }

  // Body + hand tracking (arms, fingers) — separate from face detection above.
  if (bodyTracker.poseLandmarker) {
    const { pose, hands } = bodyTracker.detect(video, now);
    const poseFound = pose.worldLandmarks && pose.worldLandmarks.length > 0;
    const handCount = hands.landmarks ? hands.landmarks.length : 0;
    mBody.textContent = `${poseFound ? 'pose' : 'no pose'} · ${handCount} hand${handCount === 1 ? '' : 's'}`;
    if (poseFound) faceRenderer.applyPose(pose.worldLandmarks[0], alpha);
    if (handCount) faceRenderer.applyHands(
      hands, 
      poseFound ? pose.landmarks[0] : null,
      poseFound ? pose.worldLandmarks[0] : null,
      alpha
    );
  }

  requestAnimationFrame(loop);
}

startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);
