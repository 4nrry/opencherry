// Prevents additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use clap::{Parser, Subcommand};
use opencherry_persistence as persist;

#[derive(Parser)]
#[command(name = "opencherry")]
#[command(about = "OpenCherry Desktop & CLI", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Agent registry management
    Agent {
        #[clap(subcommand)]
        action: AgentAction,
    },
}

#[derive(Subcommand, Clone)]
enum AgentAction {
    /// Sync agent rules from a remote URL
    Sync {
        /// Optional URL to fetch rules from
        #[clap(long)]
        url: Option<String>,
    },
    /// List all currently defined agent rules
    List,
    /// Run agent detection and show results
    Detect,
    /// Dump raw process list for debugging
    Raw,
    /// Add a new agent definition
    Add {
        /// Unique ID for the agent
        #[clap(long)]
        id: String,
        /// Display name for the agent
        #[clap(long)]
        name: String,
        /// Executable basename to match
        #[clap(long)]
        exe: String,
        /// If true, requires shell parent
        #[clap(long)]
        shell: bool,
    },
    /// Update an existing agent definition
    Update {
        /// Unique ID for the agent
        #[clap(long)]
        id: String,
        /// New display name
        #[clap(long)]
        name: Option<String>,
        /// New executable basename
        #[clap(long)]
        exe: Option<String>,
        /// New shell parent requirement
        #[clap(long)]
        shell: Option<bool>,
    },
}

fn main() {
    let cli = Cli::parse();

    if let Some(command) = cli.command {
        let config_dir = dirs::config_dir()
            .expect("could not find config dir")
            .join("ai.opencherry.desktop");
        
        // Ensure config dir exists
        let _ = std::fs::create_dir_all(&config_dir);

        // Seed if empty
        if let Ok(defs) = persist::list_agent_definitions(&config_dir) {
            if defs.is_empty() {
                let default_json = include_str!("../../../../resources/default_agents.json");
                let _ = persist::seed_default_rules(&config_dir, default_json);
            }
        }

        match command {
            Commands::Agent { action } => match action {
                AgentAction::Sync { url } => {
                    let target_url = url.unwrap_or_else(|| {
                        "https://raw.githubusercontent.com/4nrry/opencherry/main/resources/default_agents.json"
                            .to_string()
                    });
                    match persist::sync_agent_rules(&config_dir, &target_url) {
                        Ok(n) => println!("Successfully synced {} agent rules.", n),
                        Err(e) => eprintln!("Error syncing rules: {}", e),
                    }
                }
                AgentAction::List => match persist::list_agent_definitions(&config_dir) {
                    Ok(defs) => {
                        for def in defs {
                            println!(
                                "{}: {} ({})",
                                def.id,
                                def.display_name,
                                if def.is_builtin { "builtin" } else { "custom" }
                            );
                        }
                    }
                    Err(e) => eprintln!("Error listing agents: {}", e),
                },
                AgentAction::Detect => {
                    let defs = persist::list_agent_definitions(&config_dir).unwrap_or_default();
                    let agents = opencherry_agents::detect_running_agents(&defs);
                    println!("Detected {} agents:", agents.len());
                    for agent in agents {
                        println!(
                            "[{:?}] {} (PID: {}){} - {}",
                            agent.status, 
                            agent.display_name, 
                            agent.pid,
                            if let Some(ref p) = agent.parent_id { format!(" [Child of {}]", p.0) } else { "".to_string() },
                            agent.command_line
                        );
                    }
                }
                AgentAction::Raw => {
                    let raw = opencherry_agents::debug_dump_processes();
                    println!("{}", serde_json::to_string_pretty(&raw).unwrap());
                }
                AgentAction::Add { id, name, exe, shell } => {
                    let def = opencherry_core::AgentDefinition {
                        id: id.clone(),
                        kind: opencherry_core::AgentKind::Custom(name.clone()),
                        display_name: name,
                        rules: vec![opencherry_core::AgentRule {
                            exe_basename: Some(exe),
                            exe_path_contains: None,
                            argv_contains: None,
                            exclude_path_contains: None,
                            require_shell_parent: shell,
                        }],
                        is_builtin: false,
                    };
                    if let Err(e) = persist::upsert_agent_definition(&config_dir, &def) {
                        eprintln!("Error adding agent: {}", e);
                    } else {
                        println!("Agent '{}' added successfully.", id);
                    }
                }
                AgentAction::Update { id, name, exe, shell } => {
                    // Load existing
                    let defs = persist::list_agent_definitions(&config_dir).unwrap_or_default();
                    if let Some(mut def) = defs.into_iter().find(|d| d.id == id) {
                        if let Some(n) = name {
                            def.display_name = n.clone();
                            def.kind = opencherry_core::AgentKind::Custom(n);
                        }
                        if let Some(e) = exe {
                            def.rules[0].exe_basename = Some(e);
                        }
                        if let Some(s) = shell {
                            def.rules[0].require_shell_parent = s;
                        }
                        if let Err(e) = persist::upsert_agent_definition(&config_dir, &def) {
                            eprintln!("Error updating agent: {}", e);
                        } else {
                            println!("Agent '{}' updated successfully.", id);
                        }
                    } else {
                        eprintln!("Agent '{}' not found.", id);
                    }
                }
            },
        }
    } else {
        opencherry_desktop_lib::run()
    }
}
