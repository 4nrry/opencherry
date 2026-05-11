//! Git repository operations for OpenCherry.
//!
//! Backed by `git2` (vendored libgit2) for full coverage. A `gix` fast-path
//! for batch read operations across many repos may be added later.

use opencherry_core::{CoreError, RepoId, RepoStatus};
use std::path::Path;

/// Smoke-test entry point: returns the short OID of HEAD or an error.
pub fn head_short_id(path: &Path) -> anyhow::Result<String> {
    let repo = git2::Repository::discover(path)
        .map_err(|_| CoreError::NotARepo(path.to_path_buf()))?;
    let head = repo.head()?;
    let oid = head
        .target()
        .ok_or_else(|| anyhow::anyhow!("HEAD has no direct target"))?;
    Ok(format!("{:.7}", oid))
}

/// Compute a full live status snapshot for the repository at `path`.
pub fn repo_status(path: &Path) -> anyhow::Result<RepoStatus> {
    let repo = git2::Repository::discover(path)
        .map_err(|_| CoreError::NotARepo(path.to_path_buf()))?;
    let workdir = repo
        .workdir()
        .unwrap_or(path)
        .to_path_buf();
    let id = RepoId::from_path(&workdir);

    // Branch + HEAD oid
    let (branch, head_short, head_oid) = match repo.head() {
        Ok(head) => {
            let branch = head
                .shorthand()
                .map(|s| s.to_string())
                .filter(|_| head.is_branch());
            let head_short = head.target().map(|oid| format!("{:.7}", oid));
            (branch, head_short, head.target())
        }
        Err(_) => (None, None, None),
    };

    // Dirty: any non-ignored status entries. Use options that skip
    // ignored files but include untracked.
    let mut status_opts = git2::StatusOptions::new();
    status_opts
        .include_untracked(true)
        .recurse_untracked_dirs(false)
        .include_ignored(false);
    let dirty = repo
        .statuses(Some(&mut status_opts))
        .map(|s| !s.is_empty())
        .unwrap_or(false);

    // Ahead/behind vs upstream, if the current branch tracks one.
    let (ahead, behind, upstream) = if let (Some(branch_name), Some(local_oid)) =
        (branch.as_ref(), head_oid)
    {
        match repo.find_branch(branch_name, git2::BranchType::Local) {
            Ok(local_branch) => match local_branch.upstream() {
                Ok(upstream_branch) => {
                    let upstream_name = upstream_branch
                        .name()
                        .ok()
                        .flatten()
                        .map(|s| s.to_string());
                    let upstream_oid = upstream_branch.get().target();
                    match upstream_oid {
                        Some(up_oid) => match repo.graph_ahead_behind(local_oid, up_oid) {
                            Ok((a, b)) => (Some(a), Some(b), upstream_name),
                            Err(_) => (None, None, upstream_name),
                        },
                        None => (None, None, upstream_name),
                    }
                }
                Err(_) => (None, None, None),
            },
            Err(_) => (None, None, None),
        }
    } else {
        (None, None, None)
    };

    Ok(RepoStatus {
        id,
        branch,
        head_short,
        dirty,
        ahead,
        behind,
        upstream,
    })
}
