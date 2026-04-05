# ArXiv Studio

ArXiv Studio is an Electron desktop app that turns your Zotero library into a daily arXiv recommendation workflow, with Feishu delivery and multi-provider AI chat.

ArXiv Studio 是一个基于 Electron 的桌面应用，用来把你的 Zotero 收藏转成每日 arXiv 推荐流程，并联动飞书推送和多模型 AI 问答。

## Downloads / 下载

For public releases, end users should download installers from the repository's GitHub Releases page.

公开发布后，最终用户应当从仓库的 GitHub Releases 页面下载安装包。

- macOS installer: `ArXiv-Studio-<version>-mac-<arch>.dmg`
- Windows installer: `ArXiv-Studio-<version>-win-x64-setup.exe`
- Release workflow: [`.github/workflows/release.yml`](./.github/workflows/release.yml)

Push a version tag such as `v0.1.0`, and GitHub Actions will build release assets for macOS and Windows.

推送类似 `v0.1.0` 的版本标签后，GitHub Actions 会自动构建 macOS 和 Windows 的发布安装包。

## Core Features / 核心功能

- 从 Zotero 条目摘要构建个人研究语料。 / Build a personal research corpus from Zotero item abstracts.
- 拉取最新 arXiv 候选并做轻量语义重排。 / Pull fresh arXiv candidates and rerank them with a lightweight semantic scoring pipeline.
- 提供更易上手的桌面工作台，包括启动清单、配置进度和诊断面板。 / Provide a more usable desktop workspace with setup checklist, readiness status, and diagnostics.
- 将推荐结果作为文本消息推送到飞书机器人。 / Push recommendation results to a Feishu bot as plain-text updates.
- 支持 ChatGPT、Claude、Kimi、DeepSeek、GLM、Gemini 等多家模型接口。 / Support multiple model providers including ChatGPT, Claude, Kimi, DeepSeek, GLM, and Gemini.
- 支持从 UI 或 JSON 文件加载配置。 / Load configuration from the desktop UI or from a JSON config file.
- 支持每日定时推送。 / Support daily scheduled pushes while the app is running.

## Project Structure / 项目结构

- [`src/main/main.ts`](./src/main/main.ts): Electron main process, IPC, config loading, scheduling, Feishu push, AI chat.
- [`src/main/recommendation.ts`](./src/main/recommendation.ts): Zotero/arXiv fetching, reranking, and resilience logic.
- [`src/main/preload.ts`](./src/main/preload.ts): safe bridge between renderer and main process.
- [`src/renderer/index.html`](./src/renderer/index.html): desktop UI layout.
- [`src/renderer/renderer.ts`](./src/renderer/renderer.ts): renderer interactions and live workspace hints.
- [`src/renderer/styles.css`](./src/renderer/styles.css): desktop-first styles.
- [`config/app-config.example.json`](./config/app-config.example.json): example config.
- [`electron-builder.yml`](./electron-builder.yml): installer packaging config.

## Build From Source / 从源码构建

Requirements / 环境要求:

- Node.js 22 recommended
- Access to Zotero API, arXiv, and any LLM endpoint you configure

Install dependencies / 安装依赖:

```bash
npm install
```

Run the desktop app in development / 本地启动桌面应用:

```bash
npm run start
```

Compile TypeScript only / 仅编译源码:

```bash
npm run build
```

Build a macOS installer locally / 本地构建 macOS 安装包:

```bash
npm run dist:mac
```

Build a Windows installer locally on Windows / 在 Windows 上本地构建安装包:

```bash
npm run dist:win
```

Build using the default Electron Builder target for the current platform / 按当前平台默认目标打包:

```bash
npm run dist
```

Installer outputs are written to the `release/` directory.

安装包输出目录为 `release/`。

## Configuration / 配置

The app reads local user config from Electron's `userData` directory. You can also load a shared JSON file manually from the UI.

应用会从 Electron 的 `userData` 目录读取本地用户配置；你也可以在 UI 中手动加载共享 JSON 配置文件。

The included example file is:

内置示例配置文件：

- [`config/app-config.example.json`](./config/app-config.example.json)

Example Feishu section / 飞书配置示例:

```json
{
  "feishu": {
    "webhook": "https://open.feishu.cn/open-apis/bot/v2/hook/your_webhook",
    "secret": "",
    "dailyEnabled": false,
    "dailyTime": "09:00"
  }
}
```

## Public Release Flow / 公开发布流程

1. Copy this project to the target public repository directory.
2. Remove the old Git metadata if you are starting a fresh public repo.
3. Create a new GitHub repository and push the code.
4. Add a version tag such as `v0.1.0`.
5. Push the tag to GitHub so the release workflow builds installers.
6. Point users to the GitHub Releases page for downloads.

1. 将项目复制到目标公开仓库目录。
2. 如果要作为新的公开仓库发布，先移除旧的 Git 元数据。
3. 创建新的 GitHub 仓库并推送代码。
4. 创建类似 `v0.1.0` 的版本标签。
5. 将标签推送到 GitHub，让发布工作流自动构建安装包。
6. 最终把用户引导到 GitHub Releases 页面下载。

## Notes / 说明

- Daily Feishu push works only while the desktop app is running.
- Recommendation quality depends on Zotero entries having `abstractNote`.
- The current release build uses Electron Builder defaults for app icons unless custom icons are added later.

- 每日飞书推送仅在桌面应用运行时生效。
- 推荐质量依赖 Zotero 条目里存在 `abstractNote`。
- 当前发布构建默认使用 Electron Builder 的默认图标，后续可以再补自定义图标。
