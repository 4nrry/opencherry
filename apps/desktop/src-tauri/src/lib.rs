//! OpenCherry desktop entry point.
//!
//! Sprint 0 v2: bootstrap Tauri 2 + SolidJS shell. A single `ping` command
//! wired through `invoke()` validates the IPC bridge end-to-end. Real
//! commands (list_repos, repo_status, list_agents, ...) land in Sprint 1.

use serde::Serialize;

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
        .invoke_handler(tauri::generate_handler![ping])
        .run(tauri::generate_context!())
        .expect("error while running OpenCherry desktop");
}
