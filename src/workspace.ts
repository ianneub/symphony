import { execSync } from "child_process";
import { existsSync, rmSync, mkdirSync } from "fs";
import { resolve, relative } from "path";
import { logger } from "./logger.js";

export function sanitizeIssueName(issueNumber: number): string {
  return `issue-${issueNumber}`;
}

export function workspacePath(root: string, issueNumber: number): string {
  return resolve(root, sanitizeIssueName(issueNumber));
}

export function validateWorkspacePath(root: string, wsPath: string): void {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(wsPath);
  const rel = relative(resolvedRoot, resolvedPath);
  if (rel.startsWith("..") || resolve(resolvedRoot, rel) !== resolvedPath) {
    throw new Error(`Workspace path ${wsPath} is outside workspace root ${root}`);
  }
}

export async function createWorkspace(
  root: string,
  issueNumber: number,
  repoUrl: string,
  defaultBranch: string = "main"
): Promise<string> {
  const wsPath = workspacePath(root, issueNumber);
  validateWorkspacePath(root, wsPath);

  const log = logger.child({ issue: issueNumber, workspace: wsPath });

  if (!existsSync(resolve(root))) {
    mkdirSync(resolve(root), { recursive: true });
  }

  if (existsSync(wsPath)) {
    log.info("Workspace already exists, reusing");
    try {
      execSync(`git fetch origin ${defaultBranch} && git rebase origin/${defaultBranch}`, {
        cwd: wsPath,
        stdio: "pipe",
      });
    } catch (err) {
      log.warn({ err }, "Failed to pull latest, continuing with existing workspace");
    }
    return wsPath;
  }

  log.info("Creating workspace");
  execSync(`git clone --depth=1 ${repoUrl} ${wsPath}`, { stdio: "pipe" });

  const branchName = `symphony/issue-${issueNumber}`;
  execSync(`git checkout -b ${branchName}`, { cwd: wsPath, stdio: "pipe" });

  log.info({ branch: branchName }, "Workspace created");
  return wsPath;
}

export function cleanupWorkspace(root: string, issueNumber: number): void {
  const wsPath = workspacePath(root, issueNumber);
  validateWorkspacePath(root, wsPath);

  if (existsSync(wsPath)) {
    rmSync(wsPath, { recursive: true, force: true });
    logger.info({ issue: issueNumber, workspace: wsPath }, "Workspace cleaned up");
  }
}
