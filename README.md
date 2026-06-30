# ChmlFrp 社区工具箱

<div align="center">


**快速测试节点延迟，帮助用户选择最优节点**

[![GitHub release](https://img.shields.io/github/v/release/zhengddzz/ChmlFrp-Community-Toolbox?include_prereleases)](https://github.com/zhengddzz/ChmlFrp-Community-Toolbox/releases)
[![GitHub downloads](https://img.shields.io/github/downloads/zhengddzz/ChmlFrp-Community-Toolbox/total)](https://github.com/zhengddzz/ChmlFrp-Community-Toolbox/releases)
[![License](https://img.shields.io/github/license/zhengddzz/ChmlFrp-Community-Toolbox)](LICENSE)

[下载最新版本](https://github.com/zhengddzz/ChmlFrp-Community-Toolbox/releases/latest) | [问题反馈](https://github.com/zhengddzz/ChmlFrp-Community-Toolbox/issues)

</div>

---

## ✨ 核心功能

### 🔍 节点自动探测
支持调用 API 扫描 ChmlFrp 可用节点列表，快速获取节点的基础信息（如节点地区、运营商、在线状态），无需手动查询。

### 🎯 多维度筛选
提供 VIP 节点、国内国外、UDP 支持等筛选条件，用户可根据自身网络环境和需求，精准定位符合要求的节点，提高效率。

### ⚡ 节点测速评估
内置本地简单测速功能，对筛选后的节点进行延迟和丢包率检测，直观展示本地到节点的连接质量，辅助选择最优节点。

### 📌 其他特性
- **窗口置顶** - 方便随时查看测试进度
- **结果持久化** - 测试结果自动保存
- **自动更新** - 支持 GitHub 自动检查更新

## 📥 下载安装

### Windows
- 下载 `.msi` 或 `.exe` 安装包
- 双击安装即可

### macOS
- 下载 `.dmg` 文件
- 拖拽到应用程序文件夹

### Linux
- 下载 `.deb` 或 `.AppImage`
- 根据发行版安装

## 🛠️ 技术栈

- **前端**: React + TypeScript + Tailwind CSS
- **后端**: Rust + Tauri
- **构建**: GitHub Actions

## 📝 开发

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm tauri dev

# 构建
pnpm tauri build
```

## 🌿 分支管理

| 分支 | 说明 |
|------|------|
| `main` | 生产分支，稳定版本代码 |
| `develop` | 开发分支，日常开发在此进行 |

### 提交规范

请遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

- `feat:` 新功能
- `fix:` 修复 Bug
- `docs:` 文档更新
- `style:` 代码格式调整
- `refactor:` 代码重构
- `chore:` 构建/工具变更

### 合并到生产分支

当 `develop` 分支开发完成并测试通过后，合并到 `main` 分支：

```bash
# 切换到生产分支
git checkout main

# 合并开发分支
git merge develop

# 推送到远程
git push origin main
```

合并后会自动触发 GitHub Actions 构建并发布新版本。

## 📄 许可证

[MIT License](LICENSE)

## 🙏 致谢

- [Tauri](https://tauri.app/) - 跨平台桌面应用框架
- [ChmlFrp](https://chmlfrp.cn/) - 免费内网穿透服务
