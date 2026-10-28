# Open Blog Framework

[English](README.md) | 简体中文

一个基于 Node.js 和 SQLite 构建的轻量级博客框架，定位为个人独立开发的开源示范作品，适合作为个人博客开发、学习与二次开发的参考。

采用服务端渲染架构，提供文章管理、Markdown 编辑、标签与搜索、归档时间轴、媒体管理、后台权限控制、响应式主题及基础 SEO 功能。项目以简洁的架构、独立部署能力和可定制界面为目标。

## 项目状态

仅计划发布一个正式版本 **v1.0.0**，目前尚未公开发布。功能已冻结，不计划继续迭代，不提供长期维护、功能更新或定期安全补丁，亦不承诺问题响应时限。

欢迎开发者根据项目许可证进行 Fork、修改与二次开发。部署者需自行跟踪运行时、依赖及应用漏洞，维护自己的部署或分支；无法维护时应停止对外服务。

本项目不设漏洞反馈接收渠道，不提供监测、响应或修复服务。请自行维护部署，勿在公开 Issue 或讨论中披露凭据、私人日志、用户数据或敏感利用细节，详见 [安全政策](SECURITY.md)。

## 技术架构

- Node.js ESM 与原生 HTTP 服务。
- SQLite 本地数据库，通过 node:sqlite 访问。
- 服务端 HTML 渲染与原生 JavaScript／CSS。
- marked、sanitize-html 处理 Markdown，Sharp 处理图片，精确版本见锁文件。

运行时不需要外部数据库、CDN、字体服务或私人服务接口。

## 已实现功能

- 文章增删改、草稿、到期可见的定时发布、修订冲突检查。
- Markdown、表格、安全 HTML 清理、本地图片、摘要、标签和分页搜索。
- /archives 年份时间轴、UTC 年份筛选、每页最多30篇、原生折叠及手机布局。
- 管理员／编辑权限、后台编辑器、媒体库、会话撤销和操作审计。
- 图片验证与独立子进程重新编码，上传和处理并发限制。
- RSS、站点地图、robots、canonical 与描述信息。
- 浮动玻璃导航、文章画廊、明暗主题、响应式布局及可配置网站标识。

## 功能限制

仅支持单个 Web 进程；SQLite 和 LIKE 搜索面向小型站点，不支持集群。CLI 与 Web 的凭据变更使用 SQLite 事务协调，不代表支持多个 Web 实例。

没有音乐页面／播放器、评论、公开注册、独立分类树、ZIP 导入、远程抓图或在线插件市场，不承诺后续开发。现有代码级扩展入口运行可信代码，不是沙箱插件系统。媒体 URL 是公开资源，草稿不使媒体变成私密附件。

## 快速安装

使用自己的独立目录。运行时下限为 **Node24.22.1+ 的24.x** 或 **26.12.1+ 的26.x**；这是兼容性与安全基线，不是维护承诺，也不表示所有未来版本均已测试。

~~~sh
npm ci --ignore-scripts
npm run migrate
~~~

保留 optional 包，Sharp 需要平台预编译依赖。首次初始化不创建默认账号、口令或示例文章，也不导入既有数据。

管理员密码必须全新、唯一、16–256字节，通过标准输入传入，不放入命令参数、环境变量或 Git。以下使用 Bash：

~~~bash
read -rs -p 'New unique passphrase: ' BLOG_INPUT; printf '\n'
printf '%s' "$BLOG_INPUT" | npm run admin -- create operator admin
unset BLOG_INPUT
npm start
~~~

Windows PowerShell 静默输入示例见 [安装说明](docs/INSTALL.md)。operator 只是示例用户名，不会自动创建。打开 [本地博客](http://localhost:4300)，管理登录入口为 /login。

默认数据位于独立 var/。如复制 .env.example 为本地 .env，须显式加载；迁移、账号工具和服务使用同一配置：

~~~sh
node --env-file=.env scripts/migrate.js
node --env-file=.env src/server.js
~~~

账号工具使用相同的 node --env-file=.env scripts/admin.js 前缀，并继续通过标准输入传密码。应用不隐式读取 .env。

## 主题与归档

design.json 配置 Logo、Favicon、背景、首页文案、简介、导航、页脚、配色与字体；名称及描述使用环境变量。主题支持 light／dark／system，兼容 paper／night。默认资源为本站 SVG，图标附带第三方通知。

归档使用独立数据库中的公开文章，采用与主题一致的玻璃面板。年份表单与原生折叠不依赖脚本生成；完整禁用脚本的浏览器验收须单独记录。

## 安全部署与备份恢复

1. 仅使用自己的账号、数据、域名和代理；生产模式要求自己的 HTTPS origin，应用绑定回环地址，不直接暴露开发 HTTP 服务。
2. 使用低权限服务账号、只读源码和独立可写数据目录；设置系统 CPU／内存／磁盘限制及文件权限／NTFS ACL。
3. 代理保持配置的 Host。应用不信任未经验证的转发头；代理后访问者共享 peer 配额，可能影响高访问量站点。
4. 停止 Web 实例和媒体任务后备份完整数据目录，不仅复制运行中的 SQLite 主文件。备份含正文、密码哈希和会话，须私密保存并按自己的流程加密。
5. 恢复至隔离目录并检查数据库和媒体。恢复会回退密码与撤销状态；重新开放流量前，用账号 CLI 撤销所有恢复账号的会话，核实现行密码，必要时重设。

详见 [部署与恢复](docs/DEPLOYMENT.md)。应用测试不替代 HTTPS、代理、系统权限、备份介质和灾难恢复验收；持续运维责任由部署者承担。

## 验证与交付

在全新安装、无 dist/ 的干净副本执行：

~~~sh
npm ci --ignore-scripts
npm run verify:release
~~~

流程包含语法、单元／集成／安全回归、依赖审计、逐文件构建、扫描及独立安装启动。运行包含明确白名单文件和 SHA-256 清单，不是压缩编译；不含 Git、真实环境配置、数据库、日志、依赖或生成的测试数据。完整源码另含 CI 和合成测试源码。

CI 定义覆盖 Windows／Ubuntu 与两个精确 Node 版本；工作流存在不代表 GitHub 托管 CI 已执行。本地 Windows、WSL Linux 与托管 runner 证据须分别记录。测试通过或 npm 零告警不构成无风险保证。

- [安装](docs/INSTALL.md) · [部署与恢复](docs/DEPLOYMENT.md)
- [架构](docs/ARCHITECTURE.md) · [设计系统](docs/DESIGN-SYSTEM.md) · [归档](docs/ARCHIVES.md)
- [安全政策](SECURITY.md) · [验证流程](docs/AUDIT.md)
- [第三方通知](THIRD_PARTY_NOTICES.md) · [资源说明](docs/ASSET-LICENSES.md) · [依赖清单](docs/dependency-inventory.json)

## 开源许可

本项目采用 [MIT License](LICENSE)，版权署名为 **Copyright (c) 2026 KagayakiHikari**。第三方图标和依赖遵循各自许可并保留相应通知。当前仍是未公开候选，保留 private:true；许可选择不代表公开发布已经获得批准。

所有演示输入均为虚构。验证与部署说明予以保留；公开发布仍需维护者明确批准。
