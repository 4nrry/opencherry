//! Config persistence for OpenCherry.
//!
//! Sprint 1: simple JSON file at a caller-provided path (Tauri resolves
//! the platform-appropriate config dir before calling). Will migrate to
//! rusqlite in Sprint 2 once we have schema needs beyond a flat list.

use opencherry_core::{RepoId, RepoRef};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const CONFIG_FILE_NAME: &str = "repos.json";
const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigFile {
    pub schema_version: u32,
    pub repos: Vec<RepoRef>,
}

impl Default for ConfigFile {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            repos: Vec::new(),
        }
    }
}

/// Resolve the full file path inside `config_dir`.
pub fn config_file_path(config_dir: &Path) -> PathBuf {
    config_dir.join(CONFIG_FILE_NAME)
}

/// Load the config file, returning an empty default if it doesn't exist.
pub fn load(config_dir: &Path) -> anyhow::Result<ConfigFile> {
    let path = config_file_path(config_dir);
    if !path.exists() {
        return Ok(ConfigFile::default());
    }
    let bytes = std::fs::read(&path)?;
    let cfg: ConfigFile = serde_json::from_slice(&bytes)?;
    Ok(cfg)
}

/// Persist the config file, creating the directory if needed.
pub fn save(config_dir: &Path, cfg: &ConfigFile) -> anyhow::Result<()> {
    std::fs::create_dir_all(config_dir)?;
    let path = config_file_path(config_dir);
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(cfg)?;
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

/// Add a repo by canonical path. Idempotent: if a repo with the same
/// id already exists, returns the existing entry without touching disk.
pub fn add_repo(config_dir: &Path, path: &Path) -> anyhow::Result<RepoRef> {
    let canonical = path.canonicalize()?;
    let id = RepoId::from_path(&canonical);
    let display_name = canonical
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| canonical.to_string_lossy().into_owned());

    let mut cfg = load(config_dir)?;
    if let Some(existing) = cfg.repos.iter().find(|r| r.id == id) {
        return Ok(existing.clone());
    }
    let entry = RepoRef {
        id: id.clone(),
        path: canonical,
        display_name,
    };
    cfg.repos.push(entry.clone());
    save(config_dir, &cfg)?;
    Ok(entry)
}

/// Remove a repo by id. Returns true if it existed.
pub fn remove_repo(config_dir: &Path, id: &RepoId) -> anyhow::Result<bool> {
    let mut cfg = load(config_dir)?;
    let before = cfg.repos.len();
    cfg.repos.retain(|r| &r.id != id);
    let removed = cfg.repos.len() < before;
    if removed {
        save(config_dir, &cfg)?;
    }
    Ok(removed)
}
