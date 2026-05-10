//! Git repository operations for OpenCherry.
//!
//! Backed by `git2` (vendored libgit2) for full coverage. A `gix` fast-path
//! for batch read operations across many repos may be added later.

use opencherry_core::CoreError;
use std::path::Path;

/// Smoke-test entry point used by Sprint 0 spike binary.
/// Returns the short OID of HEAD or an error.
pub fn head_short_id(path: &Path) -> anyhow::Result<String> {
    let repo = git2::Repository::discover(path)
        .map_err(|_| CoreError::NotARepo(path.to_path_buf()))?;
    let head = repo.head()?;
    let oid = head.target().ok_or_else(|| anyhow::anyhow!("HEAD has no direct target"))?;
    Ok(format!("{:.7}", oid))
}
