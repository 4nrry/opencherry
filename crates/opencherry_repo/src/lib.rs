//! Git repository operations for OpenCherry.
//!
//! Backed by `git2` (vendored libgit2) for full coverage. A `gix` fast-path
//! for batch read operations across many repos may be added later.

use opencherry_core::{
    CommitResult, CoreError, RepoActionResult, RepoDiff, RepoDiffFile, RepoId, RepoStatus,
};
use std::{collections::HashMap, path::Path, process::Command};

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
    let workdir = repo.workdir().unwrap_or(path).to_path_buf();
    let id = RepoId::from_path(&workdir);

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

    let mut status_opts = git2::StatusOptions::new();
    status_opts
        .include_untracked(true)
        .recurse_untracked_dirs(false)
        .include_ignored(false);
    let dirty = repo
        .statuses(Some(&mut status_opts))
        .map(|s| !s.is_empty())
        .unwrap_or(false);

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
    let statuses = collect_statuses(&repo)?;

    let staged_map = diff_file_map(
        &repo,
        repo.diff_tree_to_index(head_tree(&repo)?.as_ref(), None, Some(default_diff_options()))?,
    )?;
    let unstaged_map = diff_file_map(
        &repo,
        repo.diff_index_to_workdir(None, Some(default_diff_options()))?,
    )?;

    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();
    let mut conflicted = Vec::new();

    for entry in statuses {
        let path = entry.path;
        let staged_file = staged_map.get(&path).cloned();
        let unstaged_file = unstaged_map.get(&path).cloned();

        if entry.conflicted {
            conflicted.push(
                unstaged_file
                    .or(staged_file)
                    .unwrap_or_else(|| empty_diff_file(&path, "conflicted")),
            );
            continue;
        }

        if entry.untracked {
            untracked.push(
                unstaged_file.unwrap_or_else(|| empty_diff_file(&path, "untracked")),
            );
            continue;
        }

        if entry.has_staged {
            staged.push(staged_file.unwrap_or_else(|| empty_diff_file(&path, &entry.status_label)));
        }

        if entry.has_unstaged {
            unstaged.push(
                unstaged_file.unwrap_or_else(|| empty_diff_file(&path, &entry.status_label)),
            );
        }
    }

    sort_diff_files(&mut staged);
    sort_diff_files(&mut unstaged);
    sort_diff_files(&mut untracked);
    sort_diff_files(&mut conflicted);

    Ok(RepoDiff {
        staged,
        unstaged,
        untracked,
        conflicted,
    })
}

pub fn stage_file(path: &Path, relative_path: &str) -> anyhow::Result<()> {
    let repo = git2::Repository::discover(path)
        .map_err(|_| CoreError::NotARepo(path.to_path_buf()))?;
    let mut index = repo.index()?;
    index.add_all([relative_path], git2::IndexAddOption::DEFAULT, None)?;
    index.write()?;
    Ok(())
}

pub fn unstage_file(path: &Path, relative_path: &str) -> anyhow::Result<()> {
    let repo = git2::Repository::discover(path)
        .map_err(|_| CoreError::NotARepo(path.to_path_buf()))?;
    let head = repo.head()?.peel_to_commit()?;
    repo.reset_default(Some(head.as_object()), [relative_path])?;
    Ok(())
}

pub fn commit_staged(path: &Path, message: &str) -> anyhow::Result<CommitResult> {
    commit(path, message, false)
}

pub fn commit_all(path: &Path, message: &str) -> anyhow::Result<CommitResult> {
    commit(path, message, true)
}

pub fn publish_branch(path: &Path) -> anyhow::Result<RepoActionResult> {
    let repo = git2::Repository::discover(path)
        .map_err(|_| CoreError::NotARepo(path.to_path_buf()))?;
    let head = repo.head()?;
    if !head.is_branch() {
        return Err(anyhow::anyhow!("cannot publish a detached HEAD"));
    }

    let branch_name = head
        .shorthand()
        .ok_or_else(|| anyhow::anyhow!("failed to resolve current branch"))?;
    let remote_name = default_remote_name(&repo)?;
    run_git(path, ["push", "-u", &remote_name, branch_name])?;

    Ok(RepoActionResult {
        summary: format!("Published {branch_name} to {remote_name}"),
    })
}

pub fn sync_changes(path: &Path) -> anyhow::Result<RepoActionResult> {
    let repo = git2::Repository::discover(path)
        .map_err(|_| CoreError::NotARepo(path.to_path_buf()))?;
    let head = repo.head()?;
    if !head.is_branch() {
        return Err(anyhow::anyhow!("cannot sync a detached HEAD"));
    }

    let branch_name = head
        .shorthand()
        .ok_or_else(|| anyhow::anyhow!("failed to resolve current branch"))?;
    let remote_name = default_remote_name(&repo)?;

    run_git(path, ["pull", "--ff-only", &remote_name, branch_name])?;
    run_git(path, ["push", &remote_name, branch_name])?;

    Ok(RepoActionResult {
        summary: format!("Synced {branch_name} with {remote_name}"),
    })
}

fn commit(path: &Path, message: &str, stage_all: bool) -> anyhow::Result<CommitResult> {
    let message = message.trim();
    if message.is_empty() {
        return Err(anyhow::anyhow!("commit message cannot be empty"));
    }

    let repo = git2::Repository::discover(path)
        .map_err(|_| CoreError::NotARepo(path.to_path_buf()))?;
    let mut index = repo.index()?;
    if stage_all {
        index.add_all(["*"], git2::IndexAddOption::DEFAULT, None)?;
    }
    index.write()?;

    if !has_staged_changes(&repo)? {
        return Err(anyhow::anyhow!("no staged changes to commit"));
    }

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

#[derive(Debug)]
struct StatusEntry {
    path: String,
    has_staged: bool,
    has_unstaged: bool,
    untracked: bool,
    conflicted: bool,
    status_label: String,
}

fn collect_statuses(repo: &git2::Repository) -> anyhow::Result<Vec<StatusEntry>> {
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(false)
        .include_ignored(false)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);
    let statuses = repo.statuses(Some(&mut opts))?;

    let mut out = Vec::new();
    for entry in statuses.iter() {
        let status = entry.status();
        let path = entry
            .head_to_index()
            .and_then(|delta| delta.new_file().path().or_else(|| delta.old_file().path()))
            .or_else(|| {
                entry.index_to_workdir()
                    .and_then(|delta| delta.new_file().path().or_else(|| delta.old_file().path()))
            })
            .map(|p| p.to_string_lossy().into_owned())
            .or_else(|| entry.path().map(|p| p.to_string()))
            .unwrap_or_else(|| "(unknown)".to_string());

        out.push(StatusEntry {
            path,
            has_staged: status.is_index_new()
                || status.is_index_modified()
                || status.is_index_deleted()
                || status.is_index_renamed()
                || status.is_index_typechange(),
            has_unstaged: status.is_wt_modified()
                || status.is_wt_deleted()
                || status.is_wt_typechange()
                || status.is_wt_renamed(),
            untracked: status.is_wt_new(),
            conflicted: status.is_conflicted(),
            status_label: status_label(status).to_string(),
        });
    }

    Ok(out)
}

fn diff_file_map(
    repo: &git2::Repository,
    diff: git2::Diff<'_>,
) -> anyhow::Result<HashMap<String, RepoDiffFile>> {
    let mut patch_by_path: HashMap<String, String> = HashMap::new();
    diff.print(git2::DiffFormat::Patch, |delta, _hunk, line| {
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| "(unknown)".to_string());

        let prefix = match line.origin() {
            '+' | '-' | ' ' => line.origin().to_string(),
            _ => String::new(),
        };

        patch_by_path.entry(path).or_default().push_str(&prefix);
        patch_by_path
            .entry(
                delta
                    .new_file()
                    .path()
                    .or_else(|| delta.old_file().path())
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "(unknown)".to_string()),
            )
            .or_default()
            .push_str(&String::from_utf8_lossy(line.content()));
        true
    })?;

    let mut map = HashMap::new();
    for delta in diff.deltas() {
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| "(unknown)".to_string());
        let patch = patch_by_path.remove(&path).unwrap_or_default();
        let stats = file_patch_stats(&patch);

        map.insert(
            path.clone(),
            RepoDiffFile {
                path,
                status: delta_status_label(delta.status()).to_string(),
                additions: stats.0,
                deletions: stats.1,
                patch: truncate_patch(patch),
            },
        );
    }

    // Untracked files can show up without printable patch lines; keep them visible.
    for (path, patch) in patch_by_path {
        let stats = file_patch_stats(&patch);
        map.entry(path.clone()).or_insert_with(|| RepoDiffFile {
            path,
            status: "untracked".to_string(),
            additions: stats.0,
            deletions: stats.1,
            patch: truncate_patch(patch),
        });
    }

    let _ = repo;
    Ok(map)
}

fn head_tree(repo: &git2::Repository) -> anyhow::Result<Option<git2::Tree<'_>>> {
    let head = match repo.head() {
        Ok(head) => head,
        Err(_) => return Ok(None),
    };
    let Some(oid) = head.target() else {
        return Ok(None);
    };
    Ok(Some(repo.find_commit(oid)?.tree()?))
}

fn has_staged_changes(repo: &git2::Repository) -> anyhow::Result<bool> {
    let diff = repo.diff_tree_to_index(head_tree(repo)?.as_ref(), None, Some(default_diff_options()))?;
    Ok(diff.deltas().len() > 0)
}

fn default_diff_options() -> &'static mut git2::DiffOptions {
    let mut opts = git2::DiffOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(false)
        .include_unmodified(false)
        .ignore_filemode(true);
    Box::leak(Box::new(opts))
}

fn empty_diff_file(path: &str, status: &str) -> RepoDiffFile {
    RepoDiffFile {
        path: path.to_string(),
        status: status.to_string(),
        additions: 0,
        deletions: 0,
        patch: String::new(),
    }
}

fn sort_diff_files(files: &mut [RepoDiffFile]) {
    files.sort_by(|a, b| a.path.cmp(&b.path));
}

fn file_patch_stats(patch: &str) -> (usize, usize) {
    let mut additions = 0;
    let mut deletions = 0;

    for line in patch.lines() {
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        if line.starts_with('+') {
            additions += 1;
        } else if line.starts_with('-') {
            deletions += 1;
        }
    }

    (additions, deletions)
}

fn truncate_patch(patch: String) -> String {
    const MAX_PATCH_CHARS: usize = 50_000;
    if patch.len() > MAX_PATCH_CHARS {
        format!("{}\n... diff truncated ...\n", &patch[..MAX_PATCH_CHARS])
    } else {
        patch
    }
}

fn status_label(status: git2::Status) -> &'static str {
    if status.is_conflicted() {
        "conflicted"
    } else if status.is_wt_new() {
        "untracked"
    } else if status.is_index_new() {
        "added"
    } else if status.is_index_deleted() || status.is_wt_deleted() {
        "deleted"
    } else if status.is_index_renamed() || status.is_wt_renamed() {
        "renamed"
    } else if status.is_index_typechange() || status.is_wt_typechange() {
        "typechange"
    } else {
        "modified"
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

fn default_remote_name(repo: &git2::Repository) -> anyhow::Result<String> {
    if let Ok(head) = repo.head() {
        if let Ok(branch) = head.resolve().and_then(|h| h.peel_to_commit()).and_then(|_| {
            repo.find_branch(
                head.shorthand().unwrap_or_default(),
                git2::BranchType::Local,
            )
        }) {
            if let Ok(upstream) = branch.upstream() {
                if let Ok(Some(name)) = upstream.name() {
                    if let Some((remote, _branch)) = name.split_once('/') {
                        return Ok(remote.to_string());
                    }
                }
            }
        }
    }

    let remotes = repo.remotes()?;
    remotes
        .iter()
        .flatten()
        .find(|name| *name == "origin")
        .or_else(|| remotes.iter().flatten().next())
        .map(|name| name.to_string())
        .ok_or_else(|| anyhow::anyhow!("no git remote configured"))
}

fn run_git<I, S>(path: &Path, args: I) -> anyhow::Result<()>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let output = Command::new("git").args(args).current_dir(path).output()?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(anyhow::anyhow!(if !stderr.is_empty() { stderr } else { stdout }))
    }
}
