---
name: React-Vite port registration
description: Every new react-vite artifact requires a [[ports]] entry in .replit or the workflow system never detects the port as open.
---

## Rule

When creating a new react-vite (or any) artifact, always add a `[[ports]]` entry to `.replit` for its `localPort` using `verifyAndReplaceDotReplit`. Without it, `restart_workflow` always times out with `DIDNT_OPEN_A_PORT` even though the server starts successfully.

**Why:** The Replit workflow system uses the `[[ports]]` table in `.replit` to know which local ports to monitor. Ports defined only in `artifact.toml` are NOT watched by the port-detection mechanism. The process starts fine (logs show "ready"), but `openPorts` stays `null` and the startup times out.

**How to apply:** After calling `createArtifact()` and getting the assigned port from `result.ports`, immediately call `verifyAndReplaceDotReplit` to append:
```toml
[[ports]]
localPort = <assigned_port>
externalPort = <assigned_port>
```

The two existing ports (8080 → 80, 8081 → 8081) were there from the initial monorepo scaffold — that's why those workflows always worked. Any artifact created afterwards gets no entry by default.
