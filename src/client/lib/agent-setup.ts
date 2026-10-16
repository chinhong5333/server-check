const shellQuote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

/** Plain-language cron cadence, e.g. "Every Minute" or "Every 5 Minutes". */
function describeSchedule(schedule: string): string {
  if (schedule === "0 * * * *") return "Every Hour";
  const minutes = schedule.startsWith("*/") ? Number(schedule.slice(2, schedule.indexOf(" "))) : 1;
  return minutes === 1 ? "Every Minute" : `Every ${minutes} Minutes`;
}

/** Builds a single-line command from the canonical generated cron schedule and a safe absolute script path. */
export function buildAgentSetup(crontabEntry: string, scriptPath: string) {
  const path = scriptPath.trim();
  if (!/^\/[A-Za-z0-9._/-]+\.sh$/.test(path) || path.length > 1024 || path.slice(1).split("/").some(part => !part || part === "." || part === ".." || part.length > 255)) {
    return { filename: null, cronEntry: null, scheduleLabel: null, command: null, commands: null, error: "Use an absolute Linux path ending in .sh. Use letters, numbers, dots, hyphens, underscores, and slashes only." };
  }
  const filename = path.slice(path.lastIndexOf("/") + 1);
  const schedule = crontabEntry.match(/^((?:\*|\*\/(?:1|2|3|4|5|6|10|12|15|20|30)|0) \* \* \* \*) \/bin\/sh [^\r\n]+$/)?.[1];
  if (!schedule) return { filename, cronEntry: null, scheduleLabel: null, command: null, commands: null, error: "The generated cron schedule is unsupported. Generate the agent script again." };
  const quotedPath = shellQuote(path), cron = `${schedule} /bin/sh ${quotedPath}`, quotedCron = shellQuote(cron);
  const commands = {
    permissions: `chmod 700 ${quotedPath}`,
    cron: `(crontab -l 2>/dev/null | grep -F -x -v -- ${quotedCron}; printf '%s\\n' ${quotedCron}) | crontab -`,
    run: `/bin/sh ${quotedPath}`
  };
  return {
    filename, cronEntry: cron, scheduleLabel: describeSchedule(schedule), error: null, commands,
    command: `${commands.permissions} && ${commands.cron} && ${commands.run}`
  };
}
