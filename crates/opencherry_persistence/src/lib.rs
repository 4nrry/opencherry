//! Config persistence for OpenCherry.
//!
//! SQLite-backed storage in the platform app config dir. A one-time import
//! from the Sprint 1 `repos.json` keeps local development data intact.

use opencherry_core::{RepoId, RepoRef, TrackedTargetKind};
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
            kind TEXT NOT NULL DEFAULT 'repo',
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

    if !repos_has_column(conn, "kind")? {
        conn.execute(
            "ALTER TABLE repos ADD COLUMN kind TEXT NOT NULL DEFAULT 'repo'",
            [],
        )?;
    }

    Ok(())
}

fn repos_has_column(conn: &Connection, column_name: &str) -> anyhow::Result<bool> {
    let mut stmt = conn.prepare("PRAGMA table_info(repos)")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;

    for row in rows {
        if row? == column_name {
            return Ok(true);
        }
    }

    Ok(false)
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
            INSERT OR IGNORE INTO repos (id, path, display_name, kind)
            VALUES (?1, ?2, ?3, ?4)
            "#,
            params![
                repo.id.0,
                repo.path.to_string_lossy(),
                repo.display_name,
                kind_to_str(&repo.kind),
            ],
        )?;
    }

    std::fs::remove_file(&path)?;
    Ok(())
}

pub fn list_repos(config_dir: &Path) -> anyhow::Result<Vec<RepoRef>> {
    let conn = open(config_dir)?;
    let mut stmt = conn.prepare(
        r#"
        SELECT id, path, display_name
             , kind
        FROM repos
        ORDER BY display_name COLLATE NOCASE, path COLLATE NOCASE
        "#,
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(RepoRef {
            id: RepoId(row.get(0)?),
            path: PathBuf::from(row.get::<_, String>(1)?),
            display_name: row.get(2)?,
            kind: parse_kind(&row.get::<_, String>(3)?),
        })
    })?;

    let mut repos = Vec::new();
    for row in rows {
        repos.push(row?);
    }
    Ok(repos)
}

/// Add a tracked target by canonical path. Idempotent: if a target with the
/// same id already exists, returns the existing entry without touching disk.
pub fn add_repo(config_dir: &Path, path: &Path, kind: TrackedTargetKind) -> anyhow::Result<RepoRef> {
    let canonical = path.canonicalize()?;
    let id = RepoId::from_path(&canonical);
    let display_name = canonical
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| canonical.to_string_lossy().into_owned());
    let path_string = canonical.to_string_lossy().into_owned();
    let kind_string = kind_to_str(&kind);

    let conn = open(config_dir)?;
    conn.execute(
        r#"
        INSERT OR IGNORE INTO repos (id, path, display_name, kind)
        VALUES (?1, ?2, ?3, ?4)
        "#,
        params![id.0, path_string, display_name, kind_string],
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
        SELECT id, path, display_name, kind
        FROM repos
        WHERE id = ?1
        "#,
        params![id.0],
        |row| {
            Ok(RepoRef {
                id: RepoId(row.get(0)?),
                path: PathBuf::from(row.get::<_, String>(1)?),
                display_name: row.get(2)?,
                kind: parse_kind(&row.get::<_, String>(3)?),
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

fn kind_to_str(kind: &TrackedTargetKind) -> &'static str {
    match kind {
        TrackedTargetKind::Repo => "repo",
        TrackedTargetKind::Group => "group",
    }
}

fn parse_kind(kind: &str) -> TrackedTargetKind {
    match kind {
        "group" => TrackedTargetKind::Group,
        _ => TrackedTargetKind::Repo,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        path::{Path, PathBuf},
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

    #[test]
    fn add_list_and_remove_repos() {
        let config_dir = TestDir::new("persistence-config");
        let repos_root = TestDir::new("persistence-repos");
        let repo_a = repos_root.path().join("alpha");
        let repo_b = repos_root.path().join("beta");
        fs::create_dir_all(&repo_a).unwrap();
        fs::create_dir_all(&repo_b).unwrap();

        let added_b = add_repo(config_dir.path(), &repo_b, TrackedTargetKind::Repo).unwrap();
        let added_a = add_repo(config_dir.path(), &repo_a, TrackedTargetKind::Group).unwrap();

        let repos = list_repos(config_dir.path()).unwrap();
        assert_eq!(repos.len(), 2);
        assert_eq!(repos[0].display_name, "alpha");
        assert_eq!(repos[1].display_name, "beta");
        assert_eq!(repos[0].path, repo_a.canonicalize().unwrap());
        assert_eq!(repos[1].path, repo_b.canonicalize().unwrap());
        assert_eq!(repos[0].kind, TrackedTargetKind::Group);
        assert_eq!(repos[1].kind, TrackedTargetKind::Repo);

        assert!(remove_repo(config_dir.path(), &added_b.id).unwrap());
        assert!(!remove_repo(config_dir.path(), &added_b.id).unwrap());

        let remaining = list_repos(config_dir.path()).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id.0, added_a.id.0);
    }

    #[test]
    fn imports_legacy_json_once_and_ignores_duplicates() {
        let config_dir = TestDir::new("persistence-legacy-config");
        let repos_root = TestDir::new("persistence-legacy-repos");
        let repo_dir = repos_root.path().join("legacy-repo");
        fs::create_dir_all(&repo_dir).unwrap();
        let canonical = repo_dir.canonicalize().unwrap();

        let legacy_repo = RepoRef {
            id: RepoId::from_path(&canonical),
            path: canonical.clone(),
            display_name: "legacy-repo".to_string(),
            kind: TrackedTargetKind::Repo,
        };
        fs::write(
            legacy_config_file_path(config_dir.path()),
            serde_json::to_vec(&LegacyConfigFile {
                repos: vec![legacy_repo.clone(), legacy_repo.clone()],
            })
            .unwrap(),
        )
        .unwrap();

        let first = list_repos(config_dir.path()).unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].id.0, legacy_repo.id.0);
        assert_eq!(first[0].path, legacy_repo.path);

        let second = list_repos(config_dir.path()).unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].display_name, "legacy-repo");
        assert_eq!(second[0].kind, TrackedTargetKind::Repo);
    }

    #[test]
    fn imports_legacy_json_kind_when_present() {
        let config_dir = TestDir::new("persistence-legacy-kind-config");
        let repos_root = TestDir::new("persistence-legacy-kind-repos");
        let group_dir = repos_root.path().join("workspace-group");
        fs::create_dir_all(&group_dir).unwrap();
        let canonical = group_dir.canonicalize().unwrap();

        let legacy_group = RepoRef {
            id: RepoId("group-1".to_string()),
            path: canonical.clone(),
            display_name: "workspace-group".to_string(),
            kind: TrackedTargetKind::Group,
        };
        fs::write(
            legacy_config_file_path(config_dir.path()),
            serde_json::to_vec(&LegacyConfigFile {
                repos: vec![legacy_group],
            })
            .unwrap(),
        )
        .unwrap();

        let repos = list_repos(config_dir.path()).unwrap();
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].display_name, "workspace-group");
        assert_eq!(repos[0].kind, TrackedTargetKind::Group);
    }

    #[test]
    fn removing_imported_repo_does_not_reimport_it() {
        let config_dir = TestDir::new("persistence-legacy-remove-config");
        let repos_root = TestDir::new("persistence-legacy-remove-repos");
        let repo_dir = repos_root.path().join("legacy-removable");
        fs::create_dir_all(&repo_dir).unwrap();
        let canonical = repo_dir.canonicalize().unwrap();

        let legacy_repo = RepoRef {
            id: RepoId::from_path(&canonical),
            path: canonical,
            display_name: "legacy-removable".to_string(),
            kind: TrackedTargetKind::Repo,
        };
        fs::write(
            legacy_config_file_path(config_dir.path()),
            serde_json::to_vec(&LegacyConfigFile {
                repos: vec![legacy_repo.clone()],
            })
            .unwrap(),
        )
        .unwrap();

        let imported = list_repos(config_dir.path()).unwrap();
        assert_eq!(imported.len(), 1);
        assert!(!legacy_config_file_path(config_dir.path()).exists());

        assert!(remove_repo(config_dir.path(), &legacy_repo.id).unwrap());
        let repos = list_repos(config_dir.path()).unwrap();
        assert!(repos.is_empty());
    }

    #[test]
    fn migrates_existing_repos_table_to_add_kind_column() {
        let config_dir = TestDir::new("persistence-migrate-kind-config");
        let repos_root = TestDir::new("persistence-migrate-kind-repos");
        let legacy_repo_dir = repos_root.path().join("legacy-repo");
        let group_dir = repos_root.path().join("workspace-group");
        fs::create_dir_all(&legacy_repo_dir).unwrap();
        fs::create_dir_all(&group_dir).unwrap();

        let legacy_repo_path = legacy_repo_dir.canonicalize().unwrap();
        let db = Connection::open(db_path(config_dir.path())).unwrap();
        db.execute_batch(
            r#"
            CREATE TABLE repos (
                id TEXT PRIMARY KEY NOT NULL,
                path TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            "#,
        )
        .unwrap();
        db.execute(
            "INSERT INTO repos (id, path, display_name) VALUES (?1, ?2, ?3)",
            params!["legacy-repo", legacy_repo_path.to_string_lossy().to_string(), "legacy-repo"],
        )
        .unwrap();
        drop(db);

        let repos = list_repos(config_dir.path()).unwrap();
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].display_name, "legacy-repo");
        assert_eq!(repos[0].kind, TrackedTargetKind::Repo);

        let added_group = add_repo(config_dir.path(), &group_dir, TrackedTargetKind::Group).unwrap();
        assert_eq!(added_group.kind, TrackedTargetKind::Group);

        let repos = list_repos(config_dir.path()).unwrap();
        assert_eq!(repos.len(), 2);
        assert!(repos.iter().any(|repo| repo.display_name == "legacy-repo" && repo.kind == TrackedTargetKind::Repo));
        assert!(repos.iter().any(|repo| repo.display_name == "workspace-group" && repo.kind == TrackedTargetKind::Group));
    }
}
