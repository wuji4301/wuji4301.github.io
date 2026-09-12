/* ==========================================================================
   无极博客 · 编辑器页面逻辑（admin/js/editor-page.js）
   —— 由 admin/editor.html 内联脚本抽出，便于单独维护与复用
   ========================================================================== */
(function (global) {
    'use strict';

    var Store = global.WJStore;
    var UI = global.WJUI;
    var MD = global.WJMarkdown;

    global.WJSite.initCommon();

    var host = document.getElementById('editorHost');
    var deleteBtn = document.getElementById('deleteBtn');
    var originNotice = document.getElementById('originNotice');
    var titleEl = document.getElementById('editorTitle');
    var statusEl = document.getElementById('editorStatus');
    var editor = null;
    var fromRepo = false;

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function setTitle(title) {
        if (titleEl) titleEl.textContent = title || '新文章';
        document.title = (title || '新文章') + ' · 编辑器 · 无极博客';
    }

    function setStatus(text) {
        if (statusEl) statusEl.textContent = text;
    }

    function mount(article, isRepo) {
        fromRepo = !!isRepo;
        if (editor) editor.destroy();
        editor = new global.WJEditor(host, {
            article: article,
            onSave: function (saved) {
                // 标题跟随文章，便于在多个标签页之间区分
                setTitle(saved.title);
                setStatus('已保存 · ' + Store.fmtRelative(saved.updatedAt));
                deleteBtn.hidden = false;
                originNotice.hidden = !fromRepo;
                try {
                    history.replaceState(null, '', 'editor.html?id=' + encodeURIComponent(saved.id));
                } catch (e) { void e; }
            }
        });
        setTitle(article && article.id ? article.title : '新文章');
        setStatus(article && article.id ? '本地保存 · 不上传' : '新建 · 尚未保存');
        deleteBtn.hidden = !(article && article.id);
        originNotice.hidden = !fromRepo;
    }

    /* --------------------------------------------------------- 顶部操作 */

    document.getElementById('saveTopBtn').addEventListener('click', function () {
        editor.save().then(function () {
            UI.toast('已保存到本地', 'ok');
        }).catch(function () {
            /* 失败原因已在编辑器内提示 */
        });
    });

    document.getElementById('newBtn').addEventListener('click', function () {
        var go = function () {
            mount(Store.normalize({}), false);
            try { history.replaceState(null, '', 'editor.html'); } catch (e) { void e; }
            UI.toast('已新建空白文章', 'ok');
        };
        if (editor && editor.dirty) {
            UI.confirm('放弃未保存的修改？', '当前修改尚未保存，新建会丢失这些内容。', '放弃并新建')
                .then(function (yes) { if (yes) go(); });
        } else go();
    });

    function leaveTo(url) {
        if (editor && editor.dirty) {
            editor.save().catch(function () { /* 忽略保存失败，仍然离开 */ })
                .then(function () { location.href = url; });
        } else {
            location.href = url;
        }
    }

    document.getElementById('listBtn').addEventListener('click', function () { leaveTo('index.html'); });
    document.getElementById('selftestBtn').addEventListener('click', function () { leaveTo('selftest.html'); });

    document.getElementById('deleteBtn').addEventListener('click', function () {
        var id = editor.article.id;
        if (!id) return;
        UI.confirm('删除文章', '删除后无法恢复；仓库里的同名文章会在下一次「打包发布 → 本地落地」时一并移除。', '确认删除').then(function (yes) {
            if (!yes) return;
            Store.deleteArticle(id).then(function () {
                UI.toast('已删除', 'ok');
                editor.destroy();
                location.href = 'index.html';
            });
        });
    });

    /* ------------------------------------------------------------- 预览 */

    document.getElementById('previewBtn').addEventListener('click', function () {
        var md = editor.getMarkdown();
        var wrap = document.createElement('div');
        wrap.className = 'prose preview-body';
        wrap.style.maxHeight = '62vh';
        wrap.style.overflowY = 'auto';
        wrap.innerHTML = MD.render(md);
        global.WJSite.initCodeCopy(wrap);
        global.WJMath.renderIn(wrap);
        UI.dialog({
            title: '预览（与发布后一致）',
            body: wrap,
            width: '820px',
            actions: [
                { label: '关闭', value: false },
                { label: '保存', primary: true, onClick: function () { editor.save(); return true; } }
            ]
        });
    });

    /* ------------------------------------------------------------- 导出 */

    document.getElementById('exportBtn').addEventListener('click', function () {
        editor.save().then(function (a) {
            var wrap = document.createElement('div');
            wrap.className = 'export-grid';
            wrap.innerHTML =
                '<div class="notice">推荐回到<a href="index.html">管理系统</a>点「打包发布」：' +
                '它会把所有本地文章与图片汇总成一个发布包，再用 ' +
                '<code>node tools/publish.mjs &lt;发布包&gt;</code> 一次性落地。' +
                '下面是单篇导出的备用方式。</div>' +
                '<div class="export-row"><div class="grow"><div class="t">' + esc(a.title) + '</div>' +
                '<div class="d">id <code>' + esc(a.id) + '</code> · 更新 ' + Store.fmtDate(a.updatedAt, true) + '</div></div>' +
                '<button class="btn btn-primary btn-sm" id="dlOne" type="button">下载 .json</button></div>' +
                '<div class="export-row"><div class="grow"><div class="t">导出 PDF</div>' +
                '<div class="d">调起浏览器打印，把「目标」选成<strong>另存为 PDF</strong>；公式、代码、表格都是矢量文字，可选中可检索。</div></div>' +
                '<button class="btn btn-ghost btn-sm" id="dlPdf" type="button">导出 PDF</button></div>' +
                '<div class="export-row"><div class="grow"><div class="t">下载全部文章数据</div>' +
                '<div class="d">生成 <code>articles.json</code>（内联全部正文），放到仓库 <code>articles/</code> 目录。</div></div>' +
                '<button class="btn btn-ghost btn-sm" id="dlIndex" type="button">下载 articles.json</button></div>' +
                '<div class="export-row"><div class="grow"><div class="t">下载本地图片</div>' +
                '<div class="d">把文件放进 <code>articles/img/</code>，并把正文里的 <code>img://id</code> 改成对应相对路径。</div></div>' +
                '<button class="btn btn-ghost btn-sm" id="dlImgs" type="button">下载图片</button></div>';
            UI.dialog({ title: '导出', body: wrap, width: '660px', actions: [{ label: '关闭', value: false }] });

            wrap.querySelector('#dlOne').addEventListener('click', function () {
                Store.exportArticleFile(a);
                UI.toast('已下载 ' + (a.slug || a.id) + '.json', 'ok');
            });

            wrap.querySelector('#dlPdf').addEventListener('click', function () {
                if (!global.WJExportPDF) { UI.toast('PDF 组件未加载', 'err'); return; }
                global.WJExportPDF.print({
                    site: '无极',
                    title: a.title,
                    summary: a.summary,
                    cover: a.cover,
                    tags: a.tags,
                    meta: [Store.fmtDate(a.updatedAt, true), Store.countWords(a.body) + ' 字'],
                    bodyHTML: a.format === 'html' ? a.body : MD.render(a.body || ''),
                    assetURL: Store.assetURL,
                    imageResolver: Store.imageURL,
                    docTitle: a.title
                }).then(function (ok) {
                    if (!ok) UI.toast('当前浏览器不支持打印，请用 Ctrl/⌘ + P 手动导出', 'err', 3200);
                });
            });

            wrap.querySelector('#dlIndex').addEventListener('click', function () {
                Store.listAll().then(function (res) {
                    var mine = res.articles.filter(function (x) { return x.source === 'local'; });
                    var list = mine.length ? mine : res.articles;
                    Store.download('articles.json', JSON.stringify(Store.buildRepoIndex(list, true), null, 2));
                    UI.toast('已下载 articles.json（' + list.length + ' 篇）', 'ok', 3000);
                });
            });

            wrap.querySelector('#dlImgs').addEventListener('click', function () {
                Store.listImages().then(function (imgs) {
                    if (!imgs.length) { UI.toast('本地还没有图片', 'err'); return; }
                    Store.exportImages();
                    UI.toast('开始下载 ' + imgs.length + ' 张图片', 'ok');
                });
            });
        });
    });

    /* --------------------------------------------------------- AI 写稿 */

    var AI = global.WJAI;

    // 同一时刻只跑一个请求：重复点按不会叠出一堆 API 调用
    var aiJob = null;

    function stageText(name, rec) {
        var label = rec && rec.name ? '「' + rec.name + '」' : '这张图';
        if (name === 'prepare') return '正在压缩并读取 ' + label + '…';
        return '正在让 DeepSeek V4.1 读图、按内容 1:1 转写正文…（通常 20~60 秒）';
    }

    /** UI.dialog 没有对外暴露 close，这里点它自己的「✕」来收场 */
    function closeModalOf(body) {
        var overlay = body && body.closest ? body.closest('.wj-modal-overlay') : null;
        var x = overlay && overlay.querySelector('.wj-modal-x');
        if (x) x.click();
    }

    /** 当前编辑器里是否已经有东西会被覆盖 */
    function hasContent() {
        if (!editor || !editor.article) return false;
        // 注意：normalize() 会给空白新文章也补一个 id，所以不能拿 id 当「有内容」的依据，
        // 否则每篇新文章都会先弹一次覆盖确认 —— 认「仓库文章 / 已改过 / 正文有字」这三条。
        if (editor.article.source === 'repo') return true;
        if (editor.dirty) return true;
        try { return !!(editor.getMarkdown() || '').trim(); } catch (e) { return false; }
    }

    function openAIWriter() {
        if (!AI) { UI.toast('AI 模块未加载，请强制刷新页面（Ctrl + Shift + R）', 'err', 4200); return; }

        var wrap = document.createElement('div');
        wrap.innerHTML =
            '<p class="wj-modal-text">选一张本地图片，AI 会把图片内容 <b>1:1 转写</b>成一篇草稿：' +
            '照搬图里的文字、数据与要点，不做解释与扩写。<br />' +
            '生成结果会覆盖当前的标题、摘要、标签与正文。</p>' +
            '<div class="admin-actions" style="margin:12px 0">' +
            '<button class="btn btn-primary btn-sm" data-role="upload" type="button">上传新图片</button>' +
            '</div>' +
            '<input type="file" accept="image/*" data-role="file" hidden />' +
            '<div class="thumb-grid" data-role="grid"></div>' +
            '<div class="empty" data-role="empty" hidden><p>本地还没有图片，点上面的「上传新图片」。</p></div>' +
            '<div class="ai-panel" data-role="prog" hidden>' +
            '<span class="ai-dot" aria-hidden="true"></span>' +
            '<div class="grow">' +
            '<div class="t" data-role="progTitle">正在生成文章…</div>' +
            '<div class="d" data-role="progNote"></div>' +
            '</div>' +
            '<button class="btn btn-ghost btn-sm" data-role="cancel" type="button">取消</button>' +
            '</div>' +
            '<div class="ai-panel" data-role="setup" hidden>' +
            '<div class="grow">' +
            '<div class="t">还没有配置 DeepSeek API Key</div>' +
            '<div class="d">到「设置 → AI 生成」填一把 Key，就能用 DeepSeek V4.1 看图写稿。Key 只保存在本机浏览器。</div>' +
            '</div>' +
            '<button class="btn btn-primary btn-sm" data-role="toSettings" type="button">去设置</button>' +
            '</div>';

        var el = {
            upload: wrap.querySelector('[data-role="upload"]'),
            file: wrap.querySelector('[data-role="file"]'),
            grid: wrap.querySelector('[data-role="grid"]'),
            empty: wrap.querySelector('[data-role="empty"]'),
            prog: wrap.querySelector('[data-role="prog"]'),
            progTitle: wrap.querySelector('[data-role="progTitle"]'),
            progNote: wrap.querySelector('[data-role="progNote"]'),
            cancel: wrap.querySelector('[data-role="cancel"]'),
            setup: wrap.querySelector('[data-role="setup"]'),
            toSettings: wrap.querySelector('[data-role="toSettings"]')
        };

        var images = [];

        function renderGrid() {
            el.grid.innerHTML = images.map(function (r) {
                return '<figure class="thumb-card" data-id="' + esc(r.id) + '">' +
                    '<button class="thumb-media" data-act="pick" type="button" aria-label="用 ' + esc(r.name) + ' 写稿">' +
                    '<img data-img="' + esc(r.id) + '" alt="' + esc(r.name) + '" loading="lazy" />' +
                    '</button>' +
                    '<figcaption class="thumb-meta">' +
                    '<div class="t" title="' + esc(r.name) + '">' + esc(r.name) + '</div>' +
                    '<div class="d">' + UI.fmtBytes(r.size) + '</div>' +
                    '</figcaption>' +
                    '</figure>';
            }).join('');
            el.empty.hidden = images.length > 0;
            Array.prototype.forEach.call(el.grid.querySelectorAll('img[data-img]'), function (img) {
                var id = img.getAttribute('data-img');
                var cached = Store.imageURLCached(id);
                if (cached) { img.src = cached; return; }
                Store.imageURL(id).then(function (u) { if (u) img.src = u; });
            });
        }

        function setBusy(busy) {
            el.upload.hidden = busy;
            el.grid.hidden = busy;
            el.empty.hidden = busy || images.length > 0;
        }

        function start(rec) {
            if (aiJob) { UI.toast('上一张图还在生成中，请稍候', 'err'); return; }
            if (!AI.isConfigured()) {
                el.setup.hidden = false;
                el.prog.hidden = true;
                UI.toast('请先在「设置 → AI 生成」里填写 API Key', 'err', 3600);
                return;
            }

            var token = {
                cancelled: false,
                ctrl: global.AbortController ? new global.AbortController() : null,
                rec: rec
            };
            aiJob = token;
            setBusy(true);
            el.setup.hidden = true;
            el.prog.hidden = false;
            el.progTitle.textContent = '正在生成文章…';
            el.progNote.textContent = stageText('prepare', rec);
            el.cancel.textContent = '取消';

            AI.imageToArticle({
                imageId: rec.id,
                imageName: rec.name,
                signal: token.ctrl ? token.ctrl.signal : undefined,
                onStage: function (name) {
                    if (aiJob === token) el.progNote.textContent = stageText(name, rec);
                }
            }).then(function (out) {
                if (token.cancelled || !out) return null;
                // 手动入口：结果直接落进当前这篇，存盘后标题/状态跟着更新
                editor.load(out.article);
                aiJob = null;
                closeModalOf(wrap);
                return editor.save().then(function () {
                    UI.toast('已按图片内容写好《' + out.article.title + '》', 'ok', 3000);
                });
            }).catch(function (err) {
                if (token.cancelled) return;
                aiJob = null;
                el.progTitle.textContent = '生成失败';
                el.progNote.textContent = (err && err.message) || '生成失败，请稍后重试。';
                el.cancel.textContent = '关闭';
            });
        }

        el.upload.addEventListener('click', function () {
            el.file.value = '';
            el.file.click();
        });

        el.file.addEventListener('change', function () {
            var f = el.file.files && el.file.files[0];
            if (!f) return;
            AI.saveImageFile(f).then(function (rec) {
                // 用户点的是「上传新图片（写稿）」，所以传完直接写，不再多问一次
                if (images.indexOf(rec) === -1) images.unshift(rec);
                start(rec);
            }).catch(function (err) {
                UI.toast((err && err.message) || '图片保存失败', 'err', 4200);
            });
        });

        el.grid.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-act="pick"]');
            if (!btn) return;
            var card = e.target.closest('.thumb-card');
            var id = card && card.getAttribute('data-id');
            var rec = images.filter(function (r) { return r.id === id; })[0];
            if (rec) start(rec);
        });

        el.cancel.addEventListener('click', function () {
            if (aiJob) {
                aiJob.cancelled = true;
                if (aiJob.ctrl) aiJob.ctrl.abort();
                aiJob = null;
                UI.toast('已取消生成', 'ok');
            }
            closeModalOf(wrap);
        });

        el.toSettings.addEventListener('click', function () {
            closeModalOf(wrap);
            leaveTo('index.html#/settings');
        });

        if (!AI.isConfigured()) el.setup.hidden = false;

        Store.listImages().then(function (list) {
            images = (list || []).slice().sort(function (x, y) {
                return String(y.createdAt).localeCompare(String(x.createdAt));
            });
            renderGrid();
        }).catch(function (err) {
            UI.toast('读取本地图片失败：' + ((err && err.message) || '未知错误'), 'err', 3600);
        });

        UI.dialog({
            title: 'AI 写稿（图片转文章）',
            body: wrap,
            width: '760px',
            actions: [{ label: '关闭', value: false }]
        });
    }

    document.getElementById('aiBtn').addEventListener('click', function () {
        // 手写稿先问一句：按钮是手动触发的，但覆盖内容仍要用户点头
        if (!hasContent()) { openAIWriter(); return; }
        UI.confirm('AI 写稿会覆盖当前内容', '生成结果会替换当前的标题、摘要、标签与正文，且无法撤销。确定继续？', '继续写稿')
            .then(function (yes) { if (yes) openAIWriter(); });
    });

    /* ------------------------------------------------------------- 启动 */

    var m = /[?&]id=([^&]+)/.exec(location.search);
    var id = m ? decodeURIComponent(m[1]) : '';

    if (id) {
        Store.getArticle(id).then(function (a) {
            if (!a) {
                UI.toast('没有找到 id 为 ' + id + ' 的文章，已新建空白文章', 'err', 3600);
                mount(Store.normalize({}), false);
                return;
            }
            mount(a, a.source === 'repo');
        }).catch(function (err) {
            UI.toast('加载失败：' + err.message, 'err', 3600);
            mount(Store.normalize({}), false);
        });
    } else {
        mount(Store.normalize({}), false);
    }

    // 预加载 KaTeX，让公式弹窗立即有预览
    global.WJMath.load().catch(function () { /* 离线时降级为源码显示 */ });
})(window);
