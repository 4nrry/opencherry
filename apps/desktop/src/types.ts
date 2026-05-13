// Mirrors of opencherry_core types. Kept in sync by hand for now;
// could be auto-generated via specta later.

export interface RepoRef {
  id: string;
  path: string;
  display_name: string;
  kind: TrackedTargetKind;
}

export type TrackedTargetKind = "repo" | "group";

export interface RepoStatus {
  id: string;
  branch: string | null;
  head_short: string | null;
  dirty: boolean;
  ahead: number | null;
  behind: number | null;
  upstream: string | null;
}

export interface RepoDiff {
  staged: RepoDiffFile[];
  unstaged: RepoDiffFile[];
  untracked: RepoDiffFile[];
  conflicted: RepoDiffFile[];
}

export interface RepoDiffFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string;
}

export interface CommitResult {
  oid: string;
  summary: string;
}

export interface RepoActionResult {
  summary: string;
}

export interface RepoChangeCounts {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
}

export interface RepoGroupRepo {
  repo: RepoRef;
  status: RepoStatus;
  changes: RepoChangeCounts;
}

export interface RepoGroupSnapshot {
  root: RepoRef;
  repos: RepoGroupRepo[];
  totals: RepoChangeCounts;
  dirty_repos: number;
}

export type AgentKind =
  | "claude-code"
  | "open-code"
  | "codex"
  | "gemini-cli"
  | "aider"
  | "copilot-cli"
  | "unknown";

export type AgentStatus = "idle" | "generating";

export interface DetectedAgent {
  id: string;
  kind: AgentKind;
  display_name: string;
  pid: number;
  cwd: string | null;
  command_line: string;
  targets: AgentTargetMatches;
  /**
   * Inferred from CPU usage. Optional so existing test fixtures stay valid;
   * production data from `opencherry_agents` always sets it.
   */
  status?: AgentStatus;
  /**
   * If the process's parent is also a detected agent, the parent's id.
   * Used to render subprocesses as children of their primary agent.
   */
  parent_id?: string | null;
}

export interface AgentTargetMatches {
  repos: RepoRef[];
  groups: RepoRef[];
}
