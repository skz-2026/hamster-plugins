# hamster-plugins —— 仓鼠Hub 插件市场托管仓库

本仓库是 [Hamster-Hub](https://github.com/skz-2026/Hamster-Hub) 的插件市场源：
`plugins/` 里的每个目录是一个插件，推送后 **CI 自动打包发版并更新索引**，
客户端在「插件市场」页即可安装/升级。

## 目录结构

```
plugins/
└── <id>/                 # 插件目录（id = 目录名 = plugin.json 的 id）
    ├── plugin.json       # 清单：id/name/version/description/author/entry?/page?/icon?/permissions?
    ├── widget.js         # 小组件入口（可选）
    └── page.js           # 整页入口（可选；entry 与 page 至少一个）
registry.json             # 市场索引（CI 自动再生，勿手改——见下）
```

## 发布插件（作者指南）

1. Fork 本仓库，把你的插件目录放进 `plugins/`（本地可先用 Hamster-Hub 仓库的
   `scripts/pack-plugin.mjs <目录>` 自验打包与清单合法性）。
2. 提 PR 合入 `main`。CI 会：校验 manifest → 打 zip（plugin.json 在 zip 根部）→
   创建 `<id>@<version>` Release 并上传 zip → 重算 sha256 → 更新 `registry.json`。
3. 客户端在市场页点「刷新」即可看到 / 升级你的插件。

版本升级：改 `plugin.json` 的 `version` 再推一次即可（CI 按 id+version 发新版）。

## registry.json 条目格式（由 CI 生成）

```json
{
  "id": "ai-notes",
  "name": "AI 笔记",
  "version": "1.0.0",
  "description": "……",
  "author": "仓鼠Hub",
  "icon": "📝",
  "entry": null,
  "page": "page.js",
  "permissions": [],
  "zipUrl": "releases/download/ai-notes@1.0.0/ai-notes-1.0.0.zip",
  "sha256": "<zip 的 sha256，小写十六进制>",
  "size": 487
}
```

- `zipUrl` 相对本仓库（完整 https URL 也可以）。
- `sha256` 客户端安装前强制校验，不符即拒装。

## 客户端侧说明

- 默认源 = 本仓库（`skz-2026/hamster-plugins`）；下载走镜像前缀
  （默认 `https://ghproxy.net/`）→ GitHub 直连兜底。两者都可在市场页
  「源设置」里更换。
- 信任模型同油猴脚本：安装即代表信任作者代码；manifest 的 `permissions`
  决定插件能调用哪些桌面能力（todo/apps 白名单）。
