//! Shared types for OpenCherry.
//!
//! This crate intentionally has zero heavy deps so every other crate can
//! depend on it without pulling in git/UI/runtime concerns.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Stable identifier for a tracked repository (UUID v7 in persistence later;
/// a path-derived placeholder for now).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RepoId(pub String);

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

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("path is not a git repository: {0}")]
    NotARepo(PathBuf),
    #[error("io: {0}")]
    Io(String),
}
