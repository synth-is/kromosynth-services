#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import { parse as parseJSONC } from 'jsonc-parser';

/**
 * Script to list available kromosynth CLI configurations that can be imported as templates
 * 
 * Usage:
 *   node scripts/list-importable-configs.js [base-path]
 * 
 * Example:
 *   node scripts/list-importable-configs.js /Users/bjornpjo/Developer/apps/kromosynth-cli/cli-app/conf
 */

async function listImportableConfigs() {
  const args = process.argv.slice(2);
  const basePath = args[0] || '/Users/bjornpjo/Developer/apps/kromosynth-cli/cli-app/conf';

  console.log('🔍 Scanning for kromosynth CLI configurations...');
  console.log(`📁 Base path: ${basePath}`);
  console.log();

  try {
    if (!await fs.pathExists(basePath)) {
      console.error(`❌ Path not found: ${basePath}`);
      process.exit(1);
    }

    const configs = await findEvolutionRunsConfigs(basePath);
    
    if (configs.length === 0) {
      console.log('❌ No evolution-runs configuration files found');
      return;
    }

    console.log(`Found ${configs.length} configuration file(s):`);
    console.log();

    for (const configInfo of configs) {
      console.log(`📄 ${path.basename(configInfo.path)}`);
      console.log(`   Path: ${configInfo.path}`);
      console.log(`   Evo Runs: ${configInfo.evoRunsCount}`);
      
      if (configInfo.evoRuns.length > 0) {
        console.log('   Available runs:');
        configInfo.evoRuns.forEach((run, index) => {
          console.log(`     [${index}] ${run.label}`);
        });
      }
      
      console.log();
      console.log(`   Import commands:`);
      
      if (configInfo.evoRuns.length === 1) {
        const templateName = sanitizeTemplateName(configInfo.evoRuns[0].label);
        console.log(`     npm run create-template "${configInfo.path}" "${templateName}"`);
      } else {
        configInfo.evoRuns.forEach((run, index) => {
          const templateName = sanitizeTemplateName(run.label);
          console.log(`     npm run create-template "${configInfo.path}" "${templateName}" ${index}`);
        });
      }
      
      console.log();
      console.log('─'.repeat(80));
      console.log();
    }

  } catch (error) {
    console.error('❌ Error scanning configurations:', error.message);
    process.exit(1);
  }
}

/**
 * Find all evolution-runs configuration files in a directory tree
 */
async function findEvolutionRunsConfigs(basePath) {
  const configs = [];
  
  async function scanDirectory(dirPath) {
    const entries = await fs.readdir(dirPath);
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      const stat = await fs.stat(fullPath);
      
      if (stat.isDirectory()) {
        await scanDirectory(fullPath);
      } else if (entry.includes('evolution-runs') && entry.endsWith('.jsonc')) {
        try {
          const configInfo = await analyzeConfig(fullPath);
          if (configInfo) {
            configs.push(configInfo);
          }
        } catch (error) {
          console.warn(`⚠️ Failed to parse ${fullPath}: ${error.message}`);
        }
      }
    }
  }
  
  await scanDirectory(basePath);
  return configs.sort((a, b) => path.basename(a.path).localeCompare(path.basename(b.path)));
}

/**
 * Analyze a configuration file to extract information
 */
async function analyzeConfig(configPath) {
  const content = await fs.readFile(configPath, 'utf8');
  const config = parseJSONC(content);
  
  if (!config.evoRuns || !Array.isArray(config.evoRuns)) {
    return null; // Not a valid evolution-runs config
  }
  
  return {
    path: configPath,
    evoRunsCount: config.evoRuns.length,
    evoRuns: config.evoRuns.map(run => ({
      label: run.label || 'Unlabeled',
      hasConfigDiff: !!run.diffEvolutionRunConfigFile,
      hasHyperparametersDiff: !!run.diffEvolutionaryHyperparametersFile,
      iterationCount: run.iterations ? run.iterations.length : 0
    }))
  };
}

/**
 * Sanitize a label for use as a template name
 */
function sanitizeTemplateName(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Run the script
listImportableConfigs();
