import { getHubHttp } from "../mesh/identity";

export async function ghStatus(hub = getHubHttp()) {
  const r = await fetch(`${hub}/api/gh/status`);
  return r.json();
}

export async function ghClone(repo: string, name?: string, hub = getHubHttp()) {
  const r = await fetch(`${hub}/api/gh/clone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo, name }),
  });
  return r.json();
}

export async function ghPush(cwd?: string, message?: string, hub = getHubHttp()) {
  const r = await fetch(`${hub}/api/gh/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, message }),
  });
  return r.json();
}

export async function ghRun(args: string[], cwd?: string, hub = getHubHttp()) {
  const r = await fetch(`${hub}/api/gh/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ args, cwd }),
  });
  return r.json();
}

export async function ghRepos(hub = getHubHttp()) {
  const r = await fetch(`${hub}/api/gh/repos`);
  return r.json();
}
