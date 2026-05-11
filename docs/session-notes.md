# Session Notes

## Source

This document consolidates context recovered from the exported OpenCode session
`ses_1ebdd578effe3MUR2HWb1DqtoU` and compares it with the current repository
state.

The session was read non-interactively via `opencode export`, then cross-checked
against the current codebase.

## 1. Clean Summary Of The Exported Session

### Product intent

The original planning session established OpenCherry as an open source desktop
app for orchestrating multiple Git repositories and multiple coding agents from
a single control surface.

Core product framing from that session:

- multi-repo Git control tower, inspired by VS Code Source Control
- optimized for real workflows where several CLI agents run in parallel
- desktop-first, with Ubuntu/Linux and macOS as initial targets
- Git should be the center of the product, not a secondary feature
- agent detection is part of the MVP, not a later nice-to-have

### Major planning decisions captured there

- project name finalized as `OpenCherry`
- license chosen as `AGPL-3.0`
- initial interest in a pure Rust desktop stack, especially GPUI
- Git strategy originally leaned toward `gix`, later softened toward `git2`
- agent reuse was envisioned via spawning detected CLIs instead of injecting
  into a live session
- process detection was planned around `sysinfo`
- Ubuntu/GNOME was already treated as the primary UX target

### Planning arc visible in the transcript

The session shows a real evolution, not a single fixed plan:

1. The project started from a broad research phase around Warp, Zed, desktop
   Rust UI options, and the shape of an agent-centric Git dashboard.
2. The stack briefly converged on a more ambitious native Rust direction,
   especially GPUI.
3. That direction was later challenged as too expensive and risky for the
   project stage.
4. The repository then moved toward the more pragmatic Tauri 2 + SolidJS path.

### Early product ideas that shaped the repo

- separate resource groups like VS Code SCM
- strong Git workflow focus: status, diff, stage, commit, publish, sync
- explicit multi-repo handling rather than one active repo at a time
- agent awareness in the UI rather than only terminal-side tooling
- eventual commit assistance through detected agents only

## 2. Decisions From The Export vs Current Code

### Still true in the current codebase

- `OpenCherry` remains the chosen name
- `AGPL-3.0-or-later` remains the license
- Ubuntu/GNOME-first is still the intended primary target
- multi-repo Git control tower is still the core product direction
- agent detection still uses `sysinfo`
- Git still uses `git2` as the active implementation
- the app is now clearly a desktop shell around Rust backend logic and a web UI

Relevant current code:

- `README.md`
- `apps/desktop/src-tauri/src/lib.rs`
- `crates/opencherry_repo/src/lib.rs`
- `crates/opencherry_agents/src/lib.rs`

### Changed since that planning session

#### UI stack changed materially

The exported session contains a period where GPUI was the preferred direction.
The current implementation is no longer on that path.

Current reality:

- Tauri 2 shell
- SolidJS + TypeScript frontend
- Rust backend/core crates behind Tauri commands

This is visible in:

- `README.md`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src/App.tsx`

#### `gix` is no longer the practical primary path

The session contains a strong `gix`-first direction at one point. The current
codebase is straightforwardly `git2`-backed for shipped behavior.

Current reality:

- `repo_status`, `repo_diff`, staging, commit, publish, and sync are all in
  `crates/opencherry_repo/src/lib.rs`
- remote operations use `git` CLI from Rust where that is more pragmatic

#### Persistence advanced beyond the older README expectations

The current README still says `rusqlite` is planned for Sprint 2, but the code
has already moved beyond that.

Current reality:

- `crates/opencherry_persistence/src/lib.rs` is implemented
- persistence is SQLite-backed now
- there is a legacy JSON import path from `repos.json`
- Tauri commands already use that persistence layer

So the README is stale relative to the current implementation.

#### The app is much farther along than the old planning summary implies

The exported session includes earlier bootstrap states like ping-only Tauri
shells and initial repo/agent scaffolding.

Current reality in code:

- repo registration and removal
- persisted tracked repos
- repo status snapshots
- grouped diff view
- stage/unstage by file
- commit staged / commit all
- publish branch / sync changes
- sysinfo-based agent detection
- frontend UI covering the above flows
- backend and frontend tests for the current shipped behavior

### Decisions from the export that are not yet implemented end-to-end

- agent reuse for commit-message generation or other workflows
- mapping detected agents to repos/worktrees as a first-class UX concept
- watchers/events replacing polling
- structured diff model with hunks and lines
- hunk-level staging
- richer merge/rebase-aware primary actions
- stronger code review or review-state workflows

## 3. Good Ideas From The Export That Have Not Landed Yet

These are the best ideas from the recovered session history that still look
useful for the current Tauri-based direction.

### A. Treat the primary action bar as a state machine

The export repeatedly converged on a VS Code-like idea: the primary action above
the repo view should not just be a static commit button.

Current code already partially does this:

- commit when staged exists
- publish when there is no upstream
- sync when ahead/behind exists

Natural extension still pending:

- continue merge
- continue rebase
- abort merge/rebase where appropriate
- surface detached HEAD or conflict-specific actions more explicitly

### B. Move from file patch blobs to structured diff data

This is one of the strongest architectural insights preserved in the export.

Why it still matters:

- current diff model is grouped by file with patch text
- hunk-level stage/unstage depends on a richer model
- line-level UX, inline review, and partial discard also depend on it

This remains the biggest enabling refactor for future Git UX.

### C. Preserve multi-repo as the differentiator

The session was explicit that OpenCherry should not collapse into “just another
single-repo Git client with agents nearby”.

Still useful as a product guardrail:

- repo selection and overview should remain first-class
- cross-repo health and queueing can become a stronger dashboard layer
- future features should be judged by whether they strengthen the control tower

### D. Prefer explicit workflow state over ad-hoc UI state

The export compared Warp and VS Code and pulled a good lesson out of both:

- selection state
- review state
- commit workflow state
- agent-to-repo relationship state

The current frontend is still simple and local-state driven in `App.tsx`. That
is fine for now, but this idea will matter once watchers, richer diff state,
and orchestration land.

### E. Replace polling with watchers/events

The export repeatedly pointed toward watcher-based updates as the long-term
model.

Current code still polls:

- agents every 3s in `apps/desktop/src/App.tsx`
- selected repo status/diff every 5s in `apps/desktop/src/App.tsx`

This is acceptable now, but moving to file/repo events would improve both UX
and backend efficiency.

### F. Safe abstractions for remote Git actions were the right instinct

The export anticipated that publish/sync behavior might need different handling
than local Git state operations. The current implementation already reflects
that by using `git` CLI calls for remote actions while keeping local repo logic
in `git2`.

This was a good design instinct and should likely continue for:

- auth-sensitive push/pull flows
- SSH or credential-helper reuse
- better UI-level error surfacing

### G. Agent-aware workflows should reuse real installed CLIs

The session had a clear preference against inventing a separate provider stack
for every AI flow too early.

This remains a good direction for future features such as:

- commit message generation
- diff summarization
- review suggestions
- “ask the agent that worked here” actions

It fits OpenCherry's positioning better than becoming a generic chat shell.

## 4. Immediate Takeaways For Future Work

- Keep the Tauri 2 + SolidJS architecture; it is now real and productive.
- Update `README.md` because it lags behind the implemented persistence and Git
  workflow features.
- Prioritize structured diffs and hunk-level operations if the goal is stronger
  SCM UX.
- Keep multi-repo and agent awareness as the product filter for future features.
- When orchestration features return, prefer reusing detected local CLIs over
  building a separate provider-heavy path too early.

## 5. Suggested Next Documentation Follow-up

If useful, the next cleanup should be to split this file into:

- `docs/history/origin.md` for recovered session history
- `docs/architecture/current-state.md` for the actual current system
- `docs/roadmap/next-git-ux.md` for structured diff, hunk staging, discard,
  watchers, and merge/rebase flows
