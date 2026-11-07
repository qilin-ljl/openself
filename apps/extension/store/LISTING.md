# OpenSelf store listing draft

Version: 0.1.0. The extension is packaged for local installation; this file is submission copy, not evidence of a published listing.

## 中文

名称：OpenSelf

简述：在 GitHub 页面旁审查 PR、起草 Issue，确认后再发布。

详细介绍：

OpenSelf 为 GitHub 提供一个桌面浏览器侧边栏。你可以根据安全、性能、可读性和测试四类重点发起 AI 预审，查看文件风险和具体代码行上的意见，接受、编辑或拒绝结果，然后保存为待确认的审查草稿。

在新建 Issue 页面，描述问题后可以搜索重复讨论、按仓库模板起草内容、补充缺失信息并检查写作质量。点击“填入 GitHub 页面”只会填入标题和正文，不会替你提交。如果当前编辑器不支持回填，插件会提供复制内容的方式。

需要可用的 OpenSelf 服务和 GitHub 登录。AI 功能需要服务端提供 DeepSeek Key，或在 OpenSelf 设置中保存自己的 Key。私有仓库的 AI 分析需要单独同意。所有发布都需人工确认。

## English

Name: OpenSelf

Short description: Review GitHub pull requests and prepare clear issue drafts in a side panel.

Detailed description:

OpenSelf adds a desktop side panel to GitHub. Start an AI pre-review with security, performance, readability and testing playbooks; inspect file risks and feedback tied to code lines; accept, edit or reject findings; and save a review draft for human approval.

On new issue pages, describe the problem, check related discussions, draft from repository templates, answer follow-up questions and inspect writing quality. Fill page writes the title and body without clicking Submit. Unsupported editors fall back to copying the content.

A configured OpenSelf service and GitHub sign-in are required. AI features use the server's DeepSeek key or your own key saved in OpenSelf settings. Private repository analysis requires separate consent. Publications always require human approval.

## Assets and required production values

- Icons: `../public/icons/16.png`, `32.png`, `48.png`, `128.png`.
- Promotion: `promo.png`, generated from editable `promo.svg` (440 × 280).
- Screenshots: `screenshots/` contains captures of the real extension UI using clearly marked test data, at 1280 × 800.
- Privacy URL: the deployed HTTPS `APP_URL` followed by `/zh/privacy` or `/en/privacy`. Replace this with the actual live URL in the store form after deployment.
- Support/homepage URL: the actual production `APP_URL`. No placeholder domain should be submitted.

## Permission explanations

- `sidePanel`: display the workspace next to GitHub.
- `tabs`: identify the active GitHub repository/PR/issue URL and navigate to a selected code line.
- `identity`: sign in through the OpenSelf authorization flow.
- `storage`: retain the extension's own session token and expiration.
- `https://github.com/*`: fill supported new issue editors only after the user clicks Fill page.
- The configured OpenSelf origin: communicate with authenticated application APIs. The extension never receives GitHub access tokens or DeepSeek API keys.

## Submission handoff

Build again with the production `WXT_APP_URL`, configure Chrome and Edge extension IDs on the server, and verify sign-in on both browsers. The publisher must then use their own Chrome Web Store and Microsoft Partner Center accounts to upload the ZIP, set the live privacy/support URLs, review data disclosures and submit for review. No account, payment or store submission has been performed by this implementation.

Image requirements were checked against [Chrome Web Store guidance](https://developer.chrome.com/docs/webstore/images) and [Microsoft Edge publication guidance](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension). Both accept 1280 × 800 screenshots.
