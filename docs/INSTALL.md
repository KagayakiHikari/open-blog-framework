# 安装与初始化

使用独立目录和 Node 24.22.1+（24.x）或已测试的 26.12.1。不要放在既有应用的数据目录内。建议官方 npm 注册表、锁文件和 `npm ci --ignore-scripts`，不要使用 `--omit=optional`；图片处理需要平台包。

```sh
npm ci --ignore-scripts
npm run migrate
```

首次初始化仅建表，不创建账号、不写文章。迁移事务化并记录名称；重复执行跳过已应用迁移。添加新迁移后按序前进，不自动降级数据库。

## Windows 创建账号

在项目自己的 PowerShell 窗口中输入。转换只发生在当前本机进程内，不写入文件：

```powershell
$blogSecure = Read-Host 'New unique password (at least 16 bytes)' -AsSecureString
$blogPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($blogSecure)
try {
  $blogPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($blogPointer)
  $blogPassword | node scripts/admin.js create operator admin
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($blogPointer)
  Remove-Variable blogPassword -ErrorAction SilentlyContinue
  $blogSecure.Dispose()
}
npm start
```

Linux／macOS 示例见 README。密码为 16–256 字节，不存在默认口令；建议密码管理器生成高熵密码。工具从标准输入读取，参数与输出不包含密码。

## 账号运维

命令形式：`node scripts/admin.js create USERNAME admin|editor`、`password USERNAME`、`revoke USERNAME`。`create` 和 `password` 必须经标准输入提供新密码；`revoke` 不需要密码输入。改密码同时撤销该账号所有会话。用户名限制为 3–40 个 ASCII 字母、数字、下划线或短横线。

环境配置有变化时，使用 `node --env-file=.env scripts/admin.js ...`，保证应用、迁移与账号工具指向相同的独立配置。没有账号列表 HTTP 接口、角色提升 HTTP 接口或公开注册入口。

## 验证

启动后打开本地地址，登录，创建草稿，确认匿名访问不可见，然后发布。媒体库仅接受 PNG／JPEG／WebP，输出本站 WebP。测试使用临时独立目录与合成账号，不读取本地实际配置。

不要把数据库、账号、媒体、环境文件放进源码交付包；即便被 `.gitignore` 排除，也不应把其他系统的这些文件放在项目内。

## 升级与认证状态

升级前在自己的测试实例备份并验证迁移。002-auth-version.sql 增加账户及会话认证代际，并使全部旧会话失效；账号、密码哈希和文章保留。改密及全会话撤销会原子推进代际；正在进行的旧代际登录必须重新开始。迁移前必须按部署流程停止 Web 实例，不能用 CLI 自动迁移正在运行的旧版本服务。
