# 二次开发

## 模块入口

`src/app.js` 提供 `createApp(config, {extensions, logger})`，返回服务器、数据库和异步 `close()`。默认实例仅绑定回环；测试监听临时回环端口。数据库依赖在初始化时注入业务逻辑，便于用全新临时目录集成测试。

内容变更必须经过 `savePost`／`deletePost`，保留权限、验证、事务和修订号检查。公开列表必须调用 `publicPosts`；新增公开详情、feed 或缓存必须同时限制 `published` 与 `published_at <= now`。不得将后台查询复用为匿名内容接口。

SQL 参数均绑定；动态 SQL 只能由维护者固定语句组成。扩展配置、请求字段和排序参数不得直接拼入 SQL。模板使用 `escape`，Markdown 只在经过 `markdown` 清理后作为 HTML 插入。

## HTTP API

没有公共写入 API。写入需登录 Cookie、精确 Origin，以及 `X-CSRF-Token` 或表单 `csrf`。

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | /api/session | 当前账号、角色与 CSRF；不返回会话令牌 |
| GET | /api/posts?page=1 | 当前可管理文章，50 条一页 |
| POST | /api/posts | 新建；title、slug、summary、content、tags、status、publishedAt |
| PUT | /api/posts/:id | 更新；必须带当前 revision |
| DELETE | /api/posts/:id | 删除自己文章或管理员删除 |
| POST | /api/media | `application/octet-stream` 原始图片字节，最大 5 MiB |
| DELETE | /api/media/:id | 删除自己的媒体或管理员删除 |

登录先 GET `/login` 获取预认证 Cookie 和隐藏 CSRF，然后 POST 同源登录表单。密码错误统一 401，不区分账号存在。API 返回 JSON；页面表单成功后 303。400 表示输入错误，401 未认证，403 权限／CSRF，409 slug 或修订冲突，413 体积超限，415 格式不支持，429 配额，500 隐藏内部信息。429 返回 Retry-After。

账号和角色只经本机 CLI 管理。编辑角色可发布自己的文章；管理员可管理全部文章和媒体、查看审计。没有公开用户资料或邮箱字段。

## 主题

默认视觉提供可配置的玻璃主题，Design Tokens、组件和交互分别位于 public/style.css、src/components.js／views.js、public/ui.js。通过 design.json 修改品牌、内容、配色、字体、本站资源和导航。

BLOG_THEME=light／dark／system，兼容 paper／night。配置的资源必须位于本站 public/theme/；仅显式白名单后缀可提供，不提供 HTTP SVG 上传。所有文案转义，颜色和字体按语法验证，不接受任意 CSS／HTML／远程脚本。详见 [设计系统](DESIGN-SYSTEM.md)。

## 可信扩展

```js
const app = await createApp(settings, {
  extensions: [{
    name: 'local-index',
    async afterPostSaved(post) {
      // post 是提交后的冻结数据；在自己的可信代码中处理。
    }
  }]
});
```

扩展在内容事务提交后运行。扩展失败不会撤销文章，记录固定的失败类型和扩展名称，不记录内容或堆栈。不得将扩展视作低权限插件：它能执行 Node 代码、访问进程权限内的资源，维护者必须审核；不能通过 HTTP 安装。回调应有界且快速，当前没有通用任务队列、外部存储插件或隔离沙箱。

## 测试和构建

`node --test` 使用合成内容、临时数据库与回环 HTTP；可重复运行，不需要任何私有服务。新增认证和公开查询必须增加边界测试，不能只测成功路径。

构建使用 release-files.json 逐文件准入，并在复制前和输出后执行扫描。`dist/BUILD-MANIFEST.json` 记录每个运行文件的 SHA-256。重新构建在干净检出执行，脚本拒绝覆盖已有 dist，避免删除未知文件。依赖由 lockfile 固定、安装脚本禁用，原生包完整性由 npm 校验。
