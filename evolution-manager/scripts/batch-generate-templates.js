#!/usr/bin/env node

/**
 * Batch Template Generator
 *
 * Iterates over all evolution-runs_*.jsonc files in the kromosynth-cli conf directory
 * and calls create-template-from-config.js for each evoRun entry.
 *
 * Each generated template directory contains:
 *   template-info.jsonc
 *   evolution-run-config.jsonc
 *   evolutionary-hyperparameters.jsonc
 *   evolution-runs-config.jsonc
 *   ecosystem_default.config.js   ← PM2 ecosystem config (auto-generated per template)
 *
 * Usage:
 *   node scripts/batch-generate-templates.js [options]
 *
 * Options:
 *   --conf-dir <path>     Path to kromosynth-cli conf dir
 *                         (default: $KROMOSYNTH_ROOT/kromosynth-cli/cli-app/conf,
 *                          or auto-detected two levels above evolution-manager)
 *   --templates-dir <path> Output directory for templates
 *                         (default: ./templates relative to this package root)
 *   --filter <substring>  Only process files whose base name contains this substring
 *   --evo-run-index <n>   Only generate templates for a specific evoRun index
 *                         (default: all evoRuns in each file)
 *   --overwrite           Overwrite existing templates without prompting
 *   --dry-run             Print what would be done without writing any files
 *   --help                Show this help
 *
 * Environment:
 *   KROMOSYNTH_ROOT       Base path containing all kromosynth repos
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse as parseJSONC } from 'jsonc-parser';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    confDir: null,
    templatesDir: path.join(PACKAGE_ROOT, 'templates'),
    filter: null,
    evoRunIndex: null,  // null = all
    overwrite: false,
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--conf-dir':      opts.confDir      = args[++i]; break;
      case '--templates-dir': opts.templatesDir = args[++i]; break;
      case '--filter':        opts.filter       = args[++i]; break;
      case '--evo-run-index': opts.evoRunIndex  = parseInt(args[++i]); break;
      case '--overwrite':     opts.overwrite    = true; break;
      case '--dry-run':       opts.dryRun       = true; break;
      case '--help':          opts.help         = true; break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        process.exit(1);
    }
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function resolveConfDir(opts) {
  if (opts.confDir) return path.resolve(opts.confDir);
  const root = process.env.KROMOSYNTH_ROOT || path.resolve(PACKAGE_ROOT, '../..');
  return path.join(root, 'kromosynth-cli', 'cli-app', 'conf');
}

// ---------------------------------------------------------------------------
// Template name derivation (mirrors create-template-from-config.js)
// ---------------------------------------------------------------------------

function sanitizeTemplateName(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Spawn create-template-from-config.js for one evoRun
// ---------------------------------------------------------------------------

function spawnTemplateCreation(configFile, templateName, evoRunIndex, overwrite) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'create-template-from-config.js');
    const child = spawn(
      process.execPath,
      [scriptPath, configFile, templateName, String(evoRunIndex)],
      { stdio: ['pipe', 'inherit', 'inherit'] }
    );

    // Answer "y" to the overwrite prompt if --overwrite is set
    if (overwrite) {
      child.stdin.write('y\n');
    }
    child.stdin.end();

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`create-template-from-config.js exited with code ${code}`));
    });

    child.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    console.log(`
Batch Template Generator

Usage:
  node scripts/batch-generate-templates.js [options]

Options:
  --conf-dir <path>      Path to kromosynth-cli conf dir
  --templates-dir <path> Output directory for templates (default: ./templates)
  --filter <substring>   Only process files whose name contains this string
  --evo-run-index <n>    Only process evoRun at this index (default: all)
  --overwrite            Overwrite existing templates without prompting
  --dry-run              Preview without writing files
  --help                 Show this help

Each generated template includes ecosystem_default.config.js with the
appropriate PM2 service configuration detected from the evolution run config.
`);
    process.exit(0);
  }

  const confDir = resolveConfDir(opts);

  console.log(`\n🔍 Configuration directory : ${confDir}`);
  console.log(`📦 Templates directory     : ${opts.templatesDir}`);
  if (opts.dryRun) console.log('🌵 DRY RUN - no files will be written');
  console.log('');

  if (!await fs.pathExists(confDir)) {
    console.error(`❌ conf directory not found: ${confDir}`);
    console.error('   Set --conf-dir or KROMOSYNTH_ROOT environment variable.');
    process.exit(1);
  }

  // Discover evolution-runs config files
  const allFiles = (await fs.readdir(confDir))
    .filter(f => f.startsWith('evolution-runs_') && f.endsWith('.jsonc'))
    .sort();

  const configFiles = opts.filter
    ? allFiles.filter(f => f.includes(opts.filter))
    : allFiles;

  if (configFiles.length === 0) {
    console.warn('⚠️  No matching evolution-runs_*.jsonc files found.');
    if (opts.filter) console.warn(`   Filter applied: "${opts.filter}"`);
    process.exit(0);
  }

  console.log(`Found ${configFiles.length} config file(s)${opts.filter ? ` matching "${opts.filter}"` : ''}:\n`);

  let generated = 0;
  let skipped = 0;
  let errors = 0;

  for (const fileName of configFiles) {
    const configFile = path.join(confDir, fileName);
    console.log(`\n━━━ ${fileName} ━━━`);

    let evolutionRunsConfig;
    try {
      const content = await fs.readFile(configFile, 'utf8');
      evolutionRunsConfig = parseJSONC(content);
    } catch (err) {
      console.error(`  ❌ Failed to parse: ${err.message}`);
      errors++;
      continue;
    }

    const evoRuns = evolutionRunsConfig.evoRuns || [];
    if (evoRuns.length === 0) {
      console.warn(`  ⚠️  No evoRuns found, skipping.`);
      continue;
    }

    console.log(`  evoRuns (${evoRuns.length}): ${evoRuns.map(r => r.label).join(', ')}`);

    const indices = opts.evoRunIndex !== null
      ? [opts.evoRunIndex]
      : evoRuns.map((_, i) => i);

    for (const idx of indices) {
      if (idx >= evoRuns.length) {
        console.warn(`  ⚠️  evoRun index ${idx} out of range (max ${evoRuns.length - 1}), skipping.`);
        continue;
      }

      const evoRun = evoRuns[idx];
      const templateName = sanitizeTemplateName(evoRun.label);
      const templateDir = path.join(opts.templatesDir, templateName);

      const exists = await fs.pathExists(templateDir);
      if (exists && !opts.overwrite) {
        console.log(`  ⏭️  [${idx}] "${templateName}" — already exists, skipping (--overwrite to replace)`);
        skipped++;
        continue;
      }

      console.log(`  📋 [${idx}] Generating template: "${templateName}"`);

      if (opts.dryRun) {
        console.log(`     Would call: create-template-from-config.js ${path.basename(configFile)} ${templateName} ${idx}`);
        generated++;
        continue;
      }

      try {
        await spawnTemplateCreation(configFile, templateName, idx, opts.overwrite);
        generated++;
      } catch (err) {
        console.error(`  ❌ Failed for "${templateName}": ${err.message}`);
        errors++;
      }
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('Summary:');
  console.log(`  Templates generated : ${generated}`);
  console.log(`  Templates skipped   : ${skipped}`);
  if (errors > 0) console.log(`  Errors              : ${errors}`);
  if (opts.dryRun) console.log('  (dry run — nothing was written)');
  console.log('');
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
