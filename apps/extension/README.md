# OpenSelf browser extension

Chrome / Edge Manifest V3 side panel built with WXT and React. It uses the same API contracts, translations and Button component as the Web app.

## 本地安装

1. 先按仓库根目录 README 启动 Web、数据库、Redis 和 Worker，并配置 GitHub OAuth。
2. 在仓库根目录运行 `pnpm extension:build`。
3. 打开 Chrome 的扩展程序页面或 Edge 的扩展管理页，启用开发者模式，选择“加载已解压的扩展程序”。
4. Chrome 选择 `apps/extension/.output/chrome-mv3`，Edge 选择 `apps/extension/.output/edge-mv3`。
5. 复制浏览器显示的插件 ID，填入服务端 `.env` 的 `EXTENSION_IDS`。多个 ID 用英文逗号分隔，重启 Web 服务。
6. 点击插件图标打开侧边栏，选择“连接 OpenSelf”，完成 GitHub 登录。
7. 打开 GitHub PR 或新建 Issue 页面。插件可以预审、保存草稿和回填 Issue；发布仍在 Web 草稿队列或 GitHub 页面由你确认。

## Production builds

Set the actual deployed HTTPS origin before building. In PowerShell:

```powershell
$env:WXT_APP_URL='https://your-deployed-origin.example'
pnpm extension:zip
```

Replace the example origin with the real service URL. The generated host permission and runtime API URL must agree. Default builds target localhost for development and should not be submitted to stores as production builds.

Outputs are under `.output/`: unpacked `chrome-mv3` / `edge-mv3` directories and browser-specific ZIP files. The editable icon source, PNG icons, promotional image, bilingual listing copy and screenshots are included in `public/icons/` and `store/`.

## Authentication and permissions

The extension opens `chrome.identity.launchWebAuthFlow`, validates its random state, and exchanges an origin-bound code that expires after five minutes. The code is usable once. The resulting 30-day session is separate from the Web cookie session. GitHub and DeepSeek keys stay on the server.

Registered extension origins receive CORS headers. Edge privileged fetches were observed to omit `Origin`; these requests include `X-OpenSelf-Extension` and still require both an allowlisted ID and a valid code/bearer session. A supplied website Origin is never overridden by this header. Browser preflight remains restricted to registered extension origins.

The content script matches only GitHub new-issue pages. It checks the target page, uses native input setters, emits input/change events, and never clicks Submit. Unsupported editors fall back to the clipboard. It does not collect other page DOM content.

## Verification and release status

Both browser bundles compile. Edge successfully loaded the unpacked extension and exercised `launchWebAuthFlow`, bearer requests, AI-review controls, code-line navigation, draft saving and issue filling against the local fixture service. The test confirmed that no submit event fired. This verifies extension integration; it does not replace signing in to a real GitHub account or publishing against a real test repository.

The installed Chrome did not expose a service worker when launched headlessly with the unpacked-extension flags, so native Chrome runtime acceptance remains pending. Its bundle, shared extension logic and server protocol tests pass. Store uploads and reviews require the publisher's accounts and production URLs; see `store/LISTING.md`.
