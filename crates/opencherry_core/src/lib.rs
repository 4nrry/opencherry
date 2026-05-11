//! Shared types for OpenCherry.
//!
//! This crate intentionally has zero heavy deps so every other crate can
//! depend on it without pulling in git/UI/runtime concerns.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Stable identifier for a tracked repository.
///
/// Currently derived from the canonical absolute path; will become a
/// UUID v7 once `opencherry_persistence` lands proper IDs.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RepoId(pub String);

impl RepoId {
    /// Build a stable id from a canonical path. Idempotent.
    pub fn from_path(path: &std::path::Path) -> Self {
        Self(path.to_string_lossy().into_owned())
    }
}

/// Stable identifier for a detected agent process or session.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AgentId(pub String);

/// A repository the user has registered with OpenCherry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoRef {
    pub id: RepoId,
    pub path: PathBuf,
    pub display_name: String,
}

/// Live status snapshot for a registered repository. Cheap to compute
/// and safe to refresh on a timer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoStatus {
    pub id: RepoId,
    /// Current branch short name, or `None` for detached HEAD.
    pub branch: Option<String>,
    /// Short OID of HEAD (7 chars), if HEAD points to a commit.
    pub head_short: Option<String>,
    /// True when there are any uncommitted changes (staged or unstaged).
    pub dirty: bool,
    /// Number of commits HEAD is ahead of its upstream, if tracked.
    pub ahead: Option<usize>,
    /// Number of commits HEAD is behind its upstream, if tracked.
    pub behind: Option<usize>,
    /// Upstream ref name (e.g. `origin/main`), if tracked.
    pub upstream: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoDiff {
    pub files: Vec<RepoDiffFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoDiffFile {
    pub path: String,
    pub status: String,
    pub additions: usize,
    pub deletions: usize,
    pub patch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitResult {
    pub oid: String,
    pub summary: String,
}

/// Known coding-agent kinds OpenCherry can detect or orchestrate.
///
/// Unknown is reserved for future extensibility and for processes that
/// match a heuristic but no specific kind.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentKind {
    ClaudeCode,
    OpenCode,
    Codex,
    GeminiCli,
    Aider,
    Unknown,
}

impl AgentKind {
    pub fn display_name(&self) -> &'static str {
        match self {
            AgentKind::ClaudeCode => "Claude Code",
            AgentKind::OpenCode => "OpenCode",
            AgentKind::Codex => "Codex",
            AgentKind::GeminiCli => "Gemini CLI",
            AgentKind::Aider => "Aider",
            AgentKind::Unknown => "Unknown",
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("path is not a git repository: {0}")]
    NotARepo(PathBuf),
    #[error("io: {0}")]
    Io(String),
}
