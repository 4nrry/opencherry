//! Config persistence for OpenCherry.
//!
//! SQLite-backed storage in the platform app config dir. A one-time import
//! from the Sprint 1 `repos.json` keeps local development data intact.

use opencherry_core::{AgentDefinition, Preferences, RepoId, RepoRef, Theme, TrackedTargetKind};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const DB_FILE_NAME: &str = "opencherry.db";
const LEGACY_CONFIG_FILE_NAME: &str = "repos.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LegacyConfigFile {
    repos: Vec<LegacyRepoRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LegacyRepoRef {
    id: RepoId,
    path: PathBuf,
    display_name: String,
    kind: Option<TrackedTargetKind>,
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

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS custom_themes (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            json TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS agent_definitions (
            id TEXT PRIMARY KEY NOT NULL,
            kind_json TEXT NOT NULL,
            display_name TEXT NOT NULL,
            rules_json TEXT NOT NULL,
            is_builtin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TRIGGER IF NOT EXISTS agent_definitions_set_updated_at
        AFTER UPDATE ON agent_definitions
        FOR EACH ROW
        BEGIN
            UPDATE agent_definitions SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
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
                kind_to_str(&repo.kind.unwrap_or(TrackedTargetKind::Repo)),
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
pub fn add_repo(
    config_dir: &Path,
    path: &Path,
    kind: TrackedTargetKind,
) -> anyhow::Result<RepoRef> {
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

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

const PREFERENCES_KEY: &str = "preferences";

/// Read the persisted user preferences. Returns `Preferences::default()` when
/// no value has been saved yet.
pub fn get_preferences(config_dir: &Path) -> anyhow::Result<Preferences> {
    let conn = open(config_dir)?;
    let result: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![PREFERENCES_KEY],
            |row| row.get(0),
        )
        .optional()?;

    match result {
        Some(json) => Ok(serde_json::from_str(&json)?),
        None => Ok(Preferences::default()),
    }
}

/// Persist user preferences, overwriting any previously saved value.
pub fn set_preferences(config_dir: &Path, prefs: &Preferences) -> anyhow::Result<()> {
    let conn = open(config_dir)?;
    let json = serde_json::to_string(prefs)?;
    conn.execute(
        r#"
        INSERT INTO settings (key, value)
        VALUES (?1, ?2)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        "#,
        params![PREFERENCES_KEY, json],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Custom themes
// ---------------------------------------------------------------------------

/// Return all custom themes stored by the user.
pub fn list_custom_themes(config_dir: &Path) -> anyhow::Result<Vec<Theme>> {
    let conn = open(config_dir)?;
    let mut stmt = conn.prepare(
        r#"
        SELECT json
        FROM custom_themes
        ORDER BY created_at, id
        "#,
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;

    let mut themes = Vec::new();
    for row in rows {
        let json = row?;
        let theme: Theme = serde_json::from_str(&json)?;
        themes.push(theme);
    }
    Ok(themes)
}

/// Insert or replace a custom theme. The full `Theme` value is serialised into
/// the `json` column so the caller can reconstruct it without extra queries.
pub fn insert_custom_theme(config_dir: &Path, theme: &Theme) -> anyhow::Result<()> {
    let conn = open(config_dir)?;
    let json = serde_json::to_string(theme)?;
    conn.execute(
        r#"
        INSERT INTO custom_themes (id, name, json) VALUES (?1, ?2, ?3)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, json = excluded.json
        "#,
        params![theme.id, theme.name, json],
    )?;
    Ok(())
}

/// Delete a custom theme by id. Returns `true` if a row was deleted.
pub fn remove_custom_theme(config_dir: &Path, id: &str) -> anyhow::Result<bool> {
    let conn = open(config_dir)?;
    let changed = conn.execute("DELETE FROM custom_themes WHERE id = ?1", params![id])?;
    Ok(changed > 0)
}

// ---------------------------------------------------------------------------
// Agent definitions
// ---------------------------------------------------------------------------

/// Return all agent definitions stored in the database.
pub fn list_agent_definitions(config_dir: &Path) -> anyhow::Result<Vec<AgentDefinition>> {
    let conn = open(config_dir)?;
    let mut stmt = conn.prepare(
        r#"
        SELECT id, kind_json, display_name, rules_json, is_builtin
        FROM agent_definitions
        ORDER BY is_builtin DESC, display_name COLLATE NOCASE
        "#,
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i32>(4)? != 0,
        ))
    })?;

    let mut defs = Vec::new();
    for row in rows {
        let (id, kind_json, display_name, rules_json, is_builtin) = row?;
        defs.push(AgentDefinition {
            id,
            kind: serde_json::from_str(&kind_json)?,
            display_name,
            rules: serde_json::from_str(&rules_json)?,
            is_builtin,
        });
    }
    Ok(defs)
}

/// Insert or replace an agent definition.
pub fn upsert_agent_definition(config_dir: &Path, def: &AgentDefinition) -> anyhow::Result<()> {
    let conn = open(config_dir)?;
    upsert_agent_definition_with_conn(&conn, def)
}

/// Sync agent rules from a URL.
pub fn sync_agent_rules(config_dir: &Path, url: &str) -> anyhow::Result<usize> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs();
    let target = if url.contains('?') {
        format!("{}&v={}", url, now)
    } else {
        format!("{}?v={}", url, now)
    };

    tracing::info!("Syncing agent rules from {}", target);
    let response = ureq::get(&target).call()?;
    let new_defs: Vec<AgentDefinition> = response.into_json()?;
    tracing::info!("Fetched {} definitions from remote", new_defs.len());
    
    let conn = open(config_dir)?;
    let mut count = 0;
    for def in new_defs {
        tracing::debug!("Upserting definition: {}", def.id);
        upsert_agent_definition_with_conn(&conn, &def)?;
        count += 1;
    }
    tracing::info!("Successfully synced {} definitions", count);
    Ok(count)
}

fn upsert_agent_definition_with_conn(conn: &Connection, def: &AgentDefinition) -> anyhow::Result<()> {
    let kind_json = serde_json::to_string(&def.kind)?;
    let rules_json = serde_json::to_string(&def.rules)?;
    conn.execute(
        r#"
        INSERT INTO agent_definitions (id, kind_json, display_name, rules_json, is_builtin)
        VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(id) DO UPDATE SET 
            kind_json = excluded.kind_json,
            display_name = excluded.display_name,
            rules_json = excluded.rules_json,
            is_builtin = excluded.is_builtin
        "#,
        params![def.id, kind_json, def.display_name, rules_json, if def.is_builtin { 1 } else { 0 }],
    )?;
    Ok(())
}

/// Remove an agent definition by id.
pub fn remove_agent_definition(config_dir: &Path, id: &str) -> anyhow::Result<bool> {
    let conn = open(config_dir)?;
    let changed = conn.execute("DELETE FROM agent_definitions WHERE id = ?1", params![id])?;
    Ok(changed > 0)
}


/// Seed the database with default rules from a JSON string.
pub fn seed_default_rules(config_dir: &Path, json: &str) -> anyhow::Result<()> {
    let defs: Vec<AgentDefinition> = serde_json::from_str(json)?;
    for def in defs {
        upsert_agent_definition(config_dir, &def)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    use opencherry_core::{AgentKind, AgentRule};
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
                repos: vec![
                    LegacyRepoRef {
                        id: legacy_repo.id.clone(),
                        path: legacy_repo.path.clone(),
                        display_name: legacy_repo.display_name.clone(),
                        kind: Some(legacy_repo.kind.clone()),
                    },
                    LegacyRepoRef {
                        id: legacy_repo.id.clone(),
                        path: legacy_repo.path.clone(),
                        display_name: legacy_repo.display_name.clone(),
                        kind: Some(legacy_repo.kind.clone()),
                    },
                ],
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
                repos: vec![LegacyRepoRef {
                    id: legacy_group.id,
                    path: legacy_group.path,
                    display_name: legacy_group.display_name,
                    kind: Some(legacy_group.kind),
                }],
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
                repos: vec![LegacyRepoRef {
                    id: legacy_repo.id.clone(),
                    path: legacy_repo.path.clone(),
                    display_name: legacy_repo.display_name.clone(),
                    kind: Some(legacy_repo.kind.clone()),
                }],
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

    // -----------------------------------------------------------------------
    // Preferences tests
    // -----------------------------------------------------------------------

    #[test]
    fn get_preferences_returns_default_when_absent() {
        let config_dir = TestDir::new("prefs-default");
        let prefs = get_preferences(config_dir.path()).unwrap();
        let expected = Preferences::default();
        assert_eq!(prefs.theme_id, expected.theme_id);
        assert_eq!(prefs.color_scheme, expected.color_scheme);
        assert_eq!(prefs.ui_font, expected.ui_font);
        assert_eq!(prefs.mono_font, expected.mono_font);
    }

    #[test]
    fn set_and_get_preferences_round_trips() {
        use opencherry_core::{ColorScheme, FontPref};
        let config_dir = TestDir::new("prefs-round-trip");

        let custom = Preferences {
            theme_id: "my-theme".to_string(),
            color_scheme: ColorScheme::Dark,
            ui_font: FontPref {
                family: "Inter".to_string(),
                size_px: 16,
            },
            mono_font: FontPref {
                family: "JetBrains Mono".to_string(),
                size_px: 14,
            },
        };

        set_preferences(config_dir.path(), &custom).unwrap();
        let retrieved = get_preferences(config_dir.path()).unwrap();

        assert_eq!(retrieved.theme_id, custom.theme_id);
        assert_eq!(retrieved.color_scheme, custom.color_scheme);
        assert_eq!(retrieved.ui_font, custom.ui_font);
        assert_eq!(retrieved.mono_font, custom.mono_font);
    }

    #[test]
    fn set_preferences_overwrites_previous_value() {
        use opencherry_core::ColorScheme;
        let config_dir = TestDir::new("prefs-overwrite");

        let first = Preferences {
            theme_id: "theme-a".to_string(),
            color_scheme: ColorScheme::Light,
            ..Preferences::default()
        };
        set_preferences(config_dir.path(), &first).unwrap();

        let second = Preferences {
            theme_id: "theme-b".to_string(),
            color_scheme: ColorScheme::Dark,
            ..Preferences::default()
        };
        set_preferences(config_dir.path(), &second).unwrap();

        let result = get_preferences(config_dir.path()).unwrap();
        assert_eq!(result.theme_id, "theme-b");
        assert_eq!(result.color_scheme, ColorScheme::Dark);
    }

    // -----------------------------------------------------------------------
    // Custom theme tests
    // -----------------------------------------------------------------------

    fn sample_theme(id: &str, name: &str) -> Theme {
        use opencherry_core::ThemeModes;
        use std::collections::BTreeMap;
        Theme {
            id: id.to_string(),
            name: name.to_string(),
            modes: ThemeModes {
                light: BTreeMap::from([
                    ("--bg".to_string(), "#ffffff".to_string()),
                    ("--fg".to_string(), "#000000".to_string()),
                ]),
                dark: BTreeMap::from([
                    ("--bg".to_string(), "#000000".to_string()),
                    ("--fg".to_string(), "#ffffff".to_string()),
                ]),
            },
        }
    }

    #[test]
    fn insert_and_list_custom_themes() {
        let config_dir = TestDir::new("themes-list");
        let theme_a = sample_theme("alpha", "Alpha Theme");
        let theme_b = sample_theme("beta", "Beta Theme");

        insert_custom_theme(config_dir.path(), &theme_a).unwrap();
        insert_custom_theme(config_dir.path(), &theme_b).unwrap();

        let themes = list_custom_themes(config_dir.path()).unwrap();
        assert_eq!(themes.len(), 2);
        assert!(themes
            .iter()
            .any(|t| t.id == "alpha" && t.name == "Alpha Theme"));
        assert!(themes
            .iter()
            .any(|t| t.id == "beta" && t.name == "Beta Theme"));
    }

    #[test]
    fn list_custom_themes_empty_when_none_inserted() {
        let config_dir = TestDir::new("themes-empty");
        let themes = list_custom_themes(config_dir.path()).unwrap();
        assert!(themes.is_empty());
    }

    #[test]
    fn insert_custom_theme_replaces_on_duplicate_id() {
        let config_dir = TestDir::new("themes-replace");

        let original = sample_theme("dup-id", "Original Name");
        insert_custom_theme(config_dir.path(), &original).unwrap();

        let replacement = sample_theme("dup-id", "Replaced Name");
        insert_custom_theme(config_dir.path(), &replacement).unwrap();

        let themes = list_custom_themes(config_dir.path()).unwrap();
        assert_eq!(themes.len(), 1);
        assert_eq!(themes[0].name, "Replaced Name");
    }

    #[test]
    fn insert_custom_theme_update_preserves_created_at() {
        let config_dir = TestDir::new("themes-preserve-created-at");

        let original = sample_theme("stable-id", "Original Name");
        insert_custom_theme(config_dir.path(), &original).unwrap();

        // Read the created_at from the DB before the update.
        let conn = Connection::open(db_path(config_dir.path())).unwrap();
        let created_at_before: String = conn
            .query_row(
                "SELECT created_at FROM custom_themes WHERE id = 'stable-id'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        drop(conn);

        let replacement = sample_theme("stable-id", "Updated Name");
        insert_custom_theme(config_dir.path(), &replacement).unwrap();

        let conn = Connection::open(db_path(config_dir.path())).unwrap();
        let created_at_after: String = conn
            .query_row(
                "SELECT created_at FROM custom_themes WHERE id = 'stable-id'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        drop(conn);

        // The update must not reset created_at.
        assert_eq!(
            created_at_before, created_at_after,
            "update must preserve the original created_at"
        );

        let themes = list_custom_themes(config_dir.path()).unwrap();
        assert_eq!(themes.len(), 1);
        assert_eq!(themes[0].name, "Updated Name");
    }

    #[test]
    fn remove_custom_theme_returns_true_when_deleted() {
        let config_dir = TestDir::new("themes-remove-exists");
        let theme = sample_theme("remove-me", "To Remove");
        insert_custom_theme(config_dir.path(), &theme).unwrap();

        let removed = remove_custom_theme(config_dir.path(), "remove-me").unwrap();
        assert!(removed);

        let themes = list_custom_themes(config_dir.path()).unwrap();
        assert!(themes.is_empty());
    }

    #[test]
    fn remove_custom_theme_returns_false_when_not_found() {
        let config_dir = TestDir::new("themes-remove-missing");
        let removed = remove_custom_theme(config_dir.path(), "ghost-id").unwrap();
        assert!(!removed);
    }

    #[test]
    fn imports_legacy_json_without_kind_as_repo() {
        let config_dir = TestDir::new("persistence-legacy-missing-kind-config");
        let repos_root = TestDir::new("persistence-legacy-missing-kind-repos");
        let repo_dir = repos_root.path().join("legacy-no-kind");
        fs::create_dir_all(&repo_dir).unwrap();
        let canonical = repo_dir.canonicalize().unwrap();

        fs::write(
            legacy_config_file_path(config_dir.path()),
            serde_json::json!({
                "repos": [
                    {
                        "id": RepoId::from_path(&canonical).0,
                        "path": canonical,
                        "display_name": "legacy-no-kind"
                    }
                ]
            })
            .to_string(),
        )
        .unwrap();

        let repos = list_repos(config_dir.path()).unwrap();
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].display_name, "legacy-no-kind");
        assert_eq!(repos[0].kind, TrackedTargetKind::Repo);
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
            params![
                "legacy-repo",
                legacy_repo_path.to_string_lossy().to_string(),
                "legacy-repo"
            ],
        )
        .unwrap();
        drop(db);

        let repos = list_repos(config_dir.path()).unwrap();
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].display_name, "legacy-repo");
        assert_eq!(repos[0].kind, TrackedTargetKind::Repo);

        let added_group =
            add_repo(config_dir.path(), &group_dir, TrackedTargetKind::Group).unwrap();
        assert_eq!(added_group.kind, TrackedTargetKind::Group);

        let repos = list_repos(config_dir.path()).unwrap();
        assert_eq!(repos.len(), 2);
        assert!(
            repos
                .iter()
                .any(|repo| repo.display_name == "legacy-repo"
                    && repo.kind == TrackedTargetKind::Repo)
        );
        assert!(repos
            .iter()
            .any(|repo| repo.display_name == "workspace-group"
                && repo.kind == TrackedTargetKind::Group));
    }

    #[test]
    fn add_list_and_remove_agent_definitions() {
        let dir = TestDir::new("persistence-agents");
        let config = dir.path();

        let def = AgentDefinition {
            id: "test-agent".into(),
            kind: AgentKind::Custom("Test".into()),
            display_name: "Test Agent".into(),
            is_builtin: false,
            rules: vec![AgentRule {
                exe_basename: Some("test".into()),
                exe_path_contains: None,
                argv_contains: None,
                exclude_path_contains: None,
                require_shell_parent: true,
            }],
        };

        upsert_agent_definition(config, &def).unwrap();
        let list = list_agent_definitions(config).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "test-agent");
        assert_eq!(list[0].rules.len(), 1);
        assert!(list[0].rules[0].require_shell_parent);

        remove_agent_definition(config, "test-agent").unwrap();
        let list = list_agent_definitions(config).unwrap();
        assert_eq!(list.len(), 0);
    }
}
