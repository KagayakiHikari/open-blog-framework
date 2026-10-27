# 架构

本项目是独立的 Node.js／SQLite 单实例博客。服务端 HTML 与本站静态资源构成前端，不需要外部字体、CDN 或远程数据库。

```text
browser / HTTPS reverse proxy
  -> app.js: HTTP、路由、请求准入、安全响应头
  -> request-body.js: 匿名／已认证读取预算、取消和超时
  -> security.js: scrypt、认证代际、会话、CSRF、角色与来源配额
  -> content.js: 校验、发布策略、所有权、修订与 Markdown 清理
  -> db.js + migrations/: SQLite、事务、迁移和审计
  -> views.js + components.js + public/: 转义模板、主题与交互
  -> media.js -> media-worker.js: 本地图片子进程重新编码
```

配置仅从 config.js 入口读取。会话签发的最终认证代际检查与插入使用同一 SQLite 写事务；CLI 和服务端的改密／全会话撤销同步推进账户代际。旧版本升级执行 002 迁移后，现有会话需要重新登录。

单实例持有数据目录锁；多进程 CLI 通过 SQLite 写事务协调，但不支持多 Web 实例或集群。同步数据库和 LIKE 搜索适合小型站点，不提供大型全文引擎或水平扩容能力。

可信扩展由运维在代码中安装，拥有进程权限，不是沙箱。默认没有遥测、Webhook、邮件、远程资源抓取或后台出站任务。增加外部服务前须重新审核独立性及数据流。

源码目录只读、数据目录独立可写；生产部署必须使用自己的 HTTPS 代理和操作系统资源限额。部署假设及未验证事项见 DEPLOYMENT.md。
