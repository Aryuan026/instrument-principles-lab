const canvas = document.querySelector("#scopeCanvas");
const viewport = document.querySelector("#scopeViewport");
const ctx = canvas.getContext("2d", { alpha: false });

const sourceCanvas = document.createElement("canvas");
const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
const signalCanvas = document.createElement("canvas");
const signalCtx = signalCanvas.getContext("2d", { willReadFrequently: true });
const maskCanvas = document.createElement("canvas");
const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });

const imageInput = document.querySelector("#imageInput");
const uploadButton = document.querySelector("#uploadButton");
const uploadCacheList = document.querySelector("#uploadCacheList");
const thresholdSlider = document.querySelector("#thresholdSlider");
const intensitySlider = document.querySelector("#intensitySlider");
const glowSlider = document.querySelector("#glowSlider");
const backgroundSlider = document.querySelector("#backgroundSlider");
const thresholdValue = document.querySelector("#thresholdValue");
const intensityValue = document.querySelector("#intensityValue");
const glowValue = document.querySelector("#glowValue");
const backgroundValue = document.querySelector("#backgroundValue");
const modeReadout = document.querySelector("#modeReadout");
const signalReadout = document.querySelector("#signalReadout");
const cornerStatus = document.querySelector(".corner-label.top-left");
const revealButton = document.querySelector("#revealButton");
const resetButton = document.querySelector("#resetButton");
const downloadButton = document.querySelector("#downloadButton");
const flowButtons = document.querySelectorAll(".flow-button");

const modeNames = {
  brightfield: "明场找焦",
  gray: "灰度信号",
  pseudo: "伪彩显影",
  merge: "合成视野",
};

const flowNames = {
  focus: "等待采集",
  acquire: "手动采集",
  raster: "逐行点扫",
  color: "伪彩叠加",
};

const channelColors = {
  blue: [18, 42, 255],
  green: [38, 255, 118],
  red: [255, 46, 42],
  magenta: [255, 101, 216],
};

const state = {
  mode: "brightfield",
  flow: "focus",
  sample: "city",
  image: null,
  activeUploadId: null,
  uploadCache: [],
  threshold: 30,
  intensity: 1.25,
  glow: 18,
  background: 0.58,
  channels: {
    blue: true,
    green: true,
    red: true,
    magenta: false,
  },
  pointers: new Map(),
  pinchStart: null,
  lastScanY: null,
  fullReveal: false,
  sourceData: null,
  activeScan: null,
  queuedScanY: null,
  queuedScanStrength: 0.56,
  queuedScanDuration: 760,
  rasterScan: null,
  colorMix: 1,
  colorAnimation: null,
  cacheNeedsPreview: false,
  renderPending: false,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

function randomFrom(seed) {
  let t = seed + 0x6d2b79f5;
  return function next() {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fitCanvasToViewport() {
  const rect = viewport.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(360, Math.round(rect.width * dpr));
  const height = Math.max(320, Math.round(rect.height * dpr));

  if (canvas.width === width && canvas.height === height) {
    return;
  }

  for (const item of [canvas, sourceCanvas, signalCanvas, maskCanvas]) {
    item.width = width;
    item.height = height;
  }

  drawSource();
  resetMask(false);
}

function setActiveSample(sample) {
  state.sample = sample;
  state.image = null;
  state.activeUploadId = null;
  document.querySelectorAll(".sample-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.sample === sample);
  });
  renderUploadCache();
  drawSource();
  enterFocusStage();
}

function addUploadCache(src, name) {
  const cleanName = name || "本地图像";
  const existing = state.uploadCache.find((item) => item.src === src);
  if (existing) {
    existing.name = cleanName;
    existing.status = existing.status || "已上传，待显影";
    state.uploadCache = [existing, ...state.uploadCache.filter((item) => item.id !== existing.id)];
    return existing.id;
  }

  const item = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: cleanName,
    src,
    preview: src,
    status: "已上传，待显影",
  };
  state.uploadCache = [item, ...state.uploadCache].slice(0, 3);
  return item.id;
}

function setUploadedImage(src, name, cacheId = null) {
  const img = new Image();
  img.addEventListener("load", () => {
    state.image = img;
    state.sample = "upload";
    state.activeUploadId = cacheId || addUploadCache(src, name);
    document.querySelectorAll(".sample-button").forEach((button) => button.classList.remove("is-active"));
    renderUploadCache();
    drawSource();
    enterFocusStage();
  });
  img.src = src;
}

function renderUploadCache() {
  if (!uploadCacheList) {
    return;
  }

  uploadCacheList.replaceChildren();
  if (!state.uploadCache.length) {
    const empty = document.createElement("p");
    empty.className = "cache-empty";
    empty.textContent = "暂无本地图像";
    uploadCacheList.append(empty);
    return;
  }

  state.uploadCache.forEach((item) => {
    const button = document.createElement("button");
    button.className = "cache-button";
    button.type = "button";
    button.classList.toggle("is-active", item.id === state.activeUploadId);

    const preview = document.createElement("span");
    preview.className = "cache-preview";
    const img = document.createElement("img");
    img.src = item.preview || item.src;
    img.alt = "";
    preview.append(img);

    const copy = document.createElement("span");
    copy.className = "cache-copy";
    const title = document.createElement("strong");
    title.textContent = item.name;
    const note = document.createElement("small");
    note.textContent = item.status;
    copy.append(title, note);

    button.append(preview, copy);
    button.addEventListener("click", () => setUploadedImage(item.src, item.name, item.id));
    uploadCacheList.append(button);
  });
}

function cacheCurrentProcessedFrame(status = "已显影，可切回") {
  if (!state.activeUploadId || !state.image || state.mode === "brightfield") {
    return;
  }

  const item = state.uploadCache.find((entry) => entry.id === state.activeUploadId);
  if (!item) {
    return;
  }

  item.preview = canvas.toDataURL("image/png");
  item.status = status;
  state.cacheNeedsPreview = false;
  renderUploadCache();
}

function drawSource() {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  if (!width || !height) {
    return;
  }

  sourceCtx.clearRect(0, 0, width, height);

  if (state.image) {
    drawUploadedImage(width, height);
  } else if (state.sample === "cells") {
    drawCellSample(width, height);
  } else if (state.sample === "chloroplast") {
    drawChloroplastSample(width, height);
  } else if (state.sample === "fibers") {
    drawFiberSample(width, height);
  } else if (state.sample === "city") {
    drawCitySample(width, height);
  } else {
    drawCitySample(width, height);
  }

  state.sourceData = sourceCtx.getImageData(0, 0, width, height);
  scheduleRender();
}

function drawUploadedImage(width, height) {
  const img = state.image;
  sourceCtx.fillStyle = "#080b0a";
  sourceCtx.fillRect(0, 0, width, height);

  const imageRatio = img.width / img.height;
  const canvasRatio = width / height;
  let drawWidth = width;
  let drawHeight = height;
  if (imageRatio > canvasRatio) {
    drawHeight = width / imageRatio;
  } else {
    drawWidth = height * imageRatio;
  }

  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  sourceCtx.drawImage(img, x, y, drawWidth, drawHeight);

  sourceCtx.save();
  sourceCtx.globalCompositeOperation = "source-over";
  sourceCtx.fillStyle = "rgba(7, 10, 9, 0.08)";
  sourceCtx.fillRect(0, 0, width, height);
  sourceCtx.restore();
}

function drawCitySample(width, height) {
  const rand = randomFrom(79);
  const sky = sourceCtx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#111627");
  sky.addColorStop(0.6, "#14161b");
  sky.addColorStop(1, "#050706");
  sourceCtx.fillStyle = sky;
  sourceCtx.fillRect(0, 0, width, height);

  let x = -width * 0.03;
  while (x < width * 1.04) {
    const buildingWidth = width * (0.055 + rand() * 0.065);
    const buildingHeight = height * (0.2 + rand() * 0.42);
    const y = height - buildingHeight;
    sourceCtx.fillStyle = `rgba(${16 + rand() * 22}, ${20 + rand() * 28}, ${28 + rand() * 32}, 0.95)`;
    sourceCtx.fillRect(x, y, buildingWidth, buildingHeight);

    const cols = Math.max(2, Math.floor(buildingWidth / 18));
    const rows = Math.max(3, Math.floor(buildingHeight / 24));
    for (let col = 0; col < cols; col += 1) {
      for (let row = 0; row < rows; row += 1) {
        if (rand() < 0.48) {
          const wx = x + 8 + col * ((buildingWidth - 18) / cols);
          const wy = y + 10 + row * ((buildingHeight - 20) / rows);
          sourceCtx.fillStyle = rand() > 0.38 ? "rgba(255, 221, 120, 0.82)" : "rgba(105, 220, 255, 0.7)";
          sourceCtx.fillRect(wx, wy, 5 + rand() * 8, 5 + rand() * 10);
        }
      }
    }
    x += buildingWidth + width * (0.008 + rand() * 0.018);
  }

  for (let i = 0; i < 85; i += 1) {
    const y = height * (0.22 + rand() * 0.68);
    const x1 = rand() * width;
    const length = width * (0.025 + rand() * 0.13);
    sourceCtx.strokeStyle = rand() > 0.5 ? "rgba(255, 108, 89, 0.58)" : "rgba(89, 220, 255, 0.54)";
    sourceCtx.lineWidth = 1 + rand() * 3;
    sourceCtx.beginPath();
    sourceCtx.moveTo(x1, y);
    sourceCtx.lineTo(x1 + length, y + (rand() - 0.5) * height * 0.03);
    sourceCtx.stroke();
  }
}

function drawCellSample(width, height) {
  const rand = randomFrom(112);
  const grad = sourceCtx.createRadialGradient(width * 0.5, height * 0.48, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.74);
  grad.addColorStop(0, "#071011");
  grad.addColorStop(0.58, "#030706");
  grad.addColorStop(1, "#010202");
  sourceCtx.fillStyle = grad;
  sourceCtx.fillRect(0, 0, width, height);

  const cells = [
    [0.2, 0.42, 0.13, 0.11, -0.34],
    [0.47, 0.3, 0.145, 0.112, 0.18],
    [0.75, 0.42, 0.13, 0.1, 0.35],
    [0.28, 0.68, 0.15, 0.12, 0.28],
    [0.58, 0.6, 0.14, 0.11, -0.24],
    [0.82, 0.73, 0.12, 0.1, 0.1],
    [0.45, 0.83, 0.12, 0.095, -0.08],
  ];

  cells.forEach(([cxp, cyp, rxp, ryp, angle], idx) => {
    const cx = cxp * width;
    const cy = cyp * height;
    const rx = rxp * width;
    const ry = ryp * height;

    sourceCtx.save();
    sourceCtx.translate(cx, cy);
    sourceCtx.rotate(angle);

    sourceCtx.strokeStyle = "rgba(69, 255, 154, 0.36)";
    sourceCtx.lineWidth = Math.max(2, width * 0.004);
    sourceCtx.beginPath();
    sourceCtx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    sourceCtx.stroke();

    for (let i = 0; i < 26; i += 1) {
      const a = rand() * Math.PI * 2;
      const r1 = Math.min(rx, ry) * (0.14 + rand() * 0.36);
      const r2 = Math.min(rx, ry) * (0.58 + rand() * 0.28);
      sourceCtx.strokeStyle = `rgba(76, 255, 146, ${0.2 + rand() * 0.36})`;
      sourceCtx.lineWidth = 1.2 + rand() * 1.8;
      sourceCtx.beginPath();
      sourceCtx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      sourceCtx.quadraticCurveTo(Math.cos(a + 0.55) * r2 * 0.65, Math.sin(a - 0.3) * r2 * 0.55, Math.cos(a + 0.18) * r2, Math.sin(a + 0.18) * r2);
      sourceCtx.stroke();
    }

    const nucleus = sourceCtx.createRadialGradient(-rx * 0.08, -ry * 0.04, 0, -rx * 0.08, -ry * 0.04, Math.max(rx, ry) * 0.46);
    nucleus.addColorStop(0, "rgba(188, 210, 255, 0.96)");
    nucleus.addColorStop(0.48, "rgba(80, 118, 255, 0.78)");
    nucleus.addColorStop(1, "rgba(34, 48, 135, 0.08)");
    sourceCtx.fillStyle = nucleus;
    sourceCtx.beginPath();
    sourceCtx.ellipse(-rx * 0.08, -ry * 0.04, rx * 0.32, ry * 0.36, 0, 0, Math.PI * 2);
    sourceCtx.fill();

    sourceCtx.restore();

    for (let i = 0; i < 18; i += 1) {
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * Math.min(rx, ry) * 0.72;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      const len = 4 + rand() * 12;
      sourceCtx.save();
      sourceCtx.translate(x, y);
      sourceCtx.rotate(rand() * Math.PI);
      sourceCtx.fillStyle = `rgba(255, 82, 76, ${0.42 + rand() * 0.42})`;
      sourceCtx.beginPath();
      sourceCtx.ellipse(0, 0, len, 1.5 + rand() * 2.5, 0, 0, Math.PI * 2);
      sourceCtx.fill();
      sourceCtx.restore();
    }

    if (idx % 2 === 0) {
      sourceCtx.strokeStyle = "rgba(255, 84, 84, 0.28)";
      sourceCtx.lineWidth = 1.4;
      sourceCtx.beginPath();
      sourceCtx.arc(cx, cy, Math.min(rx, ry) * 0.78, 0.4, 2.6);
      sourceCtx.stroke();
    }
  });
}

function drawChloroplastSample(width, height) {
  const rand = randomFrom(233);
  const bg = sourceCtx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#04120e");
  bg.addColorStop(0.48, "#0a1e15");
  bg.addColorStop(1, "#020605");
  sourceCtx.fillStyle = bg;
  sourceCtx.fillRect(0, 0, width, height);

  const centerX = width * 0.51;
  const centerY = height * 0.57;
  const leafRx = width * 0.43;
  const leafRy = height * 0.39;
  const leafAngle = -0.14;
  const cos = Math.cos(leafAngle);
  const sin = Math.sin(leafAngle);

  function leafPoint(localX, localY) {
    return {
      x: centerX + localX * cos - localY * sin,
      y: centerY + localX * sin + localY * cos,
    };
  }

  sourceCtx.save();
  sourceCtx.translate(centerX, centerY);
  sourceCtx.rotate(leafAngle);
  const leafGrad = sourceCtx.createRadialGradient(0, 0, 0, 0, 0, Math.min(width, height) * 0.58);
  leafGrad.addColorStop(0, "rgba(38, 96, 48, 0.38)");
  leafGrad.addColorStop(0.66, "rgba(23, 68, 38, 0.25)");
  leafGrad.addColorStop(1, "rgba(8, 20, 14, 0)");
  sourceCtx.fillStyle = leafGrad;
  sourceCtx.beginPath();
  sourceCtx.ellipse(0, 0, leafRx, leafRy, 0, 0, Math.PI * 2);
  sourceCtx.fill();

  sourceCtx.strokeStyle = "rgba(176, 255, 156, 0.68)";
  sourceCtx.lineWidth = Math.max(3, width * 0.009);
  sourceCtx.beginPath();
  sourceCtx.moveTo(-leafRx * 0.72, leafRy * 0.58);
  sourceCtx.bezierCurveTo(-leafRx * 0.28, leafRy * 0.2, leafRx * 0.24, -leafRy * 0.12, leafRx * 0.78, -leafRy * 0.64);
  sourceCtx.stroke();

  for (let i = 0; i < 20; i += 1) {
    const t = i / 19;
    const sx = -leafRx * 0.62 + t * leafRx * 1.24;
    const sy = leafRy * 0.46 - t * leafRy * 0.94;
    const side = i % 2 === 0 ? 1 : -1;
    sourceCtx.strokeStyle = `rgba(142, 255, 142, ${0.22 + rand() * 0.18})`;
    sourceCtx.lineWidth = 1.4 + rand() * 2.1;
    sourceCtx.beginPath();
    sourceCtx.moveTo(sx, sy);
    sourceCtx.quadraticCurveTo(
      sx + side * leafRx * (0.16 + rand() * 0.14),
      sy - leafRy * (0.02 + rand() * 0.12),
      sx + side * leafRx * (0.42 + rand() * 0.16),
      sy + (rand() - 0.5) * leafRy * 0.22,
    );
    sourceCtx.stroke();
  }
  sourceCtx.restore();

  for (let i = 0; i < 14; i += 1) {
    const t = i / 13;
    const band = (rand() - 0.5) * 0.9;
    const baseX = -leafRx * 0.58 + leafRx * 1.18 * t;
    const baseY = leafRy * (0.34 - t * 0.68) + band * leafRy * 0.52;
    const center = leafPoint(baseX, baseY);
    const rx = width * (0.055 + rand() * 0.035);
    const ry = height * (0.035 + rand() * 0.025);
    sourceCtx.strokeStyle = `rgba(110, 255, 154, ${0.12 + rand() * 0.12})`;
    sourceCtx.lineWidth = 1.4 + rand() * 1.2;
    sourceCtx.beginPath();
    sourceCtx.ellipse(center.x, center.y, rx, ry, leafAngle + (rand() - 0.5) * 0.8, 0, Math.PI * 2);
    sourceCtx.stroke();
  }

  function drawChloroplast(localX, localY, scale = 1) {
    const point = leafPoint(localX, localY);
    const crx = width * (0.0065 + rand() * 0.010) * scale;
    const cry = height * (0.0055 + rand() * 0.009) * scale;
    sourceCtx.save();
    sourceCtx.translate(point.x, point.y);
    sourceCtx.rotate(leafAngle + rand() * Math.PI);
    const green = sourceCtx.createRadialGradient(0, 0, 0, 0, 0, Math.max(crx, cry) * 2.4);
    green.addColorStop(0, "rgba(217, 255, 118, 0.96)");
    green.addColorStop(0.46, "rgba(76, 255, 106, 0.8)");
    green.addColorStop(1, "rgba(20, 82, 32, 0)");
    sourceCtx.fillStyle = green;
    sourceCtx.beginPath();
    sourceCtx.ellipse(0, 0, crx, cry, 0, 0, Math.PI * 2);
    sourceCtx.fill();

    if (rand() > 0.42) {
      sourceCtx.globalCompositeOperation = "screen";
      sourceCtx.strokeStyle = `rgba(255, 48, 34, ${0.46 + rand() * 0.3})`;
      sourceCtx.lineWidth = 1 + rand() * 1.2;
      sourceCtx.beginPath();
      sourceCtx.ellipse(0, 0, crx * 1.2, cry * 1.08, 0, 0, Math.PI * 2);
      sourceCtx.stroke();
    }
    sourceCtx.restore();
  }

  for (let i = 0; i < 105; i += 1) {
    const angle = rand() * Math.PI * 2;
    const radius = Math.sqrt(rand());
    const localX = Math.cos(angle) * radius * leafRx * (0.92 + rand() * 0.08);
    const localY = Math.sin(angle) * radius * leafRy * (0.78 + rand() * 0.14) + leafRy * 0.06;
    const veinPull = Math.exp(-Math.abs(localY / leafRy) * 3.4) * (rand() - 0.42) * leafRy * 0.22;
    drawChloroplast(localX, localY + veinPull, 1);
  }

  const clusters = [
    [-0.62, 0.38],
    [-0.38, 0.16],
    [-0.16, 0.42],
    [0.1, 0.18],
    [0.35, 0.32],
    [0.56, 0.02],
    [-0.48, -0.06],
    [0.12, -0.2],
  ];

  clusters.forEach(([xp, yp], clusterIndex) => {
    const count = 9 + Math.floor(rand() * 9);
    for (let i = 0; i < count; i += 1) {
      const a = rand() * Math.PI * 2;
      const spreadX = leafRx * (0.06 + rand() * 0.08);
      const spreadY = leafRy * (0.04 + rand() * 0.07);
      const localX = leafRx * xp + Math.cos(a) * spreadX * rand();
      const localY = leafRy * yp + Math.sin(a) * spreadY * rand();
      drawChloroplast(localX, localY, clusterIndex % 3 === 0 ? 1.15 : 1);
    }
  });
}

function drawFiberSample(width, height) {
  const rand = randomFrom(377);
  const bg = sourceCtx.createRadialGradient(width * 0.46, height * 0.46, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.72);
  bg.addColorStop(0, "#101421");
  bg.addColorStop(0.55, "#070a10");
  bg.addColorStop(1, "#010203");
  sourceCtx.fillStyle = bg;
  sourceCtx.fillRect(0, 0, width, height);

  const somas = [
    [0.18, 0.3],
    [0.38, 0.58],
    [0.7, 0.34],
    [0.78, 0.7],
  ];

  function branch(x, y, angle, length, depth, color) {
    if (depth <= 0 || length < width * 0.035) {
      return;
    }
    const endX = x + Math.cos(angle) * length;
    const endY = y + Math.sin(angle) * length;
    const bend = (rand() - 0.5) * length * 0.42;
    sourceCtx.strokeStyle = color;
    sourceCtx.lineWidth = Math.max(1, depth * 1.15);
    sourceCtx.beginPath();
    sourceCtx.moveTo(x, y);
    sourceCtx.quadraticCurveTo((x + endX) / 2, (y + endY) / 2 + bend, endX, endY);
    sourceCtx.stroke();

    branch(endX, endY, angle + (rand() * 0.62 + 0.2), length * (0.58 + rand() * 0.16), depth - 1, color);
    if (rand() > 0.24) {
      branch(endX, endY, angle - (rand() * 0.62 + 0.2), length * (0.5 + rand() * 0.18), depth - 1, color);
    }
  }

  somas.forEach(([xp, yp], idx) => {
    const x = xp * width;
    const y = yp * height;
    const blue = sourceCtx.createRadialGradient(x, y, 0, x, y, width * 0.045);
    blue.addColorStop(0, "rgba(182, 210, 255, 0.88)");
    blue.addColorStop(0.55, "rgba(83, 124, 255, 0.66)");
    blue.addColorStop(1, "rgba(26, 42, 116, 0)");
    sourceCtx.fillStyle = blue;
    sourceCtx.beginPath();
    sourceCtx.arc(x, y, width * (0.026 + rand() * 0.012), 0, Math.PI * 2);
    sourceCtx.fill();

    for (let i = 0; i < 4; i += 1) {
      const angle = (Math.PI * 2 * i) / 4 + rand() * 0.7 + idx * 0.18;
      branch(x, y, angle, width * (0.13 + rand() * 0.07), 4, i % 2 ? "rgba(255, 72, 95, 0.58)" : "rgba(78, 255, 155, 0.62)");
    }
  });

  for (let i = 0; i < 150; i += 1) {
    const x = rand() * width;
    const y = rand() * height;
    sourceCtx.fillStyle = rand() > 0.5 ? "rgba(255, 80, 92, 0.22)" : "rgba(84, 255, 164, 0.2)";
    sourceCtx.beginPath();
    sourceCtx.arc(x, y, 0.7 + rand() * 2.2, 0, Math.PI * 2);
    sourceCtx.fill();
  }
}

function resetMask(withSeed) {
  maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  state.fullReveal = false;
  state.lastScanY = null;
  state.activeScan = null;
  state.queuedScanY = null;
  state.queuedScanStrength = 0.56;
  state.queuedScanDuration = 760;
  state.rasterScan = null;
  state.colorAnimation = null;
  if (withSeed) {
    paintMaskBand(maskCanvas.height * 0.42, 0.34, 0, maskCanvas.width * 0.86);
    paintMaskBand(maskCanvas.height * 0.6, 0.2, 0, maskCanvas.width * 0.68);
  }
  scheduleRender();
}

function setActiveFlow(flow) {
  state.flow = flow;
  flowButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.flow === flow);
  });
  updateReadouts();
}

function enterFocusStage() {
  resetMask(false);
  state.fullReveal = true;
  state.colorMix = 1;
  state.mode = "brightfield";
  state.cacheNeedsPreview = false;
  state.activeScan = null;
  state.queuedScanY = null;
  state.rasterScan = null;
  state.colorAnimation = null;
  setActiveFlow("focus");
  setMode("brightfield");
}

function enterAcquireStage() {
  resetMask(false);
  state.fullReveal = false;
  state.colorMix = 1;
  state.mode = "merge";
  state.rasterScan = null;
  state.colorAnimation = null;
  setActiveFlow("acquire");
  setMode("merge");
}

function startRasterStage() {
  resetMask(false);
  state.fullReveal = false;
  state.colorMix = 1;
  state.mode = "merge";
  state.cacheNeedsPreview = Boolean(state.image);
  state.activeScan = null;
  state.queuedScanY = null;
  state.colorAnimation = null;
  state.rasterScan = {
    nextY: Math.max(10, maskCanvas.height * 0.03),
    step: Math.max(18, maskCanvas.height * 0.045),
    strength: 0.68,
    duration: 190,
  };
  setActiveFlow("raster");
  setMode("merge");
  startQueuedScan(performance.now());
  scheduleRender();
}

function startColorStage() {
  resetMask(false);
  state.fullReveal = true;
  state.mode = "merge";
  state.cacheNeedsPreview = Boolean(state.image);
  state.activeScan = null;
  state.queuedScanY = null;
  state.rasterScan = null;
  state.colorMix = 0;
  state.colorAnimation = {
    start: performance.now(),
    duration: 1100,
  };
  setActiveFlow("color");
  setMode("merge");
  scheduleRender();
}

function paintMaskBand(y, strength, startX = 0, endX = maskCanvas.width) {
  if (!maskCanvas.width || !maskCanvas.height) {
    return;
  }

  const left = clamp(Math.min(startX, endX), 0, maskCanvas.width);
  const right = clamp(Math.max(startX, endX), 0, maskCanvas.width);
  if (right <= left) {
    return;
  }

  const radius = Math.max(18, maskCanvas.height * 0.035);
  const top = clamp(y - radius, 0, maskCanvas.height);
  const bottom = clamp(y + radius, 0, maskCanvas.height);
  const grad = maskCtx.createLinearGradient(0, top, 0, bottom);
  grad.addColorStop(0, "rgba(255, 255, 255, 0)");
  grad.addColorStop(0.3, `rgba(255, 255, 255, ${strength * 0.36})`);
  grad.addColorStop(0.5, `rgba(255, 255, 255, ${strength})`);
  grad.addColorStop(0.7, `rgba(255, 255, 255, ${strength * 0.36})`);
  grad.addColorStop(1, "rgba(255, 255, 255, 0)");
  maskCtx.save();
  maskCtx.globalCompositeOperation = "lighter";
  maskCtx.fillStyle = grad;
  maskCtx.fillRect(left, top, right - left, Math.max(1, bottom - top));
  maskCtx.fillStyle = `rgba(255, 255, 255, ${strength * 0.46})`;
  maskCtx.fillRect(left, clamp(y - 1, 0, maskCanvas.height), right - left, 2);
  maskCtx.restore();
}

function requestScanLine(y, strength = 0.58, duration = 760) {
  if (!maskCanvas.width || !maskCanvas.height) {
    return;
  }

  state.queuedScanY = clamp(y, 0, maskCanvas.height);
  state.queuedScanStrength = Math.max(state.queuedScanStrength, strength);
  state.queuedScanDuration = duration;
  if (!state.activeScan) {
    startQueuedScan(performance.now());
  }
  scheduleRender();
}

function startQueuedScan(now) {
  if (state.queuedScanY === null && state.rasterScan) {
    if (state.rasterScan.nextY <= maskCanvas.height) {
      state.queuedScanY = state.rasterScan.nextY;
      state.queuedScanStrength = state.rasterScan.strength;
      state.queuedScanDuration = state.rasterScan.duration;
      state.rasterScan.nextY += state.rasterScan.step;
    } else {
      state.rasterScan = null;
      state.fullReveal = true;
    }
  }

  if (state.queuedScanY === null) {
    return false;
  }

  state.activeScan = {
    y: state.queuedScanY,
    strength: state.queuedScanStrength,
    start: now,
    duration: state.queuedScanDuration,
    appliedX: 0,
  };
  state.queuedScanY = null;
  state.queuedScanStrength = 0.56;
  state.queuedScanDuration = 760;
  return true;
}

function advanceScan(now) {
  if (!state.activeScan) {
    return startQueuedScan(now);
  }

  const pass = state.activeScan;
  const elapsed = now - pass.start;
  const progress = clamp(elapsed / pass.duration, 0, 1);
  const nextX = maskCanvas.width * progress;
  if (nextX > pass.appliedX + 0.5) {
    paintMaskBand(pass.y, pass.strength, pass.appliedX, nextX);
    pass.appliedX = nextX;
  }

  if (elapsed >= pass.duration + 180) {
    state.activeScan = null;
    return startQueuedScan(now);
  }

  return true;
}

function advanceColorAnimation(now) {
  if (!state.colorAnimation) {
    return false;
  }

  const elapsed = now - state.colorAnimation.start;
  const progress = clamp(elapsed / state.colorAnimation.duration, 0, 1);
  state.colorMix = smoothstep(0, 1, progress);
  if (progress >= 1) {
    state.colorMix = 1;
    state.colorAnimation = null;
    return false;
  }
  return true;
}

function renderBrightfieldFrame(source, width, height) {
  const output = signalCtx.createImageData(width, height);
  const target = output.data;

  for (let i = 0; i < source.length; i += 4) {
    const lum = (source[i] * 0.2126 + source[i + 1] * 0.7152 + source[i + 2] * 0.0722) / 255;
    const value = clamp(174 + (lum - 0.42) * 82, 72, 232);
    target[i] = clamp(value * 1.04, 0, 255);
    target[i + 1] = clamp(value * 1.02, 0, 255);
    target[i + 2] = clamp(value * 0.92, 0, 255);
    target[i + 3] = 255;
  }

  signalCtx.putImageData(output, 0, 0);
}

function scheduleRender() {
  if (state.renderPending) {
    return;
  }
  state.renderPending = true;
  requestAnimationFrame(() => {
    state.renderPending = false;
    render();
  });
}

function render() {
  const width = canvas.width;
  const height = canvas.height;
  if (!state.sourceData || !width || !height) {
    return;
  }

  const now = performance.now();
  const scanActive = state.fullReveal ? false : advanceScan(now);
  const colorActive = advanceColorAnimation(now);
  const source = state.sourceData.data;
  const output = signalCtx.createImageData(width, height);
  const target = output.data;
  const maskData = state.fullReveal ? null : maskCtx.getImageData(0, 0, width, height).data;
  const threshold = state.threshold / 100;
  const intensity = state.intensity;
  const darken = state.background;
  const blackFloor = darken * 0.52;
  const colorMix = state.mode === "merge" || state.mode === "pseudo" ? state.colorMix : 0;

  if (state.mode === "brightfield") {
    renderBrightfieldFrame(source, width, height);
    drawFinal(false, now);
    updateReadouts();
    if (scanActive || colorActive) {
      scheduleRender();
    }
    return;
  }

  const grayMap = new Float32Array(width * height);
  for (let i = 0, p = 0; i < source.length; i += 4, p += 1) {
    grayMap[p] = (source[i] * 0.2126 + source[i + 1] * 0.7152 + source[i + 2] * 0.0722) / 255;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const i = p * 4;
      const srcR = source[i] / 255;
      const srcG = source[i + 1] / 255;
      const srcB = source[i + 2] / 255;
      const lum = grayMap[p];
      const right = grayMap[p + 1] ?? lum;
      const down = grayMap[p + width] ?? lum;
      const edge = clamp((Math.abs(lum - right) + Math.abs(lum - down)) * 4.8, 0, 1);
      const high = Math.pow(smoothstep(Math.max(threshold, blackFloor * 0.72), 1, lum), 1.18) * intensity;
      const sparkle = ((x * 37 + y * 17 + ((x * y) % 53)) % 97) / 97;
      const reveal = state.fullReveal ? 1 : clamp(0.12 + (maskData[i + 3] / 255) * 0.96, 0.12, 1);

      if (state.mode === "gray") {
        const gate = 0.18 + smoothstep(Math.max(threshold, blackFloor), 1, lum) * 1.04;
        const value = clamp((lum * gate + edge * 0.1) * 255 * (1 - darken * 0.32), 0, 255);
        const signalTone = smoothstep(0.04, 0.92, value / 255);
        target[i] = clamp(value * (0.82 + signalTone * 0.04), 0, 255);
        target[i + 1] = clamp(value * (0.94 + signalTone * 0.05), 0, 255);
        target[i + 2] = clamp(value * (1.08 + signalTone * 0.06) + signalTone * 6, 0, 255);
        target[i + 3] = 255;
        continue;
      }

      const uploadedFine = state.image ? smoothstep(0.025, 0.16, edge) : edge;
      const uploadedBright = state.image ? high * uploadedFine : high;
      const uploadedDarkRim = state.image ? smoothstep(0.1, 0.78, 1 - lum) * uploadedFine : 0;
      const baseLevel = state.image ? lum * (5 - darken * 4) : lum * (78 - darken * 58);
      let r = baseLevel;
      let g = baseLevel;
      let b = baseLevel;

      const channelSignal = (value, gamma = 1) => {
        const shaped = Math.pow(clamp(value, 0, 1), gamma);
        const thresholdGate = smoothstep(threshold, 1, shaped);
        const offsetGate = smoothstep(blackFloor, 1, shaped);
        return Math.pow(thresholdGate * offsetGate, 0.82) * intensity;
      };

      if (state.mode === "pseudo") {
        const pseudoInput = state.image
          ? uploadedFine * 0.54 + uploadedBright * 0.46
          : (high + edge * 0.24) * smoothstep(blackFloor, 1, lum + edge * 0.2);
        const signal = clamp(pseudoInput * reveal * colorMix, 0, 1.8);
        r += channelColors.green[0] * signal;
        g += channelColors.green[1] * signal;
        b += channelColors.green[2] * signal;
      } else {
        if (state.channels.blue) {
          const blueInput = state.image ? uploadedDarkRim * 0.64 + uploadedBright * 0.18 + uploadedFine * 0.1 : Math.pow(srcB, 1.08);
          const signal = clamp(channelSignal(blueInput, 1) * reveal * colorMix, 0, 1.2);
          r += channelColors.blue[0] * signal;
          g += channelColors.blue[1] * signal;
          b += channelColors.blue[2] * signal;
        }
        if (state.channels.green) {
          const greenInput = state.image ? uploadedFine * 0.82 + uploadedBright * 0.18 : Math.pow(srcG, 1.02);
          const signal = clamp(channelSignal(greenInput, 1) * reveal * colorMix, 0, 1.28);
          r += channelColors.green[0] * signal;
          g += channelColors.green[1] * signal;
          b += channelColors.green[2] * signal;
        }
        if (state.channels.red) {
          const redInput = state.image ? uploadedBright * (0.52 + sparkle * 0.32) : Math.pow(srcR, 1.04);
          const signal = clamp(channelSignal(redInput, 1) * reveal * colorMix, 0, 1.28);
          r += channelColors.red[0] * signal;
          g += channelColors.red[1] * signal;
          b += channelColors.red[2] * signal;
        }
        if (state.channels.magenta) {
          const magentaInput = state.image ? uploadedFine * 0.22 + uploadedBright * 0.3 : Math.max(srcR * 0.55, srcB * 0.38);
          const signal = clamp(channelSignal(magentaInput, 1) * reveal * colorMix, 0, 1.2);
          r += channelColors.magenta[0] * signal;
          g += channelColors.magenta[1] * signal;
          b += channelColors.magenta[2] * signal;
        }
      }

      const noise = (((x * 13 + y * 29) % 19) - 9) * 0.62;
      target[i] = clamp(r + noise, 0, 255);
      target[i + 1] = clamp(g + noise, 0, 255);
      target[i + 2] = clamp(b + noise, 0, 255);
      target[i + 3] = 255;
    }
  }

  signalCtx.putImageData(output, 0, 0);
  drawFinal(state.mode !== "gray", now);
  if (
    state.cacheNeedsPreview &&
    state.image &&
    state.activeUploadId &&
    state.fullReveal &&
    state.mode !== "brightfield" &&
    (!state.colorAnimation || state.colorMix >= 0.99)
  ) {
    cacheCurrentProcessedFrame(`${modeNames[state.mode]} · 已保留`);
  }
  updateReadouts();
  if (scanActive || colorActive) {
    scheduleRender();
  }
}

function drawFinal(withGlow, now = performance.now()) {
  ctx.fillStyle = "#020403";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (withGlow && state.glow > 0) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.72;
    ctx.filter = `blur(${state.glow}px)`;
    ctx.drawImage(signalCanvas, 0, 0);
    ctx.restore();
  }

  ctx.save();
  ctx.globalCompositeOperation = withGlow ? "lighter" : "source-over";
  ctx.drawImage(signalCanvas, 0, 0);
  ctx.restore();

  if (withGlow) {
    drawSoftVignette();
  }
  drawActiveScanBeam(now);
}

function drawActiveScanBeam(now) {
  if (state.mode === "brightfield" || state.fullReveal || !state.activeScan) {
    return;
  }

  const pass = state.activeScan;
  const age = now - pass.start;
  if (age < -80 || age > pass.duration + 180) {
    return;
  }

  const progress = clamp(age / pass.duration, 0, 1);
  const alpha = clamp(1 - Math.max(0, age - pass.duration) / 180, 0, 1);
  const y = pass.y;
  const x = canvas.width * progress;
  const lineHalf = Math.max(2, canvas.height * 0.0042);
  const headRadius = Math.max(8, canvas.height * 0.014);
  const segment = Math.max(48, canvas.width * 0.055);

  ctx.save();
  ctx.globalCompositeOperation = "screen";

  const scanTrace = ctx.createLinearGradient(0, 0, Math.max(1, x), 0);
  scanTrace.addColorStop(0, `rgba(98, 216, 255, ${0.16 * alpha})`);
  scanTrace.addColorStop(0.72, `rgba(109, 255, 164, ${0.3 * alpha})`);
  scanTrace.addColorStop(1, `rgba(250, 255, 252, ${0.68 * alpha})`);
  ctx.fillStyle = scanTrace;
  ctx.fillRect(0, y - lineHalf, x, lineHalf * 2);

  const readout = ctx.createLinearGradient(x - segment, 0, x + 10, 0);
  readout.addColorStop(0, "rgba(98, 216, 255, 0)");
  readout.addColorStop(0.66, `rgba(98, 216, 255, ${0.32 * alpha})`);
  readout.addColorStop(1, `rgba(250, 255, 252, ${0.78 * alpha})`);
  ctx.fillStyle = readout;
  ctx.fillRect(clamp(x - segment, 0, canvas.width), y - lineHalf * 2.5, Math.min(segment + 10, canvas.width), lineHalf * 5);

  const head = ctx.createRadialGradient(x, y, 0, x, y, headRadius * 2.2);
  head.addColorStop(0, `rgba(250, 255, 252, ${0.88 * alpha})`);
  head.addColorStop(0.34, `rgba(109, 255, 164, ${0.42 * alpha})`);
  head.addColorStop(0.72, `rgba(98, 216, 255, ${0.14 * alpha})`);
  head.addColorStop(1, "rgba(109, 255, 164, 0)");
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.arc(x, y, headRadius * 2.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(250, 255, 252, ${0.82 * alpha})`;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(2.2, canvas.height * 0.0038), 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawSoftVignette() {
  const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  grad.addColorStop(0, "rgba(0, 0, 0, 0.16)");
  grad.addColorStop(0.5, "rgba(0, 0, 0, 0)");
  grad.addColorStop(1, "rgba(0, 0, 0, 0.26)");
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function pointerToCanvas(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function setPointer(event) {
  const point = pointerToCanvas(event);
  state.pointers.set(event.pointerId, {
    x: point.x,
    y: point.y,
    clientX: event.clientX,
    clientY: event.clientY,
  });
  return point;
}

function getPointerDistance() {
  const points = [...state.pointers.values()];
  if (points.length < 2) {
    return 0;
  }
  return Math.hypot(points[0].clientX - points[1].clientX, points[0].clientY - points[1].clientY);
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".mode-button").forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  updateReadouts();
  scheduleRender();
}

function updateReadouts() {
  modeReadout.textContent = modeNames[state.mode];
  signalReadout.textContent = state.mode === "brightfield" ? "焦面预览" : `${flowNames[state.flow]} · 门槛 ${state.threshold}`;
  if (cornerStatus) {
    cornerStatus.textContent = state.mode === "brightfield" ? "FOCAL PLANE" : "LIVE SIGNAL";
  }
}

function syncControls() {
  thresholdSlider.value = state.threshold;
  intensitySlider.value = Math.round(state.intensity * 100);
  glowSlider.value = state.glow;
  backgroundSlider.value = Math.round(state.background * 100);
  thresholdValue.textContent = String(state.threshold);
  intensityValue.textContent = `${Math.round(state.intensity * 100)}%`;
  glowValue.textContent = String(state.glow);
  backgroundValue.textContent = `${Math.round(state.background * 100)}%`;
  updateReadouts();
}

function bindEvents() {
  uploadButton.addEventListener("click", () => imageInput.click());

  imageInput.addEventListener("change", () => {
    const file = imageInput.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      setUploadedImage(String(reader.result), file.name);
      imageInput.value = "";
    });
    reader.readAsDataURL(file);
  });

  document.querySelectorAll(".sample-button").forEach((button) => {
    button.addEventListener("click", () => setActiveSample(button.dataset.sample));
  });

  document.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.mode;
      state.activeScan = null;
      state.queuedScanY = null;
      state.rasterScan = null;
      state.colorAnimation = null;
      if (mode === "brightfield") {
        enterFocusStage();
        return;
      }
      state.fullReveal = true;
      state.colorMix = mode === "gray" ? 0 : 1;
      setMode(mode);
    });
  });

  flowButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.flow === "acquire") {
        enterAcquireStage();
      } else if (button.dataset.flow === "raster") {
        startRasterStage();
      } else if (button.dataset.flow === "color") {
        startColorStage();
      }
    });
  });

  document.querySelectorAll(".channel-button").forEach((button) => {
    button.addEventListener("click", () => {
      const channel = button.dataset.channel;
      state.channels[channel] = !state.channels[channel];
      button.classList.toggle("is-on", state.channels[channel]);
      if (state.mode === "pseudo") {
        setMode("merge");
      }
      scheduleRender();
    });
  });

  thresholdSlider.addEventListener("input", () => {
    state.threshold = Number(thresholdSlider.value);
    syncControls();
    scheduleRender();
  });

  intensitySlider.addEventListener("input", () => {
    state.intensity = Number(intensitySlider.value) / 100;
    syncControls();
    scheduleRender();
  });

  glowSlider.addEventListener("input", () => {
    state.glow = Number(glowSlider.value);
    syncControls();
    scheduleRender();
  });

  backgroundSlider.addEventListener("input", () => {
    state.background = Number(backgroundSlider.value) / 100;
    syncControls();
    scheduleRender();
  });

  revealButton.addEventListener("click", () => {
    state.fullReveal = true;
    state.activeScan = null;
    state.queuedScanY = null;
    state.rasterScan = null;
    state.colorAnimation = null;
    state.colorMix = 1;
    state.cacheNeedsPreview = Boolean(state.image);
    setMode("merge");
    scheduleRender();
  });

  resetButton.addEventListener("click", () => enterFocusStage());

  downloadButton.addEventListener("click", () => {
    cacheCurrentProcessedFrame("已导出前预览");
    const link = document.createElement("a");
    link.download = `fluorescence-signal-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  });

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    const point = setPointer(event);
    state.pinchStart = null;
    if (state.pointers.size === 1) {
      if (state.mode === "brightfield" || state.flow !== "acquire") {
        enterAcquireStage();
      }
      state.rasterScan = null;
      state.colorAnimation = null;
      state.colorMix = 1;
      state.fullReveal = false;
      state.lastScanY = point.y;
      requestScanLine(point.y, 0.68);
    }
    scheduleRender();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!state.pointers.has(event.pointerId)) {
      return;
    }

    event.preventDefault();
    const point = setPointer(event);

    if (state.pointers.size >= 2) {
      const distance = getPointerDistance();
      if (!state.pinchStart) {
        state.pinchStart = { distance, glow: state.glow };
      } else {
        const ratio = distance / Math.max(1, state.pinchStart.distance);
        state.glow = Math.round(clamp(state.pinchStart.glow * ratio, 0, 38));
        syncControls();
        scheduleRender();
      }
      return;
    }

    state.fullReveal = false;
    state.rasterScan = null;
    state.colorAnimation = null;
    state.lastScanY = point.y;
    requestScanLine(point.y, 0.52);
    scheduleRender();
  });

  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", finishPointer);
  canvas.addEventListener("lostpointercapture", finishPointer);
}

function finishPointer(event) {
  state.pointers.delete(event.pointerId);
  if (state.pointers.size < 2) {
    state.pinchStart = null;
  }
  if (state.pointers.size === 0) {
    state.lastScanY = null;
  }
}

function boot() {
  bindEvents();
  renderUploadCache();
  syncControls();

  const observer = new ResizeObserver(() => fitCanvasToViewport());
  observer.observe(viewport);

  requestAnimationFrame(() => {
    fitCanvasToViewport();
    enterFocusStage();
  });
}

boot();
