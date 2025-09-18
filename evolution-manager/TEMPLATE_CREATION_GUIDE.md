# Template Creation from CLI Configurations - Complete Guide

This guide explains how to convert existing kromosynth CLI configurations into templates for the evolution-manager service.

## Overview

The kromosynth CLI uses a hierarchical configuration system:
- **Base configurations**: `evolution-run-config.jsonc`, `evolutionary-hyperparameters.jsonc`
- **Diff files**: Modify base configurations for specific runs
- **Evolution runs config**: References base + diff files, contains run definitions

The template creation script reads this hierarchy, merges configurations, and generates service-compatible templates.

## Step-by-Step Process

### 1. Discover Available Configurations

```bash
cd /Users/bjornpjo/Developer/apps/kromosynth-services/evolution-manager

# List all importable configurations
npm run list-configs

# Or scan a specific directory
npm run list-configs /path/to/kromosynth-cli/conf
```

This will show:
- Available evolution-runs configuration files
- Number of evo runs in each config  
- Run labels and indices
- Ready-to-use import commands

### 2. Import Configuration as Template

```bash
# Basic import (auto-generate template name)
npm run create-template /path/to/evolution-runs-config.jsonc

# Import with custom template name
npm run create-template /path/to/evolution-runs-config.jsonc my-template-name

# Import specific evo run (if config has multiple)
npm run create-template /path/to/evolution-runs-config.jsonc my-template-name 0
```

### 3. Example: Import KuzuDB Integration Test

```bash
npm run create-template \\
  /Users/bjornpjo/Developer/apps/kromosynth-cli/cli-app/conf/evolution-runs_single-map_kuzudb-integration-test.jsonc \\
  kuzudb-integration
```

This creates: `./templates/kuzudb-integration/`

### 4. Use the Template

Once created, the template is immediately available:

```bash
# REST API
curl -X POST http://localhost:3005/api/runs \\
  -H "Content-Type: application/json" \\
  -d '{"templateName": "kuzudb-integration"}'

# Web Interface
# Visit http://localhost:3005 and select the template
```

## What the Script Does

### Configuration Processing
1. **Reads evolution-runs config** - Parses main JSONC file
2. **Loads base configurations** - Reads referenced base files
3. **Applies diff files** - Merges diffs into base configurations using deep merge
4. **Cleans for template use** - Removes absolute paths, machine-specific settings

### Template Generation
1. **Creates template directory** - `./templates/[template-name]/`
2. **Generates metadata** - Auto-detects resource requirements, runtime estimates
3. **Writes configuration files**:
   - `template-info.jsonc` - Metadata and description
   - `evolution-run-config.jsonc` - Merged run configuration
   - `evolutionary-hyperparameters.jsonc` - Merged algorithm parameters
   - `evolution-runs-config.jsonc` - Template wrapper

### Intelligent Defaults
- **Template naming**: Sanitizes labels for filesystem compatibility
- **Resource estimation**: Analyzes population size, generations for requirements
- **Metadata generation**: Creates descriptions from configuration parameters
- **Path cleaning**: Converts absolute paths to template-relative paths

## Configuration Merging

The script uses deep merge with array replacement:

```javascript
// Base config
{
  "populationSize": 100,
  "classifiers": ["classifier1"]
}

// Diff config  
{
  "populationSize": 200,
  "classifiers": ["classifier2", "classifier3"]
}

// Result (arrays replaced, objects merged)
{
  "populationSize": 200,  // overridden
  "classifiers": ["classifier2", "classifier3"]  // replaced
}
```

## Template Structure

Generated templates follow this structure:

```
templates/my-template/
├── template-info.jsonc           # Metadata
├── evolution-run-config.jsonc    # Run configuration  
├── evolutionary-hyperparameters.jsonc  # Algorithm settings
└── evolution-runs-config.jsonc   # Template wrapper
```

## Troubleshooting

### Template Already Exists
The script prompts before overwriting existing templates.

### Missing Files
The script warns about missing referenced files but continues with available data.

### Invalid JSONC
Parse errors are reported with file paths and line information.

### Path Issues
All absolute paths are converted to template-relative paths automatically.

## Advanced Usage

### Multiple Evo Runs
If a config file contains multiple evo runs:

```bash
# Import specific run by index
npm run create-template config.jsonc template-name 1

# Import all runs (creates separate templates)
for i in 0 1 2; do
  npm run create-template config.jsonc "template-$i" $i
done
```

### Custom Modifications
After import, you can manually edit template files:
- Adjust resource requirements in `template-info.jsonc`
- Modify parameters in configuration files
- Add custom descriptions and tags

The evolution-manager service automatically detects changes and updates available templates.

## Integration with Evolution Manager

Once templates are created:

1. **Service Discovery**: Templates are automatically discovered on service start
2. **API Integration**: Available via `/api/templates` endpoint
3. **Runtime Generation**: Service generates working configs per run
4. **Process Management**: PM2 manages template-based runs
5. **Real-time Monitoring**: WebSocket updates for template-based runs

This creates a seamless bridge between CLI-based development and web-based execution management.
