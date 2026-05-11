import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal, type Resource } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App, { DiffGroup, DiffPanel, RepoPrimaryActionBar } from "./App";
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
        diff={makeRepoDiff({ unstaged: [{ path: "a.ts", status: "modified", additions: 1, deletions: 0, patch: "+a" }] })}
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
});

describe("DiffGroup", () => {
  it("renders grouped files and calls the configured action buttons", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const onSecondaryAction = vi.fn().mockResolvedValue(undefined);
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
        secondaryActionLabel="Discard"
        onSecondaryAction={onSecondaryAction}
      />
    ));

    expect(screen.getByText("Unstaged")).toBeInTheDocument();
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
    expect(screen.getByText("modified")).toBeInTheDocument();
    expect(screen.getByText("+3 / -1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stage" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith("src/App.tsx"));

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(onSecondaryAction).toHaveBeenCalledWith("src/App.tsx"));
  });
});

describe("DiffPanel", () => {
  it("renders all existing groups and invokes stage, unstage, and discard commands", async () => {
    invokeMock.mockResolvedValue(undefined);
    const onChange = vi.fn().mockResolvedValue(undefined);
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

    const discardButtons = screen.getAllByRole("button", { name: "Discard" });
    fireEvent.click(discardButtons[0]);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("discard_repo_file", {
        path: "/repo",
        relativePath: "unstaged.txt",
      }),
    );
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
        case "discard_repo_file":
        case "unregister_repo":
        case "register_repo":
          return Promise.resolve(undefined);
        default:
          throw new Error(`unexpected invoke ${command}`);
      }
    });
  });

  it("loads the repo view and handles commit UI states", async () => {
    render(() => <App />);

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

  it("renders a group view with aggregated child repo data", async () => {
    render(() => <App />);

    await screen.findByText("[Group] acme");
    fireEvent.click(screen.getByText("[Group] acme"));

    expect(await screen.findByText("Child repositories")).toBeInTheDocument();
    expect(screen.getByText("Dirty repos")).toBeInTheDocument();
    expect(screen.getByText("Repos")).toBeInTheDocument();
    expect(screen.getByText("Staged files")).toBeInTheDocument();
    expect(screen.getByText("No untracked child repositories to show for this folder.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Track" })).not.toBeInTheDocument();
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
        case "discard_repo_file":
        case "unregister_repo":
        case "register_repo":
          return Promise.resolve(undefined);
        default:
          throw new Error(`unexpected invoke ${command}`);
      }
    });

    render(() => <App />);
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
        case "discard_repo_file":
        case "unregister_repo":
          return Promise.resolve(undefined);
        default:
          throw new Error(`unexpected invoke ${command}`);
      }
    });

    render(() => <App />);
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
});
