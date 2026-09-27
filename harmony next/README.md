# HarmonyOS NEXT 适配工程

本目录是英语教师教学工作台的 HarmonyOS NEXT 壳层工程。业务页面继续复用线上前端：

- 前端地址：`https://fff.xmoj-script.uk/`
- API：由前端根据生产域名自动使用 `https://fff-api.xmoj-script.uk/api/v1`
- 应用包名：`cn.xmoj.teacherworkbench`

## 环境要求

- DevEco Studio（支持当前 HarmonyOS NEXT SDK）
- HarmonyOS SDK、Node.js、OHPM
- HarmonyOS NEXT 真机或模拟器
- 发布签名证书和 Profile（不要提交到仓库）

本机当前没有 `hvigorw`、`hdc`、`ohpm`，因此尚未执行 HAP 编译、安装和签名验证。

## 使用方式

1. 使用 DevEco Studio 打开本目录。
2. 等待同步 SDK 和依赖。
3. 连接 HarmonyOS NEXT 设备或启动模拟器。
4. 运行 `entry` 模块。
5. 发布前在 DevEco Studio 中配置签名，不要把证书、私钥、Profile 或密码放入 Git。

## 当前壳层行为

- ArkUI `Web` 组件加载工作台前端。
- 网络失败时显示错误页，并提供重新加载按钮。
- 应用允许访问 HTTPS 页面和生产 API。
- WebView 启用 JavaScript、DOM Storage 和缩放能力。
- `HarmonyBridge` 是前端与原生能力之间的预留接口；后续可接入文件保存、外链打开和应用版本检查。

## 发布注意事项

- 该目录只包含 HarmonyOS 工程，不包含 `.exe`、`.apk`、`.dmg`。
- HarmonyOS NEXT 安装包应使用独立的 HAP/App 发布清单，不复用 Android 的 APK 清单。
- 前端资源仍由 Pages 的 `update-manifest.json` 控制；更新网页前端不需要重新发布 HAP，但必须递增前端清单版本并部署 Pages。
- 若将远程页面改为本地打包页面，必须同步设计离线资源和前端更新策略。
- 首次发布前必须验证登录、文件导出、外部下载、系统返回键和弱网启动。
