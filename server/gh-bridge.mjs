/**
 * Real GitHub bridge via official `gh` CLI (when installed on PC hub).
 * No mock data — runs actual gh commands and returns stdout/stderr.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);

const GH = process.env.GH_PATH || "gh";
const DEFAULT_WORK = path.join(os.homedir(), "GridCallerHub");

function safeCwd(cwd) {
  if (!cwd) return DEFAULT_WORK;
  const resolved = path.resolve(cwd);
  // prevent escaping silly paths — allow D:\ GridAlive etc under drives
  if (!/^[A-Za-z]:\\/.test(resolved) && !resolved.startsWith("/")) {
    throw new Error("Invalid cwd");
  }
  return resolved;
}

export async function ghAvailable() {
  try {
    const { stdout } = await execFileAsync(GH, ["--version"], { timeout: 8000 });
    return { ok: true, version: String(stdout).trim().split("\n")[0] };
  } catch (e) {
    return {
      ok: false,
      error: e?.message || "gh not found",
      hint: "Install: https://cli.github.com/  then: gh auth login",
    };
  }
}

export async function ghAuthStatus() {
  try {
    const { stdout, stderr } = await execFileAsync(GH, ["auth", "status"], {
      timeout: 12000,
    });
    return { ok: true, out: (stdout || stderr || "").trim() };
  } catch (e) {
    return {
      ok: false,
      out: String(e?.stdout || e?.stderr || e?.message || "not logged in"),
    };
  }
}

export async function runGh(args, opts = {}) {
  if (!Array.isArray(args) || !args.length) throw new Error("args required");
  // block shell injection — only pass array args to execFile
  const forbidden = args.some((a) => /[;&|`$]/.test(String(a)));
  if (forbidden) throw new Error("Unsafe gh args");

  const cwd = opts.cwd ? safeCwd(opts.cwd) : undefined;
  if (cwd && !fs.existsSync(cwd)) fs.mkdirSync(cwd, { recursive: true });

  const { stdout, stderr } = await execFileAsync(GH, args.map(String), {
    cwd,
    timeout: opts.timeout || 120000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env },
  });
  return {
    ok: true,
    stdout: String(stdout || ""),
    stderr: String(stderr || ""),
  };
}

/** Clone or pull GridAlive / any repo into hub workdir */
export async function cloneOrPull(repo, destName) {
  const work = DEFAULT_WORK;
  fs.mkdirSync(work, { recursive: true });
  const name =
    destName ||
    String(repo)
      .replace(/\.git$/, "")
      .split(/[\/:]/)
      .pop() ||
    "repo";
  const dest = path.join(work, name);

  if (fs.existsSync(path.join(dest, ".git"))) {
    const r = await runGh(["repo", "sync"], { cwd: dest }).catch(async () => {
      // fallback git pull via gh api not needed — use git
      return execFileAsync("git", ["pull", "--ff-only"], {
        cwd: dest,
        timeout: 180000,
        maxBuffer: 8 * 1024 * 1024,
      }).then(({ stdout, stderr }) => ({
        ok: true,
        stdout: String(stdout),
        stderr: String(stderr),
      }));
    });
    return { ok: true, action: "pull", path: dest, ...r };
  }

  // gh repo clone owner/name dest
  const repoArg = String(repo).replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
  const r = await runGh(["repo", "clone", repoArg, dest], { timeout: 300000 });
  return { ok: true, action: "clone", path: dest, ...r };
}

export async function pushRepo(cwd, message = "GridCaller hub push") {
  const dir = safeCwd(cwd);
  // stage + commit if needed via git, push via gh/git
  try {
    await execFileAsync("git", ["add", "-A"], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", message], { cwd: dir }).catch(() => null);
  } catch {}
  try {
    const { stdout, stderr } = await execFileAsync("git", ["push"], {
      cwd: dir,
      timeout: 180000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, stdout: String(stdout), stderr: String(stderr), path: dir };
  } catch (e) {
    return {
      ok: false,
      error: e?.message,
      stderr: String(e?.stderr || ""),
      path: dir,
    };
  }
}

export function defaultWorkDir() {
  return DEFAULT_WORK;
}

export async function listHubRepos() {
  const work = DEFAULT_WORK;
  if (!fs.existsSync(work)) return [];
  return fs
    .readdirSync(work, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const p = path.join(work, d.name);
      return {
        name: d.name,
        path: p,
        isGit: fs.existsSync(path.join(p, ".git")),
      };
    });
}
