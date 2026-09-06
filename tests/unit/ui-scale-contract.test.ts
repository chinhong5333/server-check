import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("platform UI scale", () => {
  it("reduces the global rem scale by ten percent while preserving minimum control heights", async () => {
    const styles = await readFile(path.resolve("src/client/styles.css"), "utf8");
    const tokens = await readFile(path.resolve("tokens.css"), "utf8");

    expect(styles).toMatch(/html\s*\{[^}]*font-size:\s*90%;[^}]*\}/s);
    expect(tokens).toMatch(/--control-height:\s*3\.0556rem;/);
  });
});
