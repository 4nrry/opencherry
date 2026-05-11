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

    let mut out = Vec::new();
    for (pid, proc_) in sys.processes() {
        // Skip threads — on Linux sysinfo includes /proc/<pid>/task/* by
        // default, which would otherwise multiply each agent process by
        // its thread count. `thread_kind() == None` means "real process".
        if proc_.thread_kind().is_some() {
            continue;
        }

        let exe_path = proc_
            .exe()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();

        let exe_basename = proc_
            .exe()
            .and_then(|p| p.file_name())
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| proc_.name().to_string_lossy().into_owned());

        let argv: Vec<String> = proc_
            .cmd()
            .iter()
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        let argv_refs: Vec<&str> = argv.iter().map(|s| s.as_str()).collect();

        let Some(kind) = classify(&exe_path, &exe_basename, &argv_refs) else {
            continue;
        };

        let pid_u32 = pid.as_u32();
        let display_name = format!("{} (pid {})", kind.display_name(), pid_u32);
        let id = AgentId(format!("pid-{pid_u32}"));
        let cwd = proc_
            .cwd()
            .map(|p| p.to_string_lossy().into_owned());
        let command_line = {
            let s = argv.join(" ");
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
            cwd,
            command_line,
        });
    }

    out.sort_by(|a, b| a.pid.cmp(&b.pid));
    out
}
