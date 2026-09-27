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

## 在网页中使用自己的辞书

打开「词书」页，点击「导入辞书」，选择英文 JSON 文件。支持原项目的单词数组格式：

```json
[
  { "name": "environment", "trans": ["环境"], "usphone": "ɪnˈvaɪrənmənt", "ukphone": "ɪnˈvaɪrənmənt" },
  { "name": "spelling", "trans": "拼写" }
]
```

也接受包含 `words` 数组的对象。`name` 必填，释义和音标可选；单个文件不超过 10 MB、50000 词。导入的辞书仅保存在当前浏览器的 IndexedDB，不会上传到仓库。相同内容重复导入会更新同一本辞书。

首次打开网页会显示使用说明；之后可在「词书」页再次打开。学习数据在练习页「设置 → 数据设置」导出为 `.gz`。该备份不包含自定义辞书的 JSON 文件；换设备时请先导入原辞书，再恢复学习备份。
