#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import prettier from "prettier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const newVersion = process.argv[2];
if (!newVersion) {
  console.error("Error: Please provide a version number.");
  console.error("Usage: pnpm run set-version <version>");
  console.error("Example: pnpm run set-version 1.6.0");
  process.exit(1);
}

const cleanVersion = newVersion.replace(/^v/, "");

/**
 * Writes JSON back in the exact shape Prettier would produce for that file.
 *
 * JSON.stringify puts every array element on its own line, which re-expands
 * entries Prettier keeps inline -- app.json's single-element plugin arrays
 * (["expo-notifications"], ["@bacons/apple-targets"]) are the ones that bite.
 * Writing raw stringify output left `pnpm run validate` failing format:check
 * after every version bump. resolveConfig() picks up each package's own
 * .prettierrc, so each file keeps its package's formatting.
 */
async function writeJsonFormatted(fullPath, json) {
  const options = await prettier.resolveConfig(fullPath);
  const formatted = await prettier.format(JSON.stringify(json, null, 2), {
    ...options,
    filepath: fullPath,
  });
  fs.writeFileSync(fullPath, formatted);
}

const targetFiles = [
  "SparkyFitnessServer/package.json",
  "SparkyFitnessFrontend/package.json",
  "SparkyFitnessMobile/package.json",
  "shared/package.json",
];

let updatedCount = 0;

for (const relPath of targetFiles) {
  const fullPath = path.join(rootDir, relPath);
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, "utf8");
    const json = JSON.parse(content);
    json.version = cleanVersion;
    await writeJsonFormatted(fullPath, json);
    console.log(`✓ Updated ${relPath} -> ${cleanVersion}`);
    updatedCount++;
  } else {
    console.warn(`⚠ Skipping missing file: ${relPath}`);
  }
}

// Also update SparkyFitnessMobile/app.json (expo.version)
const appJsonPath = path.join(rootDir, "SparkyFitnessMobile/app.json");
if (fs.existsSync(appJsonPath)) {
  const content = fs.readFileSync(appJsonPath, "utf8");
  const json = JSON.parse(content);
  if (json.expo) {
    json.expo.version = cleanVersion;
    await writeJsonFormatted(appJsonPath, json);
    console.log(
      `✓ Updated SparkyFitnessMobile/app.json (expo.version) -> ${cleanVersion}`,
    );
    updatedCount++;
  }
}

console.log(
  `\nSuccessfully updated ${updatedCount} file(s) to version v${cleanVersion}!`,
);
