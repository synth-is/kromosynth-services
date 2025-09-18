# 📋 Template Creation Script - Quick Reference

## 🚀 Quick Start

```bash
cd /Users/bjornpjo/Developer/apps/kromosynth-services/evolution-manager

# 1. Run setup (installs deps, configures environment, validates CLI path)
npm run setup

# 2. Start the evolution manager service
npm start

# 3. Discover available CLI configurations
npm run list-configs

# 4. Create template from CLI config
npm run create-template /path/to/evolution-runs-config.jsonc [template-name] [index]

# 5. Use your template
curl -X POST http://localhost:3005/api/runs -d '{"templateName": "your-template"}'
```

## ⚡ Environment Setup

For your specific setup, create a `.env` file:

```bash
# Copy example and configure
cp .env.example .env

# Set your CLI script path
export KROMOSYNTH_CLI_SCRIPT="/Users/bjornpjo/Developer/apps/kromosynth-cli/cli-app/kromosynth.js"

# Or run the automated setup
npm run setup
```

## 📁 Available Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| Setup | `npm run setup` | Automated environment setup and validation |
| List Configs | `npm run list-configs` | Discover importable CLI configurations |
| Create Template | `npm run create-template <config> [name] [index]` | Import CLI config as template |
| Examples | `bash scripts/examples.sh` | Interactive examples and help |
| Start Service | `npm start` | Run the evolution manager service |
| Dev Mode | `npm run dev` | Start with auto-reload for development |

## 🔧 Script Parameters

### create-template
```bash
npm run create-template <config-file> [template-name] [evo-run-index]
```

- **config-file**: Path to evolution-runs JSONC configuration
- **template-name**: Optional name for template (auto-generated if omitted)
- **evo-run-index**: Index of evo run to use (default: 0, for configs with multiple runs)

### list-configs
```bash
npm run list-configs [base-path]
```

- **base-path**: Directory to scan for configs (default: kromosynth-cli/conf)

## 📊 What Gets Created

```
templates/your-template-name/
├── template-info.jsonc           # 📝 Metadata & resource requirements
├── evolution-run-config.jsonc    # ⚙️  Run configuration (merged)
├── evolutionary-hyperparameters.jsonc # 🧬 Algorithm parameters (merged)
└── evolution-runs-config.jsonc   # 🔗 Template wrapper
```

## 🔄 Configuration Merging Process

```
CLI Config Structure → Template Structure

evolution-runs-config.jsonc       
├── baseEvolutionRunConfigFile ────┐
├── baseEvolutionaryHyperparametersFile ─┐
└── evoRuns[i]                     │   │
    ├── diffEvolutionRunConfigFile ─┤   │
    └── diffEvolutionaryHyperparametersFile ─┤
                                   │   │
                      Deep Merge ──┴───┴── → Template Files
```

## ✅ Validation Checklist

Before running scripts:
- [ ] kromosynth-cli repository is accessible
- [ ] Configuration files exist and are valid JSONC
- [ ] evolution-manager dependencies are installed (`npm install`)
- [ ] PM2 is installed globally (`npm install -g pm2`)

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| "Config file not found" | Check path and ensure file exists |
| "No evoRuns found" | Ensure config has `evoRuns` array |
| "Template already exists" | Choose different name or confirm overwrite |
| "JSONC parse error" | Fix syntax in referenced configuration files |
| "Cannot read diff file" | Check diff file paths in evolution-runs config |

## 📚 Related Documentation

- **[README.md](README.md)** - Complete service documentation
- **[TEMPLATE_CREATION_GUIDE.md](TEMPLATE_CREATION_GUIDE.md)** - Detailed template creation guide  
- **[scripts/examples.sh](scripts/examples.sh)** - Interactive examples
- **[kromosynth-cli docs](../../../kromosynth-cli/)** - Original CLI documentation

## 🎯 Common Use Cases

### Import Single Configuration
```bash
npm run create-template \\
  /Users/bjornpjo/Developer/apps/kromosynth-cli/cli-app/conf/my-config.jsonc \\
  my-template
```

### Import Multiple Configurations
```bash
# List all configs first
npm run list-configs

# Import each one with specific names
npm run create-template config1.jsonc template-basic
npm run create-template config2.jsonc template-advanced  
```

### Import Specific Run from Multi-Run Config
```bash
# See available runs
npm run list-configs

# Import run at index 1
npm run create-template multi-run-config.jsonc template-run1 1
```

### Batch Import
```bash
for config in /path/to/configs/*.jsonc; do
  name=$(basename "$config" .jsonc)
  npm run create-template "$config" "$name"
done
```

This creates a seamless bridge between your existing CLI-based evolutionary runs and the new web-based management service! 🌉
