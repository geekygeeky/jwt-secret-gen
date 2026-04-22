#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { resolve } from "path";

// ─── ANSI colours ────────────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  bgGreen: "\x1b[42m",
  bgBlue: "\x1b[44m",
  white: "\x1b[37m",
};

const bold = (s: string) => `${c.bold}${s}${c.reset}`;
const dim = (s: string) => `${c.dim}${s}${c.reset}`;
const green = (s: string) => `${c.green}${s}${c.reset}`;
const cyan = (s: string) => `${c.cyan}${s}${c.reset}`;
const yellow = (s: string) => `${c.yellow}${s}${c.reset}`;
const red = (s: string) => `${c.red}${s}${c.reset}`;
const magenta = (s: string) => `${c.magenta}${s}${c.reset}`;
const blue = (s: string) => `${c.blue}${s}${c.reset}`;

// ─── CLI arg parsing ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = {
  help: args.includes("--help") || args.includes("-h"),
  version: args.includes("--version") || args.includes("-v"),
  yes: args.includes("--yes") || args.includes("-y"),
  print: args.includes("--print"),
  env: args.includes("--env"),
  multiple: args.includes("--multiple") || args.includes("-m"),
  noColor: args.includes("--no-color"),
  algorithm: getFlagValue("--algorithm") ?? getFlagValue("-a"),
  keyName: getFlagValue("--key") ?? getFlagValue("-k"),
  bits: getFlagValue("--bits") ?? getFlagValue("-b"),
  count: getFlagValue("--count") ?? getFlagValue("-c"),
  envFile: getFlagValue("--env-file"),
};

function getFlagValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const VERSION = "1.0.0";
const ALGORITHMS = ["HS256", "HS384", "HS512"] as const;
type Algorithm = (typeof ALGORITHMS)[number];

const ALGO_BITS: Record<Algorithm, number> = {
  HS256: 256,
  HS384: 384,
  HS512: 512,
};

const STRENGTH_LABELS: Record<number, string> = {
  128: yellow("Weak"),
  256: green("Strong"),
  384: green("Very Strong"),
  512: cyan("Maximum"),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function prompt(question: string): string {
  process.stdout.write(question);
  const buf = Buffer.alloc(1024);
  const n = require("fs").readSync(0, buf, 0, buf.length, null);
  return buf.slice(0, n).toString().trim();
}

function confirm(question: string, defaultYes = false): boolean {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = prompt(`${question} ${dim(hint)} `).toLowerCase();
  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
}

function select<T extends string>(question: string, options: T[], defaultIdx = 0): T {
  console.log(`\n${question}`);
  options.forEach((opt, i) => {
    const marker = i === defaultIdx ? green("❯") : " ";
    const num = dim(`${i + 1}.`);
    console.log(`  ${marker} ${num} ${opt}`);
  });
  const answer = prompt(`\n${dim("Enter number")} ${dim(`[${defaultIdx + 1}]`)}: `);
  const idx = parseInt(answer) - 1;
  if (isNaN(idx) || idx < 0 || idx >= options.length) return options[defaultIdx];
  return options[idx];
}

function generateSecret(bits: number): string {
  const bytes = bits / 8;
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Buffer.from(arr).toString("base64url");
}

function strengthBar(bits: number): string {
  const levels: [number, string][] = [
    [128, red("██░░░░░░░░")],
    [256, yellow("████░░░░░░")],
    [384, green("███████░░░")],
    [512, cyan("██████████")],
  ];
  for (const [threshold, bar] of levels) {
    if (bits <= threshold) return bar;
  }
  return levels[levels.length - 1][1];
}

function entropyBits(secret: string): number {
  // base64url: each char = 6 bits
  return secret.length * 6;
}

function printBanner() {
  console.log(`
${bold(cyan(" ╔═══════════════════════════════════╗"))}
${bold(cyan(" ║"))}  ${bold("🔐 JWT Secret Generator")}  ${bold(dim(`v${VERSION}`))}  ${bold(cyan("║"))}
${bold(cyan(" ╚═══════════════════════════════════╝"))}
`);
}

function printHelp() {
  console.log(`
${bold("JWT Secret Generator")} ${dim(`v${VERSION}`)}
${dim("Generate cryptographically secure JWT secrets")}

${bold("USAGE")}
  ${cyan("bunx jwt-secret-gen")} ${dim("[flags]")}
  ${cyan("npx jwt-secret-gen")} ${dim("[flags]")}

${bold("FLAGS")}
  ${green("-h, --help")}           Show this help
  ${green("-v, --version")}        Show version
  ${green("-y, --yes")}            Skip prompts, use defaults
  ${green("--print")}              Print secret to stdout only (pipe-friendly)
  ${green("--env")}                Write directly to .env file (skip prompt)
  ${green("-m, --multiple")}       Generate multiple secrets at once
  ${green("-a, --algorithm")}      Algorithm: HS256 | HS384 | HS512 ${dim("(default: HS512)")}
  ${green("-b, --bits")}           Custom bit length: 128 | 256 | 384 | 512 ${dim("(default: from algo)")}
  ${green("-k, --key")}            .env key name ${dim("(default: JWT_SECRET)")}
  ${green("-c, --count")}          Number of secrets to generate ${dim("(default: 1)")}
  ${green("--env-file")}           Path to .env file ${dim("(default: .env)")}
  ${green("--no-color")}           Disable color output

${bold("EXAMPLES")}
  ${dim("# Interactive mode")}
  bunx jwt-secret-gen

  ${dim("# Print secret only (for scripting)")}
  bunx jwt-secret-gen --print --algorithm HS512

  ${dim("# Write JWT_SECRET + JWT_REFRESH_SECRET to .env")}
  bunx jwt-secret-gen --env --multiple --key JWT_SECRET

  ${dim("# Use in shell script")}
  SECRET=$(bunx jwt-secret-gen --print -y)
`);
}

function writeEnvKey(
  envPath: string,
  key: string,
  value: string
): "created" | "updated" | "appended" {
  if (!existsSync(envPath)) {
    writeFileSync(envPath, `${key}="${value}"\n`);
    return "created";
  }

  const content = readFileSync(envPath, "utf-8");
  const lines = content.split("\n");
  const keyIndex = lines.findIndex((l) => l.match(new RegExp(`^${key}\\s*=`)));

  if (keyIndex !== -1) {
    lines[keyIndex] = `${key}="${value}"`;
    writeFileSync(envPath, lines.join("\n"));
    return "updated";
  }

  // Append — ensure file ends with newline
  const needsNewline = content.length > 0 && !content.endsWith("\n");
  appendFileSync(envPath, `${needsNewline ? "\n" : ""}${key}="${value}"\n`);
  return "appended";
}

function printSecretInfo(secret: string, bits: number, algo: string) {
  const entropy = entropyBits(secret);
  const strength = STRENGTH_LABELS[bits] ?? green("Custom");
  const bar = strengthBar(bits);

  console.log(`
  ${bold("Secret")}     ${cyan(secret)}
  ${bold("Algorithm")}  ${magenta(algo)}
  ${bold("Bits")}       ${blue(String(bits))}
  ${bold("Entropy")}    ${blue(`~${entropy} bits`)}
  ${bold("Strength")}   ${bar}  ${strength}
`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (flags.help) {
    printHelp();
    process.exit(0);
  }

  if (flags.version) {
    console.log(VERSION);
    process.exit(0);
  }

  // ── Pipe-friendly mode: --print with no interactivity ──
  if (flags.print && flags.yes) {
    const algo = (flags.algorithm?.toUpperCase() as Algorithm) ?? "HS512";
    const bits = flags.bits ? parseInt(flags.bits) : ALGO_BITS[algo] ?? 512;
    const secret = generateSecret(bits);
    process.stdout.write(secret + "\n");
    process.exit(0);
  }

  printBanner();

  // ── Determine algorithm ───────────────────────────────
  let algo: Algorithm;
  if (flags.algorithm) {
    const upper = flags.algorithm.toUpperCase() as Algorithm;
    if (!ALGORITHMS.includes(upper)) {
      console.log(red(`Unknown algorithm "${flags.algorithm}". Using HS512.`));
      algo = "HS512";
    } else {
      algo = upper;
    }
  } else if (flags.yes) {
    algo = "HS512";
  } else {
    const choice = select(
      bold("Which JWT algorithm will you use?"),
      [
        `HS256  ${dim("— 256-bit  · Fast · Common")}`,
        `HS384  ${dim("— 384-bit  · Balanced")}`,
        `HS512  ${dim("— 512-bit  · Maximum security")} ${green("(recommended)")}`,
      ],
      2
    );
    algo = choice.split(" ")[0] as Algorithm;
  }

  const bits = flags.bits ? parseInt(flags.bits) : ALGO_BITS[algo];

  // ── Multiple secrets? ─────────────────────────────────
  let generateMultiple = flags.multiple;
  if (!flags.yes && !flags.multiple && !flags.print && !flags.env) {
    generateMultiple = confirm(
      `\n${bold("Generate multiple secrets?")} ${dim("(e.g. access + refresh tokens)")}`,
      false
    );
  }

  const count = generateMultiple
    ? flags.count
      ? parseInt(flags.count)
      : flags.yes
        ? 2
        : parseInt(prompt(`\n${bold("How many secrets?")} ${dim("[2]")}: `) || "2")
    : 1;

  // ── Generate secrets ──────────────────────────────────
  const secrets: Array<{ key: string; secret: string }> = [];

  for (let i = 0; i < count; i++) {
    const secret = generateSecret(bits);
    let key: string;

    if (flags.keyName && count === 1) {
      key = flags.keyName;
    } else if (flags.yes) {
      key = count === 1 ? "JWT_SECRET" : i === 0 ? "JWT_SECRET" : `JWT_REFRESH_SECRET`;
    } else {
      const defaultKey =
        count === 1 ? "JWT_SECRET" : i === 0 ? "JWT_SECRET" : `JWT_REFRESH_SECRET`;
      const entered = prompt(
        `\n${bold(`Key name for secret ${i + 1}`)} ${dim(`[${defaultKey}]`)}: `
      );
      key = entered || defaultKey;
    }

    secrets.push({ key, secret });
  }

  // ── Display generated secrets ─────────────────────────
  console.log(`\n${bold(green("✔ Generated Secret" + (secrets.length > 1 ? "s" : "")))}:`);
  for (const { key, secret } of secrets) {
    console.log(`\n  ${bold(yellow(key))}`);
    printSecretInfo(secret, bits, algo);
  }

  // ── Pipe mode: just print and exit ────────────────────
  if (flags.print) {
    secrets.forEach(({ secret }) => console.log(secret));
    process.exit(0);
  }

  // ── Determine output mode ─────────────────────────────
  let writeToEnv = flags.env;

  if (!flags.yes && !flags.env) {
    const outputMode = select(
      bold("What do you want to do with the secret(s)?"),
      [
        `Write to ${green(".env")} file ${dim("(create or append/update)")}`,
        `Print to ${cyan("stdout")} only`,
      ],
      0
    );
    writeToEnv = outputMode.startsWith("Write");
  }

  if (!writeToEnv) {
    console.log(`\n${dim("Secrets printed above. Nothing written to disk.")}\n`);
    process.exit(0);
  }

  // ── Determine .env file path ──────────────────────────
  let envFile: string;
  if (flags.envFile) {
    envFile = resolve(flags.envFile);
  } else if (flags.yes) {
    envFile = resolve(".env");
  } else {
    const entered = prompt(`\n${bold(".env file path")} ${dim("[.env]")}: `);
    envFile = resolve(entered || ".env");
  }

  // ── Confirm overwrite if key exists ──────────────────
  if (existsSync(envFile)) {
    const content = readFileSync(envFile, "utf-8");
    const conflicts = secrets.filter(({ key }) =>
      content.match(new RegExp(`^${key}\\s*=`, "m"))
    );

    if (conflicts.length > 0 && !flags.yes) {
      console.log(
        `\n${yellow("⚠")}  The following keys already exist in ${bold(envFile)}:`
      );
      conflicts.forEach(({ key }) => console.log(`    ${yellow(key)}`));
      const overwrite = confirm(`\n${bold("Overwrite existing keys?")}`, false);
      if (!overwrite) {
        console.log(red("\nAborted. No changes made.\n"));
        process.exit(0);
      }
    }
  }

  // ── Write to .env ─────────────────────────────────────
  console.log();
  for (const { key, secret } of secrets) {
    const result = writeEnvKey(envFile, key, secret);
    const action = {
      created: green("✔ Created"),
      updated: yellow("✔ Updated"),
      appended: green("✔ Appended"),
    }[result];

    console.log(`  ${action}  ${bold(key)}  ${dim("→")}  ${dim(envFile)}`);
  }

  console.log(`\n${dim("Done! Remember to add .env to .gitignore 🔒")}\n`);

  // ── Gitignore reminder ────────────────────────────────
  const gitignorePath = resolve(".gitignore");
  if (existsSync(gitignorePath)) {
    const gi = readFileSync(gitignorePath, "utf-8");
    if (!gi.includes(".env")) {
      if (!flags.yes) {
        const addGitignore = confirm(
          `${yellow("⚠")}  ${bold(".env")} is not in your .gitignore. Add it now?`,
          true
        );
        if (addGitignore) {
          appendFileSync(gitignorePath, "\n.env\n");
          console.log(green("  ✔ Added .env to .gitignore\n"));
        }
      }
    }
  }
}

main().catch((err) => {
  console.error(red(`\nError: ${err.message}\n`));
  process.exit(1);
});
