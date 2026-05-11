# Next Git UX Roadmap

## Goal

Strengthen OpenCherry's current multi-repo Git workflow without changing its
core product direction.

The next phase should deepen the existing desktop shell rather than expand into
new product surfaces too early.

## Current Baseline

OpenCherry already has:

- tracked repo persistence in SQLite
- repo status snapshots
- grouped diff by file
- stage/unstage by file
- commit staged / commit all
- publish / sync actions
- sysinfo-based agent detection
- frontend coverage for the current shipped flows

That means the next work should focus on improving Git UX quality and internal
state structure.

## Priorities

### 1. Add discard/revert by file

Why first:

- users can already stage, unstage, and commit
- the missing inverse action makes the workflow incomplete
- this is valuable immediately without requiring a full diff model rewrite

Scope:

- discard unstaged file changes safely
- remove untracked files safely where appropriate
- surface clear errors for unsupported states
- avoid destructive behavior for conflicted files unless intentionally modeled

Acceptance:

- backend exposes safe per-file discard behavior
- UI shows discard action only where it is valid
- actions refresh status and diff correctly
- tests cover modified, deleted, and untracked cases

### 2. Introduce a structured diff model

Why second:

- hunk-level operations depend on it
- richer review and partial discard depend on it
- current patch-string model is good enough for shipping but not for advanced UX

Scope:

- represent diff as files -> hunks -> lines
- keep existing grouped sections (`staged`, `unstaged`, `untracked`, `conflicted`)
- preserve current UI behavior during migration where possible
- allow temporary compatibility layers if needed inside the app boundary only

Acceptance:

- backend returns structured diff data for changed files
- frontend can render file-level summaries from structured data
- tests cover file, hunk, and line shapes for common changes

### 3. Add stage/unstage by hunk

Why third:

- this is one of the highest-value SCM upgrades after structured diffs exist
- it directly improves agent-generated change review workflows

Scope:

- stage a single hunk from unstaged changes
- unstage a single hunk from staged changes
- keep file-level actions available
- defer line-level patch editing until after hunk behavior is stable

Acceptance:

- backend supports hunk-targeted stage/unstage operations
- frontend exposes hunk actions in diff UI
- tests cover mixed files with multiple hunks

### 4. Improve primary actions for merge/rebase states

Why fourth:

- the primary action bar already behaves like a small state machine
- merge/rebase edge cases are the most obvious remaining product gap there

Scope:

- detect merge in progress
- detect rebase in progress
- detect conflict-heavy states that should suppress normal commit affordances
- surface more appropriate actions than plain commit/publish/sync when needed

Acceptance:

- backend exposes enough repo state to drive these cases cleanly
- frontend action bar reflects merge/rebase states deterministically
- tests cover at least merge-conflict and rebase-in-progress branches

### 5. Replace polling with watchers/events where practical

Why fifth:

- current polling is acceptable for the current size of the app
- once diff and workflow state become richer, polling will age poorly

Scope:

- repo status refresh triggered by file or repo events
- persistence refresh triggered by repo registration changes
- agent refresh strategy revisited carefully; polling may still remain there if
  system event coverage is weak

Acceptance:

- repo detail view updates without fixed-interval polling for normal file changes
- no obvious refresh regressions in commit/stage/unstage flows
- backend or frontend complexity stays proportional to the value gained

## Execution Order

Recommended order:

1. discard/revert by file
2. structured diff model
3. stage/unstage by hunk
4. merge/rebase-aware primary actions
5. watchers/events

This order minimizes rework:

- discard can land on the current model
- structured diff is the enabling refactor for the next two upgrades
- merge/rebase action quality depends on richer repo state, not on watchers
- watchers should come after the data model is steadier

## Recommended Implementation Strategy

### Phase A: finish the current file-level workflow

- add discard/revert by file
- improve error surfacing for publish/sync/discard failures
- keep UI changes minimal and consistent with the current visual language

### Phase B: change the data model, not the whole product shape

- introduce structured diff types in Rust first
- adapt Tauri command output
- keep frontend rendering stable while migrating incrementally

### Phase C: unlock higher-value review actions

- hunk stage/unstage
- optional hunk discard if the model stays clean
- stronger merge/rebase states in the action bar

### Phase D: reduce refresh noise

- move repo detail refresh toward watcher/event-driven updates
- keep the simplest effective architecture

## Testing Expectations

Every step above should add or extend tests across the touched surface.

Minimum testing expectations:

- backend unit tests for new repo operations
- Git workflow tests using temporary repos for real behavior
- frontend tests for visibility and interaction states
- no regression in existing persistence, diff, commit, and agent tests

## Non-Goals For This Phase

These are explicitly not the next focus:

- generic LLM chat/provider integration
- full agent orchestration control plane
- MCP-heavy feature work
- major visual redesign
- broad abstraction cleanup unrelated to shipping Git UX improvements

## Decision Rule

For any candidate feature in the next phase, ask:

"Does this make OpenCherry better as a multi-repo Git control tower?"

If the answer is weak, it should wait.
