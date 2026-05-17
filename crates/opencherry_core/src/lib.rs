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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TrackedTargetKind {
    Repo,
    Group,
}

/// A tracked target the user has registered with OpenCherry.
///
/// Today this can be either a concrete Git repository or a non-repository
/// folder that groups many repositories underneath it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoRef {
    pub id: RepoId,
    pub path: PathBuf,
    pub display_name: String,
    pub kind: TrackedTargetKind,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentTargetMatches {
    pub repos: Vec<RepoRef>,
    pub groups: Vec<RepoRef>,
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
    pub staged: Vec<RepoDiffFile>,
    pub unstaged: Vec<RepoDiffFile>,
    pub untracked: Vec<RepoDiffFile>,
    pub conflicted: Vec<RepoDiffFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoDiffFile {
    pub path: String,
    pub status: String,
    pub additions: usize,
    pub deletions: usize,
    pub patch: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RepoChangeCounts {
    pub staged: usize,
    pub unstaged: usize,
    pub untracked: usize,
    pub conflicted: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoGroupRepo {
    pub repo: RepoRef,
    pub status: RepoStatus,
    pub changes: RepoChangeCounts,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoGroupSnapshot {
    pub root: RepoRef,
    pub repos: Vec<RepoGroupRepo>,
    pub totals: RepoChangeCounts,
    pub dirty_repos: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitResult {
    pub oid: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoActionResult {
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
    CopilotCli,
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
            AgentKind::CopilotCli => "Copilot CLI",
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

// ---------------------------------------------------------------------------
// Theme + font preferences types
// ---------------------------------------------------------------------------

use std::collections::BTreeMap;

/// Which colour scheme the user prefers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ColorScheme {
    Light,
    Dark,
    System,
}

/// A single font preference (family stack + size).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontPref {
    pub family: String,
    pub size_px: u16,
}

/// Persisted user preferences for theme and typography.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub theme_id: String,
    pub color_scheme: ColorScheme,
    pub ui_font: FontPref,
    pub mono_font: FontPref,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            theme_id: "opencherry-default".to_string(),
            color_scheme: ColorScheme::System,
            ui_font: FontPref {
                family:
                    r#"system-ui, -apple-system, "Segoe UI", "Cantarell", "Ubuntu", sans-serif"#
                        .to_string(),
                size_px: 14,
            },
            mono_font: FontPref {
                family: r#"ui-monospace, "JetBrains Mono", "Fira Code", monospace"#.to_string(),
                size_px: 13,
            },
        }
    }
}

/// Light and dark colour token maps for a theme.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeModes {
    pub light: BTreeMap<String, String>,
    pub dark: BTreeMap<String, String>,
}

/// A custom colour theme importable by the user.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Theme {
    pub id: String,
    pub name: String,
    pub modes: ThemeModes,
}
