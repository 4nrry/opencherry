import { spawn, type ChildProcess } from "node:child_process";

function repoListItem(repoName: string) {
  return $(`.repo-list__item[data-repo-path$="/${repoName}"]`);
}

function childRepoCard(repoName: string) {
  return $(`.diff-file[data-repo-path$="/${repoName}"]`);
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env: ${name}`);
  }
  return value;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("OpenCherry real agent correlation", () => {
  const enabled = process.env.OPENCHERRY_E2E_REAL_AGENTS === "1";
  const runIfEnabled = enabled ? it : it.skip;

  let processes: ChildProcess[] = [];
  let keepAlivePipes: ChildProcess[] = [];

  async function startAgent(command: string, args: string[], cwd: string) {
    const keepAlive = spawn("tail", ["-f", "/dev/null"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        ...process.env,
        CI: "1",
      },
    });
    const proc = spawn(command, args, {
      cwd,
      stdio: ["pipe", "ignore", "ignore"],
      env: {
        ...process.env,
        CI: "1",
      },
    });
    keepAlive.stdout?.pipe(proc.stdin!);
    keepAlivePipes.push(keepAlive);
    processes.push(proc);
    await sleep(2500);
  }

  afterEach(async () => {
    for (const proc of processes) {
      proc.kill("SIGTERM");
    }
    for (const proc of keepAlivePipes) {
      proc.kill("SIGTERM");
    }
    processes = [];
    keepAlivePipes = [];
    await sleep(1000);
  });

  runIfEnabled("detects and correlates real CLI agents to repos and groups", async () => {
    const trackedRepoPath = requiredEnv("OPENCHERRY_E2E_TRACKED_REPO_PATH");
    const childRepoPath = requiredEnv("OPENCHERRY_E2E_CHILD_REPO_PATH");

    await startAgent("opencode", ["serve", "--hostname", "127.0.0.1", "--port", "0"], trackedRepoPath);
    await startAgent("gemini", ["--acp"], childRepoPath);
    await startAgent("copilot", ["--acp"], childRepoPath);
    await startAgent("codex", ["mcp-server"], trackedRepoPath);

    await browser.refresh();
    await browser.pause(7000);

    await (await repoListItem("tracked-repo")).click();
    await expect($(".repo-view")).toHaveText(expect.stringMatching(/Agents in This Repo/i));
    await expect($(".repo-view")).toHaveText(expect.stringMatching(/OpenCode|Codex/i));

    await (await repoListItem("workspace-group")).click();
    await expect($(".repo-view")).toHaveText(expect.stringMatching(/Agents in This Group/i));
    await expect($(".repo-view")).toHaveText(expect.stringMatching(/Gemini CLI|Copilot CLI/i));
    await expect(await childRepoCard("child-repo")).toHaveText(expect.stringMatching(/agent/i));
  });
});
