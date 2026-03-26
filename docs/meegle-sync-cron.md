# Meegle + GitHub 定时同步

## 目标
定时调用以下接口，自动把任务数据同步到本地 `tasks`：
- `GET /api/integrations/meegle/webhook`
- `GET /api/integrations/github/sync`

## 启动方式

1. 确保应用在本地运行（默认 `http://localhost:3000`）：

```bash
npm run dev
```

2. 新开一个终端启动定时同步：

```bash
npm run meegle:sync:watch
```

## 手动触发一次

```bash
npm run meegle:sync
```

## 可选环境变量

- `SYNC_BASE_URL`：同步请求目标地址（默认 `http://localhost:3000`）
- `MEEGLE_SYNC_INTERVAL_SECONDS`：同步间隔秒数（默认 `300`）
- `GITHUB_INTERNAL_REPO_FULL_NAME`：内部主仓（`owner/repo`）
- `GITHUB_INTERNAL_REPO_BRANCH`：内部主仓分支（默认 `main`）
- `GITHUB_SYNC_COMMITS_PER_PAGE`：每轮扫描 commit 数（默认 `30`）

示例：

```bash
SYNC_BASE_URL=http://localhost:3000 MEEGLE_SYNC_INTERVAL_SECONDS=60 npm run meegle:sync:watch
```
