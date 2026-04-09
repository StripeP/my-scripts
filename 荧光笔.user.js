// ==UserScript==
// @name         🖍️ 荧光笔 Pro
// @namespace    http://tampermonkey.net/
// @version      2.2.0
// @description  按住右键画荧光笔，支持发光渐变样式、智能区分绘图与正常右键菜单
// @author       StripeP
// @match        *://*/*
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // ========== 配置项 ==========
    const CONFIG = {
        colors: [
            '#FF3B30',  // 红
            '#FF9500',  // 橙
            '#FFCC00',  // 黄
            '#34C759',  // 绿
            '#00C7BE',  // 青
            '#007AFF',  // 蓝
            '#AF52DE',  // 紫
            '#FF2D55',  // 粉
        ],
        defaultColorIndex: 2,       // 默认黄色
        width: 10,                  // 笔刷宽度（默认较细）
        minWidth: 3,
        maxWidth: 80,
        opacity: 0.70,              // 不透明度
        fadeEnabled: true,          // 是否自动消散
        fadeDelay: 3000,            // 消散延迟（毫秒）
        fadeDuration: 1200,         // 消散动画时长
        style: 'glow',              // 样式：solid | glow | neon | marker
        glowSize: 2.0,              // 发光扩散倍数（相对于笔刷大小）
    };

    // 样式定义：每种样式的径向渐变模板
    const STYLES = {
        solid: {
            name: '实心',
            desc: '纯色填充',
            makeGradient(color, op) {
                return `radial-gradient(circle, ${hexToRgba(color, op)} 0%, ${hexToRgba(color, op)} 100%)`;
            },
            boxShadow: null,
        },
        glow: {
            name: '发光',
            desc: '白芯 + 色光晕',
            makeGradient(color, op) {
                return `radial-gradient(circle, rgba(255,255,255,${op * 0.95}) 0%, ${hexToRgba(color, op * 0.6)} 35%, ${hexToRgba(color, op * 0.25)} 65%, transparent 100%)`;
            },
            boxShadow: (color, op, size) => `0 0 ${Math.round(size * 0.8)}px ${hexToRgba(color, op * 0.5)}, 0 0 ${Math.round(size * 1.5)}px ${hexToRgba(color, op * 0.25)}`,
        },
        neon: {
            name: '霓虹',
            desc: '强色芯 + 外发光',
            makeGradient(color, op) {
                return `radial-gradient(circle, ${hexToRgba('#ffffff', op * 0.9)} 0%, ${hexToRgba(color, op * 0.8)} 20%, ${hexToRgba(color, op * 0.35)} 50%, transparent 85%)`;
            },
            boxShadow: (color, op, size) => `0 0 ${Math.round(size * 0.5)}px ${color}, 0 0 ${Math.round(size * 1.2)}px ${hexToRgba(color, op * 0.6)}, 0 0 ${Math.round(size * 2.2)}px ${hexToRgba(color, op * 0.3)}`,
        },
        marker: {
            name: '马克笔',
            desc: '半透明水彩感',
            makeGradient(color, op) {
                return `radial-gradient(circle, ${hexToRgba(color, op * 0.55)} 0%, ${hexToRgba(color, op * 0.35)} 40%, ${hexToRgba(color, op * 0.12)} 75%, transparent 100%)`;
            },
            boxShadow: null,
        },
    };

    let currentColorIndex = CONFIG.defaultColorIndex;
    let isDrawing = false;
    let lastX = null;
    let lastY = null;
    let strokeElements = [];
    let currentStroke = [];
    let allStrokes = [];

    // 智能右键检测：区分「画画」和「普通右键菜单」
    let rightDownPos = null;        // 右键按下的起始位置
    let rightButtonDown = false;   // 右键是否处于按下状态
    let hasDrawn = false;           // 本次右键是否已经产生了笔迹（用于判断是否屏蔽菜单）
    const DRAW_THRESHOLD = 5;       // 移动超过此像素数才判定为绘画

    // ========== 颜色工具 ==========
    function hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    // ========== 注入样式 ==========
    const style = `
        .hl-container {
            position: fixed; top: 0; left: 0;
            width: 100%; height: 100%;
            pointer-events: none;
            z-index: 2147483647;
            overflow: hidden;
        }
        .hl-dot {
            position: absolute;
            border-radius: 50%;
            pointer-events: none;
            transform: translate(-50%, -50%);
            transition: opacity ${CONFIG.fadeDuration}ms ease-out;
            will-change: opacity, transform;
        }
        .hl-dot.fading { opacity: 0 !important; }

        /* ======== 工具栏 ======== */
        .hl-tb {
            position: fixed;
            z-index: 2147483647;
            display: none;
            flex-direction: column;
            gap: 4px;
            padding: 8px 10px;
            background: rgba(22, 22, 28, 0.94);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 14px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            animation: hlTbIn 0.18s cubic-bezier(.16,1,.3,1);
            min-width: 200px;
        }
        @keyframes hlTbIn {
            from { opacity: 0; transform: scale(0.88) translateY(-6px); }
            to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        .hl-tb-row {
            display: flex;
            gap: 5px;
            align-items: center;
            flex-wrap: nowrap;
        }
        .hl-tb-section-label {
            font-size: 10px;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            padding: 1px 0 2px;
            margin-top: 2px;
        }

        /* 颜色按钮 */
        .hl-c-btn {
            width: 22px; height: 22px;
            border-radius: 50%;
            border: 2px solid transparent;
            cursor: pointer;
            transition: all 0.15s ease;
            flex-shrink: 0;
            position: relative;
        }
        .hl-c-btn:hover { transform: scale(1.22); }
        .hl-c-btn.active {
            border-color: #fff;
            transform: scale(1.15);
            box-shadow: 0 0 8px rgba(255,255,255,0.35);
        }
        /* 自定义颜色输入 */
        .hl-c-custom {
            width: 22px; height: 22px;
            border-radius: 50%;
            border: 2px dashed rgba(255,255,255,0.3);
            cursor: pointer;
            background: conic-gradient(from 0deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
            flex-shrink: 0;
            overflow: hidden;
            -webkit-appearance: none;
            appearance: none;
            padding: 0;
        }
        .hl-c-custom::-webkit-color-swatch-wrapper { padding: 0; }
        .hl-c-custom::-webkit-color-swatch {
            border: none;
            border-radius: 50%;
        }
        .hl-c-custom:hover { transform: scale(1.22); }

        /* 分隔线 */
        .hl-sep {
            height: 1px;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
            margin: 4px 0;
        }

        /* 滑块通用 */
        .hl-slider-wrap {
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 1;
        }
        .hl-lbl {
            font-size: 11px;
            color: #aaa;
            min-width: 42px;
            white-space: nowrap;
            flex-shrink: 0;
        }
        .hl-val {
            font-size: 10px;
            color: #888;
            min-width: 32px;
            text-align: right;
            font-variant-numeric: tabular-nums;
        }
        input[type=range].hl-range {
            flex: 1;
            height: 4px;
            appearance: none;
            background: rgba(255,255,255,0.1);
            border-radius: 2px;
            outline: none;
            min-width: 60px;
        }
        input[type=range].hl-range::-webkit-slider-thumb {
            appearance: none;
            width: 14px; height: 14px;
            border-radius: 50%;
            background: #fff;
            cursor: pointer;
            box-shadow: 0 1px 4px rgba(0,0,0,0.35);
            transition: transform 0.1s;
        }
        input[type=range].hl-range::-webkit-slider-thumb:hover {
            transform: scale(1.2);
        }

        /* 开关 */
        .hl-sw-wrap {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }
        .hl-sw {
            position: relative;
            width: 36px; height: 19px;
            appearance: none;
            background: rgba(255,255,255,0.12);
            border-radius: 10px;
            cursor: pointer;
            transition: background 0.2s;
            flex-shrink: 0;
        }
        .hl-sw:checked { background: #34C759; }
        .hl-sw::before {
            content: '';
            position: absolute;
            top: 2px; left: 2px;
            width: 15px; height: 15px;
            background: #fff;
            border-radius: 50%;
            transition: left 0.2s ease;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
        .hl-sw:checked::before { left: 19px; }

        /* 样式选择按钮 */
        .hl-sty-btn {
            font-size: 10px;
            padding: 3px 8px;
            border-radius: 6px;
            border: 1px solid rgba(255,255,255,0.1);
            background: rgba(255,255,255,0.06);
            color: #aaa;
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.15s;
            font-family: inherit;
        }
        .hl-sty-btn:hover { background: rgba(255,255,255,0.12); color: #ddd; }
        .hl-sty-btn.active {
            background: rgba(52,199,89,0.2);
            border-color: rgba(52,199,89,0.5);
            color: #34C759;
        }

        /* 操作按钮 */
        .hl-act-btn {
            font-size: 11px;
            color: #ccc;
            background: rgba(255,255,255,0.07);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 8px;
            padding: 5px 12px;
            cursor: pointer;
            transition: all 0.15s;
            font-family: inherit;
            flex: 1;
        }
        .hl-act-btn:hover {
            background: rgba(255,255,255,0.14);
            color: #fff;
        }

        /* 提示气泡 */
        .hl-toast {
            position: fixed; z-index: 2147483647;
            bottom: 30px; left: 50%;
            transform: translateX(-50%);
            background: rgba(22, 22, 28, 0.93);
            color: #e0e0e0;
            padding: 10px 24px;
            border-radius: 12px;
            font-size: 13px;
            font-family: -apple-system, "Segoe UI", "PingFang SC", sans-serif;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.3s ease;
            box-shadow: 0 6px 24px rgba(0,0,0,0.45);
            backdrop-filter: blur(16px);
            text-align: center;
            max-width: 360px;
            line-height: 1.4;
        }
        .hl-toast.show { opacity: 1; }
    `;

    if (typeof GM_addStyle === 'function') GM_addStyle(style);
    else { const s = document.createElement('style'); s.textContent = style; (document.head || document.documentElement).appendChild(s); }

    // ========== 容器 ==========
    let container = document.querySelector('.hl-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'hl-container';
        document.documentElement.appendChild(container);
    }

    // ========== 工具栏构建 ==========
    let toolbar = null;

    function buildToolbar() {
        const tb = document.createElement('div');
        tb.className = 'hl-tb';
        tb.id = 'hl-toolbar';

        // ---- 颜色选择 ----
        const secColor = document.createElement('div');
        secColor.className = 'hl-tb-section-label'; secColor.textContent = '颜色';
        tb.appendChild(secColor);

        const rowColor = document.createElement('div');
        rowColor.className = 'hl-tb-row';
        CONFIG.colors.forEach((c, i) => {
            const btn = document.createElement('button');
            btn.className = 'hl-c-btn' + (i === currentColorIndex ? ' active' : '');
            btn.style.backgroundColor = c;
            btn.title = c;
            btn.addEventListener('click', () => selectPresetColor(i));
            rowColor.appendChild(btn);
        });
        // 自定义颜色选择器
        const customPicker = document.createElement('input');
        customPicker.type = 'color';
        customPicker.className = 'hl-c-custom';
        customPicker.value = CONFIG.colors[currentColorIndex];
        customPicker.title = '自定义颜色';
        customPicker.addEventListener('input', (e) => selectCustomColor(e.target.value));
        rowColor.appendChild(customPicker);
        tb.appendChild(rowColor);

        // 分隔
        tb.appendChild(document.createElement('div')).className = 'hl-sep';

        // ---- 样式选择 ----
        const secStyle = document.createElement('div');
        secStyle.className = 'hl-tb-section-label'; secStyle.textContent = '样式';
        tb.appendChild(secStyle);

        const rowStyle = document.createElement('div');
        rowStyle.className = 'hl-tb-row';
        Object.keys(STYLES).forEach(key => {
            const s = STYLES[key];
            const btn = document.createElement('button');
            btn.className = 'hl-sty-btn' + (key === CONFIG.style ? ' active' : '');
            btn.textContent = s.name;
            btn.title = s.desc;
            btn.dataset.styleKey = key;
            btn.addEventListener('click', () => selectStyle(key));
            rowStyle.appendChild(btn);
        });
        tb.appendChild(rowStyle);

        // 分隔
        tb.appendChild(document.createElement('div')).className = 'hl-sep';

        // ---- 粗细 ----
        const rowW = document.createElement('div');
        rowW.className = 'hl-tb-row';
        const wLbl = document.createElement('span'); wLbl.className = 'hl-lbl'; wLbl.textContent = '粗细';
        const wWrap = document.createElement('div'); wWrap.className = 'hl-slider-wrap';
        const wSlider = document.createElement('input'); wSlider.type = 'range'; wSlider.className = 'hl-range';
        wSlider.min = String(CONFIG.minWidth); wSlider.max = String(CONFIG.maxWidth); wSlider.value = String(CONFIG.width); wSlider.step = '1';
        const wVal = document.createElement('span'); wVal.className = 'hl-val'; wVal.textContent = CONFIG.width + 'px';
        wSlider.addEventListener('input', () => { CONFIG.width = parseInt(wSlider.value); wVal.textContent = CONFIG.width + 'px'; });
        wWrap.appendChild(wSlider); wWrap.appendChild(wVal);
        rowW.appendChild(wLbl); rowW.appendChild(wWrap);
        tb.appendChild(rowW);

        // ---- 透明度 ----
        const rowO = document.createElement('div');
        rowO.className = 'hl-tb-row';
        const oLbl = document.createElement('span'); oLbl.className = 'hl-lbl'; oLbl.textContent = '透明度';
        const oWrap = document.createElement('div'); oWrap.className = 'hl-slider-wrap';
        const oSlider = document.createElement('input'); oSlider.type = 'range'; oSlider.className = 'hl-range';
        oSlider.min = '5'; oSlider.max = '100'; oSlider.value = String(Math.round(CONFIG.opacity * 100)); oSlider.step = '1';
        const oVal = document.createElement('span'); oVal.className = 'hl-val'; oVal.textContent = Math.round(CONFIG.opacity * 100) + '%';
        oSlider.addEventListener('input', () => { CONFIG.opacity = parseInt(oSlider.value) / 100; oVal.textContent = parseInt(oSlider.value) + '%'; });
        oWrap.appendChild(oSlider); oWrap.appendChild(oVal);
        rowO.appendChild(oLbl); rowO.appendChild(oWrap);
        tb.appendChild(rowO);

        // ---- 消散延迟 ----
        const rowD = document.createElement('div');
        rowD.className = 'hl-tb-row';
        const dLbl = document.createElement('span'); dLbl.className = 'hl-lbl'; dLbl.textContent = '消散时间';
        const dWrap = document.createElement('div'); dWrap.className = 'hl-slider-wrap';
        const dSlider = document.createElement('input'); dSlider.type = 'range'; dSlider.className = 'hl-range';
        dSlider.min = '500'; dSlider.max = '8000'; dSlider.value = String(CONFIG.fadeDelay); dSlider.step = '250';
        const dVal = document.createElement('span'); dVal.className = 'hl-val'; dVal.textContent = (CONFIG.fadeDelay / 1000).toFixed(1) + 's';
        dSlider.addEventListener('input', () => { CONFIG.fadeDelay = parseInt(dSlider.value); dVal.textContent = (CONFIG.fadeDelay / 1000).toFixed(1) + 's'; });
        dWrap.appendChild(dSlider); dWrap.appendChild(dVal);
        rowD.appendChild(dLbl); rowD.appendChild(dWrap);
        tb.appendChild(rowD);

        // 分隔
        tb.appendChild(document.createElement('div')).className = 'hl-sep';

        // ---- 自动消散开关 ----
        const swRow = document.createElement('div');
        swRow.className = 'hl-sw-wrap';
        const swLbl = document.createElement('span'); swLbl.className = 'hl-lbl'; swLbl.textContent = '自动消散';
        const swEl = document.createElement('input'); swEl.type = 'checkbox'; swEl.className = 'hl-sw';
        swEl.checked = CONFIG.fadeEnabled;
        swEl.addEventListener('change', () => { CONFIG.fadeEnabled = swEl.checked; });
        swRow.appendChild(swLbl); swRow.appendChild(swEl);
        tb.appendChild(swRow);

        // 分隔
        tb.appendChild(document.createElement('div')).className = 'hl-sep';

        // ---- 操作按钮 ----
        const actRow = document.createElement('div');
        actRow.className = 'hl-tb-row';
        const clearBtn = document.createElement('button');
        clearBtn.className = 'hl-act-btn'; clearBtn.textContent = '🗑 清除全部';
        clearBtn.addEventListener('click', clearAllStrokes);
        actRow.appendChild(clearBtn);
        tb.appendChild(actRow);

        return tb;
    }

    toolbar = document.getElementById('hl-toolbar') || buildToolbar();
    if (!toolbar.parentNode) document.documentElement.appendChild(toolbar);

    // 缓存工具栏内的关键元素引用
    const toolbarRefs = {
        colorBtns: () => toolbar.querySelectorAll('.hl-c-btn'),
        styleBtns: () => toolbar.querySelectorAll('.hl-sty-btn'),
        customPicker: () => toolbar.querySelector('.hl-c-custom'),
    };

    // ---------- 选择逻辑 ----------
    function selectPresetColor(index) {
        currentColorIndex = index;
        const c = CONFIG.colors[index];
        toolbarRefs.colorBtns().forEach((btn, i) => btn.classList.toggle('active', i === index));
        const cp = toolbarRefs.customPicker();
        if (cp) cp.value = c;
    }

    function selectCustomColor(hex) {
        // 加入到预设列表（如果不存在）
        let idx = CONFIG.colors.indexOf(hex);
        if (idx === -1) {
            CONFIG.colors.push(hex);
            idx = CONFIG.colors.length - 1;
            // 在工具栏添加按钮
            const row = toolbar.querySelector('.hl-tb-row');
            if (row) {
                const btn = document.createElement('button');
                btn.className = 'hl-c-btn active';
                btn.style.backgroundColor = hex;
                btn.title = hex;
                btn.addEventListener('click', () => selectPresetColor(idx));
                // 移除其他active
                toolbarRefs.colorBtns().forEach(b => b.classList.remove('active'));
                // 插入到自定义颜色前面
                const picker = toolbarRefs.customPicker();
                if (picker) row.insertBefore(btn, picker);
            }
        } else {
            selectPresetColor(idx);
        }
        currentColorIndex = idx;
    }

    function selectStyle(key) {
        CONFIG.style = key;
        toolbarRefs.styleBtns().forEach(btn => {
            btn.classList.toggle('active', btn.dataset.styleKey === key);
        });
    }

    // ========== 提示气泡 ==========
    let toast = document.querySelector('.hl-toast');
    if (!toast) { toast = document.createElement('div'); toast.className = 'hl-toast'; document.documentElement.appendChild(toast); }
    let toastTimer = null;
    function showToast(msg) {
        toast.textContent = msg; toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
    }

    // ========== 绘制核心 ==========
    function getPointerPos(e) {
        if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        return { x: e.clientX, y: e.clientY };
    }

    function getCurrentColor() {
        return CONFIG.colors[currentColorIndex] || CONFIG.colors[CONFIG.defaultColorIndex];
    }

    function createDot(x, y) {
        const dot = document.createElement('div');
        dot.className = 'hl-dot';

        const size = CONFIG.width;
        const color = getCurrentColor();
        const op = CONFIG.opacity;
        const sty = STYLES[CONFIG.style] || STYLES.glow;

        dot.style.left = x + 'px';
        dot.style.top = y + 'px';
        dot.style.width = size + 'px';
        dot.style.height = size + 'px';
        dot.style.background = sty.makeGradient(color, op);

        if (sty.boxShadow) {
            dot.style.boxShadow = sty.boxShadow(color, op, size);
        }

        return dot;
    }

    function interpolate(x0, y0, x1, y1) {
        const dist = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
        // 步长随笔刷大小自适应，越细插值越密
        const step = Math.max(CONFIG.width * 0.2, 1.5);
        const count = Math.max(Math.floor(dist / step), 1);
        const points = [];
        for (let i = 0; i <= count; i++) {
            const t = i / count;
            points.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
        }
        return points;
    }

    // ---------- 绘制事件（智能右键检测） ----------
    function startDraw(e) {
        // 只响应右键按下，不阻止默认行为（让正常右键菜单能弹出）
        if (e.button !== 2 && e.type !== 'touchstart') return;
        if (e.target.closest('.hl-tb')) return;

        const pos = getPointerPos(e);

        // 记录右键按下位置，暂不开始绘图
        rightDownPos = pos;
        rightButtonDown = true;
        hasDrawn = false;
        lastX = pos.x;
        lastY = pos.y;
    }

    function draw(e) {
        if (!rightButtonDown) return;

        const pos = getPointerPos(e);

        // 检测是否移动了足够距离（超过阈值才判定为绘画意图）
        const dx = pos.x - rightDownPos.x;
        const dy = pos.y - rightDownPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (!isDrawing && dist > DRAW_THRESHOLD) {
            // 超过阈值 → 确认是绘画模式
            isDrawing = true;
            hasDrawn = true;
            currentStroke = [];
            e.preventDefault();

            // 在起始点画第一个点
            const dot = createDot(rightDownPos.x, rightDownPos.y);
            container.appendChild(dot);
            currentStroke.push(dot);
            strokeElements.push(dot);
            allStrokes.push(currentStroke);

            if (CONFIG.fadeEnabled) scheduleFade(currentStroke);
        }

        // 如果已经在绘图状态，继续画
        if (isDrawing) {
            e.preventDefault();
            if (lastX !== null && lastY !== null) {
                const points = interpolate(lastX, lastY, pos.x, pos.y);
                for (const p of points) {
                    const dot = createDot(p.x, p.y);
                    container.appendChild(dot);
                    currentStroke.push(dot);
                    strokeElements.push(dot);
                }
            }
            lastX = pos.x; lastY = pos.y;
        } else {
            // 还没进入绘画模式，更新 last 位置以便后续计算距离
            // 不画任何东西
        }
    }

    function endDraw(e) {
        if (e.button === 2 || e.type === 'touchend') {
            // 右键松开时：如果没产生过笔迹，说明是普通右键点击，什么都不做让菜单正常弹出
            // 如果产生了笔迹，说明是画画结束
            if (isDrawing || hasDrawn) {
                // 画画结束，不触发右键菜单
                isDrawing = false;
                rightButtonDown = false;
                rightDownPos = null;
                lastX = null; lastY = null;
                currentStroke = [];

                // 阻止这次mouseup触发的contextmenu
                suppressNextContextMenu = true;
                setTimeout(() => { suppressNextContextMenu = false; }, 50);
            } else {
                // 普通右键点击，重置状态
                rightButtonDown = false;
                rightDownPos = null;
                hasDrawn = false;
            }
        }
    }

    // 用于在绘画结束时临时屏蔽 contextmenu
    let suppressNextContextMenu = false;

    // ========== 消散动画 ==========
    const fadeTimers = new Map();

    function scheduleFade(stroke) {
        if (fadeTimers.has(stroke)) clearTimeout(fadeTimers.get(stroke));
        const timer = setTimeout(() => {
            stroke.forEach(dot => dot.classList.add('fading'));
            setTimeout(() => {
                stroke.forEach(dot => { if (dot.parentNode) dot.remove(); });
                const idx = allStrokes.indexOf(stroke);
                if (idx > -1) allStrokes.splice(idx, 1);
            }, CONFIG.fadeDuration + 60);
        }, CONFIG.fadeDelay);
        fadeTimers.set(stroke, timer);
    }

    function clearAllStrokes() {
        fadeTimers.forEach(t => clearTimeout(t));
        fadeTimers.clear();
        allStrokes.forEach(s => s.forEach(dot => { if (dot.parentNode) dot.remove(); }));
        allStrokes = []; strokeElements = []; currentStroke = [];
        showToast('✨ 已清除所有荧光笔记号');
    }

    // ========== 工具栏显示/隐藏 ==========
    let toolbarVisible = false;

    function showToolbarAt(x, y) {
        const tbW = 220, tbH = 420;
        let tx = x + 14, ty = y - 10;
        if (tx + tbW > window.innerWidth - 10) tx = x - tbW - 14;
        if (ty + tbH > window.innerHeight - 10) ty = window.innerHeight - tbH - 10;
        if (ty < 10) ty = 10;
        toolbar.style.left = tx + 'px';
        toolbar.style.top = ty + 'px';
        toolbar.style.display = 'flex';
        toolbarVisible = true;
        // 工具栏常驻，不再自动关闭（仅点击空白或双击右键关闭）
    }

    function hideToolbar() {
        toolbar.style.display = 'none';
        toolbarVisible = false;
    }

    function toggleToolbar(e) {
        if (isDrawing) return;
        e.preventDefault(); e.stopPropagation();
        if (toolbarVisible) hideToolbar();
        else showToolbarAt(e.clientX, e.clientY);
        return false;
    }

    // 点击空白关闭工具栏
    document.addEventListener('mousedown', (e) => {
        if (toolbarVisible && !e.target.closest('.hl-tb') && e.button === 0) hideToolbar();
    });

    // ========== 双击右键打开工具栏 ==========
    let lastRCtime = 0, rcCount = 0, rcResetTimer = null;

    // ========== 右键菜单智能拦截 ==========
    document.addEventListener('contextmenu', (e) => {
        const now = Date.now();

        // 1）如果正在画画或刚画完 → 屏蔽菜单
        if (isDrawing || hasDrawn || suppressNextContextMenu) {
            e.preventDefault();
            return false;
        }

        // 2）双击检测：400ms 内两次右键 → 打开/关闭工具栏
        if (now - lastRCtime < 400) {
            rcCount++;
            if (rcCount >= 1) {
                clearTimeout(rcResetTimer); rcCount = 0; lastRCtime = 0;
                toggleToolbar(e);
                return false;
            }
        } else { rcCount = 1; }
        lastRCtime = now;
        clearTimeout(rcResetTimer);
        rcResetTimer = setTimeout(() => { rcCount = 0; lastRCtime = 0; }, 450);

        // 3）普通单次右键 → 不阻止，让浏览器正常弹出右键菜单
    });

    // ========== 绘制事件绑定 ==========
    document.addEventListener('mousedown', startDraw, true);
    document.addEventListener('mousemove', draw, true);
    document.addEventListener('mouseup', endDraw, true);

    document.addEventListener('touchstart', (e) => { if (e.touches.length === 1) startDraw(e); }, { passive: false });
    document.addEventListener('touchmove', (e) => { if (isDrawing) { draw(e); e.preventDefault(); } }, { passive: false });
    document.addEventListener('touchend', endDraw);

    document.addEventListener('dragstart', (e) => { if (isDrawing || rightButtonDown) e.preventDefault(); }, true);

    // ========== 初始化提示 ==========
    const initMsg = '🖍️ 荧光笔Pro已就绪！按住右键拖动画线（不拖动=正常右键菜单）· 双击右键调面板';
    const tryShow = () => setTimeout(() => showToast(initMsg), 1000);
    if (document.readyState === 'complete' || document.readyState === 'interactive') tryShow();
    else window.addEventListener('load', tryShow);

})();
