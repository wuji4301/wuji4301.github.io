// 后台 AI 模块（admin/js/ai.js）在 Node 里的跑测：
// 用假的 localStorage / fetch / FileReader / Image 把「读配置 → 组提示词 → 发请求 → 解析响应」
// 整条链路真的跑一遍，断言的是可观察行为（请求体长什么样、错误怎么翻译成人话），
// 而不是把源码里的常量再抄一遍。不联网、不需要 API Key。
// 用法: node tools/test-ai.mjs
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '\n         ' + extra : '')); }
}

/* ======================================================== 浏览器 API 垫片 */

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};

/** fetch 决策器：按第 N 次调用返回 { status, body }，或抛错模拟网络/跨域失败 */
let responder = () => ({ status: 200, body: '' });
const calls = [];
globalThis.fetch = (url, init) => {
  const call = { url, init, body: JSON.parse(init.body) };
  calls.push(call);
  const sig = init && init.signal;
  if (sig && sig.aborted) {
    const e = new Error('The operation was aborted');
    e.name = 'AbortError';
    return Promise.reject(e);
  }
  const r = responder(calls.length, call);
  if (r instanceof Error) return Promise.reject(r);
  return Promise.resolve({
    status: r.status,
    ok: r.status >= 200 && r.status < 300,
    text: () => Promise.resolve(r.body)
  });
};

/** 极小 FileReader：直接把内存里的 dataUrl 交出去 */
globalThis.FileReader = class {
  readAsDataURL(blob) {
    setTimeout(() => {
      this.result = (blob && blob.__dataUrl) || 'data:image/png;base64,AAAA';
      if (this.onload) this.onload();
    }, 0);
  }
};

let imageSize = { w: 1200, h: 800 };
globalThis.URL.createObjectURL = () => 'blob:fake';
globalThis.URL.revokeObjectURL = () => { };
globalThis.Image = class {
  set src(_v) {
    setTimeout(() => {
      this.naturalWidth = imageSize.w;
      this.naturalHeight = imageSize.h;
      if (this.onload) this.onload();
    }, 0);
  }
};
globalThis.document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({ drawImage() { } }),
    toBlob: (cb, type) => cb({ size: 512, type: type || 'image/jpeg', __dataUrl: 'data:image/jpeg;base64,SHRUNK' })
  })
};
globalThis.window = globalThis;

/* 数据层替身：只实现 ai.js 会用到的 getImage */
globalThis.WJStore = {
  getImage: (id) => Promise.resolve(
    id === 'img-1'
      ? { id: 'img-1', name: 'photo.jpg', type: 'image/jpeg', blob: { size: 1024, type: 'image/jpeg', __dataUrl: 'data:image/jpeg;base64,SMALL' } }
      : null
  )
};

/* ======================================================== 载入真实脚本 */

const src = await readFile(resolve(ROOT, 'admin/js/ai.js'), 'utf8');
const AI = vm.runInThisContext(src, { filename: 'admin/js/ai.js' }) || globalThis.WJAI;

const okBody = (text) => JSON.stringify({
  model: 'deepseek-flash',
  choices: [{ message: { content: text }, finish_reason: 'stop' }],
  usage: { total_tokens: 321 }
});
const response = (status, body) => ({ status, body });

/* ======================================================== 开始断言 */

console.log('\n== 0. 前置 ==');
t('模块已导出 WJAI', !!AI && typeof AI.imageToArticle === 'function');
t('默认模型是 DeepSeek V4.1（deepseek-flash）', AI.DEFAULTS.model === 'deepseek-flash', AI.DEFAULTS.model);
t('默认走官方接口地址', AI.DEFAULTS.baseUrl === 'https://api.deepseek.com', AI.DEFAULTS.baseUrl);
t('只暴露后台用的地址，不含 CDN', !/cdn|unpkg/.test(src));

console.log('\n== 1. 配置读写 ==');
AI.clearConfig();
t('初始未配置', AI.isConfigured() === false);
let cfg = AI.writeConfig({ apiKey: '  sk-test-1234567890  ', baseUrl: 'https://api.deepseek.com/v1/' });
t('Key 自动去空格', cfg.apiKey === 'sk-test-1234567890', cfg.apiKey);
t('服务地址去掉多余的尾斜杠', cfg.baseUrl === 'https://api.deepseek.com/v1', cfg.baseUrl);
t('写出后即视为已配置', AI.isConfigured() === true);
t('重新读取保持一致', AI.readConfig().model === 'deepseek-flash');
t('界面上只露头尾', AI.maskKey('sk-test-1234567890') === 'sk-tes…7890', AI.maskKey('sk-test-1234567890'));
cfg = AI.writeConfig({ baseUrl: '   ' });
t('空地址回落默认值', cfg.baseUrl === AI.DEFAULTS.baseUrl, cfg.baseUrl);
t('写入不覆盖未提到的字段', AI.readConfig().apiKey === 'sk-test-1234567890');
AI.clearConfig();
t('清除后回到未配置', AI.readConfig().apiKey === '' && AI.readConfig().baseUrl === AI.DEFAULTS.baseUrl);

console.log('\n== 2. 提示词组装 ==');
const msgs = AI.buildMessages('data:image/jpeg;base64,XYZ', '重点写拍摄参数');
t('包含 system + user 两条', msgs.length === 2 && msgs[0].role === 'system' && msgs[1].role === 'user');
t('system 要求输出 JSON 字段', /JSON/.test(msgs[0].content) && /title/.test(msgs[0].content));
t('system 要求 1:1 转写图片内容', /1:1 转写/.test(msgs[0].content));
t('system 明确不加解释、不扩写', /不添加任何解释/.test(msgs[0].content) && !/600~1000/.test(msgs[0].content));
t('system 禁止正文里插图', /不要在正文里插入任何图片/.test(msgs[0].content));
const parts = msgs[1].content;
t('user 是 text + image_url 两段', Array.isArray(parts) && parts.length === 2);
t('图片段用的是 base64 data URL', parts[1].type === 'image_url' && parts[1].image_url.url === 'data:image/jpeg;base64,XYZ');
t('转写要求被带进提示词', /重点写拍摄参数/.test(parts[0].text) && /1:1 转写/.test(parts[0].text));
t('不给方向时也有默认指令', /输出 JSON/.test(AI.buildMessages('data:image/png;base64,A', '').at(-1).content[0].text));

console.log('\n== 3. 响应解析 ==');
t('纯 JSON 直解', AI.extractJSON('{"title":"甲"}').title === '甲');
t('剥掉 ```json 代码围栏', AI.extractJSON('```json\n{"title":"乙"}\n```').title === '乙');
t('剥掉无语言标记的围栏', AI.extractJSON('```\n{"title":"丙"}\n```').title === '丙');
t('前后有废话也能抠出来', AI.extractJSON('好的，这是结果：{"title":"丁"} 希望有帮助').title === '丁');
t('彻底不是 JSON 时返回 null', AI.extractJSON('抱歉，我看不出这是什么') === null);
t('空输入返回 null', AI.extractJSON('') === null && AI.extractJSON(null) === null);

const norm = AI.normalizeArticle(
  { title: '《一圈银杏》', summary: '', tags: '#秋天, 摄影、, 秋天', alt: '', body: ['一段', '二段'] },
  { title: 'photo' }
);
t('标题去掉书名号', norm.title === '一圈银杏', norm.title);
t('tags 支持数组外的逗号/顿号分隔', norm.tags.join('|') === '秋天|摄影', norm.tags.join('|'));
t('tags 去重并限制数量', norm.tags.length === 2);
t('body 是数组时拼成段落', norm.body === '一段\n\n二段', norm.body);
t('摘要缺失时用正文首段兜底', norm.summary === '一段 二段', norm.summary);
t('alt 缺失时退回标题', norm.alt === '一圈银杏');
const fallback = AI.normalizeArticle(null, { title: 'photo.jpg' });
t('整个响应为空时用文件名兜底', fallback.title === 'photo.jpg' && fallback.tags.length > 0);

console.log('\n== 4. 组装文章草稿 ==');
const art = AI.buildArticle({ title: '银杏', summary: 's', tags: ['秋'], alt: '一棵银杏', body: '## 小标题\n\n正文' }, { imageId: 'img-9' });
t('配图放在正文最前面', art.body.indexOf('![一棵银杏](img://img-9)') === 0, art.body.slice(0, 40));
t('只引用 img://，不写死文件名', /img:\/\/img-9/.test(art.body) && !/\.jpg|\.png/.test(art.body));
t('落成草稿而非直接发布', art.status === 'draft' && art.format === 'markdown');
const noBody = AI.buildArticle({ title: 't', summary: 's', tags: [], alt: 'a', body: '' }, { imageId: 'img-9' });
t('正文为空时留占位，不留空白文章', /（AI 未返回正文/.test(noBody.body));

console.log('\n== 5. 错误翻译 ==');
t('401 提示重填 Key', /API Key/.test(AI.errorText(401, '')));
t('404 提示检查地址', /服务地址/.test(AI.errorText(404, '')));
t('429 提示稍后再试', /稍等|稍后/.test(AI.errorText(429, '')));
t('unknown 状态码也带 HTTP 号', /HTTP 418/.test(AI.errorText(418, '')));
t('服务端 message 被带出来', /model not exist/.test(AI.errorText(400, JSON.stringify({ error: { message: 'model not exist' } }))));
t('错误体不是 JSON 时不炸', AI.errorText(400, '<html>502</html>').indexOf('400') !== -1);

console.log('\n== 6. 图片预处理 ==');
imageSize = { w: 1200, h: 800 };
let prep = await AI.prepareImage({ size: 1024, type: 'image/jpeg', __dataUrl: 'data:image/jpeg;base64,SMALL' });
t('小图不缩，原样转 data URL', prep.shrunk === false && prep.dataUrl === 'data:image/jpeg;base64,SMALL', prep.dataUrl);
imageSize = { w: 4000, h: 3000 };
prep = await AI.prepareImage({ size: 1024, type: 'image/jpeg', __dataUrl: 'data:image/jpeg;base64,SMALL' });
t('超大边触发缩图（省 token）', prep.shrunk === true && prep.width === 1536, prep.width + '×' + prep.height);
t('缩图后重新编码', prep.dataUrl === 'data:image/jpeg;base64,SHRUNK', prep.dataUrl);
imageSize = { w: 1000, h: 700 };
prep = await AI.prepareImage({ size: 5 * 1024 * 1024, type: 'image/jpeg', __dataUrl: 'data:image/jpeg;base64,SMALL' });
t('尺寸不大但超过 2MB 的图也会被压一次', prep.shrunk === true && prep.dataUrl === 'data:image/jpeg;base64,SHRUNK');
const fromStore = await AI.imageDataUrl('img-1');
t('能从图库里取图并转成 data URL', fromStore.dataUrl === 'data:image/jpeg;base64,SMALL');
await AI.imageDataUrl('not-exist').then(
  () => t('图库里没有的图片会明确报错', false),
  (e) => t('图库里没有的图片会明确报错', /不在本地图库/.test(e.message), e.message)
);

console.log('\n== 7. 真实发请求（假 fetch） ==');
AI.writeConfig({ apiKey: 'sk-test-1234567890' });
calls.length = 0;
responder = () => response(200, okBody('{"title":"银杏"}'));
let out = await AI.chat([{ role: 'user', content: 'hi' }], { json: true });
t('打到 /chat/completions', calls[0].url === 'https://api.deepseek.com/chat/completions', calls[0].url);
t('带上 Bearer 鉴权头', calls[0].init.headers.Authorization === 'Bearer sk-test-1234567890');
t('请求体用 deepseek-flash', calls[0].body.model === 'deepseek-flash', calls[0].body.model);
t('要求 JSON 输出', calls[0].body.response_format.type === 'json_object');
t('默认不流式', calls[0].body.stream === false);
t('返回正文与用量', out.text === '{"title":"银杏"}' && out.usage.total_tokens === 321);
t('带上模型名', out.model === 'deepseek-flash');

calls.length = 0;
responder = (n) => (n === 1
  ? response(400, JSON.stringify({ error: { message: 'response_format is not supported' } }))
  : response(200, okBody('{"title":"重试成功"}')));
out = await AI.chat([{ role: 'user', content: 'hi' }], { json: true });
t('不支持 response_format 时自动重试一次', calls.length === 2, '调用次数 ' + calls.length);
t('重试时摘掉了 response_format', calls[1].body.response_format === undefined);
t('重试成功后正常返回', /重试成功/.test(out.text));

calls.length = 0;
responder = () => response(401, JSON.stringify({ error: { message: 'Authentication Fails' } }));
await AI.chat([{ role: 'user', content: 'hi' }]).then(
  () => t('401 会抛错而不是静默', false),
  (e) => t('401 会抛错并带出服务端原因', /401/.test(e.message) && /Authentication Fails/.test(e.message), e.message)
);
t('401 不触发无意义的重试', calls.length === 1, '调用次数 ' + calls.length);

responder = () => new TypeError('Failed to fetch');
await AI.chat([{ role: 'user', content: 'hi' }]).then(
  () => t('网络失败会被翻译成人话', false),
  (e) => t('网络失败会被翻译成人话', /连不上 DeepSeek/.test(e.message), e.message)
);

calls.length = 0;
AI.clearConfig();
await AI.chat([{ role: 'user', content: 'hi' }]).then(
  () => t('没配 Key 时直接拒绝', false),
  (e) => t('没配 Key 时提示去设置里填', /设置/.test(e.message) && calls.length === 0, e.message)
);

console.log('\n== 8. 连通性自检 ==');
AI.writeConfig({ apiKey: 'sk-test-1234567890' });
calls.length = 0;
responder = () => response(200, okBody('可用'));
const tested = await AI.testConnection();
t('测试连接返回模型与耗时', tested.ok === true && tested.model === 'deepseek-flash' && tested.ms >= 0);
t('自检请求很小（省额度）', calls[0].body.max_tokens === 16 && calls[0].body.response_format === undefined);

console.log('\n== 9. 取消 ==');
calls.length = 0;
const ctrl = new AbortController();
ctrl.abort();
await AI.imageToArticle({ imageId: 'img-1', signal: ctrl.signal }).then(
  () => t('已取消的 signal 会中断请求', false),
  (e) => t('已取消的 signal 会中断请求并说明原因', /取消|超时/.test(e.message), e.message)
);

console.log('\n== 10. 端到端：图片 → 草稿 ==');
calls.length = 0;
responder = () => response(200, okBody(JSON.stringify({
  title: '雨后的小巷', summary: '一次雨后散步的记录。', tags: ['随拍', '城市'],
  alt: '雨后的湿漉漉小巷', body: '## 出发\n\n雨刚停。\n\n## 巷子\n\n石板还亮着。'
})));
const stages = [];
const result = await AI.imageToArticle({ imageId: 'img-1', imageName: 'photo.jpg', onStage: (s) => stages.push(s) });
t('开始前先报「准备图片」', stages[0] === 'prepare');
t('发请求前报「生成中」', stages.indexOf('generate') !== -1, stages.join(','));
t('请求里带了 base64 图片', calls[0].body.messages[1].content[1].image_url.url === 'data:image/jpeg;base64,SMALL');
t('拿回可直接入库的草稿', result.article.title === '雨后的小巷' && result.article.status === 'draft');
t('配图自动放进正文开头', result.article.body.indexOf('![雨后的湿漉漉小巷](img://img-1)') === 0, result.article.body.slice(0, 40));
t('标签一并解析出来', result.article.tags.join('|') === '随拍|城市');

responder = () => response(200, okBody('我觉得这张图很漂亮，但我不打算给你 JSON'));
await AI.imageToArticle({ imageId: 'img-1' }).then(
  () => t('模型不吐 JSON 时明确失败', false),
  (e) => t('模型不吐 JSON 时给出可重试的报错', /JSON/.test(e.message), e.message)
);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
console.log('');
process.exit(fail ? 1 : 0);
