//! OpenCherry desktop entry point.
//!
//! Sprint 1: real Tauri commands for repo registration, status, and
//! agent detection. Persistence lives in the platform app config dir.

use opencherry_agents::DetectedAgent;
use opencherry_core::{
    CommitResult, Preferences, RepoActionResult, RepoDiff, RepoGroupSnapshot, RepoId, RepoRef,
    RepoStatus, Theme, TrackedTargetKind,
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
        Err(format!(
            "path does not exist or is unsupported: {}",
            path.display()
        ))
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
fn discard_repo_files(
    path: String,
    relative_paths: Vec<String>,
) -> Result<opencherry_repo::DiscardOutcome, String> {
    let refs: Vec<&str> = relative_paths.iter().map(String::as_str).collect();
    opencherry_repo::discard_files(Path::new(&path), &refs).map_err(|e| e.to_string())
}

#[tauri::command]
fn publish_repo_branch(path: String) -> Result<RepoActionResult, String> {
    opencherry_repo::publish_branch(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn sync_repo_changes(path: String) -> Result<RepoActionResult, String> {
    opencherry_repo::sync_changes(Path::new(&path)).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Theme + preferences commands
// ---------------------------------------------------------------------------

/// IDs that are reserved for built-in themes shipped with the application.
/// A custom theme whose id matches one of these is rejected at import time
/// because the built-in would shadow it, making it unreachable and
/// unremovable through the UI.
const BUILTIN_THEME_IDS: &[&str] = &[
    "opencherry-default",
    "dracula",
    "nord",
    "gruvbox",
    "catppuccin",
    "tokyo-night",
    "solarized",
    "one-dark",
];

#[tauri::command]
fn get_preferences(app: tauri::AppHandle) -> Result<Preferences, String> {
    let dir = config_dir(&app)?;
    persist::get_preferences(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_preferences(app: tauri::AppHandle, preferences: Preferences) -> Result<(), String> {
    let dir = config_dir(&app)?;
    persist::set_preferences(&dir, &preferences).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_custom_themes(app: tauri::AppHandle) -> Result<Vec<Theme>, String> {
    let dir = config_dir(&app)?;
    persist::list_custom_themes(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn import_theme_file(app: tauri::AppHandle, path: String) -> Result<Theme, String> {
    let json = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read theme file '{path}': {e}"))?;
    let theme: Theme = serde_json::from_str(&json).map_err(|e| {
        format!("theme file '{path}' is not valid JSON or missing required fields: {e}")
    })?;
    if BUILTIN_THEME_IDS.contains(&theme.id.as_str()) {
        return Err(format!(
            "A theme with id '{}' is built in; choose a different id.",
            theme.id
        ));
    }
    let dir = config_dir(&app)?;
    persist::insert_custom_theme(&dir, &theme).map_err(|e| e.to_string())?;
    Ok(theme)
}

#[tauri::command]
fn remove_custom_theme(app: tauri::AppHandle, id: String) -> Result<bool, String> {
    let dir = config_dir(&app)?;
    persist::remove_custom_theme(&dir, &id).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------

#[tauri::command]
fn list_agents(app: tauri::AppHandle) -> Result<Vec<DetectedAgent>, String> {
    let dir = config_dir(&app)?;
    let repos = persist::list_repos(&dir).map_err(|e| e.to_string())?;
    let defs = persist::list_agent_definitions(&dir).map_err(|e| e.to_string())?;
    Ok(opencherry_agents::correlate_agents_to_targets(
        opencherry_agents::detect_running_agents(&defs),
        &repos,
    ))
}

#[tauri::command]
fn list_agent_definitions(
    app: tauri::AppHandle,
) -> Result<Vec<opencherry_core::AgentDefinition>, String> {
    let dir = config_dir(&app)?;
    persist::list_agent_definitions(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn upsert_agent_definition(
    app: tauri::AppHandle,
    def: opencherry_core::AgentDefinition,
) -> Result<(), String> {
    let dir = config_dir(&app)?;
    persist::upsert_agent_definition(&dir, &def).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_agent_definition(app: tauri::AppHandle, id: String) -> Result<bool, String> {
    let dir = config_dir(&app)?;
    persist::remove_agent_definition(&dir, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_agent_name(app: tauri::AppHandle, id: String, name: String) -> Result<(), String> {
    let dir = config_dir(&app)?;
    let defs = persist::list_agent_definitions(&dir).map_err(|e| e.to_string())?;
    if let Some(mut def) = defs.into_iter().find(|d| d.id == id) {
        def.display_name = name.clone();
        def.kind = opencherry_core::AgentKind::Custom(name);
        persist::upsert_agent_definition(&dir, &def).map_err(|e| e.to_string())
    } else {
        Err(format!("agent definition '{id}' not found"))
    }
}

#[tauri::command]
fn sync_agent_rules(app: tauri::AppHandle, _url: Option<String>) -> Result<usize, String> {
    let dir = config_dir(&app)?;
    let defs = persist::list_agent_definitions(&dir).map_err(|e| e.to_string())?;
    Ok(defs.len())
}

#[tauri::command]
fn debug_list_processes() -> Result<serde_json::Value, String> {
    Ok(opencherry_agents::debug_dump_processes())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
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
            discard_repo_files,
            publish_repo_branch,
            sync_repo_changes,
            list_agents,
            list_agent_definitions,
            upsert_agent_definition,
            update_agent_name,
            remove_agent_definition,
            sync_agent_rules,
            debug_list_processes,
            get_preferences,
            set_preferences,
            list_custom_themes,
            import_theme_file,
            remove_custom_theme,
        ])
        .setup(|app| {
            // Eagerly create config dir so first save doesn't race.
            let dir = app
                .path()
                .app_config_dir()
                .expect("failed to resolve config dir");
            let _ = std::fs::create_dir_all(&dir);
            tracing::info!(path = %dir.display(), "config dir ready");

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
