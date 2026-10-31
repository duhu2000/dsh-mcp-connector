# 产品截图与演示的来源及更新

<!-- generated:media -->本组 7 张截图和 GIF 均从 v0.2.86 于 2026-10-31 重新采集，未修改截图中的版本文字。<!-- /generated:media -->

全部素材由真实产品 UI 的无凭据 Mock harness 渲染：1280×720 浏览器视口、800px 产品面板、桌面两列卡片。顶部保留“无凭据 Mock”标识；目录数、连接数与工具数是演示夹具，不代表生产统计或真实授权、业务验收。不会读取用户 profile、调用服务商或上传业务数据。

根目录 [screenshots.json](../../screenshots.json) 保持外部市场兼容的 7 张图片路径与顺序；[assets.json](assets.json) 是采集版本、日期、源码指纹、SHA-256、尺寸和 GIF 时长的唯一记录。

| 文件 | 内容 |
|---|---|
| 01-market-overview.jpg | 初始市场与未连接卡片 |
| 02-connector-detail.jpg | 连接器详情、权限与示例 |
| 03-tool-discovery.jpg | Mock 连接后的工具发现 |
| 04-json-import.jpg | JSON 导入与作用域 |
| 05-unified-tool-search.png | 跨连接工具查询 |
| 06-tool-parameters.png | 参数结构详情 |
| 07-connection-diagnostics.png | 模拟发现失败与诊断 |

`docs/demo.gif` 由当前截图状态顺序编码，仅缩放和调色，不修改版本号或连接状态。旧素材可通过 Git 历史查看，不继续用作当前产品首屏。

## 更新与发布

GitHub Markdown 不执行变量。`package.json.version` 是版本唯一源，运行 `npm run docs:sync` 生成有标记的当前版本文案；历史 Changelog、验收日期、最低支持版本和已发布文章记录不作全局替换。

1. 修改版本或产品 UI 后，安装开发采集依赖：`npm install --no-save --legacy-peer-deps playwright@1.62.1`，并运行 `npx playwright install chromium`；另需 ffmpeg 和中文字体。
2. 执行 `npm run storefront:capture`。脚本只启动随机回环端口，隔离浏览器不加载外部资源；支持 `CHROMIUM_EXECUTABLE` 指定本机 Chromium，`PLAYWRIGHT_MODULE` 指定开发依赖路径。
3. 执行 `npm run docs:sync && npm run storefront:freshness && npm run check`，人工查看全部截图及 GIF，再随 PR 提交。不要仅修改 assets.json 的版本或日期。
4. Release 工作流在发布前验证采集版本、源码指纹和 14 天有效期；旧图不会静默进入新的正式版本。先准备素材再打 Tag，不在不可变 Tag 上改图。

产品素材工作流在 UI 主线更新、正式 Release 后、每周及手动触发时检查；需要更新时生成截图与文案，并更新同一个维护 PR。自动化只提出 PR，不自动合并，不向社交平台发布。GitHub/npm/CDN 缓存可能延迟，外部市场同步仍需复核。
