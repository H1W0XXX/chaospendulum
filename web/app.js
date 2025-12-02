// ========= wasm 初始化 =========
const go = new Go();
let wasmReady = WebAssembly.instantiateStreaming(fetch("main.wasm"), go.importObject).then(
    (result) => {
        go.run(result.instance);
        return true;
    },
);

// ========= 常量与状态 =========
const MAX_LINKS = 8;
let linkCount = 2; // 可调
const canvas = document.getElementById("pendulumCanvas");
const ctx = canvas.getContext("2d");

const ballColors = [
    "#ff6b6b", // 红
    "#7cf5ff", // 青
    "#ffc857", // 黄
    "#b483ff", // 紫
    "#4dff6b", // 亮绿
    "#ff9ce6", // 粉
    "#4aa8ff", // 蓝
    "#ffb24d", // 橙
    "#9dff4d", // 荧光绿
    "#ff4da6"  // 桃红
];
const backgroundColor = "#050608";
const SCALE_MIN = 10;
const SCALE_MAX = 4000;
const ZOOM_SENSITIVITY = 0.0014;

let worldRadius = 2.5;
let scale = 1;
let centerX = 0;
let centerY = 0;

let running = true;
let lastTime = null;
let wasRunningBeforeDrag = false;

const TRAIL_MAX_POINTS = 1400;
const TRAIL_FADE_RATE = 0.32; // 越大衰减越快
let trails = [];

let lastScreenPositions = [];
let lastBobScreenRadii = [];
let dragTargetIndex = null;
const DRAG_PIVOT = -1;
let pivotOffset = { x: 0, y: 0 }; // 屏幕坐标偏移，移动整体连杆
let pivotGrabOffset = { x: 0, y: 0 };
let isPanning = false;
let panLast = { x: 0, y: 0 };
let updatingInputs = false;
let apiMode = "legacy";

let accelPositions = [];
let accelVelocities = [];
let lastAccelerations = [];
let currentAngles = [];
let currentAngularVel = [];
let lastAnglesForVel = [];

const uiOptions = {
    showTrails: true,
    showArrows: true,
};

let isDragging = false;
let initialScaleSet = false;

let currentConfig = createDefaultConfig();
currentAngles = currentConfig.theta.slice();
currentAngularVel = currentConfig.omega.slice();
lastAnglesForVel = currentAngles.slice();

// ========= UI 构建 =========
renderInputs();

function createDefaultConfig() {
    return {
        links: linkCount,
        L: new Array(linkCount).fill(1.0),
        rodMass: new Array(linkCount).fill(1.0),
        bobMass: new Array(linkCount).fill(0.25),
        g: 9.81,
        damping: 0.02,
        theta: [degToRad(120), degToRad(150)].slice(0, linkCount),
        omega: new Array(linkCount).fill(0),
    };
}

function renderInputs() {
    const linkContainer = document.getElementById("linksContainer");
    const bobsContainer = document.getElementById("bobsContainer");
    const thetaContainer = document.getElementById("thetaContainer");
    const omegaContainer = document.getElementById("omegaContainer");

    const linkCountInput = document.getElementById("linkCountInput");
    if (linkCountInput) {
        updatingInputs = true;
        linkCountInput.value = linkCount;
        updatingInputs = false;
    }

    linkContainer.innerHTML = "";
    bobsContainer.innerHTML = "";
    thetaContainer.innerHTML = "";
    omegaContainer.innerHTML = "";

    for (let i = 0; i < linkCount; i++) {
        const linkIdx = i + 1;
        linkContainer.appendChild(
            createNumberInput(
                `L${linkIdx}`,
                `L${linkIdx} (m)`,
                currentConfig.L[i] ?? 1,
                "0.01",
            ),
        );
        linkContainer.appendChild(
            createNumberInput(
                `rodMass${linkIdx}`,
                `杆质量 ${linkIdx} (kg)`,
                currentConfig.rodMass[i] ?? 1,
                "0.01",
            ),
        );

        bobsContainer.appendChild(
            createNumberInput(
                `bobMass${linkIdx}`,
                `小球质量 ${linkIdx} (kg)`,
                currentConfig.bobMass[i] ?? 0.25,
                "0.01",
            ),
        );

        thetaContainer.appendChild(
            createNumberInput(
                `theta${linkIdx}`,
                `θ${linkIdx}`,
                currentConfig.theta[i] !== undefined ? radToDeg(currentConfig.theta[i]).toFixed(1) : 120,
                "0.1",
            ),
        );
        omegaContainer.appendChild(
            createNumberInput(
                `omega${linkIdx}`,
                `ω${linkIdx}`,
                currentConfig.omega[i] !== undefined ? radToDeg(currentConfig.omega[i]).toFixed(1) : 0,
                "0.1",
            ),
        );
    }
}

function createNumberInput(id, labelText, value, step = "any") {
    const label = document.createElement("label");
    label.textContent = labelText;

    const input = document.createElement("input");
    input.type = "number";
    input.step = step;
    input.value = value;
    input.id = id;
    input.addEventListener("change", handleInputChange);

    label.appendChild(input);
    return label;
}

// ========= 工具 =========
function degToRad(deg) {
    return (deg * Math.PI) / 180;
}

function radToDeg(rad) {
    return (rad * 180) / Math.PI;
}

function readNumber(id, fallback) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? v : fallback;
}

function setInputValue(id, value) {
    const el = document.getElementById(id);
    if (el) {
        el.value = value;
    }
}

function clampLinks(n) {
    if (!Number.isFinite(n)) return linkCount;
    return Math.min(MAX_LINKS, Math.max(1, Math.round(n)));
}

function resizeArray(arr, n, defVal) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
        if (Array.isArray(arr) && Number.isFinite(arr[i])) {
            out[i] = arr[i];
        } else if (typeof defVal === "function") {
            out[i] = defVal(i);
        } else {
            out[i] = defVal;
        }
    }
    return out;
}

function toNumberArray(val, limit) {
    if (val == null) return [];
    const len = typeof val.length === "number" ? val.length : 0;
    const max = limit ? Math.min(limit, len) : len;
    const out = [];
    for (let i = 0; i < max; i++) {
        const v = Number(val[i]);
        out.push(Number.isFinite(v) ? v : 0);
    }
    return out;
}

function calcPositionsFromAngles(angles, lengths, mode = apiMode) {
    const n = Math.min(angles.length, lengths.length);
    const positions = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i < n; i++) {
        const theta = angles[i];
        // 统一约定：0 在竖直向下，逆时针为正
        x += lengths[i] * Math.sin(theta);
        y -= lengths[i] * Math.cos(theta);
        positions.push({ x, y });
    }
    return positions;
}


function updateAngularVelocity(angles, dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (!lastAnglesForVel.length) {
        lastAnglesForVel = angles.slice();
        currentAngularVel = resizeArray(currentAngularVel, angles.length, 0);
        return;
    }
    const n = Math.min(angles.length, linkCount);
    currentAngularVel = resizeArray(currentAngularVel, linkCount, 0);
    for (let i = 0; i < n; i++) {
        currentAngularVel[i] = (angles[i] - lastAnglesForVel[i]) / dt;
    }
    lastAnglesForVel = angles.slice();
}

function detectApiMode() {
    if (typeof window.InitPendulum === "function" && typeof window.StepPendulum === "function") {
        return "multi";
    }
    return "legacy";
}

function clearInitialOmegasAll() {
    // 配置层的初始角速度全部清 0
    currentConfig.omega = resizeArray(currentConfig.omega, linkCount, 0);

    // 运行时角速度缓存也清 0
    currentAngularVel = resizeArray(currentAngularVel, linkCount, 0);

    // 角速度差分的“上一帧角度”对齐一下
    lastAnglesForVel = currentAngles.slice();

    // 同步左侧菜单的 ω 输入框
    updatingInputs = true;
    for (let i = 0; i < linkCount; i++) {
        const idx = i + 1;
        setInputValue(`omega${idx}`, "0.0");
    }
    updatingInputs = false;
}

function handleInputChange() {
    if (updatingInputs) return;

    // 任何菜单参数变动 → 清空初始角速度
    clearInitialOmegasAll();

    // 用当前 UI 配置重置 wasm
    initPendulumFromUI();
}

function convertAnglesForSim(arr) {
    // 无论 legacy / multi，UI 一律下为 0°
    // Go 侧用右为 0° → φ = θ - π/2
    return (arr || []).map((theta) => theta - Math.PI * 0.5);
}


function convertAnglesFromSim(arr) {
    // 从 Go 的右为 0° 还原到 UI 的下为 0°
    return (arr || []).map((theta) => theta + Math.PI * 0.5);
}

function computeWorldRadius(cfg) {
    const total = cfg.L.slice(0, linkCount).reduce((sum, l) => sum + Math.abs(l || 0), 0);
    return Math.max(total * 1.2, 1.5);
}

function setLinkCount(n) {
    const clamped = clampLinks(n);
    if (clamped === linkCount) return;

    linkCount = clamped;

    const linkCountInput = document.getElementById("linkCountInput");
    if (linkCountInput) {
        updatingInputs = true;
        linkCountInput.value = clamped;
        updatingInputs = false;
    }

    currentConfig.links   = clamped;
    currentConfig.L       = resizeArray(currentConfig.L,       clamped, 1.0);
    currentConfig.rodMass = resizeArray(currentConfig.rodMass, clamped, 1.0);
    currentConfig.bobMass = resizeArray(currentConfig.bobMass, clamped, 0.25);
    currentConfig.theta   = resizeArray(
        currentConfig.theta,
        clamped,
        (i) => currentAngles[i] ?? degToRad(120 + i * 10)
    );

    // === 这里直接用一坨 0 覆盖掉之前模拟同步过来的 omega ===
    currentConfig.omega   = new Array(clamped).fill(0);

    // JS 侧缓存也全部归零
    currentAngles     = resizeArray(currentAngles,     clamped, 0);
    currentAngularVel = new Array(clamped).fill(0);
    lastAnglesForVel  = currentAngles.slice();

    resetTrails();
    resetKinematics();
    renderInputs();

    // 这里用 forceZeroOmega = true，保证 wasm 那边也确实从 omega=0 开始
    initPendulumWithConfig(currentConfig, false, true).catch(() => {});
}

function resizeCanvas({ fit = !initialScaleSet } = {}) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = rect.width;
    const h = rect.height;
    centerX = w * 0.5;
    centerY = h * 0.5;

    if (fit) {
        worldRadius = computeWorldRadius(currentConfig);
        const r = Math.min(w, h) * 0.45;
        scale = r / Math.max(0.0001, worldRadius);
        initialScaleSet = true;
    }
}

window.addEventListener("resize", () => resizeCanvas({ fit: false }));

function worldToScreen(x, y) {
    return {
        x: centerX + pivotOffset.x + x * scale,
        y: centerY + pivotOffset.y - y * scale,
    };
}

function screenToWorld(x, y) {
    return {
        x: (x - centerX - pivotOffset.x) / scale,
        y: (centerY + pivotOffset.y - y) / scale,
    };
}

function getPivotScreen() {
    return { x: centerX + pivotOffset.x, y: centerY + pivotOffset.y };
}

function zoomAt(screenX, screenY, factor) {
    const worldBefore = screenToWorld(screenX, screenY);
    scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale * factor));
    pivotOffset.x = screenX - centerX - worldBefore.x * scale;
    pivotOffset.y = screenY - centerY + worldBefore.y * scale;
    initialScaleSet = true;
}

function colorWithAlpha(hex, alpha) {
    const clean = hex.replace("#", "");
    const num = parseInt(clean, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getWorldPositionsFromConfig(cfg) {
    return calcPositionsFromAngles(cfg.theta || [], cfg.L || [], apiMode);
}

// ========= 配置与初始化 =========
function collectConfigFromUI() {
    const L = [];
    const rodMass = [];
    const bobMass = [];
    const theta = [];
    const omega = [];

    for (let i = 0; i < linkCount; i++) {
        const idx = i + 1;
        L.push(readNumber(`L${idx}`, currentConfig.L[i] ?? 1));
        rodMass.push(readNumber(`rodMass${idx}`, currentConfig.rodMass[i] ?? 1));
        bobMass.push(readNumber(`bobMass${idx}`, currentConfig.bobMass[i] ?? 0.25));
        theta.push(degToRad(readNumber(`theta${idx}`, radToDeg(currentConfig.theta[i] ?? 0))));
        omega.push(degToRad(readNumber(`omega${idx}`, radToDeg(currentConfig.omega[i] ?? 0))));
    }

    return {
        ...currentConfig,
        links: linkCount,
        L,
        rodMass,
        bobMass,
        theta,
        omega,
    };
}

function resetTrails() {
    trails = Array.from({ length: linkCount }, () => []);
}

function resetKinematics() {
    accelPositions = [];
    accelVelocities = [];
    lastAccelerations = [];
    lastAnglesForVel = currentAngles.slice();
}

function normalizeConfig(cfg) {
    const n = clampLinks(cfg.links || (cfg.L ? cfg.L.length : linkCount));
    const normalized = {
        ...cfg,
        links: n,
        L: resizeArray(cfg.L, n, 1.0),
        rodMass: resizeArray(cfg.rodMass, n, 1.0),
        bobMass: resizeArray(cfg.bobMass, n, 0.25),
        theta: resizeArray(
            cfg.theta,
            n,
            (i) => currentAngles[i] ?? currentConfig.theta?.[i] ?? degToRad(120 + i * 10),
        ),
        omega: resizeArray(cfg.omega, n, 0),
    };
    return normalized;
}

async function initPendulumWithConfig(cfg, rescale = false, forceZeroOmega = false) {
    await wasmReady;
    apiMode = detectApiMode();

    const normalized = normalizeConfig(cfg);

    // ===== 关键：如果要求强制清零，就这里统一把 omega 归零 =====
    if (forceZeroOmega) {
        normalized.omega = resizeArray(normalized.omega, normalized.links, 0);
    }

    const countChanged = normalized.links !== linkCount;
    linkCount = normalized.links;
    currentConfig = normalized;

    currentAngles = normalized.theta.slice();
    currentAngularVel = normalized.omega.slice();
    lastAnglesForVel = currentAngles.slice();

    if (rescale) {
        worldRadius = computeWorldRadius(currentConfig);
        resizeCanvas({ fit: true });
    }

    const payload = {
        links: currentConfig.links,
        L: currentConfig.L,
        rodMass: currentConfig.rodMass,
        bobMass: currentConfig.bobMass,
        g: currentConfig.g,
        damping: currentConfig.damping,
        theta: apiMode === "multi"
            ? convertAnglesForSim(currentConfig.theta)
            : currentConfig.theta,
        omega: currentConfig.omega,  // 这里已经是清零后的
    };

    // 调试用：你可以先开着看看拖拽后是不是一排 0
    // console.log("Init omega (deg/s):",
    //     payload.omega.map(radToDeg)
    // );

    if (apiMode === "multi" && typeof window.InitPendulum === "function") {
        window.InitPendulum(JSON.stringify(payload));
    } else {
        const legacyPayload = {
            ...payload,
            links: 2,
            L: currentConfig.L.slice(0, 2),
            rodMass: currentConfig.rodMass.slice(0, 2),
            bobMass: currentConfig.bobMass.slice(0, 2),
            theta: currentConfig.theta.slice(0, 2),
            omega: currentConfig.omega.slice(0, 2),
        };
        window.chaosInit(JSON.stringify(legacyPayload));
    }

    resetTrails();
    resetKinematics();
    lastScreenPositions = [];
    lastBobScreenRadii = [];
    lastTime = null;

    if (countChanged) {
        renderInputs();
    }
}

async function initPendulumFromUI() {
    const cfg = collectConfigFromUI();
    await initPendulumWithConfig(cfg, false);
}

function syncConfigFromSimulation() {
    if (apiMode === "multi") {
        const state = typeof window.GetPendulumState === "function" ? window.GetPendulumState() : null;

        // 1) 先拿到 Go 里的角度（φ）
        const thetaSim = state && state.theta ? toNumberArray(state.theta) : currentAngles;
        const omegaSim = state && state.omega ? toNumberArray(state.omega) : currentAngularVel;

        // 2) 转成 UI 角度（θ，下为 0°）
        const thetaUI = convertAnglesFromSim(thetaSim);

        const n = clampLinks(thetaUI.length || linkCount);
        linkCount = n;
        currentConfig.links = n;
        currentConfig.L = resizeArray(currentConfig.L, n, 1.0);
        currentConfig.rodMass = resizeArray(currentConfig.rodMass, n, 1.0);
        currentConfig.bobMass = resizeArray(currentConfig.bobMass, n, 0.25);

        // 用 UI 角度存 config / 当前状态
        currentConfig.theta = resizeArray(thetaUI, n, 0);
        currentConfig.omega = resizeArray(omegaSim, n, 0);
        currentAngles = currentConfig.theta.slice();
        currentAngularVel = currentConfig.omega.slice();

        // 3) 更新 input 显示的角度，直接用 UI 角度
        updatingInputs = true;
        const linkCountInput = document.getElementById("linkCountInput");
        if (linkCountInput) linkCountInput.value = n;
        for (let i = 0; i < n; i++) {
            const idx = i + 1;
            setInputValue(`theta${idx}`, radToDeg(currentConfig.theta[i]).toFixed(1));
            setInputValue(`omega${idx}`, radToDeg(currentConfig.omega[i]).toFixed(1));
        }
        updatingInputs = false;
        renderInputs();
        return;
    }

    const posArr = window.chaosGetPositions?.();
    if (!posArr || posArr.length < 2) return;

    const newL = [];
    const newTheta = [];
    let anchor = { x: 0, y: 0 };
    for (let i = 0; i < linkCount; i++) {
        const idx = i * 2;
        if (posArr.length <= idx + 1) break;
        const tip = { x: posArr[idx], y: posArr[idx + 1] };
        const dx = tip.x - anchor.x;
        const dy = tip.y - anchor.y;
        const len = Math.hypot(dx, dy);
        if (len > 1e-6) {
            newL[i] = len;
            newTheta[i] = Math.atan2(dx, -dy);
        } else {
            newL[i] = currentConfig.L[i] ?? 1;
            newTheta[i] = currentConfig.theta[i] ?? 0;
        }
        anchor = tip;
    }

    const state = window.chaosGetState?.();
    const omegaFromSim =
        state && state.length >= linkCount * 2
            ? state.slice(linkCount).map((v) => (typeof v === "number" ? v : 0))
            : new Array(linkCount).fill(0);

    for (let i = 0; i < linkCount; i++) {
        if (newL[i] !== undefined) currentConfig.L[i] = newL[i];
        if (newTheta[i] !== undefined) currentConfig.theta[i] = newTheta[i];
        if (omegaFromSim[i] !== undefined) currentConfig.omega[i] = omegaFromSim[i];
    }

    updatingInputs = true;
    for (let i = 0; i < linkCount; i++) {
        const idx = i + 1;
        if (newL[i] !== undefined) setInputValue(`L${idx}`, newL[i].toFixed(3));
        if (newTheta[i] !== undefined) setInputValue(`theta${idx}`, radToDeg(newTheta[i]).toFixed(1));
        if (omegaFromSim[i] !== undefined) setInputValue(`omega${idx}`, radToDeg(omegaFromSim[i]).toFixed(1));
    }
    updatingInputs = false;
}

function randomizeUI() {
    for (let i = 0; i < linkCount; i++) {
        const idx = i + 1;
        setInputValue(`theta${idx}`, (60 + Math.random() * 240).toFixed(1));
        setInputValue(`omega${idx}`, (Math.random() * 60 - 30).toFixed(1));
    }
}

// ========= 绘制 =========
function drawFrame(dtPhys, advanceTrail) {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, w, h);

    const usingPreview = isDragging;
    let worldPositions = [];
    let anglesForRender = [];

    if (usingPreview) {
        anglesForRender = currentConfig.theta || [];
        worldPositions = calcPositionsFromAngles(anglesForRender, currentConfig.L || [], apiMode);
    } else if (apiMode === "multi") {
        anglesForRender = currentAngles.length ? currentAngles : currentConfig.theta;
        worldPositions = calcPositionsFromAngles(anglesForRender, currentConfig.L || [], apiMode);
    } else {
        const posArr = window.chaosGetPositions?.();
        const availableLinks = posArr ? Math.min(linkCount, Math.floor(posArr.length / 2)) : 0;
        for (let i = 0; i < availableLinks; i++) {
            const wx = posArr[i * 2];
            const wy = posArr[i * 2 + 1];
            worldPositions.push({ x: wx, y: wy });
        }
        if (!worldPositions.length) {
            anglesForRender = currentAngles.length ? currentAngles : currentConfig.theta;
            worldPositions = calcPositionsFromAngles(anglesForRender, currentConfig.L || []);
        }
    }

    if (!worldPositions.length) {
        drawPivotHandle();
        return;
    }

    const screenPositions = worldPositions.map((p) => worldToScreen(p.x, p.y));
    lastScreenPositions = screenPositions.map((p) => ({ ...p }));

    drawPivotHandle();

    const allowUpdate = advanceTrail && !usingPreview;
    const accelerations = uiOptions.showArrows
        ? updateKinematicHistory(worldPositions, dtPhys, allowUpdate)
        : lastAccelerations;

    updateTrails(screenPositions, dtPhys, allowUpdate && uiOptions.showTrails);
    if (uiOptions.showTrails) {
        drawTrails(screenPositions.length);
    }
    drawRods(screenPositions);
    drawBobs(screenPositions);

    if (uiOptions.showArrows && accelerations.length && screenPositions.length) {
        for (let i = 0; i < Math.min(accelerations.length, screenPositions.length); i++) {
            if (accelerations[i]) {
                drawArrowFromBob(accelerations[i], screenPositions[i], ballColors[i % ballColors.length]);
            }
        }
    }
}

function updateTrails(screenPositions, dtPhys, advanceTrail) {
    const decay = dtPhys > 0 ? dtPhys * TRAIL_FADE_RATE : 0;

    for (let t = 0; t < trails.length; t++) {
        const trail = trails[t];
        if (!trail.length) continue;
        let writeIdx = 0;
        for (let i = 0; i < trail.length; i++) {
            const life = trail[i].life - decay;
            if (life > 0) {
                trail[writeIdx++] = { x: trail[i].x, y: trail[i].y, life };
            }
        }
        trail.length = writeIdx;
    }

    if (!advanceTrail) return;

    for (let i = 0; i < screenPositions.length; i++) {
        const pt = screenPositions[i];
        const trail = trails[i] || (trails[i] = []);
        trail.push({ x: pt.x, y: pt.y, life: 1 });
        if (trail.length > TRAIL_MAX_POINTS) {
            trail.splice(0, trail.length - TRAIL_MAX_POINTS);
        }
    }
}

function drawTrails(activeLinks) {
    for (let i = 0; i < activeLinks; i++) {
        const trail = trails[i];
        if (!trail || trail.length < 2) continue;
        ctx.save();
        ctx.lineWidth = 2;
        for (let j = 1; j < trail.length; j++) {
            const prev = trail[j - 1];
            const curr = trail[j];
            const alpha = Math.max(0, Math.min(prev.life, curr.life));
            if (alpha <= 0) continue;
            ctx.strokeStyle = colorWithAlpha(ballColors[i % ballColors.length], alpha);
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(curr.x, curr.y);
            ctx.stroke();
        }
        ctx.restore();
    }
}

function drawRods(screenPositions) {
    ctx.save();
    ctx.lineCap = "round";
    const pivot = worldToScreen(0, 0);

    for (let i = 0; i < screenPositions.length; i++) {
        const start = i === 0 ? pivot : screenPositions[i - 1];
        const end = screenPositions[i];
        ctx.strokeStyle = i === 0 ? "rgba(200,200,200,0.95)" : "rgba(255,255,255,0.95)";
        ctx.lineWidth = 2.6 - i * 0.2;
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
    }

    ctx.restore();
}

function bobRadius(mass) {
    const safeMass = Math.max(0.05, mass || 0.2);
    return Math.min(16, 6 + Math.sqrt(safeMass) * 4);
}

function drawBobs(screenPositions) {
    ctx.save();
    lastBobScreenRadii = [];

    for (let i = 0; i < screenPositions.length; i++) {
        const pos = screenPositions[i];
        const radius = bobRadius(currentConfig.bobMass[i]);
        lastBobScreenRadii[i] = radius;

        ctx.fillStyle = ballColors[i % ballColors.length];
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }

    ctx.restore();
}

function drawPivotHandle() {
    const pivot = getPivotScreen();
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(pivot.x, pivot.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

function updateKinematicHistory(worldPositions, dtPhys, allowUpdate) {
    if (!allowUpdate || dtPhys <= 0) {
        const cached = [];
        for (let i = 0; i < worldPositions.length; i++) {
            cached.push(lastAccelerations[i] || null);
        }
        return cached;
    }

    if (!accelPositions.length) {
        accelPositions = worldPositions.map((p) => ({ ...p }));
        accelVelocities = worldPositions.map(() => ({ x: 0, y: 0 }));
        lastAccelerations = new Array(worldPositions.length).fill(null);
        return lastAccelerations;
    }

    const accelerations = [];

    for (let i = 0; i < worldPositions.length; i++) {
        const prevPos = accelPositions[i] || worldPositions[i];
        const vx = (worldPositions[i].x - prevPos.x) / dtPhys;
        const vy = (worldPositions[i].y - prevPos.y) / dtPhys;

        const prevVel = accelVelocities[i] || { x: 0, y: 0 };
        const ax = (vx - prevVel.x) / dtPhys;
        const ay = (vy - prevVel.y) / dtPhys;

        accelerations.push({ x: ax, y: ay });
        accelVelocities[i] = { x: vx, y: vy };
        accelPositions[i] = { ...worldPositions[i] };
    }

    lastAccelerations = accelerations;
    return accelerations;
}

function drawArrowFromBob(accWorld, bobScreen, color) {
    if (!accWorld) return;

    const ax = accWorld.x;
    const ay = accWorld.y;
    const mag = Math.hypot(ax, ay);
    if (mag < 1e-4) return;

    const dx = ax / mag;
    const dy = ay / mag;

    const baseLen = 0.25 * scale;
    let arrowLen = mag * baseLen;
    arrowLen = Math.min(arrowLen, 80);

    const sx = dx * arrowLen;
    const sy = -dy * arrowLen;

    const endX = bobScreen.x + sx;
    const endY = bobScreen.y + sy;

    ctx.save();
    ctx.strokeStyle = colorWithAlpha(color, 0.9);
    ctx.fillStyle = colorWithAlpha(color, 0.9);
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(bobScreen.x, bobScreen.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    const headSize = 8;
    const angle = Math.atan2(sy, sx);

    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
        endX - headSize * Math.cos(angle - Math.PI / 7),
        endY - headSize * Math.sin(angle - Math.PI / 7),
    );
    ctx.lineTo(
        endX - headSize * Math.cos(angle + Math.PI / 7),
        endY - headSize * Math.sin(angle + Math.PI / 7),
    );
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

// ========= 交互 =========
document.getElementById("btnPlayPause").addEventListener("click", () => {
    running = !running;
    document.getElementById("btnPlayPause").textContent = running ? "Pause" : "Unpause";
    if (!running) {
        syncConfigFromSimulation();
    }
});

document.getElementById("btnRandom").addEventListener("click", () => {
    randomizeUI();
    initPendulumFromUI();
});

// document.getElementById("btnShare").addEventListener("click", () => {
//     navigator.clipboard?.writeText(location.href).catch(() => {});
// });

canvas.addEventListener(
    "wheel",
    (evt) => {
        evt.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const x = evt.clientX - rect.left;
        const y = evt.clientY - rect.top;
        const factor = Math.exp(-evt.deltaY * ZOOM_SENSITIVITY);
        zoomAt(x, y, factor);
    },
    { passive: false },
);

const toggleTrails = document.getElementById("toggleTrails");
if (toggleTrails) {
    toggleTrails.checked = uiOptions.showTrails;
    toggleTrails.addEventListener("change", (e) => {
        uiOptions.showTrails = e.target.checked;
        if (!uiOptions.showTrails) {
            resetTrails();
        }
    });
}

const toggleArrows = document.getElementById("toggleArrows");
if (toggleArrows) {
    toggleArrows.checked = uiOptions.showArrows;
    toggleArrows.addEventListener("change", (e) => {
        uiOptions.showArrows = e.target.checked;
    });
}

const linkCountInput = document.getElementById("linkCountInput");
if (linkCountInput) {
    linkCountInput.addEventListener("change", (e) => {
        if (updatingInputs) return;
        const n = clampLinks(parseInt(e.target.value, 10));
        linkCountInput.value = n;
        setLinkCount(n);
    });
}

canvas.addEventListener("pointerdown", (evt) => {
    if (evt.button === 1) {
        evt.preventDefault();
        startPan(evt);
        return;
    }
    if (evt.button !== 0) return;

    const target = pickTarget(evt);
    if (target === null) return;
    dragTargetIndex = target;
    isDragging = true;
    wasRunningBeforeDrag = running;
    running = false;
    document.getElementById("btnPlayPause").textContent = "Unpause";

    canvas.setPointerCapture(evt.pointerId);

    if (target === DRAG_PIVOT) {
        const rect = canvas.getBoundingClientRect();
        const x = evt.clientX - rect.left;
        const y = evt.clientY - rect.top;
        const pivot = getPivotScreen();
        pivotGrabOffset = { x: pivot.x - x, y: pivot.y - y };
    } else {
        pivotGrabOffset = { x: 0, y: 0 };
    }

    handleDrag(evt);
});

canvas.addEventListener("pointermove", (evt) => {
    if (isPanning) {
        handlePan(evt);
        return;
    }
    if (dragTargetIndex === null) return;
    handleDrag(evt);
});

canvas.addEventListener("pointerup", (evt) => {
    if (evt.button === 1 && isPanning) {
        try {
            canvas.releasePointerCapture(evt.pointerId);
        } catch (_e) {}
        endPan();
        return;
    }
    if (dragTargetIndex === null) return;
    canvas.releasePointerCapture(evt.pointerId);
    finishDrag(true);
});

canvas.addEventListener("pointerleave", (evt) => {
    if (isPanning) {
        try {
            canvas.releasePointerCapture(evt.pointerId);
        } catch (_e) {}
        endPan();
    }
    if (dragTargetIndex !== null) {
        try {
            canvas.releasePointerCapture(evt.pointerId);
        } catch (_e) {
            // ignore
        }
        finishDrag(true);
    }
});

function pickTarget(evt) {
    const rect = canvas.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;

    const pivot = getPivotScreen();
    if (Math.hypot(x - pivot.x, y - pivot.y) <= 14) {
        return DRAG_PIVOT;
    }

    if (!lastScreenPositions.length) return null;

    let bestIdx = null;
    let bestDist = Infinity;
    for (let i = 0; i < lastScreenPositions.length; i++) {
        const pos = lastScreenPositions[i];
        const radius = (lastBobScreenRadii[i] || 10) + 8;
        const dist = Math.hypot(x - pos.x, y - pos.y);
        if (dist < radius && dist < bestDist) {
            bestIdx = i;
            bestDist = dist;
        }
    }
    return bestIdx;
}

function startPan(evt) {
    isPanning = true;
    panLast = { x: evt.clientX, y: evt.clientY };
    try {
        canvas.setPointerCapture(evt.pointerId);
    } catch (_e) {
        // ignore
    }
}

function handlePan(evt) {
    if (!isPanning) return;
    const dx = evt.clientX - panLast.x;
    const dy = evt.clientY - panLast.y;
    panLast = { x: evt.clientX, y: evt.clientY };
    pivotOffset.x += dx;
    pivotOffset.y += dy;
}

function endPan() {
    isPanning = false;
}

function handleDrag(evt) {
    if (dragTargetIndex === null) return;

    const rect = canvas.getBoundingClientRect();
    const screenPt = { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
    if (dragTargetIndex === DRAG_PIVOT) {
        const targetX = screenPt.x + pivotGrabOffset.x;
        const targetY = screenPt.y + pivotGrabOffset.y;
        pivotOffset = { x: targetX - centerX, y: targetY - centerY };
        return;
    }

    const worldPt = screenToWorld(screenPt.x, screenPt.y);

    const positionsFromConfig = getWorldPositionsFromConfig(currentConfig);
    const anchorWorld =
        dragTargetIndex === 0
            ? { x: 0, y: 0 }
            : positionsFromConfig[dragTargetIndex - 1] || { x: 0, y: 0 };

    const dx = worldPt.x - anchorWorld.x;
    const dy = worldPt.y - anchorWorld.y;
    const newLen = Math.hypot(dx, dy);
    if (newLen < 1e-4) return;

    const newTheta = Math.atan2(dx, -dy);  // 下为 0°，逆时针为正

    currentConfig.L[dragTargetIndex] = newLen;
    currentConfig.theta[dragTargetIndex] = newTheta;
    currentAngles = resizeArray(currentAngles, linkCount, 0);
    currentAngles[dragTargetIndex] = newTheta;
    currentAngularVel = resizeArray(currentAngularVel, linkCount, 0);
    currentAngularVel[dragTargetIndex] = 0;
    lastAnglesForVel = currentAngles.slice();

    setInputValue(`L${dragTargetIndex + 1}`, newLen.toFixed(3));
    setInputValue(`theta${dragTargetIndex + 1}`, radToDeg(newTheta).toFixed(1));
}

function finishDrag(needReinit) {
    const target = dragTargetIndex;
    dragTargetIndex = null;
    if (!isDragging) return;

    // 先把菜单里的初始速度全部显示为 0
    updatingInputs = true;
    for (let i = 0; i < linkCount; i++) {
        const idx = i + 1;
        setInputValue(`omega${idx}`, "0.0");
    }
    updatingInputs = false;

    const resume = () => {
        running = wasRunningBeforeDrag;
        document.getElementById("btnPlayPause").textContent =
            running ? "Pause" : "Unpause";
        isDragging = false;
    };

    // pivot 拖拽只是挪位置，不改物理状态的话可以直接返回
    if (!needReinit || target === DRAG_PIVOT) {
        resume();
        return;
    }

    // 这里强制用“初始速度=0”的配置重置 wasm 状态
    initPendulumWithConfig(currentConfig, false, true)
        .then(resume)
        .catch(resume);
}

// ========= 主循环 =========
function loop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const dtRaw = (timestamp - lastTime) / 1000;
    lastTime = timestamp;

    let dtPhys = 0;
    if (running) {
        const dtStep = 1 / 240;
        const substeps = Math.max(1, Math.round(dtRaw / dtStep)) || 1;
        dtPhys = dtStep * substeps;

        for (let i = 0; i < substeps; i++) {
            if (apiMode === "multi" && typeof window.StepPendulum === "function") {
                const res = window.StepPendulum(dtStep);
                const anglesSim = toNumberArray(res, linkCount);
                if (anglesSim.length) {
                    currentAngles = resizeArray(convertAnglesFromSim(anglesSim), linkCount, 0);
                    updateAngularVelocity(currentAngles, dtStep);
                    currentConfig.theta = currentAngles.slice();
                }
            } else {
                window.chaosStep(dtStep, 1);
                const state = window.chaosGetState?.();
                if (state && state.length >= linkCount) {
                    currentAngles = toNumberArray(state.slice(0, linkCount), linkCount);
                }
            }
        }
    }

    drawFrame(dtPhys, running);
    requestAnimationFrame(loop);
}

// ========= 启动 =========
(async function start() {
    resizeCanvas({ fit: true });
    resetTrails();
    await initPendulumFromUI();
    requestAnimationFrame(loop);
})();
