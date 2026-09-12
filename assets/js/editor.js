/* ==========================================================================
   无极博客 · 文章编辑器
   --------------------------------------------------------------------------
   两种编辑模式（同一份 Markdown 为唯一真源）：
     · 富文本：contenteditable，工具栏操作，所见即所得
     · 源码  ：直接编辑 Markdown，适合精确控制
   公式、代码块、表格、图片都有专门的插入入口；图片转存 IndexedDB 并以
   img://<id> 引用，正文因此保持纯文本、可 diff、可导出。
   ========================================================================== */
(function (global) {
    'use strict';

    var Store = global.WJStore;
    var CV = global.WJConvert;
    var MD = global.WJMarkdown;

    var TOOLBAR = [
        { cmd: 'h1', label: 'H1', title: '一级标题' },
        { cmd: 'h2', label: 'H2', title: '二级标题' },
        { cmd: 'h3', label: 'H3', title: '三级标题' },
        { sep: 1 },
        { cmd: 'bold', label: 'B', title: '粗体 (Ctrl+B)', strong: 1 },
        { cmd: 'italic', label: 'I', title: '斜体 (Ctrl+I)', em: 1 },
        { cmd: 'strike', label: 'S', title: '删除线', del: 1 },
        { cmd: 'code', label: '<>', title: '行内代码 (Ctrl+E)' },
        { sep: 1 },
        { cmd: 'ul', label: '•≡', title: '无序列表' },
        { cmd: 'ol', label: '1≡', title: '有序列表' },
        { cmd: 'task', label: '☑', title: '任务列表' },
        { cmd: 'quote', label: '❝', title: '引用' },
        { cmd: 'hr', label: '—', title: '分割线' },
        { sep: 1 },
        { cmd: 'link', label: '链', title: '链接 (Ctrl+K)' },
        { cmd: 'image', label: '图', title: '插入图片' },
        { cmd: 'math', label: '∑', title: '插入公式' },
        { cmd: 'table', label: '▦', title: '插入表格' },
        { cmd: 'codeblock', label: '{ }', title: '代码块' }
    ];

    var MATH_SYMBOLS = [
        ['\\frac{a}{b}', '分式'], ['\\sqrt{x}', '根号'], ['x^{2}', '上标'],
        ['x_{i}', '下标'], ['\\sum_{i=1}^{n}', '求和'], ['\\prod_{i=1}^{n}', '连乘'],
        ['\\int_{a}^{b}', '积分'], ['\\lim_{x \\to 0}', '极限'], ['\\partial', '偏导'],
        ['\\nabla', '梯度'], ['\\infty', '无穷'], ['\\alpha', 'α'],
        ['\\beta', 'β'], ['\\gamma', 'γ'], ['\\theta', 'θ'], ['\\lambda', 'λ'],
        ['\\mu', 'μ'], ['\\pi', 'π'], ['\\sigma', 'σ'], ['\\phi', 'φ'],
        ['\\omega', 'ω'], ['\\Delta', 'Δ'], ['\\Omega', 'Ω'], ['\\times', '×'],
        ['\\cdot', '·'], ['\\pm', '±'], ['\\leq', '≤'], ['\\geq', '≥'],
        ['\\neq', '≠'], ['\\approx', '≈'], ['\\in', '∈'], ['\\subset', '⊂'],
        ['\\cup', '∪'], ['\\cap', '∩'], ['\\forall', '∀'], ['\\exists', '∃'],
        ['\\rightarrow', '→'], ['\\Rightarrow', '⇒'], ['\\leftrightarrow', '↔'],
        ['\\begin{cases} a & x>0 \\\\ b & x\\le 0 \\end{cases}', '分段'],
        ['\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', '矩阵'],
        ['\\vec{v}', '向量'], ['\\bar{x}', '均值'], ['\\hat{x}', '估计'],
        ['\\binom{n}{k}', '组合'], ['\\log_{a} b', '对数'], ['\\sin', 'sin'],
        ['\\cos', 'cos'], ['\\tan', 'tan'], ['\\quad', '空格']
    ];

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }

    /**
     * normalize() 会给没有标题的文章补上占位标题。它不是用户输入，不该填进标题框
     * 冒充已填内容；与 collect() 的兜底同源，日后改 normalize 也无需同步这里。
     * 延迟取值：editor.js 不因此多出一条"必须在 store.js 之后加载"的要求。
     */
    var _placeholderTitle = null;
    function placeholderTitle() {
        if (_placeholderTitle == null) _placeholderTitle = Store.normalize({}).title;
        return _placeholderTitle;
    }

    function Editor(host, options) {
        this.host = host;
        this.options = options || {};
        this.article = Store.normalize(this.options.article || {});
        this.mode = 'rich';
        this.blobMap = {};          // blob: URL -> 'img://id'
        this.newImages = [];        // 本次会话新增的图片记录
        this.dirty = false;
        this.autoTimer = 0;
        this.previewTimer = 0;
        this._render();
        this._wire();
        this.load(this.article);
    }

    Editor.prototype._render = function () {
        var self = this;
        this.host.innerHTML = [
            '<div class="editor-shell">',
            '  <aside class="editor-side">',
            '    <div class="side-block">',
            '      <div class="side-title">文章信息</div>',
            '      <div class="field"><label for="ed-title">标题</label>',
            '        <input class="input" id="ed-title" placeholder="给文章起个标题" maxlength="120"></div>',
            '      <div class="field"><label for="ed-summary">摘要</label>',
            '        <textarea class="textarea" id="ed-summary" rows="3" placeholder="列表页显示的简介（留空则自动截取正文）"></textarea></div>',
            '      <div class="field"><label for="ed-tags">标签</label>',
            '        <input class="input" id="ed-tags" placeholder="用逗号分隔，如：算法, 笔记"></div>',
            '      <div class="field"><label for="ed-cover">封面图链接（可选）</label>',
            '        <input class="input" id="ed-cover" placeholder="articles/img/xxx.png 或 img://图片id"></div>',
            '    </div>',
            '    <div class="side-block">',
            '      <div class="side-title">发布设置</div>',
            '      <div class="field"><label for="ed-status">状态</label>',
            '        <select class="select" id="ed-status">',
            '          <option value="draft">草稿（不在列表页公开展示的标记）</option>',
            '          <option value="published">已发布</option>',
            '        </select></div>',
            '      <label class="check"><input type="checkbox" id="ed-pinned"> 置顶到列表最前</label>',
            '    </div>',
            '    <div class="side-block side-stats" id="ed-stats"></div>',
            '  </aside>',
            '  <main class="editor-main">',
            '    <div class="editor-bar">',
            '      <div class="toolbar" id="ed-toolbar" role="toolbar" aria-label="格式工具栏"></div>',
            '    </div>',
            '    <div class="editor-tabs" role="tablist">',
            '      <button type="button" class="etab active" data-mode="rich" role="tab">富文本</button>',
            '      <button type="button" class="etab" data-mode="source" role="tab">Markdown 源码</button>',
            '      <span class="editor-hint" id="ed-hint">所见即所得 · 公式与图片可直接插入</span>',
            '    </div>',
            '    <div class="editor-panes">',
            '      <div class="editing rich-pane" id="ed-rich-pane">',
            '        <div class="wj-editor" id="ed-rich" contenteditable="true" spellcheck="false"',
            '             role="textbox" aria-multiline="true" aria-label="正文编辑区"></div>',
            '      </div>',
            '      <div class="editing source-pane" id="ed-source-pane" hidden>',
            '        <textarea class="md-source" id="ed-source" spellcheck="false" aria-label="Markdown 源码"></textarea>',
            '      </div>',
            '    </div>',
            '    <div class="editor-foot">',
            '      <span class="foot-status" id="ed-save-state">就绪</span>',
            '      <span class="foot-sep">·</span>',
            '      <span id="ed-meta-line">新文章</span>',
            '    </div>',
            '  </main>',
            '</div>',
            '<input type="file" id="ed-file" accept="image/*" multiple hidden>'
        ].join('\n');

        this.$ = {
            title: this.host.querySelector('#ed-title'),
            summary: this.host.querySelector('#ed-summary'),
            tags: this.host.querySelector('#ed-tags'),
            cover: this.host.querySelector('#ed-cover'),
            status: this.host.querySelector('#ed-status'),
            pinned: this.host.querySelector('#ed-pinned'),
            toolbar: this.host.querySelector('#ed-toolbar'),
            rich: this.host.querySelector('#ed-rich'),
            source: this.host.querySelector('#ed-source'),
            file: this.host.querySelector('#ed-file'),
            saveState: this.host.querySelector('#ed-save-state'),
            metaLine: this.host.querySelector('#ed-meta-line'),
            stats: this.host.querySelector('#ed-stats'),
            hint: this.host.querySelector('#ed-hint'),
            richPane: this.host.querySelector('#ed-rich-pane'),
            sourcePane: this.host.querySelector('#ed-source-pane')
        };

        // 工具栏按钮
        TOOLBAR.forEach(function (t) {
            if (t.sep) { self.$.toolbar.appendChild(el('span', 'tb-sep')); return; }
            var b = el('button', 'tb-btn', t.label);
            b.type = 'button';
            b.title = t.title;
            b.dataset.cmd = t.cmd;
            if (t.strong) b.classList.add('tb-strong');
            if (t.em) b.classList.add('tb-em');
            if (t.del) b.classList.add('tb-del');
            self.$.toolbar.appendChild(b);
        });
    };

    /* --------------------------------------------------------------- 载入 */

    Editor.prototype.load = function (article) {
        this.article = Store.normalize(article || {});
        var a = this.article;
        // 占位标题不进输入框（见 placeholderTitle）；其余情况一律原样回填 ——
        // 尤其是"标题已填、正文还空着"的草稿，清空标题会让下一次自动保存把它覆盖掉。
        this.$.title.value = a.title === placeholderTitle() ? '' : a.title;
        this.$.summary.value = a.summary || '';
        this.$.tags.value = (a.tags || []).join(', ');
        this.$.cover.value = a.cover || '';
        this.$.status.value = a.status;
        this.$.pinned.checked = !!a.pinned;

        var md = a.format === 'html' ? CV.htmlToMd(this._htmlBox(a.body)) : a.body;
        this.$.source.value = md;
        this.setEditorHtml(CV.mdToEditorHtml(md));
        this.preview();
        this.updateStats();
        this.markSaved();
        this.updateMetaLine();
    };

    /** 把 HTML 正文包进一个游离容器，便于走统一的 DOM 转换 */
    Editor.prototype._htmlBox = function (html) {
        var d = document.createElement('div');
        d.innerHTML = html || '';
        return d;
    };

    /* --------------------------------------------------------- 编辑区同步 */

    Editor.prototype.setEditorHtml = function (html) {
        this.$.rich.innerHTML = html || '<p><br></p>';
        this.mode = 'rich';
        this.applyMode();
        this.hydrateLocalImages();
    };

    /**
     * 把编辑区里 `img://<id>` 的引用换成 blob: URL 显示（载入已有文章时本地图片不再裂图）。
     * 必须同时登记 blob → `img://<id>` 映射，否则保存时 htmlToMd 会把未映射的 blob 写成空
     * `![]()`（丢图），registerImages 还会把同一张图当新图重新入库（产生重复记录）。
     */
    Editor.prototype.hydrateLocalImages = function () {
        var self = this;
        if (!this.$.rich) return;
        Array.prototype.forEach.call(this.$.rich.querySelectorAll('img[src^="img://"]'), function (img) {
            var id = img.getAttribute('src').slice(6);
            if (!id) return;
            var cached = Store.imageURLCached(id);
            if (cached) { self.blobMap[cached] = 'img://' + id; img.setAttribute('src', cached); return; }
            Store.imageURL(id).then(function (url) {
                if (!url) return;
                self.blobMap[url] = 'img://' + id;
                img.setAttribute('src', url);
            });
        });
    };

    Editor.prototype.applyMode = function () {
        var rich = this.mode === 'rich';
        this.$.richPane.hidden = !rich;
        this.$.sourcePane.hidden = rich;
        this.$.toolbar.dataset.disabled = rich ? '' : '1';
        Array.prototype.forEach.call(this.$.toolbar.querySelectorAll('.tb-btn'), function (b) {
            b.disabled = !rich;
        });
        this.$.hint.textContent = rich
            ? '所见即所得 · 公式与图片可直接插入'
            : 'Markdown 源码 · 切换回富文本会自动解析渲染';
        var tabs = this.host.querySelectorAll('.etab');
        Array.prototype.forEach.call(tabs, function (t) {
            t.classList.toggle('active', t.dataset.mode === this.mode);
        }, this);
        if (!rich) this.$.source.focus();
    };

    /** 取回当前正文的真实 Markdown（同时登记图片） */
    Editor.prototype.getMarkdown = function () {
        var md;
        if (this.mode === 'rich') {
            this.registerImages();
            md = CV.htmlToMd(this.$.rich, { blobMap: this.blobMap });
        } else {
            md = this.$.source.value;
        }
        return md;
    };

    Editor.prototype.switchMode = function (mode) {
        if (mode === this.mode) return;
        if (mode === 'source') {
            this.$.source.value = this.getMarkdown();
            this.mode = 'source';
        } else {
            this.setEditorHtml(CV.mdToEditorHtml(this.$.source.value));
            this.preview();
        }
        this.applyMode();
    };

    /* --------------------------------------------------------------- 图片 */

    /**
     * 把编辑区里 blob: 图片转存 IndexedDB，并登记 blob → img://id 映射。
     * 未登记的 blob（极少数异常来源）转成 data: URL 内联，保证内容不丢。
     */
    Editor.prototype.registerImages = function () {
        var self = this;
        var imgs = Array.prototype.slice.call(this.$.rich.querySelectorAll('img'));
        return Promise.all(imgs.map(function (img) {
            return self._registerOne(img);
        }));
    };

    Editor.prototype._registerOne = function (img) {
        var self = this;
        var src = img.getAttribute('src') || '';
        if (!src) return Promise.resolve();
        if (this.blobMap[src]) return Promise.resolve();
        if (src.indexOf('blob:') !== 0) return Promise.resolve();   // 已是仓库路径/外链/已有引用

        return fetch(src).then(function (r) { return r.blob(); }).then(function (blob) {
            var rec = self._makeImageRecord(blob, img);
            return Store.addImage(blob, rec).then(function (saved) {
                self.blobMap[src] = 'img://' + saved.id;
                self.newImages.push(saved);
                img.setAttribute('src', 'img://' + saved.id);
            });
        }).catch(function () {
            // 兜底：转 data URL，至少不让文章缺图
            return toDataURL(src).then(function (dataUrl) {
                if (dataUrl) {
                    img.setAttribute('src', dataUrl);
                    self.blobMap[dataUrl] = dataUrl;
                }
            }).catch(function () { /* 彻底失败则保留原样 */ });
        });
    };

    Editor.prototype._makeImageRecord = function (blob, img) {
        var id = Store.genId('img');
        var ext = extOf(blob.type, img && img.getAttribute('data-name'));
        return {
            id: id,
            name: id + '.' + ext,
            type: blob.type || 'image/png',
            width: img ? (img.naturalWidth || 0) : 0,
            height: img ? (img.naturalHeight || 0) : 0
        };
    };

    var SAFE_IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml)$/i;
    var MAX_IMAGE_BYTES = 8 * 1024 * 1024;

    Editor.prototype.insertImageFiles = function (files) {
        var self = this;
        var list = Array.prototype.slice.call(files || []).filter(function (f) {
            return /^image\//.test(f.type);
        });
        if (!list.length) return Promise.resolve(0);
        var rejected = [];
        var chain = Promise.resolve();
        var inserted = 0;

        list.forEach(function (f) {
            chain = chain.then(function () {
                // 只接受浏览器能安全解码的常见位图/矢量类型，避免把可执行内容当图片存下来
                var type = SAFE_IMAGE_TYPES.test(f.type) ? f.type : 'image/png';
                var safe = type === f.type ? f : new File([f], f.name, { type: type });
                if (f.size > MAX_IMAGE_BYTES) { rejected.push(f.name + '（超过 8MB）'); return; }
                return Store.addImage(safe, {
                    id: Store.genId('img'),
                    name: f.name,
                    type: type
                }).then(function (rec) {
                    self.newImages.push(rec);
                    var ref = 'img://' + rec.id;
                    return Store.imageURL(rec.id).then(function (u) {
                        var real = u || Store.imageURLCached(rec.id);
                        if (real) self.blobMap[real] = ref;
                        self._insertHtml('<img src="' + esc(real) + '" alt="' + esc(baseName(f.name)) + '" data-img-id="' + esc(rec.id) + '">');
                        inserted++;
                        self.preview();
                        self.scheduleSave();
                    });
                });
            });
        });

        return chain.then(function () {
            if (rejected.length) WJUI.toast('已跳过：' + rejected.join('、'), 'err', 4200);
            return inserted;
        });
    };

    /* ------------------------------------------------------------ 工具栏 */

    Editor.prototype._wire = function () {
        var self = this;

        // 元信息
        ['title', 'summary', 'tags', 'cover'].forEach(function (k) {
            self.$[k].addEventListener('input', function () { self.onInput(); });
        });
        self.$.status.addEventListener('change', function () { self.onInput(); });
        self.$.pinned.addEventListener('change', function () { self.onInput(); });

        // 模式切换
        Array.prototype.forEach.call(this.host.querySelectorAll('.etab'), function (t) {
            t.addEventListener('click', function () { self.switchMode(t.dataset.mode); });
        });

        // 正文输入
        this.$.rich.addEventListener('input', function () { self.onInput(); });
        this.$.rich.addEventListener('keyup', function () { self.refreshToolbar(); });
        this.$.rich.addEventListener('mouseup', function () { self.refreshToolbar(); });
        this.$.rich.addEventListener('blur', function () { self.refreshToolbar(); });
        this.$.source.addEventListener('input', function () { self.onInput(); });
        this.$.source.addEventListener('blur', function () { self.preview(); });

        // 工具栏点击
        this.$.toolbar.addEventListener('mousedown', function (e) {
            if (e.target.closest('.tb-btn')) e.preventDefault();   // 保住选区
        });
        this.$.toolbar.addEventListener('click', function (e) {
            var b = e.target.closest('.tb-btn');
            if (b) self.exec(b.dataset.cmd);
        });

        // 快捷键
        this.$.rich.addEventListener('keydown', function (e) { self.onKeydown(e); });
        this.$.source.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); self.save(); }
            if (e.key === 'Tab') { e.preventDefault(); softTab(self.$.source); }
        });

        // 粘贴 / 拖放
        this.$.rich.addEventListener('paste', function (e) { self.onPaste(e); });
        this.$.rich.addEventListener('drop', function (e) { self.onDrop(e); });
        this.$.rich.addEventListener('dragover', function (e) {
            if (e.dataTransfer && Array.prototype.some.call(e.dataTransfer.types || [], function (t) { return t === 'Files'; })) {
                e.preventDefault();
            }
        });

        // 图片选择
        this.$.file.addEventListener('change', function () {
            var files = self.$.file.files;
            self._rememberSelection();
            self.insertImageFiles(files).then(function (n) {
                self.$.file.value = '';
                if (n) { WJUI.toast('已插入 ' + n + ' 张图片', 'ok'); self._restoreSelection(); }
            });
        });

        // 公式 / 图片点击编辑
        this.$.rich.addEventListener('click', function (e) {
            var tex = e.target.closest('.math-tex');
            if (tex) { e.preventDefault(); self.editMath(tex); return; }
            var img = e.target.closest('img');
            if (img && (e.altKey || e.ctrlKey || e.metaKey)) { e.preventDefault(); self.imageMenu(img); }
        });

        // 标题快捷键存盘
        this.$.title.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); self.save(); }
        });

        // 离开页面提示
        window.addEventListener('beforeunload', function (e) {
            if (self.dirty) { e.preventDefault(); e.returnValue = ''; }
        });
    };

    /** 选区可能因打开文件对话框而丢失，先存下来 */
    Editor.prototype._rememberSelection = function () {
        var sel = window.getSelection();
        if (sel && sel.rangeCount && this.$.rich.contains(sel.anchorNode)) {
            this._savedRange = sel.getRangeAt(0).cloneRange();
        }
    };

    Editor.prototype._restoreSelection = function () {
        // 没有记录过选区时不要动光标：否则插入图片/公式会把光标拽到别处
        if (!this._savedRange) return;
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(this._savedRange);
    };

    Editor.prototype.onKeydown = function (e) {
        var mod = e.ctrlKey || e.metaKey;
        if (mod && e.key === 's') { e.preventDefault(); this.save(); return; }
        if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); this.exec('bold'); return; }
        if (mod && !e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); this.exec('italic'); return; }
        if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); this.exec('link'); return; }
        if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); this.exec('code'); return; }
        if (e.key === 'Tab') {
            e.preventDefault();
            if (this._inList()) {
                document.execCommand(e.shiftKey ? 'outdent' : 'indent');
            } else {
                document.execCommand('insertText', false, '    ');
            }
            this.onInput();
        }
    };

    Editor.prototype._inList = function () {
        var sel = window.getSelection();
        if (!sel || !sel.rangeCount) return false;
        var n = sel.anchorNode;
        while (n && n !== this.$.rich) {
            if (n.nodeType === 1 && (n.tagName === 'LI' || n.tagName === 'UL' || n.tagName === 'OL')) return true;
            n = n.parentNode;
        }
        return false;
    };

    Editor.prototype.refreshToolbar = function () {
        if (this.mode !== 'rich') return;
        var state = {};
        ['bold', 'italic', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'].forEach(function (c) {
            try { state[c] = document.queryCommandState(c); } catch (e) { state[c] = false; }
        });
        var map = { bold: 'bold', italic: 'italic', strike: 'strikeThrough', ul: 'insertUnorderedList', ol: 'insertOrderedList' };
        var self = this;
        Object.keys(map).forEach(function (cmd) {
            var b = self.$.toolbar.querySelector('[data-cmd="' + cmd + '"]');
            if (b) b.classList.toggle('on', !!state[map[cmd]]);
        });
    };

    /* --------------------------------------------------------- 命令分派 */

    Editor.prototype.exec = function (cmd) {
        var self = this;
        if (this.mode !== 'rich') {
            this._insertSourceSnippet(cmd);
            return;
        }
        this.$.rich.focus();
        switch (cmd) {
            case 'h1': case 'h2': case 'h3':
                document.execCommand('formatBlock', false, cmd.toUpperCase());
                break;
            case 'bold': document.execCommand('bold'); break;
            case 'italic': document.execCommand('italic'); break;
            case 'strike': document.execCommand('strikeThrough'); break;
            case 'code': this._inlineCode(); break;
            case 'ul': document.execCommand('insertUnorderedList'); break;
            case 'ol': document.execCommand('insertOrderedList'); break;
            case 'task': this._insertTaskList(); break;
            case 'quote': document.execCommand('formatBlock', false, 'BLOCKQUOTE'); break;
            case 'hr': document.execCommand('insertHorizontalRule'); break;
            case 'link': this._link(); return;
            case 'image': this._rememberSelection(); this.$.file.click(); return;
            case 'math': this.editMath(null); return;
            case 'table': this._tableDialog(); return;
            case 'codeblock': this._codeBlockDialog(); return;
            default: return;
        }
        this.onInput();
        this.refreshToolbar();
    };

    /** 源码模式下，工具栏按钮退化为"插入 Markdown 片段" */
    Editor.prototype._insertSourceSnippet = function (cmd) {
        var snippets = {
            h1: '# 标题', h2: '## 标题', h3: '### 标题',
            bold: '**粗体**', italic: '*斜体*', strike: '~~删除~~', code: '`代码`',
            ul: '- 列表项', ol: '1. 列表项', task: '- [ ] 待办',
            quote: '> 引用', hr: '---', link: '[文字](https://)',
            image: '![说明](articles/img/图片.png)',
            math: '$$\nE = mc^2\n$$',
            table: '| 列1 | 列2 |\n| --- | --- |\n| a | b |',
            codeblock: '```js\nconsole.log(1);\n```'
        };
        var text = snippets[cmd];
        if (!text) return;
        var ta = this.$.source;
        var s = ta.selectionStart, e = ta.selectionEnd;
        var before = ta.value.slice(0, s), after = ta.value.slice(e);
        var pad = (before && !/\n\n$/.test(before)) ? (/\n$/.test(before) ? '\n' : '\n\n') : '';
        ta.value = before + pad + text + '\n' + after;
        ta.selectionStart = ta.selectionEnd = (before + pad + text).length;
        ta.focus();
        this.onInput();
    };

    Editor.prototype._inlineCode = function () {
        var sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        var text = sel.toString();
        var html = '<code>' + esc(text || '代码') + '</code>';
        if (text) document.execCommand('insertHTML', false, html);
        else document.execCommand('insertHTML', false, '<code>代码</code>');
    };

    Editor.prototype._link = function () {
        var self = this;
        var sel = window.getSelection();
        var text = sel && sel.toString() ? sel.toString() : '';
        var wrap = el('div', 'stack');
        var t = el('div', 'field'); t.appendChild(el('label', '', '显示文字'));
        var ti = el('input', 'input'); ti.value = text; ti.placeholder = '链接文字';
        t.appendChild(ti);
        var u = el('div', 'field'); u.appendChild(el('label', '', '链接地址'));
        var ui = el('input', 'input'); ui.placeholder = 'https://example.com';
        u.appendChild(ui);
        wrap.appendChild(t); wrap.appendChild(u);

        WJUI.dialog({
            title: '插入链接',
            body: wrap,
            actions: [
                { label: '取消', value: false },
                { label: '插入', primary: true, onClick: function () { return true; } }
            ]
        }).then(function (ok) {
            if (ok === false) return;
            var url = (ui.value || '').trim();
            var label = (ti.value || '').trim() || url;
            if (!url) { WJUI.toast('请填写链接地址', 'err'); return; }
            self.$.rich.focus();
            document.execCommand('insertHTML', false,
                '<a href="' + esc(url) + '">' + esc(label) + '</a>');
            self.onInput();
        });
    };

    Editor.prototype._insertTaskList = function () {
        document.execCommand('insertHTML', false,
            '<div class="task-list"><ul>' +
            '<li class="task"><span class="task-box" contenteditable="false" aria-hidden="true"></span>待办事项</li>' +
            '</ul></div>');
    };

    Editor.prototype._tableDialog = function () {
        var self = this;
        var wrap = el('div', 'grid2');
        var r = el('div', 'field'); r.appendChild(el('label', '', '行数（不含表头）'));
        var ri = el('input', 'input'); ri.type = 'number'; ri.min = '1'; ri.max = '50'; ri.value = '3';
        r.appendChild(ri);
        var c = el('div', 'field'); c.appendChild(el('label', '', '列数'));
        var ci = el('input', 'input'); ci.type = 'number'; ci.min = '1'; ci.max = '12'; ci.value = '3';
        c.appendChild(ci);
        wrap.appendChild(r); wrap.appendChild(c);

        WJUI.dialog({
            title: '插入表格',
            body: wrap,
            actions: [
                { label: '取消', value: false },
                { label: '插入', primary: true, onClick: function () { return true; } }
            ]
        }).then(function (ok) {
            if (ok === false) return;
            var rows = Math.max(1, Math.min(50, parseInt(ri.value, 10) || 1));
            var cols = Math.max(1, Math.min(12, parseInt(ci.value, 10) || 1));
            var html = '<table><thead><tr>';
            for (var j = 0; j < cols; j++) html += '<th style="text-align:left">列 ' + (j + 1) + '</th>';
            html += '</tr></thead><tbody>';
            for (var i = 0; i < rows; i++) {
                html += '<tr>';
                for (var k = 0; k < cols; k++) html += '<td style="text-align:left">&nbsp;</td>';
                html += '</tr>';
            }
            html += '</tbody></table>';
            self.$.rich.focus();
            document.execCommand('insertHTML', false, html);
            self.onInput();
            WJUI.toast('表格已插入，直接点击单元格填写', 'ok');
        });
    };

    Editor.prototype._codeBlockDialog = function () {
        var self = this;
        var LANGS = ['text', 'js', 'ts', 'python', 'bash', 'json', 'html', 'css', 'sql', 'yaml', 'java', 'go', 'rust', 'cpp', 'c', 'csharp'];
        var wrap = el('div', 'stack');
        var lf = el('div', 'field'); lf.appendChild(el('label', '', '语言'));
        var sel = el('select', 'select');
        LANGS.forEach(function (l) {
            var o = el('option', '', l); o.value = l; sel.appendChild(o);
        });
        lf.appendChild(sel);
        var cf = el('div', 'field'); cf.appendChild(el('label', '', '代码'));
        var ta = el('textarea', 'textarea code-input');
        ta.rows = 10; ta.placeholder = '在此粘贴代码…'; ta.spellcheck = false;
        cf.appendChild(ta);
        wrap.appendChild(lf); wrap.appendChild(cf);

        WJUI.dialog({
            title: '插入代码块',
            body: wrap,
            width: '680px',
            actions: [
                { label: '取消', value: false },
                { label: '插入', primary: true, onClick: function () { return true; } }
            ]
        }).then(function (ok) {
            if (ok === false) return;
            var code = ta.value || '';
            var lang = sel.value === 'text' ? '' : sel.value;
            self.$.rich.focus();
            document.execCommand('insertHTML', false,
                '<pre><code' + (lang ? ' class="lang-' + esc(lang) + '" data-lang="' + esc(lang) + '"' : '') + '>' +
                esc(code) + '</code></pre><p><br></p>');
            self.onInput();
        });
    };

    /* --------------------------------------------------------- 公式编辑 */

    Editor.prototype.editMath = function (targetEl) {
        var self = this;
        var display = targetEl ? targetEl.classList.contains('math-block') : false;
        var initial = targetEl ? (targetEl.getAttribute('data-tex') || '') : '';

        var wrap = el('div', 'math-editor');
        var modes = el('div', 'seg');
        var bInline = el('button', 'seg-btn' + (display ? '' : ' active'), '行内公式');
        var bBlock = el('button', 'seg-btn' + (display ? ' active' : ''), '独占一行');
        bInline.type = 'button'; bBlock.type = 'button';
        modes.appendChild(bInline); modes.appendChild(bBlock);

        var ta = el('textarea', 'textarea math-input');
        ta.rows = 5;
        ta.value = initial;
        ta.placeholder = '例如：\\frac{a}{b} 或 E = mc^2';
        ta.spellcheck = false;

        var preview = el('div', 'math-preview');
        var palette = el('div', 'math-palette');

        var hint = el('div', 'math-hint');
        hint.innerHTML = '书写 LaTeX 数学公式。<b>点击下方符号</b>插入到光标处；支持 <code>\\frac</code>、<code>\\sum</code>、<code>\\int</code> 等常用命令。';

        wrap.appendChild(modes);
        wrap.appendChild(ta);
        wrap.appendChild(preview);
        wrap.appendChild(palette);
        wrap.appendChild(hint);

        function currentDisplay() { return bBlock.classList.contains('active'); }

        function doPreview() {
            var tex = Store ? global.WJMath.normalizeTex(ta.value) : ta.value;
            if (!tex) { preview.textContent = '（预览）'; preview.classList.remove('has-err'); return; }
            var html = global.WJMath.renderString(tex, currentDisplay());
            if (html == null) {
                if (!global.WJMath.isReady()) {
                    preview.textContent = tex;
                    preview.classList.remove('has-err');
                    return;
                }
                preview.textContent = '公式语法有误，请检查括号与命令';
                preview.classList.add('has-err');
                return;
            }
            preview.innerHTML = html;
            preview.classList.remove('has-err');
        }

        MATH_SYMBOLS.forEach(function (pair) {
            var b = el('button', 'sym', pair[1]);
            b.type = 'button';
            b.title = pair[0];
            b.addEventListener('click', function () {
                var s = ta.selectionStart, e = ta.selectionEnd;
                ta.value = ta.value.slice(0, s) + pair[0] + ta.value.slice(e);
                ta.selectionStart = ta.selectionEnd = s + pair[0].length;
                ta.focus();
                doPreview();
            });
            palette.appendChild(b);
        });

        bInline.addEventListener('click', function () {
            bInline.classList.add('active'); bBlock.classList.remove('active'); doPreview(); ta.focus();
        });
        bBlock.addEventListener('click', function () {
            bBlock.classList.add('active'); bInline.classList.remove('active'); doPreview(); ta.focus();
        });
        ta.addEventListener('input', doPreview);
        ta.addEventListener('keydown', function (e) {
            if (e.key === 'Tab') { e.preventDefault(); softTab(ta); }
        });

        if (!global.WJMath.isReady()) {
            global.WJMath.load().then(function () { doPreview(); });
        }
        doPreview();

        WJUI.dialog({
            title: targetEl ? '编辑公式' : '插入公式',
            body: wrap,
            width: '720px',
            actions: [
                { label: '取消', value: false },
                { label: targetEl ? '保存修改' : '插入', primary: true, onClick: function () { return true; } }
            ]
        }).then(function (ok) {
            if (ok === false) return;
            var tex = (ta.value || '').trim();
            if (!tex) {
                if (targetEl) { removeNode(targetEl); self.onInput(); }
                return;
            }
            var isBlock = currentDisplay();
            var html = isBlock
                ? '<div class="math-tex math-block" data-tex="' + esc(tex) + '" contenteditable="false"><span class="math-raw">' + esc(tex) + '</span></div><p><br></p>'
                : '<span class="math-tex math-inline" data-tex="' + esc(tex) + '" contenteditable="false">' + esc(tex) + '</span>&nbsp;';
            if (targetEl) {
                // 替换原公式：就地替换，保持位置与周围内容
                var box = el('div');
                box.innerHTML = html;
                var fresh = box.firstElementChild;
                targetEl.parentNode.replaceChild(fresh, targetEl);
                self.onInput();
                return;
            }
            self.$.rich.focus();
            self._restoreSelection();
            document.execCommand('insertHTML', false, html);
            self.onInput();
        });
    };

    /* ------------------------------------------------- 粘贴 / 拖放 / 图片 */

    Editor.prototype.onPaste = function (e) {
        var self = this;
        var dt = e.clipboardData;
        if (!dt) return;
        var files = Array.prototype.slice.call(dt.files || []).filter(function (f) {
            return /^image\//.test(f.type);
        });
        if (files.length) {
            e.preventDefault();
            this._rememberSelection();
            this.insertImageFiles(files).then(function (n) {
                if (n) self._restoreSelection();
            });
            return;
        }
        e.preventDefault();
        var html = dt.getData('text/html');
        var text = dt.getData('text/plain');
        if (html) {
            var box = document.createElement('div');
            box.innerHTML = CV.cleanForEditor(html);
            var inlineImgs = box.querySelectorAll('img[src^="blob:"], img[src^="data:"]');
            document.execCommand('insertHTML', false, box.innerHTML);
            if (inlineImgs.length) {
                // 粘贴内容自带图片：插入后立即转存 IndexedDB，避免 blob: 失效导致丢图
                this.registerImages();
            }
            this.onInput();
        } else if (text) {
            document.execCommand('insertText', false, text);
            this.onInput();
        }
        e.stopPropagation();
    };

    Editor.prototype.onDrop = function (e) {
        var dt = e.dataTransfer;
        if (!dt) return;
        var files = Array.prototype.slice.call(dt.files || []).filter(function (f) {
            return /^image\//.test(f.type);
        });
        if (!files.length) return;
        e.preventDefault();
        this._rememberSelection();
        var self = this;
        this.insertImageFiles(files).then(function () { self._restoreSelection(); });
    };

    /** 图片标题/对齐/删除菜单 */
    Editor.prototype.imageMenu = function (img) {
        var self = this;
        var wrap = el('div', 'stack');
        var af = el('div', 'field'); af.appendChild(el('label', '', '对齐'));
        var sel = el('select', 'select');
        [['left', '左对齐'], ['center', '居中'], ['right', '右对齐']].forEach(function (p) {
            var o = el('option', '', p[1]); o.value = p[0]; sel.appendChild(o);
        });
        sel.value = (img.style && img.style.textAlign) || 'left';
        af.appendChild(sel);
        var tf = el('div', 'field'); tf.appendChild(el('label', '', '替代文字（无障碍/加载失败时显示）'));
        var ti = el('input', 'input'); ti.value = img.getAttribute('alt') || '';
        tf.appendChild(ti);
        wrap.appendChild(af); wrap.appendChild(tf);

        WJUI.dialog({
            title: '图片设置',
            body: wrap,
            actions: [
                { label: '删除图片', danger: true, onClick: function () { removeNode(img); self.onInput(); } },
                { label: '取消', value: false },
                {
                    label: '应用', primary: true, onClick: function () {
                        var p = img.parentNode;
                        if (p && p.tagName === 'P') p.style.textAlign = sel.value === 'left' ? '' : sel.value;
                        else img.style.display = 'block', img.style.marginLeft = sel.value === 'right' ? 'auto' : (sel.value === 'center' ? 'auto' : '0'), img.style.marginRight = sel.value === 'left' ? 'auto' : '0';
                        img.setAttribute('alt', ti.value || '');
                        self.onInput();
                        return true;
                    }
                }
            ]
        });
    };

    Editor.prototype._insertHtml = function (html) {
        this.$.rich.focus();
        this._restoreSelection();
        document.execCommand('insertHTML', false, html);
        this.onInput();
    };

    /* --------------------------------------------------------- 预览/状态 */

    Editor.prototype.preview = function () {
        var self = this;
        clearTimeout(this.previewTimer);
        this.previewTimer = setTimeout(function () {
            var md = self.mode === 'rich' ? null : self.$.source.value;
            if (md == null) return;                    // 富文本模式下无独立预览需求
            var host = self.host.querySelector('#ed-preview-body');
            if (!host) return;
            host.innerHTML = MD.render(md);
            global.WJMath.renderIn(host);
        }, 220);
    };

    Editor.prototype.onInput = function () {
        this.dirty = true;
        this.$.saveState.textContent = '未保存的修改';
        this.$.saveState.classList.add('is-dirty');
        this.scheduleStats();
        if (this.mode === 'source') this.preview();
        this.scheduleSave();
    };

    /** 统计要把整篇富文本重新转一次 Markdown，长文下逐键重算很贵：停顿后再算 */
    Editor.prototype.scheduleStats = function () {
        var self = this;
        clearTimeout(this.statsTimer);
        this.statsTimer = setTimeout(function () { self.updateStats(); }, 300);
    };

    Editor.prototype.scheduleSave = function () {
        var self = this;
        clearTimeout(this.autoTimer);
        this.autoTimer = setTimeout(function () { self.save({ auto: true }); }, 1500);
    };

    Editor.prototype.updateStats = function () {
        var md = this.mode === 'rich' ? CV.htmlToMd(this.$.rich, { blobMap: this.blobMap }) : this.$.source.value;
        var n = Store.countWords(md);
        var imgs = this.$.rich.querySelectorAll('img').length;
        var maths = this.$.rich.querySelectorAll('.math-tex').length;
        this.$.stats.innerHTML =
            '<div class="side-title">正文统计</div>' +
            '<div class="stat-row"><span>字数</span><b>' + n + '</b></div>' +
            '<div class="stat-row"><span>阅读时长</span><b>约 ' + Store.readingMinutes(md) + ' 分钟</b></div>' +
            '<div class="stat-row"><span>图片</span><b>' + imgs + '</b></div>' +
            '<div class="stat-row"><span>公式</span><b>' + maths + '</b></div>';
    };

    Editor.prototype.updateMetaLine = function () {
        var a = this.article;
        var parts = [];
        if (a.createdAt) parts.push('创建 ' + Store.fmtDate(a.createdAt));
        if (a.updatedAt) parts.push('更新 ' + Store.fmtRelative(a.updatedAt));
        this.$.metaLine.textContent = parts.join(' · ') || '新文章';
    };

    /* --------------------------------------------------------------- 保存 */

    Editor.prototype.collect = function () {
        var a = this.article;
        var wasRepo = a.source === 'repo';   // 下面会把 source 改成 local，先记下原来源
        a.title = (this.$.title.value || '').trim() || '未命名文章';
        a.summary = (this.$.summary.value || '').trim();
        a.tags = (this.$.tags.value || '').split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
        a.cover = (this.$.cover.value || '').trim();
        a.status = this.$.status.value;
        a.pinned = this.$.pinned.checked;
        a.source = 'local';
        a.localOnly = true;
        if (!a.id) a.id = Store.genId('a');
        if (!a.createdAt) a.createdAt = Store.nowISO();
        // 编辑器里没有 slug 输入框，slug 一律由标题派生：
        // · 已经落地到仓库的文章保留原 slug（改标题不该悄悄改掉线上链接）；
        // · 其余（新建 / 导入 / 尚未落地）都跟着标题重新生成，否则 normalize 一开始
        //   补的占位 slug（"未命名文章"）会被永久固化，标题改成「测试」也不生效。
        if (!wasRepo || !a.slug) a.slug = Store.slugify(a.title, a.id);
        return a;
    };

    Editor.prototype.save = function (opts) {
        var self = this;
        opts = opts || {};
        var a = this.collect();
        return this.registerImages().then(function () {
            a.body = self.mode === 'rich' ? CV.htmlToMd(self.$.rich, { blobMap: self.blobMap }) : self.$.source.value;
            a.format = 'markdown';
            return Store.saveArticle(a);
        }).then(function (saved) {
            self.article = saved;
            self.dirty = false;
            self.markSaved();
            self.updateMetaLine();
            if (self.options.onSave) self.options.onSave(saved);
            if (!opts.auto) WJUI.toast('已保存到本地', 'ok');
            return saved;
        }).catch(function (err) {
            self.$.saveState.textContent = '保存失败：' + err.message;
            self.$.saveState.classList.add('is-error');
            WJUI.toast('保存失败：' + err.message, 'err', 4000);
            throw err;
        });
    };

    Editor.prototype.markSaved = function () {
        this.$.saveState.classList.remove('is-dirty', 'is-error');
        this.$.saveState.textContent = '已保存到本地 · ' + Store.fmtDate(Store.nowISO(), true);
    };

    /* ------------------------------------------------------------- 工具 */

    function removeNode(n) { if (n && n.parentNode) n.parentNode.removeChild(n); }

    function baseName(name) { return String(name || '').replace(/\.[a-z0-9]+$/i, ''); }

    function extOf(mime, name) {
        var m = /^image\/(png|jpeg|jpg|gif|webp|svg\+xml|avif|bmp)$/.exec(mime || '');
        if (m) return m[1] === 'jpeg' ? 'jpg' : (m[1] === 'svg+xml' ? 'svg' : m[1]);
        var e = /\.([a-z0-9]+)$/i.exec(name || '');
        return e ? e[1].toLowerCase() : 'png';
    }

    function toDataURL(url) {
        return fetch(url).then(function (r) { return r.blob(); }).then(function (b) {
            return new Promise(function (resolve) {
                var fr = new FileReader();
                fr.onload = function () { resolve(fr.result); };
                fr.onerror = function () { resolve(''); };
                fr.readAsDataURL(b);
            });
        });
    }

    function softTab(ta) {
        var s = ta.selectionStart, e = ta.selectionEnd;
        if (s === e) {
            ta.value = ta.value.slice(0, s) + '    ' + ta.value.slice(e);
            ta.selectionStart = ta.selectionEnd = s + 4;
            return;
        }
        // 多行缩进
        var start = ta.value.lastIndexOf('\n', s - 1) + 1;
        var block = ta.value.slice(start, e);
        ta.value = ta.value.slice(0, start) + block.replace(/^/gm, '    ') + ta.value.slice(e);
        ta.selectionStart = start;
        ta.selectionEnd = e + block.split('\n').length * 4;
    }

    Editor.prototype.destroy = function () {
        clearTimeout(this.autoTimer);
        clearTimeout(this.previewTimer);
    };

    global.WJEditor = Editor;
})(window);
