import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const databaseName = "voting";
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const wranglerCli = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);

function requestedTarget(arguments_) {
  const remote = arguments_.includes("--remote");
  const local = arguments_.includes("--local");
  if (remote === local) {
    throw new Error("Bitte genau ein Ziel angeben: --remote oder --local.");
  }
  return remote ? "remote" : "local";
}

async function confirmReset(target) {
  const confirmation = `RESET ${databaseName}`;
  const label = target === "remote" ? "gehostete Cloudflare-D1-Datenbank" : "lokale D1-Datenbank";
  process.stdout.write(
    `\nACHTUNG: Damit werden alle Challenge-, Team-, Jury- und Bewertungsdaten aus der ${label} gelöscht.\n` +
      "Schema, Migrationen und Cloudflare-Secrets bleiben erhalten.\n\n",
  );

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`Zum Fortfahren exakt \"${confirmation}\" eingeben: `);
    return answer === confirmation;
  } finally {
    prompt.close();
  }
}

async function main() {
  let target;
  try {
    target = requestedTarget(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
    return;
  }

  if (!(await confirmReset(target))) {
    process.stdout.write("Abgebrochen – die Datenbank wurde nicht verändert.\n");
    return;
  }

  const result = spawnSync(
    process.execPath,
    [
      wranglerCli,
      "d1",
      "execute",
      databaseName,
      `--${target}`,
      "--file=scripts/reset-database.sql",
      "--yes",
    ],
    { cwd: repositoryRoot, stdio: "inherit" },
  );

  if (result.error) {
    process.stderr.write(`Wrangler konnte nicht gestartet werden: ${result.error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    return;
  }

  process.stdout.write("\nDatenbank zurückgesetzt. Die nächste Challenge kann angelegt werden.\n");
}

await main();
