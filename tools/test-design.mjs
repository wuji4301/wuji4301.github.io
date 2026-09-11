// 设计令牌质量校验：把 site.css 里的主题块解析出来，计算 WCAG 对比度，
// 并检查间距/字号阶梯是否单调、圆角是否成体系。
// 这比"看起来差不多"可靠：对比度是能算的，改配色时最容易悄悄踩坑。
// 用法: node tools/test-design.mjs
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; failures.push(name); console.log('  FAIL ' + name + (extra ? '\n         ' + extra : '')); }
}
function note(msg) { console.log('  note ' + msg); }

/* ------------------------------------------------------------ 颜色工具 */

/** 解析 #rgb / #rrggbb / rgba(r,g,b,a) / rgb(...) */
function parseColor(v) {
  const s = String(v || '').trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const h = m[1];
    return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 1 };
  }
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  return null;
}

/** 半透明颜色叠在底色上（模拟实际观感） */
function flatten(fg, bg) {
  const a = fg.a === undefined ? 1 : fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1
  };
}

function relLum(c) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

function contrast(a, b) {
  const l1 = relLum(a), l2 = relLum(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/* ------------------------------------------------- 提取主题令牌 */

const css = await readFile(resolve(ROOT, 'assets/css/site.css'), 'utf8');
const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');

function themeVars(selector) {
  const i = clean.indexOf(selector);
  if (i === -1) return {};
  const start = clean.indexOf('{', i);
  let depth = 0, j = start;
  for (; j < clean.length; j++) {
    if (clean[j] === '{') depth++;
    else if (clean[j] === '}') { depth--; if (depth === 0) break; }
  }
  const body = clean.slice(start + 1, j);
  const vars = {};
  for (const m of body.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g)) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

/** 跟随别名（--panel: var(--surface-2) 这类） */
function resolveVar(vars, name, seen) {
  seen = seen || new Set();
  if (seen.has(name)) return null;
  seen.add(name);
  const v = vars[name];
  if (v === undefined) return null;
  const m = /^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/.exec(v);
  if (m) return resolveVar(vars, m[1], seen);
  return v;
}

/** 把值里内嵌的 var() 全部展开（用于解析 linear-gradient 这类复合值） */
function expandVars(vars, value, seen) {
  seen = seen || new Set();
  return String(value).replace(/var\(\s*(--[A-Za-z0-9_-]+)\s*\)/g, (full, name) => {
    if (seen.has(name)) return full;
    seen.add(name);
    const v = vars[name];
    if (v === undefined) return full;
    return expandVars(vars, v, seen);
  });
}

const themes = {
  dark: themeVars('[data-theme="dark"]'),
  light: themeVars('[data-theme="light"]')
};

console.log('\n== 1. 主题令牌解析 ==');
t('暗色令牌数量 ≥ 30', Object.keys(themes.dark).length >= 30, '实际 ' + Object.keys(themes.dark).length);
t('亮色令牌数量 ≥ 30', Object.keys(themes.light).length >= 30, '实际 ' + Object.keys(themes.light).length);

/* ------------------------------------------------- 对比度检查 */

/**
 * 检查某主题下 前景/背景 的对比度。
 * 背景若半透明，会先叠加到页面底色上——这才是用户真正看到的颜色。
 */
function checkContrast(themeName, fgName, bgName, min, label) {
  const vars = themes[themeName];
  const pageRaw = parseColor(resolveVar(vars, '--bg'));
  const fgRaw = parseColor(resolveVar(vars, fgName));
  const bgRaw = parseColor(resolveVar(vars, bgName));
  if (!fgRaw || !bgRaw || !pageRaw) {
    t(`[${themeName}] ${label}：颜色可解析`, false, `${fgName}=${resolveVar(vars, fgName)} ${bgName}=${resolveVar(vars, bgName)}`);
    return 0;
  }
  // 绘制顺序：page 打底 → bg 叠加 → fg 叠加
  const bgOnPage = flatten(bgRaw, pageRaw);
  const fgOnBg = flatten(fgRaw, bgOnPage);
  const ratio = contrast(fgOnBg, bgOnPage);
  t(`[${themeName}] ${label} 对比度 ≥ ${min}:1（实际 ${ratio.toFixed(2)}:1）`, ratio >= min,
    `${fgName} 在 ${bgName} 上`);
  return ratio;
}

console.log('\n== 2. 正文与标题对比度（WCAG AA：正文 4.5，大字 3.0） ==');
for (const th of ['dark', 'light']) {
  checkContrast(th, '--text', '--bg', 4.5, '一级文字 / 页面底色');
  checkContrast(th, '--text-2', '--bg', 4.5, '正文文字 / 页面底色');
  checkContrast(th, '--text-2', '--surface-2', 4.5, '正文文字 / 面板');
  checkContrast(th, '--text-muted', '--bg', 3.0, '次要文字（大字/辅助）');
}

console.log('\n== 3. 交互元素对比度 ==');
for (const th of ['dark', 'light']) {
  checkContrast(th, '--danger', '--bg', 3.0, '危险色');
  checkContrast(th, '--ok', '--bg', 3.0, '成功色');
  checkContrast(th, '--info', '--bg', 3.0, '信息色');
  checkContrast(th, '--accent-2', '--bg', 3.0, '链接色');
}

console.log('\n== 4. 渐变按钮上的文字 ==');
/** 取出渐变里所有色标 */
function gradStops(vars, name) {
  const grad = expandVars(vars, resolveVar(vars, name) || '');
  return [...grad.matchAll(/(#[0-9a-f]{3,6}|rgba?\([^)]*\))/gi)]
    .map((m) => parseColor(m[1])).filter(Boolean);
}
for (const th of ['dark', 'light']) {
  const vars = themes[th];
  const onGrad = parseColor(resolveVar(vars, '--on-grad'));
  t(`[${th}] --on-grad 可解析`, !!onGrad, resolveVar(vars, '--on-grad'));

  // 主按钮与品牌按钮共用同一组端点，文字色也必须一致
  const acc = gradStops(vars, '--grad-accent');
  t(`[${th}] 主按钮渐变可解析`, acc.length >= 2, resolveVar(vars, '--grad-accent'));
  if (acc.length && onGrad) {
    const worst = Math.min(...acc.map((c) => contrast(onGrad, c)));
    t(`[${th}] 主按钮文字对比度 ≥ 4.5:1（实际 ${worst.toFixed(2)}:1）`, worst >= 4.5,
      acc.map((c) => `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`).join(' → '));
  }

  const brand = gradStops(vars, '--grad-brand');
  t(`[${th}] 品牌按钮渐变可解析`, brand.length >= 2, resolveVar(vars, '--grad-brand'));
  if (brand.length && onGrad) {
    const worst = Math.min(...brand.map((c) => contrast(onGrad, c)));
    t(`[${th}] 品牌按钮文字对比度 ≥ 4.5:1（实际 ${worst.toFixed(2)}:1）`, worst >= 4.5,
      brand.map((c) => `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`).join(' → '));
  }
}

/* ------------------------------------------------- 阶梯单调性 */

console.log('\n== 5. 间距 / 字号阶梯 ==');
function numericScale(names, unit) {
  const vars = themeVars(':root,');
  void vars;
  const all = themeVars(':root');   // 第二个 :root 块（排版令牌）
  return names.map((n) => {
    const v = resolveVar(all, n) || resolveVar(themes.dark, n);
    const num = v ? parseFloat(v) : NaN;
    return { name: n, value: num, raw: v, unit };
  });
}

const sp = ['--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6', '--sp-7'];
// 排版令牌在 :root（无选择器前缀）块里，单独提取
const bareRoot = (function () {
  const i = clean.indexOf(':root {');
  const start = clean.indexOf('{', i);
  let depth = 0, j = start;
  for (; j < clean.length; j++) {
    if (clean[j] === '{') depth++;
    else if (clean[j] === '}') { depth--; if (depth === 0) break; }
  }
  const body = clean.slice(start + 1, j);
  const vars = {};
  for (const m of body.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
})();

const spVals = sp.map((n) => parseFloat(bareRoot[n]));
t('间距阶梯完整', spVals.every((v) => !isNaN(v)), JSON.stringify(bareRoot));
t('间距单调递增', spVals.every((v, i) => i === 0 || v > spVals[i - 1]), spVals.join(' < '));

const fs = ['--fs-xs', '--fs-sm', '--fs-base', '--fs-md', '--fs-lg', '--fs-xl'];
const fsVals = fs.map((n) => parseFloat(bareRoot[n]));
t('字号阶梯完整', fsVals.every((v) => !isNaN(v)), JSON.stringify(fs.map((n) => bareRoot[n])));
t('字号单调递增', fsVals.every((v, i) => i === 0 || v > fsVals[i - 1]), fsVals.join(' < '));
t('正文字号 ≥ 13.5px', fsVals[2] >= 13.5, String(fsVals[2]));

const radii = ['--r-xs', '--r-sm', '--r-md', '--r-lg', '--r-xl', '--r-2xl'];
const rVals = radii.map((n) => parseFloat(bareRoot[n]));
t('圆角阶梯完整', rVals.every((v) => !isNaN(v)), JSON.stringify(radii.map((n) => bareRoot[n])));
t('圆角单调递增', rVals.every((v, i) => i === 0 || v > rVals[i - 1]), rVals.join(' < '));

const durs = ['--dur-1', '--dur-2', '--dur-3'].map((n) => parseFloat(bareRoot[n]));
t('动效时长 ≤ 400ms（不会显得迟钝）', durs.every((v) => v <= 0.4), durs.join(' / '));

/* ------------------------------------------------- 可访问性杂项 */

console.log('\n== 6. 可访问性细节 ==');
const articlesCss = await readFile(resolve(ROOT, 'assets/css/articles.css'), 'utf8');
// 后台专用组件已经搬到 admin/admin.css（公开页面不再下载这些样式）
const adminCss = await readFile(resolve(ROOT, 'admin/admin.css'), 'utf8');
t('定义了 :focus-visible 样式', /:focus-visible/.test(clean));
t('焦点轮廓有偏移（不贴边）', /outline-offset/.test(clean));
t('有跳到主内容的跳转链接样式', /\.skip-link/.test(clean));
t('复选框自绘（跨浏览器一致）', /input\[type="checkbox"\]:checked/.test(clean));
t('滚动条已主题化', /scrollbar-color/.test(clean) && /::-webkit-scrollbar/.test(clean));
t('选中文本有主题色', /::selection/.test(clean));
t('触屏禁用 hover 位移', /@media \(hover: none\)/.test(clean));
t('长文本换行保护', /overflow-wrap:\s*break-word/i.test(css) || /overflow-wrap:\s*break-word/i.test(articlesCss));

console.log('\n== 7. 组件覆盖 ==');
for (const sel of ['.post-card', '.post-title', '.post-summary', '.post-meta',
  '.prose h2', '.prose blockquote', '.prose table', '.code-head', '.toc',
  '.editor-shell', '.toolbar', '.tb-btn', '.wj-editor', '.md-source',
  '.admin-table', '.stat-card', '.cmd', '.case', '.summary']) {
  const present = css.includes(sel) || articlesCss.includes(sel) || adminCss.includes(sel);
  t('已定义 ' + sel, present);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (failures.length) console.log('失败项: ' + failures.join(' | '));
console.log('');
process.exit(fail ? 1 : 0);
