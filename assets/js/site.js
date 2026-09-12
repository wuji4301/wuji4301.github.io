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
            global.addEventListener('scroll', remeasureSoon, { passive: true });
            global.addEventListener('resize', scheduleFrame);
        }
        fn();
    }

    /* --------------------------------------------------- 文档尺寸缓存
       正文里的公式、图片是异步补齐的，滚动高度会随之中途变化；但绝不能因此
       在每一帧的滚动里去读 scrollHeight / getBoundingClientRect —— 那是一次
       强制同步布局，页面越长、元素越多，滚动掉帧越厉害。
       这里统一改用 ResizeObserver：只在内容真正变高变矮时重测一次，并把结果
       与版本号一起缓存起来，滚动帧里只读缓存。 */
    var _metrics = { scrollable: 0, viewport: 0, version: 0 };
    var _metricsRO = null;

    function remeasure() {
        _metrics.viewport = global.innerHeight;
        _metrics.scrollable = root.scrollHeight - _metrics.viewport;
        _metrics.version++;
        scheduleFrame();     // 内容变化后重跑一次各 watcher，避免读数滞后一帧
    }

    /* ResizeObserver 只保证"变化时回调过"，不保证"最后一次变化一定回调到"：
       图片/字体补齐、卡片后插入，都可能刚好收尾在回调之后。可滚动高度只要差
       几个像素，"滚到底就点亮末尾区块"（阈值 2px / 4px）和阅读进度条就都会
       失效 —— 末尾的「联系」永远点不亮正是这么来的。每帧读 scrollHeight 会
       强制同步布局，所以只在滚动停下来之后补测一次。 */
    var _idleTimer = 0;
    function remeasureSoon() {
        global.clearTimeout(_idleTimer);
        _idleTimer = global.setTimeout(function () {
            _idleTimer = 0;
            remeasure();
        }, 150);
    }

    function ensureMetrics() {
        if (_metricsRO || _metrics._ready) return;
        _metrics._ready = true;
        remeasure();
        // 带 #锚点 直接进来时不一定会有滚动事件，靠 load 再校准一次
        if (doc.readyState !== 'complete') global.addEventListener('load', remeasureSoon);
        if ('ResizeObserver' in global) {
            _metricsRO = new global.ResizeObserver(remeasure);
            _metricsRO.observe(root);
            if (doc.body) _metricsRO.observe(doc.body);
        } else {
            global.addEventListener('resize', remeasure);
        }
    }

    /** 元素到文档顶部的距离。用 offsetTop 逐级累加而非 getBoundingClientRect：
        同样是布局读数，但不受祖先 transform 影响 —— 页面首屏那些"上浮"过渡
        不会让缓存下来的位置偏掉。只在内容尺寸变化时调用，不进滚动帧。 */
    function absTop(el) {
        var t = 0;
        while (el) { t += el.offsetTop; el = el.offsetParent; }
        return t;
    }

    /** 位置缓存：尺寸版本号变了才重算，滚动帧里只做数值比较 */
    function makeTopCache(elements) {
        var tops = [], ver = -1;
        return function () {
            if (ver !== _metrics.version) {
                for (var i = 0; i < elements.length; i++) tops[i] = absTop(elements[i]);
                ver = _metrics.version;
            }
            return tops;
        };
    }

    /* ------------------------------------------------------------ 主题 */

    function initTheme() {
        var btn = doc.getElementById('themeToggle');
        var mql = global.matchMedia('(prefers-color-scheme: dark)');
        function apply(t) {
            root.setAttribute('data-theme', t);
            if (btn) btn.textContent = t === 'dark' ? '\u263E' : '\u2600\uFE0E';
        }
        function save(t) {
            try { localStorage.setItem('wj-theme', t); } catch (e) { void e; }
        }
        apply(root.getAttribute('data-theme') || 'dark');

        /* 切主题：以按钮为圆心画一个圆，把新主题"推"出来。
           圆心与半径在切换之前算好，写进 CSS 变量交给 motion.css 做 clip-path
           动画。不支持 View Transitions 的浏览器直接切，不做降级动画 —— 过渡是
           加分项，不该为了它在老浏览器上引入第二种代码路径。 */
        function switchTheme() {
            var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            if (!btn || typeof doc.startViewTransition !== 'function') { apply(next); save(next); return; }

            var box = btn.getBoundingClientRect();
            var cx = box.left + box.width / 2;
            var cy = box.top + box.height / 2;
            // 取到最远角的距离，保证圆扩到最后能盖满整个视口
            var far = Math.hypot(Math.max(cx, global.innerWidth - cx),
                                 Math.max(cy, global.innerHeight - cy));
            root.style.setProperty('--vt-x', cx + 'px');
            root.style.setProperty('--vt-y', cy + 'px');
            root.style.setProperty('--vt-r', far + 'px');
            root.classList.add('theme-vt');     // 必须在快照之前挂上，新快照才吃到这条规则

            var vt = doc.startViewTransition(function () { apply(next); save(next); });
            // 成功与被中途打断都要摘掉标记，否则下一次切换会莫名其妙地沿用圆形动画
            var done = function () { root.classList.remove('theme-vt'); };
            vt.finished.then(done, done);
        }

        if (btn) btn.addEventListener('click', switchTheme);
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
        ensureMetrics();
        var topsOf = makeTopCache(anchors.map(function (a) { return a.el; }));
        function spy() {
            var y = global.scrollY;
            var tops = topsOf();
            var current = null;
            for (var i = 0; i < anchors.length; i++) {
                if (tops[i] - y <= 120) current = anchors[i].href;
            }
            // 已经滚到页面底部：直接高亮最后一个区块，
            // 否则矮视口下末尾区块永远够不到判定线（页面滚不动了）。
            // 页面压根滚不动时（scrollable <= 0）没有"到底"一说，不该点亮末尾项。
            if (_metrics.scrollable > 0 && y >= _metrics.scrollable - 2) {
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

        ensureMetrics();     // 订阅文档尺寸变化；滚动帧里只读缓存，不做布局查询

        if (toTop) toTop.addEventListener('click', scrollToTop);

        watchOnFrame(function () {
            var y = global.scrollY;
            if (nav) nav.classList.toggle('scrolled', y > 12);
            if (toTop) toTop.classList.toggle('show', y > 600);
            if (!progress) return;
            var p = 0;
            if (_metrics.scrollable > _metrics.viewport * 0.35 && _metrics.scrollable > 0) {
                p = Math.max(0, Math.min(1, y / _metrics.scrollable));
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

    /* ------------------------------------------------------ 图片加载淡入 */

    /* 图片是异步到位的，直接冒出来总像"闪"了一下。这里在它还没就绪时先压成透明，
       load 之后再淡上来。
       关键取舍：两个类都只由 JS 添加 —— 脚本没跑、报错，或图片压根还没有 src 时，
       图片就是最普通的样子，绝不会出现"内容被动画永久藏住"。缓存命中的图片
       （complete 且已有尺寸）直接跳过，不补一次无意义的闪烁。
       一处托管全站：初始扫一遍，之后交给 MutationObserver 接手动态插入的图片
       （列表重排、正文渲染、头像赋值都走这条路），各页面脚本不用自己记得调用。 */
    var _imgFadeBound = false;

    function markImage(img) {
        if (!img || img.getAttribute('data-fade') !== null) return;
        var src = img.getAttribute('src');
        if (!src || !src.trim()) return;                    // 还没挂 src 的占位图，不藏
        img.setAttribute('data-fade', '');                  // 标记已托管，重复扫描不再处理
        if (img.complete && img.naturalWidth > 0) return;   // 已在缓存里，直接呈现
        img.classList.add('img-loading');
    }

    function scanImages(scope) {
        if (!scope || scope.nodeType !== 1) return;
        if (scope.tagName === 'IMG') { markImage(scope); return; }
        if (!scope.querySelectorAll) return;
        var list = scope.querySelectorAll('img');
        for (var i = 0; i < list.length; i++) markImage(list[i]);
    }

    /** load / error 都不冒泡，只能在捕获阶段统一接住（换 src 也能接到） */
    function settleImage(e) {
        var img = e.target;
        if (!img || img.tagName !== 'IMG' || !img.classList) return;
        img.classList.remove('img-loading');
        if (e.type === 'load') img.classList.add('img-in');   // 失败就直接显形，不留透明
    }

    function initImageFade() {
        if (_imgFadeBound) return;
        _imgFadeBound = true;
        doc.addEventListener('load', settleImage, true);
        doc.addEventListener('error', settleImage, true);
        scanImages(doc.body || root);
        if ('MutationObserver' in global) {
            new global.MutationObserver(function (records) {
                for (var i = 0; i < records.length; i++) {
                    var added = records[i].addedNodes;
                    for (var j = 0; j < added.length; j++) scanImages(added[j]);
                }
            }).observe(doc.body || root, { childList: true, subtree: true });
        }
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
        ensureMetrics();
        var lastActive = null;
        var navEl = tocEl.querySelector('nav');

        /* 目录滑轨：把 nav 上的 ::before 平移到当前项。offsetTop / offsetHeight 是
           布局读数，所以只在活动项真的换了的时候读一次（不是每帧），且读之前不写
           样式 —— 读写不交替，不会触发多余的同步布局。 */
        function moveRail(id) {
            if (!navEl) return;
            var link = id ? map[id].link : null;
            if (!link) { navEl.removeAttribute('data-toc-active'); return; }
            navEl.style.setProperty('--toc-y', link.offsetTop + 'px');
            navEl.style.setProperty('--toc-h', link.offsetHeight + 'px');
            navEl.setAttribute('data-toc-active', '');
        }

        // 标题位置缓存：尺寸版本变了才重算，滚动帧里只做数值比较
        var topsOf = makeTopCache(ids.map(function (id) { return map[id].el; }));

        function update() {
            var tops = topsOf();
            var y = global.scrollY;
            var best = null, bestTop = -Infinity;
            for (var i = 0; i < ids.length; i++) {
                var top = tops[i] - 120 - y;
                if (top <= 0 && top > bestTop) { bestTop = top; best = ids[i]; }
            }
            // 末尾兜底：只按"越过激活线"判定时，最后一节常常永远轮不到它 ——
            // 结尾的段落短、后面又跟着版权与上一篇/下一篇，页面根本没有能继续
            // 滚动的余量，小标题就压不到那条线。已经到底了就把末尾一项点亮。
            if (best && _metrics.scrollable > 0 && _metrics.scrollable - y <= 4) {
                best = ids[ids.length - 1];
            }
            if (best === lastActive) return;
            lastActive = best;
            links.forEach(function (a) { a.classList.remove('active'); });
            if (best) map[best].link.classList.add('active');
            moveRail(best);
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
        initImageFade: initImageFade,
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
            initImageFade();
            initScrollUI();
        }
    };
})(window);
