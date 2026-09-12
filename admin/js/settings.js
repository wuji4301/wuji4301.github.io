/* ==========================================================================
   无极博客 · 后台视图：设置（admin/js/settings.js）
   —— AI 生成 / 外观 / 存储概览 / 运行环境 / 数据维护
   ========================================================================== */
(function (global) {
    'use strict';

    var A = global.WJAdmin;
    var Store = A.Store;
    var UI = A.UI;
    var esc = A.esc;
    var AI = global.WJAI;

    function savedTheme() {
        try { return localStorage.getItem('wj-theme') || 'system'; } catch (e) { return 'system'; }
    }

    function applyTheme(mode) {
        try {
            if (mode === 'system') localStorage.removeItem('wj-theme');
            else localStorage.setItem('wj-theme', mode);
        } catch (e) { void e; }
        var dark = mode === 'system'
            ? global.matchMedia('(prefers-color-scheme: dark)').matches
            : mode === 'dark';
        var t = dark ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', t);
        var btn = document.getElementById('themeToggle');
        if (btn) btn.textContent = t === 'dark' ? '\u263E' : '\u2600\uFE0E';
    }

    function row(k, v) {
        return '<li class="health-item"><span class="t">' + esc(k) + '</span><span class="v">' + v + '</span></li>';
    }

    /** 「AI 生成」区块：图片一键转文章要用到的 Key / 模型 / 地址 */
    function aiSectionHTML() {
        var cfg = AI.readConfig();
        return '<section class="admin-section">' +
            '<header><div><h2>AI 生成</h2>' +
            '<div class="sub">用 DeepSeek V4.1（<code>deepseek-flash</code>，原生多模态）把图片写成文章草稿。' +
            '配置只存在本机浏览器，不上传、不部署。</div></div>' +
            '<div class="admin-actions"><span class="badge ' + (cfg.apiKey ? 'badge-repo' : 'badge-draft') + '" data-role="ai-badge">' +
            (cfg.apiKey ? '已配置 · ' + esc(AI.maskKey(cfg.apiKey)) : '未配置') + '</span></div></header>' +
            '<div class="body">' +
            '<div class="field"><label for="aiKey">API Key</label>' +
            '<input class="input" id="aiKey" data-role="ai-key" type="password" autocomplete="off" spellcheck="false" ' +
            'placeholder="sk-…" value="' + esc(cfg.apiKey) + '" />' +
            '<p class="admin-hint">在 <code>platform.deepseek.com</code> 创建，只有本机 <code>localStorage</code> 里有它；' +
            '浏览器直连官方接口，必须像其他 Key 一样自己保管好。</p></div>' +
            '<div class="ai-grid">' +
            '<div class="field"><label for="aiModel">模型</label>' +
            '<select class="select" id="aiModel" data-role="ai-model">' +
            AI.MODELS.map(function (m) {
                return '<option value="' + esc(m.value) + '"' + (m.value === cfg.model ? ' selected' : '') + '>' + esc(m.label) + '</option>';
            }).join('') +
            '</select></div>' +
            '<div class="field"><label for="aiBase">服务地址</label>' +
            '<input class="input" id="aiBase" data-role="ai-base" type="url" autocomplete="off" spellcheck="false" ' +
            'placeholder="' + esc(AI.DEFAULTS.baseUrl) + '" value="' + esc(cfg.baseUrl) + '" />' +
            '<p class="admin-hint">自建网关或中转时才需要改，默认走官方地址。</p></div>' +
            '</div>' +
            '<div class="admin-actions">' +
            '<button class="btn btn-primary btn-sm" data-role="ai-save" type="button">保存配置</button>' +
            '<button class="btn btn-ghost btn-sm" data-role="ai-test" type="button">测试连接</button>' +
            '<button class="btn btn-ghost btn-sm" data-role="ai-clear" type="button">清除 Key</button>' +
            '<a class="btn btn-ghost btn-sm" href="#/images">去图片库生成</a>' +
            '</div>' +
            '<p class="admin-hint" data-role="ai-state">图片库里的每张图都能一键变成草稿：AI 把图片内容 1:1 转写成标题、摘要、标签与正文，配图自动放在正文开头。</p>' +
            '</div>' +
            '</section>';
    }

    /** 接线「AI 生成」区块：保存 / 测试 / 清除，状态就地反馈，避免整页重绘丢输入 */
    function wireAI(root) {
        var els = {
            key: root.querySelector('[data-role="ai-key"]'),
            model: root.querySelector('[data-role="ai-model"]'),
            base: root.querySelector('[data-role="ai-base"]'),
            badge: root.querySelector('[data-role="ai-badge"]'),
            state: root.querySelector('[data-role="ai-state"]')
        };
        if (!els.key || !AI) return;

        function paint(cfg) {
            var configured = !!cfg.apiKey;
            els.badge.className = 'badge ' + (configured ? 'badge-repo' : 'badge-draft');
            els.badge.textContent = configured ? '已配置 · ' + AI.maskKey(cfg.apiKey) : '未配置';
        }

        function readForm() {
            return {
                apiKey: els.key.value.trim(),
                model: els.model.value,
                baseUrl: els.base.value.trim() || AI.DEFAULTS.baseUrl
            };
        }

        function save(quiet) {
            var cfg = AI.writeConfig(readForm());
            els.base.value = cfg.baseUrl;
            paint(cfg);
            if (!quiet) UI.toast('AI 配置已保存到本机浏览器', 'ok');
            return cfg;
        }

        els.key.addEventListener('change', function () { save(true); });
        els.model.addEventListener('change', function () { save(true); });
        els.base.addEventListener('change', function () { save(true); });

        root.querySelector('[data-role="ai-save"]').addEventListener('click', function () { save(false); });

        root.querySelector('[data-role="ai-clear"]').addEventListener('click', function () {
            UI.confirm('清除 API Key', '清除后「图片转文章」会停止工作，需要重新填写 Key 才能继续。', '确认清除')
                .then(function (yes) {
                    if (!yes) return;
                    AI.clearConfig();
                    els.key.value = '';
                    els.base.value = AI.DEFAULTS.baseUrl;
                    els.model.value = AI.DEFAULTS.model;
                    paint(AI.readConfig());
                    els.state.textContent = '已清除本机保存的 AI 配置。';
                    UI.toast('已清除 AI 配置', 'ok');
                });
        });

        root.querySelector('[data-role="ai-test"]').addEventListener('click', function (e) {
            var btn = e.currentTarget;
            save(true);
            if (!AI.isConfigured()) {
                UI.toast('请先填写 API Key', 'err');
                els.key.focus();
                return;
            }
            btn.disabled = true;
            els.state.textContent = '正在连接 ' + AI.readConfig().baseUrl + ' …';
            AI.testConnection().then(function (out) {
                els.state.textContent = '连接正常：' + out.model + '，往返 ' + out.ms + ' ms。';
                UI.toast('DeepSeek 连接正常', 'ok');
            }).catch(function (err) {
                els.state.textContent = err.message;
                UI.toast(err.message, 'err', 5000);
            }).then(function () { btn.disabled = false; });
        });

        paint(AI.readConfig());
    }

    A.register('settings', {
        title: '设置',
        sub: '外观、存储与数据维护',
        mount: function (root, ctx) {
            var st = ctx.state;
            var mode = savedTheme();
            var embedded = (global.WJ_ARTICLES && (Array.isArray(global.WJ_ARTICLES)
                ? global.WJ_ARTICLES.length
                : (global.WJ_ARTICLES.articles || []).length)) || 0;

            function themeBtn(value, label) {
                return '<button class="seg-btn' + (mode === value ? ' active' : '') + '" data-theme-mode="' + value + '" type="button">' +
                    esc(label) + '</button>';
            }

            root.innerHTML =
                '<div class="admin-split">' +
                '<section class="admin-section">' +
                '<header><div><h2>外观</h2><div class="sub">主题与显示偏好，保存在本机浏览器。</div></div></header>' +
                '<div class="body">' +
                '<div class="field"><label>主题</label>' +
                '<div class="seg" data-role="theme">' +
                themeBtn('system', '跟随系统') + themeBtn('light', '浅色') + themeBtn('dark', '深色') +
                '</div></div>' +
                '<p class="admin-hint">选择「跟随系统」后，系统切换深浅色时页面会自动同步。</p>' +
                '</div>' +
                '</section>' +

                '<section class="admin-section">' +
                '<header><div><h2>存储概览</h2><div class="sub">当前浏览器 IndexedDB 里的本地数据。</div></div>' +
                '<div class="admin-actions"><button class="btn btn-ghost btn-sm" data-role="refresh" type="button">刷新数据</button></div></header>' +
                '<div class="body"><ul class="health-list">' +
                row('本地文章', st.local.length + ' 篇') +
                row('已发布 / 草稿', st.local.filter(function (a) { return a.status === 'published'; }).length +
                    ' / ' + st.local.filter(function (a) { return a.status !== 'published'; }).length) +
                row('本地图片', st.images.length + ' 张') +
                row('图片占用', UI.fmtBytes(st.imageBytes)) +
                row('线上文章', st.repoCount + ' 篇') +
                row('本地覆盖线上', st.overrides + ' 篇') +
                row('待同步删除', (st.deleted || []).length + ' 篇') +
                '</ul></div>' +
                '</section>' +
                '</div>' +

                aiSectionHTML() +

                '<section class="admin-section">' +
                '<header><div><h2>运行环境</h2><div class="sub">用于排查「为什么读不到文章」之类的问题。</div></div></header>' +
                '<div class="body"><ul class="health-list">' +
                row('打开方式', Store.isFileProtocol() ? '<code>file://</code>（读取嵌入式数据）' : '<code>' + esc(location.protocol) + '</code>（优先 fetch）') +
                row('资源基路径', '<code>' + esc(Store.basePrefix() || './') + '</code>') +
                row('嵌入式文章', embedded + ' 篇（articles-data.js）') +
                row('IndexedDB', global.indexedDB ? '可用' : '不可用（浏览器不支持）') +
                '</ul></div>' +
                '</section>' +

                '<section class="admin-section">' +
                '<header><div><h2>数据维护</h2><div class="sub">危险操作，请谨慎执行。</div></div></header>' +
                '<div class="body">' +
                '<div class="danger-zone">' +
                '<div class="grow"><div class="t">清空本地数据</div>' +
                '<div class="d">删除本浏览器里保存的全部本地文章、图片与元信息，无法撤销。待同步的删除标记也会一并清掉（被删的线上文章会重新出现）；已经落地到仓库的改动不受影响。</div></div>' +
                '<button class="btn btn-danger" data-role="wipe" type="button">清空</button>' +
                '</div>' +
                '</div>' +
                '</section>' +

                '<div class="notice"><div>' +
                '隔离说明：<code>admin/</code> 与 <code>tools/</code> 不在任何公开页面的导航里，' +
                '部署工具只拷贝白名单文件；线上并不存在这两个目录，因此无需把它当成安全措施。' +
                '</div></div>';

            var themeWrap = root.querySelector('[data-role="theme"]');
            themeWrap.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-theme-mode]');
                if (!btn) return;
                mode = btn.getAttribute('data-theme-mode');
                applyTheme(mode);
                Array.prototype.forEach.call(themeWrap.querySelectorAll('.seg-btn'), function (b) {
                    b.classList.toggle('active', b === btn);
                });
                UI.toast('已切换主题', 'ok');
            });

            root.querySelector('[data-role="refresh"]').addEventListener('click', function () {
                ctx.refresh({ toast: '数据已刷新' });
            });

            wireAI(root);

            root.querySelector('[data-role="wipe"]').addEventListener('click', function () {
                UI.confirm('清空本地数据', '会删除本浏览器里保存的全部本地文章与图片，无法撤销。仓库里的文章不受影响。', '确认清空')
                    .then(function (yes) {
                        if (!yes) return;
                        return Store.wipe().then(function () { return ctx.refresh(); }).then(function () {
                            UI.toast('本地数据已清空', 'ok');
                        });
                    });
            });
        }
    });
})(window);
