/* ==========================================================================
   无极博客 · 轻量 UI 辅助（提示条 / 确认框 / 弹窗表单 / 剪贴板 / 下载）
   ========================================================================== */
(function (global) {
    'use strict';

    var host = null;

    function ensureHost() {
        if (!host) {
            host = document.createElement('div');
            host.className = 'toast-host';
            host.setAttribute('role', 'status');
            host.setAttribute('aria-live', 'polite');
            document.body.appendChild(host);
        }
        return host;
    }

    /** 底部提示条。kind: 'ok' | 'err' | '' */
    function toast(msg, kind, ms) {
        var h = ensureHost();
        var el = document.createElement('div');
        el.className = 'toast' + (kind ? ' ' + kind : '');
        el.textContent = msg;
        h.appendChild(el);
        setTimeout(function () {
            // 入场动画（toastIn）结束后必须显式关掉：带 fill 的 CSS 动画
            // 优先级高于内联样式，不关掉的话 opacity/transform 根本改不动，
            // 淡出会直接变成"瞬间消失"。交给 .out 的过渡来做离场。
            el.style.animation = 'none';
            el.classList.add('out');
            setTimeout(function () { el.remove(); }, 300);
        }, ms || 2200);
        return el;
    }

    /**
     * 通用弹窗。options: { title, body(HTMLElement|string), actions:[{label,value,primary,danger}], width }
     * 返回 Promise<value|false>
     */
    function dialog(options) {
        options = options || {};
        return new Promise(function (resolve) {
            var overlay = document.createElement('div');
            overlay.className = 'wj-modal-overlay';

            var modal = document.createElement('div');
            modal.className = 'wj-modal';
            if (options.width) modal.style.maxWidth = options.width;
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');

            var head = document.createElement('div');
            head.className = 'wj-modal-head';
            var h = document.createElement('h3');
            h.textContent = options.title || '';
            var x = document.createElement('button');
            x.type = 'button';
            x.className = 'wj-modal-x';
            x.setAttribute('aria-label', '关闭');
            x.textContent = '✕';
            head.appendChild(h);
            head.appendChild(x);

            var body = document.createElement('div');
            body.className = 'wj-modal-body';
            if (typeof options.body === 'string') body.innerHTML = options.body;
            else if (options.body) body.appendChild(options.body);

            var foot = document.createElement('div');
            foot.className = 'wj-modal-foot';

            function close(val) {
                document.removeEventListener('keydown', onKey);
                overlay.classList.remove('open');
                // 等待时长要覆盖遮罩淡出（180ms）与弹窗位移缩放（280ms）中较长的那个，
                // 否则离场动画播到一半元素就被摘掉了，看起来像被"掐断"
                setTimeout(function () { overlay.remove(); }, 300);
                resolve(val);
            }

            (options.actions || [{ label: '关闭', value: false }]).forEach(function (a) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'btn btn-sm ' + (a.primary ? 'btn-primary' : (a.danger ? 'btn-danger' : 'btn-ghost'));
                b.textContent = a.label;
                b.addEventListener('click', function () {
                    if (a.onClick) { if (a.onClick(body, close) === false) return; }
                    close(a.value === undefined ? a.label : a.value);
                });
                foot.appendChild(b);
            });

            function onKey(e) {
                if (e.key === 'Escape') close(false);
                if (e.key !== 'Enter') return;
                // 单行输入框里回车即确认；多行（textarea）保留换行语义，需 Ctrl/Cmd+Enter
                var single = e.target && e.target.tagName === 'INPUT' && !e.isComposing;
                if (!single && !e.metaKey && !e.ctrlKey) return;
                var primary = foot.querySelector('.btn-primary');
                if (primary) { e.preventDefault(); primary.click(); }
            }

            x.addEventListener('click', function () { close(false); });
            overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(false); });
            document.addEventListener('keydown', onKey);

            modal.appendChild(head);
            modal.appendChild(body);
            modal.appendChild(foot);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            requestAnimationFrame(function () { overlay.classList.add('open'); });
            var focusable = body.querySelector('input,textarea,select,button');
            if (focusable) setTimeout(function () { focusable.focus(); }, 60);
        });
    }

    /** 确认框 → Promise<boolean> */
    function confirmBox(title, message, confirmLabel) {
        var p = document.createElement('p');
        p.className = 'wj-modal-text';
        p.textContent = message;
        return dialog({
            title: title,
            body: p,
            actions: [
                { label: '取消', value: false },
                { label: confirmLabel || '确定', value: true, primary: true }
            ]
        }).then(function (v) { return v === true; });
    }

    /** 复制到剪贴板（带降级） */
    function copy(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).then(function () { return true; })
                .catch(function () { return fallbackCopy(text); });
        }
        return Promise.resolve(fallbackCopy(text));
    }

    function fallbackCopy(text) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            var ok = document.execCommand('copy');
            ta.remove();
            return ok;
        } catch (e) { return false; }
    }

    /** 体积人类可读 */
    function fmtBytes(n) {
        if (!n) return '0 B';
        var u = ['B', 'KB', 'MB', 'GB'], i = 0;
        while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
        return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + ' ' + u[i];
    }

    /** 输入框弹窗 → Promise<string|false> */
    function prompt(title, label, value, placeholder, multiline) {
        var wrap = document.createElement('div');
        wrap.className = 'field';
        var lab = document.createElement('label');
        lab.textContent = label || '';
        var input = multiline ? document.createElement('textarea') : document.createElement('input');
        input.className = multiline ? 'textarea' : 'input';
        if (multiline) input.rows = 5;
        input.value = value || '';
        if (placeholder) input.placeholder = placeholder;
        wrap.appendChild(lab);
        wrap.appendChild(input);
        return dialog({
            title: title,
            body: wrap,
            width: '560px',
            actions: [
                { label: '取消', value: false },
                { label: '确定', primary: true, onClick: function () { return true; } }
            ]
        }).then(function (v) { return v === false ? false : input.value; });
    }

    global.WJUI = {
        toast: toast,
        dialog: dialog,
        confirm: confirmBox,
        prompt: prompt,
        copy: copy,
        fmtBytes: fmtBytes
    };
})(window);
