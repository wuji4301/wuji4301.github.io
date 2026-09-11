# 无极 · 博客

个人静态博客，托管在 GitHub Pages。**无构建步骤、无第三方运行时依赖**：所有代码都是原生
HTML / CSS / JavaScript，公式引擎 KaTeX 也自托管在 `vendor/`。

架构上分成互不重叠的两半：

```
┌─────────────────────────── 公开前台（部署到服务器） ───────────────────────────┐
│  访客能看到的：首页 · 文章列表 · 文章阅读                                        │
│  index.html  articles.html  article.html                                      │
│  assets/{css,js}  vendor/katex  articles/  articles-data.js                   │
└───────────────────────────────────────────────────────────────────────────────┘
                                    ▲
                    发布：node tools/publish.mjs <发布包>
                                    │
┌─────────────────── 本地管理系统（作者本机，绝不部署） ─────────────────────────┐
│  admin/index.html   管理外壳：hash 路由到概览 / 文章 / 图片 / 发布 / 设置五个视图  │
│  admin/editor.html  编辑器：Markdown / 富文本双模式、LaTeX、图片                 │
│  admin/selftest.html 浏览器端全链路自测                                        │
│  admin/js/          后台模块（外壳、各视图、编辑器页逻辑）                        │
│  tools/             发布、部署、测试脚本                                        │
└───────────────────────────────────────────────────────────────────────────────┘
```

## 页面

| 页面 | 路径 | 面向 | 是否部署 |
| --- | --- | --- | --- |
| 首页 | `index.html` | 访客 | ✅ |
| 文章列表 | `articles.html` | 访客 | ✅ |
| 文章阅读 | `article.html?id=<文章id>` | 访客 | ✅ |
| **管理系统** | `admin/index.html` | 作者本机 | ❌ |
| **编辑器** | `admin/editor.html[?id=<文章id>]` | 作者本机 | ❌ |
| **自测** | `admin/selftest.html` | 作者本机 | ❌ |

文章可以导出成 PDF：阅读页的「导出 PDF」、编辑器导出面板里的「导出 PDF」、管理系统行内的
「PDF」都会调起浏览器打印 —— 在打印对话框里把「目标」选成 **另存为 PDF** 即可。

## 怎么用

**管理后台直接双击 `admin/index.html`**，不需要启动任何服务器。

```
写新文章  →  admin/editor.html        编辑、预览（自动保存到 IndexedDB）
打包发布  →  admin/index.html「发布中心」点「打包发布」下载 articles-publish.json
本地落地  →  node tools/publish.mjs "<下载目录>/articles-publish.json"
提交发布  →  git add -A && git commit -m "更新文章" && git push
```

`publish.mjs` 会写 `articles/<id>.json`、更新 `articles/index.json`、重建
`articles-data.js`——三份产物一次到位。默认**只发布 `status: published` 的文章**，
草稿需要显式加 `--include-drafts`。先看会发生什么可以加 `--dry-run`。

### 删除文章

删除**不区分线上线下**：后台任意文章都能直接删。但浏览器改不了磁盘上的仓库文件，
所以点删除只是记一个「删除标记」（id）——文章立刻从后台列表消失，**公开站点仍然看得到**，
直到下面这条命令落地并推送：

```
后台删除  →  文章列表 / 编辑器里点「删除」
本地落地  →  node tools/publish.mjs --delete <id>[,<id>...]   （「发布」视图里可复制）
提交发布  →  git add -A && git commit -m "删除文章" && git push
```

落地时命中的 id 会被从 `articles/index.json` 剔除、`articles/<id>.json` 删除，
`articles-data.js` 一并重建。不想用命令也可以走发布包（标记随包携带）：

```
打包发布  →  发布中心「打包发布」下载 articles-publish.json
本地落地  →  node tools/publish.mjs "<下载目录>/articles-publish.json"
```

`--delete` 支持一次多个 id，先加 `--dry-run` 可以只看会删什么：

几条约定：

- 同一 id 同时出现在 `articles` 与 `deletions` 里时，**以发布为准**（不会误删刚发布的文章）；
- 删除清单里没有的 id 会静默跳过，不报错；
- 标记可在后台「发布」视图里逐条「撤销删除」或「全部恢复」；
- 删除标记会在列表刷新时自愈：仓库里已经不存在的 id 自动出列，不会无限堆积；
- 想彻底重来，在「设置」里清空本地数据即可让被删的线上文章重新出现。

### 直接本地运行（无需服务器）

文章数据提供两份等价形式：

- `articles/index.json` + `articles/<id>.json` —— **真源**，供公开站点通过 HTTP 读取，可直接 `git diff`；
- `articles-data.js` —— 同一份数据生成成的普通 `<script>`，让页面在 `file://` 协议下
  也能读到文章（`fetch` 在 `file://` 下会被浏览器拦截，`<script>` 不会）。

因此**双击任意 HTML 都能用**：公开页面与 `admin/` 下的管理页面在 `file://` 下都正常，
公式、图片、文章列表都不受影响。`tools/test-data.mjs` 会持续校验两份数据是否同源。

## 前后端为什么能隔离

不是靠"藏起来"，而是靠**物理不部署 + 白名单拷贝**：

1. **目录分离**：管理系统的全部文件在 `admin/`，开发工具在 `tools/`；
2. **部署白名单**：`tools/deploy.mjs` 只拷贝根目录的三个公开页面 + `assets/`、`vendor/katex/`、
   `articles*`，拷完还会**反向扫描**，确认产物里既没有 `admin/`、`tools/` 目录，
   也没有任何指向它们的链接；
3. **公开页面零引用**：`tools/test-assets.mjs` 会对三个公开页面逐条断言
   —— 不含 `admin/` 链接、不含 `editor.html` / `selftest.html`、脚本里也没有编辑器跳转；
4. **不索引**：管理页面带 `noindex`，`robots.txt` 另外声明 `Disallow: /admin/`、`/tools/`。

想确认线上会是什么样：

```bash
node tools/deploy.mjs --clean     # 生成 deploy/ 并做隔离校验
```

然后直接双击 `deploy/index.html` 预览。校验不通过会以非 0 退出码报错，可以放心接进 CI。

## 开发蓝本

### 1. 展示只读仓库，本地层只属于后台

纯静态站没有后端，因此把"文章"拆成两层，并让它们各管各的：

- **仓库层**（`articles/*.json`）：已发布的文章，所有访客都能读到；
- **本地层**（作者浏览器 IndexedDB）：草稿、未发布的修改、图片二进制，只有作者能看到。

公开页面（首页 / 列表页 / 阅读页）统一用 `assets/js/blog.js` 这一层**只读**仓库数据：
它不引入 IndexedDB，也没有任何编辑、导入导出逻辑——展示与后台写作彻底解耦。
`admin/` 里的管理系统才加载 `assets/js/store.js`，由它负责本地记录覆盖、图片
blob 解析、打包导出等写操作。作者想改一篇已发布文章时，先在后台本地预览效果，
满意后再导出提交，仓库文件在主动提交前完全不受影响。

### 2. 为什么正文用 Markdown 存

编辑器界面是 contenteditable（产生 HTML），但落盘统一转成 **Markdown**：

- 可读：出问题用任何编辑器打开都能看懂；
- 可 diff：`git diff` 精确到词，而不是整段 HTML 抖动；
- 不锁死：换渲染器或迁移到别的静态站点生成器都不用重写内容。

双向转换在 `assets/js/convert.js`。编辑器词汇表是受控的（段落、标题、列表、任务列表、
引用、代码块、表格、分割线、链接、图片、行内/块级公式），其余标签在转换时被"提升"为
其子节点，保证不丢文字。

### 3. 图片为什么不内联

把图片转 base64 塞进 JSON 会让文件迅速膨胀、diff 失去意义。因此：

- 二进制存 IndexedDB 的 `images` 表；
- 正文里只写短引用 `img://<id>`；
- 渲染时解析成 `blob:` URL 显示；
- 导出时落盘为 `articles/img/<id>.<ext>`，并把引用改成相对路径。

### 4. 公式

KaTeX 0.16.11 自托管于 `vendor/katex/`（65 个文件，约 1.35 MiB，含 woff2/woff/ttf 字体），
**不请求任何 CDN**，断网也能正常排版。

渲染器把公式输出成 `<span class="math-tex math-inline|math-block" data-tex="…">` 占位，
再由 `assets/js/math.js` 用 KaTeX 精确排版这些元素。没有使用 KaTeX 的 auto-render 插件：
它要求单一根元素，且会全文扫描 `$...$`（容易误伤代码块里的美元号）；按 `data-tex`
定点渲染的作用域更准确。公式语法有误时显示红色提示而不是让整页崩掉。

由于管理页面位于 `admin/` 子目录，`math.js`、`store.js` 与 `blog.js` 都会**从自身 `src`
反推资源前缀**（`math.js` / `store.js` 另配合 `<script data-wj-asset-base="../">`），
因此同一份脚本在根目录与 `admin/` 子目录都能正确加载字体与数据。

### 5. 导出 PDF 为什么走打印通道

阅读页、编辑器、管理系统三处的「导出 PDF」用的是同一份 `assets/js/export-pdf.js`：
把文章渲染进一个**只在打印媒体里可见**的容器（`.wj-print-root`），再调起浏览器打印，
由使用者在打印对话框里选「另存为 PDF」。

- **不引库**：jsPDF / html2canvas 这类方案要额外几百 KB，且与"无第三方运行时依赖"冲突；
- **要矢量**：截图是位图，文字不能选中检索、放大会发虚；走打印得到的是矢量 PDF，
  公式、代码、表格都能选中与复制；
- **要浅底**：站点默认深色主题，直接送进打印机是"黑底白字"，所以容器自带
  `data-theme="light"`，无论当前是哪个主题都按亮色令牌渲染；
- **要就地可用**：容器里的 `img://<id>` 会在导出前解析成 `blob:` URL、相对路径补上
  站点前缀，并等图片解码完成后再打印（本地图片缺失就直接摘掉，不留破图框）；
- **不劫持**：只有点了导出按钮（`<html>` 临时挂 `.wj-printing`）才接管整页排版，
  用户自己按 Ctrl/⌘+P 仍然打印页面原本的样子。

## 目录结构

```
├── index.html            首页（公开）
├── articles.html         文章列表（公开）
├── article.html          文章阅读（公开）
├── articles-data.js      由 articles/ 生成，供 file:// 直接读取
├── robots.txt            声明不抓取 /admin/ 与 /tools/
├── sitemap.xml
├── .nojekyll
├── articles/             文章数据（"文件即数据"）
│   ├── index.json        清单：元信息 + file 指针
│   └── <id>.json         单篇正文
├── assets/
│   ├── css/site.css      共享设计系统（主题变量、导航、按钮、卡片…）
│   ├── css/articles.css  文章列表 / 阅读排版 / 编辑器 / 弹窗
│   └── js/
│       ├── blog.js       公开阅读层（只读文章数据、渲染卡片与元信息）
│       ├── store.js      后台数据层（IndexedDB 本地库、导入导出，仅 admin/ 使用）
│       ├── markdown.js   Markdown 渲染器（含轻量语法高亮）
│       ├── math.js       KaTeX 排版层
│       ├── convert.js    HTML ⇄ Markdown 双向转换
│       ├── editor.js     编辑器
│       ├── ui.js         提示条 / 弹窗 / 复制
│       ├── site.js       站点公共行为
│       └── export-pdf.js 导出 PDF（渲染进打印容器，前台与后台共用）
├── vendor/katex/         自托管公式引擎
├── admin/                ★ 本地管理系统（不部署）
│   ├── index.html        管理外壳（侧栏 + hash 路由）
│   ├── editor.html       编辑器
│   ├── selftest.html     浏览器端自测
│   ├── admin.css         后台设计系统（仅后台加载）
│   ├── js/
│   │   ├── shell.js      后台外壳与数据层（路由、公共渲染助手）
│   │   ├── dashboard.js  概览视图
│   │   ├── articles.js   文章管理视图
│   │   ├── images.js     图片库视图
│   │   ├── publish.js    发布中心视图
│   │   ├── settings.js   设置视图
│   │   └── editor-page.js 编辑器页面逻辑
│   └── README.md
└── tools/                ★ 本地工具（不部署）
    ├── publish.mjs       发布包 → articles/（含删除标记落地）
    ├── deploy.mjs        生成部署目录 + 隔离校验
    ├── build-articles.mjs 生成 articles-data.js
    ├── fetch-katex.mjs   自托管 KaTeX
    └── test-*.mjs        自动化测试
```

## 测试

```bash
node tools/test-render.mjs     # Markdown 渲染器（88 项，自带极简 DOM 垫片）
node tools/test-convert.mjs    # HTML ⇄ Markdown 往返（84 项）
node tools/test-katex.mjs      # 真实 KaTeX 排版仓库文章 + 内置样本公式（28 项）
node tools/test-css.mjs        # 样式括号/变量/结构/令牌完整性（66 项）
node tools/test-design.mjs     # WCAG 对比度、阶梯单调性、可访问性细节（63 项）
node tools/test-assets.mjs     # 资源/脚本/隔离/路径前缀（90 项）
node tools/test-data.mjs       # 嵌入式数据与 JSON 真源同源（13 项）
node tools/test-publish.mjs    # 发布链路端到端，含删除标记、dry-run 与错误处理（59 项）
node tools/test-store.mjs      # 数据层：删除标记、刷新后持久化、自愈（21 项，自带 IndexedDB 垫片）
```

共 **512 项断言**。`test-publish.mjs` 会完整备份并还原 `articles/`，跑完不留痕迹。

`test-katex.mjs` 与 `test-data.mjs` 的项数随仓库文章数增减（当前仓库为空，故为 28 / 13）；
其余各项与文章内容无关。`test-store.mjs` 用文件内固定样本注入仓库侧数据，仓库清空也不会变红。

浏览器端全链路自测：直接双击 `admin/selftest.html`。它在真实 DOM + KaTeX + IndexedDB
环境里验证渲染、存储、编辑器保存回读、导入导出、导出 PDF 与嵌入式数据，并清理
自己创建的测试数据。

### UI 是怎么被验证的

界面质量没法靠"看起来差不多"来维护，所以关键部分做成了可计算的断言：

- **对比度**：`test-design.mjs` 会解析两套主题的令牌，把半透明色叠加到页面底色后
  计算 WCAG 对比度。正文要求 ≥ 4.5:1、次要文字与语义色 ≥ 3:1、渐变按钮上的文字 ≥ 4.5:1。
  这套检查在重构时抓到了真实缺陷——原先"紫→粉"主按钮的粉色端白字只有 **2.58:1**，
  已把渐变端点换成全部达标的配色。
- **阶梯**：间距 / 字号 / 圆角必须严格单调递增，避免出现"14px 和 14.5px 混用"这类噪音。
- **令牌**：`test-css.mjs` 确认每个 `var(--x)` 都有定义、括号与规则结构正确、
  明暗两套主题都完整覆盖关键颜色。
- **结构**：`test-assets.mjs` 断言公开页面不含任何指向本地管理系统的链接、
  `admin/` 页面在子目录里的相对路径前缀正确。

`tools/deploy.mjs` 生成部署目录后会**反向扫描**产物，确认既没有 `admin/`、`tools/`
目录，也没有指向它们的链接——校验不过就以非 0 退出码报错。

## 设计系统

样式集中在三个文件，组件一律使用令牌（`admin.css` 复用 `site.css` 的令牌，不重复定义 `:root`），不写魔法值：

| 文件 | 内容 |
| --- | --- |
| `assets/css/site.css` | 令牌 + 基础重置 + 背景层 + 导航 + 按钮 + 表单 + 标签徽标 + 卡片 + 页脚 + 弹窗 + 反馈 |
| `assets/css/articles.css` | 文章列表 + 阅读页与正文排版 + 编辑器 + 自测页 + 打印导出 |
| `admin/admin.css` | 后台专用设计系统：侧栏外壳、视图容器、统计卡片、数据表格、图片墙、危险操作区 |

令牌分五类：

- **颜色**：`--surface-1/2/3` 三级表面、四级文字（`--text` → `--text-faint`）、
  语义色（`--danger/--ok/--warn/--info` 及其 `-soft`、`-border` 变体）、渐变端点 `--grad-a/b/c`
  与配套文字色 `--on-grad`；
- **字号**：`--fs-xs` ～ `--fs-xl`；
- **间距**：`--sp-1` ～ `--sp-7`；
- **圆角**：`--r-xs` ～ `--r-2xl`、`--r-full`；
- **动效**：`--ease-out` / `--ease-soft` / `--ease-in-out` + `--dur-1/2/3`。

### 界面上的主要改进

- **首页**：Hero 收敛为单栏——一句自我介绍、一段引导文案、两个入口按钮，以及一行
  "文章总数 · 最近更新"的概览；最新文章由下方列表承载，不再用侧栏重复一遍。
- **视觉语言**：中性灰底色 + 单一强调色；主按钮是实心"墨色"面，没有霓虹渐变与发光，
  层级靠字重、字号、间距与描边区分。
- **三体运动**：首页的三体引力模拟背景保留——随机初值 + verlet 实时积分牛顿引力（物理部分未改动），
  轨迹同时驱动一段太空配乐。渲染层做了增强：深空星场与星云底、高对比三色天体（动态高光 + 冠冕）、
  粒子拖尾、分档合批的发光轨迹、低分辨率缓冲泛光，以及按实测帧率自动升降的画质档位；
  暗色主题呈现深空场景，亮色主题自动切换为透明底的浅色呈现。
- **移除的装饰**：光标光晕、磁力按钮、流光标题、网格光斑与背景浮动光斑。
- **正文排版**：字号随视口微调（`clamp`），标题层级更清晰（`h2` 用一条细分隔线收口），
  代码块与表格补齐容器样式、斑马纹与悬停高亮，引用块为浅底 + 左侧强调条。
- **交互反馈**：统一的 `:focus-visible` 焦点环、`::selection` 主题色、主题化滚动条、
  自绘复选框；hover 只改变颜色与描边，不做位移、缩放与跟随。
- **可访问性**：每个页面顶部有"跳到主要内容"链接，并响应系统的"减弱动效"偏好；
  管理页面里的表格在窄屏自动转为卡片布局，不再横向溢出。
- **后台管理系统**：左侧栏在概览 / 文章 / 图片 / 发布 / 设置五个视图间切换（hash 路由，
  刷新与前进后退都不丢位置），窄屏自动收成抽屉；统一顶栏承载当前视图标题与主题切换；
  数据表格在窄屏转为卡片，危险操作单独成区并需二次确认。
- **编辑器**：工具栏按钮分组（含分隔线）与选中态、状态指示点（已保存 / 未保存 / 失败），
  与后台共用同一套顶栏与设计令牌。


## 设计取舍备忘

- **不响应 `prefers-reduced-motion`**：动画按设备是否支持 hover 决定是否运行，
  首页三体运动始终运行。这是站点所有者的主动选择。
- **编辑器不做完整 HTML 保真**：只保证受支持词汇表的语义往返，未知标签保留文字、
  丢弃样式，避免把杂乱的外来 HTML 带进正文。
- **转义策略**：行内文本不做 Markdown 转义（否则公式里的 `$`、TeX 里的 `\` 会被破坏），
  只在**块首**对会触发块级语法的字符（`#`、`-`、`>`、`$$` 等）加反斜杠。
- **数据双份**：JSON 是真源、`articles-data.js` 是派生产物。多一份文件的代价换来
  "双击即用"，并靠 `test-data.mjs` 保证两者不会悄悄跑偏。
- **管理后台不做成服务**：它只是本地静态页面 + 一个 Node 落地脚本。不需要启停进程，
  也不引入任何服务端代码——这与"纯静态站"的定位一致。
