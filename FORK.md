# Persistent session routing dashboard

This fork adds **Sessions & routing** for the matching [CLIProxyAPI backend fork](https://github.com/codewithsam110g/CLIProxyAPI). Frontend base: `fe2963330f32a933f562282165f62ae52cf57145`.

The page shows session/account bindings, parent/caller scope, generation, activity, usage quality and cache-read ratio, plus migration history. Drain/resume controls govern new account assignments; manual moves are pending until the next safe request. The backend validates compatibility and expected binding generation. Missing quota stays unknown. Cache-write tokens are displayed separately from cache reads.

Connection revisions guard fetch results and actions so switching servers cannot apply a stale snapshot to another server. The visual config editor recognizes and preserves `routing.strategy: session-balanced`. Other backend strategies show instructions to enable the feature; an older backend without these endpoints reports a load error.

Build with Bun 1.3.14:

```bash
bun install --frozen-lockfile
bun run verify
```

Copy `dist/index.html` to the backend's static directory as `management.html` and disable automatic panel updates. The backend serves the UI, so production needs no separate frontend process. See the backend's [Docker/systemd/Nginx/Tailscale guide](https://github.com/codewithsam110g/CLIProxyAPI/blob/main/deploy/tailnet/README.md).

Validation: `bun run verify` passed 1,639 tests, lint and production build on macOS. In-app Chromium checks used the real local backend with two synthetic accounts and a loopback-only dummy provider: session creation, drain/resume, pending move and subsequent-request migration. No real provider account was used; Linux/Windows browser and live OAuth/cache behavior remain rollout checks.
