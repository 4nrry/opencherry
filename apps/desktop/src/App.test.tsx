import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal, type Resource } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App, { DiffGroup, DiffPanel, RepoPrimaryActionBar, TargetAgentsPanel } from "./App";
import { ThemeProvider } from "./theme/context";
import type { CommitResult, DetectedAgent, RepoDiff, RepoGroupSnapshot, RepoRef, RepoStatus } from "./types";

const invokeMock = vi.fn();
const openMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openMock(...args),
}));

function makeRepoStatus(overrides: Partial<RepoStatus> = {}): RepoStatus {
  return {
    id: "repo-1",
    branch: "main",
    head_short: "abcdef0",
    dirty: false,
    ahead: 0,
    behind: 0,
    upstream: "origin/main",
    ...overrides,
  };
}

function makeRepoDiff(overrides: Partial<RepoDiff> = {}): RepoDiff {
  return {
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
    ...overrides,
  };
}

function resourceOf<T>(value: T): Resource<T> {
  const [data] = createSignal(value);
  return data as Resource<T>;
}

function renderApp() {
  return render(() => <ThemeProvider><App /></ThemeProvider>);
}

describe("RepoPrimaryActionBar", () => {
  it("renders commit, publish and sync actions from current state", async () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    const commitView = render(() => (
      <RepoPrimaryActionBar
        status={makeRepoStatus({ upstream: "origin/main" })}
        diff={makeRepoDiff({ staged: [{ path: "a.ts", status: "modified", additions: 1, deletions: 0, patch: "+a" }] })}
        onRun={onRun}
      />
    ));

    expect(screen.getByRole("button", { name: "Commit staged (1)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Commit staged (1)" }));
    await waitFor(() => expect(onRun).toHaveBeenCalledWith("commit"));
    commitView.unmount();

    render(() => (
      <RepoPrimaryActionBar
        status={makeRepoStatus({ branch: "feature", upstream: null })}
        diff={makeRepoDiff()}
        onRun={onRun}
      />
    ));
    expect(screen.getByRole("button", { name: "Publish branch" })).toBeInTheDocument();

    document.body.innerHTML = "";

    render(() => (
      <RepoPrimaryActionBar
        status={makeRepoStatus({ ahead: 2, behind: 1, upstream: "origin/main" })}
        diff={makeRepoDiff()}
        onRun={onRun}
      />
    ));
    expect(screen.getByRole("button", { name: "Sync changes ↓1 ↑2" })).toBeInTheDocument();
  });

  it("renders Push when ahead-only", async () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    render(() => (
      <RepoPrimaryActionBar
        status={makeRepoStatus({ ahead: 3, behind: 0, upstream: "origin/main" })}
        diff={makeRepoDiff()}
        onRun={onRun}
      />
    ));
    const btn = screen.getByRole("button", { name: "Push ↑3" });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    await waitFor(() => expect(onRun).toHaveBeenCalledWith("push"));
  });

  it("renders Pull when behind-only", async () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    render(() => (
      <RepoPrimaryActionBar
        status={makeRepoStatus({ ahead: 0, behind: 2, upstream: "origin/main" })}
        diff={makeRepoDiff()}
        onRun={onRun}
      />
    ));
    const btn = screen.getByRole("button", { name: "Pull ↓2" });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    await waitFor(() => expect(onRun).toHaveBeenCalledWith("pull"));
  });

  it("renders Up to date disabled when clean and synced", () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    render(() => (
      <RepoPrimaryActionBar
        status={makeRepoStatus({ ahead: 0, behind: 0, upstream: "origin/main" })}
        diff={makeRepoDiff()}
        onRun={onRun}
      />
    ));
    const btn = screen.getByRole("button", { name: "Up to date" });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it("renders Stage all & commit when only unstaged changes exist", async () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    render(() => (
      <RepoPrimaryActionBar
        status={makeRepoStatus({ ahead: 0, behind: 0, upstream: "origin/main" })}
        diff={makeRepoDiff({
          unstaged: [{ path: "a.ts", status: "modified", additions: 1, deletions: 0, patch: "+a" }],
        })}
        onRun={onRun}
      />
    ));
    const btn = screen.getByRole("button", { name: "Stage all & commit" });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    await waitFor(() => expect(onRun).toHaveBeenCalledWith("stage-all"));
  });

  it("disables commit and stage-all when messageEmpty is true", () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    const commitView = render(() => (
      <RepoPrimaryActionBar
        status={makeRepoStatus({ upstream: "origin/main" })}
        diff={makeRepoDiff({
          staged: [{ path: "a.ts", status: "modified", additions: 1, deletions: 0, patch: "+a" }],
        })}
        onRun={onRun}
        messageEmpty
      />
    ));
    expect(screen.getByRole("button", { name: "Commit staged (1)" })).toBeDisabled();
    commitView.unmount();

    render(() => (
      <RepoPrimaryActionBar
        status={makeRepoStatus({ upstream: "origin/main" })}
        diff={makeRepoDiff({
          unstaged: [{ path: "a.ts", status: "modified", additions: 1, deletions: 0, patch: "+a" }],
        })}
        onRun={onRun}
        messageEmpty
      />
    ));
    expect(screen.getByRole("button", { name: "Stage all & commit" })).toBeDisabled();
  });
});

describe("TargetAgentsPanel", () => {
  function makeAgent(overrides: Partial<DetectedAgent> = {}): DetectedAgent {
    return {
      id: "agent-1",
      kind: "open-code",
      display_name: "OpenCode (pid 42)",
      pid: 42,
      cwd: "/repos/opencherry",
      command_line: "opencode",
      targets: { repos: [], groups: [] },
      status: "idle",
      ...overrides,
    };
  }

  it("renders an idle status dot when the agent is idle", () => {
    const view = render(() => (
      <TargetAgentsPanel
        title="Agents"
        agents={[makeAgent({ status: "idle" })]}
        empty="No agents"
      />
    ));
    const dot = view.container.querySelector(".agent-status--idle");
    expect(dot).not.toBeNull();
  });

  it("renders a generating status dot when the agent is generating", () => {
    const view = render(() => (
      <TargetAgentsPanel
        title="Agents"
        agents={[makeAgent({ status: "generating" })]}
        empty="No agents"
      />
    ));
    const dot = view.container.querySelector(".agent-status--generating");
    expect(dot).not.toBeNull();
  });

  it("renders the correlated repo display name as a pill", () => {
    const repo: RepoRef = {
      id: "r1",
      path: "/repos/x",
      display_name: "myrepo",
      kind: "repo",
    };
    const view = render(() => (
      <TargetAgentsPanel
        title="Agents"
        agents={[makeAgent({ targets: { repos: [repo], groups: [] } })]}
        empty="No agents"
      />
    ));
    expect(view.getByText("myrepo")).toBeInTheDocument();
  });

  it("does not render a repo pill when the agent has no correlation", () => {
    const view = render(() => (
      <TargetAgentsPanel
        title="Agents"
        agents={[makeAgent({ targets: { repos: [], groups: [] } })]}
        empty="No agents"
      />
    ));
    expect(view.container.querySelector(".agents__repos")).toBeNull();
  });

  it("renders a subprocess indicator when parent_id is set", () => {
    const view = render(() => (
      <TargetAgentsPanel
        title="Agents"
        agents={[
          makeAgent({ id: "pid-100", pid: 100 }),
          makeAgent({
            id: "pid-200",
            pid: 200,
            display_name: "Claude (chrome-native-host)",
            parent_id: "pid-100",
          }),
        ]}
        empty="No agents"
      />
    ));
    expect(view.container.querySelector(".agents__subprocess")).not.toBeNull();
  });

  it("does not render a subprocess indicator for primary agents", () => {
    const view = render(() => (
      <TargetAgentsPanel
        title="Agents"
        agents={[makeAgent({ parent_id: null })]}
        empty="No agents"
      />
    ));
    expect(view.container.querySelector(".agents__subprocess")).toBeNull();
  });
});

describe("DiffGroup", () => {
  it("renders grouped files and calls the configured action buttons", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const onDiscard = vi
      .fn()
      .mockResolvedValue({ discarded: ["src/App.tsx"], failed: [] });
    const requestConfirm = vi.fn();
    render(() => (
      <DiffGroup
        title="Unstaged"
        files={[
          {
            path: "src/App.tsx",
            status: "modified",
            additions: 3,
            deletions: 1,
            patch: "@@\n+new\n-old",
          },
        ]}
        actionLabel="Stage"
        onAction={onAction}
        requestConfirm={requestConfirm}
        onDiscard={onDiscard}
      />
    ));

    expect(screen.getByText("Unstaged")).toBeInTheDocument();
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
    expect(screen.getByText("modified")).toBeInTheDocument();
    expect(screen.getByText("+3 / -1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stage" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith("src/App.tsx"));

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(requestConfirm).toHaveBeenCalledTimes(1);
    const perFileRequest = requestConfirm.mock.calls[0][0];
    expect(perFileRequest.title).toBe("Discard changes?");
    expect(perFileRequest.confirmLabel).toBe("Discard changes");

    fireEvent.click(screen.getByRole("button", { name: "Discard all" }));
    expect(requestConfirm).toHaveBeenCalledTimes(2);
    const allRequest = requestConfirm.mock.calls[1][0];
    expect(allRequest.title).toBe("Discard 1 unstaged file?");
    expect(allRequest.confirmLabel).toBe("Discard all");

    // Confirm callbacks invoke onDiscard with the right paths
    await perFileRequest.onConfirm();
    expect(onDiscard).toHaveBeenCalledWith(["src/App.tsx"]);
  });
});

describe("DiffPanel", () => {
  it("renders all existing groups and invokes stage, unstage, and discard commands", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "discard_repo_files") {
        return Promise.resolve({ discarded: [], failed: [] });
      }
      return Promise.resolve(undefined);
    });
    const onChange = vi.fn().mockResolvedValue(undefined);
    const requestConfirm = vi.fn();
    render(() => (
      <DiffPanel
        repoPath="/repo"
        diff={resourceOf(
          makeRepoDiff({
            conflicted: [{ path: "conflict.txt", status: "conflicted", additions: 0, deletions: 0, patch: "" }],
            staged: [{ path: "staged.txt", status: "modified", additions: 1, deletions: 0, patch: "+a" }],
            unstaged: [{ path: "unstaged.txt", status: "modified", additions: 1, deletions: 1, patch: "+a\n-b" }],
            untracked: [{ path: "untracked.txt", status: "untracked", additions: 1, deletions: 0, patch: "+a" }],
          }),
        )}
        onChange={onChange}
        requestConfirm={requestConfirm}
      />
    ));

    expect(screen.getByText("Conflicted")).toBeInTheDocument();
    expect(screen.getByText("Staged")).toBeInTheDocument();
    expect(screen.getByText("Unstaged")).toBeInTheDocument();
    expect(screen.getByText("Untracked")).toBeInTheDocument();

    const unstageButton = screen.getByRole("button", { name: "Unstage" });
    fireEvent.click(unstageButton);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("unstage_repo_file", {
        path: "/repo",
        relativePath: "staged.txt",
      }),
    );

    const stageButtons = screen.getAllByRole("button", { name: "Stage" });
    fireEvent.click(stageButtons[0]);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("stage_repo_file", {
        path: "/repo",
        relativePath: "unstaged.txt",
      }),
    );

    // Per-file Discard now goes through requestConfirm
    const discardButtons = screen.getAllByRole("button", { name: "Discard" });
    fireEvent.click(discardButtons[0]);
    expect(requestConfirm).toHaveBeenCalledTimes(1);
    const req = requestConfirm.mock.calls[0][0];
    expect(req.title).toBe("Discard changes?");
    await req.onConfirm();
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("discard_repo_files", {
        path: "/repo",
        relativePaths: ["unstaged.txt"],
      }),
    );
  });

  it("Discard all in Unstaged invokes batch with every path", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "discard_repo_files") {
        return Promise.resolve({
          discarded: ["a.txt", "b.txt", "c.txt"],
          failed: [],
        });
      }
      return Promise.resolve(undefined);
    });
    const onChange = vi.fn().mockResolvedValue(undefined);
    const requestConfirm = vi.fn();
    render(() => (
      <DiffPanel
        repoPath="/repo"
        diff={resourceOf(
          makeRepoDiff({
            unstaged: [
              { path: "a.txt", status: "modified", additions: 1, deletions: 0, patch: "+a" },
              { path: "b.txt", status: "modified", additions: 1, deletions: 0, patch: "+b" },
              { path: "c.txt", status: "modified", additions: 1, deletions: 0, patch: "+c" },
            ],
          }),
        )}
        onChange={onChange}
        requestConfirm={requestConfirm}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "Discard all" }));
    expect(requestConfirm).toHaveBeenCalledTimes(1);
    const req = requestConfirm.mock.calls[0][0];
    expect(req.title).toBe("Discard 3 unstaged files?");
    expect(req.confirmLabel).toBe("Discard all");

    await req.onConfirm();
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("discard_repo_files", {
        path: "/repo",
        relativePaths: ["a.txt", "b.txt", "c.txt"],
      }),
    );
  });

  it("onDiscard surfaces partial-failure outcomes that DiffGroup converts into a thrown error", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "discard_repo_files") {
        return Promise.resolve({
          discarded: [],
          failed: [["ghost.txt", "no such file"]],
        });
      }
      return Promise.resolve(undefined);
    });
    const onChange = vi.fn().mockResolvedValue(undefined);
    const requestConfirm = vi.fn();
    render(() => (
      <DiffPanel
        repoPath="/repo"
        diff={resourceOf(
          makeRepoDiff({
            unstaged: [
              { path: "ghost.txt", status: "modified", additions: 0, deletions: 0, patch: "" },
            ],
          }),
        )}
        onChange={onChange}
        requestConfirm={requestConfirm}
      />
    ));

    fireEvent.click(screen.getAllByRole("button", { name: "Discard" })[0]);
    const req = requestConfirm.mock.calls[0][0];
    await expect(req.onConfirm()).rejects.toThrow(/ghost\.txt/);
    await expect(req.onConfirm()).rejects.toThrow(/no such file/);
  });
});

describe("App", () => {
  const repos: RepoRef[] = [
    {
      id: "repo-1",
      path: "/repos/opencherry",
      display_name: "opencherry",
      kind: "repo",
    },
    {
      id: "group-1",
      path: "/repos/acme",
      display_name: "acme",
      kind: "group",
    },
  ];
  const agents: DetectedAgent[] = [];
  const status = makeRepoStatus({ dirty: true, upstream: "origin/main" });
  const diff = makeRepoDiff({
    staged: [{ path: "src/lib.rs", status: "modified", additions: 2, deletions: 0, patch: "+a" }],
  });
  const groupSnapshot: RepoGroupSnapshot = {
    root: repos[1],
    repos: [
      {
        repo: repos[0],
        status,
        changes: {
          staged: 1,
          unstaged: 0,
          untracked: 0,
          conflicted: 0,
        },
      },
    ],
    totals: {
      staged: 1,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
    },
    dirty_repos: 1,
  };
  const commitResult: CommitResult = { oid: "abcdef0123456789", summary: "ship it" };

  beforeEach(() => {
    invokeMock.mockReset();
    openMock.mockReset();
    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case "list_repos":
          return Promise.resolve(repos);
        case "list_agents":
          return Promise.resolve(agents);
        case "repo_status":
          return Promise.resolve(status);
        case "repo_diff":
          return Promise.resolve(diff);
        case "repo_group_snapshot":
          return Promise.resolve(groupSnapshot);
        case "commit_repo":
          return Promise.resolve(commitResult);
        case "commit_all_repo":
          return Promise.resolve(commitResult);
        case "publish_repo_branch":
          return Promise.resolve({ summary: "Published main to origin" });
        case "sync_repo_changes":
          return Promise.resolve({ summary: "Synced main with origin" });
        case "stage_repo_file":
        case "unstage_repo_file":
        case "discard_repo_files":
        case "unregister_repo":
        case "register_repo":
          return Promise.resolve(undefined);
        case "get_preferences":
          return Promise.resolve({
            themeId: "cherry-dark",
            colorScheme: "system",
            uiFont: { family: "sans-serif", sizePx: 14 },
            monoFont: { family: "monospace", sizePx: 13 },
          });
        case "list_custom_themes":
          return Promise.resolve([]);
        case "set_preferences":
          return Promise.resolve(undefined);
        default:
          throw new Error(`unexpected invoke ${command}`);
      }
    });
  });

  it("loads the repo view and handles commit UI states", async () => {
    renderApp();

    await screen.findByText("opencherry");
    fireEvent.click(screen.getByText("opencherry"));

    await screen.findByRole("button", { name: "Commit staged (1)" });
    const commitButton = screen.getByRole("button", { name: "Commit staged" });
    const commitAllButton = screen.getByRole("button", { name: "Stage all + commit" });
    expect(commitButton).toBeDisabled();
    expect(commitAllButton).toBeDisabled();

    fireEvent.input(screen.getByPlaceholderText("Commit message"), {
      currentTarget: { value: "ship it" },
      target: { value: "ship it" },
    });

    await waitFor(() => expect(commitButton).not.toBeDisabled());
    expect(commitAllButton).not.toBeDisabled();

    fireEvent.click(commitButton);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("commit_repo", {
        path: "/repos/opencherry",
        message: "ship it",
      }),
    );
    expect(await screen.findByText("Committed abcdef0: ship it")).toBeInTheDocument();
  });

  it("shows correlated agents for the selected repo", async () => {
    const repoAgents: DetectedAgent[] = [
      {
        id: "agent-1",
        kind: "open-code",
        display_name: "OpenCode (pid 42)",
        pid: 42,
        cwd: "/repos/opencherry",
        command_line: "opencode",
        targets: {
          repos: [repos[0]],
          groups: [],
        },
      },
    ];

    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case "list_repos":
          return Promise.resolve(repos);
        case "list_agents":
          return Promise.resolve(repoAgents);
        case "repo_status":
          return Promise.resolve(status);
        case "repo_diff":
          return Promise.resolve(diff);
        case "repo_group_snapshot":
          return Promise.resolve(groupSnapshot);
        case "commit_repo":
        case "commit_all_repo":
          return Promise.resolve(commitResult);
        case "publish_repo_branch":
          return Promise.resolve({ summary: "Published main to origin" });
        case "sync_repo_changes":
          return Promise.resolve({ summary: "Synced main with origin" });
        case "stage_repo_file":
        case "unstage_repo_file":
        case "discard_repo_files":
        case "unregister_repo":
        case "register_repo":
          return Promise.resolve(undefined);
        case "get_preferences":
          return Promise.resolve({
            themeId: "cherry-dark",
            colorScheme: "system",
            uiFont: { family: "sans-serif", sizePx: 14 },
            monoFont: { family: "monospace", sizePx: 13 },
          });
        case "list_custom_themes":
          return Promise.resolve([]);
        case "set_preferences":
          return Promise.resolve(undefined);
        default:
          throw new Error(`unexpected invoke ${command}`);
      }
    });

    renderApp();
    await screen.findByText("opencherry", { selector: ".repo-list__name" });
    fireEvent.click(screen.getByText("opencherry", { selector: ".repo-list__name" }));

    const repoAgentsHeading = await screen.findByText("Agents in This Repo");
    const repoAgentsPanel = repoAgentsHeading.closest("section");
    expect(repoAgentsPanel).not.toBeNull();
    expect(repoAgentsPanel).toHaveTextContent("OpenCode (pid 42)");
    expect(repoAgentsPanel).toHaveTextContent("open-code");
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("shows agent badges in the sidebar and warns on unmatched agents", async () => {
    const mixedAgents: DetectedAgent[] = [
      {
        id: "agent-1",
        kind: "open-code",
        display_name: "OpenCode (pid 42)",
        pid: 42,
        cwd: "/repos/opencherry",
        command_line: "opencode",
        targets: {
          repos: [repos[0]],
          groups: [],
        },
      },
      {
        id: "agent-2",
        kind: "gemini-cli",
        display_name: "Gemini CLI (pid 77)",
        pid: 77,
        cwd: "/tmp/random",
        command_line: "gemini --acp",
        targets: {
          repos: [],
          groups: [],
        },
      },
    ];

    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case "list_repos":
          return Promise.resolve(repos);
        case "list_agents":
          return Promise.resolve(mixedAgents);
        case "repo_status":
          return Promise.resolve(status);
        case "repo_diff":
          return Promise.resolve(diff);
        case "repo_group_snapshot":
          return Promise.resolve(groupSnapshot);
        case "commit_repo":
        case "commit_all_repo":
          return Promise.resolve(commitResult);
        case "publish_repo_branch":
          return Promise.resolve({ summary: "Published main to origin" });
        case "sync_repo_changes":
          return Promise.resolve({ summary: "Synced main with origin" });
        case "stage_repo_file":
        case "unstage_repo_file":
        case "discard_repo_files":
        case "unregister_repo":
        case "register_repo":
          return Promise.resolve(undefined);
        case "get_preferences":
          return Promise.resolve({
            themeId: "cherry-dark",
            colorScheme: "system",
            uiFont: { family: "sans-serif", sizePx: 14 },
            monoFont: { family: "monospace", sizePx: 13 },
          });
        case "list_custom_themes":
          return Promise.resolve([]);
        case "set_preferences":
          return Promise.resolve(undefined);
        default:
          throw new Error(`unexpected invoke ${command}`);
      }
    });

    renderApp();

    expect(await screen.findByText("1 agent outside tracked repos/groups.")).toBeInTheDocument();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("renders a group view with aggregated child repo data", async () => {
    renderApp();

    await screen.findByText("[Group] acme");
    fireEvent.click(screen.getByText("[Group] acme"));

    expect(await screen.findByText("Child repositories")).toBeInTheDocument();
    expect(screen.getByText("Dirty repos")).toBeInTheDocument();
    expect(screen.getByText("Repos")).toBeInTheDocument();
    expect(screen.getByText("Staged files")).toBeInTheDocument();
    expect(screen.getByText("1 already tracked")).toBeInTheDocument();
    expect(screen.getByText("No child repositories match this filter.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Track" })).not.toBeInTheDocument();
  });

  it("filters child repositories by all, untracked, tracked, and dirty", async () => {
    const frontendRepo: RepoRef = {
      id: "repo-2",
      path: "/repos/acme/frontend",
      display_name: "frontend",
      kind: "repo",
    };
    const backendRepo: RepoRef = {
      id: "repo-3",
      path: "/repos/acme/backend",
      display_name: "backend",
      kind: "repo",
    };
    const cleanStatus = makeRepoStatus({ dirty: false });
    const mixedChildren: RepoGroupSnapshot = {
      ...groupSnapshot,
      repos: [
        ...groupSnapshot.repos,
        {
          repo: frontendRepo,
          status,
          changes: {
            staged: 0,
            unstaged: 1,
            untracked: 0,
            conflicted: 0,
          },
        },
        {
          repo: backendRepo,
          status: cleanStatus,
          changes: {
            staged: 0,
            unstaged: 0,
            untracked: 0,
            conflicted: 0,
          },
        },
      ],
      dirty_repos: 2,
    };

    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case "list_repos":
          return Promise.resolve(repos);
        case "list_agents":
          return Promise.resolve(agents);
        case "repo_status":
          return Promise.resolve(status);
        case "repo_diff":
          return Promise.resolve(diff);
        case "repo_group_snapshot":
          return Promise.resolve(mixedChildren);
        case "commit_repo":
        case "commit_all_repo":
          return Promise.resolve(commitResult);
        case "publish_repo_branch":
          return Promise.resolve({ summary: "Published main to origin" });
        case "sync_repo_changes":
          return Promise.resolve({ summary: "Synced main with origin" });
        case "stage_repo_file":
        case "unstage_repo_file":
        case "discard_repo_files":
        case "unregister_repo":
        case "register_repo":
          return Promise.resolve(undefined);
        case "get_preferences":
          return Promise.resolve({
            themeId: "cherry-dark",
            colorScheme: "system",
            uiFont: { family: "sans-serif", sizePx: 14 },
            monoFont: { family: "monospace", sizePx: 13 },
          });
        case "list_custom_themes":
          return Promise.resolve([]);
        case "set_preferences":
          return Promise.resolve(undefined);
        default:
          throw new Error(`unexpected invoke ${command}`);
      }
    });

    renderApp();
    await screen.findByText("[Group] acme");
    fireEvent.click(screen.getByText("[Group] acme"));
    const repoFilterTabs = await screen.findByRole("tablist", { name: "Child repository filters" });
    const repoFilters = within(repoFilterTabs);

    expect(await screen.findByText("frontend", { selector: "code" })).toBeInTheDocument();
    expect(screen.getByText("backend", { selector: "code" })).toBeInTheDocument();
    expect(screen.queryByText("opencherry", { selector: "code" })).not.toBeInTheDocument();

    fireEvent.click(repoFilters.getByRole("tab", { name: "all" }));
    expect(await screen.findByText("opencherry", { selector: "code" })).toBeInTheDocument();
    expect(screen.getByText("frontend", { selector: "code" })).toBeInTheDocument();
    expect(screen.getByText("backend", { selector: "code" })).toBeInTheDocument();
    expect(screen.getAllByText("Tracked")).toHaveLength(1);

    fireEvent.click(repoFilters.getByRole("tab", { name: "tracked" }));
    expect(await screen.findByText("opencherry", { selector: "code" })).toBeInTheDocument();
    expect(screen.queryByText("frontend", { selector: "code" })).not.toBeInTheDocument();
    expect(screen.queryByText("backend", { selector: "code" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Track" })).not.toBeInTheDocument();

    fireEvent.click(repoFilters.getByRole("tab", { name: "dirty" }));
    expect(await screen.findByText("opencherry", { selector: "code" })).toBeInTheDocument();
    expect(screen.getByText("frontend", { selector: "code" })).toBeInTheDocument();
    expect(screen.queryByText("backend", { selector: "code" })).not.toBeInTheDocument();

    fireEvent.click(repoFilters.getByRole("tab", { name: "untracked" }));
    expect(await screen.findByText("frontend", { selector: "code" })).toBeInTheDocument();
    expect(screen.getByText("backend", { selector: "code" })).toBeInTheDocument();
    expect(screen.queryByText("opencherry", { selector: "code" })).not.toBeInTheDocument();
  });

  it("shows correlated agents for the selected group and child repos", async () => {
    const frontendRepo: RepoRef = {
      id: "repo-2",
      path: "/repos/acme/frontend",
      display_name: "frontend",
      kind: "repo",
    };
    const groupAgents: DetectedAgent[] = [
      {
        id: "agent-1",
        kind: "open-code",
        display_name: "OpenCode (pid 42)",
        pid: 42,
        cwd: "/repos/acme/frontend",
        command_line: "opencode",
        targets: {
          repos: [frontendRepo],
          groups: [repos[1]],
        },
      },
    ];
    const extraChild: RepoGroupSnapshot = {
      ...groupSnapshot,
      repos: [
        ...groupSnapshot.repos,
        {
          repo: frontendRepo,
          status,
          changes: {
            staged: 0,
            unstaged: 1,
            untracked: 0,
            conflicted: 0,
          },
        },
      ],
    };

    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case "list_repos":
          return Promise.resolve(repos);
        case "list_agents":
          return Promise.resolve(groupAgents);
        case "repo_status":
          return Promise.resolve(status);
        case "repo_diff":
          return Promise.resolve(diff);
        case "repo_group_snapshot":
          return Promise.resolve(extraChild);
        case "commit_repo":
        case "commit_all_repo":
          return Promise.resolve(commitResult);
        case "publish_repo_branch":
          return Promise.resolve({ summary: "Published main to origin" });
        case "sync_repo_changes":
          return Promise.resolve({ summary: "Synced main with origin" });
        case "stage_repo_file":
        case "unstage_repo_file":
        case "discard_repo_files":
        case "unregister_repo":
        case "register_repo":
          return Promise.resolve(undefined);
        case "get_preferences":
          return Promise.resolve({
            themeId: "cherry-dark",
            colorScheme: "system",
            uiFont: { family: "sans-serif", sizePx: 14 },
            monoFont: { family: "monospace", sizePx: 13 },
          });
        case "list_custom_themes":
          return Promise.resolve([]);
        case "set_preferences":
          return Promise.resolve(undefined);
        default:
          throw new Error(`unexpected invoke ${command}`);
      }
    });

    renderApp();
    await screen.findByText("[Group] acme");
    fireEvent.click(screen.getByText("[Group] acme"));

    const groupAgentsHeading = await screen.findByText("Agents in This Group");
    const groupAgentsPanel = groupAgentsHeading.closest("section");
    expect(groupAgentsPanel).not.toBeNull();
    expect(groupAgentsPanel).toHaveTextContent("OpenCode (pid 42)");
    expect(screen.getByText("1 agent")).toBeInTheDocument();
  });

  it("filters child repositories by agent presence", async () => {
    const frontendRepo: RepoRef = {
      id: "repo-2",
      path: "/repos/acme/frontend",
      display_name: "frontend",
      kind: "repo",
    };
    const backendRepo: RepoRef = {
      id: "repo-3",
      path: "/repos/acme/backend",
      display_name: "backend",
      kind: "repo",
    };
    const groupAgents: DetectedAgent[] = [
      {
        id: "agent-1",
        kind: "open-code",
        display_name: "OpenCode (pid 42)",
        pid: 42,
        cwd: "/repos/acme/frontend",
        command_line: "opencode",
        targets: {
          repos: [frontendRepo],
          groups: [repos[1]],
        },
      },
    ];
    const extraChildren: RepoGroupSnapshot = {
      ...groupSnapshot,
      repos: [
        ...groupSnapshot.repos,
        {
          repo: frontendRepo,
          status,
          changes: {
            staged: 0,
            unstaged: 1,
            untracked: 0,
            conflicted: 0,
          },
        },
        {
          repo: backendRepo,
          status,
          changes: {
            staged: 0,
            unstaged: 0,
            untracked: 0,
            conflicted: 0,
          },
        },
      ],
    };

    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case "list_repos":
          return Promise.resolve(repos);
        case "list_agents":
          return Promise.resolve(groupAgents);
        case "repo_status":
          return Promise.resolve(status);
        case "repo_diff":
          return Promise.resolve(diff);
        case "repo_group_snapshot":
          return Promise.resolve(extraChildren);
        case "commit_repo":
        case "commit_all_repo":
          return Promise.resolve(commitResult);
        case "publish_repo_branch":
          return Promise.resolve({ summary: "Published main to origin" });
        case "sync_repo_changes":
          return Promise.resolve({ summary: "Synced main with origin" });
        case "stage_repo_file":
        case "unstage_repo_file":
        case "discard_repo_files":
        case "unregister_repo":
        case "register_repo":
          return Promise.resolve(undefined);
        case "get_preferences":
          return Promise.resolve({
            themeId: "cherry-dark",
            colorScheme: "system",
            uiFont: { family: "sans-serif", sizePx: 14 },
            monoFont: { family: "monospace", sizePx: 13 },
          });
        case "list_custom_themes":
          return Promise.resolve([]);
        case "set_preferences":
          return Promise.resolve(undefined);
        default:
          throw new Error(`unexpected invoke ${command}`);
      }
    });

    renderApp();
    await screen.findByText("[Group] acme");
    fireEvent.click(screen.getByText("[Group] acme"));
    const agentFilterTabs = await screen.findByRole("tablist", { name: "Child repository agent filters" });
    const agentFilters = within(agentFilterTabs);

    expect(await screen.findByText("frontend", { selector: "code" })).toBeInTheDocument();

    fireEvent.click(agentFilters.getByRole("tab", { name: "with-agents" }));
    expect(await screen.findByText("frontend", { selector: "code" })).toBeInTheDocument();
    expect(screen.queryByText("backend", { selector: "code" })).not.toBeInTheDocument();

    fireEvent.click(agentFilters.getByRole("tab", { name: "without-agents" }));
    expect(await screen.findByText("backend", { selector: "code" })).toBeInTheDocument();
    expect(screen.queryByText("frontend", { selector: "code" })).not.toBeInTheDocument();
  });

  it("opens an unregistered child repo from the group view", async () => {
    const extraChild: RepoGroupSnapshot = {
      ...groupSnapshot,
      repos: [
        ...groupSnapshot.repos,
        {
          repo: {
            id: "repo-2",
            path: "/repos/acme/frontend",
            display_name: "frontend",
            kind: "repo",
          },
          status,
          changes: {
            staged: 0,
            unstaged: 1,
            untracked: 0,
            conflicted: 0,
          },
        },
      ],
    };
    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case "list_repos":
          return Promise.resolve(repos);
        case "list_agents":
          return Promise.resolve(agents);
        case "repo_status":
          return Promise.resolve(status);
        case "repo_diff":
          return Promise.resolve(diff);
        case "repo_group_snapshot":
          return Promise.resolve(extraChild);
        case "commit_repo":
        case "commit_all_repo":
          return Promise.resolve(commitResult);
        case "publish_repo_branch":
          return Promise.resolve({ summary: "Published main to origin" });
        case "sync_repo_changes":
          return Promise.resolve({ summary: "Synced main with origin" });
        case "stage_repo_file":
        case "unstage_repo_file":
        case "discard_repo_files":
        case "unregister_repo":
        case "register_repo":
          return Promise.resolve(undefined);
        case "get_preferences":
          return Promise.resolve({
            themeId: "cherry-dark",
            colorScheme: "system",
            uiFont: { family: "sans-serif", sizePx: 14 },
            monoFont: { family: "monospace", sizePx: 13 },
          });
        case "list_custom_themes":
          return Promise.resolve([]);
        case "set_preferences":
          return Promise.resolve(undefined);
        default:
          throw new Error(`unexpected invoke ${command}`);
      }
    });

    renderApp();
    await screen.findByText("[Group] acme");
    fireEvent.click(screen.getByText("[Group] acme"));

    expect(await screen.findByText("frontend", { selector: "code" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Track" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("frontend", { selector: "code" }));
    expect(await screen.findByRole("button", { name: "Commit staged (1)" })).toBeInTheDocument();
  });

  it("tracks an unregistered child repo from the group view", async () => {
    const trackedChild: RepoRef = {
      id: "repo-2",
      path: "/repos/acme/frontend",
      display_name: "frontend",
      kind: "repo",
    };
    const extraChild: RepoGroupSnapshot = {
      ...groupSnapshot,
      repos: [
        {
          repo: trackedChild,
          status,
          changes: {
            staged: 0,
            unstaged: 1,
            untracked: 0,
            conflicted: 0,
          },
        },
      ],
    };

    invokeMock.mockImplementation((command: string, payload?: { path?: string }) => {
      switch (command) {
        case "list_repos":
          return Promise.resolve(repos);
        case "list_agents":
          return Promise.resolve(agents);
        case "repo_status":
          return Promise.resolve(status);
        case "repo_diff":
          return Promise.resolve(diff);
        case "repo_group_snapshot":
          return Promise.resolve(extraChild);
        case "register_repo":
          return Promise.resolve({
            id: "repo-2",
            path: payload?.path ?? trackedChild.path,
            display_name: "frontend",
            kind: "repo",
          });
        case "commit_repo":
        case "commit_all_repo":
          return Promise.resolve(commitResult);
        case "publish_repo_branch":
          return Promise.resolve({ summary: "Published main to origin" });
        case "sync_repo_changes":
          return Promise.resolve({ summary: "Synced main with origin" });
        case "stage_repo_file":
        case "unstage_repo_file":
        case "discard_repo_files":
        case "unregister_repo":
          return Promise.resolve(undefined);
        case "get_preferences":
          return Promise.resolve({
            themeId: "cherry-dark",
            colorScheme: "system",
            uiFont: { family: "sans-serif", sizePx: 14 },
            monoFont: { family: "monospace", sizePx: 13 },
          });
        case "list_custom_themes":
          return Promise.resolve([]);
        case "set_preferences":
          return Promise.resolve(undefined);
        default:
          throw new Error(`unexpected invoke ${command}`);
      }
    });

    renderApp();
    await screen.findByText("[Group] acme");
    fireEvent.click(screen.getByText("[Group] acme"));

    expect(await screen.findByRole("button", { name: "Track" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Track" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("register_repo", {
        path: "/repos/acme/frontend",
      }),
    );
    expect(await screen.findByText("frontend")).toBeInTheDocument();
  });

  it("tracks all visible child repos from the group view", async () => {
    const frontendRepo: RepoRef = {
      id: "repo-2",
      path: "/repos/acme/frontend",
      display_name: "frontend",
      kind: "repo",
    };
    const backendRepo: RepoRef = {
      id: "repo-3",
      path: "/repos/acme/backend",
      display_name: "backend",
      kind: "repo",
    };
    const extraChildren: RepoGroupSnapshot = {
      ...groupSnapshot,
      repos: [
        ...groupSnapshot.repos,
        {
          repo: frontendRepo,
          status,
          changes: {
            staged: 0,
            unstaged: 1,
            untracked: 0,
            conflicted: 0,
          },
        },
        {
          repo: backendRepo,
          status,
          changes: {
            staged: 0,
            unstaged: 2,
            untracked: 1,
            conflicted: 0,
          },
        },
      ],
    };

    invokeMock.mockImplementation((command: string, payload?: { path?: string }) => {
      switch (command) {
        case "list_repos":
          return Promise.resolve(repos);
        case "list_agents":
          return Promise.resolve(agents);
        case "repo_status":
          return Promise.resolve(status);
        case "repo_diff":
          return Promise.resolve(diff);
        case "repo_group_snapshot":
          return Promise.resolve(extraChildren);
        case "register_repo":
          return Promise.resolve({
            id: payload?.path === backendRepo.path ? backendRepo.id : frontendRepo.id,
            path: payload?.path,
            display_name: payload?.path === backendRepo.path ? backendRepo.display_name : frontendRepo.display_name,
            kind: "repo",
          });
        case "commit_repo":
        case "commit_all_repo":
          return Promise.resolve(commitResult);
        case "publish_repo_branch":
          return Promise.resolve({ summary: "Published main to origin" });
        case "sync_repo_changes":
          return Promise.resolve({ summary: "Synced main with origin" });
        case "stage_repo_file":
        case "unstage_repo_file":
        case "discard_repo_files":
        case "unregister_repo":
          return Promise.resolve(undefined);
        case "get_preferences":
          return Promise.resolve({
            themeId: "cherry-dark",
            colorScheme: "system",
            uiFont: { family: "sans-serif", sizePx: 14 },
            monoFont: { family: "monospace", sizePx: 13 },
          });
        case "list_custom_themes":
          return Promise.resolve([]);
        case "set_preferences":
          return Promise.resolve(undefined);
        default:
          throw new Error(`unexpected invoke ${command}`);
      }
    });

    renderApp();
    await screen.findByText("[Group] acme");
    fireEvent.click(screen.getByText("[Group] acme"));

    expect(await screen.findByText("1 already tracked")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Track all" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Track all" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("register_repo", {
        path: "/repos/acme/frontend",
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith("register_repo", {
      path: "/repos/acme/backend",
    });
    expect(await screen.findByText("backend")).toBeInTheDocument();
  });

  it("tracks only selected child repos from the group view", async () => {
    const frontendRepo: RepoRef = {
      id: "repo-2",
      path: "/repos/acme/frontend",
      display_name: "frontend",
      kind: "repo",
    };
    const backendRepo: RepoRef = {
      id: "repo-3",
      path: "/repos/acme/backend",
      display_name: "backend",
      kind: "repo",
    };
    const extraChildren: RepoGroupSnapshot = {
      ...groupSnapshot,
      repos: [
        {
          repo: frontendRepo,
          status,
          changes: {
            staged: 0,
            unstaged: 1,
            untracked: 0,
            conflicted: 0,
          },
        },
        {
          repo: backendRepo,
          status,
          changes: {
            staged: 0,
            unstaged: 2,
            untracked: 1,
            conflicted: 0,
          },
        },
      ],
    };

    invokeMock.mockImplementation((command: string, payload?: { path?: string }) => {
      switch (command) {
        case "list_repos":
          return Promise.resolve(repos);
        case "list_agents":
          return Promise.resolve(agents);
        case "repo_status":
          return Promise.resolve(status);
        case "repo_diff":
          return Promise.resolve(diff);
        case "repo_group_snapshot":
          return Promise.resolve(extraChildren);
        case "register_repo":
          return Promise.resolve({
            id: payload?.path === backendRepo.path ? backendRepo.id : frontendRepo.id,
            path: payload?.path,
            display_name: payload?.path === backendRepo.path ? backendRepo.display_name : frontendRepo.display_name,
            kind: "repo",
          });
        case "commit_repo":
        case "commit_all_repo":
          return Promise.resolve(commitResult);
        case "publish_repo_branch":
          return Promise.resolve({ summary: "Published main to origin" });
        case "sync_repo_changes":
          return Promise.resolve({ summary: "Synced main with origin" });
        case "stage_repo_file":
        case "unstage_repo_file":
        case "discard_repo_files":
        case "unregister_repo":
          return Promise.resolve(undefined);
        case "get_preferences":
          return Promise.resolve({
            themeId: "cherry-dark",
            colorScheme: "system",
            uiFont: { family: "sans-serif", sizePx: 14 },
            monoFont: { family: "monospace", sizePx: 13 },
          });
        case "list_custom_themes":
          return Promise.resolve([]);
        case "set_preferences":
          return Promise.resolve(undefined);
        default:
          throw new Error(`unexpected invoke ${command}`);
      }
    });

    renderApp();
    await screen.findByText("[Group] acme");
    fireEvent.click(screen.getByText("[Group] acme"));

    const checkboxes = await screen.findAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);

    expect(await screen.findByRole("button", { name: "Track selected (1)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Track selected (1)" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("register_repo", {
        path: "/repos/acme/frontend",
      }),
    );
    expect(invokeMock).not.toHaveBeenCalledWith("register_repo", {
      path: "/repos/acme/backend",
    });
    expect(await screen.findByText("frontend")).toBeInTheDocument();
  });

  it("clicking the settings button opens the settings dialog", async () => {
    renderApp();

    await screen.findByText("opencherry");

    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Open settings"));

    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  });
});
