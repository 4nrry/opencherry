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
  CommitResult,
  DetectedAgent,
  RepoActionResult,
  RepoDiff,
  RepoGroupSnapshot,
  RepoRef,
  RepoStatus,
} from "./types";

type GroupRepoFilter = "all" | "untracked" | "tracked" | "dirty";
type GroupAgentFilter = "all" | "with-agents" | "without-agents";

function agentMatchesRepoPath(agent: DetectedAgent, repoPath: string) {
  return (
    agent.targets.repos.some((repo) => repo.path === repoPath) ||
    (agent.cwd !== null && (agent.cwd === repoPath || agent.cwd.startsWith(`${repoPath}/`)))
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

async function discardFile(path: string, relativePath: string): Promise<void> {
  await invoke("discard_repo_file", { path, relativePath });
}

async function publishBranch(path: string): Promise<RepoActionResult> {
  return await invoke<RepoActionResult>("publish_repo_branch", { path });
}

async function syncChanges(path: string): Promise<RepoActionResult> {
  return await invoke<RepoActionResult>("sync_repo_changes", { path });
}

export const __testables = {
  fetchRepos,
  fetchAgents,
  fetchStatus,
  fetchDiff,
  fetchGroupSnapshot,
  stageFile,
  unstageFile,
  discardFile,
  publishBranch,
  syncChanges,
};

export default function App() {
  const [repos, { refetch: refetchRepos }] = createResource(fetchRepos);
  const [agents, { refetch: refetchAgents }] = createResource(fetchAgents);
  const [selected, setSelected] = createSignal<RepoRef | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const trackedRepoPaths = () =>
    new Set((repos() ?? []).filter((repo) => repo.kind === "repo").map((repo) => repo.path));
  const repoAgentCount = (repo: RepoRef) =>
    (agents() ?? []).filter((agent) => {
      if (repo.kind === "group") {
        return agent.targets.groups.some((group) => group.path === repo.path);
      }
      return agentMatchesRepoPath(agent, repo.path);
    }).length;

  // Poll agents every 3s.
  let agentsTimer: ReturnType<typeof setInterval> | undefined;
  onMount(() => {
    agentsTimer = setInterval(() => refetchAgents(), 3000);
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
    <div class="layout">
      <aside class="sidebar">
        <div class="sidebar__header">
          <h2>Repositories</h2>
          <button class="btn btn--small" onClick={addRepo} title="Add a repository">
            +
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
          <Show when={selected()?.kind === "group"} fallback={<RepoView repo={selected()!} agents={agents() ?? []} />}>
            <RepoGroupView
              group={selected()!}
              agents={agents() ?? []}
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

        <AgentsPanel agents={agents} />
      </main>
    </div>
  );
}

function RepoGroupView(props: {
  group: RepoRef;
  agents: DetectedAgent[];
  trackedRepoPaths: Set<string>;
  onRegisterRepo: (repo: RepoRef) => Promise<void>;
  onRegisterRepos: (repos: RepoRef[]) => Promise<void>;
  onSelectRepo: (repo: RepoRef) => void;
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
      <header class="repo-view__header">
        <h1>{props.group.display_name}</h1>
        <code class="repo-view__path">{props.group.path}</code>
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
                              {(agent) => <span class="target-agent-chip">{agent.kind}</span>}
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

function RepoView(props: { repo: RepoRef; agents: DetectedAgent[] }) {
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

  async function runPrimaryAction(kind: "commit" | "publish" | "sync") {
    setCommitError(null);
    setCommitResult(null);
    setActionResult(null);

    try {
      if (kind === "commit") {
        await commit();
        return;
      }

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
      />
    </section>
  );
}

export function RepoPrimaryActionBar(props: {
  status: RepoStatus;
  diff: RepoDiff | undefined;
  onRun: (kind: "commit" | "publish" | "sync") => Promise<void>;
}) {
  const stagedCount = () => props.diff?.staged.length ?? 0;
  const hasDirty = () =>
    (props.diff?.staged.length ?? 0) +
      (props.diff?.unstaged.length ?? 0) +
      (props.diff?.untracked.length ?? 0) +
      (props.diff?.conflicted.length ?? 0) >
    0;
  const canPublish = () => !!props.status.branch && !props.status.upstream;
  const canSync = () =>
    !!props.status.upstream &&
    ((props.status.ahead ?? 0) > 0 || (props.status.behind ?? 0) > 0);

  const action = () => {
    if (stagedCount() > 0) return { kind: "commit" as const, label: `Commit staged (${stagedCount()})` };
    if (canPublish()) return { kind: "publish" as const, label: "Publish branch" };
    if (canSync()) {
      const ahead = props.status.ahead ?? 0;
      const behind = props.status.behind ?? 0;
      return { kind: "sync" as const, label: `Sync changes${behind ? ` ↓${behind}` : ""}${ahead ? ` ↑${ahead}` : ""}` };
    }
    return null;
  };

  return (
    <Show when={action()}>
      {(current) => (
        <section class="primary-action-bar">
          <button
            class="btn btn--primary"
            disabled={current().kind === "commit" ? stagedCount() === 0 : !hasDirty() && current().kind !== "sync"}
            onClick={() => void props.onRun(current().kind)}
          >
            {current().label}
          </button>
        </section>
      )}
    </Show>
  );
}

export function DiffPanel(props: {
  repoPath: string;
  diff: Resource<RepoDiff>;
  onChange: () => Promise<void>;
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
            secondaryActionLabel="Discard"
            onSecondaryAction={(relativePath) => discardFile(props.repoPath, relativePath).then(props.onChange)}
          />
          <DiffGroup
            title="Untracked"
            files={props.diff()?.untracked ?? []}
            actionLabel="Stage"
            onAction={(relativePath) => stageFile(props.repoPath, relativePath).then(props.onChange)}
            secondaryActionLabel="Discard"
            onSecondaryAction={(relativePath) => discardFile(props.repoPath, relativePath).then(props.onChange)}
          />
        </>
      </Show>
    </section>
  );
}

export function DiffGroup(props: {
  title: string;
  files: RepoDiff["staged"];
  tone?: "warn";
  actionLabel?: string;
  onAction?: (relativePath: string) => Promise<void>;
  secondaryActionLabel?: string;
  onSecondaryAction?: (relativePath: string) => Promise<void>;
}) {
  return (
    <Show when={props.files.length > 0}>
      <section class="diff-group" data-diff-group={props.title.toLowerCase()}>
        <header class="diff-group__header">
          <h3>{props.title}</h3>
          <span class={`diff-group__count${props.tone ? ` diff-group__count--${props.tone}` : ""}`}>
            {props.files.length}
          </span>
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
                  <Show when={props.secondaryActionLabel && props.onSecondaryAction}>
                    <button
                      class="btn btn--tiny"
                      onClick={() => void props.onSecondaryAction?.(file.path)}
                    >
                      {props.secondaryActionLabel}
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

function TargetAgentsPanel(props: { title: string; agents: DetectedAgent[]; empty: string }) {
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
            {(a) => (
              <li class="agents__item">
                <div class="agents__name">{a.display_name}</div>
                <div class="agents__meta">
                  <span class="agents__kind">{a.kind}</span>
                  <Show when={a.cwd}>
                    {(cwd) => <code class="agents__cwd">{cwd()}</code>}
                  </Show>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

function AgentsPanel(props: { agents: Resource<DetectedAgent[]> }) {
  const unmatchedAgents = () =>
    (props.agents() ?? []).filter((agent) => agent.targets.repos.length === 0 && agent.targets.groups.length === 0);

  return (
    <section class="agents">
      <header class="agents__header">
        <h2>Detected agents</h2>
        <span class="agents__count">{(props.agents() ?? []).length}</span>
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
          <For each={props.agents()}>
            {(a) => (
              <li class="agents__item">
                <div class="agents__name">{a.display_name}</div>
                <div class="agents__meta">
                  <span class="agents__kind">{a.kind}</span>
                  <Show when={a.cwd}>
                    {(cwd) => <code class="agents__cwd">{cwd()}</code>}
                  </Show>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
