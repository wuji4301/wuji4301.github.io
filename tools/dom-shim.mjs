/* ==========================================================================
   极简 DOM 垫片（仅供 Node 端自动化测试使用，不进入站点产物）
   支持 convert.js / markdown.js 用到的 API：innerHTML 解析、childNodes、
   querySelector(All)、closest、classList、attributes、getComputedStyle 等。
   故意做得"够用就好"：不支持 :scope、伪类、层级选择器。
   ========================================================================== */

const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);
const KNOWN_TAGS = new Set(['div', 'p', 'span', 'a', 'strong', 'b', 'em', 'i', 'del', 's', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'hr', 'br', 'img', 'section', 'article',
  'figure', 'figcaption', 'sup', 'sub', 'kbd', 'script', 'style', 'link', 'meta', 'iframe', 'button', 'form', 'input']);

class ClassList {
  constructor(el) { this.el = el; }
  _set() {
    return new Set((this.el.getAttribute('class') || '').split(/\s+/).filter(Boolean));
  }
  _write(s) { this.el.setAttribute('class', [...s].join(' ')); }
  contains(c) { return this._set().has(c); }
  add(...cs) { const s = this._set(); cs.forEach((c) => s.add(c)); this._write(s); }
  remove(...cs) { const s = this._set(); cs.forEach((c) => s.delete(c)); this._write(s); }
  toggle(c, force) {
    const s = this._set();
    const on = force === undefined ? !s.has(c) : !!force;
    if (on) s.add(c); else s.delete(c);
    this._write(s);
    return on;
  }
  get value() { return this.el.getAttribute('class') || ''; }
}

class Attr {
  constructor(name, value) { this.name = name; this.value = value; }
}

class TextNode {
  constructor(text) { this.nodeType = 3; this.nodeValue = text; this.parentNode = null; }
  get textContent() { return this.nodeValue; }
}

class Element {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this._attrs = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.classList = new ClassList(this);
    this.style = {};
  }
  get attributes() { return [...this._attrs].map(([n, v]) => new Attr(n, v)); }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get firstElementChild() { return this.children[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }

  getAttribute(n) { return this._attrs.has(n) ? this._attrs.get(n) : null; }
  setAttribute(n, v) {
    this._attrs.set(n, String(v));
    if (n === 'style') this._parseStyle(String(v));
  }
  removeAttribute(n) { this._attrs.delete(n); if (n === 'style') this.style = {}; }
  hasAttribute(n) { return this._attrs.has(n); }

  _parseStyle(v) {
    this.style = {};
    v.split(';').forEach((part) => {
      const i = part.indexOf(':');
      if (i > 0) {
        const k = part.slice(0, i).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.style[k] = part.slice(i + 1).trim();
      }
    });
  }

  appendChild(c) { c.parentNode = this; this.childNodes.push(c); return c; }
  /** 在指定子节点前插入；若节点已在同一父节点下，先摘除再插入（真实 DOM 语义） */
  insertBefore(c, ref) {
    if (!ref) return this.appendChild(c);
    if (c.parentNode) c.parentNode.removeChild(c);
    const i = this.childNodes.indexOf(ref);
    if (i < 0) return this.appendChild(c);
    c.parentNode = this;
    this.childNodes.splice(i, 0, c);
    return c;
  }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) { this.childNodes.splice(i, 1); c.parentNode = null; }
    return c;
  }
  replaceChild(newNode, oldNode) {
    const i = this.childNodes.indexOf(oldNode);
    if (i < 0) return oldNode;
    if (newNode.parentNode) newNode.parentNode.removeChild(newNode);
    this.childNodes[i] = newNode;
    newNode.parentNode = this;
    oldNode.parentNode = null;
    return oldNode;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }

  /** 深拷贝：cloneNode(true) 的等价实现 */
  cloneNode(deep) {
    const el = new Element(this.tagName.toLowerCase());
    this._attrs.forEach((v, k) => el._attrs.set(k, v));
    el.style = Object.assign({}, this.style);
    if (deep) this.childNodes.forEach((c) => {
      el.appendChild(c.nodeType === 1 ? c.cloneNode(true) : new TextNode(c.nodeValue));
    });
    return el;
  }

  get textContent() {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this.childNodes = [];
    if (v !== '' && v != null) this.appendChild(new TextNode(String(v)));
  }
  get innerHTML() { return serialize(this); }
  set innerHTML(html) {
    this.childNodes = [];
    parseInto(this, String(html == null ? '' : html));
  }
  get outerHTML() { return serialize(this); }

  // ---- 选择器（子集）----
  matches(sel) { return sel.split(',').some((s) => matchSimple(this, s.trim())); }

  _descendants() {
    const out = [];
    const walk = (n) => n.childNodes.forEach((c) => { if (c.nodeType === 1) { out.push(c); walk(c); } });
    walk(this);
    return out;
  }
  querySelectorAll(sel) {
    const tests = sel.split(',').map((s) => s.trim()).filter(Boolean);
    return this._descendants().filter((el) => tests.some((t) => matchSimple(el, t)));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }

  closest(sel) {
    let n = this;
    while (n && n.nodeType === 1) {
      if (n.matches(sel)) return n;
      n = n.parentNode;
    }
    return null;
  }
}

function matchSimple(el, sel) {
  if (!sel) return false;
  if (sel.includes(' ')) {   // 后代选择器：a b
    const [a, b] = sel.split(/\s+/);
    return matchSimple(el, b) && !!(el.closest && el.closest(a));
  }
  const attrRe = /\[([^\]=]+)(?:([~^$*|]?=)"?([^"\]]*)"?)?\]/g;
  let m;
  let rest = sel;
  const attrs = [];
  while ((m = attrRe.exec(sel))) {
    attrs.push({ name: m[1], op: m[2], val: m[3] });
  }
  rest = rest.replace(attrRe, '');
  // :not(...) 简化为对参数取反
  const nots = [];
  rest = rest.replace(/:not\(([^)]+)\)/g, (_, inner) => { nots.push(inner); return ''; });
  rest = rest.replace(/::?[a-z-]+(\([^)]*\))?/g, '');   // 丢弃伪类/伪元素

  const classes = (rest.match(/\.[A-Za-z0-9_-]+/g) || []).map((s) => s.slice(1));
  const idMatch = /#([A-Za-z0-9_-]+)/.exec(rest);
  const tagMatch = /^([A-Za-z][A-Za-z0-9-]*)/.exec(rest.trim());

  if (tagMatch && el.tagName !== tagMatch[1].toUpperCase()) return false;
  if (idMatch && el.getAttribute('id') !== idMatch[1]) return false;
  if (classes.some((c) => !el.classList.contains(c))) return false;
  for (const a of attrs) {
    const has = el.hasAttribute(a.name);
    if (!a.op) { if (!has) return false; continue; }
    const v = el.getAttribute(a.name) || '';
    if (a.op === '=' && v !== a.val) return false;
    if (a.op === '^=' && v.indexOf(a.val) !== 0) return false;
    if (a.op === '*=' && v.indexOf(a.val) === -1) return false;
    if (a.op === '$=' && v.slice(-a.val.length) !== a.val) return false;
  }
  for (const n of nots) if (matchSimple(el, n.trim())) return false;
  return true;
}

function serialize(node) {
  if (node.nodeType === 3) return node.nodeValue;
  const tag = node.tagName.toLowerCase();
  let s = '<' + tag;
  node._attrs.forEach((v, k) => { s += ' ' + k + '="' + String(v).replace(/"/g, '&quot;') + '"'; });
  s += '>';
  if (VOID_TAGS.has(tag)) return s;
  s += node.childNodes.map(serialize).join('');
  return s + '</' + tag + '>';
}

// ---------------- 极简 HTML 解析 ----------------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: '\u00a0', apos: "'" };

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (full, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : full;
  });
}

// 隐式闭合规则：真实 HTML 解析器遇到同名兄弟的开启标签时会自动闭合前一个。
// 不实现这条，<ul><li>a</li></ul> 之类没问题，但 <ul><li>a<ul>...</ul></li></ul>
// （浏览器 contenteditable 里常见）会把嵌套列表挂错父节点。
const AUTO_CLOSE = {
  li: ['li'],
  dt: ['dt', 'dd'],
  dd: ['dt', 'dd'],
  p: ['p', 'div', 'ul', 'ol', 'table', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  tr: ['tr'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  option: ['option']
};

function parseInto(root, html) {
  const stack = [root];
  let i = 0;
  const top = () => stack[stack.length - 1];

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      const text = decodeEntities(html.slice(i));
      if (text) top().appendChild(new TextNode(text));
      break;
    }
    if (lt > i) {
      const text = decodeEntities(html.slice(i, lt));
      if (text) top().appendChild(new TextNode(text));
    }
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    const gt = html.indexOf('>', lt);
    if (gt === -1) break;
    let raw = html.slice(lt + 1, gt).trim();
    i = gt + 1;

    if (raw[0] === '/') {
      const name = raw.slice(1).trim().toLowerCase();
      for (let d = stack.length - 1; d > 0; d--) {
        if (stack[d].tagName.toLowerCase() === name) { stack.length = d; break; }
      }
      continue;
    }

    const selfClose = raw.endsWith('/') || false;
    if (selfClose) raw = raw.slice(0, -1).trim();
    const sp = raw.search(/[\s]/);
    const name = (sp === -1 ? raw : raw.slice(0, sp)).toLowerCase();
    const attrText = sp === -1 ? '' : raw.slice(sp);

    // 隐式闭合：<li> 遇到下一个 <li>、<p> 遇到块级元素等情况自动收尾
    for (let d = stack.length - 1; d > 0; d--) {
      const t = stack[d].tagName.toLowerCase();
      if (AUTO_CLOSE[t] && AUTO_CLOSE[t].indexOf(name) !== -1) {
        stack.length = d;
        continue;
      }
      break;
    }

    const el = new Element(name);
    const attrRe = /([A-Za-z_:][-A-Za-z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let am;
    while ((am = attrRe.exec(attrText))) {
      const v = am[2] !== undefined ? am[2] : (am[3] !== undefined ? am[3] : (am[4] !== undefined ? am[4] : ''));
      el.setAttribute(am[1], decodeEntities(v));
    }
    top().appendChild(el);

    const known = KNOWN_TAGS.has(name);
    if (!selfClose && !VOID_TAGS.has(name) && !(name === 'script' || name === 'style') && known) {
      stack.push(el);
    } else if (name === 'script' || name === 'style') {
      // 跳过脚本/样式内容（测试里不需要）
      const closeTag = '</' + name;
      const end = html.toLowerCase().indexOf(closeTag, i);
      i = end === -1 ? html.length : end + closeTag.length;
      const gt2 = html.indexOf('>', i - 1);
      i = gt2 === -1 ? html.length : gt2 + 1;
    }
  }
}

/** 安装到 global（即测试沙箱的 window） */
function install(win) {
  win.document = {
    createElement(tag) { return new Element(tag); },
    createTextNode(t) { return new TextNode(t); },
    _root: new Element('html'),
    get body() { return this._root; }
  };
  win.Element = Element;
  win.TextNode = TextNode;
  win.getComputedStyle = (el) => ({
    display: el && el.style && el.style.display ? el.style.display : defaultDisplay(el)
  });
  return win;
}

function defaultDisplay(el) {
  const t = el.tagName;
  if (['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'HR', 'TABLE', 'SECTION', 'ARTICLE', 'FIGURE', 'FIGCAPTION', 'TR'].includes(t)) return 'block';
  if (t === 'TD' || t === 'TH') return 'table-cell';
  if (t === 'LI') return 'list-item';
  return 'inline';
}

export { Element, TextNode, install, parseInto };
