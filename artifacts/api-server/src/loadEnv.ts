/**
 * Load .env so SIMPLER_GRANTS_API_KEY, SAM_GOV_API_KEY, etc. are available.
 * Loads from every candidate path that exists (later paths override). Ensures repo root .env is used.
 * Import this first in index.ts so env is set before any other code runs.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();

// If ENV_FILE is set, load only that (so you can point to repo root .env from anywhere)
const explicitEnv = process.env.ENV_FILE;

const repoRootFromFile = path.resolve(__dirname, "..", "..", "..");
const candidates: Array<{ path: string; label: string }> = explicitEnv
  ? [{ path: path.resolve(cwd, explicitEnv), label: "ENV_FILE" }]
  : [
      { path: path.join(cwd, ".env"), label: "cwd" },
      { path: path.join(cwd, "..", ".env"), label: "cwd/.." },
      { path: path.join(cwd, "..", "..", ".env"), label: "cwd/../.." },
      { path: path.join(repoRootFromFile, ".env"), label: "repo root (from loadEnv.ts)" },
    ];

let loadedAny = false;
for (const entry of candidates) {
  const envPath = path.normalize(entry.path);
  if (fs.existsSync(envPath)) {
    const result = dotenv.config({ path: envPath, override: true });
    if (!result.error) {
      loadedAny = true;
      if (process.env.NODE_ENV !== "production") {
        console.log(`[env] Loaded: ${entry.label} (${envPath})`);
      }
    }
  }
}

if (process.env.NODE_ENV !== "production") {
  const sam = process.env.SAM_GOV_API_KEY ? "set" : "MISSING";
  const simpler = process.env.SIMPLER_GRANTS_API_KEY ? "set" : "MISSING";
  console.log(`[env] SAM_GOV_API_KEY=${sam}, SIMPLER_GRANTS_API_KEY=${simpler}`);
  if (!loadedAny) {
    console.warn("[env] No .env file found. Add .env to repo root (same folder as package.json) with SAM_GOV_API_KEY and SIMPLER_GRANTS_API_KEY.");
  }
}
