// CSS 静态校验：
//   · 括号/注释是否闭合
//   · 每个 var(--x) 是否真的有定义（含主题块与继承）
//   · 规则块是否出现了"只写属性没写选择器"之类的结构性错误
//   · 统计各文件规模，避免样式无限膨胀
// 用法: node tools/test-css.mjs
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  'assets/css/site.css',
  'assets/css/articles.css',
  'admin/admin.css'
];

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; failures.push(name); console.log('  FAIL ' + name + (extra ? '\n         ' + extra : '')); }
}

/** 去掉注释（保留换行以便报行号） */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** 括号平衡检查，返回出错行号 */
function checkBraces(css) {
  const src = stripComments(css);
  let depth = 0, line = 1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\n') line++;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth < 0) return { ok: false, line, msg: '多余的 }' }; }
  }
  if (depth !== 0) return { ok: false, line, msg: '缺少 ' + depth + ' 个 }' };
  return { ok: true };
}

/** 收集所有自定义属性定义 */
function collectDefined(css) {
  const defined = new Set();
  const src = stripComments(css);
  for (const m of src.matchAll(/(^|[;{]\s*)(--[A-Za-z0-9_-]+)\s*:/g)) defined.add(m[2]);
  return defined;
}

/** 收集所有 var() 引用 */
function collectUsed(css) {
  const used = new Map();   // name -> [行号]
  const src = stripComments(css);
  const lines = src.split('\n');
  lines.forEach((l, i) => {
    for (const m of l.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
      if (!used.has(m[1])) used.set(m[1], []);
      used.get(m[1]).push(i + 1);
    }
  });
  return used;
}

/** 结构性检查：顶层必须始终是"选择器列表 + {"，逗号续行是合法的 */
function checkStructure(css) {
  const src = stripComments(css);
  const lines = src.split('\n');
  const problems = [];
  let depth = 0;
  let pending = '';          // 尚未遇到 { 的顶层文本（可能是跨行的选择器列表）

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    let l = raw;
    if (depth === 0) {
      // 逐字符扫，遇到 { 就结束一个选择器；遇到 ; 说明是无主的声明
      for (let k = 0; k < l.length; k++) {
        const c = l[k];
        if (c === '{') {
          const sel = (pending + l.slice(0, k)).trim();
          if (!sel) problems.push('第 ' + lineNo + ' 行：空的规则块');
          pending = '';
          l = l.slice(k + 1);
          k = -1;
          depth = 1;
          break;                       // 进入块内，本行剩余部分由下面统一计账
        }
        if (c === ';' && (pending + l.slice(0, k)).trim()) {
          problems.push('第 ' + lineNo + ' 行：顶层出现游离声明 → ' + (pending + l.slice(0, k)).trim().slice(0, 60));
          pending = '';
          l = l.slice(k + 1);
          k = -1;
        }
      }
      if (depth === 0) { pending += l; return; }
    }
    // 块内：只统计括号深度
    for (const c of l) {
      if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    if (depth < 0) { problems.push('第 ' + lineNo + ' 行：多余的 }'); depth = 0; }
  });

  if (pending.trim()) problems.push('文件末尾有多余内容：' + pending.trim().slice(0, 60));
  return problems;
}

const allCss = (await Promise.all(FILES.map((f) => readFile(resolve(ROOT, f), 'utf8')))).join('\n');
const defined = collectDefined(allCss);

console.log('\n== 1. 每个文件的括号 ==');
for (const f of FILES) {
  const css = await readFile(resolve(ROOT, f), 'utf8');
  const r = checkBraces(css);
  t(f + ' 括号闭合', r.ok, r.msg ? r.msg + '（约第 ' + r.line + ' 行）' : '');
}

console.log('\n== 2. 自定义属性引用 ==');
let missing = 0;
for (const f of FILES) {
  const css = await readFile(resolve(ROOT, f), 'utf8');
  const used = collectUsed(css);
  for (const [name, lines] of used) {
    // --nav-h 等由 :root 定义；只要在任一文件里定义过即可
    if (!defined.has(name)) {
      missing++;
      t(f + ' 变量 ' + name + ' 已定义', false, '用于第 ' + lines.slice(0, 4).join(', ') + ' 行');
    }
  }
}
if (!missing) t('所有 var(--x) 都有定义（共 ' + defined.size + ' 个令牌）', true);

console.log('\n== 3. 结构性检查 ==');
for (const f of FILES) {
  const css = await readFile(resolve(ROOT, f), 'utf8');
  const problems = checkStructure(css);
  t(f + ' 无顶层游离属性', problems.length === 0, problems.join('\n'));
}

console.log('\n== 4. 设计令牌完整性 ==');
const REQUIRED = ['--bg', '--bg-soft', '--surface-1', '--surface-2', '--surface-3',
  '--panel', '--panel-hover', '--panel-solid', '--border', '--border-soft', '--border-strong',
  '--text', '--text-2', '--text-muted', '--text-faint',
  '--accent', '--accent-2', '--accent-3', '--accent-soft', '--glow',
  '--danger', '--ok', '--warn', '--info',
  '--shadow-sm', '--shadow-md', '--shadow',
  '--fs-xs', '--fs-sm', '--fs-base', '--fs-md', '--fs-lg', '--fs-xl',
  '--sp-1', '--sp-7', '--r-xs', '--r-2xl', '--r-full',
  '--ease-out', '--ease-soft', '--ease-in-out', '--dur-1', '--dur-2', '--dur-3'];
for (const name of REQUIRED) {
  t('令牌 ' + name + ' 已定义', defined.has(name));
}

// 两套主题都要完整覆盖关键颜色
console.log('\n== 5. 明暗两套主题覆盖 ==');
const siteCss = await readFile(resolve(ROOT, 'assets/css/site.css'), 'utf8');
function blockFor(selector) {
  const src = stripComments(siteCss);
  const i = src.indexOf(selector);
  if (i === -1) return '';
  const start = src.indexOf('{', i);
  let depth = 0, j = start;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, j + 1);
}
const darkBlock = blockFor('[data-theme="dark"]');
const lightBlock = blockFor('[data-theme="light"]');
t('暗色主题块存在', darkBlock.length > 200);
t('亮色主题块存在', lightBlock.length > 200);
for (const name of ['--bg', '--surface-2', '--text', '--text-2', '--text-muted', '--accent', '--border', '--nav-bg', '--danger', '--ok', '--info', '--warn']) {
  t('  明/暗都定义了 ' + name,
    new RegExp('\\' + name + '\\s*:').test(darkBlock) && new RegExp('\\' + name + '\\s*:').test(lightBlock),
    '暗色:' + new RegExp('\\' + name + '\\s*:').test(darkBlock) + ' 亮色:' + new RegExp('\\' + name + '\\s*:').test(lightBlock));
}

console.log('\n== 6. 规模 ==');
let total = 0;
for (const f of FILES) {
  const s = await stat(resolve(ROOT, f));
  total += s.size;
  const lines = (await readFile(resolve(ROOT, f), 'utf8')).split('\n').length;
  console.log('       ' + f.padEnd(26) + (s.size / 1024).toFixed(1) + ' KB / ' + lines + ' 行');
}
console.log('       合计 ' + (total / 1024).toFixed(1) + ' KB');
t('样式总量在合理范围（< 80 KB）', total < 80 * 1024, (total / 1024).toFixed(1) + ' KB');

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (failures.length) console.log('失败项: ' + failures.slice(0, 12).join(' | '));
console.log('');
process.exit(fail ? 1 : 0);
