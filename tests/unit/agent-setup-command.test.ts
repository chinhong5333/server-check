import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { buildAgentSetup } from "../../src/client/lib/agent-setup";

it.each(["*/1 * * * *", "*/2 * * * *", "0 * * * *"])("keeps the configured %s schedule when regenerating the one-line command", schedule => {
  const result = buildAgentSetup(`${schedule} /bin/sh '/opt/server-check/original.sh'`, "/root/myfile.sh");
  expect(result.error).toBeNull(); expect(result.filename).toBe("myfile.sh");
  expect(result.cronEntry).toBe(`${schedule} /bin/sh '/root/myfile.sh'`);
  expect(result.command).toContain("chmod 700 '/root/myfile.sh' &&");
  expect(result.command).toContain("grep -F -x -v --");
  expect(result.command?.endsWith("| crontab - && /bin/sh '/root/myfile.sh'")).toBe(true);
  expect(result.command).not.toMatch(/[\r\n]/); expect(result.command).not.toContain("original.sh");
});
it.each(["/root/unsafe;touch-attacker.sh", "/root/first\nsecond.sh"])("rejects unsafe script path %s instead of creating a runnable command", scriptPath => {
  const result = buildAgentSetup("*/2 * * * * /bin/sh '/opt/original.sh'", scriptPath);
  expect(result.command).toBeNull(); expect(result.error).toContain("absolute Linux path");
});
it("fails clearly for an unsupported generated cron contract", () => {
  expect(buildAgentSetup("99 * * * * evil-command", "/root/myfile.sh").command).toBeNull();
});
const shell = "C:\\Program Files\\Git\\bin\\sh.exe";
it.skipIf(!existsSync(shell))("executes against a disposable fake crontab while preserving jobs and preventing duplicates", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "server-check-setup-"));
  const linux = (value: string) => value.replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`).replaceAll("\\", "/");
  try {
    const bin=path.join(directory,"bin"),script=path.join(directory,"agent.sh"),cron=path.join(directory,"cron.txt"),runs=path.join(directory,"runs.txt");mkdirSync(bin);
    writeFileSync(script,"#!/bin/sh\nprintf 'ran\\n' >> \"$SETUP_TEST_RUNS\"\n");
    writeFileSync(path.join(bin,"crontab"),"#!/bin/sh\nif [ \"$1\" = '-l' ]; then cat \"$SETUP_TEST_CRON\"; else cat > \"$SETUP_TEST_CRON.incoming\" && mv \"$SETUP_TEST_CRON.incoming\" \"$SETUP_TEST_CRON\"; fi\n");chmodSync(path.join(bin,"crontab"),0o700);
    const original="17 * * * * echo retained\n";writeFileSync(cron,original);
    const generated=buildAgentSetup("*/2 * * * * /bin/sh '/opt/original.sh'",linux(script));expect(generated.command).not.toBeNull();
    expect(generated.command).toBe(`${generated.commands?.permissions} && ${generated.commands?.cron} && ${generated.commands?.run}`);
    const command=`export PATH='${linux(bin)}':"$PATH"; chmod 700 '${linux(path.join(bin,"crontab"))}'; ${generated.command}`;
    const env={...process.env,SETUP_TEST_CRON:linux(cron),SETUP_TEST_RUNS:linux(runs)};
    expect(spawnSync(shell,["-c",command],{env,encoding:"utf8"}).status).toBe(0);
    expect(spawnSync(shell,["-c",command],{env,encoding:"utf8"}).status).toBe(0);
    const lines=readFileSync(cron,"utf8").split("\n");expect(lines).toContain(original.trim());expect(lines.filter(line=>line===generated.cronEntry)).toHaveLength(1);
    expect(readFileSync(runs,"utf8").trim().split("\n")).toHaveLength(2);
  } finally {
    const resolved=path.resolve(directory),prefix=path.resolve(tmpdir())+path.sep+"server-check-setup-";
    if(!resolved.startsWith(prefix))throw new Error("Unsafe setup fixture cleanup.");rmSync(resolved,{recursive:true,force:true});
  }
});
