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
| 节点截图目录 | `/var/services/homes/deploy/project/idea-workbench/data/uploads` |
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

同步项目文件后，在 NAS 上执行：

```bash
cd /var/services/homes/deploy/project/idea-workbench
sudo /usr/local/bin/docker-compose up -d --build
sudo /usr/local/bin/docker-compose ps
curl -fsS http://127.0.0.1:8184/healthz
```

数据通过同源 API 写入 `data/state.json`，节点截图写入 `data/uploads`。Compose 使用 `./data:/app/data` 挂载整个数据目录，重建镜像或容器不会删除想法数据与截图。

备份时需要完整备份 `data` 目录。网页导出的 JSON 只包含截图地址，不包含图片二进制文件。

当前版本暂不接入账号认证，公网域名上的 `/api/state` 具备读写权限，只适合个人或受信任环境。后续接入账号时，需要在 API 层校验当前用户，并将数据按用户隔离。

公网验证：

```bash
curl -fsS https://ideas.yangjunhu.com/healthz
```

预期输出：

```text
ok
```

## 文件同步

NAS 当前 SSH 服务不支持标准 SFTP/scp 子系统。可以通过 SSH 标准输入同步单个文件：

```bash
ssh deploy@192.168.3.31 \
  'dd of=/var/services/homes/deploy/project/idea-workbench/styles.css bs=64K status=none' \
  < styles.css
```

完整项目首次部署时，先在 NAS 创建目标目录，再逐个同步部署所需文件。不要同步 `.git`、本地日志、环境变量文件或其他凭据。

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
