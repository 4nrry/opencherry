//! Git repository operations for OpenCherry.
//!
//! Backed by `git2` (vendored libgit2) for full coverage. A `gix` fast-path
//! for batch read operations across many repos may be added later.

use opencherry_core::{CommitResult, CoreError, RepoDiff, RepoDiffFile, RepoId, RepoStatus};
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

pub fn repo_diff(path: &Path) -> anyhow::Result<RepoDiff> {
    let repo = git2::Repository::discover(path)
        .map_err(|_| CoreError::NotARepo(path.to_path_buf()))?;
    let mut opts = git2::DiffOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(false)
        .include_unmodified(false);
    let diff = repo.diff_index_to_workdir(None, Some(&mut opts))?;

    let stats = diff.stats()?;
    let mut files = Vec::new();
    for delta in diff.deltas() {
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| "(unknown)".to_string());
        files.push(RepoDiffFile {
            path,
            status: delta_status_label(delta.status()).to_string(),
            additions: 0,
            deletions: 0,
            patch: String::new(),
        });
    }

    let mut patch = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let prefix = match line.origin() {
            '+' | '-' | ' ' => line.origin().to_string(),
            _ => String::new(),
        };
        patch.push_str(&prefix);
        patch.push_str(&String::from_utf8_lossy(line.content()));
        true
    })?;

    if files.len() == 1 {
        if let Some(file) = files.first_mut() {
            file.additions = stats.insertions();
            file.deletions = stats.deletions();
            file.patch = truncate_patch(patch);
        }
    } else if !files.is_empty() {
        files.insert(
            0,
            RepoDiffFile {
                path: "(all files)".to_string(),
                status: "modified".to_string(),
                additions: stats.insertions(),
                deletions: stats.deletions(),
                patch: truncate_patch(patch),
            },
        );
    }

    Ok(RepoDiff { files })
}

pub fn commit_all(path: &Path, message: &str) -> anyhow::Result<CommitResult> {
    let message = message.trim();
    if message.is_empty() {
        return Err(anyhow::anyhow!("commit message cannot be empty"));
    }

    let repo = git2::Repository::discover(path)
        .map_err(|_| CoreError::NotARepo(path.to_path_buf()))?;
    let mut index = repo.index()?;
    index.add_all(["*"], git2::IndexAddOption::DEFAULT, None)?;
    index.write()?;
    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;

    let sig = repo
        .signature()
        .or_else(|_| git2::Signature::now("OpenCherry", "opencherry@localhost"))?;
    let parent = repo
        .head()
        .ok()
        .and_then(|head| head.target())
        .and_then(|oid| repo.find_commit(oid).ok());

    let oid = match parent.as_ref() {
        Some(parent) => repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[parent])?,
        None => repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[])?,
    };

    Ok(CommitResult {
        oid: oid.to_string(),
        summary: message.lines().next().unwrap_or(message).to_string(),
    })
}

fn truncate_patch(patch: String) -> String {
    const MAX_PATCH_CHARS: usize = 50_000;
    if patch.len() > MAX_PATCH_CHARS {
        format!("{}\n... diff truncated ...\n", &patch[..MAX_PATCH_CHARS])
    } else {
        patch
    }
}

fn delta_status_label(status: git2::Delta) -> &'static str {
    match status {
        git2::Delta::Added => "added",
        git2::Delta::Copied => "copied",
        git2::Delta::Deleted => "deleted",
        git2::Delta::Ignored => "ignored",
        git2::Delta::Modified => "modified",
        git2::Delta::Renamed => "renamed",
        git2::Delta::Typechange => "typechange",
        git2::Delta::Unmodified => "unmodified",
        git2::Delta::Unreadable => "unreadable",
        git2::Delta::Untracked => "untracked",
        git2::Delta::Conflicted => "conflicted",
    }
}
