import {
  createSignal,
  createResource,
  createEffect,
  For,
  Show,
  onCleanup,
  onMount,
  type Resource,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AgentKind,
  CommitResult,
  DetectedAgent,
  DiscardOutcome,
  RepoActionResult,
  RepoDiff,
  RepoGroupSnapshot,
  RepoRef,
  RepoStatus,
} from "./types";
import { ConfirmDialog, type ConfirmRequest } from "./ConfirmDialog";
import { SettingsDialog } from "./SettingsDialog";

type GroupRepoFilter = "all" | "untracked" | "tracked" | "dirty";
type GroupAgentFilter = "all" | "with-agents" | "without-agents";

function pathContains(path: string, base: string) {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/g, "");
  const normalizedPath = normalize(path);
  const normalizedBase = normalize(base);
  if (normalizedBase.length === 0) {
    return normalizedPath.length === 0;
  }

  return normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase}/`);
}

function formatAgentKind(kind: AgentKind): string {
  if (typeof kind === "string") return kind;
  return kind.custom;
}

function agentMatchesRepoPath(agent: DetectedAgent, repoPath: string) {
  return (
    agent.targets.repos.some((repo) => repo.path === repoPath) ||
    (agent.cwd !== null && pathContains(agent.cwd, repoPath))
  );
}

async function fetchRepos(): Promise<RepoRef[]> {
  return await invoke<RepoRef[]>("list_repos");
}

async function fetchAgents(): Promise<DetectedAgent[]> {
  return await invoke<DetectedAgent[]>("list_agents");
}

async function fetchStatus(path: string): Promise<RepoStatus> {
  return await invoke<RepoStatus>("repo_status", { path });
}

async function fetchDiff(path: string): Promise<RepoDiff> {
  return await invoke<RepoDiff>("repo_diff", { path });
}

async function fetchGroupSnapshot(path: string): Promise<RepoGroupSnapshot> {
  return await invoke<RepoGroupSnapshot>("repo_group_snapshot", { path });
}

async function stageFile(path: string, relativePath: string): Promise<void> {
  await invoke("stage_repo_file", { path, relativePath });
}

async function unstageFile(path: string, relativePath: string): Promise<void> {
  await invoke("unstage_repo_file", { path, relativePath });
}

async function discardFiles(
  path: string,
  relativePaths: string[],
): Promise<DiscardOutcome> {
  return await invoke<DiscardOutcome>("discard_repo_files", {
    path,
    relativePaths,
  });
}

async function publishBranch(path: string): Promise<RepoActionResult> {
  return await invoke<RepoActionResult>("publish_repo_branch", { path });
}

async function syncChanges(path: string): Promise<RepoActionResult> {
  return await invoke<RepoActionResult>("sync_repo_changes", { path });
}

async function syncAgentRules(): Promise<number> {
  return await invoke<number>("sync_agent_rules");
}

export const __testables = {
  fetchRepos,
  fetchAgents,
  fetchStatus,
  fetchDiff,
  fetchGroupSnapshot,
  stageFile,
  unstageFile,
  discardFiles,
  publishBranch,
  syncChanges,
};

export default function App() {
  const [repos, { refetch: refetchRepos }] = createResource(fetchRepos);
  const [agents, { refetch: refetchAgents }] = createResource(fetchAgents);
  const [selected, setSelected] = createSignal<RepoRef | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [confirmRequest, setConfirmRequest] =
    createSignal<ConfirmRequest | null>(null);
  const [settingsOpen, setSettingsOpen] = createSignal<boolean>(false);
  const requestConfirm = (req: ConfirmRequest) => setConfirmRequest(req);
  const trackedRepoPaths = () =>
    new Set((repos() ?? []).filter((repo) => repo.kind === "repo").map((repo) => repo.path));
  const repoAgentCount = (repo: RepoRef) =>
    (agents() ?? []).filter((agent) => {
      if (repo.kind === "group") {
        return agent.targets.groups.some((group) => group.path === repo.path);
      }
      return agentMatchesRepoPath(agent, repo.path);
    }).length;

  // Poll agents every 3s, but pause if any agent is being edited.
  const [isEditingAny, setIsEditingAny] = createSignal(false);
  let agentsTimer: ReturnType<typeof setInterval> | undefined;
  onMount(() => {
    agentsTimer = setInterval(() => {
      if (!isEditingAny()) {
        refetchAgents();
      }
    }, 3000);
  });
  onCleanup(() => {
    if (agentsTimer) clearInterval(agentsTimer);
  });

  async function addRepo() {
    setError(null);
    try {
      const picked = await open({
        directory: true,
        multiple: false,
        title: "Select a Git repository",
      });
      if (!picked || typeof picked !== "string") return;
      await invoke<RepoRef>("register_repo", { path: picked });
      await refetchRepos();
    } catch (e) {
      setError(String(e));
    }
  }

  async function removeRepo(repo: RepoRef) {
    setError(null);
    try {
      await invoke<boolean>("unregister_repo", { id: repo.id });
      if (selected()?.id === repo.id) setSelected(null);
      await refetchRepos();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <>
    <div class="layout">
      <aside class="sidebar">
        <div class="sidebar__header">
          <h2>Repositories</h2>
          <button class="btn btn--small" onClick={addRepo} title="Add a repository">
            +
          </button>
          <button class="btn btn--small" onClick={() => setSettingsOpen(true)} title="Open settings">
            ⚙
          </button>
        </div>
        <Show
          when={(repos() ?? []).length > 0}
          fallback={<p class="empty">No repos yet. Click + to add one.</p>}
        >
          <ul class="repo-list">
            <For each={repos()}>
              {(r) => (
                <li
                  class={`repo-list__item${selected()?.id === r.id ? " is-selected" : ""}`}
                  data-repo-path={r.path}
                  onClick={() => setSelected(r)}
                >
                  <span class="repo-list__name">
                    {r.kind === "group" ? "[Group] " : ""}
                    {r.display_name}
                  </span>
                  <Show when={repoAgentCount(r) > 0}>
                    <span class="repo-list__badge">{repoAgentCount(r)}</span>
                  </Show>
                  <button
                    class="repo-list__remove"
                    data-remove-repo-path={r.path}
                    title="Remove from OpenCherry"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeRepo(r);
                    }}
                  >
                    ×
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </aside>

      <main class="main">
        <Show
          when={selected()}
          fallback={
            <div class="placeholder">
              <h1>OpenCherry</h1>
              <p>Multi-repo &times; multi-agent control tower.</p>
              <p class="placeholder__hint">
                Select a repository on the left, or add a new one with the + button.
              </p>
            </div>
          }
        >
          <Show when={selected()?.kind === "group"} fallback={<RepoView repo={selected()!} agents={agents() ?? []} requestConfirm={requestConfirm} onRename={async () => { await refetchAgents(); }} onEditStateChange={setIsEditingAny} />}>
            <RepoGroupView
              group={selected()!}
              agents={agents() ?? []}
              onRename={async () => { await refetchAgents(); }}
              onEditStateChange={setIsEditingAny}
              trackedRepoPaths={trackedRepoPaths()}
              onRegisterRepo={async (repo) => {
                setError(null);
                try {
                  const registered = await invoke<RepoRef>("register_repo", { path: repo.path });
                  await refetchRepos();
                  setSelected(registered);
                } catch (e) {
                  setError(String(e));
                }
              }}
              onRegisterRepos={async (groupRepos) => {
                setError(null);
                try {
                  let lastRegistered: RepoRef | null = null;
                  for (const repo of groupRepos) {
                    lastRegistered = await invoke<RepoRef>("register_repo", { path: repo.path });
                  }
                  await refetchRepos();
                  if (lastRegistered) setSelected(lastRegistered);
                } catch (e) {
                  setError(String(e));
                }
              }}
              onSelectRepo={(repo) => {
                const existing = (repos() ?? []).find((tracked) => tracked.path === repo.path);
                setSelected(existing ?? repo);
              }}
            />
          </Show>
        </Show>

        <Show when={error()}>
          {(e) => <div class="banner banner--error">{e()}</div>}
        </Show>

        <AgentsPanel 
          agents={agents} 
          onSync={async () => { 
            await syncAgentRules(); 
            // Give the DB a split second to settle before scanning processes
            await new Promise(r => setTimeout(r, 100));
            await refetchAgents(); 
          }} 
          onRename={async () => { await refetchAgents(); }}
          onEditStateChange={setIsEditingAny}
        />
      </main>
    </div>
    <ConfirmDialog
      request={confirmRequest()}
      onClose={() => setConfirmRequest(null)}
    />
    <SettingsDialog
      open={settingsOpen()}
      onClose={() => setSettingsOpen(false)}
    />
    </>
  );
}

function RepoGroupView(props: {
  group: RepoRef;
  agents: DetectedAgent[];
  trackedRepoPaths: Set<string>;
  onRegisterRepo: (repo: RepoRef) => Promise<void>;
  onRegisterRepos: (repos: RepoRef[]) => Promise<void>;
  onSelectRepo: (repo: RepoRef) => void;
  onRename: () => Promise<void>;
  onEditStateChange?: (editing: boolean) => void;
}) {
  const [snapshot, { refetch }] = createResource(
    () => props.group.path,
    (p) => fetchGroupSnapshot(p),
  );
  const [filter, setFilter] = createSignal<GroupRepoFilter>("untracked");
  const [agentFilter, setAgentFilter] = createSignal<GroupAgentFilter>("all");
  const isTrackedRepo = (repoPath: string) => props.trackedRepoPaths.has(repoPath);
  const isDirtyRepo = (entry: RepoGroupSnapshot["repos"][number]) =>
    entry.changes.staged + entry.changes.unstaged + entry.changes.untracked + entry.changes.conflicted > 0;
  const filteredRepos = () => {
    const repos = snapshot()?.repos ?? [];
    const repoFiltered = (() => {
      switch (filter()) {
        case "all":
          return repos;
        case "tracked":
          return repos.filter((entry) => isTrackedRepo(entry.repo.path));
        case "dirty":
          return repos.filter((entry) => isDirtyRepo(entry));
        case "untracked":
        default:
          return repos.filter((entry) => !isTrackedRepo(entry.repo.path));
      }
    })();

    switch (agentFilter()) {
      case "all":
        return repoFiltered;
      case "with-agents":
        return repoFiltered.filter((entry) => repoAgents(entry.repo.path).length > 0);
      case "without-agents":
        return repoFiltered.filter((entry) => repoAgents(entry.repo.path).length === 0);
      default:
        return repoFiltered;
    }
  };
  const trackableVisibleRepos = () => filteredRepos().filter((entry) => !isTrackedRepo(entry.repo.path));
  const trackedReposCount = () => (snapshot()?.repos ?? []).filter((entry) => isTrackedRepo(entry.repo.path)).length;
  const groupAgents = () => props.agents.filter((agent) => agent.targets.groups.some((group) => group.path === props.group.path));
  const repoAgents = (repoPath: string) => props.agents.filter((agent) => agentMatchesRepoPath(agent, repoPath));
  const [selectedRepoPaths, setSelectedRepoPaths] = createSignal<Set<string>>(new Set());
  const selectedRepos = () =>
    trackableVisibleRepos()
      .filter((entry) => selectedRepoPaths().has(entry.repo.path))
      .map((entry) => entry.repo);

  createEffect(() => {
    const visiblePaths = new Set(trackableVisibleRepos().map((entry) => entry.repo.path));
    setSelectedRepoPaths((current) => {
      const next = new Set([...current].filter((path) => visiblePaths.has(path)));
      if (next.size === current.size) return current;
      return next;
    });
  });

  function toggleRepoSelection(repoPath: string, checked: boolean) {
    setSelectedRepoPaths((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(repoPath);
      } else {
        next.delete(repoPath);
      }
      return next;
    });
  }

  const [syncingAll, setSyncingAll] = createSignal(false);
  const [syncErrors, setSyncErrors] = createSignal<string[]>([]);

  const handleSyncAll = async () => {
    setSyncingAll(true);
    setSyncErrors([]);
    try {
      const repos = snapshot()?.repos ?? [];
      const tracked = repos.filter(r => isTrackedRepo(r.repo.path)).map(r => r.repo.path);
      
      const promises = tracked.map(async path => {
        try {
          await syncChanges(path);
        } catch (e) {
          const name = path.split('/').pop() || path;
          setSyncErrors(errs => [...errs, `Failed to sync ${name}: ${String(e)}`]);
        }
      });
      await Promise.all(promises);
      
      await refetch();
    } finally {
      setSyncingAll(false);
    }
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  onMount(() => {
    timer = setInterval(() => {
      void refetch();
    }, 5000);
  });
  onCleanup(() => {
    if (timer) clearInterval(timer);
  });

  return (
    <section class="repo-view">
      <header class="repo-view__header" style={{ "flex-direction": "row", "align-items": "center", "justify-content": "space-between" }}>
        <div>
          <h1>{props.group.display_name}</h1>
          <code class="repo-view__path">{props.group.path}</code>
        </div>
        <button
          onClick={handleSyncAll}
          disabled={syncingAll()}
          class="btn--sync-all"
        >
          <span>{syncingAll() ? 'Sincronizando...' : 'Sincronizar tudo'}</span>
          <svg class={syncingAll() ? 'icon-spin' : ''} width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 16H18m0 0H22m-3 0v4" />
          </svg>
        </button>
      </header>

      <Show
        when={snapshot()}
        fallback={
          <Show when={snapshot.error} fallback={<p>Loading group…</p>}>
            <pre class="banner banner--error">{String(snapshot.error)}</pre>
          </Show>
        }
      >
        {(group) => (
          <>
            <Show when={syncErrors().length > 0}>
              <div class="banner banner--error">
                <ul style={{ margin: 0, "padding-left": "20px" }}>
                  <For each={syncErrors()}>
                    {err => <li>{err}</li>}
                  </For>
                </ul>
              </div>
            </Show>
            <div class="status-grid">
              <StatusCard label="Repos" value={String(group().repos.length)} />
              <StatusCard
                label="Dirty repos"
                value={String(group().dirty_repos)}
                tone={group().dirty_repos > 0 ? "warn" : "ok"}
              />
              <StatusCard label="Staged files" value={String(group().totals.staged)} />
              <StatusCard label="Unstaged files" value={String(group().totals.unstaged)} />
              <StatusCard label="Untracked files" value={String(group().totals.untracked)} />
              <StatusCard label="Agents" value={String(groupAgents().length)} tone={groupAgents().length > 0 ? "ok" : undefined} />
            </div>

            <TargetAgentsPanel
              title="Agents in This Group"
              agents={groupAgents()}
              empty="No detected agents mapped to this group."
              onRename={props.onRename}
              onEditStateChange={props.onEditStateChange}
            />

            <section class="diff-panel">
              <header class="diff-panel__header">
                <h2>Child repositories</h2>
                <div class="diff-panel__actions">
                  <span class="agents__count">{filteredRepos().length}</span>
                  <Show when={trackedReposCount() > 0}>
                    <span class="agents__count">{trackedReposCount()} already tracked</span>
                  </Show>
                  <div class="filter-toggle" role="tablist" aria-label="Child repository filters">
                    <For each={["all", "untracked", "tracked", "dirty"] as const}>
                      {(value) => (
                        <button
                          class={`btn btn--tiny filter-toggle__button${filter() === value ? " is-active" : ""}`}
                          role="tab"
                          aria-selected={filter() === value}
                          onClick={() => setFilter(value)}
                        >
                          {value}
                        </button>
                      )}
                    </For>
                  </div>
                  <div class="filter-toggle" role="tablist" aria-label="Child repository agent filters">
                    <For each={["all", "with-agents", "without-agents"] as const}>
                      {(value) => (
                        <button
                          class={`btn btn--tiny filter-toggle__button${agentFilter() === value ? " is-active" : ""}`}
                          role="tab"
                          aria-selected={agentFilter() === value}
                          onClick={() => setAgentFilter(value)}
                        >
                          {value}
                        </button>
                      )}
                    </For>
                  </div>
                  <Show when={selectedRepos().length > 0}>
                    <button
                      class="btn btn--tiny"
                      onClick={() => void props.onRegisterRepos(selectedRepos())}
                    >
                      Track selected ({selectedRepos().length})
                    </button>
                  </Show>
                  <Show when={trackableVisibleRepos().length > 1}>
                    <button
                      class="btn btn--tiny"
                      onClick={() => void props.onRegisterRepos(trackableVisibleRepos().map((entry) => entry.repo))}
                    >
                      Track all
                    </button>
                  </Show>
                </div>
              </header>
              <Show
                when={filteredRepos().length > 0}
                fallback={<p class="empty">No child repositories match this filter.</p>}
              >
                <div class="diff-group">
                  <For each={filteredRepos()}>
                    {(entry) => (
                      <article
                        class="diff-file"
                        data-repo-path={entry.repo.path}
                        onClick={() => props.onSelectRepo(entry.repo)}
                      >
                        <header class="diff-file__header">
                          <div class="diff-file__title">
                            <Show when={!isTrackedRepo(entry.repo.path)}>
                              <input
                                type="checkbox"
                                checked={selectedRepoPaths().has(entry.repo.path)}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => toggleRepoSelection(entry.repo.path, e.currentTarget.checked)}
                              />
                            </Show>
                            <code>{entry.repo.display_name}</code>
                            <span class="diff-file__status">{entry.status.branch ?? "(detached)"}</span>
                            <Show when={isTrackedRepo(entry.repo.path)}>
                              <span class="agents__count">Tracked</span>
                            </Show>
                          </div>
                          <div class="diff-file__actions">
                            <span>
                              S:{entry.changes.staged} U:{entry.changes.unstaged} N:{entry.changes.untracked} C:{entry.changes.conflicted}
                            </span>
                            <Show when={!isTrackedRepo(entry.repo.path)}>
                              <button
                                class="btn btn--tiny"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void props.onRegisterRepo(entry.repo);
                                }}
                              >
                                Track
                              </button>
                            </Show>
                          </div>
                        </header>
                        <code class="repo-view__path">{entry.repo.path}</code>
                        <Show when={repoAgents(entry.repo.path).length > 0}>
                          <div class="target-agents-inline">
                            <span class="agents__count">
                              {repoAgents(entry.repo.path).length} agent{repoAgents(entry.repo.path).length === 1 ? "" : "s"}
                            </span>
                            <For each={repoAgents(entry.repo.path)}>
                              {(agent) => <span class="target-agent-chip">{formatAgentKind(agent.kind)}</span>}
                            </For>
                          </div>
                        </Show>
                      </article>
                    )}
                  </For>
                </div>
              </Show>
            </section>
          </>
        )}
      </Show>
    </section>
  );
}

function RepoView(props: {
  repo: RepoRef;
  agents: DetectedAgent[];
  requestConfirm: (req: ConfirmRequest) => void;
  onRename: () => Promise<void>;
  onEditStateChange?: (editing: boolean) => void;
}) {
  const [status, { refetch }] = createResource(
    () => props.repo.path,
    (p) => fetchStatus(p),
  );
  const [diff, { refetch: refetchDiff }] = createResource(
    () => props.repo.path,
    (p) => fetchDiff(p),
  );
  const [message, setMessage] = createSignal("");
  const [commitError, setCommitError] = createSignal<string | null>(null);
  const [commitResult, setCommitResult] = createSignal<CommitResult | null>(null);
  const [actionResult, setActionResult] = createSignal<string | null>(null);
  const repoAgents = () => props.agents.filter((agent) => agentMatchesRepoPath(agent, props.repo.path));

  // Refresh status every 5s while this repo is selected.
  let timer: ReturnType<typeof setInterval> | undefined;
  onMount(() => {
    timer = setInterval(() => {
      void refetch();
      void refetchDiff();
    }, 5000);
  });
  onCleanup(() => {
    if (timer) clearInterval(timer);
  });

  async function commit() {
    setCommitError(null);
    setCommitResult(null);
    setActionResult(null);
    try {
      const result = await invoke<CommitResult>("commit_repo", {
        path: props.repo.path,
        message: message(),
      });
      setCommitResult(result);
      setMessage("");
      await refetch();
      await refetchDiff();
    } catch (e) {
      setCommitError(String(e));
    }
  }

  async function commitAll() {
    setCommitError(null);
    setCommitResult(null);
    setActionResult(null);
    try {
      const result = await invoke<CommitResult>("commit_all_repo", {
        path: props.repo.path,
        message: message(),
      });
      setCommitResult(result);
      setMessage("");
      await refetch();
      await refetchDiff();
    } catch (e) {
      setCommitError(String(e));
    }
  }

  async function runPrimaryAction(kind: PrimaryActionKind) {
    setCommitError(null);
    setCommitResult(null);
    setActionResult(null);

    try {
      if (kind === "commit") {
        await commit();
        return;
      }
      if (kind === "stage-all") {
        await commitAll();
        return;
      }

      // publish | push | pull | sync — push and pull share the sync backend for now
      const result =
        kind === "publish"
          ? await publishBranch(props.repo.path)
          : await syncChanges(props.repo.path);
      setActionResult(result.summary);
      await refetch();
      await refetchDiff();
    } catch (e) {
      setCommitError(String(e));
    }
  }

  return (
    <section class="repo-view">
      <header class="repo-view__header">
        <h1>{props.repo.display_name}</h1>
        <code class="repo-view__path">{props.repo.path}</code>
      </header>

      <Show
        when={status()}
        fallback={
          <Show when={status.error} fallback={<p>Loading status…</p>}>
            <pre class="banner banner--error">{String(status.error)}</pre>
          </Show>
        }
      >
        {(s) => (
          <>
            <RepoPrimaryActionBar
              status={s()}
              diff={diff()}
              onRun={runPrimaryAction}
              messageEmpty={message().trim().length === 0}
            />

            <div class="status-grid">
              <StatusCard label="Branch" value={s().branch ?? "(detached)"} />
              <StatusCard label="HEAD" value={s().head_short ?? "—"} mono />
              <StatusCard
                label="Working tree"
                value={s().dirty ? "dirty" : "clean"}
                tone={s().dirty ? "warn" : "ok"}
              />
              <StatusCard
                label="Upstream"
                value={s().upstream ?? "(none)"}
                mono
              />
              <StatusCard
                label="Ahead / Behind"
                value={
                  s().ahead !== null && s().behind !== null
                    ? `↑${s().ahead}  ↓${s().behind}`
                    : "—"
                }
              />
              <StatusCard label="Agents" value={String(repoAgents().length)} tone={repoAgents().length > 0 ? "ok" : undefined} />
            </div>

            <TargetAgentsPanel
              title="Agents in This Repo"
              agents={repoAgents()}
              empty="No detected agents mapped to this repository."
              onRename={props.onRename}
              onEditStateChange={props.onEditStateChange}
            />

            <section class="commit-box">
              <textarea
                class="commit-box__message"
                placeholder="Commit message"
                value={message()}
                onInput={(e) => setMessage(e.currentTarget.value)}
              />
              <div class="commit-box__actions">
                <button
                  class="btn"
                  disabled={(diff()?.staged.length ?? 0) === 0 || message().trim().length === 0}
                  onClick={() => void commit()}
                >
                  Commit staged
                </button>
                <button
                  class="btn"
                  disabled={!s().dirty || message().trim().length === 0}
                  onClick={() => void commitAll()}
                >
                  Stage all + commit
                </button>
                <Show when={commitResult()}>
                  {(r) => (
                    <span class="commit-box__result">
                      Committed {r().oid.slice(0, 7)}: {r().summary}
                    </span>
                  )}
                </Show>
                <Show when={actionResult()}>
                  {(r) => <span class="commit-box__result">{r()}</span>}
                </Show>
              </div>
              <Show when={commitError()}>
                {(e) => <div class="banner banner--error">{e()}</div>}
              </Show>
            </section>
          </>
        )}
      </Show>

      <DiffPanel
        repoPath={props.repo.path}
        diff={diff}
        onChange={async () => {
          await refetch();
          await refetchDiff();
        }}
        requestConfirm={props.requestConfirm}
      />
    </section>
  );
}

export type PrimaryActionKind =
  | "commit"
  | "stage-all"
  | "publish"
  | "push"
  | "pull"
  | "sync";

type PrimaryActionDescriptor = {
  kind: PrimaryActionKind | "idle";
  label: string;
  needsMessage: boolean;
};

export function RepoPrimaryActionBar(props: {
  status: RepoStatus;
  diff: RepoDiff | undefined;
  onRun: (kind: PrimaryActionKind) => Promise<void>;
  messageEmpty?: boolean;
}) {
  const stagedCount = () => props.diff?.staged.length ?? 0;
  const unstagedCount = () =>
    (props.diff?.unstaged.length ?? 0) + (props.diff?.untracked.length ?? 0);
  const canPublish = () => !!props.status.branch && !props.status.upstream;
  const ahead = () => props.status.ahead ?? 0;
  const behind = () => props.status.behind ?? 0;
  const hasUpstream = () => !!props.status.upstream;

  const action = (): PrimaryActionDescriptor => {
    if (stagedCount() > 0) {
      return {
        kind: "commit",
        label: `Commit staged (${stagedCount()})`,
        needsMessage: true,
      };
    }
    if (unstagedCount() > 0) {
      return { kind: "stage-all", label: "Stage all & commit", needsMessage: true };
    }
    if (canPublish()) {
      return { kind: "publish", label: "Publish branch", needsMessage: false };
    }
    if (hasUpstream() && ahead() > 0 && behind() > 0) {
      return {
        kind: "sync",
        label: `Sync changes ↓${behind()} ↑${ahead()}`,
        needsMessage: false,
      };
    }
    if (hasUpstream() && ahead() > 0) {
      return { kind: "push", label: `Push ↑${ahead()}`, needsMessage: false };
    }
    if (hasUpstream() && behind() > 0) {
      return { kind: "pull", label: `Pull ↓${behind()}`, needsMessage: false };
    }
    return { kind: "idle", label: "Up to date", needsMessage: false };
  };

  return (
    <section class="primary-action-bar">
      <button
        class="btn btn--primary"
        disabled={
          action().kind === "idle" ||
          (action().needsMessage && (props.messageEmpty ?? false))
        }
        onClick={() => {
          const a = action();
          if (a.kind === "idle") return;
          void props.onRun(a.kind);
        }}
      >
        {action().label}
      </button>
    </section>
  );
}

export function DiffPanel(props: {
  repoPath: string;
  diff: Resource<RepoDiff>;
  onChange: () => Promise<void>;
  requestConfirm: (req: ConfirmRequest) => void;
}) {
  const totalFiles = () => {
    const diff = props.diff();
    if (!diff) return 0;
    return (
      diff.staged.length +
      diff.unstaged.length +
      diff.untracked.length +
      diff.conflicted.length
    );
  };

  const onDiscard = async (
    relativePaths: string[],
  ): Promise<DiscardOutcome> => {
    const outcome = await discardFiles(props.repoPath, relativePaths);
    await props.onChange();
    return outcome;
  };

  return (
    <section class="diff-panel">
      <header class="diff-panel__header">
        <h2>Changes</h2>
        <span class="agents__count">{totalFiles()}</span>
      </header>
      <Show
        when={totalFiles() > 0}
        fallback={<p class="empty">No working tree changes.</p>}
      >
        <>
          <DiffGroup title="Conflicted" files={props.diff()?.conflicted ?? []} tone="warn" />
          <DiffGroup
            title="Staged"
            files={props.diff()?.staged ?? []}
            actionLabel="Unstage"
            onAction={(relativePath) => unstageFile(props.repoPath, relativePath).then(props.onChange)}
          />
          <DiffGroup
            title="Unstaged"
            files={props.diff()?.unstaged ?? []}
            actionLabel="Stage"
            onAction={(relativePath) => stageFile(props.repoPath, relativePath).then(props.onChange)}
            requestConfirm={props.requestConfirm}
            onDiscard={onDiscard}
          />
          <DiffGroup
            title="Untracked"
            files={props.diff()?.untracked ?? []}
            actionLabel="Stage"
            onAction={(relativePath) => stageFile(props.repoPath, relativePath).then(props.onChange)}
            requestConfirm={props.requestConfirm}
            onDiscard={onDiscard}
          />
        </>
      </Show>
    </section>
  );
}

function formatFailedOutcome(outcome: DiscardOutcome): string {
  const total = outcome.discarded.length + outcome.failed.length;
  const lines = outcome.failed
    .map(([path, message]) => `${path}: ${message}`)
    .join("\n");
  return `Failed to discard ${outcome.failed.length} of ${total} files:\n${lines}`;
}

export function DiffGroup(props: {
  title: string;
  files: RepoDiff["staged"];
  tone?: "warn";
  actionLabel?: string;
  onAction?: (relativePath: string) => Promise<void>;
  requestConfirm?: (req: ConfirmRequest) => void;
  onDiscard?: (relativePaths: string[]) => Promise<DiscardOutcome>;
}) {
  const canDiscard = () =>
    props.requestConfirm !== undefined &&
    props.onDiscard !== undefined &&
    (props.title === "Unstaged" || props.title === "Untracked");

  const requestDiscardAll = () => {
    if (!canDiscard()) return;
    const paths = props.files.map((f) => f.path);
    const groupKind = props.title.toLowerCase();
    const title =
      paths.length === 1
        ? `Discard 1 ${groupKind} file?`
        : `Discard ${paths.length} ${groupKind} files?`;
    const visible = paths.slice(0, 6);
    const overflow = paths.length - visible.length;
    props.requestConfirm!({
      title,
      body: (
        <div class="confirm-dialog__file-list">
          <For each={visible}>{(p) => <code>{p}</code>}</For>
          <Show when={overflow > 0}>
            <span>… and {overflow} more</span>
          </Show>
        </div>
      ),
      confirmLabel: "Discard all",
      confirmTone: "danger",
      onConfirm: async () => {
        const outcome = await props.onDiscard!(paths);
        if (outcome.failed.length > 0) {
          throw new Error(formatFailedOutcome(outcome));
        }
      },
    });
  };

  const requestDiscardOne = (path: string) => {
    if (!canDiscard()) return;
    props.requestConfirm!({
      title: "Discard changes?",
      body: <code class="confirm-dialog__path">{path}</code>,
      confirmLabel: "Discard changes",
      confirmTone: "danger",
      onConfirm: async () => {
        const outcome = await props.onDiscard!([path]);
        if (outcome.failed.length > 0) {
          throw new Error(formatFailedOutcome(outcome));
        }
      },
    });
  };

  return (
    <Show when={props.files.length > 0}>
      <section class="diff-group" data-diff-group={props.title.toLowerCase()}>
        <header class="diff-group__header">
          <h3>{props.title}</h3>
          <span class={`diff-group__count${props.tone ? ` diff-group__count--${props.tone}` : ""}`}>
            {props.files.length}
          </span>
          <Show when={canDiscard() && props.files.length > 0}>
            <div class="diff-group__header-actions">
              <button
                type="button"
                class="btn btn--tiny"
                onClick={requestDiscardAll}
              >
                Discard all
              </button>
            </div>
          </Show>
        </header>

        <For each={props.files}>
          {(file) => (
            <article class="diff-file" data-file-path={file.path}>
              <header class="diff-file__header">
                <div class="diff-file__title">
                  <code>{file.path}</code>
                  <span class="diff-file__status">{file.status}</span>
                </div>
                <div class="diff-file__actions">
                  <span>
                    +{file.additions} / -{file.deletions}
                  </span>
                  <Show when={props.actionLabel && props.onAction}>
                    <button
                      class="btn btn--tiny"
                      onClick={() => void props.onAction?.(file.path)}
                    >
                      {props.actionLabel}
                    </button>
                  </Show>
                  <Show when={canDiscard()}>
                    <button
                      class="btn btn--tiny"
                      onClick={() => requestDiscardOne(file.path)}
                    >
                      Discard
                    </button>
                  </Show>
                </div>
              </header>
              <Show when={file.patch}>
                <pre class="diff-file__patch">{file.patch}</pre>
              </Show>
            </article>
          )}
        </For>
      </section>
    </Show>
  );
}

function StatusCard(props: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "ok" | "warn";
}) {
  return (
    <div class={`card${props.tone ? ` card--${props.tone}` : ""}`}>
      <div class="card__label">{props.label}</div>
      <div class={`card__value${props.mono ? " card__value--mono" : ""}`}>
        {props.value}
      </div>
    </div>
  );
}

export function TargetAgentsPanel(props: { 
  title: string; 
  agents: DetectedAgent[]; 
  empty: string; 
  onRename?: (id: string, name: string) => void;
  onEditStateChange?: (editing: boolean) => void;
}) {
  return (
    <section class="agents target-agents">
      <header class="agents__header">
        <h2>{props.title}</h2>
        <span class="agents__count">{props.agents.length}</span>
      </header>
      <Show
        when={props.agents.length > 0}
        fallback={<p class="empty">{props.empty}</p>}
      >
        <ul class="agents__list">
          <For each={props.agents}>
            {(a) => <AgentRow agent={a} onRename={props.onRename} onEditStateChange={props.onEditStateChange} />}
          </For>
        </ul>
      </Show>
    </section>
  );
}

function AgentRow(props: { 
  agent: DetectedAgent; 
  onRename?: (id: string, newName: string) => void;
  onEditStateChange?: (editing: boolean) => void;
}) {
  const status = () => props.agent.status ?? "idle";
  const isSubprocess = () => Boolean(props.agent.parent_id);
  const isInactive = () => status() === "suspended" || status() === "zombie";
  
  const [isEditing, setIsEditing] = createSignal(false);
  const [tempName, setTempName] = createSignal(props.agent.display_name);

  let inputRef: HTMLInputElement | undefined;

  const toggleEditing = (editing: boolean) => {
    setIsEditing(editing);
    props.onEditStateChange?.(editing);
  };

  createEffect(() => {
    if (isEditing()) {
      inputRef?.focus();
      inputRef?.select();
    }
  });

  const handleRename = () => {
    if (tempName() !== props.agent.display_name) {
      props.onRename?.(props.agent.id, tempName());
    }
    toggleEditing(false);
  };

  return (
    <li 
      class={`agents__item${isSubprocess() ? " agents__item--subprocess" : ""}${isInactive() ? " agents__item--inactive" : ""}`}
      title={isInactive() ? `Possible zombie/suspended process (Status: ${status()})` : ""}
    >
      <div class="agents__name">
        <span
          class={`agent-status agent-status--${status()}`}
          aria-label={status()}
          title={status()}
        />
        <Show 
          when={isEditing()} 
          fallback={
            <span 
              class={isInactive() ? "text--muted" : ""} 
              onDblClick={() => toggleEditing(true)}
            >
              {props.agent.display_name}
              <span class="agents__pid"> (pid {props.agent.pid})</span>
            </span>
          }
        >
          <input
            ref={inputRef}
            type="text"
            class="agents__edit-input"
            value={tempName()}
            onInput={(e) => setTempName(e.currentTarget.value)}
            onBlur={handleRename}
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
          />
        </Show>
        
        <button 
          class="agents__edit-btn" 
          onClick={() => toggleEditing(!isEditing())}
          title="Rename agent"
        >
          ✏️
        </button>

        <Show when={isInactive()}>
          <span class="badge badge--warning" style="margin-left: 8px; font-size: 0.6rem;">
            POSSIBLY SUSPENDED
          </span>
        </Show>
      </div>
      <div class="agents__meta">
        <Show when={isSubprocess()}>
          <span
            class="agents__subprocess"
            title={`subprocess of ${props.agent.parent_id}`}
          >
            ↳ subprocess
          </span>
        </Show>
        <span class="agents__kind">{formatAgentKind(props.agent.kind)}</span>
        <Show when={props.agent.targets.repos.length > 0}>
          <span class="agents__repos">
            <For each={props.agent.targets.repos}>
              {(repo) => <span class="agents__repo">{repo.display_name}</span>}
            </For>
          </span>
        </Show>
        <Show when={props.agent.cwd}>
          {(cwd) => <code class="agents__cwd">{cwd()}</code>}
        </Show>
      </div>
    </li>
  );
}

function AgentsPanel(props: { 
  agents: Resource<DetectedAgent[]>; 
  onSync: () => Promise<void>;
  onRename: () => Promise<void>;
  onEditStateChange?: (editing: boolean) => void;
}) {
  const unmatchedAgents = () =>
    (props.agents() ?? []).filter((agent) => agent.targets.repos.length === 0 && agent.targets.groups.length === 0);

  const [syncing, setSyncing] = createSignal(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await props.onSync();
    } finally {
      setSyncing(false);
    }
  };

  const handleRename = async (id: string, name: string) => {
    try {
      const agent = (props.agents() ?? []).find(a => a.id === id);
      if (agent) {
        await invoke("update_agent_name", { id: agent.definition_id, name });
        await props.onRename();
      }
    } catch (e) {
      console.error("Failed to rename agent:", e);
    }
  };

  return (
    <section class="agents">
      <header class="agents__header">
        <div class="agents__header-title">
          <h2>Detected agents</h2>
          <span class="agents__count">{(props.agents() ?? []).length}</span>
        </div>
        <button
          class="btn btn--tiny"
          onClick={handleSync}
          disabled={syncing()}
          title="Sync agent rules from GitHub"
        >
          {syncing() ? "Syncing..." : "Sync Rules"}
        </button>
      </header>
      <Show when={unmatchedAgents().length > 0}>
        <div class="banner banner--warn">
          {unmatchedAgents().length} agent{unmatchedAgents().length === 1 ? "" : "s"} outside tracked repos/groups.
        </div>
      </Show>
      <Show
        when={(props.agents() ?? []).length > 0}
        fallback={
          <p class="empty">
            No coding agents currently running. Start Claude Code, OpenCode,
            Codex, Gemini CLI, or Aider in any terminal.
          </p>
        }
      >
        <ul class="agents__list">
          <For each={props.agents() ?? []}>
            {(a) => <AgentRow agent={a} onRename={handleRename} onEditStateChange={props.onEditStateChange} />}
          </For>
        </ul>
      </Show>
    </section>
  );
}
