/* ==========================================================================
   无极博客 · 站点公共脚本
   主题切换 / 移动端菜单 / 导航高亮 / 滚动揭示 / 回到顶部 / 进度条 /
   正文增强（图片解析、代码复制、目录高亮）
   --------------------------------------------------------------------------
   所有页面共用；页面专属逻辑写在各自的内联脚本里。
   ========================================================================== */
(function (global) {
    'use strict';

    var doc = document;
    var root = doc.documentElement;

    /* ------------------------------------------------------- 滚动帧调度
       页面上所有"随滚动更新"的逻辑（导航高亮、进度条、目录高亮）都挂到同一个
       scroll/resize 监听与同一个 rAF 上：只有一个滚动回调、每帧统一对齐一次，
       避免多个监听各自排队，重复触发布局读取。 */
    var _watchers = [];
    var _watchQueued = false;

    function scheduleFrame() {
        if (_watchQueued) return;
        _watchQueued = true;
        requestAnimationFrame(function () {
            _watchQueued = false;
            for (var i = 0; i < _watchers.length; i++) _watchers[i]();
        });
    }

    /** 注册一个"滚动/尺寸变化时重算"的回调，并立即执行一次以初始化 */
    function watchOnFrame(fn) {
        _watchers.push(fn);
        if (_watchers.length === 1) {
            global.addEventListener('scroll', scheduleFrame, { passive: true });
            global.addEventListener('resize', scheduleFrame);
        }
        fn();
    }

    /* ------------------------------------------------------------ 主题 */

    function initTheme() {
        var btn = doc.getElementById('themeToggle');
        var mql = global.matchMedia('(prefers-color-scheme: dark)');
        function apply(t) {
            root.setAttribute('data-theme', t);
            if (btn) btn.textContent = t === 'dark' ? '\u263E' : '\u2600\uFE0E';
        }
        apply(root.getAttribute('data-theme') || 'dark');
        if (btn) {
            btn.addEventListener('click', function () {
                var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
                apply(next);
                try { localStorage.setItem('wj-theme', next); } catch (e) { void e; }
            });
        }
        var onSchemeChange = function (e) {
            var saved = null;
            try { saved = localStorage.getItem('wj-theme'); } catch (err) { void err; }
            if (!saved) apply(e.matches ? 'dark' : 'light');
        };
        if (mql.addEventListener) mql.addEventListener('change', onSchemeChange);
        else if (mql.addListener) mql.addListener(onSchemeChange);   // 旧版 Safari
    }

    /* -------------------------------------------------------- 移动端菜单 */

    function initMenu() {
        var toggle = doc.getElementById('navToggle');
        var menu = doc.getElementById('mobileMenu');
        if (!toggle || !menu) return;
        function set(open) {
            menu.classList.toggle('open', open);
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            toggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
            toggle.textContent = open ? '✕' : '☰';
            // 展开时锁住页面滚动：否则手指在菜单上滑动会连带滚动背后的正文
            doc.body.classList.toggle('menu-open', open);
        }
        function close() { if (menu.classList.contains('open')) set(false); }
        toggle.addEventListener('click', function () { set(!menu.classList.contains('open')); });
        Array.prototype.forEach.call(menu.querySelectorAll('a'), function (a) {
            a.addEventListener('click', close);
        });
        doc.addEventListener('click', function (e) {
            if (menu.classList.contains('open') && !menu.contains(e.target) && !toggle.contains(e.target)) close();
        });
        // 触屏/键盘都能退出：Esc 关闭
        doc.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' || e.keyCode === 27) close();
        });
        // 横屏或旋转到宽视口后菜单已被 CSS 收起，重置状态避免"隐形遮罩"残留
        var wide = global.matchMedia('(min-width: 641px)');
        var onWide = function (e) { if (e.matches) close(); };
        if (wide.addEventListener) wide.addEventListener('change', onWide);
        else if (wide.addListener) wide.addListener(onWide);
    }

    /* ---------------------------------------------------------- 导航高亮 */

    /* 页面 → 所属栏目。文章阅读页属于"文章"栏目，否则导航里一个都不会亮。 */
    var SECTION_OF = { 'article.html': 'articles.html' };

    function initNavActive() {
        var links = Array.prototype.slice.call(doc.querySelectorAll('.nav-links a'))
            .concat(Array.prototype.slice.call(doc.querySelectorAll('.mobile-menu a')));
        if (!links.length) return;

        var here = location.pathname.split('/').pop() || 'index.html';
        var section = SECTION_OF[here] || here;

        // 以 href 为键：桌面导航与移动菜单里的同名链接要一起高亮
        var pageHref = null, anchors = [], seen = {};
        links.forEach(function (l) {
            var href = (l.getAttribute('href') || '').trim();
            var target = href.split('#')[0];
            if (target) {
                if (target === section) pageHref = target;
                return;
            }
            var id = href.replace(/^#/, '');
            var el = id ? doc.getElementById(id) : null;
            if (el && !seen[href]) { seen[href] = 1; anchors.push({ href: href, el: el }); }
        });

        function apply(href) {
            links.forEach(function (l) {
                var on = !!href && (l.getAttribute('href') || '').trim() === href;
                l.classList.toggle('active', on);
                if (on) l.setAttribute('aria-current', 'page');
                else l.removeAttribute('aria-current');
            });
        }

        // 普通页面：直接高亮所属栏目
        if (!anchors.length) { apply(pageHref); return; }

        // 带页内锚点的页面（首页）：滚到哪个区块就高亮哪个，回到顶部则高亮首页
        function spy() {
            var y = global.scrollY;
            var current = null;
            anchors.forEach(function (a) {
                if (a.el.getBoundingClientRect().top <= 120) current = a.href;
            });
            // 已经滚到页面底部：直接高亮最后一个区块，
            // 否则矮视口下末尾区块永远够不到判定线（页面滚不动了）。
            if (y + global.innerHeight >= root.scrollHeight - 2) {
                current = anchors[anchors.length - 1].href;
            }
            apply(current || pageHref);
        }
        watchOnFrame(spy);
    }

    /* ---------------------------------------------------------- 滚动揭示 */

    /* 只初始化一次，并且只处理还没处理过的元素：
       首页/列表页会在拿到数据后再次渲染卡片，此时只需观察新增的那些。 */
    var _revealIO = null;
    function revealObserver() {
        if (_revealIO) return _revealIO;
        _revealIO = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (e.isIntersecting) { e.target.classList.add('in'); _revealIO.unobserve(e.target); }
            });
        }, { threshold: 0.12 });
        return _revealIO;
    }

    function initReveal(scope) {
        var els = (scope || doc).querySelectorAll('.reveal:not(.in):not([data-reveal])');
        if (!els.length) return;
        if (!('IntersectionObserver' in global)) {
            Array.prototype.forEach.call(els, function (e) { e.classList.add('in'); });
            return;
        }
        var io = revealObserver();
        Array.prototype.forEach.call(els, function (e) {
            e.setAttribute('data-reveal', '');   // 标记已托管，重复调用不会重复观察
            io.observe(e);
        });
    }

    /* ------------------------------------------------- 回到顶部 / 进度条 */

    /** 回到顶部：三次 ease-in-out，起步与收尾都平缓，中段最快，观感比纯加速更自然 */
    function scrollToTop() {
        var startY = global.scrollY;
        if (startY <= 0) return;
        var dur = Math.min(780, Math.max(300, startY * 0.35));
        var t0 = null;
        function step(now) {
            if (t0 === null) t0 = now;
            var t = Math.min((now - t0) / dur, 1);
            var e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            // behavior 必须显式 instant：'auto' 会继承 html{scroll-behavior:smooth}，
            // 每帧又被平滑化一次，自绘的节奏会被覆盖
            global.scrollTo({ top: startY * (1 - e), left: 0, behavior: 'instant' });
            if (t < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    function initScrollUI() {
        var nav = doc.getElementById('nav');
        var toTop = doc.getElementById('toTop');
        var progress = doc.getElementById('readingProgress') || doc.getElementById('progress');
        var lastP = -1;

        if (toTop) toTop.addEventListener('click', scrollToTop);

        watchOnFrame(function () {
            var y = global.scrollY;
            if (nav) nav.classList.toggle('scrolled', y > 12);
            if (toTop) toTop.classList.toggle('show', y > 600);
            if (!progress) return;
            // 文档高度在这里现算：正文（含公式、图片）是异步渲染的，
            // 只在初始化时测量会把进度条永久钉死在错误的比例上。
            var docH = root.scrollHeight - global.innerHeight;
            var p = 0;
            if (docH > global.innerHeight * 0.35 && docH > 0) {
                p = Math.max(0, Math.min(1, y / docH));
            }
            if (p !== lastP) {
                lastP = p;
                progress.style.transform = 'scaleX(' + p + ')';
            }
        });
    }

    /* ------------------------------------------------------- 正文增强 */

    /** 把 img:// 引用解析成 blob: URL，让本地图片正常显示 */
    function hydrateImages(container) {
        if (!container || !global.WJStore) return Promise.resolve(0);
        var imgs = Array.prototype.slice.call(container.querySelectorAll('img[src^="img://"]'));
        if (!imgs.length) return Promise.resolve(0);
        return Promise.all(imgs.map(function (img) {
            var id = img.getAttribute('src').slice(6);
            return global.WJStore.imageURL(id).then(function (url) {
                if (url) { img.setAttribute('src', url); return 1; }
                if (img.classList.contains('img-missing')) return 0;   // 重复解析时不再追加提示
                img.classList.add('img-missing');
                img.setAttribute('alt', (img.getAttribute('alt') || '') + '（本地图片未找到）');
                return 0;
            });
        })).then(function (r) { return r.reduce(function (a, b) { return a + b; }, 0); });
    }

    /** 代码块"复制"按钮 */
    function initCodeCopy(container) {
        if (!container) return;
        Array.prototype.forEach.call(container.querySelectorAll('.code-copy[data-copy]'), function (btn) {
            btn.addEventListener('click', function () {
                var block = btn.closest('.code-block');
                var code = block && block.querySelector('pre code');
                if (!code) return;
                var doCopy = global.WJUI ? global.WJUI.copy(code.textContent) : Promise.resolve(false);
                Promise.resolve(doCopy).then(function () {
                    btn.textContent = '已复制';
                    btn.classList.add('done');
                    setTimeout(function () { btn.textContent = '复制'; btn.classList.remove('done'); }, 1600);
                });
            });
        });
    }

    /** 阅读页目录：滚动时高亮当前章节 */
    function initTOC(container, tocEl) {
        if (!container || !tocEl) return;
        var links = Array.prototype.slice.call(tocEl.querySelectorAll('a'));
        if (!links.length) return;
        var map = {};
        links.forEach(function (a) {
            var id = decodeURIComponent((a.getAttribute('href') || '').slice(1));
            var h = doc.getElementById(id);
            if (h) map[id] = { link: a, el: h };
        });
        var ids = Object.keys(map);
        if (!ids.length) return;
        if (tocEl.getAttribute('data-toc-bound')) return;   // 避免重复绑定
        tocEl.setAttribute('data-toc-bound', '');
        var lastActive = null;
        function update() {
            var best = null, bestTop = -Infinity;
            ids.forEach(function (id) {
                var top = map[id].el.getBoundingClientRect().top - 120;
                if (top <= 0 && top > bestTop) { bestTop = top; best = id; }
            });
            // 末尾兜底：只按"越过激活线"判定时，最后一节常常永远轮不到它 ——
            // 结尾的段落短、后面又跟着版权与上一篇/下一篇，页面根本没有能继续
            // 滚动的余量，小标题就压不到那条线。已经到底了就把末尾一项点亮。
            if (best && root.scrollHeight - global.innerHeight - global.scrollY <= 4) {
                best = ids[ids.length - 1];
            }
            if (best === lastActive) return;
            lastActive = best;
            links.forEach(function (a) { a.classList.remove('active'); });
            if (best) map[best].link.classList.add('active');
        }
        watchOnFrame(update);
    }

    /** 渲染正文（Markdown → HTML），并按需加载 KaTeX 排版公式 */
    function renderProse(container, markdown) {
        if (!container) return Promise.resolve();
        container.innerHTML = global.WJMarkdown.render(markdown || '');
        initCodeCopy(container);
        return global.WJMath.renderIn(container);
    }

    global.WJSite = {
        initTheme: initTheme,
        initMenu: initMenu,
        initNavActive: initNavActive,
        initReveal: initReveal,
        initScrollUI: initScrollUI,
        scrollToTop: scrollToTop,
        hydrateImages: hydrateImages,
        initCodeCopy: initCodeCopy,
        initTOC: initTOC,
        renderProse: renderProse,
        /** 一次性初始化所有通用行为 */
        initCommon: function () {
            initTheme();
            initMenu();
            initNavActive();
            initReveal();
            initScrollUI();
        }
    };
})(window);
