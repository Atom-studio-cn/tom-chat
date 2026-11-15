# Tom

一个类似 QQ 的 Windows 桌面聊天工具。Electron 桌面壳加载线上前端，账号、消息、好友、图片与匿名广场都由云端服务提供，换电脑登录同一个账号即可看到全部数据。

## 功能

- 手机号 / 邮箱验证码登录（未注册自动创建账号），也支持 WorkBuddy 账号登录
- 单聊与群聊、消息气泡、时间线、未读提醒、2.5 秒轮询同步
- 表情、图片、文件上传到云端存储，签名链接预览
- 好友分组、在线 / 离开 / 忙碌 / 隐身状态、按 Tom 号搜人加好友
- 云端消息记录、会话内搜索、清空自己发送的消息
- 个人资料页：头像、昵称、签名、状态
- **匿名广场**：随机匿名身份、云端收发、回复、删除自己的消息；身份归属字段对其他用户不可读

## 目录

```
web/        线上前端（纯静态，无构建步骤）
  index.html / styles.css
  config.js   云端公共配置
  cloud.js    数据访问层（Auth / Database / Storage）
  anon.js     匿名广场模块
  app.js      主界面逻辑
  icon.png    favicon
desktop/    Electron 桌面壳
  main.js / preload.js / package.json / start.bat
  build/icon.ico        多尺寸 Windows 图标
  tools/make-icon.js    图标生成脚本（纯 Node，无依赖）
```

## 运行

**在线使用**：把前端部署到你自己的域名后打开该地址。桌面壳 `main.js` 里的 `TOM_URL` 指向它，可用环境变量 `TOM_URL` 覆盖。仓库里是占位地址，直接运行会提示先配置。

**从源码启动桌面端**：

```bash
cd desktop
npm install
npm start
```

**构建 Windows 安装包**：

```bash
cd desktop
npm install
npm run dist        # 产物在输出目录，NSIS 安装程序
```

**生成图标**：

```bash
node desktop/tools/make-icon.js
```

会重建 `desktop/build/icon.ico`、预览图与 `web/icon.png`。

## 云端配置（仓库内为占位符）

`web/config.js` 和 `desktop/main.js` **故意只放占位符**，不含任何可用的应用地址、访问码或密钥，因此公开仓库的访客无法连接到任何线上实例。未填写时前端会显示提示并拒绝初始化，桌面端弹窗后退出。

接入自己的云环境：

1. 在 `web/config.js` 填入 `endpoint` / `oauthRelayBaseUrl` / `publishableKey`（应用自身的公开配置，不含管理员密钥）。
2. 把 `desktop/main.js` 的 `TOM_URL` 换成你的发布地址，**或**设置环境变量 `TOM_URL`（推荐，避免地址写进源码）。
3. 不要把填好的真实值提交到公开仓库；建议放在被忽略的本地文件里，或用环境变量注入。
4. 服务端会校验请求来源域名，页面必须来自该应用的发布域名。
5. 按下表建表（RLS 需按成员与归属隔离）：

| 表 / 视图 | 用途 |
|---|---|
| `tom_profiles` | 昵称、Tom 号、头像、签名、在线状态 |
| `tom_friendships` | 好友关系与分组 |
| `tom_conversations` | 单聊 / 群聊会话与最后一条消息 |
| `tom_messages` | 聊天消息 |
| `tom_anon_messages` | 匿名广场消息（写入与删除走此表） |
| `tom_anon_public` | 只暴露公开列的视图，客户端查询用 |

匿名表不给整表读权限，只授权公开列，并把 `owner_id` 隐藏；写入与删除通过 RLS 限定本人。

## 已知限制

- 消息同步基于轮询，不是 WebSocket 推送
- 收藏与偏好设置保存在本机，不跨设备同步
- 匿名广场只发文字与表情，避免图片路径暴露身份
- 安装包未做代码签名，首次运行会触发 SmartScreen
- 应用需要联网；分享链接的访问码有有效期，失效后需重新发布并更新 `TOM_URL`
