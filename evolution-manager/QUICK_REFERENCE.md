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
| Test Services | `npm run test-services` | Test service dependency system |

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

## 🔄 Service Dependency Management

### Starting Runs with Service Dependencies

```bash
# Basic run (uses default ecosystem)
curl -X POST http://localhost:3005/api/runs \
  -H "Content-Type: application/json" \
  -d '{"templateName": "evoconf_single-map_x100_noosc_kuzudb"}'

# Run with 3D ecosystem variant
curl -X POST http://localhost:3005/api/runs \
  -H "Content-Type: application/json" \
  -d '{
    "templateName": "evoconf_single-map_x100_noosc_kuzudb",
    "ecosystemVariant": "3d"
  }'
```

### Monitoring Services

```bash
# Check all service runs
curl http://localhost:3005/api/services

# Check services for specific run  
curl http://localhost:3005/api/runs/{runId}/services

# System status including service counts
curl http://localhost:3005/api/status
```

### Service Lifecycle

```
🚀 Start Run
    ↓
🔌 Allocate Unique Port Range (50000-50999)
    ↓
🔧 Load Ecosystem Config (default/3d/minimal)
    ↓
📋 Start Service Dependencies via PM2
    ↓
🔗 Update Evolution Config with Service URLs
    ↓
🧬 Start Evolution Process
    ↓
✅ Run Active with All Dependencies
```

## 📊 Template Structure

```
templates/your-template-name/
├── template-info.jsonc           # 📝 Metadata & resource requirements
├── evolution-run-config.jsonc    # ⚙️  Run configuration (merged)
├── evolutionary-hyperparameters.jsonc # 🧬 Algorithm parameters (merged)
├── evolution-runs-config.jsonc   # 🔗 Template wrapper
├── ecosystem_default.config.js   # 🔧 Default service dependencies
├── ecosystem_3d.config.js        # 🔧 3D variant services
└── ecosystem_minimal.config.js   # 🔧 Minimal services for testing
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

### Basic Quality Diversity Run
```bash
# Start with default 2D MAP-Elites
curl -X POST http://localhost:3005/api/runs \
  -d '{"templateName": "evoconf_single-map_x100_noosc_kuzudb"}'
```

### 3D Quality Diversity Run
```bash
# Start with 3D MAP-Elites projection
curl -X POST http://localhost:3005/api/runs \
  -d '{
    "templateName": "evoconf_single-map_x100_noosc_kuzudb",
    "ecosystemVariant": "3d",
    "options": {
      "maxGenerations": 1000,
      "populationSize": 100
    }
  }'
```

### Concurrent Multiple Runs
```bash
# Start multiple runs - each gets unique port ranges automatically
for i in {1..3}; do
  curl -X POST http://localhost:3005/api/runs \
    -d "{\"templateName\": \"evoconf_single-map_x100_noosc_kuzudb\", \"ecosystemVariant\": \"default\"}"
done
```

### Import and Use CLI Configuration
```bash
# Import existing CLI config as template
npm run create-template \
  /path/to/evolution-runs-config.jsonc \
  my-custom-template

# Use the new template
curl -X POST http://localhost:3005/api/runs \
  -d '{"templateName": "my-custom-template"}'
```

## 🚪 Troubleshooting

| Issue | Quick Fix |
|-------|----------|
| "No ecosystem template found" | Add `ecosystem_default.config.js` to template dir or CLI will run without services |
| "Services did not become ready" | Check service logs in `./logs/` and verify service paths in ecosystem config |
| "Port allocation failed" | Stop old runs: `curl -X DELETE http://localhost:3005/api/runs/{runId}` |
| "CLI script not found" | Set `KROMOSYNTH_CLI_SCRIPT` env var or run `npm run setup` |
| "PM2 connection failed" | Install PM2: `npm install -g pm2` and restart service |
| Run stuck "starting" | Check evolution logs: `tail -f logs/{runId}.combined.log` |
| Services show "failed" | Verify service dependencies and interpreters in ecosystem config |

### Quick Debug Commands
```bash
# Check system status
curl http://localhost:3005/api/status

# View service details for run
curl http://localhost:3005/api/runs/{runId}/services

# Check PM2 processes
pm2 list

# View service logs
pm2 logs kromosynth-gRPC-variation_{runId}

# Test service dependency system
npm run test-services
```
