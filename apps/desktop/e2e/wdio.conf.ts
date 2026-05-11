import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const tauriDir = path.resolve(desktopDir, "src-tauri");
const workspaceDir = path.resolve(tauriDir, "..", "..", "..");

let tauriDriver: ChildProcess | undefined;
let exit = false;
let fixtureRoot: string | undefined;

type TrackedTargetKind = "repo" | "group";

type RepoFixtureRef = {
  id: string;
  path: string;
  display_name: string;
  kind: TrackedTargetKind;
};

function configureRepoUser(repoPath: string) {
  run("git", ["config", "user.name", "OpenCherry E2E"], repoPath);
  run("git", ["config", "user.email", "e2e@opencherry.local"], repoPath);
}

function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `command failed: ${command} ${args.join(" ")}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
}

function repoIdForPath(repoPath: string) {
  return `repo:${repoPath}`;
}

function writeLegacyRepos(configHome: string, repos: RepoFixtureRef[]) {
  const appConfigDir = path.resolve(configHome, "ai.opencherry.desktop");
  fs.mkdirSync(appConfigDir, { recursive: true });
  fs.writeFileSync(
    path.resolve(appConfigDir, "repos.json"),
    JSON.stringify({ repos }, null, 2),
    "utf8",
  );
}

function createRepo(repoPath: string, fileName: string, initialContent: string) {
  fs.mkdirSync(repoPath, { recursive: true });
  run("git", ["init", "-b", "main"], repoPath);
  configureRepoUser(repoPath);
  fs.writeFileSync(path.resolve(repoPath, fileName), initialContent, "utf8");
  run("git", ["add", fileName], repoPath);
  run("git", ["commit", "-m", "initial commit"], repoPath);
}

function createBareRemote(remotePath: string, cwd: string) {
  run("git", ["init", "--bare", remotePath], cwd);
}

function createFixtures() {
  const root = fs.mkdtempSync(path.resolve(os.tmpdir(), "opencherry-e2e-"));
  const configHome = path.resolve(root, "config-home");
  const workspaceRoot = path.resolve(root, "workspace");
  const trackedRepoPath = path.resolve(workspaceRoot, "tracked-repo");
  const commitAllRepoPath = path.resolve(workspaceRoot, "commit-all-repo");
  const publishRepoPath = path.resolve(workspaceRoot, "publish-repo");
  const publishRemotePath = path.resolve(workspaceRoot, "publish-remote.git");
  const syncSeedRepoPath = path.resolve(workspaceRoot, "sync-seed-repo");
  const syncRepoPath = path.resolve(workspaceRoot, "sync-repo");
  const syncRemotePath = path.resolve(workspaceRoot, "sync-remote.git");
  const syncPusherRepoPath = path.resolve(workspaceRoot, "sync-pusher-repo");
  const groupPath = path.resolve(workspaceRoot, "workspace-group");
  const childRepoPath = path.resolve(groupPath, "child-repo");
  const childToolsRepoPath = path.resolve(groupPath, "tools-repo");

  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(groupPath, { recursive: true });

  createRepo(trackedRepoPath, "tracked.txt", "tracked base\n");
  createRepo(commitAllRepoPath, "all.txt", "commit all base\n");
  createRepo(childRepoPath, "child.txt", "child base\n");
  createRepo(childToolsRepoPath, "tools.txt", "tools base\n");

  createBareRemote(publishRemotePath, workspaceRoot);
  createRepo(publishRepoPath, "publish.txt", "publish base\n");
  run("git", ["remote", "add", "origin", publishRemotePath], publishRepoPath);

  createBareRemote(syncRemotePath, workspaceRoot);
  createRepo(syncSeedRepoPath, "sync.txt", "sync base\n");
  run("git", ["remote", "add", "origin", syncRemotePath], syncSeedRepoPath);
  run("git", ["push", "-u", "origin", "main"], syncSeedRepoPath);
  run("git", ["clone", "--branch", "main", syncRemotePath, syncRepoPath], workspaceRoot);
  run("git", ["clone", "--branch", "main", syncRemotePath, syncPusherRepoPath], workspaceRoot);
  configureRepoUser(syncPusherRepoPath);
  fs.writeFileSync(path.resolve(syncPusherRepoPath, "sync.txt"), "sync base\nremote update\n", "utf8");
  run("git", ["commit", "-am", "remote update"], syncPusherRepoPath);
  run("git", ["push", "origin", "main"], syncPusherRepoPath);
  run("git", ["fetch", "origin"], syncRepoPath);

  fs.writeFileSync(path.resolve(trackedRepoPath, "tracked.txt"), "tracked base\nupdated line\n", "utf8");
  fs.writeFileSync(path.resolve(trackedRepoPath, "scratch.txt"), "untracked file\n", "utf8");
  fs.writeFileSync(path.resolve(commitAllRepoPath, "all.txt"), "commit all base\nupdated line\n", "utf8");
  fs.writeFileSync(path.resolve(commitAllRepoPath, "extra.txt"), "extra file\n", "utf8");
  fs.writeFileSync(path.resolve(publishRepoPath, "publish.txt"), "publish base\nlocal publish change\n", "utf8");

  fs.writeFileSync(path.resolve(childRepoPath, "child.txt"), "child base\nchild changed\n", "utf8");
  fs.writeFileSync(path.resolve(childToolsRepoPath, "tools.txt"), "tools base\ntools changed\n", "utf8");

  writeLegacyRepos(configHome, [
    {
      id: repoIdForPath(trackedRepoPath),
      path: trackedRepoPath,
      display_name: path.basename(trackedRepoPath),
      kind: "repo",
    },
    {
      id: repoIdForPath(commitAllRepoPath),
      path: commitAllRepoPath,
      display_name: path.basename(commitAllRepoPath),
      kind: "repo",
    },
    {
      id: repoIdForPath(publishRepoPath),
      path: publishRepoPath,
      display_name: path.basename(publishRepoPath),
      kind: "repo",
    },
    {
      id: repoIdForPath(syncRepoPath),
      path: syncRepoPath,
      display_name: path.basename(syncRepoPath),
      kind: "repo",
    },
    {
      id: repoIdForPath(groupPath),
      path: groupPath,
      display_name: path.basename(groupPath),
      kind: "group",
    },
  ]);

  return {
    root,
      configHome,
      trackedRepoPath,
      commitAllRepoPath,
      publishRepoPath,
      syncRepoPath,
      groupPath,
      childRepoPath,
      childToolsRepoPath,
    };
}

function applicationPath() {
  const binary = process.platform === "win32" ? "opencherry-desktop.exe" : "opencherry-desktop";
  return path.resolve(workspaceDir, "target", "debug", binary);
}

function tauriDriverPath() {
  const binary = process.platform === "win32" ? "tauri-driver.exe" : "tauri-driver";
  return path.resolve(os.homedir(), ".cargo", "bin", binary);
}

function closeTauriDriver() {
  exit = true;
  tauriDriver?.kill();
  if (fixtureRoot) {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fixtureRoot = undefined;
  }
}

function onShutdown(fn: () => void) {
  const cleanup = () => {
    try {
      fn();
    } finally {
      process.exit();
    }
  };

  process.on("exit", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("SIGHUP", cleanup);
}

onShutdown(() => closeTauriDriver());

export const config: WebdriverIO.Config = {
  host: "127.0.0.1",
  port: 4444,
  specs: ["./specs/**/*.ts"],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      "tauri:options": {
        application: applicationPath(),
      },
    },
  ],
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 120000,
  },
  onPrepare: () => {
    spawnSync("pnpm", ["build"], {
      cwd: desktopDir,
      stdio: "inherit",
      shell: true,
    });
    spawnSync("cargo", ["build"], {
      cwd: tauriDir,
      stdio: "inherit",
      shell: true,
    });
  },
  beforeSession: () => {
    const fixtures = createFixtures();
    fixtureRoot = fixtures.root;
    process.env.OPENCHERRY_E2E_TRACKED_REPO_PATH = fixtures.trackedRepoPath;
    process.env.OPENCHERRY_E2E_COMMIT_ALL_REPO_PATH = fixtures.commitAllRepoPath;
    process.env.OPENCHERRY_E2E_PUBLISH_REPO_PATH = fixtures.publishRepoPath;
    process.env.OPENCHERRY_E2E_SYNC_REPO_PATH = fixtures.syncRepoPath;
    process.env.OPENCHERRY_E2E_GROUP_PATH = fixtures.groupPath;
    process.env.OPENCHERRY_E2E_CHILD_REPO_PATH = fixtures.childRepoPath;
    process.env.OPENCHERRY_E2E_CHILD_TOOLS_REPO_PATH = fixtures.childToolsRepoPath;
    tauriDriver = spawn(tauriDriverPath(), ["--native-driver", "/usr/bin/WebKitWebDriver"], {
      stdio: [null, process.stdout, process.stderr],
      env: {
        ...process.env,
        XDG_CONFIG_HOME: fixtures.configHome,
      },
    });
    tauriDriver.on("error", (error) => {
      console.error("tauri-driver error:", error);
      process.exit(1);
    });
    tauriDriver.on("exit", (code) => {
      if (!exit) {
        console.error("tauri-driver exited with code:", code);
        process.exit(1);
      }
    });
  },
  afterSession: () => {
    closeTauriDriver();
  },
};
