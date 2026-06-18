import { createSignal, onMount, For, Show } from 'solid-js';

interface Repo {
  id: string;
  name: string;
  status: 'clean' | 'dirty' | 'syncing';
  ahead: number;
  behind: number;
  activeAgents: string[];
}

interface Agent {
  name: string;
  id: string;
  pid: number;
  status: 'running' | 'idle' | 'analyzing';
  color: string;
}

interface LogLine {
  id: string;
  timestamp: string;
  source: string;
  text: string;
  type: 'info' | 'success' | 'warn' | 'cmd' | 'ascii';
}

export default function InteractiveDemo() {
  const [activeRepo, setActiveRepo] = createSignal('opencherry');
  const [activeTab, setActiveTab] = createSignal<'logs' | 'diff' | 'agents'>('logs');
  const [isSimulating, setIsSyncing] = createSignal(false);
  const [typedMessage, setTypedMessage] = createSignal('');
  
  // List of simulated repositories
  const [repos, setRepos] = createSignal<Repo[]>([
    { id: 'opencherry', name: '4nrry/opencherry', status: 'dirty', ahead: 2, behind: 0, activeAgents: ['Claude', 'Aider'] },
    { id: 'opencherry_repo', name: 'crates/opencherry_repo', status: 'clean', ahead: 0, behind: 0, activeAgents: ['Claude'] },
    { id: 'opencherry_agents', name: 'crates/opencherry_agents', status: 'clean', ahead: 0, behind: 1, activeAgents: [] },
    { id: 'desktop', name: 'apps/desktop', status: 'dirty', ahead: 1, behind: 0, activeAgents: ['Aider'] },
  ]);

  // List of simulated agents
  const [agents] = createSignal<Agent[]>([
    { name: 'Claude Code', id: 'Claude', pid: 54091, status: 'analyzing', color: 'text-cherry' },
    { name: 'Aider', id: 'Aider', pid: 54102, status: 'running', color: 'text-emerald-400' },
    { name: 'Gemini CLI', id: 'Gemini', pid: 54115, status: 'idle', color: 'text-cyan-400' },
  ]);

  // Terminal log state
  const [logs, setLogs] = createSignal<LogLine[]>([
    { id: '0', timestamp: '14:20:01', source: 'System', text: '🍒 OpenCherry CLI control tower initialized.', type: 'success' },
    { id: '1', timestamp: '14:20:02', source: 'System', text: 'Watching 4 workspaces across Rust & SolidJS.', type: 'info' },
    { id: '2', timestamp: '14:20:03', source: 'System', text: 'Detected running agents: Claude Code (PID 54091), Aider (PID 54102).', type: 'info' },
    { id: '3', timestamp: '14:20:05', source: 'Claude', text: '$ ast-grep --pattern "fn $_() { $$$ }" crates/opencherry_repo/', type: 'cmd' },
    { id: '4', timestamp: '14:20:06', source: 'Claude', text: '[Claude] Found 14 local git command helpers. Analyzing structures...', type: 'info' },
    { id: '5', timestamp: '14:20:08', source: 'Aider', text: '[Aider] Reading package.json in apps/desktop...', type: 'info' },
    { id: '6', timestamp: '14:20:09', source: 'Aider', text: '$ vitest run apps/desktop/src/test/diff.test.ts', type: 'cmd' },
    { id: '7', timestamp: '14:20:11', source: 'Aider', text: '✓ 3 tests passed (vitest)', type: 'success' },
  ]);

  // Diff view simulation data
  const diffData = {
    opencherry: [
      { file: 'apps/desktop/src/types.ts', change: 'M', additions: 12, deletions: 4 },
      { file: 'crates/opencherry_core/src/lib.rs', change: 'M', additions: 3, deletions: 0 },
    ],
    desktop: [
      { file: 'apps/desktop/src/components/Sidebar.tsx', change: 'M', additions: 45, deletions: 12 },
      { file: 'apps/desktop/package.json', change: 'M', additions: 2, deletions: 2 },
    ]
  };

  // Simulate typing animation
  let messageInput: HTMLInputElement | undefined;
  
  const triggerSimulation = () => {
    if (isSimulating()) return;
    setIsSyncing(true);

    const steps = [
      { source: 'System', text: '$ opencherry commit --all-repos -m "feat: integrate parallel multi-agent activity logs"', type: 'cmd' as const, delay: 500 },
      { source: 'Claude', text: '[Claude] Staging local modifications in crates/opencherry_core...', type: 'info' as const, delay: 1200 },
      { source: 'Aider', text: '[Aider] Verifying workspace sanity. Compiling apps/desktop/src-tauri...', type: 'info' as const, delay: 2000 },
      { source: 'System', text: 'cargo check --workspace: finished in 1.42s 🍒', type: 'success' as const, delay: 2800 },
      { source: 'Claude', text: '[Claude] Staging complete. Writing commit: feat(core): parallelize workspace status check', type: 'info' as const, delay: 3500 },
      { source: 'System', text: '[System] Pushing committed ref to github.com/4nrry/opencherry...', type: 'info' as const, delay: 4200 },
      { source: 'System', text: '✓ Successfully committed and pushed 2 workspaces in parallel (took 4.5s)', type: 'success' as const, delay: 5000 },
    ];

    steps.forEach((step, i) => {
      setTimeout(() => {
        const time = new Date().toTimeString().split(' ')[0];
        setLogs(prev => [...prev, {
          id: `sim-${i}-${Date.now()}`,
          timestamp: time,
          source: step.source,
          text: step.text,
          type: step.type
        }]);

        // auto-scroll terminal container
        const term = document.getElementById('terminal-container');
        if (term) {
          term.scrollTop = term.scrollHeight;
        }

        // When complete
        if (i === steps.length - 1) {
          setIsSyncing(false);
          // Update repo statuses to clean in UI
          setRepos(prev => prev.map(r => r.id === 'opencherry' || r.id === 'desktop' ? { ...r, status: 'clean', ahead: 0 } : r));
        }
      }, step.delay);
    });
  };

  const handleCustomCommand = (e: Event) => {
    e.preventDefault();
    if (!typedMessage().trim()) return;

    const cmd = typedMessage();
    const time = new Date().toTimeString().split(' ')[0];
    
    setLogs(prev => [...prev, {
      id: `custom-${Date.now()}`,
      timestamp: time,
      source: 'User',
      text: `$ ${cmd}`,
      type: 'cmd'
    }]);

    setTypedMessage('');

    setTimeout(() => {
      let response = '';
      let type: 'info' | 'success' | 'warn' = 'info';

      if (cmd.toLowerCase().includes('help')) {
        response = 'Available CLI commands: status, sync, agents, clear';
      } else if (cmd.toLowerCase().includes('status')) {
        response = 'All 4 workspaces tracked. opencherry: dirty (+2 ahead), desktop: dirty (+1 ahead).';
      } else if (cmd.toLowerCase().includes('clear')) {
        setLogs([]);
        return;
      } else if (cmd.toLowerCase().includes('sync')) {
        triggerSimulation();
        return;
      } else {
        response = `Command recognized. Routing to active repo [${activeRepo()}]: running ${cmd}...`;
        type = 'warn';
      }

      setLogs(prev => [...prev, {
        id: `response-${Date.now()}`,
        timestamp: time,
        source: 'System',
        text: response,
        type: type
      }]);

      const term = document.getElementById('terminal-container');
      if (term) term.scrollTop = term.scrollHeight;
    }, 400);
  };

  onMount(() => {
    // Continuous light blinking activity simulator
    const interval = setInterval(() => {
      if (isSimulating()) return;
      
      const randomAgent = agents()[Math.floor(Math.random() * agents().length)];
      if (randomAgent.id === 'Gemini') return; // let gemini sleep

      const activeRepoName = repos().find(r => r.id === activeRepo())?.name || 'opencherry';
      
      const phrases = [
        `[${randomAgent.id}] Scanning modifications in ${activeRepoName}...`,
        `[${randomAgent.id}] Process health normal. Core temperature 42C.`,
        `[${randomAgent.id}] Correlating ast structures...`,
        `[${randomAgent.id}] CPU load: ${(Math.random() * 15 + 5).toFixed(1)}%`,
      ];

      const time = new Date().toTimeString().split(' ')[0];
      setLogs(prev => {
        // Keep logs from growing endlessly
        const next = prev.length > 50 ? prev.slice(prev.length - 30) : prev;
        return [...next, {
          id: `pulse-${Date.now()}`,
          timestamp: time,
          source: randomAgent.id,
          text: phrases[Math.floor(Math.random() * phrases.length)],
          type: 'info'
        }];
      });

      const term = document.getElementById('terminal-container');
      if (term) term.scrollTop = term.scrollHeight;
    }, 12000);

    return () => clearInterval(interval);
  });

  return (
    <div class="w-full max-w-5xl mx-auto bg-obsidian-light border border-obsidian-border rounded-xl shadow-2xl shadow-black/80 overflow-hidden font-mono text-sm flex flex-col md:flex-row h-[550px] relative z-20">
      
      {/* 1. Left Sidebar: Repo list */}
      <div class="w-full md:w-64 bg-obsidian border-r border-obsidian-border flex flex-col shrink-0">
        <div>
          {/* Header */}
          <div class="px-4 py-3 border-b border-obsidian-border flex items-center justify-between bg-obsidian-light/50">
            <span class="text-xs uppercase tracking-wider font-semibold text-zinc-500">Workspaces</span>
            <span class="flex h-2 w-2 relative">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-cherry opacity-75"></span>
              <span class="relative inline-flex rounded-full h-2 w-2 bg-cherry"></span>
            </span>
          </div>

          {/* Repos list */}
          <div class="p-2 space-y-1">
            <For each={repos()}>
              {(repo) => (
                <button
                  onClick={() => {
                    setActiveRepo(repo.id);
                    // Add terminal feedback when changing repo
                    const time = new Date().toTimeString().split(' ')[0];
                    setLogs(prev => [...prev, {
                      id: `switch-${Date.now()}`,
                      timestamp: time,
                      source: 'System',
                      text: `Switched context to ${repo.name} 🍒`,
                      type: 'info'
                    }]);
                  }}
                  class={`w-full text-left px-3 py-2.5 rounded-lg flex flex-col transition-all duration-200 group ${
                    activeRepo() === repo.id
                      ? 'bg-cherry/10 border border-cherry/20 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]'
                      : 'border border-transparent text-zinc-400 hover:bg-obsidian-card hover:text-zinc-200'
                  }`}
                >
                  <div class="flex items-center justify-between w-full">
                    <span class="font-medium truncate group-hover:translate-x-0.5 transition-transform duration-200">{repo.name.split('/').pop()}</span>
                    <div class="flex items-center space-x-1.5 shrink-0">
                      {repo.status === 'dirty' && (
                        <span class="text-[10px] px-1 bg-cherry/15 text-cherry font-bold rounded border border-cherry/20">DIRTY</span>
                      )}
                      {repo.ahead > 0 && (
                        <span class="text-[10px] text-zinc-400">↑{repo.ahead}</span>
                      )}
                      {repo.behind > 0 && (
                        <span class="text-[10px] text-zinc-400">↓{repo.behind}</span>
                      )}
                    </div>
                  </div>
                  <div class="flex items-center mt-1 space-x-2 text-[10px] text-zinc-500">
                    <span class="truncate">{repo.name}</span>
                    <Show when={repo.activeAgents.length > 0}>
                      <span class="text-zinc-600">•</span>
                      <span class="text-emerald-500/80">{repo.activeAgents.join('+')}</span>
                    </Show>
                  </div>
                </button>
              )}
            </For>
          </div>
        </div>

      </div>

      {/* 2. Right Main Panel */}
      <div class="flex-1 flex flex-col min-w-0 bg-obsidian-card">
        
        {/* Tab Headers */}
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-obsidian-border bg-obsidian px-2 py-2 sm:py-0.5 shrink-0">
          <div class="flex items-center space-x-1 overflow-x-auto">
            <button
              onClick={() => setActiveTab('logs')}
              class={`px-4 py-2.5 border-b-2 text-xs font-semibold tracking-wide transition-all ${
                activeTab() === 'logs'
                  ? 'border-cherry text-white bg-obsidian-light/40'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              ⌨️ Terminal Logs
            </button>
            <button
              onClick={() => setActiveTab('diff')}
              class={`px-4 py-2.5 border-b-2 text-xs font-semibold tracking-wide transition-all ${
                activeTab() === 'diff'
                  ? 'border-cherry text-white bg-obsidian-light/40'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              📂 Git Diff
            </button>
            <button
              onClick={() => setActiveTab('agents')}
              class={`px-4 py-2.5 border-b-2 text-xs font-semibold tracking-wide transition-all ${
                activeTab() === 'agents'
                  ? 'border-cherry text-white bg-obsidian-light/40'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              🤖 Detected Agents
            </button>
          </div>
          
          <div class="flex items-center gap-3 px-1 sm:px-3">
            <div class="text-[11px] text-zinc-500 hidden sm:block">
              active_repo: <span class="text-zinc-400 font-bold">{activeRepo()}</span>
            </div>
            <button
              onClick={triggerSimulation}
              disabled={isSimulating()}
              class={`w-full sm:w-auto py-2 sm:py-1.5 px-3 rounded-lg flex items-center justify-center space-x-2 text-xs font-semibold transition-all duration-300 shadow-md whitespace-nowrap ${
                isSimulating()
                  ? 'bg-cherry/20 text-cherry/60 cursor-not-allowed border border-cherry/10 animate-pulse'
                  : 'bg-cherry text-white hover:bg-cherry/90 hover:scale-[1.01] hover:shadow-cherry/10 active:scale-[0.99] border border-cherry/30'
              }`}
            >
              <span>{isSimulating() ? 'Sincronizando...' : 'Sincronizar tudo'}</span>
              <svg class={`w-4 h-4 ${isSimulating() ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 16H18m0 0H22m-3 0v4" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tab Contents */}
        <div class="flex-1 min-h-0 flex flex-col">
          
          {/* TAB 1: Terminal Logs */}
          <Show when={activeTab() === 'logs'}>
            <div 
              id="terminal-container"
              class="flex-1 overflow-y-auto p-4 space-y-1.5 font-mono text-xs leading-relaxed"
            >
              <For each={logs()}>
                {(log) => (
                  <div class="flex items-start space-x-2 group">
                    <span class="text-zinc-600 select-none shrink-0">[{log.timestamp}]</span>
                    <span class={`font-semibold shrink-0 select-none ${
                      log.source === 'Claude' ? 'text-cherry' :
                      log.source === 'Aider' ? 'text-emerald-400' :
                      log.source === 'User' ? 'text-indigo-400' :
                      'text-zinc-500'
                    }`}>
                      {log.source}:
                    </span>
                    <span class={`break-all ${
                      log.type === 'cmd' ? 'text-white font-medium bg-zinc-900 px-1 py-0.5 rounded border border-zinc-800' :
                      log.type === 'success' ? 'text-emerald-400' :
                      log.type === 'warn' ? 'text-amber-400' :
                      'text-zinc-300'
                    }`}>
                      {log.text}
                    </span>
                  </div>
                )}
              </For>
            </div>

            {/* Terminal Input */}
            <form 
              onSubmit={handleCustomCommand}
              class="border-t border-obsidian-border bg-obsidian/70 p-2 flex items-center space-x-2 shrink-0"
            >
              <span class="text-cherry font-extrabold select-none pl-2">&gt;_</span>
              <input
                ref={messageInput}
                type="text"
                value={typedMessage()}
                onInput={(e) => setTypedMessage(e.currentTarget.value)}
                placeholder="Digite status, sync ou clear e pressione Enter..."
                class="flex-1 bg-transparent border-0 text-white placeholder-zinc-600 focus:outline-none focus:ring-0 text-xs py-1.5 font-mono"
              />
              <button
                type="submit"
                class="px-3 py-1 bg-obsidian-border hover:bg-zinc-800 text-zinc-300 border border-zinc-800 rounded transition-all text-[11px]"
              >
                Send
              </button>
            </form>
          </Show>

          {/* TAB 2: Git Diff */}
          <Show when={activeTab() === 'diff'}>
            <div class="flex-1 overflow-y-auto p-4 space-y-4">
              <div class="flex items-center justify-between border-b border-obsidian-border pb-2">
                <span class="text-xs text-zinc-400 font-bold">Uncommitted Changes</span>
                <span class="text-[10px] text-zinc-500">git status -s</span>
              </div>
              
              <Show 
                when={diffData[activeRepo() as keyof typeof diffData] && diffData[activeRepo() as keyof typeof diffData].length > 0}
                fallback={
                  <div class="flex flex-col items-center justify-center py-16 text-zinc-500 space-y-2">
                    <svg class="w-8 h-8 opacity-40 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p class="text-xs text-emerald-500/90 font-medium">Clean workspace. No local edits detected.</p>
                  </div>
                }
              >
                <div class="space-y-2.5">
                  <For each={diffData[activeRepo() as keyof typeof diffData]}>
                    {(file) => (
                      <div class="bg-obsidian border border-obsidian-border rounded-lg p-3 flex items-center justify-between hover:border-zinc-700 transition-colors">
                        <div class="flex items-center space-x-3 min-w-0">
                          <span class={`text-xs font-bold px-1.5 py-0.5 rounded shrink-0 select-none ${
                            file.change === 'M' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                          }`}>
                            {file.change}
                          </span>
                          <span class="text-xs text-zinc-300 font-medium truncate">{file.file}</span>
                        </div>
                        <div class="flex items-center space-x-2 font-sans shrink-0">
                          <span class="text-emerald-500 text-xs">+{file.additions}</span>
                          <span class="text-cherry text-xs">-{file.deletions}</span>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>

          {/* TAB 3: Detected Agents */}
          <Show when={activeTab() === 'agents'}>
            <div class="flex-1 overflow-y-auto p-4 space-y-4">
              <div class="flex items-center justify-between border-b border-obsidian-border pb-2">
                <span class="text-xs text-zinc-400 font-bold">Dynamic Sysinfo CLI Process Tree</span>
                <span class="text-[10px] text-emerald-500 animate-pulse font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">POLLING ACTIVE</span>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <For each={agents()}>
                  {(agent) => (
                    <div class="bg-obsidian border border-obsidian-border rounded-xl p-4 flex flex-col justify-between hover:border-zinc-700 transition-colors relative overflow-hidden group">
                      {/* background ambient cherry glow */}
                      <Show when={agent.status === 'analyzing'}>
                        <div class="absolute -right-10 -bottom-10 w-24 h-24 bg-cherry/10 rounded-full blur-2xl group-hover:bg-cherry/15 transition-all"></div>
                      </Show>
                      
                      <div class="flex items-start justify-between">
                        <div>
                          <h4 class="text-xs font-bold text-white mb-0.5">{agent.name}</h4>
                          <p class="text-[10px] text-zinc-500 font-mono">PID: {agent.pid}</p>
                        </div>
                        <span class={`flex h-2 w-2 relative mt-1`}>
                          <Show when={agent.status !== 'idle'}>
                            <span class={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                              agent.status === 'analyzing' ? 'bg-cherry' : 'bg-emerald-500'
                            }`}></span>
                          </Show>
                          <span class={`relative inline-flex rounded-full h-2 w-2 ${
                            agent.status === 'analyzing' ? 'bg-cherry' :
                            agent.status === 'running' ? 'bg-emerald-500' :
                            'bg-zinc-600'
                          }`}></span>
                        </span>
                      </div>

                      <div class="flex items-center justify-between mt-6 pt-2 border-t border-zinc-900 text-[10px] text-zinc-400">
                        <span>Status: <span class={`font-bold ${
                          agent.status === 'analyzing' ? 'text-cherry' :
                          agent.status === 'running' ? 'text-emerald-500' :
                          'text-zinc-500'
                        }`}>{agent.status.toUpperCase()}</span></span>
                        
                        <span class="text-zinc-600">sysinfo v0.32</span>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

        </div>
      </div>
    </div>
  );
}
