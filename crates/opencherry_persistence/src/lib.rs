//! Config persistence for OpenCherry.
//!
//! SQLite-backed storage in the platform app config dir. A one-time import
//! from the Sprint 1 `repos.json` keeps local development data intact.

use opencherry_core::{RepoId, RepoRef};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const DB_FILE_NAME: &str = "opencherry.db";
const LEGACY_CONFIG_FILE_NAME: &str = "repos.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LegacyConfigFile {
    repos: Vec<RepoRef>,
}

pub fn db_path(config_dir: &Path) -> PathBuf {
    config_dir.join(DB_FILE_NAME)
}

fn legacy_config_file_path(config_dir: &Path) -> PathBuf {
    config_dir.join(LEGACY_CONFIG_FILE_NAME)
}

fn open(config_dir: &Path) -> anyhow::Result<Connection> {
    std::fs::create_dir_all(config_dir)?;
    let conn = Connection::open(db_path(config_dir))?;
    migrate(&conn)?;
    import_legacy_json(config_dir, &conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> anyhow::Result<()> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS repos (
            id TEXT PRIMARY KEY NOT NULL,
            path TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TRIGGER IF NOT EXISTS repos_set_updated_at
        AFTER UPDATE ON repos
        FOR EACH ROW
        BEGIN
            UPDATE repos SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
        END;
        "#,
    )?;
    Ok(())
}

fn import_legacy_json(config_dir: &Path, conn: &Connection) -> anyhow::Result<()> {
    let path = legacy_config_file_path(config_dir);
    if !path.exists() {
        return Ok(());
    }

    let bytes = std::fs::read(&path)?;
    let cfg: LegacyConfigFile = serde_json::from_slice(&bytes)?;
    for repo in cfg.repos {
        conn.execute(
            r#"
            INSERT OR IGNORE INTO repos (id, path, display_name)
            VALUES (?1, ?2, ?3)
            "#,
            params![repo.id.0, repo.path.to_string_lossy(), repo.display_name],
        )?;
    }
    Ok(())
}

pub fn list_repos(config_dir: &Path) -> anyhow::Result<Vec<RepoRef>> {
    let conn = open(config_dir)?;
    let mut stmt = conn.prepare(
        r#"
        SELECT id, path, display_name
        FROM repos
        ORDER BY display_name COLLATE NOCASE, path COLLATE NOCASE
        "#,
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(RepoRef {
            id: RepoId(row.get(0)?),
            path: PathBuf::from(row.get::<_, String>(1)?),
            display_name: row.get(2)?,
        })
    })?;

    let mut repos = Vec::new();
    for row in rows {
        repos.push(row?);
    }
    Ok(repos)
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
    let path_string = canonical.to_string_lossy().into_owned();

    let conn = open(config_dir)?;
    conn.execute(
        r#"
        INSERT OR IGNORE INTO repos (id, path, display_name)
        VALUES (?1, ?2, ?3)
        "#,
        params![id.0, path_string, display_name],
    )?;

    get_repo(&conn, &id)?.ok_or_else(|| anyhow::anyhow!("repo insert failed: {}", id.0))
}

/// Remove a repo by id. Returns true if it existed.
pub fn remove_repo(config_dir: &Path, id: &RepoId) -> anyhow::Result<bool> {
    let conn = open(config_dir)?;
    let changed = conn.execute("DELETE FROM repos WHERE id = ?1", params![id.0])?;
    Ok(changed > 0)
}

fn get_repo(conn: &Connection, id: &RepoId) -> anyhow::Result<Option<RepoRef>> {
    conn.query_row(
        r#"
        SELECT id, path, display_name
        FROM repos
        WHERE id = ?1
        "#,
        params![id.0],
        |row| {
            Ok(RepoRef {
                id: RepoId(row.get(0)?),
                path: PathBuf::from(row.get::<_, String>(1)?),
                display_name: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}
