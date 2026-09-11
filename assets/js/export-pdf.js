/* ==========================================================================
   无极博客 · 文章导出 PDF（复用浏览器打印）
   --------------------------------------------------------------------------
   不引第三方 PDF 库：把文章渲染进一个"只在打印时可见"的容器（.wj-print-root），
   再调起浏览器自带的打印对话框，在「目标 / 打印机」里选「另存为 PDF」即可。

   为什么不用 jsPDF / html2canvas 这类方案：
   · 本站的定位是"无构建、无第三方运行时依赖"，为导出一个 PDF 引几百 KB 的库不划算；
   · 截图方案产出的是位图：文字不能选中、不能检索，放大会发虚，中文尤其占体积；
   · 走打印通道得到的是矢量 PDF：公式、代码、表格都能选中、搜索、复制。

   容器上带 data-theme="light"：站点默认深色主题，直接送进打印机是"黑底白字"，
   反相输出既费墨又难读；这里固定用亮色令牌渲染，导出结果始终是浅底深字。

   用法：
     window.WJExportPDF.print({
       title: '文章标题',
       summary: '摘要（可选）',
       cover: 'articles/img/xxx.png',            // 可选
       tags: ['KaTeX', '教程'],
       meta: ['2026-09-11 10:20', '1200 字'],    // 标题下的一行元信息
       bodyHTML: '<p>……</p>',                   // 已渲染的正文 HTML
       url: 'https://……/article.html?slug=x',    // 可选：页脚保留出处
       assetURL: Store.assetURL,                 // 可选：相对资源补前缀（admin/ 下必需）
       imageResolver: Store.imageURL,            // 可选：img://<id> → blob: URL
       docTitle: '文章标题'                       // 可选：另存为 PDF 时的默认文件名
     }).then(function (ok) { ... });   // ok=false 表示浏览器不支持打印
   ========================================================================== */
(function (global) {
    'use strict';

    var doc = global.document;
    var ROOT_ID = 'wjPrintRoot';
    var PRINTING_CLASS = 'wj-printing';

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

    /** 本地时间戳：写进页脚，便于区分同一篇文章的不同导出批次 */
    function stamp() {
        var d = new Date();
        var p = function (n) { return n < 10 ? '0' + n : String(n); };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
            ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    /* --------------------------------------------------------- 打印容器 */

    function rootNode() { return doc.getElementById(ROOT_ID); }

    /** 移除打印容器（打印结束、或导出失败时调用） */
    function clear() {
        var el = rootNode();
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    function ensureRoot() {
        var el = rootNode();
        if (el) { el.innerHTML = ''; return el; }
        el = doc.createElement('div');
        el.id = ROOT_ID;
        el.className = 'wj-print-root';
        el.setAttribute('data-theme', 'light');     // 纸面固定浅底深字
        el.setAttribute('aria-hidden', 'true');     // 屏幕上这份内容不对读屏器播报
        doc.body.appendChild(el);
        return el;
    }

    /* --------------------------------------------------------- 内容拼装 */

    function headHTML(o) {
        var tags = (o.tags || []).filter(Boolean).map(function (t) {
            return '<span class="tag">' + esc(t) + '</span>';
        }).join('');
        var meta = (o.meta || []).filter(Boolean).map(esc).join('<span class="dot">·</span>');
        return '<header class="wj-print-head">' +
            (tags ? '<div class="wj-print-tags">' + tags + '</div>' : '') +
            '<h1 class="wj-print-title">' + esc(o.title || '未命名文章') + '</h1>' +
            (meta ? '<div class="wj-print-meta">' + meta + '</div>' : '') +
            '</header>';
    }

    function footHTML(o) {
        var bits = [];
        if (o.site) bits.push(esc(o.site));
        if (o.url) bits.push(esc(String(o.url).replace(/^https?:\/\//, '')));
        bits.push('导出时间 ' + stamp());
        return '<footer class="wj-print-foot">' + bits.join('<span class="dot">·</span>') + '</footer>';
    }

    function buildHTML(o) {
        return (o.cover ? '<img class="wj-print-cover" src="' + esc(o.cover) + '" alt="" />' : '') +
            headHTML(o) +
            (o.summary ? '<p class="wj-print-summary">' + esc(o.summary) + '</p>' : '') +
            '<div class="prose wj-print-body">' + (o.bodyHTML || '') + '</div>' +
            footHTML(o);
    }

    /* ----------------------------------------------------------- 图片 */

    /**
     * 让容器里的每张图都"就地可用"：
     * img://<id> → blob: URL（本地图片），相对路径 → 补站点前缀（admin/ 下必需）。
     * 解析不到的本地图片直接摘掉，避免在纸上留一个破图框。
     */
    function resolveImage(img, o) {
        img.removeAttribute('loading');   // loading="lazy" 的图在打印时往往还没开始请求
        img.removeAttribute('srcset');

        var src = img.getAttribute('src') || '';
        var ref = /^img:\/\/(.+)$/.exec(src);

        if (!ref) {
            if (src && !/^(https?:|data:|blob:)/i.test(src) && o.assetURL) {
                img.setAttribute('src', o.assetURL(src));
            }
            return Promise.resolve();
        }

        var resolver = o.imageResolver || (global.WJStore && global.WJStore.imageURL);
        if (!resolver) { dropImage(img); return Promise.resolve(); }
        return Promise.resolve(resolver(ref[1].trim())).then(function (url) {
            if (url) img.setAttribute('src', url);
            else dropImage(img);
        }).catch(function () { dropImage(img); });
    }

    function dropImage(img) {
        img.classList.add('img-missing');
        if (img.parentNode) img.parentNode.removeChild(img);
    }

    /** 等图片解码完再打印：否则纸上会是空的占位框（超时也照样继续，不能让导出卡死） */
    function waitImages(root, timeout) {
        var imgs = Array.prototype.slice.call(root.querySelectorAll('img'));
        if (!imgs.length) return Promise.resolve();
        var jobs = imgs.map(function (img) {
            if (img.complete && img.naturalWidth) return Promise.resolve();
            return new Promise(function (resolve) {
                img.addEventListener('load', resolve, { once: true });
                img.addEventListener('error', resolve, { once: true });
            });
        });
        return Promise.race([Promise.all(jobs), delay(timeout || 4000)]);
    }

    function renderMath(root, o) {
        if (o.math === false || !global.WJMath) return Promise.resolve();
        return Promise.race([
            global.WJMath.renderIn(root),
            delay(o.mathTimeout || 5000)
        ]).catch(function () { return null; });   // 公式没排出来就按源码打印，不阻塞导出
    }

    /* ----------------------------------------------------------- 对外 */

    /**
     * 构建打印容器（不触发打印）。正文里的公式会被排版成 KaTeX 结果，
     * 图片会被解析就位 —— 自测与调试可以直接调它。
     * 返回 Promise<Element>。
     */
    function render(o) {
        o = o || {};
        var root = ensureRoot();
        root.innerHTML = buildHTML(o);
        var imgs = Array.prototype.slice.call(root.querySelectorAll('img'));
        return Promise.all([
            Promise.all(imgs.map(function (img) { return resolveImage(img, o); })),
            renderMath(root, o)
        ]).then(function () {
            return waitImages(root, o.imageTimeout);
        }).then(function () {
            return root;
        });
    }

    /**
     * 渲染并调起打印。打印对话框关闭后还原页面（标题、主题类、容器）。
     * 返回 Promise<boolean>：true = 已调起打印，false = 浏览器不支持/导出失败。
     */
    function print(o) {
        o = o || {};
        var prevTitle = doc.title;

        return render(o).then(function () {
            if (typeof global.print !== 'function') {
                clear();
                return false;
            }
            if (o.docTitle || o.title) doc.title = o.docTitle || o.title;   // 决定"另存为 PDF"的默认文件名
            doc.documentElement.classList.add(PRINTING_CLASS);

            var done = false;
            var fallback = null;
            function finish() {
                if (done) return;
                done = true;
                clearTimeout(fallback);
                global.removeEventListener('afterprint', finish);
                doc.title = prevTitle;
                doc.documentElement.classList.remove(PRINTING_CLASS);
                clear();
            }
            // 个别浏览器不派发 afterprint，用一个足够长的兜底定时器避免样式与容器残留
            fallback = setTimeout(finish, 10 * 60 * 1000);
            global.addEventListener('afterprint', finish);

            try {
                global.print();
            } catch (err) {
                finish();
                return false;
            }
            return true;
        }).catch(function () {
            doc.title = prevTitle;
            doc.documentElement.classList.remove(PRINTING_CLASS);
            clear();
            return false;
        });
    }

    global.WJExportPDF = {
        print: print,
        render: render,
        clear: clear
    };
})(window);
