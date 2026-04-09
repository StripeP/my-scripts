// ==UserScript==
// @name         选文字数统计
// @namespace    https://github.com/selection-word-count
// @version      2.1
// @description  拖动框选文字后右键，在页面右上角显示字数统计（字符数、汉字数、词数等），不受右键菜单遮挡，不受选区丢失影响
// @author       You
// @match        *://*/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // 缓存选中文本 —— 在 mousedown 时立即抓取，避免右键导致选区丢失
    let cachedText = '';
    // hideTooltip 的延迟定时器
    let hideTimer = null;

    // ========== 创建提示框（固定在页面右上角） ==========
    const tooltip = document.createElement('div');
    tooltip.id = 'swc-tooltip';
    Object.assign(tooltip.style, {
        position: 'fixed',
        top: '16px',
        right: '16px',
        zIndex: '2147483647',
        background: 'rgba(30, 30, 30, 0.96)',
        color: '#f0f0f0',
        padding: '12px 18px',
        borderRadius: '10px',
        fontSize: '13px',
        lineHeight: '1.7',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
        pointerEvents: 'auto',
        display: 'none',
        maxWidth: '300px',
        wordBreak: 'break-all',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.1)',
        transition: 'opacity 0.2s ease',
        opacity: '0',
        cursor: 'default',
    });

    // 内容容器
    const contentDiv = document.createElement('div');
    contentDiv.className = 'swc-content';
    contentDiv.style.marginRight = '12px';
    tooltip.appendChild(contentDiv);

    // 关闭按钮
    const closeBtn = document.createElement('span');
    closeBtn.innerHTML = '&times;';
    Object.assign(closeBtn.style, {
        position: 'absolute',
        top: '4px',
        right: '8px',
        fontSize: '16px',
        color: '#888',
        cursor: 'pointer',
        lineHeight: '1',
    });
    closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        hideTooltip();
    });
    tooltip.appendChild(closeBtn);

    document.documentElement.appendChild(tooltip);

    // ========== 统计文本信息 ==========
    function analyzeText(text) {
        if (!text || !text.trim()) return null;

        const trimmed = text.trim();

        const totalChars = text.length;
        const charsNoSpace = text.replace(/\s/g, '').length;
        const chineseChars = (trimmed.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
        const englishWords = (trimmed.match(/[a-zA-Z]+(?:['-][a-zA-Z]+)*/g) || []).length;
        const numbers = (trimmed.match(/\d+/g) || []).length;
        const punctuation = (trimmed.match(/[，。！？、；：""''（）【】《》…—·,.!?;:'"()\[\]{}<>/\\@#$%^&*+=|~`-]/g) || []).length;
        const lines = trimmed.split(/\n/).filter(l => l.trim()).length;

        return { totalChars, charsNoSpace, chineseChars, englishWords, numbers, punctuation, lines };
    }

    // ========== 格式化显示 ==========
    function formatResult(info) {
        const items = [];
        items.push(`<span style="color:#7ec8e3">总字符</span>  ${info.totalChars}<span style="color:#666;font-size:11px">（含空格）</span>`);
        items.push(`<span style="color:#7ec8e3">纯字符</span>  ${info.charsNoSpace}<span style="color:#666;font-size:11px">（不含空格）</span>`);
        if (info.chineseChars > 0) {
            items.push(`<span style="color:#e8b86d">汉字</span>  ${info.chineseChars}`);
        }
        if (info.englishWords > 0) {
            items.push(`<span style="color:#a8d8a8">英文词</span>  ${info.englishWords}`);
        }
        if (info.numbers > 0) {
            items.push(`<span style="color:#d8a8d8">数字串</span>  ${info.numbers}`);
        }
        if (info.punctuation > 0) {
            items.push(`<span style="color:#777">标点</span>  ${info.punctuation}`);
        }
        if (info.lines > 1) {
            items.push(`<span style="color:#777">行数</span>  ${info.lines}`);
        }
        return items.join('<br>');
    }

    // ========== 显示 / 隐藏 ==========
    function showTooltip(html) {
        // 取消待执行的隐藏定时器，防止竞态
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
        // 直接更新内容容器，不增删节点
        contentDiv.innerHTML = html;
        tooltip.style.display = 'block';
        requestAnimationFrame(() => {
            tooltip.style.opacity = '1';
        });
    }

    function hideTooltip() {
        tooltip.style.opacity = '0';
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            tooltip.style.display = 'none';
            hideTimer = null;
        }, 200);
    }

    // ========== 核心：mousedown 时缓存选区 ==========
    document.addEventListener('mousedown', function (e) {
        if (e.button === 2) {
            // 右键按下时立即缓存当前选区文字
            const sel = window.getSelection();
            const text = sel ? sel.toString() : '';
            if (text && text.trim()) {
                cachedText = text;
            }
        } else {
            // 左键点击时关闭提示框
            hideTooltip();
            cachedText = '';
        }
    }, true); // 捕获阶段，确保最早拿到

    // ========== 右键菜单事件：显示统计 ==========
    document.addEventListener('contextmenu', function (e) {
        // 优先用缓存（防止选区已丢失），其次实时取
        let text = cachedText;
        if (!text || !text.trim()) {
            const sel = window.getSelection();
            text = sel ? sel.toString() : '';
        }

        if (!text || !text.trim()) {
            cachedText = '';
            return;
        }

        const info = analyzeText(text);
        if (!info) {
            cachedText = '';
            return;
        }

        showTooltip(formatResult(info));
        cachedText = '';
    }, true);

    // ========== 其他隐藏触发 ==========
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            hideTooltip();
        }
    });
})();
