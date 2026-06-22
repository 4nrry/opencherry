//! Agent detection and orchestration for OpenCherry.
//!
//! Sprint 1: sysinfo-based detection of running coding-agent processes.
//! Matches by executable name and known argv patterns. Heuristics will
//! be refined as we observe real users.

use opencherry_core::{
    AgentDefinition, AgentId, AgentKind, AgentRule, AgentTargetMatches, RepoRef, TrackedTargetKind,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentStatus {
    /// Process is alive but not actively burning CPU.
    Idle,
    /// Process is doing meaningful work (above CPU threshold).
    Generating,
    /// Process is suspended (e.g. via SIGSTOP or Ctrl+Z).
    Suspended,
    /// Process has exited but is still in the process table.
    Zombie,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedAgent {
    pub id: AgentId,
    pub definition_id: String,
    pub kind: AgentKind,
    pub display_name: String,
    pub pid: u32,
    /// First non-empty cwd we observed for the process, if available.
    pub cwd: Option<String>,
    /// Joined argv (best-effort, truncated for display).
    pub command_line: String,
    pub targets: AgentTargetMatches,
    /// Inferred from instantaneous CPU usage at detection time.
    pub status: AgentStatus,
    /// If this process's parent is also a detected agent, the parent's id.
    /// Lets the UI render subprocesses (e.g. claude-code chrome-native-host)
    /// as children of their primary agent.
    pub parent_id: Option<AgentId>,
}

#[derive(Debug, Clone)]
struct ProcessSnapshot {
    pid: u32,
    exe_path: String,
    exe_basename: String,
    process_name: String,
    argv: Vec<String>,
    cwd: Option<String>,
    is_thread: bool,
    /// CPU usage percentage from sysinfo (0.0-100.0 per core; can exceed 100 across cores).
    cpu_usage: f32,
    /// Parent process pid (from sysinfo). Used to link subprocesses to their primary.
    ppid: Option<u32>,
    /// Raw process status from sysinfo.
    os_status: sysinfo::ProcessStatus,
}

/// Threshold (percent of one core) above which an agent is considered Generating.
const GENERATING_CPU_THRESHOLD: f32 = 5.0;

/// Map an instantaneous CPU usage reading to an `AgentStatus`.
///
/// Stateless and pure: callers decide how the CPU sample was obtained.
pub fn classify_status(cpu_usage: f32, os_status: sysinfo::ProcessStatus) -> AgentStatus {
    match os_status {
        sysinfo::ProcessStatus::Stop => AgentStatus::Suspended,
        sysinfo::ProcessStatus::Zombie => AgentStatus::Zombie,
        _ => {
            if cpu_usage >= GENERATING_CPU_THRESHOLD {
                AgentStatus::Generating
            } else {
                AgentStatus::Idle
            }
        }
    }
}

/// Known interactive shell / terminal multiplexer process names.
///
/// Includes Unix shells plus the common Windows shells and terminals, so the
/// `require_shell_parent` heuristic works on every supported platform.
const SHELL_PROCESS_NAMES: &[&str] = &[
    // Unix shells & multiplexers
    "bash",
    "zsh",
    "fish",
    "sh",
    "dash",
    "tmux",
    "screen",
    // Windows shells & terminals
    "cmd",
    "powershell",
    "pwsh",
    "wt",
    "windowsterminal",
    "conhost",
    "nu",
];

/// Windows executable extensions to strip before comparing process names.
///
/// On Windows `sysinfo` reports basenames such as `claude.exe` / `node.exe`,
/// but agent rules are written with bare names (`claude`, `node`). Stripping
/// the extension lets the same rule set match on every platform.
const WINDOWS_EXE_SUFFIXES: &[&str] = &[".exe", ".cmd", ".bat", ".com"];

/// Return `name` without a trailing Windows executable extension (if any).
fn strip_exe_suffix(name: &str) -> &str {
    for ext in WINDOWS_EXE_SUFFIXES {
        if name.len() > ext.len() {
            let (base, suffix) = name.split_at(name.len() - ext.len());
            if suffix.eq_ignore_ascii_case(ext) {
                return base;
            }
        }
    }
    name
}

fn is_shell_process(exe_basename: &str) -> bool {
    let name = strip_exe_suffix(exe_basename);
    SHELL_PROCESS_NAMES
        .iter()
        .any(|shell| shell.eq_ignore_ascii_case(name))
}

/// Classify a process against a list of definitions.
fn classify(
    process: &ProcessSnapshot,
    all_processes: &[ProcessSnapshot],
    definitions: &[AgentDefinition],
) -> Option<AgentKind> {
    // Normalize Windows path separators so the Unix-style substrings below
    // match on every platform.
    let exe_path_lc = process.exe_path.to_ascii_lowercase().replace('\\', "/");

    // Universal exclusions (except for Antigravity CLI itself)
    if (exe_path_lc.contains("/.antigravity/extensions/")
        || exe_path_lc.contains("/usr/share/antigravity/resources/app/extensions/"))
        && !exe_path_lc.contains("/antigravity/bin/language_server")
    {
        return None;
    }

    for def in definitions {
        for rule in &def.rules {
            if matches_rule(rule, process, all_processes) {
                return Some(def.kind.clone());
            }
        }
    }

    None
}

fn matches_rule(
    rule: &AgentRule,
    process: &ProcessSnapshot,
    all_processes: &[ProcessSnapshot],
) -> bool {
    // 1. Exe basename match (extension-insensitive so `claude.exe` on Windows
    //    matches a rule written as `claude`).
    if let Some(ref target) = rule.exe_basename {
        let target = strip_exe_suffix(target);
        let basename = strip_exe_suffix(&process.exe_basename);
        let proc_name = strip_exe_suffix(&process.process_name);
        if !basename.eq_ignore_ascii_case(target) && !proc_name.eq_ignore_ascii_case(target) {
            return false;
        }
    }

    // 2. Exe path contains (separator-insensitive: rules use `/`, Windows
    //    paths use `\`).
    if let Some(ref target) = rule.exe_path_contains {
        let haystack = process.exe_path.to_ascii_lowercase().replace('\\', "/");
        let needle = target.to_ascii_lowercase().replace('\\', "/");
        if !haystack.contains(&needle) {
            return false;
        }
    }

    // 3. Argv contains
    if let Some(ref targets) = rule.argv_contains {
        let joined = process.argv.join(" ").to_ascii_lowercase();
        for target in targets {
            if !joined.contains(&target.to_ascii_lowercase()) {
                return false;
            }
        }
    }

    // 4. Exclude path contains (separator-insensitive, see rule 2).
    if let Some(ref target) = rule.exclude_path_contains {
        let haystack = process.exe_path.to_ascii_lowercase().replace('\\', "/");
        let needle = target.to_ascii_lowercase().replace('\\', "/");
        if haystack.contains(&needle) {
            return false;
        }
    }

    // 5. Shell parent check
    if rule.require_shell_parent {
        let mut parent_pid = process.ppid;
        let mut found_shell = false;
        // Check up to 3 levels of ancestry
        for _ in 0..3 {
            if let Some(ppid) = parent_pid {
                if let Some(parent) = all_processes.iter().find(|p| p.pid == ppid) {
                    if is_shell_process(&parent.exe_basename) {
                        found_shell = true;
                        break;
                    }
                    parent_pid = parent.ppid;
                } else {
                    break;
                }
            } else {
                break;
            }
        }
        if !found_shell {
            return false;
        }
    }

    true
}

/// Snapshot of currently running agent processes.
pub fn detect_running_agents(definitions: &[AgentDefinition]) -> Vec<DetectedAgent> {
    let mut sys = System::new_with_specifics(
        RefreshKind::new().with_processes(ProcessRefreshKind::everything()),
    );
    sys.refresh_processes(ProcessesToUpdate::All, true);
    std::thread::sleep(std::time::Duration::from_millis(250));
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let snapshots = sys
        .processes()
        .iter()
        .map(|(pid, proc_)| ProcessSnapshot {
            pid: pid.as_u32(),
            exe_path: proc_
                .exe()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default(),
            exe_basename: proc_
                .exe()
                .and_then(|p| p.file_name())
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default(),
            process_name: proc_.name().to_string_lossy().into_owned(),
            argv: proc_
                .cmd()
                .iter()
                .map(|s| s.to_string_lossy().into_owned())
                .collect(),
            cwd: proc_.cwd().map(|p| p.to_string_lossy().into_owned()),
            is_thread: proc_.thread_kind().is_some(),
            cpu_usage: proc_.cpu_usage(),
            ppid: proc_.parent().map(|p| p.as_u32()),
            os_status: proc_.status(),
        })
        .collect::<Vec<_>>();

    collect_detected_agents(&snapshots, definitions)
}
pub fn debug_dump_processes() -> serde_json::Value {
    let mut sys = System::new_with_specifics(
        RefreshKind::new().with_processes(ProcessRefreshKind::everything()),
    );
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let list: Vec<serde_json::Value> = sys
        .processes()
        .iter()
        .map(|(pid, p)| {
            serde_json::json!({
                "pid": pid.as_u32(),
                "name": p.name(),
                "exe": p.exe().map(|path| path.to_string_lossy()),
                "ppid": p.parent().map(|id| id.as_u32()),
                "cmd": p.cmd()
            })
        })
        .collect();
    serde_json::json!(list)
}

pub fn correlate_agents_to_targets(
    agents: Vec<DetectedAgent>,
    targets: &[RepoRef],
) -> Vec<DetectedAgent> {
    agents
        .into_iter()
        .map(|mut agent| {
            agent.targets = target_matches(agent.cwd.as_deref(), targets);
            agent
        })
        .collect()
}

fn target_matches(cwd: Option<&str>, targets: &[RepoRef]) -> AgentTargetMatches {
    let Some(cwd) = cwd else {
        return AgentTargetMatches::default();
    };
    let cwd_path = Path::new(cwd);

    let mut repos = Vec::new();
    let mut groups = Vec::new();
    for target in targets {
        if path_contains(cwd_path, &target.path) {
            match target.kind {
                TrackedTargetKind::Repo => repos.push(target.clone()),
                TrackedTargetKind::Group => groups.push(target.clone()),
            }
        }
    }

    repos.sort_by(|a, b| a.path.cmp(&b.path));
    groups.sort_by(|a, b| {
        let a_depth = a.path.components().count();
        let b_depth = b.path.components().count();
        b_depth.cmp(&a_depth).then_with(|| a.path.cmp(&b.path))
    });

    AgentTargetMatches { repos, groups }
}

fn path_contains(path: &Path, base: &PathBuf) -> bool {
    path == base || path.starts_with(base)
}

fn collect_detected_agents(
    processes: &[ProcessSnapshot],
    definitions: &[AgentDefinition],
) -> Vec<DetectedAgent> {
    let mut out = Vec::new();

    // First pass: identify all agents
    for proc in processes {
        if proc.is_thread {
            continue;
        }
        if let Some(kind) = classify(proc, processes, definitions) {
            let def = definitions.iter().find(|d| d.kind == kind).unwrap();
            let mut command_line = proc.argv.join(" ");
            if command_line.chars().count() > 200 {
                command_line = command_line.chars().take(200).collect::<String>() + "…";
            }
            out.push(DetectedAgent {
                id: AgentId(proc.pid.to_string()),
                definition_id: def.id.clone(),
                kind: kind.clone(),
                display_name: def.display_name.clone(),
                pid: proc.pid,
                cwd: proc.cwd.clone(),
                command_line,
                targets: AgentTargetMatches::default(),
                status: classify_status(proc.cpu_usage, proc.os_status),
                parent_id: None, // Will populate in second pass
            });
        }
    }

    // Second pass: link parent/child relationships
    let agent_pids: std::collections::HashSet<u32> = out.iter().map(|a| a.pid).collect();
    for agent in &mut out {
        let pid = agent.pid;
        let ppid = processes.iter().find(|p| p.pid == pid).and_then(|p| p.ppid);

        if let Some(ppid) = ppid {
            // Only link direct parent/child relationships
            if agent_pids.contains(&ppid) {
                agent.parent_id = Some(AgentId(ppid.to_string()));
            }
        }
    }

    // Stable sort by PID
    out.sort_by_key(|a| a.pid);

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(
        pid: u32,
        exe_path: &str,
        exe_basename: &str,
        argv: &[&str],
        is_thread: bool,
    ) -> ProcessSnapshot {
        snapshot_with_cpu(pid, exe_path, exe_basename, argv, is_thread, 0.0)
    }

    fn snapshot_with_cpu(
        pid: u32,
        exe_path: &str,
        exe_basename: &str,
        argv: &[&str],
        is_thread: bool,
        cpu_usage: f32,
    ) -> ProcessSnapshot {
        ProcessSnapshot {
            pid,
            exe_path: exe_path.to_string(),
            exe_basename: exe_basename.to_string(),
            process_name: exe_basename.to_string(),
            argv: argv.iter().map(|arg| arg.to_string()).collect(),
            cwd: Some("/workspace".to_string()),
            is_thread,
            cpu_usage,
            ppid: None,
            os_status: sysinfo::ProcessStatus::Run,
        }
    }

    fn snapshot_with_parent(
        pid: u32,
        ppid: Option<u32>,
        exe_path: &str,
        exe_basename: &str,
        argv: &[&str],
        is_thread: bool,
    ) -> ProcessSnapshot {
        ProcessSnapshot {
            pid,
            exe_path: exe_path.to_string(),
            exe_basename: exe_basename.to_string(),
            process_name: exe_basename.to_string(),
            argv: argv.iter().map(|arg| arg.to_string()).collect(),
            cwd: Some("/workspace".to_string()),
            is_thread,
            cpu_usage: 0.0,
            ppid,
            os_status: sysinfo::ProcessStatus::Run,
        }
    }

    fn def_opencode() -> AgentDefinition {
        AgentDefinition {
            id: "opencode".into(),
            kind: AgentKind::OpenCode,
            display_name: "OpenCode".into(),
            is_builtin: true,
            rules: vec![AgentRule {
                exe_basename: Some("opencode".into()),
                exe_path_contains: None,
                argv_contains: None,
                exclude_path_contains: None,
                require_shell_parent: false,
            }],
        }
    }

    #[test]
    fn classify_matches_by_exe_basename() {
        let defs = vec![def_opencode()];
        let proc = snapshot(123, "/usr/bin/opencode", "opencode", &["opencode"], false);
        assert_eq!(
            classify(&proc, std::slice::from_ref(&proc), &defs),
            Some(AgentKind::OpenCode)
        );
    }

    #[test]
    fn classify_matches_windows_exe_basename() {
        // On Windows sysinfo reports `opencode.exe`; a rule written as
        // `opencode` must still match.
        let defs = vec![def_opencode()];
        let proc = snapshot(
            123,
            "C:\\Users\\me\\AppData\\opencode.exe",
            "opencode.exe",
            &["opencode.exe"],
            false,
        );
        assert_eq!(
            classify(&proc, std::slice::from_ref(&proc), &defs),
            Some(AgentKind::OpenCode)
        );
    }

    #[test]
    fn is_shell_process_recognizes_windows_shells() {
        assert!(is_shell_process("powershell.exe"));
        assert!(is_shell_process("pwsh.exe"));
        assert!(is_shell_process("cmd.exe"));
        assert!(is_shell_process("bash"));
        assert!(!is_shell_process("opencode.exe"));
    }

    #[test]
    fn classify_matches_with_windows_shell_parent() {
        let mut def = def_opencode();
        def.rules[0].require_shell_parent = true;
        let defs = vec![def];

        let shell = snapshot(
            100,
            "C:\\Windows\\System32\\cmd.exe",
            "cmd.exe",
            &["cmd.exe"],
            false,
        );
        let proc = snapshot_with_parent(
            200,
            Some(100),
            "C:\\Users\\me\\opencode.exe",
            "opencode.exe",
            &["opencode.exe"],
            false,
        );
        let procs = vec![shell, proc.clone()];
        assert_eq!(classify(&proc, &procs, &defs), Some(AgentKind::OpenCode));
    }

    #[test]
    fn classify_respects_shell_parent_requirement() {
        let mut def = def_opencode();
        def.rules[0].require_shell_parent = true;
        let defs = vec![def];

        let shell = snapshot(100, "/usr/bin/zsh", "zsh", &["zsh"], false);
        let proc = snapshot_with_parent(
            200,
            Some(100),
            "/usr/bin/opencode",
            "opencode",
            &["opencode"],
            false,
        );
        let procs = vec![shell, proc.clone()];

        // Case 1: Parent is a shell
        assert_eq!(classify(&proc, &procs, &defs), Some(AgentKind::OpenCode));

        // Case 2: Parent is NOT a shell
        let not_shell = snapshot(101, "/usr/bin/init", "init", &["init"], false);
        let proc2 = snapshot_with_parent(
            201,
            Some(101),
            "/usr/bin/opencode",
            "opencode",
            &["opencode"],
            false,
        );
        let procs2 = vec![not_shell, proc2.clone()];
        assert_eq!(classify(&proc2, &procs2, &defs), None);
    }

    #[test]
    fn classify_ignores_antigravity_extensions() {
        let defs = vec![def_opencode()];
        let proc = snapshot(
            123,
            "/home/user/.antigravity/extensions/opencode/bin/opencode",
            "opencode",
            &["opencode"],
            false,
        );
        assert_eq!(classify(&proc, std::slice::from_ref(&proc), &defs), None);
    }

    #[test]
    fn correlate_agents_matches_repo_and_group_from_cwd() {
        let defs = vec![def_opencode()];
        let workspace = PathBuf::from("/workspace");
        let group = RepoRef {
            id: opencherry_core::RepoId("group:/workspace".into()),
            path: workspace.clone(),
            display_name: "workspace".into(),
            kind: TrackedTargetKind::Group,
        };
        let repo = RepoRef {
            id: opencherry_core::RepoId("repo:/workspace/app".into()),
            path: workspace.join("app"),
            display_name: "app".into(),
            kind: TrackedTargetKind::Repo,
        };
        let other_repo = RepoRef {
            id: opencherry_core::RepoId("repo:/other".into()),
            path: PathBuf::from("/other"),
            display_name: "other".into(),
            kind: TrackedTargetKind::Repo,
        };

        let agents = correlate_agents_to_targets(
            collect_detected_agents(
                &[ProcessSnapshot {
                    pid: 123,
                    exe_path: "/usr/bin/opencode".into(),
                    exe_basename: "opencode".into(),
                    process_name: "opencode".into(),
                    argv: vec!["opencode".into()],
                    cwd: Some("/workspace/app/src".into()),
                    is_thread: false,
                    cpu_usage: 0.0,
                    ppid: None,
                    os_status: sysinfo::ProcessStatus::Run,
                }],
                &defs,
            ),
            &[other_repo, repo.clone(), group.clone()],
        );

        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].targets.repos.len(), 1);
        assert_eq!(agents[0].targets.repos[0].path, repo.path);
        assert_eq!(agents[0].targets.groups.len(), 1);
        assert_eq!(agents[0].targets.groups[0].path, group.path);
    }

    #[test]
    fn correlate_agents_skips_targets_when_cwd_missing() {
        let defs = vec![def_opencode()];
        let repo = RepoRef {
            id: opencherry_core::RepoId("repo:/workspace/app".into()),
            path: PathBuf::from("/workspace/app"),
            display_name: "app".into(),
            kind: TrackedTargetKind::Repo,
        };

        let agents = correlate_agents_to_targets(
            collect_detected_agents(
                &[ProcessSnapshot {
                    pid: 123,
                    exe_path: "/usr/bin/opencode".into(),
                    exe_basename: "opencode".into(),
                    process_name: "opencode".into(),
                    argv: vec!["opencode".into()],
                    cwd: None,
                    is_thread: false,
                    cpu_usage: 0.0,
                    ppid: None,
                    os_status: sysinfo::ProcessStatus::Run,
                }],
                &defs,
            ),
            &[repo],
        );

        assert_eq!(agents.len(), 1);
        assert!(agents[0].targets.repos.is_empty());
        assert!(agents[0].targets.groups.is_empty());
    }

    #[test]
    fn classify_status_returns_idle_below_threshold() {
        assert_eq!(
            classify_status(0.0, sysinfo::ProcessStatus::Run),
            AgentStatus::Idle
        );
        assert_eq!(
            classify_status(4.9, sysinfo::ProcessStatus::Run),
            AgentStatus::Idle
        );
    }

    #[test]
    fn classify_status_returns_generating_at_or_above_threshold() {
        assert_eq!(
            classify_status(5.0, sysinfo::ProcessStatus::Run),
            AgentStatus::Generating
        );
        assert_eq!(
            classify_status(75.0, sysinfo::ProcessStatus::Run),
            AgentStatus::Generating
        );
    }

    #[test]
    fn collect_detected_agents_populates_status_from_cpu_usage() {
        let defs = vec![
            def_opencode(),
            AgentDefinition {
                id: "claude-code".into(),
                kind: AgentKind::ClaudeCode,
                display_name: "Claude Code".into(),
                is_builtin: true,
                rules: vec![AgentRule {
                    exe_basename: Some("claude".into()),
                    exe_path_contains: None,
                    argv_contains: None,
                    exclude_path_contains: None,
                    require_shell_parent: false,
                }],
            },
        ];

        let agents = collect_detected_agents(
            &[
                snapshot_with_cpu(
                    100,
                    "/usr/bin/opencode",
                    "opencode",
                    &["opencode"],
                    false,
                    0.1,
                ),
                snapshot_with_cpu(200, "/usr/bin/claude", "claude", &["claude"], false, 20.0),
            ],
            &defs,
        );

        assert_eq!(agents.len(), 2);
        assert_eq!(agents[0].pid, 100);
        assert_eq!(agents[0].status, AgentStatus::Idle);
        assert_eq!(agents[1].pid, 200);
        assert_eq!(agents[1].status, AgentStatus::Generating);
    }

    #[test]
    fn collect_detected_agents_links_subprocess_to_parent() {
        let defs = vec![AgentDefinition {
            id: "claude-code".into(),
            kind: AgentKind::ClaudeCode,
            display_name: "Claude Code".into(),
            is_builtin: true,
            rules: vec![
                AgentRule {
                    exe_basename: Some("claude".into()),
                    exe_path_contains: None,
                    argv_contains: None,
                    exclude_path_contains: None,
                    require_shell_parent: false,
                },
                AgentRule {
                    exe_basename: None,
                    exe_path_contains: Some("claude/versions/".into()),
                    argv_contains: Some(vec!["--chrome-native-host".into()]),
                    exclude_path_contains: None,
                    require_shell_parent: false,
                },
            ],
        }];

        let agents = collect_detected_agents(
            &[
                ProcessSnapshot {
                    pid: 100,
                    exe_path: "/usr/bin/claude".into(),
                    exe_basename: "claude".into(),
                    process_name: "claude".into(),
                    argv: vec!["claude".into()],
                    cwd: None,
                    is_thread: false,
                    cpu_usage: 0.0,
                    ppid: None,
                    os_status: sysinfo::ProcessStatus::Run,
                },
                ProcessSnapshot {
                    pid: 200,
                    exe_path: "/home/u/.local/share/claude/versions/2.1.139".into(),
                    exe_basename: "2.1.139".into(),
                    process_name: "2.1.139".into(),
                    argv: vec![
                        "/home/u/.local/share/claude/versions/2.1.139".into(),
                        "--chrome-native-host".into(),
                    ],
                    cwd: None,
                    is_thread: false,
                    cpu_usage: 0.0,
                    ppid: Some(100),
                    os_status: sysinfo::ProcessStatus::Run,
                },
            ],
            &defs,
        );

        assert_eq!(agents.len(), 2);
        assert_eq!(agents[0].pid, 100);
        assert_eq!(agents[0].parent_id, None);
        assert_eq!(agents[1].pid, 200);
        assert_eq!(agents[1].parent_id, Some(AgentId("100".into())));
    }

    #[test]
    fn collect_detected_agents_parent_id_none_when_parent_not_detected() {
        let defs = vec![AgentDefinition {
            id: "claude-code".into(),
            kind: AgentKind::ClaudeCode,
            display_name: "Claude Code".into(),
            is_builtin: true,
            rules: vec![AgentRule {
                exe_basename: Some("claude".into()),
                exe_path_contains: None,
                argv_contains: None,
                exclude_path_contains: None,
                require_shell_parent: false,
            }],
        }];
        let agents = collect_detected_agents(
            &[ProcessSnapshot {
                pid: 500,
                exe_path: "/usr/bin/claude".into(),
                exe_basename: "claude".into(),
                process_name: "claude".into(),
                argv: vec!["claude".into()],
                cwd: None,
                is_thread: false,
                cpu_usage: 0.0,
                ppid: Some(99999),
                os_status: sysinfo::ProcessStatus::Run,
            }],
            &defs,
        );

        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].parent_id, None);
    }

    #[test]
    fn collect_detected_agents_truncates_command_line() {
        let defs = vec![def_opencode()];
        let long_arg = "x".repeat(250);
        let agents = collect_detected_agents(
            &[ProcessSnapshot {
                pid: 123,
                exe_path: "/usr/bin/opencode".to_string(),
                exe_basename: "opencode".to_string(),
                process_name: "opencode".to_string(),
                argv: vec!["opencode".to_string(), long_arg],
                cwd: None,
                is_thread: false,
                cpu_usage: 0.0,
                ppid: None,
                os_status: sysinfo::ProcessStatus::Run,
            }],
            &defs,
        );

        assert_eq!(agents.len(), 1);
        assert!(agents[0].command_line.ends_with('…'));
        assert_eq!(agents[0].command_line.chars().count(), 201);
    }
}
