// Mirrors of opencherry_core types. Kept in sync by hand for now;
// could be auto-generated via specta later.

export interface RepoRef {
  id: string;
  path: string;
  display_name: string;
}

export interface RepoStatus {
  id: string;
  branch: string | null;
  head_short: string | null;
  dirty: boolean;
  ahead: number | null;
  behind: number | null;
  upstream: string | null;
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
