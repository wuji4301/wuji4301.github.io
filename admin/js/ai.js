/* ==========================================================================
   无极博客 · AI 生成（admin/js/ai.js）
   —— 用 DeepSeek V4.1（deepseek-flash，原生多模态）看图写文章
   --------------------------------------------------------------------------
   设计约束：
   · 只被 admin/ 下的页面加载，不会随站点部署（tools/deploy.mjs 白名单不含 admin/）；
   · 浏览器直连 DeepSeek 官方接口（api.deepseek.com 会回 CORS 头，file:// 下 Origin: null
     同样放行），因此不需要任何本地服务端；
   · API Key 只写在本机浏览器的 localStorage，不进仓库、不上传，清空浏览器数据即消失；
   · 纯函数（提示词组装 / 响应解析 / 错误文案）与网络层分开，便于 Node 端单测。
   ========================================================================== */
(function (global) {
    'use strict';

    var STORAGE_KEY = 'wj-ai-config';

    /** 展示用的模型清单；value 直接作为请求里的 model 字段 */
    var MODELS = [
        { value: 'deepseek-flash', label: 'DeepSeek V4.1 Flash（deepseek-flash，多模态 · 推荐）' },
        { value: 'deepseek-v4-flash-vision-exp', label: 'DeepSeek V4 Vision（实验版，兼容旧名）' }
    ];

    var DEFAULTS = {
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-flash',
        apiKey: ''
    };

    // 单张图最大边超过它就先缩图：省 token，也避开接口的像素/体积上限。
    var MAX_EDGE = 1536;
    var SHRINK_OVER_BYTES = 2 * 1024 * 1024;

    // 约定：图片转文章是 1:1 转写 —— 图文内容照搬，不解释、不扩写、不评论。
    var SYSTEM_PROMPT = [
        '你是一位中文博客作者。读者会给你一张图片，你要把图片里承载的内容 1:1 转写成一篇中文文章。',
        '',
        '最重要的一条：写的是图片里的内容，不是这张图片本身，也不要加任何解释。',
        '· 图中有文字、笔记、截图、文档、表格、数据、图表、代码、题目时，原样读出来，',
        '  按原有顺序与层级直接转写成文章；不增删、不改写、不总结、不补充背景。',
        '· 图中有数字或图表时，照抄其中的数值、标题与结论，不要自行解读或推算。',
        '· 图中是照片等没有可提取信息的画面时，只客观描述看得见的人、事、物与场景，',
        '  不要抒情、不要联想，也不要写成「这张图很……」。',
        '· 看不清的地方宁可略过，也不要用推测填空。',
        '',
        '写作要求：',
        '1. 只输出一个 JSON 对象，不要输出解释、开场白或 Markdown 代码围栏；',
        '2. JSON 字段：',
        '   · title：文章标题，不超过 24 个字，概括图片内容，不要带书名号或「标题：」前缀；',
        '   · summary：摘要，一两句话如实概括图片内容，不添加观点；',
        '   · tags：3~5 个短标签（每个 2~6 字），不要带 # 号；',
        '   · alt：图片的替代文字，15 字以内，客观描述画面；',
        '   · body：正文，把图片内容 1:1 转写成 Markdown，长度与图片内容相当，不扩写；',
        '3. 保留图片原有的结构：标题、编号、列表、表格、代码块按原样呈现，段落之间空一行；',
        '4. 忠实于图片：不要编造图中没有的人名、地点、数字与引用，看不清的地方宁可略过；',
        '5. 不要在正文里插入任何图片或链接（配图由系统放置），也不要用「这张图片」「如图所示」指代图片；',
        '6. 语言平实，不添加任何解释与个人观点。'
    ].join('\n');

    /* ------------------------------------------------------------ 配置层 */

    function readConfig() {
        var raw = null;
        try { raw = global.localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
        var saved = {};
        if (raw) {
            try { saved = JSON.parse(raw) || {}; } catch (e) { saved = {}; }
        }
        return {
            baseUrl: String(saved.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, ''),
            model: String(saved.model || DEFAULTS.model),
            apiKey: String(saved.apiKey || '')
        };
    }

    function writeConfig(patch) {
        var next = readConfig();
        if (patch) {
            if (patch.baseUrl != null) next.baseUrl = String(patch.baseUrl).trim().replace(/\/+$/, '') || DEFAULTS.baseUrl;
            if (patch.model != null) next.model = String(patch.model).trim() || DEFAULTS.model;
            if (patch.apiKey != null) next.apiKey = String(patch.apiKey).trim();
        }
        try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (e) { void e; }
        return next;
    }

    function clearConfig() {
        try { global.localStorage.removeItem(STORAGE_KEY); } catch (e) { void e; }
    }

    function isConfigured() { return !!readConfig().apiKey; }

    /** 只露头尾，用于在界面上确认「填的是哪把钥匙」 */
    function maskKey(key) {
        var k = String(key || '');
        if (k.length <= 10) return k ? '已填写' : '未填写';
        return k.slice(0, 6) + '…' + k.slice(-4);
    }

    /* -------------------------------------------------- 提示词与响应解析 */

    /** 组装一次图片转文章的 messages（纯函数，便于单测） */
    function buildMessages(dataUrl, hint) {
        var text = (hint && String(hint).trim())
            ? '这张图片的转写要求：' + String(hint).trim() + '\n\n请按系统要求 1:1 转写并输出 JSON。'
            : '请按系统要求把这张图片的内容 1:1 转写，并输出 JSON。';
        return [
            { role: 'system', content: SYSTEM_PROMPT },
            {
                role: 'user',
                content: [
                    { type: 'text', text: text },
                    { type: 'image_url', image_url: { url: dataUrl } }
                ]
            }
        ];
    }

    /** 从模型输出里抠出 JSON：先直解，再剥代码围栏，最后按首尾大括号兜底 */
    function extractJSON(text) {
        var s = String(text == null ? '' : text).trim();
        if (!s) return null;
        try { return JSON.parse(s); } catch (e) { /* 继续降级 */ }

        var fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
        if (fence) {
            try { return JSON.parse(fence[1].trim()); } catch (e) { /* 继续降级 */ }
        }
        var from = s.indexOf('{');
        var to = s.lastIndexOf('}');
        if (from >= 0 && to > from) {
            try { return JSON.parse(s.slice(from, to + 1)); } catch (e) { /* 落到 null */ }
        }
        return null;
    }

    function str(v) { return v == null ? '' : String(v).trim(); }

    function tagsOf(v) {
        var list = Array.isArray(v) ? v : String(v == null ? '' : v).split(/[,，、|/]/);
        var out = [];
        list.forEach(function (t) {
            var s = str(t).replace(/^#+\s*/, '');
            if (s && out.indexOf(s) === -1 && out.length < 6) out.push(s);
        });
        return out;
    }

    /**
     * 把模型返回的 JSON 归拢成文章字段。
     * 模型偶尔会漏字段或把 body 写成数组，这里统一抹平，保证下游拿到的结构稳定。
     */
    function normalizeArticle(raw, fallback) {
        fallback = fallback || {};
        var o = raw && typeof raw === 'object' ? raw : {};
        var body = o.body;
        if (Array.isArray(body)) body = body.join('\n\n');
        body = str(body);

        var title = str(o.title).replace(/^["'「《【\s]+|["'」》】\s]+$/g, '');
        if (!title) title = str(fallback.title) || '未命名文章';

        var summary = str(o.summary);
        if (!summary) summary = body.replace(/\s+/g, ' ').slice(0, 100);

        return {
            title: title.slice(0, 120),
            summary: summary,
            tags: tagsOf(o.tags).length ? tagsOf(o.tags) : ['图片', '随笔'],
            alt: str(o.alt).slice(0, 60) || title,
            body: body
        };
    }

    /**
     * 落成一篇可交给 Store.saveArticle 的草稿：正文首行放图片引用，正文留空则用图片占位。
     * 只引用 img://<id>，不落盘文件名 —— 与图库的引用统计、发布时的替换规则保持一致。
     */
    function buildArticle(gen, opts) {
        opts = opts || {};
        var id = str(opts.imageId);
        var alt = str(gen.alt) || str(gen.title);
        var cover = id ? '![' + alt.replace(/[\[\]]/g, '') + '](img://' + id + ')' : '';
        var body = str(gen.body);
        return {
            title: gen.title,
            summary: gen.summary,
            tags: gen.tags,
            status: 'draft',
            format: 'markdown',
            body: (cover ? cover + '\n\n' : '') + (body || '（AI 未返回正文，请在此补充）')
        };
    }

    /* ---------------------------------------------------------- 错误文案 */

    function serverMessage(text) {
        try {
            var j = JSON.parse(text);
            var m = j && j.error && (j.error.message || j.error.type);
            return m ? String(m) : '';
        } catch (e) { return ''; }
    }

    var STATUS_TEXT = {
        400: '请求被接口拒绝（400）',
        401: 'API Key 无效或已失效（401），请到设置里重新填写',
        402: '账户余额不足（402），请先充值或换一把 Key',
        403: '没有访问权限（403），确认 Key 已开通该模型',
        404: '接口地址不存在（404），请检查「服务地址」是否写错',
        422: '请求参数不合法（422）',
        429: '请求过于频繁（429），稍等片刻再试',
        500: '服务端出错（500），稍后重试',
        502: '网关错误（502），稍后重试',
        503: '服务暂不可用（503），稍后重试',
        504: '网关超时（504），稍后重试'
    };

    /** 把一次失败翻译成人能看懂的一句话 */
    function errorText(status, bodyText) {
        var base = STATUS_TEXT[status] || ('请求失败（HTTP ' + status + '）');
        var detail = serverMessage(bodyText);
        return detail ? base + '：' + detail : base;
    }

    var CORS_HINT = '连不上 DeepSeek：请检查网络、代理，或改用系统代理直连（api.deepseek.com）。';

    /* ------------------------------------------------------------ 图片层 */

    function blobToDataURL(blob) {
        return new Promise(function (resolve, reject) {
            var fr = new FileReader();
            fr.onload = function () { resolve(String(fr.result || '')); };
            fr.onerror = function () { reject(new Error('图片读取失败，可能是文件已被移动或损坏')); };
            fr.readAsDataURL(blob);
        });
    }

    function loadImage(blob) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(blob);
            var img = new Image();
            var done = function (fn, arg) { URL.revokeObjectURL(url); fn(arg); };
            img.onload = function () { done(resolve, img); };
            img.onerror = function () { done(reject, new Error('图片无法解码，请换一张')); };
            img.src = url;
        });
    }

    /**
     * 准备送给接口的图片：过大就先缩到 MAX_EDGE 内并重新编码。
     * 缩图是纯优化，任何一步失败都退回原图，绝不因此让整个功能不可用。
     */
    function prepareImage(blob) {
        if (!blob) return Promise.reject(new Error('找不到图片数据'));
        var big = (blob.size || 0) > SHRINK_OVER_BYTES;
        return loadImage(blob).then(function (img) {
            var w = img.naturalWidth || img.width;
            var h = img.naturalHeight || img.height;
            var edge = Math.max(w, h);
            if (!big && edge <= MAX_EDGE) return { dataUrl: null, blob: blob, width: w, height: h, shrunk: false };

            var scale = edge > MAX_EDGE ? MAX_EDGE / edge : 1;
            var cw = Math.max(1, Math.round(w * scale));
            var ch = Math.max(1, Math.round(h * scale));
            var canvas = document.createElement('canvas');
            canvas.width = cw;
            canvas.height = ch;
            var ctx = canvas.getContext('2d');
            if (!ctx) return { dataUrl: null, blob: blob, width: w, height: h, shrunk: false };
            ctx.drawImage(img, 0, 0, cw, ch);
            var type = blob.type === 'image/png' ? 'image/png' : 'image/jpeg';
            return new Promise(function (resolve) {
                canvas.toBlob(function (out) {
                    if (!out || out.size >= blob.size) resolve({ dataUrl: null, blob: blob, width: w, height: h, shrunk: false });
                    else resolve({ dataUrl: null, blob: out, width: cw, height: ch, shrunk: true });
                }, type, 0.9);
            });
        }).then(function (prep) {
            return blobToDataURL(prep.blob).then(function (dataUrl) {
                prep.dataUrl = dataUrl;
                return prep;
            });
        }).catch(function () {
            return blobToDataURL(blob).then(function (dataUrl) {
                return { dataUrl: dataUrl, blob: blob, width: 0, height: 0, shrunk: false };
            });
        });
    }

    function activeStore() {
        // 后台走 WJStore，单测/自测页可直接注入
        return global.WJStore || null;
    }

    /** 取图片库里的图片 → 可直接塞进请求体的 data URL */
    function imageDataUrl(imageId) {
        var Store = activeStore();
        if (!Store) return Promise.reject(new Error('数据层未加载，请刷新页面'));
        return Store.getImage(imageId).then(function (rec) {
            if (!rec || !rec.blob) throw new Error('图片已不在本地图库中');
            return prepareImage(rec.blob);
        });
    }

    // 与编辑器上传同一套限制：只收浏览器能安全解码的图片，且不超过 8MB
    var SAFE_IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml)$/i;
    var MAX_IMAGE_BYTES = 8 * 1024 * 1024;

    /** 读出图片真实尺寸，让图卡不再显示「未知尺寸」 */
    function probeSize(blob) {
        return new Promise(function (resolve) {
            var url = URL.createObjectURL(blob);
            var img = new Image();
            var done = function (w, h) { URL.revokeObjectURL(url); resolve({ width: w, height: h }); };
            img.onload = function () { done(img.naturalWidth || 0, img.naturalHeight || 0); };
            img.onerror = function () { done(0, 0); };
            img.src = url;
        });
    }

    /**
     * 校验并写入本地图库，返回落库后的图片记录。
     * 图片库的「上传图片」与编辑器的「AI 写稿 → 上传新图片」都走这里，
     * 两处的体积/类型限制因此只有一份，不会日后悄悄跑偏。
     */
    function saveImageFile(file) {
        var Store = activeStore();
        if (!Store) return Promise.reject(new Error('数据层未加载，请刷新页面'));
        if (!file) return Promise.reject(new Error('没有选到文件'));
        if (!/^image\//.test(file.type)) return Promise.reject(new Error('只能选图片文件'));
        if (file.size > MAX_IMAGE_BYTES) {
            return Promise.reject(new Error('图片超过 ' + (MAX_IMAGE_BYTES / 1024 / 1024) + 'MB，请先压缩（与编辑器上传限制一致）'));
        }
        // 个别格式（如 image/heic）能存但浏览器解不了，统一按 png 落下，
        // 免得图库里多出一条注定裂图的记录。
        var type = SAFE_IMAGE_TYPES.test(file.type) ? file.type : 'image/png';
        var safe = type === file.type ? file : new File([file], file.name, { type: type });
        return probeSize(safe).then(function (dim) {
            return Store.addImage(safe, {
                id: Store.genId('img'),
                name: file.name,
                type: type,
                width: dim.width,
                height: dim.height
            });
        });
    }

    /* ------------------------------------------------------------ 网络层 */

    function chat(messages, opts) {
        opts = opts || {};
        var cfg = readConfig();
        if (!cfg.apiKey) {
            return Promise.reject(new Error('还没有配置 DeepSeek API Key，请先到「设置 → AI 生成」里填写'));
        }

        var url = cfg.baseUrl + '/chat/completions';
        var base = {
            model: opts.model || cfg.model,
            messages: messages,
            temperature: opts.temperature == null ? 1.1 : opts.temperature,
            max_tokens: opts.maxTokens || 4096,
            stream: false
        };
        if (opts.json) base.response_format = { type: 'json_object' };

        var timer = 0;
        var ctrl = global.AbortController ? new global.AbortController() : null;
        // 调用方（如「取消生成」按钮）可以传自己的 signal 来中断这次请求
        if (ctrl && opts.signal && opts.signal.addEventListener) {
            if (opts.signal.aborted) ctrl.abort();
            else opts.signal.addEventListener('abort', function () { ctrl.abort(); });
        }

        function send(payload) {
            if (timer) clearTimeout(timer);
            if (ctrl) timer = setTimeout(function () { ctrl.abort(); }, opts.timeout || 180000);
            return global.fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + cfg.apiKey
                },
                body: JSON.stringify(payload),
                signal: ctrl ? ctrl.signal : undefined
            }).then(function (res) {
                return res.text().then(function (t) { return { status: res.status, ok: res.ok, text: t }; });
            });
        }

        return send(base).then(function (res) {
            // 少数兼容端不支持 response_format：摘掉它再试一次，别让整个功能卡死。
            if (res.status === 400 && base.response_format && /response_format|json/i.test(res.text)) {
                var retry = {};
                Object.keys(base).forEach(function (k) { if (k !== 'response_format') retry[k] = base[k]; });
                return send(retry);
            }
            return res;
        }).then(function (res) {
            if (timer) clearTimeout(timer);
            if (!res.ok) throw new Error(errorText(res.status, res.text));
            var json;
            try { json = JSON.parse(res.text); } catch (e) { throw new Error('接口返回的不是合法 JSON，请稍后重试'); }
            var choice = (json.choices && json.choices[0]) || {};
            var msg = choice.message || {};
            return {
                text: String(msg.content == null ? '' : msg.content),
                reasoning: String(msg.reasoning_content == null ? '' : msg.reasoning_content),
                model: String(json.model || base.model),
                usage: json.usage || null,
                finish: choice.finish_reason || ''
            };
        }).catch(function (err) {
            if (timer) clearTimeout(timer);
            var msg = err && err.message ? err.message : String(err);
            if (err && err.name === 'AbortError') {
                throw new Error('请求超时或被取消：' + (opts.cancelLabel || '图片较大时首次生成可能需要一两分钟，可稍后重试'));
            }
            // fetch 在网络失败/被跨域拦截时统一抛 TypeError，这里给出可执行的建议
            if (err && err.name === 'TypeError') throw new Error(CORS_HINT);
            throw new Error(msg);
        });
    }

    /** 连通性自检：一次极小的纯文本请求 */
    function testConnection() {
        var started = now();
        return chat([{ role: 'user', content: '回复两个字：可用' }], { temperature: 0, maxTokens: 16, timeout: 30000 })
            .then(function (out) {
                return { ok: true, model: out.model, ms: Math.round(now() - started), text: out.text.trim().slice(0, 40) };
            });
    }

    function now() {
        return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
    }

    /**
     * 一次性完成「图片 → 文章草稿」。
     * opts: { imageId, imageName, hint, onStage(name), articlePatch }
     * 返回 { article, usage, model, prepared }
     */
    function imageToArticle(opts) {
        opts = opts || {};
        var staged = function (name) { if (opts.onStage) { try { opts.onStage(name); } catch (e) { void e; } } };
        staged('prepare');
        return imageDataUrl(opts.imageId).then(function (prep) {
            staged('generate');
            return chat(buildMessages(prep.dataUrl, opts.hint), { json: true, signal: opts.signal }).then(function (out) {
                var parsed = extractJSON(out.text);
                if (!parsed) {
                    throw new Error('模型没有返回可解析的 JSON，请重试或换个模型');
                }
                var gen = normalizeArticle(parsed, { title: opts.imageName ? opts.imageName.replace(/\.[a-z0-9]+$/i, '') : '' });
                var article = buildArticle(gen, { imageId: opts.imageId });
                if (opts.articlePatch) article = Object.assign(article, opts.articlePatch);
                return { article: article, generated: gen, usage: out.usage, model: out.model, prepared: prep };
            });
        });
    }

    global.WJAI = {
        MODELS: MODELS,
        DEFAULTS: DEFAULTS,
        STORAGE_KEY: STORAGE_KEY,
        SYSTEM_PROMPT: SYSTEM_PROMPT,
        readConfig: readConfig,
        writeConfig: writeConfig,
        clearConfig: clearConfig,
        isConfigured: isConfigured,
        maskKey: maskKey,
        buildMessages: buildMessages,
        extractJSON: extractJSON,
        tagsOf: tagsOf,
        normalizeArticle: normalizeArticle,
        buildArticle: buildArticle,
        errorText: errorText,
        prepareImage: prepareImage,
        imageDataUrl: imageDataUrl,
        saveImageFile: saveImageFile,
        MAX_IMAGE_BYTES: MAX_IMAGE_BYTES,
        chat: chat,
        testConnection: testConnection,
        imageToArticle: imageToArticle
    };
})(typeof window !== 'undefined' ? window : globalThis);
