/* 由 tools/build-articles.mjs 自动生成，请勿手工编辑。
 * 数据来源：articles/index.json + articles/<id>.json
 * 用途：让 index.html / articles.html / article.html / editor.html
 *       在 file:// 协议下（不启动服务器）也能读取文章。
 * 变更文章后请重新运行：node tools/build-articles.mjs
 */
window.WJ_ARTICLES = [
  {
    "id": "demo-latex",
    "slug": "latex-and-markdown-guide",
    "title": "写作指南：在这个博客里用 Markdown 与 LaTeX",
    "summary": "本站文章支持 Markdown 全量常用语法与 LaTeX 数学公式。这篇文章同时是一份可对照的示例：行内与块级公式、代码高亮、表格、任务列表、引用、脚注都会在这里出现。",
    "tags": [
      "使用说明",
      "Markdown",
      "LaTeX"
    ],
    "cover": "",
    "format": "markdown",
    "status": "published",
    "pinned": true,
    "createdAt": "2026-01-05T09:00:00.000Z",
    "updatedAt": "2026-01-05T09:00:00.000Z",
    "file": "demo-latex.json",
    "body": "这是一篇**示例文章**，既用来演示排版能力，也可以当作写作速查表。正文用 Markdown 书写，公式交给自托管的 KaTeX 排版。（文章的撰写在作者本机进行，编辑器不对外公开。）\n\n## 一、基本排版\n\n普通段落直接书写即可。用 `**粗体**`、`*斜体*`、`~~删除线~~`、`` `行内代码` `` 做强调，用 `[文字](链接)` 做超链接。\n\n> 引用块适合放结论、摘录或需要被单独强调的一段话。\n>\n> 引用里也可以换行、包含 **格式** 与公式 $e^{i\\pi}+1=0$。\n\n### 列表\n\n无序列表：\n\n- 支持通过缩进做嵌套\n  - 第二层\n    - 第三层\n- 每层都会正确渲染\n\n有序列表与任务列表：\n\n1. 先写标题\n2. 再写正文\n3. 最后导出发布\n\n- [x] 已经支持任务列表\n- [x] 勾选状态会往返保留\n- [ ] 还可以继续添加\n\n## 二、数学公式\n\n行内公式用单个美元符号包裹，例如质能方程 $E = mc^2$，或者更一般的\n$\\displaystyle \\int_{\\Omega} \\nabla \\cdot \\mathbf{F}\\,\\mathrm{d}V = \\oint_{\\partial\\Omega} \\mathbf{F}\\cdot\\mathbf{n}\\,\\mathrm{d}S$。\n\n独占一行的块级公式用两个美元符号包裹：\n\n$$\n\\int_{-\\infty}^{+\\infty} e^{-x^{2}}\\,\\mathrm{d}x = \\sqrt{\\pi}\n$$\n\n线性代数与概率也都没问题：\n\n$$\nA = \\begin{pmatrix} a_{11} & a_{12} \\\\ a_{21} & a_{22} \\end{pmatrix},\\qquad\nP(A\\mid B) = \\frac{P(B\\mid A)\\,P(A)}{P(B)}\n$$\n\n分段函数：\n\n$$\nf(x) = \\begin{cases}\n  x^{2}, & x \\ge 0 \\\\\n  -x, & x < 0\n\\end{cases}\n$$\n\n> 排版引擎是自托管的 KaTeX。若公式语法有误，页面会显示红色提示而不是整页崩掉；点击编辑器里的公式胶囊可以随时改回。\n\n## 三、代码\n\n围栏代码块标明语言即可获得高亮：\n\n```js\n// 三体问题的加速度计算（节选）\nfunction accel(bodies, G, soft) {\n  const a = bodies.map(() => ({ x: 0, y: 0, z: 0 }));\n  for (let i = 0; i < bodies.length; i++) {\n    for (let j = 0; j < bodies.length; j++) {\n      if (i === j) continue;\n      const dx = bodies[j].x - bodies[i].x;\n      const d2 = dx * dx + soft * soft;\n      a[i].x += G * bodies[j].m * dx / Math.pow(d2, 1.5);\n    }\n  }\n  return a;\n}\n```\n\n```python\nimport math\n\ndef entropy(p):\n    \"\"\"香农熵，输入为概率列表\"\"\"\n    return -sum(pi * math.log2(pi) for pi in p if pi > 0)\n```\n\n## 四、表格\n\n| 语法 | 作用 | 备注 |\n| --- | --- | --- |\n| `# 标题` | 一级标题 | 最多六级 |\n| `- 项目` | 无序列表 | 缩进即嵌套 |\n| `> 引用` | 引用块 | 可嵌套 |\n| `$x$` | 行内公式 | KaTeX 排版 |\n| `$$...$$` | 块级公式 | 独占一行居中 |\n| `![alt](url)` | 图片 | 支持本地与图床 |\n\n对齐方式由分隔行决定：\n\n| 左对齐 | 居中 | 右对齐 |\n| :--- | :---: | ---: |\n| a | b | 1 |\n| 较长的内容 | c | 200 |\n\n## 五、图片\n\n图片语法与普通 Markdown 一致。本地图片用相对路径引用：\n\n```markdown\n![示意图](articles/img/example.png)\n```\n\n在作者本机的编辑器里直接**拖拽或粘贴**图片时，文件会先存进浏览器的 IndexedDB，正文里写作 `img://<id>`；导出时把它落盘到 `articles/img/<id>.<ext>`，再把引用改成上面的相对路径即可。\n\n## 六、脚注与分割线\n\n脚注用 `[^标签]` 标注[^1]，定义写在文末。\n\n---\n\n分割线以上是正文。下面这条是最后的提示：写作时不必纠结语法，编辑器的工具栏与实时预览会替你处理大部分细节。\n\n[^1]: 脚注内容会统一收集到文末，并带有回到正文的链接。\n"
  },
  {
    "id": "demo-workflow",
    "slug": "local-first-writing-workflow",
    "title": "这个博客的文章系统是怎么工作的",
    "summary": "文章数据放在仓库里供所有访客读取，撰写与编辑则完全在浏览器本地进行。本文说明这套「本地优先」结构的设计取舍，以及从写作到发布的具体步骤。",
    "tags": [
      "使用说明",
      "设计笔记"
    ],
    "cover": "",
    "format": "markdown",
    "status": "published",
    "pinned": false,
    "createdAt": "2026-01-06T10:30:00.000Z",
    "updatedAt": "2026-01-06T10:30:00.000Z",
    "file": "demo-workflow.json",
    "body": "## 为什么要这样设计\n\n这是一个托管在 GitHub Pages 上的纯静态站点：没有服务器，也没有数据库，因此不可能有「登录后台写文章」这种传统流程。\n\n但静态站有一个天然优势——**文件即数据**。于是文章系统被拆成两半：\n\n| 部分 | 存放位置 | 谁能看到 |\n| --- | --- | --- |\n| 已发布文章 | 仓库里的 `articles/*.json` | 所有访客 |\n| 草稿与本地修改 | 作者浏览器本地的 IndexedDB | 只有作者自己 |\n\n读取时，本地记录**优先覆盖**同 id 的仓库记录；因此作者可以放心地修改一篇已发布文章，先在本地预览效果，满意了再导出提交。\n\n## 数据长什么样\n\n每篇文章是一个 JSON 对象，正文以 Markdown 保存：\n\n```json\n{\n  \"id\": \"demo-workflow\",\n  \"title\": \"标题\",\n  \"slug\": \"url-friendly-name\",\n  \"summary\": \"列表页显示的摘要\",\n  \"tags\": [\"标签一\", \"标签二\"],\n  \"format\": \"markdown\",\n  \"status\": \"published\",\n  \"pinned\": false,\n  \"createdAt\": \"2026-01-06T10:30:00.000Z\",\n  \"updatedAt\": \"2026-01-06T10:30:00.000Z\",\n  \"body\": \"Markdown 正文……\"\n}\n```\n\n选择 Markdown 而不是 HTML 作为存储格式，有三个实际好处：\n\n1. **可读**：出问题时用任何编辑器打开都能看懂；\n2. **可 diff**：`git diff` 能精确到词，而不是整段 HTML 乱跳；\n3. **不锁死**：将来换渲染器或迁移到别的静态站点生成器都不用重写内容。\n\n## 图片为什么单独存\n\n把图片转成 base64 塞进 JSON 会让文件迅速膨胀——一张 300 KB 的截图编码后接近 400 KB 纯文本，diff 也会完全失去意义。\n\n所以图片走另一条路：二进制存在 IndexedDB 的 `images` 表，正文里只保留一个短引用 `img://<id>`。渲染时解析成 `blob:` URL 显示，导出时再落盘成真实文件。\n\n## 从写作到发布\n\n1. 在作者本机的编辑器页面里新建一篇文章（该页面是本地工具，不对外开放）。\n2. 写内容——工具栏、快捷键、拖拽图片、公式弹窗都可以用。编辑过程中会自动保存到本地，关掉标签页也不会丢。\n3. 点「预览」确认排版，尤其是公式和代码块。\n4. 点「导出」下载 `index.json`（正文已内联）与本地图片。\n5. 把文件提交到仓库：\n\n```bash\ngit add articles/\ngit commit -m \"新增文章\"\ngit push\n```\n\n推送后 GitHub Pages 会自动重新部署，几分钟内所有访客就能看到新文章。\n\n## 一些边界情况\n\n- **换设备或清空浏览器数据**，本地草稿会消失；已经提交到仓库的文章不受影响。\n- 文章数据同时以 `articles/*.json` 和 `articles-data.js` 两份形式提供：前者供公开站点通过 HTTP 读取，后者是普通 `<script>` 数据，**直接双击 HTML 用 `file://` 打开也能读到文章**，无需启动本地服务器。修改文章后运行 `node tools/build-articles.mjs` 重新生成即可。\n- 直接修改仓库文章后会生成一份本地副本，列表和阅读页都以副本为准；想恢复到仓库版本，删除该本地记录即可。\n\n## 小结\n\n整套结构没有引入任何第三方运行时依赖（公式引擎 KaTeX 也已自托管在 `vendor/`），因此可以完全离线使用：断网时依然能写作、预览、导出，只有「让访客看到」这一步需要联网推送。\n"
  }
];
window.WJ_ARTICLES_BY_ID = {
  "demo-latex": {
    "id": "demo-latex",
    "slug": "latex-and-markdown-guide",
    "title": "写作指南：在这个博客里用 Markdown 与 LaTeX",
    "summary": "本站文章支持 Markdown 全量常用语法与 LaTeX 数学公式。这篇文章同时是一份可对照的示例：行内与块级公式、代码高亮、表格、任务列表、引用、脚注都会在这里出现。",
    "tags": [
      "使用说明",
      "Markdown",
      "LaTeX"
    ],
    "cover": "",
    "format": "markdown",
    "status": "published",
    "pinned": true,
    "createdAt": "2026-01-05T09:00:00.000Z",
    "updatedAt": "2026-01-05T09:00:00.000Z",
    "file": "demo-latex.json",
    "body": "这是一篇**示例文章**，既用来演示排版能力，也可以当作写作速查表。正文用 Markdown 书写，公式交给自托管的 KaTeX 排版。（文章的撰写在作者本机进行，编辑器不对外公开。）\n\n## 一、基本排版\n\n普通段落直接书写即可。用 `**粗体**`、`*斜体*`、`~~删除线~~`、`` `行内代码` `` 做强调，用 `[文字](链接)` 做超链接。\n\n> 引用块适合放结论、摘录或需要被单独强调的一段话。\n>\n> 引用里也可以换行、包含 **格式** 与公式 $e^{i\\pi}+1=0$。\n\n### 列表\n\n无序列表：\n\n- 支持通过缩进做嵌套\n  - 第二层\n    - 第三层\n- 每层都会正确渲染\n\n有序列表与任务列表：\n\n1. 先写标题\n2. 再写正文\n3. 最后导出发布\n\n- [x] 已经支持任务列表\n- [x] 勾选状态会往返保留\n- [ ] 还可以继续添加\n\n## 二、数学公式\n\n行内公式用单个美元符号包裹，例如质能方程 $E = mc^2$，或者更一般的\n$\\displaystyle \\int_{\\Omega} \\nabla \\cdot \\mathbf{F}\\,\\mathrm{d}V = \\oint_{\\partial\\Omega} \\mathbf{F}\\cdot\\mathbf{n}\\,\\mathrm{d}S$。\n\n独占一行的块级公式用两个美元符号包裹：\n\n$$\n\\int_{-\\infty}^{+\\infty} e^{-x^{2}}\\,\\mathrm{d}x = \\sqrt{\\pi}\n$$\n\n线性代数与概率也都没问题：\n\n$$\nA = \\begin{pmatrix} a_{11} & a_{12} \\\\ a_{21} & a_{22} \\end{pmatrix},\\qquad\nP(A\\mid B) = \\frac{P(B\\mid A)\\,P(A)}{P(B)}\n$$\n\n分段函数：\n\n$$\nf(x) = \\begin{cases}\n  x^{2}, & x \\ge 0 \\\\\n  -x, & x < 0\n\\end{cases}\n$$\n\n> 排版引擎是自托管的 KaTeX。若公式语法有误，页面会显示红色提示而不是整页崩掉；点击编辑器里的公式胶囊可以随时改回。\n\n## 三、代码\n\n围栏代码块标明语言即可获得高亮：\n\n```js\n// 三体问题的加速度计算（节选）\nfunction accel(bodies, G, soft) {\n  const a = bodies.map(() => ({ x: 0, y: 0, z: 0 }));\n  for (let i = 0; i < bodies.length; i++) {\n    for (let j = 0; j < bodies.length; j++) {\n      if (i === j) continue;\n      const dx = bodies[j].x - bodies[i].x;\n      const d2 = dx * dx + soft * soft;\n      a[i].x += G * bodies[j].m * dx / Math.pow(d2, 1.5);\n    }\n  }\n  return a;\n}\n```\n\n```python\nimport math\n\ndef entropy(p):\n    \"\"\"香农熵，输入为概率列表\"\"\"\n    return -sum(pi * math.log2(pi) for pi in p if pi > 0)\n```\n\n## 四、表格\n\n| 语法 | 作用 | 备注 |\n| --- | --- | --- |\n| `# 标题` | 一级标题 | 最多六级 |\n| `- 项目` | 无序列表 | 缩进即嵌套 |\n| `> 引用` | 引用块 | 可嵌套 |\n| `$x$` | 行内公式 | KaTeX 排版 |\n| `$$...$$` | 块级公式 | 独占一行居中 |\n| `![alt](url)` | 图片 | 支持本地与图床 |\n\n对齐方式由分隔行决定：\n\n| 左对齐 | 居中 | 右对齐 |\n| :--- | :---: | ---: |\n| a | b | 1 |\n| 较长的内容 | c | 200 |\n\n## 五、图片\n\n图片语法与普通 Markdown 一致。本地图片用相对路径引用：\n\n```markdown\n![示意图](articles/img/example.png)\n```\n\n在作者本机的编辑器里直接**拖拽或粘贴**图片时，文件会先存进浏览器的 IndexedDB，正文里写作 `img://<id>`；导出时把它落盘到 `articles/img/<id>.<ext>`，再把引用改成上面的相对路径即可。\n\n## 六、脚注与分割线\n\n脚注用 `[^标签]` 标注[^1]，定义写在文末。\n\n---\n\n分割线以上是正文。下面这条是最后的提示：写作时不必纠结语法，编辑器的工具栏与实时预览会替你处理大部分细节。\n\n[^1]: 脚注内容会统一收集到文末，并带有回到正文的链接。\n"
  },
  "demo-workflow": {
    "id": "demo-workflow",
    "slug": "local-first-writing-workflow",
    "title": "这个博客的文章系统是怎么工作的",
    "summary": "文章数据放在仓库里供所有访客读取，撰写与编辑则完全在浏览器本地进行。本文说明这套「本地优先」结构的设计取舍，以及从写作到发布的具体步骤。",
    "tags": [
      "使用说明",
      "设计笔记"
    ],
    "cover": "",
    "format": "markdown",
    "status": "published",
    "pinned": false,
    "createdAt": "2026-01-06T10:30:00.000Z",
    "updatedAt": "2026-01-06T10:30:00.000Z",
    "file": "demo-workflow.json",
    "body": "## 为什么要这样设计\n\n这是一个托管在 GitHub Pages 上的纯静态站点：没有服务器，也没有数据库，因此不可能有「登录后台写文章」这种传统流程。\n\n但静态站有一个天然优势——**文件即数据**。于是文章系统被拆成两半：\n\n| 部分 | 存放位置 | 谁能看到 |\n| --- | --- | --- |\n| 已发布文章 | 仓库里的 `articles/*.json` | 所有访客 |\n| 草稿与本地修改 | 作者浏览器本地的 IndexedDB | 只有作者自己 |\n\n读取时，本地记录**优先覆盖**同 id 的仓库记录；因此作者可以放心地修改一篇已发布文章，先在本地预览效果，满意了再导出提交。\n\n## 数据长什么样\n\n每篇文章是一个 JSON 对象，正文以 Markdown 保存：\n\n```json\n{\n  \"id\": \"demo-workflow\",\n  \"title\": \"标题\",\n  \"slug\": \"url-friendly-name\",\n  \"summary\": \"列表页显示的摘要\",\n  \"tags\": [\"标签一\", \"标签二\"],\n  \"format\": \"markdown\",\n  \"status\": \"published\",\n  \"pinned\": false,\n  \"createdAt\": \"2026-01-06T10:30:00.000Z\",\n  \"updatedAt\": \"2026-01-06T10:30:00.000Z\",\n  \"body\": \"Markdown 正文……\"\n}\n```\n\n选择 Markdown 而不是 HTML 作为存储格式，有三个实际好处：\n\n1. **可读**：出问题时用任何编辑器打开都能看懂；\n2. **可 diff**：`git diff` 能精确到词，而不是整段 HTML 乱跳；\n3. **不锁死**：将来换渲染器或迁移到别的静态站点生成器都不用重写内容。\n\n## 图片为什么单独存\n\n把图片转成 base64 塞进 JSON 会让文件迅速膨胀——一张 300 KB 的截图编码后接近 400 KB 纯文本，diff 也会完全失去意义。\n\n所以图片走另一条路：二进制存在 IndexedDB 的 `images` 表，正文里只保留一个短引用 `img://<id>`。渲染时解析成 `blob:` URL 显示，导出时再落盘成真实文件。\n\n## 从写作到发布\n\n1. 在作者本机的编辑器页面里新建一篇文章（该页面是本地工具，不对外开放）。\n2. 写内容——工具栏、快捷键、拖拽图片、公式弹窗都可以用。编辑过程中会自动保存到本地，关掉标签页也不会丢。\n3. 点「预览」确认排版，尤其是公式和代码块。\n4. 点「导出」下载 `index.json`（正文已内联）与本地图片。\n5. 把文件提交到仓库：\n\n```bash\ngit add articles/\ngit commit -m \"新增文章\"\ngit push\n```\n\n推送后 GitHub Pages 会自动重新部署，几分钟内所有访客就能看到新文章。\n\n## 一些边界情况\n\n- **换设备或清空浏览器数据**，本地草稿会消失；已经提交到仓库的文章不受影响。\n- 文章数据同时以 `articles/*.json` 和 `articles-data.js` 两份形式提供：前者供公开站点通过 HTTP 读取，后者是普通 `<script>` 数据，**直接双击 HTML 用 `file://` 打开也能读到文章**，无需启动本地服务器。修改文章后运行 `node tools/build-articles.mjs` 重新生成即可。\n- 直接修改仓库文章后会生成一份本地副本，列表和阅读页都以副本为准；想恢复到仓库版本，删除该本地记录即可。\n\n## 小结\n\n整套结构没有引入任何第三方运行时依赖（公式引擎 KaTeX 也已自托管在 `vendor/`），因此可以完全离线使用：断网时依然能写作、预览、导出，只有「让访客看到」这一步需要联网推送。\n"
  }
};
