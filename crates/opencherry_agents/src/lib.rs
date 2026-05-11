//! Agent detection and orchestration for OpenCherry.
//!
//! Sprint 1: sysinfo-based detection of running coding-agent processes.
//! Matches by executable name and known argv patterns. Heuristics will
//! be refined as we observe real users.

use opencherry_core::{AgentId, AgentKind};
use serde::{Deserialize, Serialize};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};

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
}

#[derive(Debug, Clone)]
struct ProcessSnapshot {
    pid: u32,
    exe_path: String,
    exe_basename: String,
    argv: Vec<String>,
    cwd: Option<String>,
    is_thread: bool,
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

    // Direct binary names first (cheap path).
    match exe.as_str() {
        "claude" | "claude-code" => return Some(AgentKind::ClaudeCode),
        "opencode" => return Some(AgentKind::OpenCode),
        "codex" => return Some(AgentKind::Codex),
        "gemini" => return Some(AgentKind::GeminiCli),
        "aider" => return Some(AgentKind::Aider),
        _ => {}
    }

    // Node/Python wrappers: inspect argv for the package entry point.
    if matches!(exe.as_str(), "node" | "deno" | "bun" | "python" | "python3") {
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
    }

    None
}

/// Snapshot of currently running agent processes.
///
/// One sysinfo refresh per call; cheap enough for a 1-2s polling timer.
pub fn detect_running_agents() -> Vec<DetectedAgent> {
    let mut sys = System::new_with_specifics(
        RefreshKind::new().with_processes(ProcessRefreshKind::everything()),
    );
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
        })
        .collect::<Vec<_>>();

    collect_detected_agents(&snapshots)
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
        });
    }

    out.sort_by(|a, b| a.pid.cmp(&b.pid));
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
        ProcessSnapshot {
            pid,
            exe_path: exe_path.to_string(),
            exe_basename: exe_basename.to_string(),
            argv: argv.iter().map(|arg| arg.to_string()).collect(),
            cwd: Some("/workspace".to_string()),
            is_thread,
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
    fn collect_detected_agents_truncates_command_line() {
        let long_arg = "x".repeat(250);
        let agents = collect_detected_agents(&[ProcessSnapshot {
            pid: 123,
            exe_path: "/usr/bin/opencode".to_string(),
            exe_basename: "opencode".to_string(),
            argv: vec!["opencode".to_string(), long_arg],
            cwd: None,
            is_thread: false,
        }]);

        assert_eq!(agents.len(), 1);
        assert!(agents[0].command_line.ends_with('…'));
        assert_eq!(agents[0].command_line.chars().count(), 201);
    }
}
