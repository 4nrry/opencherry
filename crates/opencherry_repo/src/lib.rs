//! Git repository operations for OpenCherry.
//!
//! Backed by `git2` (vendored libgit2) for full coverage. A `gix` fast-path
//! for batch read operations across many repos may be added later.

use opencherry_core::{
    CommitResult, CoreError, RepoActionResult, RepoChangeCounts, RepoDiff, RepoDiffFile,
    RepoGroupRepo, RepoGroupSnapshot, RepoId, RepoRef, RepoStatus, TrackedTargetKind,
};
use std::{collections::HashMap, fs, path::Path, process::Command};

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

pub fn repo_group_snapshot(path: &Path) -> anyhow::Result<RepoGroupSnapshot> {
    let canonical_root = path.canonicalize()?;
    let mut discovered = Vec::new();
    collect_repos_under(&canonical_root, &canonical_root, &mut discovered)?;
    discovered.sort();

    let root = RepoRef {
        id: RepoId::from_path(&canonical_root),
        path: canonical_root.clone(),
        display_name: canonical_root
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| canonical_root.to_string_lossy().into_owned()),
        kind: TrackedTargetKind::Group,
    };

    let mut repos = Vec::new();
    let mut totals = RepoChangeCounts::default();
    let mut dirty_repos = 0;

    for repo_path in discovered {
        let status = repo_status(&repo_path)?;
        let diff = repo_diff(&repo_path)?;
        let changes = RepoChangeCounts {
            staged: diff.staged.len(),
            unstaged: diff.unstaged.len(),
            untracked: diff.untracked.len(),
            conflicted: diff.conflicted.len(),
        };

        totals.staged += changes.staged;
        totals.unstaged += changes.unstaged;
        totals.untracked += changes.untracked;
        totals.conflicted += changes.conflicted;
        if status.dirty {
            dirty_repos += 1;
        }

        repos.push(RepoGroupRepo {
            repo: RepoRef {
                id: status.id.clone(),
                path: repo_path.clone(),
                display_name: repo_path
                    .file_name()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| repo_path.to_string_lossy().into_owned()),
                kind: TrackedTargetKind::Repo,
            },
            status,
            changes,
        });
    }

    Ok(RepoGroupSnapshot {
        root,
        repos,
        totals,
        dirty_repos,
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

#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct DiscardOutcome {
    pub discarded: Vec<String>,
    pub failed: Vec<(String, String)>,
}

pub fn discard_files(path: &Path, relative_paths: &[&str]) -> anyhow::Result<DiscardOutcome> {
    let repo = git2::Repository::discover(path)
        .map_err(|_| CoreError::NotARepo(path.to_path_buf()))?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| anyhow::anyhow!("repository has no working tree"))?
        .to_path_buf();

    let mut outcome = DiscardOutcome::default();

    for &relative_path in relative_paths {
        match discard_single(&repo, &workdir, relative_path) {
            Ok(()) => outcome.discarded.push(relative_path.to_string()),
            Err(err) => outcome
                .failed
                .push((relative_path.to_string(), err.to_string())),
        }
    }

    Ok(outcome)
}

fn discard_single(
    repo: &git2::Repository,
    workdir: &Path,
    relative_path: &str,
) -> anyhow::Result<()> {
    let relative = Path::new(relative_path);
    let status = repo.status_file(relative)?;

    if status.is_conflicted() {
        return Err(anyhow::anyhow!("cannot discard conflicted file"));
    }

    if status.is_wt_new() {
        let target = workdir.join(relative);
        if target.is_dir() {
            fs::remove_dir_all(&target)?;
        } else if target.exists() {
            fs::remove_file(&target)?;
        }
        return Ok(());
    }

    let has_unstaged = status.is_wt_modified()
        || status.is_wt_deleted()
        || status.is_wt_typechange()
        || status.is_wt_renamed();

    if !has_unstaged {
        return Err(anyhow::anyhow!("no discardable unstaged changes for file"));
    }

    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force().path(relative);
    repo.checkout_index(None, Some(&mut checkout))?;
    Ok(())
}

pub fn commit_staged(path: &Path, message: &str) -> anyhow::Result<CommitResult> {
    commit(path, message, false)
}

pub fn commit_all(path: &Path, message: &str) -> anyhow::Result<CommitResult> {
    commit(path, message, true)
}

pub fn publish_branch(path: &Path) -> anyhow::Result<RepoActionResult> {
    publish_branch_with(path, run_git_slice)
}

pub fn sync_changes(path: &Path) -> anyhow::Result<RepoActionResult> {
    sync_changes_with(path, run_git_slice)
}

fn publish_branch_with<F>(path: &Path, run_git_cmd: F) -> anyhow::Result<RepoActionResult>
where
    F: Fn(&Path, &[&str]) -> anyhow::Result<()>,
{
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
    run_git_cmd(path, &["push", "-u", &remote_name, branch_name])?;

    Ok(RepoActionResult {
        summary: format!("Published {branch_name} to {remote_name}"),
    })
}

fn sync_changes_with<F>(path: &Path, run_git_cmd: F) -> anyhow::Result<RepoActionResult>
where
    F: Fn(&Path, &[&str]) -> anyhow::Result<()>,
{
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

    run_git_cmd(path, &["pull", "--ff-only", &remote_name, branch_name])?;
    run_git_cmd(path, &["push", &remote_name, branch_name])?;

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

fn collect_repos_under(
    root: &Path,
    current: &Path,
    out: &mut Vec<std::path::PathBuf>,
) -> anyhow::Result<()> {
    if current != root && current.join(".git").exists() {
        out.push(current.to_path_buf());
        return Ok(());
    }

    for entry in fs::read_dir(current)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }

        let path = entry.path();
        if path.file_name().is_some_and(|name| name == ".git") {
            continue;
        }

        collect_repos_under(root, &path, out)?;
    }

    Ok(())
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

fn run_git_slice(path: &Path, args: &[&str]) -> anyhow::Result<()> {
    run_git(path, args)
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Repository, Signature};
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::{
            atomic::{AtomicU64, Ordering},
            Arc, Mutex,
        },
        time::{SystemTime, UNIX_EPOCH},
    };

    static NEXT_ID: AtomicU64 = AtomicU64::new(1);

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(prefix: &str) -> Self {
            let unique = format!(
                "opencherry-{prefix}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
                    + u128::from(NEXT_ID.fetch_add(1, Ordering::Relaxed))
            );
            let path = std::env::temp_dir().join(unique);
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    struct TestRepo {
        _root: TestDir,
        path: PathBuf,
        repo: Repository,
    }

    impl TestRepo {
        fn new(name: &str) -> Self {
            let root = TestDir::new(name);
            let path = root.path().join("repo");
            fs::create_dir_all(&path).unwrap();
            let repo = Repository::init(&path).unwrap();
            let this = Self {
                _root: root,
                path,
                repo,
            };
            this.write_file("README.md", "hello\n");
            this.commit_all_files("initial");
            this
        }

        fn path(&self) -> &Path {
            &self.path
        }

        fn write_file(&self, relative_path: &str, contents: &str) {
            let file_path = self.path.join(relative_path);
            if let Some(parent) = file_path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(file_path, contents).unwrap();
        }

        fn append_file(&self, relative_path: &str, contents: &str) {
            let file_path = self.path.join(relative_path);
            use std::io::Write;
            let mut file = fs::OpenOptions::new()
                .append(true)
                .open(file_path)
                .unwrap();
            file.write_all(contents.as_bytes()).unwrap();
        }

        fn signature() -> Signature<'static> {
            Signature::now("OpenCherry Tests", "tests@opencherry.local").unwrap()
        }

        fn commit_all_files(&self, message: &str) -> git2::Oid {
            let mut index = self.repo.index().unwrap();
            index.add_all(["*"], git2::IndexAddOption::DEFAULT, None).unwrap();
            index.write().unwrap();
            self.commit_index(message)
        }

        fn commit_index(&self, message: &str) -> git2::Oid {
            let mut index = self.repo.index().unwrap();
            let tree_oid = index.write_tree().unwrap();
            let tree = self.repo.find_tree(tree_oid).unwrap();
            let sig = Self::signature();
            let parent = self
                .repo
                .head()
                .ok()
                .and_then(|head| head.target())
                .and_then(|oid| self.repo.find_commit(oid).ok());
            match parent.as_ref() {
                Some(parent) => self
                    .repo
                    .commit(Some("HEAD"), &sig, &sig, message, &tree, &[parent])
                    .unwrap(),
                None => self
                    .repo
                    .commit(Some("HEAD"), &sig, &sig, message, &tree, &[])
                    .unwrap(),
            }
        }

        fn create_branch_with_remote(&self, name: &str, remote: &str) {
            let head_commit = self
                .repo
                .head()
                .unwrap()
                .peel_to_commit()
                .unwrap();
            self.repo.branch(name, &head_commit, true).unwrap();
            self.repo.set_head(&format!("refs/heads/{name}")).unwrap();
            self.repo.checkout_head(None).unwrap();
            self.repo.remote(remote, "https://example.com/opencherry.git").unwrap();
            self.repo
                .reference(
                    &format!("refs/remotes/{remote}/{name}"),
                    head_commit.id(),
                    true,
                    "set remote tracking ref",
                )
                .unwrap();
            let mut config = self.repo.config().unwrap();
            config
                .set_str(&format!("branch.{name}.remote"), remote)
                .unwrap();
            config
                .set_str(&format!("branch.{name}.merge"), &format!("refs/heads/{name}"))
                .unwrap();
        }
    }

    #[test]
    fn repo_status_reports_clean_and_dirty_repo() {
        let repo = TestRepo::new("repo-status");

        let clean = repo_status(repo.path()).unwrap();
        assert!(!clean.dirty);
        assert_eq!(clean.branch.as_deref(), Some("master").or(Some("main")));
        assert!(clean.head_short.is_some());

        repo.append_file("README.md", "more\n");
        let dirty = repo_status(repo.path()).unwrap();
        assert!(dirty.dirty);
        assert_eq!(dirty.upstream, None);
    }

    #[test]
    fn repo_status_reports_ahead_and_behind_when_upstream_exists() {
        let repo = TestRepo::new("repo-ahead-behind");
        repo.create_branch_with_remote("feature", "origin");

        repo.write_file("ahead.txt", "ahead\n");
        repo.commit_all_files("ahead");

        let head_commit = repo.repo.head().unwrap().peel_to_commit().unwrap();
        let parent = head_commit.parent(0).unwrap();
        repo.repo
            .reference(
                "refs/remotes/origin/feature",
                parent.id(),
                true,
                "move remote behind local",
            )
            .unwrap();

        let ahead = repo_status(repo.path()).unwrap();
        assert_eq!(ahead.branch.as_deref(), Some("feature"));
        assert_eq!(ahead.upstream.as_deref(), Some("origin/feature"));
        assert_eq!(ahead.ahead, Some(1));
        assert_eq!(ahead.behind, Some(0));

        repo.repo
            .reference(
                "refs/remotes/origin/feature",
                head_commit.id(),
                true,
                "restore remote ref",
            )
            .unwrap();
        repo.write_file("behind.txt", "behind\n");
        let mut index = repo.repo.index().unwrap();
        index.add_path(Path::new("behind.txt")).unwrap();
        index.write().unwrap();
        let remote_commit = repo.commit_index("remote ahead");
        repo.repo.reset(&head_commit.into_object(), git2::ResetType::Hard, None).unwrap();
        repo.repo
            .reference(
                "refs/remotes/origin/feature",
                remote_commit,
                true,
                "remote ahead of local",
            )
            .unwrap();

        let behind = repo_status(repo.path()).unwrap();
        assert_eq!(behind.ahead, Some(0));
        assert_eq!(behind.behind, Some(1));
    }

    #[test]
    fn repo_diff_groups_staged_unstaged_and_untracked_files() {
        let repo = TestRepo::new("repo-diff");
        repo.write_file("staged.txt", "staged\n");
        stage_file(repo.path(), "staged.txt").unwrap();

        repo.append_file("README.md", "unstaged change\n");
        repo.write_file("untracked.txt", "new\n");

        let diff = repo_diff(repo.path()).unwrap();
        assert_eq!(diff.staged.len(), 1);
        assert_eq!(diff.staged[0].path, "staged.txt");
        assert_eq!(diff.unstaged.len(), 1);
        assert_eq!(diff.unstaged[0].path, "README.md");
        assert_eq!(diff.untracked.len(), 1);
        assert_eq!(diff.untracked[0].path, "untracked.txt");
        assert!(diff.conflicted.is_empty());
    }

    #[test]
    fn repo_diff_classifies_conflicted_files() {
        let root = TestDir::new("repo-conflict-root");
        let remote_path = root.path().join("remote.git");
        let seed_path = root.path().join("seed");
        let local_path = root.path().join("local");
        let other_path = root.path().join("other");
        Repository::init_bare(&remote_path).unwrap();

        let seed = Repository::init(&seed_path).unwrap();
        {
            let mut config = seed.config().unwrap();
            config.set_str("user.name", "OpenCherry Tests").unwrap();
            config
                .set_str("user.email", "tests@opencherry.local")
                .unwrap();
        }
        seed.remote("origin", remote_path.to_str().unwrap()).unwrap();
        fs::write(seed_path.join("shared.txt"), "base\n").unwrap();
        {
            let mut index = seed.index().unwrap();
            index.add_path(Path::new("shared.txt")).unwrap();
            index.write().unwrap();
            let tree_oid = index.write_tree().unwrap();
            let tree = seed.find_tree(tree_oid).unwrap();
            let sig = TestRepo::signature();
            seed.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
                .unwrap();
        }
        let branch_name = seed
            .head()
            .unwrap()
            .shorthand()
            .unwrap()
            .to_string();
        seed.find_remote("origin")
            .unwrap()
            .push(
                &[&format!("refs/heads/{branch_name}:refs/heads/{branch_name}")],
                None,
            )
            .unwrap();

        let local = Repository::clone(remote_path.to_str().unwrap(), &local_path).unwrap();
        let other = Repository::clone(remote_path.to_str().unwrap(), &other_path).unwrap();

        for repo in [&local, &other] {
            let mut config = repo.config().unwrap();
            config.set_str("user.name", "OpenCherry Tests").unwrap();
            config
                .set_str("user.email", "tests@opencherry.local")
                .unwrap();
        }

        fs::write(other_path.join("shared.txt"), "remote\n").unwrap();
        {
            let mut index = other.index().unwrap();
            index.add_path(Path::new("shared.txt")).unwrap();
            index.write().unwrap();
            let tree_oid = index.write_tree().unwrap();
            let tree = other.find_tree(tree_oid).unwrap();
            let sig = TestRepo::signature();
            let parent = other.head().unwrap().peel_to_commit().unwrap();
            other
                .commit(Some("HEAD"), &sig, &sig, "remote change", &tree, &[&parent])
                .unwrap();
        }
        other
            .find_remote("origin")
            .unwrap()
            .push(
                &[&format!("refs/heads/{branch_name}:refs/heads/{branch_name}")],
                None,
            )
            .unwrap();

        fs::write(local_path.join("shared.txt"), "local\n").unwrap();
        {
            let mut index = local.index().unwrap();
            index.add_path(Path::new("shared.txt")).unwrap();
            index.write().unwrap();
            let tree_oid = index.write_tree().unwrap();
            let tree = local.find_tree(tree_oid).unwrap();
            let sig = TestRepo::signature();
            let parent = local.head().unwrap().peel_to_commit().unwrap();
            local
                .commit(Some("HEAD"), &sig, &sig, "local change", &tree, &[&parent])
                .unwrap();
        }

        let mut remote = local.find_remote("origin").unwrap();
        remote.fetch(&[&branch_name], None, None).unwrap();
        let annotated = local
            .find_reference(&format!("refs/remotes/origin/{branch_name}"))
            .and_then(|r| local.reference_to_annotated_commit(&r))
            .unwrap();
        local.merge(&[&annotated], None, None).unwrap();

        let diff = repo_diff(&local_path).unwrap();
        assert_eq!(diff.conflicted.len(), 1);
        assert_eq!(diff.conflicted[0].path, "shared.txt");
    }

    #[test]
    fn stage_and_unstage_file_move_changes_between_groups() {
        let repo = TestRepo::new("repo-stage-unstage");
        repo.append_file("README.md", "change\n");

        let before = repo_diff(repo.path()).unwrap();
        assert_eq!(before.unstaged.len(), 1);

        stage_file(repo.path(), "README.md").unwrap();
        let staged = repo_diff(repo.path()).unwrap();
        assert_eq!(staged.staged.len(), 1);
        assert!(staged.unstaged.is_empty());

        unstage_file(repo.path(), "README.md").unwrap();
        let unstaged = repo_diff(repo.path()).unwrap();
        assert!(unstaged.staged.is_empty());
        assert_eq!(unstaged.unstaged.len(), 1);
    }

    #[test]
    fn discard_files_mixed_batch_with_one_failure() {
        let repo = TestRepo::new("repo-discard-files-mixed");
        repo.write_file("modified.txt", "original\n");
        repo.commit_all_files("seed modified.txt");
        repo.write_file("modified.txt", "dirty\n");
        repo.write_file("scratch.txt", "untracked\n");

        let outcome = discard_files(
            repo.path(),
            &["modified.txt", "scratch.txt", "README.md"],
        )
        .unwrap();

        assert_eq!(outcome.discarded.len(), 2);
        assert!(outcome.discarded.contains(&"modified.txt".to_string()));
        assert!(outcome.discarded.contains(&"scratch.txt".to_string()));
        assert_eq!(outcome.failed.len(), 1);
        assert_eq!(outcome.failed[0].0, "README.md");

        assert_eq!(
            fs::read_to_string(repo.path().join("modified.txt")).unwrap(),
            "original\n"
        );
        assert!(!repo.path().join("scratch.txt").exists());
    }

    #[test]
    fn discard_files_continues_after_missing_path() {
        let repo = TestRepo::new("repo-discard-files-missing");
        repo.write_file("real.txt", "original\n");
        repo.commit_all_files("seed real.txt");
        repo.write_file("real.txt", "dirty\n");

        let outcome =
            discard_files(repo.path(), &["real.txt", "ghost.txt"]).unwrap();

        assert_eq!(outcome.discarded, vec!["real.txt".to_string()]);
        assert_eq!(outcome.failed.len(), 1);
        assert_eq!(outcome.failed[0].0, "ghost.txt");

        assert_eq!(
            fs::read_to_string(repo.path().join("real.txt")).unwrap(),
            "original\n"
        );
    }

    #[test]
    fn discard_files_empty_slice_is_noop() {
        let repo = TestRepo::new("repo-discard-files-empty");
        let outcome = discard_files(repo.path(), &[]).unwrap();
        assert!(outcome.discarded.is_empty());
        assert!(outcome.failed.is_empty());
    }

    #[test]
    fn repo_group_snapshot_discovers_and_aggregates_child_repos() {
        let root = TestDir::new("repo-group-root");
        let org_root = root.path().join("acme");
        let repo_a_path = org_root.join("frontend");
        let repo_b_path = org_root.join("backend");
        fs::create_dir_all(&repo_a_path).unwrap();
        fs::create_dir_all(&repo_b_path).unwrap();

        let repo_a = Repository::init(&repo_a_path).unwrap();
        let repo_b = Repository::init(&repo_b_path).unwrap();

        for (repo, file_name) in [(&repo_a, "a.txt"), (&repo_b, "b.txt")] {
            fs::write(repo.workdir().unwrap().join(file_name), "base\n").unwrap();
            let mut index = repo.index().unwrap();
            index.add_path(Path::new(file_name)).unwrap();
            index.write().unwrap();
            let tree_oid = index.write_tree().unwrap();
            let tree = repo.find_tree(tree_oid).unwrap();
            let sig = TestRepo::signature();
            repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
                .unwrap();
        }

        fs::write(repo_a_path.join("a.txt"), "changed\n").unwrap();
        fs::write(repo_b_path.join("new.txt"), "new\n").unwrap();

        let snapshot = repo_group_snapshot(&org_root).unwrap();
        assert_eq!(snapshot.root.kind, TrackedTargetKind::Group);
        assert_eq!(snapshot.repos.len(), 2);
        assert_eq!(snapshot.dirty_repos, 2);
        assert_eq!(snapshot.totals.unstaged, 1);
        assert_eq!(snapshot.totals.untracked, 1);
        assert_eq!(snapshot.totals.staged, 0);
        assert_eq!(snapshot.totals.conflicted, 0);
    }

    #[test]
    fn commit_staged_only_commits_indexed_changes() {
        let repo = TestRepo::new("repo-commit-staged");
        repo.append_file("README.md", "staged\n");
        stage_file(repo.path(), "README.md").unwrap();
        repo.write_file("left-behind.txt", "unstaged\n");

        let result = commit_staged(repo.path(), "commit staged").unwrap();
        assert_eq!(result.summary, "commit staged");

        let diff = repo_diff(repo.path()).unwrap();
        assert!(diff.staged.is_empty());
        assert_eq!(diff.untracked.len(), 1);
        assert_eq!(diff.untracked[0].path, "left-behind.txt");
    }

    #[test]
    fn commit_all_stages_and_commits_everything() {
        let repo = TestRepo::new("repo-commit-all");
        repo.write_file("new-file.txt", "all\n");

        let result = commit_all(repo.path(), "commit all").unwrap();
        assert_eq!(result.summary, "commit all");

        let status = repo_status(repo.path()).unwrap();
        assert!(!status.dirty);
        let diff = repo_diff(repo.path()).unwrap();
        assert!(diff.staged.is_empty());
        assert!(diff.unstaged.is_empty());
        assert!(diff.untracked.is_empty());
    }

    #[test]
    fn publish_and_sync_use_expected_git_commands() {
        let repo = TestRepo::new("repo-remote-actions");
        repo.create_branch_with_remote("feature", "origin");

        let publish_calls: Arc<Mutex<Vec<Vec<String>>>> = Arc::new(Mutex::new(Vec::new()));
        let publish_result = publish_branch_with(repo.path(), {
            let publish_calls = Arc::clone(&publish_calls);
            move |_path, args| {
                publish_calls
                    .lock()
                    .unwrap()
                    .push(args.iter().map(|arg| arg.to_string()).collect());
                Ok(())
            }
        })
        .unwrap();
        assert_eq!(publish_result.summary, "Published feature to origin");
        assert_eq!(
            publish_calls.lock().unwrap().as_slice(),
            &[vec![
                "push".to_string(),
                "-u".to_string(),
                "origin".to_string(),
                "feature".to_string(),
            ]]
        );

        let sync_calls: Arc<Mutex<Vec<Vec<String>>>> = Arc::new(Mutex::new(Vec::new()));
        let sync_result = sync_changes_with(repo.path(), {
            let sync_calls = Arc::clone(&sync_calls);
            move |_path, args| {
                sync_calls
                    .lock()
                    .unwrap()
                    .push(args.iter().map(|arg| arg.to_string()).collect());
                Ok(())
            }
        })
        .unwrap();
        assert_eq!(sync_result.summary, "Synced feature with origin");
        assert_eq!(
            sync_calls.lock().unwrap().as_slice(),
            &[
                vec![
                    "pull".to_string(),
                    "--ff-only".to_string(),
                    "origin".to_string(),
                    "feature".to_string(),
                ],
                vec!["push".to_string(), "origin".to_string(), "feature".to_string()],
            ]
        );
    }
}
