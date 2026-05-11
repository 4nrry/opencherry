//! OpenCherry desktop entry point.
//!
//! Sprint 1: real Tauri commands for repo registration, status, and
//! agent detection. Persistence lives in the platform app config dir.

use opencherry_agents::DetectedAgent;
use opencherry_core::{
    CommitResult, RepoDiff, RepoGroupSnapshot, RepoId, RepoRef, RepoStatus, RepoActionResult,
    TrackedTargetKind,
};
use opencherry_persistence as persist;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Serialize)]
pub struct PingResponse {
    pub message: String,
    pub core_version: &'static str,
}

#[tauri::command]
fn ping(name: Option<String>) -> PingResponse {
    let who = name.unwrap_or_else(|| "world".to_string());
    PingResponse {
        message: format!("OpenCherry says hi, {who}"),
        core_version: env!("CARGO_PKG_VERSION"),
    }
}

fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("failed to resolve app config dir: {e}"))
}

fn tracked_target_kind(path: &Path) -> Result<TrackedTargetKind, String> {
    if git2::Repository::discover(path).is_ok() {
        Ok(TrackedTargetKind::Repo)
    } else if path.is_dir() {
        Ok(TrackedTargetKind::Group)
    } else {
        Err(format!("path does not exist or is unsupported: {}", path.display()))
    }
}

#[tauri::command]
fn list_repos(app: tauri::AppHandle) -> Result<Vec<RepoRef>, String> {
    let dir = config_dir(&app)?;
    persist::list_repos(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn register_repo(app: tauri::AppHandle, path: String) -> Result<RepoRef, String> {
    let dir = config_dir(&app)?;
    let p = Path::new(&path);

    let kind = tracked_target_kind(p)?;

    persist::add_repo(&dir, p, kind).map_err(|e| e.to_string())
}

#[tauri::command]
fn unregister_repo(app: tauri::AppHandle, id: String) -> Result<bool, String> {
    let dir = config_dir(&app)?;
    persist::remove_repo(&dir, &RepoId(id)).map_err(|e| e.to_string())
}

#[tauri::command]
fn repo_status(path: String) -> Result<RepoStatus, String> {
    opencherry_repo::repo_status(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn repo_diff(path: String) -> Result<RepoDiff, String> {
    opencherry_repo::repo_diff(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn repo_group_snapshot(path: String) -> Result<RepoGroupSnapshot, String> {
    opencherry_repo::repo_group_snapshot(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn commit_repo(path: String, message: String) -> Result<CommitResult, String> {
    opencherry_repo::commit_staged(Path::new(&path), &message).map_err(|e| e.to_string())
}

#[tauri::command]
fn commit_all_repo(path: String, message: String) -> Result<CommitResult, String> {
    opencherry_repo::commit_all(Path::new(&path), &message).map_err(|e| e.to_string())
}

#[tauri::command]
fn stage_repo_file(path: String, relative_path: String) -> Result<(), String> {
    opencherry_repo::stage_file(Path::new(&path), &relative_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn unstage_repo_file(path: String, relative_path: String) -> Result<(), String> {
    opencherry_repo::unstage_file(Path::new(&path), &relative_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn discard_repo_file(path: String, relative_path: String) -> Result<(), String> {
    opencherry_repo::discard_file(Path::new(&path), &relative_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn publish_repo_branch(path: String) -> Result<RepoActionResult, String> {
    opencherry_repo::publish_branch(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn sync_repo_changes(path: String) -> Result<RepoActionResult, String> {
    opencherry_repo::sync_changes(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_agents(app: tauri::AppHandle) -> Result<Vec<DetectedAgent>, String> {
    let dir = config_dir(&app)?;
    let repos = persist::list_repos(&dir).map_err(|e| e.to_string())?;
    Ok(opencherry_agents::correlate_agents_to_targets(
        opencherry_agents::detect_running_agents(),
        &repos,
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        "OpenCherry desktop bootstrapping"
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ping,
            list_repos,
            register_repo,
            unregister_repo,
            repo_status,
            repo_diff,
            repo_group_snapshot,
            commit_repo,
            commit_all_repo,
            stage_repo_file,
            unstage_repo_file,
            discard_repo_file,
            publish_repo_branch,
            sync_repo_changes,
            list_agents,
        ])
        .setup(|app| {
            // Eagerly create config dir so first save doesn't race.
            if let Ok(dir) = app.path().app_config_dir() {
                let _ = std::fs::create_dir_all(&dir);
                tracing::info!(path = %dir.display(), "config dir ready");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running OpenCherry desktop");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    static NEXT_ID: AtomicU64 = AtomicU64::new(1);

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(prefix: &str) -> Self {
            let unique = format!(
                "opencherry-desktop-{prefix}-{}-{}",
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

    #[test]
    fn tracked_target_kind_detects_git_repo() {
        let dir = TestDir::new("kind-repo");
        git2::Repository::init(dir.path()).unwrap();

        let kind = tracked_target_kind(dir.path()).unwrap();
        assert_eq!(kind, TrackedTargetKind::Repo);
    }

    #[test]
    fn tracked_target_kind_detects_plain_directory_as_group() {
        let dir = TestDir::new("kind-group");

        let kind = tracked_target_kind(dir.path()).unwrap();
        assert_eq!(kind, TrackedTargetKind::Group);
    }

    #[test]
    fn tracked_target_kind_rejects_missing_path() {
        let dir = TestDir::new("kind-missing");
        let missing = dir.path().join("does-not-exist");

        let error = tracked_target_kind(&missing).unwrap_err();
        assert!(error.contains("path does not exist or is unsupported"));
    }
}
