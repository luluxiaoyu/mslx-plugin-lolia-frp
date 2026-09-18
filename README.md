# MSLX Lolia FRP 穿透服务插件 (MSLX.Plugin.Lolia.Frp)

为 MSLX 提供 Lolia FRP 官方穿透服务接入，支持 OAuth2 PKCE 授权与隧道管理。

- **插件 ID**: `mslx-plugin-lolia-frp`
- **程序集**: `MSLX.Plugin.Lolia.Frp`

## 功能特性
1. **OAuth 2.0 PKCE 授权**：支持浏览器居中弹窗授权与手动输入授权码/Token 辅助。
2. **控制台用户面板**：展示用户信息、实名状态、带宽限制、隧道配额及流量统计。
3. **隧道管理**：支持查看隧道状态、新建隧道（支持 TCP/UDP/HTTP/HTTPS 协议及节点选择）、删除隧道。
4. **一键导入 MSLX**：拉取隧道配置并自动以 `Custom` 类型导入宿主穿透管理。
