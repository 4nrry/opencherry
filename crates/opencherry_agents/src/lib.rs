//! Agent detection and orchestration for OpenCherry.
//!
//! Sprint 0 placeholder. Sprint 1 will implement sysinfo-based detection of
//! known agent processes (claude-code, opencode, codex, gemini-cli, aider, ...).

use serde::{Deserialize, Serialize};

/// Stub representation of a detected agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedAgent {
    pub kind: String,
    pub pid: u32,
}

/// Returns an empty list for now; real detection lands in Sprint 1.
pub fn detect_running_agents() -> Vec<DetectedAgent> {
    Vec::new()
}
