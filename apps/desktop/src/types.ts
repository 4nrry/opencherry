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
  | "unknown";

export interface DetectedAgent {
  id: string;
  kind: AgentKind;
  display_name: string;
  pid: number;
  cwd: string | null;
  command_line: string;
}
