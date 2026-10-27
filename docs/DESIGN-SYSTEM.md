# 设计系统

默认主题采用玻璃面板、浮动导航、封面入场和响应式画廊，通过服务端组件与本站资源实现。

## Tokens

| 类型 | 默认规范 |
|---|---|
| 页面颜色 | 浅色背景 #edf0fa，文字 #303147；深色背景 #141827，正文 #edf0f6 |
| 主题色 | 浅色 #8170ba，深色 #c0afea，封面强调 #ffc2ac；均可配置 |
| 材质 | 玻璃面板白色 68% 透明度、20px blur／135% 饱和；深色浮动导航、独立阴影 |
| 圆角 | 卡片 40px、紧凑容器 28px；手机 32px／24px；支持时使用 squircle |
| 字体 | Segoe UI／Microsoft YaHei／PingFang SC 系统栈；画廊标题为本机宋体类衬线栈 |
| 内容容器 | 列表与阅读 1120px；画廊最大 1540px；桌面留白 52px 起 |
| 栅格 | 首页 1.36fr／1.36fr／1fr，间隙 20px；列表三列，19px 间隙 |
| 正文 | 桌面 17px／1.9；手机 16px／1.85；正文标题 30／25／21px |
| 阅读标题 | 桌面 34px／1.45；手机 28px |
| 断点 | 800px：双列、移动菜单；540px：单列，简介移到第一篇文章前 |
| 动效 | 卡片上移 3–4px、图片轻微缩放；封面原生滚动入场，约 650ms 过渡 |

主题覆盖从 `design.json` 生成 `/assets/theme.css`，不在 HTML 中拼接内联 CSS。`src/design.js` 检查颜色、字体、文件名、导航及文本；配置不是任意代码执行入口。

## 配置

站点名称及副标题由 `BLOG_TITLE`、`BLOG_DESCRIPTION` 设置。`BLOG_THEME=light|dark|system` 选择初始模式，浏览器切换后保存在本机；旧 `paper`／`night` 分别兼容 light／dark。

`design.json` 可配置：

- `subtitle`、`heroTitle1/2`、`heroHighlight`、`heroDescription`、`primaryText`、`caption`：首页封面。
- `galleryTitle`、`author`、`bio`、`noteTitle`、`noteText`：画廊与介绍。
- `footerText`（支持 `{year}`）、`footerTagline`：页脚。
- `nav`：最多七项，label 与本站 href；菜单不会创建原本不存在的页面。
- `logo`、`favicon`、`wallpaper`、`avatar`：本站主题图片路径。
- `accent`、`darkAccent`、`heroAccent`：六位十六进制配色。
- `font`、`headingFont`：经过语法限制的字体族；无远程字体请求。
- `fontFile`：可选的本站 WOFF2 资源，为正文加载 BlogCustom 字体。

自定义配置文件通过 `BLOG_DESIGN_FILE=appearance.json` 指定，限制为根目录文件名，不接受外部路径、符号链接或过大的文件。部署自定义文件时应将其作为自己的配置管理；默认构建白名单只携带虚构 `design.json`。

主题图片、Logo 和字体放入 `public/theme/`，文件名使用小写字母、数字和短横线。允许 SVG／PNG／JPG／WebP／WOFF2，单文件最多 2 MiB。SVG 和字体是维护者审核的可信静态资源，不能从 HTTP 上传接口写入该目录；用户上传仍只输出验证后的 WebP。示例 SVG 均为全新创作，未复制私人壁纸、头像或文章图片。

## 组件和交互

`src/components.js` 提供图标、卡片、标签、标题和搜索表单；`src/views.js` 组合页面；`public/style.css` 实现布局与材质；`public/ui.js` 仅负责本站交互。扩展主题不应绕过内容层、CSRF 或所有权检查。

首页封面点击和滚动均可进入画廊。移动菜单支持 Enter、Escape、aria-expanded 和焦点返回。所有主要控件有焦点环；跳转正文链接可直接绕过封面。正文目录使用清理后内容生成的唯一 ID，代码复制使用 Clipboard API，失败给出文本反馈。

`prefers-reduced-motion` 关闭滚动过渡、卡片动画及强制吸附，保留内容可达；无 JavaScript 时采用静态连续布局，文章和搜索表单仍由服务器渲染。

## 功能范围

归档使用同一套玻璃颜色、阴影和间距变量，桌面采用年份侧栏与时间轴双列，800px 以下转为单列年份表单。原生 details 在禁用脚本时仍支持折叠；参见 ARCHIVES.md。

调色板显式配置；封面文字使用渐变裁字和描边；页脚为流式文案布局。音乐和压缩包导入未实现。主题验收见 UI-MIGRATION.md，素材许可见 ASSET-LICENSES.md。
