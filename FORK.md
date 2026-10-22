# Persistent session routing dashboard

This fork adds **Sessions & routing** for the matching [CLIProxyAPI backend fork](https://github.com/codewithsam110g/CLIProxyAPI). Frontend base: `fe2963330f32a933f562282165f62ae52cf57145`.

The **Dashboard** opens with two sections shared with the Sessions page: **Accounts** (one row per account with its 5-hour and weekly quota bars, reserve marks, reset countdowns, a status chip, and Refresh / Drain / Use-reset actions) and **Live conversations** (grouped by account, subagents nested under their parent, a "Moving: ..." badge while a move is pending, a row menu for Move and Details). The Dashboard re-reads the snapshot every 30 s while the tab is visible; Refresh asks the backend to poll the provider (`POST /routing/accounts/refresh-quota`). **Sessions & routing** shows the same two panels with idle conversations included; every raw field (ids, placement reason, generation, caller scope, usage quality, cache-write tokens, migration history) is under Details. Drain/resume controls govern new account assignments; manual moves are pending until the next safe request. The backend validates compatibility and expected binding generation. Missing quota stays unknown ("not checked yet"), never a made-up number.

Accounts distinguish **In reserve** (below the reserve: no new conversations, existing ones move only if another account has room) from **Exhausted** (provider limit reached: conversations must move). Codex accounts with manual reset credits show **Use reset (N available)**. The Config Panel's Network section holds the reserve percentages and the quota check interval (`routing.session-quota`). The Quick Start page was removed; `/quick-start` redirects to the Dashboard.

Connection revisions guard fetch results and actions so switching servers cannot apply a stale snapshot to another server. The visual config editor recognizes and preserves `routing.strategy: session-balanced`. Other backend strategies show instructions to enable the feature; an older backend without these endpoints reports a load error.

Build with Bun 1.3.14:

```bash
bun install --frozen-lockfile
bun run verify
```

Copy `dist/index.html` to the backend's static directory as `management.html` and disable automatic panel updates. The backend serves the UI, so production needs no separate frontend process. See the backend's [Docker/systemd/Nginx/Tailscale guide](https://github.com/codewithsam110g/CLIProxyAPI/blob/main/deploy/tailnet/README.md).

Validation: `bun run verify` passed 1,639 tests, lint and production build on macOS. In-app Chromium checks used the real local backend with two synthetic accounts and a loopback-only dummy provider: session creation, drain/resume, pending move and subsequent-request migration. No real provider account was used; Linux/Windows browser and live OAuth/cache behavior remain rollout checks.
