# GitHub Actions 自动发布

配置日期：2026-10-01（Asia/Shanghai）。站点： https://play.635cloud.fyi/games/hill/

## 日常操作

1. 本地修改、运行、试玩满意；按本轮改动需要自行决定是否运行开发测试。
2. 只提交本次想上线的文件，提交并推送游戏仓库的 `main`。包含 Codex 协助修改的提交追加 `Co-authored-by: Codex <noreply@openai.com>`。
3. 打开 [仓库 Actions](https://github.com/FlyingPan635/retro-scenic-game/actions)，选择 **Deploy game**，打开最新运行。绿色表示完成；每个步骤可以展开查看日志。若显示 main 已前进而跳过，查看更新的运行。
4. 打开游戏刷新检查。线上 `/release.json` 记录当前提交 SHA、运行序号和重试次数。

发布流程直接使用 Python 打包静态文件，不安装 Node.js、Playwright 或 Chromium，不运行音频检查。`tests/audio-check.cjs` 仅是遗留开发检查文件，保留在仓库，既不作为发布门槛，也不作为手动发布测试选项。仅打包根目录 HTML/CSS/JS、favicon、VERSION 和 vendor（含许可证）；不上传测试、本地启动器、Git 历史或依赖目录。

## 手动重发与回滚

- **重发当前 main**：Actions → Deploy game → Run workflow → Branch 选 `main` → `rollback_release` 留空 → Run workflow。会重新发布当前版本，始终执行文件校验和上线检查。
- **回到上一个成功版本**：同一界面将 `rollback_release` 填 `previous`。此操作跳过构建，切换保留的成功版本，仍执行本机和公网检查。
- **回到指定成功版本**：填版本目录名，如 `2-1-abcdef123456`；必须是服务器仍保留的版本。目录名可在发布日志的 `SUCCESS` 行查看。
- **失败重试**：运行页面右上角 Re-run jobs。若 main 已更新，旧运行会跳过；推荐 Run workflow 重发当前 main。旧序号已被服务器处理过时会拒绝，不能覆盖更新版本。
- 回滚不改变 Git 历史；以后新的 main 推送仍会发布新提交。若需要长期撤回代码，在本地 `git revert` 对应代码提交再推送。

服务器只保留最近五个成功版本（初始上传版本暂时也计入）。失败候选会清除；迁移前的独立备份另存 `/srv/game-backups/before-actions-20261001T070031Z/`，不会被五版本清理删除。初始备份不是 Git 构建，SHA 标为 `pre-actions-upload`。

## 发布保护与服务器位置

- 专用用户 `deploy-hill`，无 sudo；每个游戏有独立 Ed25519 私钥，仓库 Secret 名称均为 `DEPLOY_SSH_KEY`，值各不相同。
- 密钥只能执行本游戏的 `deploy`、`rollback`、`status` 命令，不能打开 shell、SFTP、端口转发或改另一个游戏。私钥不在仓库中；Windows 临时副本在验证结束后删除。
- SSH 端口 2022；固定主机 Ed25519 指纹：`SHA256:vidHT9zJlWCt5SRp7ScIoE8LAtqyE1U4fcDSIMUMGO4`。来自既有严格主机校验连接及服务器公钥的交叉核对；不在 CI 动态信任 ssh-keyscan。
- 原运行路径 `/srv/games/hill` 现在指向 `/srv/game-releases/hill/current`；`current` 再指向 `releases/<运行序号>-<重试次数>-<SHA前12位>`。
- 上传通过受限 SSH 的标准输入，不需要 shell/scp 权限。服务端先核对整个压缩包 SHA256，再拒绝越界路径、链接和特殊文件，校验所有运行文件和提交元数据，再原子切换 `current`。
- 上线检查从 Node 本机和公网 HTTPS 读取版本标记、HTML 及所有浏览器资源并核对内容；失败自动切回旧版并复查，Actions 显示失败。VERSION 和第三方许可在磁盘校验，不通过主站不支持的静态后缀请求。
- Actions 不取消正在切换的部署，按游戏串行；发布前核对当前 main；服务端文件锁和 `(run_number, run_attempt)` 持久化水位再次拒绝乱序/重复任务。保留此工作流文件和序号连续性；更名/删除重建工作流前由管理员处理水位。
- `/srv/game-releases/hill/history.jsonl` 记录成功发布和手动回滚；`sequence.json` 是防乱序水位；各版本 `release.json` 是来源，`manifest.json` 是文件校验清单，`success.json` 是成功记录。
- `/usr/local/libexec/game-deploy` 是 root 所有的受限服务端程序；仓库 `deploy/server.py` 是其审阅副本。修改副本不会自动升级服务器管理程序，需管理员审阅安装。
- 主站代码、配置、自动发布、Nginx、Cloudflare 和 Xray 不属于游戏工作流；VPS 443 继续留给 Xray。

## 管理员检查

使用现有管理员连接登录 VPS（不使用部署密钥开 shell）：

```sh
readlink -f /srv/games/hill
cat /srv/game-releases/hill/current/release.json
ls /srv/game-releases/hill/releases
tail /srv/game-releases/hill/history.jsonl
cat /srv/game-releases/hill/acceptance.json
```

Actions 官方文档：[部署和并发控制](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)。
