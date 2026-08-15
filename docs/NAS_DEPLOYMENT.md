# NAS 部署参考

这份文档记录本项目在群晖 NAS 上的部署方式，也可以作为其他小型 Web 项目的部署模板。

## 连接信息

| 项目 | 值 |
| --- | --- |
| NAS 地址 | `192.168.3.31` |
| SSH 账号 | `deploy` |
| SSH 命令 | `ssh deploy@192.168.3.31` |
| 项目根目录 | `/var/services/homes/deploy/project` |
| 本项目目录 | `/var/services/homes/deploy/project/idea-workbench` |
| 容器名称 | `idea-workbench` |
| 本机监听 | `127.0.0.1:8184` |
| 容器端口 | `8080` |
| 数据目录 | `/var/services/homes/deploy/project/idea-workbench/data` |
| 状态文件 | `/var/services/homes/deploy/project/idea-workbench/data/state.json` |
| 上传文件目录 | `/var/services/homes/deploy/project/idea-workbench/data/uploads` |
| 公网域名 | `ideas.yangjunhu.com` |
| 线上地址 | `https://ideas.yangjunhu.com/#/all` |
| 健康检查 | `https://ideas.yangjunhu.com/healthz` |

SSH 已配置密钥登录。`deploy` 的 sudo 密码保存在当前 Mac 的系统钥匙串中，不写入仓库或普通文本文件。

```bash
security find-generic-password \
  -a deploy \
  -s codex-nas-deploy \
  -w
```

钥匙串条目：

- 服务名称：`codex-nas-deploy`
- 账号名称：`deploy`
- 用途：NAS SSH/sudo 部署凭据

## 项目约定

新项目建议沿用以下结构：

```text
/var/services/homes/deploy/project/<project-name>
```

域名建议使用简短的业务名称，例如：

```text
<project>.yangjunhu.com
```

每个项目使用独立容器、独立宿主机端口和独立 Cloudflare Tunnel ingress 规则。宿主机端口只绑定 `127.0.0.1`，不要直接暴露到局域网或公网。

## 本项目部署

NAS 的非交互式 SSH 环境不会自动包含 Container Manager 的路径。应使用完整路径：

```bash
/usr/local/bin/docker-compose
/usr/local/bin/docker
```

首次部署默认不启用登录，也不要求创建 `.env`。需要整站 Basic Auth 或邮件通知时，才以 `.env.example` 为参考手动创建 `.env`，并执行 `chmod 600 .env`。升级时 NAS 上已有的 `.env` 是凭据权威副本：不得从本机上传 `.env`，也不得用 `.env.example` 覆盖它。`.env` 已被 Git 忽略，不得同步回本机仓库、日志或聊天记录。

升级必须先停止 `web` 服务以停止所有页面、API 和周任务写入，再创建一致性备份。以下命令应在同一个 SSH 会话中连续执行；它同时给旧镜像保留一个可回滚标签：

```bash
cd /var/services/homes/deploy/project/idea-workbench
set -eu

IDEA_DEPLOY_STAMP="$(date +%Y%m%d-%H%M%S)"
IDEA_BACKUP_DIR="data.before-${IDEA_DEPLOY_STAMP}"
IDEA_ROLLBACK_IMAGE="idea-workbench:rollback-${IDEA_DEPLOY_STAMP}"

sudo test ! -e "$IDEA_BACKUP_DIR"
if sudo /usr/local/bin/docker image inspect "$IDEA_ROLLBACK_IMAGE" >/dev/null 2>&1; then
  echo "Rollback image already exists: $IDEA_ROLLBACK_IMAGE" >&2
  exit 1
fi

if sudo test -f .env; then
  IDEA_ENV_HASH_BEFORE="$(sudo sha256sum .env | awk '{print $1}')"
fi

sudo /usr/local/bin/docker image tag \
  "$(sudo /usr/local/bin/docker inspect -f '{{.Image}}' idea-workbench)" \
  "$IDEA_ROLLBACK_IMAGE"
sudo /usr/local/bin/docker-compose stop web
test "$(sudo /usr/local/bin/docker inspect -f '{{.State.Running}}' idea-workbench)" = "false"

sudo test -s data/state.json
sudo test -d data/uploads
sudo test -d data/backups
sudo cp -a data "$IDEA_BACKUP_DIR"
sudo test -s "$IDEA_BACKUP_DIR/state.json"
sudo test -d "$IDEA_BACKUP_DIR/uploads"
sudo test -d "$IDEA_BACKUP_DIR/backups"
```

容器停止后网站会暂时不可用，这是确保 `state.json` 与附件来自同一时刻的必要停写窗口。复制完成后，在重新启动服务前校验状态 JSON、状态文件哈希、上传文件数量和逐文件内容哈希：

```bash
set -eu

sudo /usr/local/bin/docker run --rm \
  -v "$PWD/$IDEA_BACKUP_DIR/state.json:/state.json:ro" \
  "$IDEA_ROLLBACK_IMAGE" \
  python3 -m json.tool /state.json >/dev/null

IDEA_LIVE_STATE_HASH="$(sudo sha256sum data/state.json | awk '{print $1}')"
IDEA_BACKUP_STATE_HASH="$(sudo sha256sum "$IDEA_BACKUP_DIR/state.json" | awk '{print $1}')"
test "$IDEA_LIVE_STATE_HASH" = "$IDEA_BACKUP_STATE_HASH"

IDEA_LIVE_UPLOAD_COUNT="$(sudo find data/uploads -type f | wc -l | tr -d ' ')"
IDEA_BACKUP_UPLOAD_COUNT="$(sudo find "$IDEA_BACKUP_DIR/uploads" -type f | wc -l | tr -d ' ')"
test "$IDEA_LIVE_UPLOAD_COUNT" = "$IDEA_BACKUP_UPLOAD_COUNT"

IDEA_LIVE_UPLOAD_HASH="$(
  sudo sh -c 'cd "$1/uploads" && find . -type f -exec sha256sum {} \; | LC_ALL=C sort | sha256sum' sh data |
    awk '{print $1}'
)"
IDEA_BACKUP_UPLOAD_HASH="$(
  sudo sh -c 'cd "$1/uploads" && find . -type f -exec sha256sum {} \; | LC_ALL=C sort | sha256sum' sh "$IDEA_BACKUP_DIR" |
    awk '{print $1}'
)"
test "$IDEA_LIVE_UPLOAD_HASH" = "$IDEA_BACKUP_UPLOAD_HASH"

printf 'backup=%s\nrollback_image=%s\nstate_sha256=%s\nuploads=%s\nuploads_sha256=%s\n' \
  "$IDEA_BACKUP_DIR" \
  "$IDEA_ROLLBACK_IMAGE" \
  "$IDEA_BACKUP_STATE_HASH" \
  "$IDEA_BACKUP_UPLOAD_COUNT" \
  "$IDEA_BACKUP_UPLOAD_HASH"
```

任一 `test` 或 JSON 校验失败都必须停止升级，不得删除失败的备份。此时运行 `sudo /usr/local/bin/docker-compose start web` 恢复旧容器，并先查明备份失败原因。

备份验证通过后再同步版本化代码文件。同步后若升级前存在 `.env`，用保存的哈希确认它未被覆盖，然后构建并启动：

```bash
cd /var/services/homes/deploy/project/idea-workbench
set -eu

if [ -n "${IDEA_ENV_HASH_BEFORE:-}" ]; then
  test "$IDEA_ENV_HASH_BEFORE" = "$(sudo sha256sum .env | awk '{print $1}')"
fi

sudo /usr/local/bin/docker-compose up -d --build web
sudo /usr/local/bin/docker-compose ps
curl -fsS http://127.0.0.1:8184/healthz
```

数据通过同源 API 写入 `data/state.json`，项目资料和节点截图写入 `data/uploads`，历史状态滚动保存在 `data/backups`。Compose 使用 `./data:/app/data` 挂载整个数据目录，重建镜像或容器不会删除想法数据、上传文件和最近 25 份状态备份。

备份时需要完整备份 `data` 目录。网页导出的 JSON 只包含上传文件地址，不包含文件二进制内容。

## 回滚

如果新镜像无法正常运行，但数据不需要回退，可将运行代码恢复到升级前标记的镜像。把下面时间戳替换为备份阶段输出的确切值；先校验镜像存在，再移除新容器。`docker-compose rm` 只删除已停止的容器，不会删除 bind mount 的 `data` 或 NAS 上的 `.env`：

```bash
cd /var/services/homes/deploy/project/idea-workbench
set -eu

IDEA_ROLLBACK_IMAGE="idea-workbench:rollback-20260816-090000"
sudo /usr/local/bin/docker image inspect "$IDEA_ROLLBACK_IMAGE" >/dev/null
IDEA_COMPOSE_IMAGE_REF="$(sudo /usr/local/bin/docker inspect -f '{{.Config.Image}}' idea-workbench)"

sudo /usr/local/bin/docker-compose stop web
sudo /usr/local/bin/docker-compose rm -f web
sudo /usr/local/bin/docker image tag "$IDEA_ROLLBACK_IMAGE" "$IDEA_COMPOSE_IMAGE_REF"
sudo /usr/local/bin/docker-compose up -d --no-build web
curl -fsS http://127.0.0.1:8184/healthz
```

如果新版本已经错误迁移或写入数据，需要恢复升级前的数据。必须显式填写并核对备份目录，不能用通配符或“自动选择最新目录”。当前失败数据会先改名保留，不会直接删除：

```bash
cd /var/services/homes/deploy/project/idea-workbench
set -eu

IDEA_BACKUP_DIR="data.before-20260816-090000"
IDEA_FAILED_DATA_DIR="data.failed-$(date +%Y%m%d-%H%M%S)"
case "$IDEA_BACKUP_DIR" in
  data.before-[0-9]*) ;;
  *) echo "Unexpected backup directory: $IDEA_BACKUP_DIR" >&2; exit 1 ;;
esac
sudo test -s "$IDEA_BACKUP_DIR/state.json"
sudo test -d "$IDEA_BACKUP_DIR/uploads"
sudo test -d "$IDEA_BACKUP_DIR/backups"
sudo test -d data
sudo test ! -e "$IDEA_FAILED_DATA_DIR"

sudo /usr/local/bin/docker-compose stop web
test "$(sudo /usr/local/bin/docker inspect -f '{{.State.Running}}' idea-workbench)" = "false"
sudo mv data "$IDEA_FAILED_DATA_DIR"
sudo cp -a "$IDEA_BACKUP_DIR" data
test "$(sudo sha256sum data/state.json | awk '{print $1}')" = \
  "$(sudo sha256sum "$IDEA_BACKUP_DIR/state.json" | awk '{print $1}')"

sudo /usr/local/bin/docker-compose up -d --no-build web
curl -fsS http://127.0.0.1:8184/healthz
```

需要同时回滚代码和数据时，在服务停止后先执行数据恢复到哈希校验为止，不要启动；再执行代码回滚中的移除容器、重打镜像标签和 `up -d --no-build web`。确认首页、`/healthz`、想法数量、节点数量和附件可访问后，才保留或清理 `data.failed-*`。清理属于不可恢复操作，不包含在自动回滚命令中。

## 每周自动复盘与邮件

Compose 默认设置 `IDEA_DESK_WEEKLY_REPORT_ENABLED=true`。调度线程运行在 NAS 容器内，不依赖浏览器或某一台电脑保持打开。任务固定在每周一 `09:00`（`Asia/Shanghai`）执行，统计上周一 `00:00`（含）到本周一 `00:00`（不含）的活动，包括：

- 新增、更新和完成的想法；
- 本周完成的节点和当前进行中的节点；
- 进行中项目的当前阶段、当前节点、节点进度和持续时间。

报告写入 `data/state.json` 的 `weeklyReports`，滚动保留最近 52 周。自动统计不会覆盖页面中已有的手动复盘字段；浏览器整包保存时也会保留 NAS 已生成的报告。同一周的报告使用固定标识，容器重启后不会重复创建。

不需要邮件时无需创建 `.env`，或保持 `.env.example` 中全部 SMTP 地址和凭据为空。定时器仍会生成并保存周报，但不会连接邮件服务器。若要启用通知，在 NAS 项目目录创建 `.env`：

```dotenv
IDEA_DESK_WEEKLY_REPORT_ENABLED=true
IDEA_DESK_WEEKLY_MAX_ATTEMPTS=3
IDEA_DESK_WEEKLY_RETRY_SECONDS=300

# STARTTLS（常用端口 587）或隐式 TLS（ssl，常用端口 465）
IDEA_DESK_SMTP_SECURITY=starttls
IDEA_DESK_SMTP_HOST=smtp.example.com
IDEA_DESK_SMTP_PORT=587
IDEA_DESK_SMTP_USERNAME=sender@example.com
IDEA_DESK_SMTP_PASSWORD=<邮箱授权码>
IDEA_DESK_SMTP_FROM=sender@example.com
IDEA_DESK_WEEKLY_RECIPIENTS=recipient@example.com
IDEA_DESK_SMTP_TIMEOUT_SECONDS=20
```

以上地址均为占位示例，不可直接用于生产。多个收件人使用英文逗号或分号分隔。需要认证的 SMTP 服务必须同时设置 `IDEA_DESK_SMTP_USERNAME` 和 `IDEA_DESK_SMTP_PASSWORD`，只设置其中一项时服务会拒绝启动。`IDEA_DESK_SMTP_SECURITY` 只允许 `starttls` 或 `ssl`。发送失败最多重试 `IDEA_DESK_WEEKLY_MAX_ATTEMPTS` 次，每次间隔 `IDEA_DESK_WEEKLY_RETRY_SECONDS` 秒；页面的报告历史会记录发送状态、尝试次数和经过归类的错误码，不记录服务器返回正文或凭据。

写入配置后限制文件权限并重建容器：

```bash
cd /var/services/homes/deploy/project/idea-workbench
chmod 600 .env
sudo /usr/local/bin/docker-compose up -d --build
```

保持 SMTP 主机、发件人和收件人为空，即可在不发送邮件的情况下验证调度配置：

```bash
curl -fsS http://127.0.0.1:8184/api/weekly-automation | python3 -m json.tool
```

预期响应中 `enabled` 为 `true`、`configured` 为 `false`，并包含 `timezone: "Asia/Shanghai"`、周一 `09:00` 的 `schedule` 和下一次运行时间 `nextRunAt`。该接口只返回主机是否配置、收件人数量等状态，不返回 SMTP 用户名、密码或收件人地址。还可在本机运行 `python3 -m unittest discover -s tests -v`，周报和邮件测试使用临时数据及替身邮件发送器，不会发送真实邮件。

项目刻意不提供公开的“立即发送周报”接口。当前生产默认无需账号密码，若开放此类入口会形成邮件滥用风险；自动发送只由容器内调度线程触发。

SMTP 密码或邮箱授权码只能保存在 NAS 的 `.env` 中，不得提交到 Git、同步回本机仓库、打印到日志或粘贴到聊天记录。运行 `docker-compose config` 会展开环境变量，配置真实凭据后不要将其输出保存或分享。

生产 Compose 默认不启用登录；知道域名的人可以访问页面和 API，因此只适合明确接受该风险的个人环境。设置 `IDEA_DESK_REQUIRE_AUTH=true` 后，必须同时配置 `IDEA_DESK_USERNAME` 和 `IDEA_DESK_PASSWORD`，整站和全部 `/api/*`、`/uploads/*` 使用 Basic Auth，且 `/healthz` 是唯一匿名入口。当前仍是单 Workspace 个人应用，后续多人化时还需要实体级授权和租户隔离。

静态服务使用白名单，公网不得访问 `/data/*`、`/server.py`、`/README.md` 或目录列表。附件响应使用 `private, no-store`，避免经过浏览器或边缘节点长期公共缓存。

单项目 AI 上下文接口：

```text
GET /api/ideas/<idea-id>/context
```

响应包含项目页面地址、想法数据、项目资料下载地址、节点截图、进度汇总，以及节点进度更新接口模板。节点更新使用：

```text
PATCH /api/ideas/<idea-id>/nodes/<node-id>
```

请求体可以包含 `status` 和 `content`；状态只允许 `not_started`、`in_progress`、`completed`。

Context 响应中的 `stateRevision` 是当前状态修订。节点 PATCH 可携带 `If-Match: "<stateRevision>"`；修订不一致返回 409。浏览器对 `/api/state` 的整包 PUT 必须携带 `If-Match`，缺少时返回 428，防止多标签页或 AI 更新被旧快照静默覆盖。

命令行访问需要显式认证，例如：

```bash
curl -fsS -u "$IDEA_DESK_USERNAME:$IDEA_DESK_PASSWORD" \
  https://ideas.yangjunhu.com/api/ideas/<idea-id>/context
```

公网验证：

```bash
curl -fsS https://ideas.yangjunhu.com/healthz
```

预期输出：

```text
ok
```

健康检查同时验证数据目录可读写、`state.json` 可解析，以及已存在的上传和备份目录可用；状态损坏时返回 503 `unhealthy`。

发布后还要验证以下路径：未启用认证时首页返回 200；启用认证时匿名首页返回 401、认证首页返回 200；两种模式下 `/data/state.json`、`/data/`、`/data/uploads/` 和 `/server.py` 均返回 404。

## 文件同步

NAS 当前 SSH 服务不支持标准 SFTP/scp 子系统。可以通过 SSH 标准输入同步单个文件：

```bash
ssh deploy@192.168.3.31 \
  'dd of=/var/services/homes/deploy/project/idea-workbench/styles.css bs=64K status=none' \
  < styles.css
```

完整项目首次部署时，先在 NAS 创建目标目录，再逐个同步部署所需文件。升级只同步版本化代码和文档；不得上传本机 `.env`，不得把 `.env.example` 复制为已有的 `.env`，也不得使用会删除 NAS 独有文件的同步参数。不要同步 `.git`、本地日志、环境变量文件或其他凭据。

## Cloudflare Tunnel

本项目的 Tunnel ingress 应将域名转发到 NAS 本机端口：

```yaml
- hostname: ideas.yangjunhu.com
  service: http://127.0.0.1:8184
```

新项目需要：

1. 分配一个未占用的 `127.0.0.1` 宿主机端口。
2. 在 `compose.yaml` 中绑定该端口。
3. 为 `<project>.yangjunhu.com` 增加 Tunnel ingress。
4. 重启或重载 Tunnel。
5. 从公网验证首页和 `/healthz`。

## GitHub 发布

本项目仓库：<https://github.com/Yang-sd/idea-workbench>

部署完成并验证后再提交：

```bash
git diff --check
git status --short
git add <changed-files>
git commit -m "Describe the change"
git push origin main
```

严禁提交密码、Cloudflare Token、私钥、Cookie 或 `.env.*` 本地配置。
