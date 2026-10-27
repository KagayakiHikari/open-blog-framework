# 素材与分发权清单

| 内容 | 来源与许可状态 | 发布处理 |
|---|---|---|
| 第一方 JS、CSS、SQL、文档与主题 | 项目内实现；维护者应确认相应分发权 | 适用根目录 MIT LICENSE，Copyright (c) 2026 KagayakiHikari |
| logo.svg、avatar.svg、wallpaper.svg、cover-technical.svg、cover-life.svg | 项目内生成的几何／风景 SVG，未引入摄影、动漫、音频或字体文件 | 适用根目录 LICENSE；自定义素材的权利需另行核实 |
| src/icon-data.js | Lucide React 1.52.0 的选定图标 | ISC／适用 Feather MIT；保留 THIRD_PARTY_NOTICES.md 和完整上游 LICENSE |
| 字体 | 仅系统字体族名称；没有打包字体文件 | 使用者自行提供并审核自定义字体分发许可 |
| npm 依赖 | 锁文件与依赖清单中的精确包 | npm 安装保留各包许可证；元数据清单不是逐项法律结论 |
| 原生图像组件 | Sharp 平台包及其组件；包含 LGPL 和组合许可 | 当前只交付源码；二进制、容器和安装器必须单独准备许可及源码／替换义务材料 |

没有提供音乐播放器、音乐文件、第三方动漫图或在线资源默认地址。部署者添加的内容不自动获得本项目许可。

项目已选择 MIT，完整文本见根目录 LICENSE。该选择不改变第三方作品的权利归属，本清单不替代维护者对实际分发权的确认。

本机锁定的 Sharp Windows x64 包中，versions.json 的组件版本已与上游随包 README 的许可表对应，见 native-component-licenses.json。该清单也列出 README 提及但没有版本对应的条目，不能据此推断已打包或已满足其义务。其他平台、完整版权通知、对应源码、修改情况及二进制替换／重新链接要求仍需在实际分发前复核。
