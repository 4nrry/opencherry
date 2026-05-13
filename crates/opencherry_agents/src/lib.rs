//! Agent detection and orchestration for OpenCherry.
//!
//! Sprint 1: sysinfo-based detection of running coding-agent processes.
//! Matches by executable name and known argv patterns. Heuristics will
//! be refined as we observe real users.

use opencherry_core::{AgentId, AgentKind, AgentTargetMatches, RepoRef, TrackedTargetKind};
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedAgent {
    pub id: AgentId,
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
    argv: Vec<String>,
    cwd: Option<String>,
    is_thread: bool,
    /// CPU usage percentage from sysinfo (0.0-100.0 per core; can exceed 100 across cores).
    cpu_usage: f32,
    /// Parent process pid (from sysinfo). Used to link subprocesses to their primary.
    ppid: Option<u32>,
}

/// Threshold (percent of one core) above which an agent is considered Generating.
const GENERATING_CPU_THRESHOLD: f32 = 5.0;

/// Map an instantaneous CPU usage reading to an `AgentStatus`.
///
/// Stateless and pure: callers decide how the CPU sample was obtained.
pub fn classify_status(cpu_usage: f32) -> AgentStatus {
    if cpu_usage >= GENERATING_CPU_THRESHOLD {
        AgentStatus::Generating
    } else {
        AgentStatus::Idle
    }
}

/// Classify a process by exe basename and argv. Returns `None` if it
/// doesn't look like a known agent.
fn classify(exe_path: &str, exe_basename: &str, argv: &[&str]) -> Option<AgentKind> {
    let exe_path_lc = exe_path.to_ascii_lowercase();
    let exe = exe_basename.to_ascii_lowercase();
    let joined = argv.join(" ").to_ascii_lowercase();

    if exe_path_lc.contains("/.antigravity/extensions/") {
        return None;
    }

    // Newer claude-code installs ship a single binary at
    // `.local/share/claude/versions/<X.Y.Z>`, so exe basename is a version
    // string. Detect by install-path signature first.
    if exe_path_lc.contains("/claude/versions/") {
        return Some(AgentKind::ClaudeCode);
    }

    // Direct binary names first (cheap path).
    match exe.as_str() {
        "claude" | "claude-code" => return Some(AgentKind::ClaudeCode),
        "opencode" => return Some(AgentKind::OpenCode),
        "codex" => return Some(AgentKind::Codex),
        "gemini" => return Some(AgentKind::GeminiCli),
        "aider" => return Some(AgentKind::Aider),
        "copilot" => return Some(AgentKind::CopilotCli),
        _ => {}
    }

    // Node/Python wrappers: inspect argv for the package entry point.
    if matches!(exe.as_str(), "node" | "deno" | "bun" | "python" | "python3" | "mainthread") {
        if joined.contains("@anthropic-ai/claude-code") || joined.contains("/claude-code/") {
            return Some(AgentKind::ClaudeCode);
        }
        if joined.contains("opencode") {
            return Some(AgentKind::OpenCode);
        }
        if joined.contains("@openai/codex") || joined.contains("codex-cli") {
            return Some(AgentKind::Codex);
        }
        if joined.contains("@google/gemini") || joined.contains("gemini-cli") {
            return Some(AgentKind::GeminiCli);
        }
        if joined.contains("aider") {
            return Some(AgentKind::Aider);
        }
        if joined.contains("copilot") || joined.contains("github-copilot") {
            return Some(AgentKind::CopilotCli);
        }
    }

    None
}

/// Snapshot of currently running agent processes.
///
/// Two sysinfo refreshes with a short sleep between so `cpu_usage` is meaningful
/// (sysinfo returns 0% on first refresh of each process). The added latency
/// (~250 ms) is acceptable given the 3 s frontend polling cadence.
pub fn detect_running_agents() -> Vec<DetectedAgent> {
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
                .unwrap_or_else(|| proc_.name().to_string_lossy().into_owned()),
            argv: proc_
                .cmd()
                .iter()
                .map(|s| s.to_string_lossy().into_owned())
                .collect(),
            cwd: proc_.cwd().map(|p| p.to_string_lossy().into_owned()),
            is_thread: proc_.thread_kind().is_some(),
            cpu_usage: proc_.cpu_usage(),
            ppid: proc_.parent().map(|p| p.as_u32()),
        })
        .collect::<Vec<_>>();

    collect_detected_agents(&snapshots)
}

pub fn correlate_agents_to_targets(agents: Vec<DetectedAgent>, targets: &[RepoRef]) -> Vec<DetectedAgent> {
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

fn collect_detected_agents(processes: &[ProcessSnapshot]) -> Vec<DetectedAgent> {
    let mut out = Vec::new();
    for process in processes {
        if process.is_thread {
            continue;
        }

        // Skip threads — on Linux sysinfo includes /proc/<pid>/task/* by
        // default, which would otherwise multiply each agent process by
        // its thread count. `thread_kind() == None` means "real process".
        let argv_refs: Vec<&str> = process.argv.iter().map(|s| s.as_str()).collect();

        let Some(kind) = classify(&process.exe_path, &process.exe_basename, &argv_refs) else {
            continue;
        };

        let pid_u32 = process.pid;
        let display_name = format!("{} (pid {})", kind.display_name(), pid_u32);
        let id = AgentId(format!("pid-{pid_u32}"));
        let command_line = {
            let s = process.argv.join(" ");
            if s.len() > 200 {
                format!("{}…", &s[..200])
            } else {
                s
            }
        };

        out.push(DetectedAgent {
            id,
            kind,
            display_name,
            pid: pid_u32,
            cwd: process.cwd.clone(),
            command_line,
            targets: AgentTargetMatches::default(),
            status: classify_status(process.cpu_usage),
            parent_id: None,
        });
    }

    out.sort_by(|a, b| a.pid.cmp(&b.pid));

    // Second pass: any detected agent whose ppid is also a detected agent's pid
    // is linked as a subprocess of that parent.
    for i in 0..out.len() {
        let ppid = processes
            .iter()
            .find(|p| p.pid == out[i].pid)
            .and_then(|p| p.ppid);
        let Some(ppid) = ppid else { continue };
        let parent_id = out.iter().find(|a| a.pid == ppid).map(|a| a.id.clone());
        if parent_id.is_some() {
            out[i].parent_id = parent_id;
        }
    }

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
            argv: argv.iter().map(|arg| arg.to_string()).collect(),
            cwd: Some("/workspace".to_string()),
            is_thread,
            cpu_usage,
            ppid: None,
        }
    }

    #[test]
    fn classify_matches_supported_agent_wrappers() {
        assert_eq!(
            classify(
                "/usr/bin/node",
                "node",
                &["node", "/tmp/@anthropic-ai/claude-code/index.js"]
            ),
            Some(AgentKind::ClaudeCode)
        );
        assert_eq!(
            classify("/usr/bin/opencode", "opencode", &["opencode"]),
            Some(AgentKind::OpenCode)
        );
        assert_eq!(
            classify("/usr/bin/python3", "python3", &["python3", "-m", "aider"]),
            Some(AgentKind::Aider)
        );
        assert_eq!(
            classify("/usr/bin/copilot", "copilot", &["copilot"]),
            Some(AgentKind::CopilotCli)
        );
    }

    #[test]
    fn classify_detects_claude_code_by_install_path() {
        // claude-code 2.x ships a single binary at `.local/share/claude/versions/<X.Y.Z>`,
        // so the exe basename is a version string, not "claude".
        assert_eq!(
            classify(
                "/home/user/.local/share/claude/versions/2.1.139",
                "2.1.139",
                &["claude", "--dangerously-skip-permissions"]
            ),
            Some(AgentKind::ClaudeCode)
        );
    }

    #[test]
    fn classify_ignores_antigravity_extensions() {
        assert_eq!(
            classify(
                "/home/user/.antigravity/extensions/opencode/bin/opencode",
                "opencode",
                &["opencode"]
            ),
            None
        );
    }

    #[test]
    fn collect_detected_agents_filters_threads_and_sorts_by_pid() {
        let agents = collect_detected_agents(&[
            snapshot(400, "/usr/bin/opencode", "opencode", &["opencode"], false),
            snapshot(200, "/usr/bin/node", "node", &["node", "codex-cli"], false),
            snapshot(201, "/usr/bin/node", "node", &["node", "codex-cli"], true),
        ]);

        assert_eq!(agents.len(), 2);
        assert_eq!(agents[0].pid, 200);
        assert_eq!(agents[0].kind, AgentKind::Codex);
        assert_eq!(agents[1].pid, 400);
        assert_eq!(agents[1].kind, AgentKind::OpenCode);
    }

    #[test]
    fn correlate_agents_matches_repo_and_group_from_cwd() {
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
            collect_detected_agents(&[ProcessSnapshot {
                pid: 123,
                exe_path: "/usr/bin/opencode".into(),
                exe_basename: "opencode".into(),
                argv: vec!["opencode".into()],
                cwd: Some("/workspace/app/src".into()),
                is_thread: false,
                cpu_usage: 0.0,
                ppid: None,
            }]),
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
        let repo = RepoRef {
            id: opencherry_core::RepoId("repo:/workspace/app".into()),
            path: PathBuf::from("/workspace/app"),
            display_name: "app".into(),
            kind: TrackedTargetKind::Repo,
        };

        let agents = correlate_agents_to_targets(
            collect_detected_agents(&[ProcessSnapshot {
                pid: 123,
                exe_path: "/usr/bin/opencode".into(),
                exe_basename: "opencode".into(),
                argv: vec!["opencode".into()],
                cwd: None,
                is_thread: false,
                cpu_usage: 0.0,
                ppid: None,
            }]),
            &[repo],
        );

        assert_eq!(agents.len(), 1);
        assert!(agents[0].targets.repos.is_empty());
        assert!(agents[0].targets.groups.is_empty());
    }

    #[test]
    fn classify_status_returns_idle_below_threshold() {
        assert_eq!(classify_status(0.0), AgentStatus::Idle);
        assert_eq!(classify_status(4.9), AgentStatus::Idle);
    }

    #[test]
    fn classify_status_returns_generating_at_or_above_threshold() {
        assert_eq!(classify_status(5.0), AgentStatus::Generating);
        assert_eq!(classify_status(75.0), AgentStatus::Generating);
    }

    #[test]
    fn collect_detected_agents_populates_status_from_cpu_usage() {
        let agents = collect_detected_agents(&[
            snapshot_with_cpu(100, "/usr/bin/opencode", "opencode", &["opencode"], false, 0.1),
            snapshot_with_cpu(200, "/usr/bin/claude", "claude", &["claude"], false, 20.0),
        ]);

        assert_eq!(agents.len(), 2);
        assert_eq!(agents[0].pid, 100);
        assert_eq!(agents[0].status, AgentStatus::Idle);
        assert_eq!(agents[1].pid, 200);
        assert_eq!(agents[1].status, AgentStatus::Generating);
    }

    #[test]
    fn collect_detected_agents_links_subprocess_to_parent() {
        let agents = collect_detected_agents(&[
            ProcessSnapshot {
                pid: 100,
                exe_path: "/usr/bin/claude".into(),
                exe_basename: "claude".into(),
                argv: vec!["claude".into()],
                cwd: None,
                is_thread: false,
                cpu_usage: 0.0,
                ppid: None,
            },
            ProcessSnapshot {
                pid: 200,
                exe_path: "/home/u/.local/share/claude/versions/2.1.139".into(),
                exe_basename: "2.1.139".into(),
                argv: vec![
                    "/home/u/.local/share/claude/versions/2.1.139".into(),
                    "--chrome-native-host".into(),
                ],
                cwd: None,
                is_thread: false,
                cpu_usage: 0.0,
                ppid: Some(100),
            },
        ]);

        assert_eq!(agents.len(), 2);
        assert_eq!(agents[0].pid, 100);
        assert_eq!(agents[0].parent_id, None);
        assert_eq!(agents[1].pid, 200);
        assert_eq!(agents[1].parent_id, Some(AgentId("pid-100".into())));
    }

    #[test]
    fn collect_detected_agents_parent_id_none_when_parent_not_detected() {
        let agents = collect_detected_agents(&[ProcessSnapshot {
            pid: 500,
            exe_path: "/usr/bin/claude".into(),
            exe_basename: "claude".into(),
            argv: vec!["claude".into()],
            cwd: None,
            is_thread: false,
            cpu_usage: 0.0,
            ppid: Some(99999),
        }]);

        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].parent_id, None);
    }

    #[test]
    fn collect_detected_agents_truncates_command_line() {
        let long_arg = "x".repeat(250);
        let agents = collect_detected_agents(&[ProcessSnapshot {
            pid: 123,
            exe_path: "/usr/bin/opencode".to_string(),
            exe_basename: "opencode".to_string(),
            argv: vec!["opencode".to_string(), long_arg],
            cwd: None,
            is_thread: false,
            cpu_usage: 0.0,
            ppid: None,
        }]);

        assert_eq!(agents.len(), 1);
        assert!(agents[0].command_line.ends_with('…'));
        assert_eq!(agents[0].command_line.chars().count(), 201);
    }
}
