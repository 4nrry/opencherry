//! OpenCherry desktop entry point.
//!
//! Sprint 1: real Tauri commands for repo registration, status, and
//! agent detection. Persistence lives in the platform app config dir.

use opencherry_agents::DetectedAgent;
use opencherry_core::{CommitResult, RepoActionResult, RepoDiff, RepoId, RepoRef, RepoStatus};
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

#[tauri::command]
fn list_repos(app: tauri::AppHandle) -> Result<Vec<RepoRef>, String> {
    let dir = config_dir(&app)?;
    persist::list_repos(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn register_repo(app: tauri::AppHandle, path: String) -> Result<RepoRef, String> {
    let dir = config_dir(&app)?;
    let p = Path::new(&path);

    // Validate it's a git repo before persisting; surface a clean error.
    if git2::Repository::discover(p).is_err() {
        return Err(format!("not a git repository: {path}"));
    }

    persist::add_repo(&dir, p).map_err(|e| e.to_string())
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
fn publish_repo_branch(path: String) -> Result<RepoActionResult, String> {
    opencherry_repo::publish_branch(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn sync_repo_changes(path: String) -> Result<RepoActionResult, String> {
    opencherry_repo::sync_changes(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_agents() -> Vec<DetectedAgent> {
    opencherry_agents::detect_running_agents()
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
            commit_repo,
            commit_all_repo,
            stage_repo_file,
            unstage_repo_file,
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
