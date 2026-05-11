import {
  createSignal,
  createResource,
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
  RepoDiff,
  RepoRef,
  RepoStatus,
} from "./types";

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

async function stageFile(path: string, relativePath: string): Promise<void> {
  await invoke("stage_repo_file", { path, relativePath });
}

async function unstageFile(path: string, relativePath: string): Promise<void> {
  await invoke("unstage_repo_file", { path, relativePath });
}

export default function App() {
  const [repos, { refetch: refetchRepos }] = createResource(fetchRepos);
  const [agents, { refetch: refetchAgents }] = createResource(fetchAgents);
  const [selected, setSelected] = createSignal<RepoRef | null>(null);
  const [error, setError] = createSignal<string | null>(null);

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
                  onClick={() => setSelected(r)}
                >
                  <span class="repo-list__name">{r.display_name}</span>
                  <button
                    class="repo-list__remove"
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
          {(repo) => <RepoView repo={repo()} />}
        </Show>

        <Show when={error()}>
          {(e) => <div class="banner banner--error">{e()}</div>}
        </Show>

        <AgentsPanel agents={agents} />
      </main>
    </div>
  );
}

function RepoView(props: { repo: RepoRef }) {
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
            </div>

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

function DiffPanel(props: {
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
          />
          <DiffGroup
            title="Untracked"
            files={props.diff()?.untracked ?? []}
            actionLabel="Stage"
            onAction={(relativePath) => stageFile(props.repoPath, relativePath).then(props.onChange)}
          />
        </>
      </Show>
    </section>
  );
}

function DiffGroup(props: {
  title: string;
  files: RepoDiff["staged"];
  tone?: "warn";
  actionLabel?: string;
  onAction?: (relativePath: string) => Promise<void>;
}) {
  return (
    <Show when={props.files.length > 0}>
      <section class="diff-group">
        <header class="diff-group__header">
          <h3>{props.title}</h3>
          <span class={`diff-group__count${props.tone ? ` diff-group__count--${props.tone}` : ""}`}>
            {props.files.length}
          </span>
        </header>

        <For each={props.files}>
          {(file) => (
            <article class="diff-file">
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

function AgentsPanel(props: { agents: Resource<DetectedAgent[]> }) {
  return (
    <section class="agents">
      <header class="agents__header">
        <h2>Detected agents</h2>
        <span class="agents__count">{(props.agents() ?? []).length}</span>
      </header>
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
