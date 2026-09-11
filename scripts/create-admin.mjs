#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

const HELP = `Create an internal Server Check administrator.

Usage:
  npm run create-admin

Prerequisites:
  1. Configure database and JWT settings in .env.
  2. Run npm run setup to apply migrations.
  3. Run this command in an interactive terminal.

The password is entered interactively, masked, hashed with scrypt, and never
read from or written to .env.
`;

export function validateAdminEmail(value) {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { valid: false, value: email, message: "Enter a valid email address." };
  }
  return { valid: true, value: email, message: null };
}

export function validateAdminPassword(value) {
  if (value.length < 8) {
    return { valid: false, message: "Password must contain at least 8 characters." };
  }
  if (value.length > 128) {
    return { valid: false, message: "Password must contain no more than 128 characters." };
  }
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/[0-9]/.test(value) || !/[^A-Za-z0-9\s]/.test(value)) {
    return { valid: false, message: "Password must include uppercase and lowercase letters, a number, and a symbol." };
  }
  return { valid: true, message: null };
}

export function readHiddenLine(label, input = stdin, output = stdout) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("Administrator passwords must be entered in an interactive terminal.");
  }

  output.write(label);
  return new Promise((resolve, reject) => {
    let value = "";
    const wasRaw = Boolean(input.isRaw);

    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode(wasRaw);
      input.pause();
    };

    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          cleanup();
          output.write("\n");
          reject(new Error("Administrator creation cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          output.write("\n");
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            output.write("\b \b");
          }
          continue;
        }
        if (character >= " " && character !== "\u007f") {
          value += character;
          output.write("*");
        }
      }
    };

    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function promptEmail() {
  const interface_ = createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      const result = validateAdminEmail(await interface_.question("Admin email: "));
      if (result.valid) return result.value;
      stdout.write(`${result.message}\n`);
    }
  } finally {
    interface_.close();
  }
}

async function promptPassword() {
  while (true) {
    const password = await readHiddenLine("Admin password: ");
    const validation = validateAdminPassword(password);
    if (!validation.valid) {
      stdout.write(`${validation.message}\n`);
      continue;
    }
    const confirmation = await readHiddenLine("Confirm password: ");
    if (password !== confirmation) {
      stdout.write("Passwords do not match. Try again.\n");
      continue;
    }
    return password;
  }
}

async function createAdministrator() {
  const [
    { loadConfig },
    { closePool, getPool, verifyDatabaseConnection, withTransaction },
    { hashPassword }
  ] =
    await Promise.all([
      import("../dist/server/server/config.js"),
      import("../dist/server/server/db.js"),
      import("../dist/server/server/security/crypto.js")
    ]);

  const config = loadConfig();
  try {
    try {
      await verifyDatabaseConnection(config);
      await getPool(config).query("SELECT 1 FROM internal_users LIMIT 0");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/doesn't exist|no such table/i.test(message)) {
        throw new Error("Database tables are missing. Run npm run setup before npm run create-admin.");
      }
      throw new Error(`Database connection failed. Configure .env and run npm run setup first. ${message}`);
    }

    const email = await promptEmail();
    const password = await promptPassword();
    const passwordHash = await hashPassword(password);
    const publicId = randomUUID();
    const now = Date.now();

    await withTransaction(config, async (connection) => {
      const [rows] = await connection.execute(
        "SELECT id FROM internal_users WHERE email = ? AND is_delete = 0 LIMIT 1",
        [email]
      );
      if (rows[0]) throw new Error("An active internal user already uses that email address.");

      const [result] = await connection.execute(
        `INSERT INTO internal_users
          (public_id, email, password_hash, role, failed_login_count, locked_until, last_login_at,
           created_at, updated_at, is_delete)
         VALUES (?, ?, ?, 'admin', 0, NULL, NULL, ?, ?, 0)`,
        [publicId, email, passwordHash, now, now]
      );
      await connection.execute(
        `INSERT INTO audit_events
          (user_id, project_id, action, entity_type, entity_id, metadata_json,
           created_at, updated_at, is_delete)
         VALUES (?, NULL, 'admin.create.interactive', 'internal_user', ?, ?, ?, ?, 0)`,
        [result.insertId, publicId, JSON.stringify({ email, source: "interactive_cli" }), now, now]
      );
    });
    stdout.write(`Created administrator ${email}.\n`);
  } finally {
    await closePool();
  }
}

export async function main(arguments_ = process.argv.slice(2)) {
  if (arguments_.includes("--help") || arguments_.includes("-h")) {
    stdout.write(HELP);
    return;
  }
  await createAdministrator();
}

const entryPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
