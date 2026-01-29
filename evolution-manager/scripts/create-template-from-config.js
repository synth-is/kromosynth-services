#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import { parse as parseJSONC } from 'jsonc-parser';
import merge from 'deepmerge';
import {
  generateEcosystemConfigString,
  getRequirementsSummary
} from './generate-ecosystem-config.js';

/**
 * Script to create evolution-manager templates from existing kromosynth CLI configurations
 *
 * Usage:
 *   node scripts/create-template-from-config.js <config-file> [template-name] [evo-run-index]
 *
 * Example:
 *   node scripts/create-template-from-config.js /path/to/evolution-runs-config.jsonc my-template 0
 *
 * Features:
 *   - Automatically detects required services from evolution config
 *   - Generates ecosystem config with staggered cron restarts for stateless services
 *   - Protects stateful services (pyribs, qdhf-projection) from automatic restarts
 */

async function createTemplateFromConfig() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error('Usage: node scripts/create-template-from-config.js <config-file> [template-name] [evo-run-index]');
    console.error('');
    console.error('Arguments:');
    console.error('  config-file     Path to evolution-runs config JSONC file');
    console.error('  template-name   Name for the new template (optional, derived from config if not provided)');
    console.error('  evo-run-index   Index of evoRun to use if multiple exist (optional, defaults to 0)');
    console.error('');
    console.error('Example:');
    console.error('  node scripts/create-template-from-config.js \\');
    console.error('    /Users/bjornpjo/Developer/apps/kromosynth-cli/cli-app/conf/evolution-runs_single-map_kuzudb-integration-test.jsonc \\');
    console.error('    single-map-kuzudb');
    process.exit(1);
  }

  const configFilePath = args[0];
  const templateName = args[1];
  const evoRunIndex = parseInt(args[2] || '0');

  try {
    console.log('🔍 Reading configuration file:', configFilePath);
    
    // Read and parse the evolution runs config
    if (!await fs.pathExists(configFilePath)) {
      throw new Error(`Config file not found: ${configFilePath}`);
    }

    const configContent = await fs.readFile(configFilePath, 'utf8');
    const evolutionRunsConfig = parseJSONC(configContent);

    if (!evolutionRunsConfig.evoRuns || evolutionRunsConfig.evoRuns.length === 0) {
      throw new Error('No evoRuns found in configuration');
    }

    if (evoRunIndex >= evolutionRunsConfig.evoRuns.length) {
      throw new Error(`evoRun index ${evoRunIndex} not found (available: 0-${evolutionRunsConfig.evoRuns.length - 1})`);
    }

    const selectedEvoRun = evolutionRunsConfig.evoRuns[evoRunIndex];
    console.log(`📋 Using evoRun: "${selectedEvoRun.label}" (index ${evoRunIndex})`);

    // Read base configuration files
    console.log('📖 Reading base configuration files...');
    const baseRunConfig = await readJSONConfig(evolutionRunsConfig.baseEvolutionRunConfigFile);
    const baseHyperparameters = await readJSONConfig(evolutionRunsConfig.baseEvolutionaryHyperparametersFile);

    // Read diff files if they exist
    let finalRunConfig = baseRunConfig;
    let finalHyperparameters = baseHyperparameters;

    if (selectedEvoRun.diffEvolutionRunConfigFile) {
      console.log('🔄 Applying evolution run config diff...');
      const diffRunConfig = await readJSONConfig(selectedEvoRun.diffEvolutionRunConfigFile);
      finalRunConfig = merge(baseRunConfig, diffRunConfig, {
        arrayMerge: (destinationArray, sourceArray) => sourceArray // Replace arrays instead of merging
      });
    }

    if (selectedEvoRun.diffEvolutionaryHyperparametersFile) {
      console.log('🔄 Applying hyperparameters diff...');
      const diffHyperparameters = await readJSONConfig(selectedEvoRun.diffEvolutionaryHyperparametersFile);
      finalHyperparameters = merge(baseHyperparameters, diffHyperparameters, {
        arrayMerge: (destinationArray, sourceArray) => sourceArray // Replace arrays instead of merging
      });
    }

    // Generate template name if not provided
    const finalTemplateName = templateName || sanitizeTemplateName(selectedEvoRun.label);
    console.log(`📁 Creating template: "${finalTemplateName}"`);

    // Create template
    await createTemplate(finalTemplateName, selectedEvoRun, finalRunConfig, finalHyperparameters);

    console.log('✅ Template created successfully!');
    console.log(`📍 Location: ./templates/${finalTemplateName}/`);
    console.log(`🚀 You can now use this template with: POST /api/runs {"templateName": "${finalTemplateName}"}`);

  } catch (error) {
    console.error('❌ Error creating template:', error.message);
    process.exit(1);
  }
}

/**
 * Read and parse a JSONC configuration file
 */
async function readJSONConfig(filePath) {
  if (!filePath) {
    return {};
  }

  const absolutePath = path.resolve(filePath);
  if (!await fs.pathExists(absolutePath)) {
    console.warn(`⚠️ Config file not found: ${absolutePath}`);
    return {};
  }

  console.log(`   📄 Reading: ${path.basename(absolutePath)}`);
  const content = await fs.readFile(absolutePath, 'utf8');
  return parseJSONC(content);
}

/**
 * Create a template directory with all required files
 */
async function createTemplate(templateName, evoRun, runConfig, hyperparameters) {
  const templatesDir = path.join(process.cwd(), 'templates');
  const templateDir = path.join(templatesDir, templateName);

  // Ensure templates directory exists
  await fs.ensureDir(templatesDir);

  // Check if template already exists
  if (await fs.pathExists(templateDir)) {
    const answer = await promptUser(`Template "${templateName}" already exists. Overwrite? (y/N): `);
    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log('❌ Operation cancelled');
      return;
    }
    await fs.remove(templateDir);
  }

  // Create template directory
  await fs.ensureDir(templateDir);

  // Generate template metadata
  const templateInfo = generateTemplateInfo(templateName, evoRun, runConfig, hyperparameters);
  await fs.writeFile(
    path.join(templateDir, 'template-info.jsonc'),
    JSON.stringify(templateInfo, null, 2)
  );

  // Clean and write evolution run config
  const cleanedRunConfig = cleanConfigForTemplate(runConfig);
  await fs.writeFile(
    path.join(templateDir, 'evolution-run-config.jsonc'),
    JSON.stringify(cleanedRunConfig, null, 2)
  );

  // Write hyperparameters
  await fs.writeFile(
    path.join(templateDir, 'evolutionary-hyperparameters.jsonc'),
    JSON.stringify(hyperparameters, null, 2)
  );

  // Create evolution-runs-config template
  const evolutionRunsConfigTemplate = {
    "// Note": "This template file is generated automatically",
    baseEvolutionRunConfigFile: "./evolution-run-config.jsonc",
    baseEvolutionaryHyperparametersFile: "./evolutionary-hyperparameters.jsonc",
    evoRuns: [
      {
        label: `${templateName}_run`,
        iterations: []
      }
    ],
    currentEvolutionRunIndex: 0,
    currentEvolutionRunIteration: 0
  };

  await fs.writeFile(
    path.join(templateDir, 'evolution-runs-config.jsonc'),
    JSON.stringify(evolutionRunsConfigTemplate, null, 2)
  );

  // Generate ecosystem config based on detected service requirements
  console.log('🔧 Analyzing service requirements...');
  const summary = getRequirementsSummary(runConfig);
  console.log(`   📊 Detected ${summary.totalServices} required services:`);
  summary.services.forEach(s => console.log(`      - ${s}`));
  if (summary.hasStatefulServices) {
    console.log(`   ⚠️  Stateful services (no cron_restart): ${summary.statefulServices.join(', ')}`);
  }

  const ecosystemConfig = generateEcosystemConfigString(runConfig);
  await fs.writeFile(
    path.join(templateDir, 'ecosystem_default.config.js'),
    ecosystemConfig
  );

  console.log('📝 Created files:');
  console.log('   - template-info.jsonc');
  console.log('   - evolution-run-config.jsonc');
  console.log('   - evolutionary-hyperparameters.jsonc');
  console.log('   - evolution-runs-config.jsonc');
  console.log('   - ecosystem_default.config.js (with staggered cron restarts)');
}

/**
 * Generate template metadata
 */
function generateTemplateInfo(templateName, evoRun, runConfig, hyperparameters) {
  // Extract some characteristics for description
  const populationSize = hyperparameters.populationSize || 'unknown';
  const maxGenerations = hyperparameters.maxGenerations || hyperparameters.terminationCriteria?.maxGenerations || 'unknown';
  const mapElitesGrid = runConfig.qualityDiversitySettings?.mapElitesGridSize || hyperparameters.mapElitesSettings?.gridResolution;
  
  let description = `Generated from CLI config: ${evoRun.label}`;
  if (populationSize !== 'unknown' && maxGenerations !== 'unknown') {
    description += ` (Pop: ${populationSize}, Gen: ${maxGenerations})`;
  }
  if (mapElitesGrid) {
    description += ` [Grid: ${Array.isArray(mapElitesGrid) ? mapElitesGrid.join('x') : mapElitesGrid}]`;
  }

  // Estimate resource requirements based on config
  let memoryReq = "1-2GB";
  let cpuReq = "Medium";
  let estimatedTime = "30-60 minutes";

  if (populationSize > 200 || maxGenerations > 1000) {
    memoryReq = "4-8GB";
    cpuReq = "High";
    estimatedTime = "2-4 hours";
  } else if (populationSize > 100 || maxGenerations > 500) {
    memoryReq = "2-4GB";
    cpuReq = "Medium-High";
    estimatedTime = "1-2 hours";
  }

  return {
    name: templateName.split('-').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' '),
    description,
    version: "1.0.0",
    author: "Generated from CLI config",
    tags: ["generated", "cli-import", evoRun.label],
    estimatedRunTime: estimatedTime,
    resourceRequirements: {
      memory: memoryReq,
      cpu: cpuReq
    },
    originalConfig: {
      label: evoRun.label,
      generatedAt: new Date().toISOString()
    }
  };
}

/**
 * Clean configuration for template use
 */
function cleanConfigForTemplate(config) {
  const cleaned = JSON.parse(JSON.stringify(config)); // Deep clone

  // Remove or reset fields that should be dynamic
  if (cleaned.outputDir) {
    cleaned.outputDir = "./output"; // Will be overridden by service
  }

  // Remove absolute paths that won't work in template context
  if (cleaned.evolutionaryRunId) {
    cleaned.evolutionaryRunId = "template-run"; // Generic ID for template
  }

  // Clean up any other absolute paths or machine-specific settings
  // Add more cleaning rules here as needed based on your config structure

  return cleaned;
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

/**
 * Simple prompt for user input
 */
async function promptUser(question) {
  const readline = await import('readline');
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Run the script
createTemplateFromConfig();
