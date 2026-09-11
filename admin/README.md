# 本地管理系统（不部署到服务器）

这个目录是**作者本机专用**的管理系统。`tools/deploy.mjs` 只拷贝公开文件，
因此这里的任何东西都不会出现在 GitHub Pages 上。

```
admin/
├── index.html      管理外壳：侧栏 + hash 路由，挂载五个视图
├── editor.html     文章编辑器：富文本 / Markdown 双模式、LaTeX、图片
├── selftest.html   全链路自测（渲染 / 存储 / 编辑器 / 导入导出 / 导出 PDF）
├── admin.css       后台设计系统（复用 site.css 令牌，仅后台加载）
├── js/
│   ├── shell.js     外壳：数据层、hash 路由、公共渲染助手
│   ├── dashboard.js 概览视图（统计、快捷入口、数据健康）
│   ├── articles.js  文章管理视图（搜索筛选排序、批量操作）
│   ├── images.js    图片库视图（引用统计、预览、复制引用、下载、删除）
│   ├── publish.js   发布中心（打包导入导出、待同步删除、部署命令）
│   ├── settings.js  设置视图（主题、存储与运行环境、数据维护）
│   └── editor-page.js 编辑器页面逻辑
└── README.md       本文件
```

主页用侧边栏 + hash 路由组织五个视图：概览、文章、图片、发布、设置。路由写在 URL 的
`#/overview`、`#/articles`、`#/images`、`#/publish`、`#/settings` 上，刷新与浏览器
前进 / 后退都会停在同一个视图；窄屏下侧栏收成抽屉。

## 怎么用

**直接双击 `index.html` 即可**，不需要启动任何服务器。所有页面都支持 `file://`：
文章数据由 `../articles-data.js` 提供，不依赖 `fetch`。

典型流程：

1. 在主页「概览」或「文章」视图点「写新文章」→ 进入编辑器；
2. 编辑过程中自动保存到浏览器 IndexedDB（关标签页也不丢）；
3. 「预览」确认排版；
4. 回到主页切到 **发布中心** 点「打包发布」，下载 `articles-publish.json`；
5. 在项目根目录执行：

```bash
node tools/publish.mjs ~/Downloads/articles-publish.json
```

该命令会把文章写进 `articles/`、重建 `articles/index.json` 与 `articles-data.js`；
之后用 `git add -A && git commit && git push` 发布。

### 删除文章

删除**不区分线上线下**，列表和编辑器里任何文章都能直接删：

1. 在「文章」视图（列表行内 / 批量操作）或编辑器里点「删除」；
2. 文章立刻从列表消失——这一步只在本地记一个**删除标记**（只记 id），仓库文件还没动；
3. 走一次「打包发布 → `node tools/publish.mjs`」：命中的 id 会从 `articles/index.json`
   剔除、`articles/<id>.json` 被删除、`articles-data.js` 重建；
4. `git add -A && git commit && git push`，线上才真正消失。

「发布」视图会列出所有**待同步删除**，可以逐条「撤销删除」或「全部恢复」。标记会在列表
刷新时自愈：仓库里已经不存在的 id 自动出列。

> 清空本地数据（「设置」视图）会连同删除标记一起清掉，被删的线上文章会重新出现；
> 已经落地到仓库的改动不受影响。

### 导出 PDF

想给文章留一份可存档、可分享的 PDF：编辑器里点「导出」→「导出 PDF」，或在主页文章列表
点行内「PDF」。它调起的是**浏览器自带的打印**，在打印对话框里把「目标」选成
**另存为 PDF** 即可（阅读页对访客也提供同一个按钮）。

产出是矢量 PDF：公式、代码、表格都能选中与检索；为便于打印，导出时一律按亮色主题排版。
实现见 `../assets/js/export-pdf.js`，不依赖任何第三方 PDF 库。

## 为什么它能"只本地"

- **不在公开导航里**：首页、列表页、阅读页的导航与页脚都没有指向 `admin/` 的链接；
- **部署白名单**：`tools/deploy.mjs` 只复制根目录的公开页面与 `assets/`、`vendor/`、`articles*`，
  `admin/` 与 `tools/` 都被显式排除，并会在拷贝后校验目标目录里没有它们的痕迹；
- **不索引**：页面带 `noindex`，避免被搜索引擎收录。

注意：静态托管无法阻止别人直接输入 URL 访问某个文件——但因为在物理上不部署，
`admin/` 在线上根本不存在，所以这里不需要把它当作安全边界。

## 与公开站点的分工

| 内容 | 位置 | 是否部署 |
| --- | --- | --- |
| 首页 / 文章列表 / 文章阅读 | 根目录 `*.html` | ✅ |
| 样式与脚本 | `assets/` | ✅ |
| 公式引擎 KaTeX | `vendor/katex/` | ✅ |
| 文章数据 | `articles/`、`articles-data.js` | ✅ |
| **管理系统（本目录）** | `admin/` | ❌ |
| **开发与发布工具** | `tools/` | ❌ |
