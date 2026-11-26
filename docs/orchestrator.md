# `/mh-orchestrate` trial

The trial is an optional Pi extension, not part of the default 13-entry manifest or installer. An operator must explicitly load `extensions/mahiro-orchestrator.ts` into a guarded primary session that already has the Mahiro kernel, PSS and the matching patched Subagents package. Loading a second copy of Subagents or filling in a missing writer with another role is not supported. The trial does not change the selected Main model, role descriptors, profile, permission policy or default tools.

For an isolated trial, install the candidate's frozen dependencies in its own checkout. In a disposable Pi agent directory, register the checkout and the exact PSS and Subagents dependency owners once in `settings.json`. In that agent directory's `subagents.json`, put the exact registered Subagents source string in `excludedExtensionPackages`; package exclusion matches the configured source, not an arbitrary alias. Check for a project `.pi/subagents.json` override. Set up ordinary PSS policy and a configured `implementer` role within that disposable profile, then launch a new session with `-e /absolute/candidate/checkout/extensions/mahiro-orchestrator.ts`. Do not repoint an installed daily profile to the trial checkout.

Run `/mh-orchestrate` to switch between ON and OFF. It starts OFF in a new session or after reload. The toggle never starts a worker. Main still answers questions and handles small work directly. When delegating already authorized implementation would help, Main sends a bounded objective, writable scope, non-goals, checks and expected evidence to the existing `implementer` role. The trial is not a model selector, scheduler, permission grant or worktree manager.

Dispatch goes through Pi's `ctx.executeTool()` and the ordinary PSS-guarded `subagent` tool. The pinned Subagents patch adds an opt-in exact-role path: it requires an available configured `provider/model` on the exact role and refuses fallback, keeps configured locks, and starts a fresh background worker without the parent's assembled system prompt or conversation history. The worker still has its own role, tools and independently loaded project guidance. Main must not copy private context or credentials into the brief. Unflagged Subagents calls keep their existing behavior.

Only one orchestrated writer can be in flight. Turning OFF blocks new dispatch and cancels pending admission. Work already accepted by native Subagents can finish and deliver its normal notification, including a Main turn. That turn may review or report the result; it does not schedule a new worker. Re-enabling during state `finishing` does not open a second slot. A turn already in progress before a mode change cannot submit new orchestration after re-enable; start a fresh Main turn. Reload retires the trial's old ownership, does not adopt its job, and leaves native Subagents in charge of its own shutdown.

The footer shows `Orch on`, `Orch · worker`, `Orch · review`, `Orch off` or `Orch off · finishing` (shortened at narrow widths). `review` means the owned writer reached a terminal state, not that the result passed checks. An unverified dispatch shows `unknown` and blocks retries for that session; inspect the native Subagents result rather than relaunching. Worker completion, Main verification and human acceptance stay separate. Reuse `/mh-todos` for session steps rather than creating an Execution Run to track one worker.

## Offline validation

With the worktree's reviewed public dependencies installed, run:

```sh
node --test --test-reporter=spec lib/guards/test/orchestrator-offline-test.mjs
node --import ./test/public-dependency-loader.mjs --test --test-reporter=spec test/footer.test.ts
```

The SDK fixture uses disposable profiles and deterministic Faux inference, not installed profile activation or live-provider verification.
