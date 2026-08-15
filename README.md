# 想法台 · Idea Desk

一个由 NAS 持久化的个人想法工作台，用来接住灵感、筛选方向、记录最小实验，并把想法推进到完成。

线上地址：<https://ideas.yangjunhu.com/#/all>

## 打开

不需要安装第三方依赖。建议使用内置服务运行，因为它同时提供网页和数据 API：

```bash
python3 server.py
```

然后访问 <http://localhost:8124/#/all>。

本地需要验证认证时，可以同时设置 `IDEA_DESK_USERNAME` 和 `IDEA_DESK_PASSWORD`。只设置其中一个会拒绝启动；Docker/NAS 部署默认强制要求两项凭据。

只用 `python3 -m http.server` 也能查看静态页面，但不会提供数据 API，保存时会退回浏览器本地缓存。

## Docker 部署

```bash
cp .env.example .env
# 在 .env 中换成长随机密码，不要提交该文件
docker compose up -d --build
```

容器监听宿主机 `127.0.0.1:8184`，适合由 NAS 上的 Cloudflare Tunnel 或反向代理接入。健康检查地址是 `/healthz`。

## 数据存储

- 正常运行时，网页通过同源 `/api/state` API 将完整状态保存到 NAS 项目目录的 `data/state.json`。
- 每次覆盖状态前会在 `data/backups` 自动保留上一修订，滚动保存最近 25 份。
- 项目资料和节点截图通过 `/api/uploads` 上传到 NAS 的 `data/uploads`，状态文件只记录文件元数据和地址。
- NAS 备份需要完整备份 `data` 目录；网页导出的 JSON 不包含上传文件的二进制内容。
- Docker Compose 通过 `./data:/app/data` 持久化数据，重建容器不会删除数据。
- 浏览器仍保留一份本地缓存，用于 NAS 暂时不可用时继续使用；NAS 恢复后下一次保存会重新同步。
- 首次打开新部署时，如果 NAS 尚无状态文件，网页会自动把当前浏览器里的旧数据迁移到 NAS。
- Docker/NAS 部署使用整站 Basic Auth；`/healthz` 保持匿名可用，便于容器和 Tunnel 健康检查。
- 浏览器整包保存使用状态修订和 `If-Match`，与 AI 节点 PATCH 冲突时返回 409，不再静默覆盖较新的 NAS 数据。
- 静态服务器只开放首页、CSS、JS 和受控 `/uploads/<id>`；源码、`data` 和目录列表均不可通过公网读取。

NAS 账号、目录规范、凭据读取、部署命令和 Cloudflare Tunnel 配置见 [`docs/NAS_DEPLOYMENT.md`](docs/NAS_DEPLOYMENT.md)。这份文档可以作为其他项目部署到同一台 NAS 的参考。

## 已包含

- 想法收件箱，以及“准备尝试 / 以后再说 / 已完成”状态队列
- 当前专注：一次只突出一个准备尝试的想法
- 兴趣、价值、易验证三项评分和验证优先级
- 问题、目标用户、最小版本、下一步动作、完成线
- 项目级多文件资料区，支持 PRD、设计文档、图片、表格、演示文稿和 ZIP
- 单项目 AI 上下文地址，包含资料下载链接、节点进度和节点更新接口
- 可无限嵌套的项目节点树、同层级即时拖动排序、自动连续编号、批量录入、节点状态和截图附件
- 48 小时最小实验的目标、状态和结果记录
- 搜索、标签筛选、排序、本周复盘视图
- Ideas 2.0 研发驾驶舱，汇总项目、当前阶段、节点进度与准备度
- 项目详情的阶段导航和准备度检查预览
- NAS 自动保存，支持 JSON 导入和导出
- 状态修订冲突检测、滚动备份、静态资源白名单和可选整站认证
- 桌面端三栏布局和移动端菜单

数据的权威副本保存在 NAS；浏览器 `localStorage` 只作为离线兜底缓存。

## 验证

```bash
python3 -m unittest discover -s tests -v
python3 -m py_compile server.py
```

部署前还应执行 `git diff --check`，并在 1440×900、1024×768、390×844 三种视口检查驾驶舱和项目详情。
