/* ==========================================================================
   无极博客 · 后台视图：图片库（admin/js/images.js）
   —— 预览 / 引用统计 / 复制引用 / 下载 / 删除 / AI 一键转文章
   ========================================================================== */
(function (global) {
    'use strict';

    var A = global.WJAdmin;
    var Store = A.Store;
    var UI = A.UI;
    var esc = A.esc;
    var AI = global.WJAI;

    var prefs = { q: '', filter: 'all', sort: 'date' };

    /** 扫描全部正文，得出 图片 id → 引用它的文章列表 */
    function buildUsage() {
        var map = {};
        A.state.articles.forEach(function (a) {
            var seen = {};
            var re = /img:\/\/([A-Za-z0-9_-]+)/g;
            var m;
            while ((m = re.exec(a.body || ''))) {
                var id = m[1];
                if (seen[id]) continue;
                seen[id] = true;
                (map[id] = map[id] || []).push({ id: a.id, title: a.title });
            }
        });
        return map;
    }

    function cardHTML(rec, usage) {
        var refs = usage[rec.id] || [];
        var dim = (rec.width && rec.height) ? rec.width + '×' + rec.height : '未知尺寸';
        return '<figure class="thumb-card" data-id="' + esc(rec.id) + '">' +
            '<button class="thumb-media" data-act="view" type="button" aria-label="预览 ' + esc(rec.name) + '">' +
            '<img data-img="' + esc(rec.id) + '" alt="' + esc(rec.name) + '" loading="lazy" />' +
            '</button>' +
            '<figcaption class="thumb-meta">' +
            '<div class="t" title="' + esc(rec.name) + '">' + esc(rec.name) + '</div>' +
            '<div class="d">' + esc(rec.type || 'image') + ' · ' + UI.fmtBytes(rec.size) + ' · ' + esc(dim) + '</div>' +
            '<div class="d">' + (refs.length
                ? '被 ' + refs.length + ' 篇文章引用'
                : '<span class="badge badge-draft">未引用</span>') + '</div>' +
            '<div class="row-actions">' +
            '<button class="btn btn-primary btn-xs" data-act="gen" type="button" title="用 AI 把这张图写成文章草稿">一键转文章</button>' +
            '<button class="btn btn-ghost btn-xs" data-act="ref" type="button">复制引用</button>' +
            '<button class="btn btn-ghost btn-xs" data-act="down" type="button">下载</button>' +
            '<button class="btn btn-danger btn-xs" data-act="del" type="button">删除</button>' +
            '</div>' +
            '</figcaption>' +
            '</figure>';
    }

    function hydrate(rootEl) {
        Array.prototype.forEach.call(rootEl.querySelectorAll('img[data-img]'), function (img) {
            var id = img.getAttribute('data-img');
            var cached = Store.imageURLCached(id);
            if (cached) { img.src = cached; return; }
            Store.imageURL(id).then(function (u) { if (u) img.src = u; });
        });
    }

    A.register('images', {
        title: '图片库',
        sub: '本地图片的引用与体积',
        mount: function (root, ctx) {
            var st = ctx.state;
            if (!st.loaded) {
                root.innerHTML = '<div class="admin-loading">正在读取本地数据…</div>';
                return;
            }

            var usage = buildUsage();
            var used = st.images.filter(function (r) { return (usage[r.id] || []).length > 0; }).length;
            var orphan = st.images.length - used;

            root.innerHTML =
                '<section class="admin-section">' +
                '<header>' +
                '<div><h2>图片库</h2><div class="sub">正文里用 <code>img://&lt;id&gt;</code> 引用，发布时会被替换为真实文件。' +
                'AI 生成用 DeepSeek V4.1（<code>deepseek-flash</code>）。</div></div>' +
                '<div class="admin-actions">' +
                '<button class="btn btn-primary btn-sm" data-role="upload" type="button">上传图片</button>' +
                '<a class="btn btn-ghost btn-sm" href="editor.html">去编辑器上传</a>' +
                '</div>' +
                '</header>' +

                '<div class="admin-toolbar">' +
                '<div class="search-box">' +
                '<input class="input" data-role="search" type="search" placeholder="按文件名搜索…" aria-label="搜索图片" value="' + esc(prefs.q) + '" />' +
                '</div>' +
                '<select class="select" data-role="filter" aria-label="引用筛选">' +
                opt('all', '全部图片', prefs.filter) + opt('used', '已被引用', prefs.filter) + opt('orphan', '未引用', prefs.filter) +
                '</select>' +
                '<select class="select" data-role="sort" aria-label="排序">' +
                opt('date', '最近添加', prefs.sort) + opt('size', '体积从大到小', prefs.sort) + opt('name', '文件名', prefs.sort) +
                '</select>' +
                '<span class="admin-count" data-role="count"></span>' +
                '</div>' +

                '<div class="body">' +
                '<div class="notice" style="margin-bottom:16px">' +
                '<div>共 <b>' + st.images.length + '</b> 张 · 占用 <b>' + UI.fmtBytes(st.imageBytes) + '</b> · ' +
                '已引用 <b>' + used + '</b> 张' + (orphan ? ' · 未引用 <b>' + orphan + '</b> 张（可在图库中清理）' : '') + '。</div>' +
                '</div>' +
                '<div class="ai-panel" data-role="gen" hidden>' +
                '<span class="ai-dot" aria-hidden="true"></span>' +
                '<div class="grow">' +
                '<div class="t" data-role="genTitle">正在生成文章…</div>' +
                '<div class="d" data-role="genNote"></div>' +
                '</div>' +
                '<button class="btn btn-ghost btn-sm" data-role="genCancel" type="button">取消</button>' +
                '</div>' +
                '<input type="file" accept="image/*" data-role="uploadFile" hidden />' +
                '<div class="ai-panel" data-role="setup" hidden>' +
                '<div class="grow">' +
                '<div class="t">还没有配置 DeepSeek API Key</div>' +
                '<div class="d">到「设置 → AI 生成」填一把 Key，就能用 DeepSeek V4.1 看图写稿。Key 只保存在本机浏览器。</div>' +
                '</div>' +
                '<button class="btn btn-primary btn-sm" data-role="toSettings" type="button">去设置</button>' +
                '</div>' +
                '<div class="thumb-grid" data-role="grid"></div>' +
                '<div class="empty" data-role="empty" hidden><p data-role="emptyText"></p></div>' +
                '</div>' +
                '</section>';

            var els = {
                grid: root.querySelector('[data-role="grid"]'),
                empty: root.querySelector('[data-role="empty"]'),
                emptyText: root.querySelector('[data-role="emptyText"]'),
                count: root.querySelector('[data-role="count"]'),
                search: root.querySelector('[data-role="search"]'),
                filter: root.querySelector('[data-role="filter"]'),
                sort: root.querySelector('[data-role="sort"]'),
                gen: root.querySelector('[data-role="gen"]'),
                genTitle: root.querySelector('[data-role="genTitle"]'),
                genNote: root.querySelector('[data-role="genNote"]'),
                genCancel: root.querySelector('[data-role="genCancel"]'),
                upload: root.querySelector('[data-role="upload"]'),
                uploadFile: root.querySelector('[data-role="uploadFile"]'),
                setup: root.querySelector('[data-role="setup"]'),
                toSettings: root.querySelector('[data-role="toSettings"]')
            };

            /* ------------------------------------------------ AI 一键转文章 */

            // 同一时刻只跑一个请求：重复点按不会叠出一堆 API 调用
            var job = null;

            function stageText(name, rec) {
                var label = rec && rec.name ? '「' + rec.name + '」' : '这张图';
                if (name === 'prepare') return '正在压缩并读取 ' + label + '…';
                return '正在让 DeepSeek V4.1 读图、按内容 1:1 转写正文…（通常 20~60 秒）';
            }

            function resetPanel() {
                job = null;
                els.gen.hidden = true;
                els.genCancel.textContent = '取消';
            }

            function start(rec) {
                if (!AI) {
                    UI.toast('AI 模块未加载，请强制刷新页面（Ctrl + Shift + R）', 'err', 4200);
                    return;
                }
                if (job) { UI.toast('上一张图还在生成中，请稍候', 'err'); return; }
                if (!AI.isConfigured()) {
                    els.setup.hidden = false;
                    els.gen.hidden = true;
                    UI.toast('请先在「设置 → AI 生成」里填写 API Key', 'err', 3600);
                    return;
                }

                var token = {
                    cancelled: false,
                    ctrl: global.AbortController ? new global.AbortController() : null,
                    rec: rec
                };
                job = token;
                els.setup.hidden = true;
                els.gen.hidden = false;
                els.genTitle.textContent = '正在生成文章…';
                els.genNote.textContent = stageText('prepare', rec);
                els.genCancel.textContent = '取消';

                AI.imageToArticle({
                    imageId: rec.id,
                    imageName: rec.name,
                    signal: token.ctrl ? token.ctrl.signal : undefined,
                    onStage: function (name) {
                        if (job === token) els.genNote.textContent = stageText(name, rec);
                    }
                }).then(function (out) {
                    if (token.cancelled || !out) return null;
                    return Store.saveArticle(out.article).then(function (saved) {
                        if (token.cancelled) return null;
                        var id = (saved && saved.id) || out.article.id;
                        UI.toast('已生成草稿《' + out.article.title + '》，正在打开编辑器…', 'ok', 2600);
                        job = null;
                        setTimeout(function () { ctx.openEditor(id); }, 240);
                        return null;
                    });
                }).catch(function (err) {
                    if (token.cancelled) return;
                    job = null;
                    els.genTitle.textContent = '生成失败';
                    els.genNote.textContent = (err && err.message) || '生成失败，请稍后重试。';
                    els.genCancel.textContent = '关闭';
                });
            }

            els.genCancel.addEventListener('click', function () {
                if (job) {
                    job.cancelled = true;
                    if (job.ctrl) job.ctrl.abort();
                    UI.toast('已取消生成', 'ok');
                }
                resetPanel();
            });

            els.toSettings.addEventListener('click', function () {
                els.setup.hidden = true;
                ctx.go('settings');
            });

            // 头部入口只负责把图片收进本地图库，绝不顺手转文章：
            // 生成必须是用户在图卡上主动点「一键转文章」，上传就该只是上传。
            els.upload.addEventListener('click', function () {
                els.uploadFile.value = '';
                els.uploadFile.click();
            });

            els.uploadFile.addEventListener('change', function () {
                var f = els.uploadFile.files && els.uploadFile.files[0];
                if (!f) return;
                if (!AI) { UI.toast('AI 模块未加载，请强制刷新页面（Ctrl + Shift + R）', 'err', 4200); return; }
                AI.saveImageFile(f).then(function (rec) {
                    // 本地入列而不是整页刷新：刷新会把正在跑的生成状态一起冲掉
                    st.images.push(rec);
                    st.imageBytes += rec.size || 0;
                    render();
                    UI.toast('已上传「' + rec.name + '」，需要写稿就点它的「一键转文章」', 'ok', 3600);
                }).catch(function (err) {
                    UI.toast((err && err.message) || '图片保存失败', 'err', 4200);
                });
            });

            function current() {
                var q = prefs.q.trim().toLowerCase();
                var list = st.images.filter(function (r) {
                    var n = (usage[r.id] || []).length;
                    if (prefs.filter === 'used' && n === 0) return false;
                    if (prefs.filter === 'orphan' && n > 0) return false;
                    if (q && String(r.name || '').toLowerCase().indexOf(q) === -1) return false;
                    return true;
                });
                list.sort(function (x, y) {
                    if (prefs.sort === 'size') return (y.size || 0) - (x.size || 0);
                    if (prefs.sort === 'name') return String(x.name).localeCompare(String(y.name), 'zh-Hans-CN');
                    return String(y.createdAt).localeCompare(String(x.createdAt));
                });
                return list;
            }

            function render() {
                var list = current();
                els.grid.innerHTML = list.map(function (r) { return cardHTML(r, usage); }).join('');
                els.empty.hidden = list.length > 0;
                els.emptyText.textContent = st.images.length
                    ? '没有匹配的图片，换个条件试试。'
                    : '还没有本地图片，点上面的「上传图片」选一张吧。';
                els.count.textContent = '共 ' + st.images.length + ' 张，当前 ' + list.length + ' 张';
                hydrate(els.grid);
            }

            var timer = 0;
            els.search.addEventListener('input', function () {
                clearTimeout(timer);
                timer = setTimeout(function () { prefs.q = els.search.value; render(); }, 120);
            });
            els.filter.addEventListener('change', function () { prefs.filter = els.filter.value; render(); });
            els.sort.addEventListener('change', function () { prefs.sort = els.sort.value; render(); });

            els.grid.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-act]');
                if (!btn) return;
                var card = e.target.closest('.thumb-card');
                var id = card && card.getAttribute('data-id');
                var rec = st.images.filter(function (r) { return r.id === id; })[0];
                if (!rec) return;
                var act = btn.getAttribute('data-act');

                if (act === 'gen') { start(rec); return; }
                if (act === 'ref') { A.copyText('img://' + rec.id, '已复制 img://' + rec.id); return; }
                if (act === 'down') { Store.download(rec.name || (rec.id + '.png'), rec.blob, rec.type); return; }
                if (act === 'view') {
                    var url = Store.imageURLCached(rec.id) || '';
                    var img = document.createElement('img');
                    img.className = 'thumb-preview';
                    img.alt = rec.name || '';
                    if (url) img.src = url;
                    else Store.imageURL(rec.id).then(function (u) { if (u) img.src = u; });
                    UI.dialog({
                        title: rec.name || rec.id,
                        body: img,
                        width: '720px',
                        actions: [{ label: '关闭', value: true, primary: true }]
                    });
                    return;
                }
                if (act === 'del') {
                    var refs = usage[rec.id] || [];
                    UI.confirm('删除图片', '「' + rec.name + '」将从本地库删除，无法撤销。' +
                        (refs.length ? '注意：仍有 ' + refs.length + ' 篇文章引用它，删除后正文里会显示为缺失图片。' : ''),
                        '确认删除').then(function (yes) {
                        if (!yes) return;
                        Store.deleteImage(rec.id).then(function () {
                            UI.toast('已删除图片', 'ok');
                            return ctx.refresh();
                        });
                    });
                }
            });

            render();
        }
    });

    function opt(value, label, cur) {
        return '<option value="' + value + '"' + (value === cur ? ' selected' : '') + '>' + label + '</option>';
    }
})(window);
