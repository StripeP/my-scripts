// ==UserScript==
// @name         🖍️ 荧光笔 Pro
// @namespace    http://tampermonkey.net/
// @version      2.5
// @description  按住右键画荧光笔，发光渐变样式，智能右键检测，配置自动保存，深度修复断画/右键弹出
// @author       StripeP
// @match        *://*/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ========== 配置持久化 ==========
    const STORAGE_KEY = 'hl_pro_cfg_v23';

    const DEFAULT_CONFIG = {
        colors: [
            '#FF3B30', '#FF9500', '#FFCC00', '#34C759',
            '#00C7BE', '#007AFF', '#AF52DE', '#FF2D55',
        ],
        defaultColorIndex: 2,
        width: 10,
        minWidth: 3,
        maxWidth: 80,
        opacity: 0.70,
        fadeEnabled: true,
        fadeDelay: 3000,
        fadeDuration: 1200,
        style: 'glow',
        glowSize: 2.0,
    };

    // 安全读取配置
    var _saved = null;
    try { _saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch(e) {}
    if (!_saved || typeof _saved !== 'object') _saved = {};
    var CONFIG = Object.assign({}, DEFAULT_CONFIG, _saved);

    // 安全保存配置（防抖 + beforeunload 双保险）
    var _saveTimer = null;
    function saveConfig() {
        clearTimeout(_saveTimer);
        _saveTimer = setTimeout(function() {
            try {
                var pick = {
                    width: CONFIG.width,
                    opacity: CONFIG.opacity,
                    fadeEnabled: CONFIG.fadeEnabled,
                    fadeDelay: CONFIG.fadeDelay,
                    style: CONFIG.style,
                    defaultColorIndex: _colorIdx,
                    customColor: getColor()
                };
                if (_saved && _saved.colors) pick.colors = _saved.colors;
                localStorage.setItem(STORAGE_KEY, JSON.stringify(pick));
            } catch(e) {}
        }, 100);
    }

    // 刷新前立即保存
    window.addEventListener('beforeunload', function() {
        try {
            var pick = {
                width: CONFIG.width,
                opacity: CONFIG.opacity,
                fadeEnabled: CONFIG.fadeEnabled,
                fadeDelay: CONFIG.fadeDelay,
                style: CONFIG.style,
                defaultColorIndex: _colorIdx,
                customColor: getColor()
            };
            if (_saved && _saved.colors) pick.colors = _saved.colors;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(pick));
        } catch(e) {}
    });

    // 样式定义
    var STYLES = {
        solid: {
            name: '实心', desc: '纯色填充',
            makeGradient(color, op) { return 'radial-gradient(circle, '+h2r(color,op)+' 0%, '+h2r(color,op)+' 100%)'; },
            boxShadow: null
        },
        glow: {
            name: '发光', desc: '白芯 + 色光晕',
            makeGradient(color, op) { return 'radial-gradient(circle, rgba(255,255,255,'+(op*0.95)+') 0%, '+h2r(color,op*0.6)+' 35%, '+h2r(color,op*0.25)+' 65%, transparent 100%)'; },
            boxShadow: (c,o,s) => '0 0 '+Math.round(s*0.8)+'px '+h2r(c,o*0.5)+', 0 0 '+Math.round(s*1.5)+'px '+h2r(c,o*0.25)
        },
        neon: {
            name: '霓虹', desc: '强色芯 + 外发光',
            makeGradient(color, op) { return 'radial-gradient(circle, '+h2r('#ffffff',op*0.9)+' 0%, '+h2r(color,op*0.8)+' 20%, '+h2r(color,op*0.35)+' 50%, transparent 85%)'; },
            boxShadow: (c,o,s) => '0 0 '+Math.round(s*0.5)+'px '+c+', 0 0 '+Math.round(s*1.2)+'px '+h2r(c,o*0.6)+', 0 0 '+Math.round(s*2.2)+'px '+h2r(c,o*0.3)
        },
        marker: {
            name: '马克笔', desc: '半透明水彩感',
            makeGradient(color, op) { return 'radial-gradient(circle, '+h2r(color,op*0.55)+' 0%, '+h2r(color,op*0.35)+' 40%, '+h2r(color,op*0.12)+' 75%, transparent 100%)'; },
            boxShadow: null
        }
    };

    // 颜色索引
    var _colorIdx = (_saved.defaultColorIndex != null && _saved.defaultColorIndex >= 0 && _saved.defaultColorIndex < CONFIG.colors.length)
        ? _saved.defaultColorIndex : CONFIG.defaultColorIndex;

    // 自定义颜色恢复
    if (_saved.customColor && typeof _saved.customColor === 'string' && CONFIG.colors.indexOf(_saved.customColor) === -1) {
        CONFIG.colors.push(_saved.customColor);
        _colorIdx = CONFIG.colors.length - 1;
    }
    // 如果保存了额外的 colors 数组也恢复
    if (_saved.colors && Array.isArray(_saved.colors)) {
        for (var ci = 0; ci < _saved.colors.length; ci++) {
            if (CONFIG.colors.indexOf(_saved.colors[ci]) === -1) {
                CONFIG.colors.push(_saved.colors[ci]);
            }
        }
    }

    // 工具函数：hex → rgba
    function h2r(hex, a) {
        if (!hex || hex.charAt(0) !== '#') return 'rgba(255,255,200,'+a+')';
        var r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        if (isNaN(r)||isNaN(g)||isNaN(b)) return 'rgba(255,255,200,'+a+')';
        return 'rgba('+r+','+g+','+b+','+a+')';
    }

    function rgbToHex(rgb) {
        if (!rgb || rgb.charAt(0) === '#') return rgb || '#000000';
        var m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return rgb;
        return '#' + [m[1],m[2],m[3]].map(function(x){return ('0'+parseInt(x).toString(16)).slice(-2)}).join('');
    }

    function getColor() {
        return (CONFIG.colors[_colorIdx]) || CONFIG.colors[CONFIG.defaultColorIndex] || '#FFCC00';
    }

    // 状态变量
    var isDrawing = false, lastX = null, lastY = null;
    var strokeElements = [], currentStroke = [], allStrokes = [];
    var rightDownPos = null, rightButtonDown = false, hasDrawn = false;
    var DRAW_THRESHOLD = 5;
    var suppressNextContextMenu = false;

    // ========== 注入 CSS ==========
    var cssText = '.hl-container{position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;overflow:hidden}'
        + '.hl-dot{position:absolute;border-radius:50%;pointer-events:none;transform:translate(-50%,-50%);transition:opacity '+CONFIG.fadeDuration+'ms ease-out;will-change:opacity,transform}'
        + '.hl-dot.fading{opacity:0!important}'
        + '.hl-tb{position:fixed;z-index:2147483647;display:none;flex-direction:column;gap:4px;padding:8px 10px;background:rgba(22,22,28,.94);border:1px solid rgba(255,255,255,.08);border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.55);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);animation:hlTbIn .18s cubic-bezier(.16,1,.3,1);min-width:200px}'
        + '@keyframes hlTbIn{from{opacity:0;transform:scale(.88) translateY(-6px)}to{opacity:1;transform:scale(1) translateY(0)}}'
        + '.hl-tb-row{display:flex;gap:5px;align-items:center;flex-wrap:nowrap}'
        + '.hl-tb-section-label{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.8px;padding:1px 0 2px;margin-top:2px}'
        + '.hl-c-btn{width:22px;height:22px;border-radius:50%;border:2px solid transparent;cursor:pointer;transition:all .15s ease;flex-shrink:0;position:relative}.hl-c-btn:hover{transform:scale(1.22)}.hl-c-btn.active{border-color:#fff;transform:scale(1.15);box-shadow:0 0 8px rgba(255,255,255,.35)}'
        + '.hl-c-custom{width:22px;height:22px;border-radius:50%;border:2px dashed rgba(255,255,255,.3);cursor:pointer;background:conic-gradient(from 0deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00);flex-shrink:0;overflow:hidden;-webkit-appearance:none;appearance:none;padding:0}.hl-c-custom::-webkit-color-swatch-wrapper{padding:0}.hl-c-custom::-webkit-color-swatch{border:none;border-radius:50%}.hl-c-custom:hover{transform:scale(1.22)}'
        + '.hl-sep{height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.1),transparent);margin:4px 0}'
        + '.hl-slider-wrap{display:flex;align-items:center;gap:8px;flex:1}'
        + '.hl-lbl{font-size:11px;color:#aaa;min-width:42px;white-space:nowrap;flex-shrink:0}'
        + '.hl-val{font-size:10px;color:#888;min-width:32px;text-align:right;font-variant-numeric:tabular-nums}'
        + 'input[type=range].hl-range{flex:1;height:4px;appearance:none;background:rgba(255,255,255,.1);border-radius:2px;outline:none;min-width:60px}'
        + 'input[type=range].hl-range::-webkit-slider-thumb{appearance:none;width:14px;height:14px;border-radius:50%;background:#fff;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.35);transition:transform .1s}input[type=range].hl-range::-webkit-slider-thumb:hover{transform:scale(1.2)}'
        + '.hl-sw-wrap{display:flex;align-items:center;justify-content:space-between;gap:8px}'
        + '.hl-sw{position:relative;width:36px;height:19px;appearance:none;background:rgba(255,255,255,.12);border-radius:10px;cursor:pointer;transition:background .2s;flex-shrink:0}.hl-sw:checked{background:#34C759}.hl-sw::before{content:"";position:absolute;top:2px;left:2px;width:15px;height:15px;background:#fff;border-radius:50%;transition:left .2s ease;box-shadow:0 1px 3px rgba(0,0,0,.2)}.hl-sw:checked::before{left:19px}'
        + '.hl-sty-btn{font-size:10px;padding:3px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.06);color:#aaa;cursor:pointer;white-space:nowrap;transition:all .15s;font-family:inherit}.hl-sty-btn:hover{background:rgba(255,255,255,.12);color:#ddd}.hl-sty-btn.active{background:rgba(52,199,89,.2);border-color:rgba(52,199,89,.5);color:#34C759}'
        + '.hl-act-btn{font-size:11px;color:#ccc;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:5px 12px;cursor:pointer;transition:all .15s;font-family:inherit;flex:1}.hl-act-btn:hover{background:rgba(255,255,255,.14);color:#fff}';
    
    if (typeof GM_addStyle === 'function') GM_addStyle(cssText);
    else { var s = document.createElement('style'); s.textContent = cssText; (document.head||document.documentElement).appendChild(s); }

    // ========== 容器 ==========
    var container = document.querySelector('.hl-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'hl-container';
        document.documentElement.appendChild(container);
    }

    // ========== 工具栏 ==========
    var toolbar = document.getElementById('hl-toolbar');
    if (!toolbar) toolbar = buildToolbar();
    if (!toolbar.parentNode) document.documentElement.appendChild(toolbar);

    function buildToolbar() {
        var tb = document.createElement('div');
        tb.className = 'hl-tb'; tb.id = 'hl-toolbar';

        // --- 颜色 ---
        var sl = document.createElement('div');
        sl.className = 'hl-tb-section-label'; sl.textContent = '颜色'; tb.appendChild(sl);

        var rc = document.createElement('div'); rc.className = 'hl-tb-row';
        var dc = CONFIG.colors.slice(0, 8);
        for (var i = 0; i < dc.length; i++) {
            (function(idx, col){
                var btn = document.createElement('button');
                btn.className = 'hl-c-btn' + (idx === _colorIdx ? ' active' : '');
                btn.style.backgroundColor = col; btn.title = col;
                btn.addEventListener('click', function(){ selectColor(idx); });
                rc.appendChild(btn);
            })(CONFIG.colors.indexOf(dc[i]), dc[i]);
        }
        var cpk = document.createElement('input');
        cpk.type = 'color'; cpk.className = 'hl-c-custom';
        cpk.value = getColor(); cpk.title = '自定义颜色';
        cpk.addEventListener('input', function(e){ pickCustomColor(e.target.value); });
        rc.appendChild(cpk); tb.appendChild(rc);
        
        sep(tb);

        // --- 样式 ---
        var ssl = document.createElement('div');
        ssl.className = 'hl-tb-section-label'; ssl.textContent = '样式'; tb.appendChild(ssl);
        var sr = document.createElement('div'); sr.className = 'hl-tb-row';
        var skArr = Object.keys(STYLES);
        for (var si = 0; si < skArr.length; si++) {
            (function(key){
                var st = STYLES[key];
                var btn = document.createElement('button');
                btn.className = 'hl-sty-btn' + (key === CONFIG.style ? ' active' : '');
                btn.textContent = st.name; btn.title = st.desc;
                btn.dataset.sk = key;
                btn.addEventListener('click', function(){ setStyle(key); });
                sr.appendChild(btn);
            })(skArr[si]);
        }
        tb.appendChild(sr); sep(tb);

        // --- 粗细 ---
        sliderRow(tb, '粗细', String(CONFIG.minWidth), String(CONFIG.maxWidth), String(CONFIG.width), '1', 'px', function(v){ CONFIG.width = v; });
        // --- 透明度 ---
        sliderRow(tb, '透明度', '5', '100', String(Math.round(CONFIG.opacity * 100)), '1', '%', function(v){ CONFIG.opacity = v / 100; });
        // --- 消散时间 ---
        sliderRow(tb, '消散时间', '500', '8000', String(CONFIG.fadeDelay), '250', '', function(v){ CONFIG.fadeDelay = v; }, function(v){ return (v/1000).toFixed(1)+'s'; });

        sep(tb);

        // --- 自动消散开关 ---
        var swR = document.createElement('div'); swR.className = 'hl-sw-wrap';
        var swL = document.createElement('span'); swL.className = 'hl-lbl'; swL.textContent = '自动消散';
        var swE = document.createElement('input'); swE.type = 'checkbox'; swE.className = 'hl-sw';
        swE.checked = CONFIG.fadeEnabled;
        swE.addEventListener('change', function(){ CONFIG.fadeEnabled = swE.checked; saveConfig(); });
        swR.appendChild(swL); swR.appendChild(swE); tb.appendChild(swR);

        sep(tb);

        // --- 清除按钮 ---
        var ar = document.createElement('div'); ar.className = 'hl-tb-row';
        var clBtn = document.createElement('button');
        clBtn.className = 'hl-act-btn'; clBtn.textContent = '🗑 清除全部';
        clBtn.addEventListener('click', clearAll);
        ar.appendChild(clBtn); tb.appendChild(ar);

        return tb;
    }

    function sep(tb) {
        var d = document.createElement('div'); d.className = 'hl-sep'; tb.appendChild(d);
    }

    function sliderRow(tb, label, minV, maxV, val, step, unit, onChange, fmt) {
        var row = document.createElement('div'); row.className = 'hl-tb-row';
        var lbl = document.createElement('span'); lbl.className = 'hl-lbl'; lbl.textContent = label;
        var wrap = document.createElement('div'); wrap.className = 'hl-slider-wrap';
        var slider = document.createElement('input'); slider.type = 'range'; slider.className = 'hl-range';
        slider.min = minV; slider.max = maxV; slider.value = val; slider.step = step;
        var valEl = document.createElement('span'); valEl.className = 'hl-val';
        var displayVal = fmt ? fmt(parseInt(val)) : val + unit;
        valEl.textContent = displayVal;
        slider.addEventListener('input', function(){
            var v = parseInt(slider.value);
            onChange(v);
            valEl.textContent = fmt ? fmt(v) : v + unit;
            saveConfig();
        });
        wrap.appendChild(slider); wrap.appendChild(valEl);
        row.appendChild(lbl); row.appendChild(wrap);
        tb.appendChild(row);
    }

    // ========== 选择逻辑 ==========
    function selectColor(index) {
        if (index < 0 || index >= CONFIG.colors.length) index = 0;
        _colorIdx = index;
        var c = CONFIG.colors[index];
        var btns = toolbar.querySelectorAll('.hl-c-btn');
        for (var b = 0; b < btns.length; b++) {
            var ri = CONFIG.colors.indexOf(btns[b].style.backgroundColor ? rgbToHex(btns[b].style.backgroundColor) : btns[b].title);
            btns[b].classList.toggle('active', ri === index);
        }
        var pk = toolbar.querySelector('.hl-c-custom');
        if (pk) pk.value = c;
        saveConfig();
    }

    function pickCustomColor(hex) {
        var idx = CONFIG.colors.indexOf(hex);
        if (idx === -1) { CONFIG.colors.push(hex); idx = CONFIG.colors.length - 1; }
        _colorIdx = idx;
        selectColor(idx);
    }

    function setStyle(key) {
        CONFIG.style = key;
        var btns = toolbar.querySelectorAll('.hl-sty-btn');
        for (var b = 0; b < btns.length; b++) {
            btns[b].classList.toggle('active', btns[b].dataset.sk === key);
        }
        saveConfig();
    }

    // ========== 绘制核心 ==========
    function pos(e) {
        if (e.touches && e.touches[0]) return {x:e.touches[0].clientX, y:e.touches[0].clientY};
        return {x:e.clientX, y:e.clientY};
    }

    function dot(x, y) {
        var d = document.createElement('div');
        d.className = 'hl-dot';
        var sz = CONFIG.width, c = getColor(), op = CONFIG.opacity, sty = STYLES[CONFIG.style] || STYLES.glow;
        d.style.left = x+'px'; d.style.top = y+'px';
        d.style.width = sz+'px'; d.style.height = sz+'px';
        d.style.background = sty.makeGradient(c, op);
        if (sty.boxShadow) d.style.boxShadow = sty.boxShadow(c, op, sz);
        return d;
    }

    function interp(x0,y0,x1,y1) {
        var dist = Math.sqrt((x1-x0)*(x1-x0)+(y1-y0)*(y1-y0));
        var step = Math.max(CONFIG.width * 0.2, 1.5);
        var n = Math.max(Math.floor(dist / step), 1);
        var pts = [];
        for (var i = 0; i <= n; i++) {
            var t = i/n;
            pts.push({x:x0+(x1-x0)*t, y:y0+(y1-y0)*t});
        }
        return pts;
    }

    // ---------- 绘制事件 ----------
    function startDraw(e) {
        if (e.button !== 2 && e.type !== 'touchstart') return;
        if (e.target.closest && e.target.closest('.hl-tb')) return;
        // 右键按下时立即阻止默认行为
        e.preventDefault();
        var p = pos(e);
        rightDownPos = p; rightButtonDown = true; hasDrawn = false;
        _paintingActive = true; // ★ 标记绘画模式开启
        _lastRightDownTime = Date.now(); // ★ 记录按下时间
        lastX = p.x; lastY = p.y;
    }

    function draw(e) {
        if (!rightButtonDown) return;
        // 只要右键按住移动，一律阻止默认行为
        e.preventDefault();
        e.stopImmediatePropagation(); // ★ 更强的阻止：防止同一阶段其他监听器收到事件
        var p = pos(e);
        var dx = p.x - rightDownPos.x, dy = p.y - rightDownPos.y;
        var dist = Math.sqrt(dx*dx + dy*dy);

        if (!isDrawing && dist > DRAW_THRESHOLD) {
            isDrawing = true; hasDrawn = true; currentStroke = [];
            var first = dot(rightDownPos.x, rightDownPos.y);
            container.appendChild(first);
            currentStroke.push(first); strokeElements.push(first);
            allStrokes.push(currentStroke);
            if (CONFIG.fadeEnabled) schedFade(currentStroke);
        }
        if (isDrawing) {
            if (lastX != null && lastY != null) {
                var pts = interp(lastX, lastY, p.x, p.y);
                for (var pi = 0; pi < pts.length; pi++) {
                    var d = dot(pts[pi].x, pts[pi].y);
                    container.appendChild(d);
                    currentStroke.push(d); strokeElements.push(d);
                }
            }
            lastX = p.x; lastY = p.y;
        }
    }

    function endDraw(e) {
        // ★ 放宽检测条件：只要右键相关或正处于绘画状态都处理
        if (e.button === 2 || e.type === 'touchend' || e.type === 'mouseleave' || e.type === 'pointerup' || rightButtonDown || isDrawing) {
            if (isDrawing || hasDrawn) {
                isDrawing = false; rightButtonDown = false; rightDownPos = null;
                lastX = null; lastY = null; currentStroke = [];
                _paintingActive = false; // ★ 标记绘画模式关闭
                _lastRightDownTime = 0;
                suppressNextContextMenu = true;
                // ★ 延长拦截窗口到300ms，确保contextmenu事件被完全吞掉
                setTimeout(function(){ 
                    suppressNextContextMenu = false; 
                    hasDrawn = false; // 延迟重置hasDrawn，确保contextmenu拦截窗口内hasDrawn仍为true
                }, 300);
            } else {
                rightButtonDown = false; rightDownPos = null; hasDrawn = false;
                _paintingActive = false;
                _lastRightDownTime = 0;
            }
        }
    }

    function forceEnd() {
        if (rightButtonDown || isDrawing) {
            isDrawing = false; rightButtonDown = false;
            rightDownPos = null; hasDrawn = true; // ★ 设为true而非false，确保后续contextmenu被拦截
            lastX = null; lastY = null; currentStroke = [];
            _paintingActive = false;
            _lastRightDownTime = 0;
            suppressNextContextMenu = true;
            setTimeout(function(){ suppressNextContextMenu = false; hasDrawn = false; }, 300);
        }
    }

    // ========== 消散 & 清除 ==========
    var fTimers = new Map();

    function schedFade(stroke) {
        if (fTimers.has(stroke)) clearTimeout(fTimers.get(stroke));
        var t = setTimeout(function(){
            if (!stroke || !stroke.length) return;
            stroke.forEach(function(d){ try{d.classList.add('fading');}catch(ex){} });
            setTimeout(function(){
                stroke.forEach(function(d){ try{if(d&&d.parentNode)d.remove();}catch(ex){} });
                var ix = allStrokes.indexOf(stroke);
                if (ix > -1) allStrokes.splice(ix, 1);
                strokeElements = strokeElements.filter(function(el){ return el&&el.parentNode; });
            }, CONFIG.fadeDuration + 60);
        }, CONFIG.fadeDelay);
        fTimers.set(stroke, t);
    }

    function clearAll() {
        fTimers.forEach(function(t){ clearTimeout(t); }); fTimers.clear();
        if (container) { while(container.firstChild) container.removeChild(container.firstChild); }
        try { document.querySelectorAll('.hl-dot').forEach(function(el){ el.remove(); }); } catch(ex){}
        allStrokes = []; strokeElements = []; currentStroke = [];
    }

    // ========== 工具栏显示/隐藏 ==========
    var toolbarVisible = false;

    function showTB(x, y) {
        var tw=220, th=420;
        var tx=x+14, ty=y-10;
        if (tx+tw > window.innerWidth-10) tx=x-tw-14;
        if (ty+th > window.innerHeight-10) ty=window.innerHeight-th-10;
        if (ty<10) ty=10;
        toolbar.style.left = tx+'px'; toolbar.style.top = ty+'px';
        toolbar.style.display='flex'; toolbarVisible=true;
    }
    function hideTB() { toolbar.style.display='none'; toolbarVisible=false; }

    function toggleTB(e) {
        if (isDrawing) return;
        e.preventDefault(); e.stopPropagation();
        toolbarVisible ? hideTB() : showTB(e.clientX, e.clientY);
        return false;
    }

    document.addEventListener('mousedown', function(e){
        if (toolbarVisible && !e.target.closest('.hl-tb') && e.button===0) hideTB();
    });

    // ========== 右键菜单 & 双击工具栏 ==========
    var lRC=0, rCnt=0, rRT=null;
    var _paintingActive = false; // 绘画总开关：右键按下到松开的整段时间内为true

    // ★★★ 核心拦截：在捕获阶段最早期拦截所有contextmenu ★★★
    // 只要 _paintingActive 为true（右键按下期间）或画过笔迹，一律吞掉右键菜单
    document.addEventListener('contextmenu', function(e){
        if (_paintingActive || isDrawing || rightButtonDown || hasDrawn || suppressNextContextMenu) {
            e.preventDefault();
            e.stopImmediatePropagation(); // ★ 比stopPropagation更强，阻止同一阶段的其他监听器
            return false;
        }
    }, true); // 捕获阶段，最高优先级

    // 冒泡阶段：仅在非绘画状态下处理双击右键调出工具栏
    document.addEventListener('contextmenu', function(e){
        if (_paintingActive || isDrawing || hasDrawn || suppressNextContextMenu) {
            e.preventDefault();
            e.stopImmediatePropagation();
            return false;
        }
        var now = Date.now();
        if (now - lRC < 400) {
            rCnt++;
            if (rCnt >= 1) { clearTimeout(rRT); rCnt=0; lRC=0; toggleTB(e); return false; }
        } else { rCnt=1; }
        lRC=now; clearTimeout(rRT);
        rRT=setTimeout(function(){ rCnt=0; lRC=0; }, 450);
    });

    // ========== 事件绑定 ==========
    // ★ 所有关键事件都在捕获阶段绑定，且使用最高优先级
    document.addEventListener('mousedown', startDraw, true);
    document.addEventListener('mousemove', draw, true);
    
    // ★ mouseup 同时绑定 document 和 window，防止事件被页面元素吞掉
    document.addEventListener('mouseup', endDraw, true);
    window.addEventListener('mouseup', function(e) {
        // 兜底：如果document的mouseup没触发（被吞了），window级别再收一次
        if (rightButtonDown || isDrawing) {
            endDraw(e);
        }
    }, true);
    
    document.addEventListener('mouseleave', forceEnd, true);
    document.documentElement.addEventListener('mouseleave', function(e){
        if (e.target === document.documentElement) forceEnd();
    }, true);
    
    // ★ 指针事件兼容：某些页面只用pointer事件不用mouse事件
    document.addEventListener('pointerup', function(e) {
        if (e.button === 2 && (rightButtonDown || isDrawing)) {
            endDraw(e);
        }
    }, true);
    
    // ★ 定时器轮询检测：如果右键状态异常持续超过2秒，自动重置
    // 防止任何边缘情况导致状态卡死
    var _lastRightDownTime = 0;
    var _watchdogTimer = setInterval(function() {
        if (rightButtonDown && _lastRightDownTime > 0) {
            var elapsed = Date.now() - _lastRightDownTime;
            // 右键按住超过10秒还没松开，肯定是状态卡死了
            if (elapsed > 10000) {
                forceEnd();
            }
        }
    }, 1000);
    
    document.addEventListener('touchstart', function(e){ if(e.touches.length===1)startDraw(e); }, {passive:false});
    document.addEventListener('touchmove', function(e){ if(isDrawing){draw(e);e.preventDefault();}}, {passive:false});
    document.addEventListener('touchend', endDraw);
    document.addEventListener('touchcancel', forceEnd, {passive:false});
    document.addEventListener('dragstart', function(e){ if(isDrawing||rightButtonDown)e.preventDefault(); }, true);
    window.addEventListener('blur', forceEnd, true);
    
    // ★ 全局按键监听：Escape键强制结束绘画
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && (isDrawing || rightButtonDown)) {
            forceEnd();
        }
    }, true);

})();
