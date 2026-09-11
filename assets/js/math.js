/* ==========================================================================
   无极博客 · 公式排版层（KaTeX 自托管，vendor/katex/）
   --------------------------------------------------------------------------
   约定：正文里的公式统一由 renderer 输出成
       <span class="math-tex math-inline|math-block" data-tex="...">原始源码</span>
   本模块负责把这些占位元素换成 KaTeX 排版结果。

   为什么不用 auto-render：
   1. auto-render 需要一个"单一根元素"，而正文是多个块级子节点；
   2. auto-render 会扫描全文的 $...$，容易误伤代码块/普通文本里的美元号。
   自己按 data-tex 渲染，作用域精确、结果确定。
   ========================================================================== */
(function (global) {
    'use strict';

    var REL_CSS = 'vendor/katex/katex.min.css';
    var REL_JS = 'vendor/katex/katex.min.js';

    var _loadPromise = null;
    var _katex = null;

    /**
     * 资源基路径。
     * 公开页面在站点根目录，直接相对引用即可；但本地管理系统放在 admin/ 子目录里，
     * 同一个 math.js 就要解析成 ../vendor/...。因此把前缀做成可配置：
     *   <script data-wj-asset-base="../" src="...">  或  window.WJ_ASSET_BASE = '../'
     * 没配置时按"页面在站点根目录"处理。
     */
    /** 从单个 script 标签解析资源前缀：显式属性优先，其次按自身 src 反推（与 store.js 一致） */
    function scriptBase(el) {
        if (!el || !el.getAttribute) return '';
        var attr = el.getAttribute('data-wj-asset-base');
        if (attr != null) return attr;
        var src = el.getAttribute('src') || '';
        var m = src && src.match(/^(.*?)assets\/js\/math\.js/);
        return m ? m[1] : '';
    }

    function assetBase() {
        if (typeof global.WJ_ASSET_BASE === 'string') return global.WJ_ASSET_BASE;
        var base = '';
        try {
            // 优先当前脚本；若 load() 由内联脚本触发，currentScript 不含 src 与前缀，则回退到文档中的脚本标签
            base = scriptBase(document.currentScript);
            if (!base) {
                var list = document.querySelectorAll('script[data-wj-asset-base],script[src*="assets/js/math.js"]');
                for (var i = list.length - 1; i >= 0; i--) {
                    base = scriptBase(list[i]);
                    if (base) break;
                }
            }
        } catch (e) { void e; }
        global.WJ_ASSET_BASE = base;
        return global.WJ_ASSET_BASE;
    }

    function cssHref() { return assetBase() + REL_CSS; }
    function jsSrc() { return assetBase() + REL_JS; }

    function injectCss() {
        if (document.querySelector('link[data-wj-katex]')) return;
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = cssHref();
        link.setAttribute('data-wj-katex', '');
        document.head.appendChild(link);
    }

    function injectJs() {
        return new Promise(function (resolve, reject) {
            if (global.katex) return resolve(global.katex);
            var src = jsSrc();
            var s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.setAttribute('data-wj-katex', '');
            s.onload = function () {
                if (global.katex) resolve(global.katex);
                else reject(new Error('katex.min.js 已加载但未暴露 window.katex'));
            };
            s.onerror = function () { reject(new Error('无法加载 ' + src)); };
            document.head.appendChild(s);
        });
    }

    /** 预加载 KaTeX（页面初始化时调用一次即可，非阻塞） */
    function load() {
        if (_loadPromise) return _loadPromise;
        injectCss();
        if (global.katex) { _katex = global.katex; _loadPromise = Promise.resolve(_katex); return _loadPromise; }
        _loadPromise = injectJs().then(function (k) { _katex = k; return k; });
        return _loadPromise;
    }

    /** 源文本规范化：JSON 里的 "\\" 会被解析成单个反斜杠，这里只做换行宏的兼容 */
    function normalizeTex(tex) {
        var s = String(tex == null ? '' : tex);
        s = s.replace(/\r\n?/g, '\n');
        // 用户写成 \\ 表示换行：KaTeX 里就是 \\，无需改；但把三个及以上反斜杠压成两个更安全
        s = s.replace(/\\\\{3,}/g, '\\\\');
        return s.trim();
    }

    var DEFAULTS = {
        throwOnError: false,
        strict: false,
        trust: false,
        output: 'html',
        macros: {
            '\\RR': '\\mathbb{R}',
            '\\NN': '\\mathbb{N}',
            '\\ZZ': '\\mathbb{Z}',
            '\\QQ': '\\mathbb{Q}',
            '\\CC': '\\mathbb{C}',
            '\\dd': '\\mathrm{d}',
            '\\ee': '\\mathrm{e}',
            '\\ii': '\\mathrm{i}',
            '\\abs': '\\left|#1\\right|',
            '\\norm': '\\left\\|#1\\right\\|'
        }
    };

    /** 单条公式 → HTML 字符串 */
    function texToHtml(tex, displayMode) {
        if (!_katex) return null;
        var src = normalizeTex(tex);
        if (!src) return '';
        try {
            return _katex.renderToString(src, Object.assign({}, DEFAULTS, { displayMode: !!displayMode }));
        } catch (e) {
            return null;
        }
    }

    /**
     * 把容器内所有 .math-tex 占位元素排版好。
     * 返回 Promise<{rendered:number, failed:number}>
     */
    function renderIn(container) {
        if (!container) return Promise.resolve({ rendered: 0, failed: 0 });
        var nodes = container.querySelectorAll('.math-tex:not([data-tex-done])');
        if (!nodes.length) return Promise.resolve({ rendered: 0, failed: 0 });
        return load().then(function () {
            var rendered = 0, failed = 0;
            // 重新查询：等待加载期间 DOM 可能已变化
            var list = container.querySelectorAll('.math-tex:not([data-tex-done])');
            Array.prototype.forEach.call(list, function (el) {
                var tex = el.getAttribute('data-tex') || el.textContent || '';
                var display = el.classList.contains('math-block');
                var html = texToHtml(tex, display);
                if (html == null) { failed++; return; }   // 保留原始源码，便于作者发现错误
                el.innerHTML = html;
                el.setAttribute('data-tex-done', '');
                el.classList.add('math-ready');
                rendered++;
            });
            return { rendered: rendered, failed: failed };
        }).catch(function (err) {
            // 卸载/离线时优雅降级：公式仍以等宽源码展示，页面其余部分正常
            if (global.console && console.warn) console.warn('[WJMath] KaTeX 不可用：', err.message);
            return { rendered: 0, failed: nodes.length, error: err.message };
        });
    }

    /** 同步渲染一小段公式字符串（编辑器实时预览用），未加载时返回 null */
    function renderString(tex, displayMode) { return texToHtml(tex, displayMode); }

    function isReady() { return !!_katex; }

    global.WJMath = {
        load: load,
        renderIn: renderIn,
        renderString: renderString,
        normalizeTex: normalizeTex,
        isReady: isReady,
        assetBase: assetBase,
        cssHref: cssHref,
        jsSrc: jsSrc,
        REL_CSS: REL_CSS,
        REL_JS: REL_JS
    };
})(window);
