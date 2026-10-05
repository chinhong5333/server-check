const shellQuote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

/** Builds a single-line command from the canonical generated cron schedule and a safe absolute script path. */
export function buildAgentSetup(crontabEntry: string, scriptPath: string) {
  const path = scriptPath.trim();
  if (!/^\/[A-Za-z0-9._/-]+\.sh$/.test(path) || path.length > 1024 || path.slice(1).split("/").some(part => !part || part === "." || part === ".." || part.length > 255)) {
    return { filename: null, cronEntry: null, command: null, commands: null, error: "Use an absolute Linux path ending in .sh. Use letters, numbers, dots, hyphens, underscores, and slashes only." };
  }
  const filename = path.slice(path.lastIndexOf("/") + 1);
  const schedule = crontabEntry.match(/^((?:\*|\*\/(?:1|2|3|4|5|6|10|12|15|20|30)|0) \* \* \* \*) \/bin\/sh [^\r\n]+$/)?.[1];
  if (!schedule) return { filename, cronEntry: null, command: null, commands: null, error: "The generated cron schedule is unsupported. Generate the agent script again." };
  const quotedPath = shellQuote(path), cron = `${schedule} /bin/sh ${quotedPath}`, quotedCron = shellQuote(cron);
  const commands = {
    permissions: `chmod 700 ${quotedPath}`,
    cron: `(crontab -l 2>/dev/null | grep -F -x -v -- ${quotedCron}; printf '%s\\n' ${quotedCron}) | crontab -`,
    run: `/bin/sh ${quotedPath}`
  };
  return {
    filename, cronEntry: cron, error: null, commands,
    command: `${commands.permissions} && ${commands.cron} && ${commands.run}`
  };
}
