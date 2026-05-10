//! OpenCherry — multi-repo, multi-agent control tower.
//!
//! Sprint 0 placeholder. Real entry point will bootstrap GPUI in task #1
//! of the spike (window + repo card + sysinfo agent list).

use std::path::PathBuf;

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    tracing::info!("OpenCherry v{} bootstrapping (placeholder)", env!("CARGO_PKG_VERSION"));

    // Smoke test: try to read HEAD of CWD if it happens to be a git repo.
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    match opencherry_repo::head_short_id(&cwd) {
        Ok(oid) => tracing::info!(repo = %cwd.display(), head = %oid, "git smoke test OK"),
        Err(e) => tracing::info!(repo = %cwd.display(), error = %e, "no git repo at cwd (expected during bootstrap)"),
    }

    Ok(())
}
