# Qwerty Learner 网页版

这是从本地定制版单独整理出的网页发布源码。包含网页练习、一本 CET-4 演示词书和本地浏览器数据功能；不包含 Windows EXE、Tauri 原生服务、个人词库、学习记录、恢复档案或 Git 历史。基于 [Qwerty Learner 原项目](https://github.com/RealKai42/qwerty-learner)；保留 GPL-3.0 许可证，见 `LICENSE`。

## 本地运行

```sh
npm ci
npm run dev
```

生产构建：`npm run build`。输出在 `build/`。

## GitHub Pages

把此文件夹内容放进你自己的 GitHub 仓库，默认分支使用 `main`。在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。推送后 `.github/workflows/pages.yml` 会安装依赖、构建并部署 `build/`。工作流会按仓库名设置静态资源路径；站内路由使用 URL 的 `#` 部分，刷新页面也能打开。

网页学习记录仅存于访问者当前浏览器的 IndexedDB，不会同步到 GitHub。请定期在设置中导出备份。桌面专属的云盘同步和 GPT 任务功能不在此网页版本中。
