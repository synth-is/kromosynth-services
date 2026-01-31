# Kromosynth Evolution Manager

A service for managing and monitoring kromosynth evolutionary runs via PM2 with REST API and WebSocket support.

## Features

- **PM2 Integration**: Manage evolutionary simulations as PM2 processes
- **REST API**: Start, stop, and monitor evolution runs
- **WebSocket Support**: Real-time progress updates and logs
- **Template System**: JSONC-based configuration templates
- **Process Monitoring**: CPU, memory, and progress tracking
- **Service Dependencies**: Automatic management of QD service dependencies
- **Dynamic Port Allocation**: Unique port ranges for concurrent runs
- **Ecosystem Variants**: Support for different service configurations (2D/3D, etc.)

## Installation

```bash
cd /Users/bjornpjo/Developer/apps/kromosynth-services/evolution-manager

# Option 1: Automated setup (recommended)
npm run setup

# Option 2: Manual setup
npm install
cp .env.example .env
# Edit .env to configure CLI script path
```

## Configuration

Copy the example environment file and configure paths:

```bash
cp .env.example .env
# Edit .env to set your kromosynth-cli path
```

### CLI Script Path Configuration

The evolution manager needs to know where your kromosynth CLI script is located. You have three options:

**Option 1: Set full script path (recommended)**
```bash
export KROMOSYNTH_CLI_SCRIPT="/path/to/kromosynth-cli/cli-app/kromosynth.js"
```

**Option 2: Set CLI directory path**
```bash
export KROMOSYNTH_CLI_PATH="/path/to/kromosynth-cli"
```

**Option 3: Use default relative path**
If no environment variables are set, the service assumes kromosynth-cli is at `../../kromosynth-cli/` relative to the evolution-manager directory.

For your setup, use:
```bash
export KROMOSYNTH_CLI_SCRIPT="/Users/bjornpjo/Developer/apps/kromosynth-cli/cli-app/kromosynth.js"
```

## Usage

### Start the Service

```bash
npm start
# or for development with auto-reload
npm run dev
```

The service will run on port 3005 by default.

### API Endpoints

- `GET /api/health` - Service health check
- `GET /api/templates` - List available configuration templates  
- `GET /api/runs` - List all evolution runs
- `GET /api/runs/:runId` - Get specific run details
- `POST /api/runs` - Start new evolution run
- `DELETE /api/runs/:runId` - Stop evolution run
- `GET /api/status` - System status and statistics

### WebSocket Events

**Client to Server:**
- `get-runs-status` - Request current runs status
- `subscribe-to-run` - Subscribe to specific run updates
- `unsubscribe-from-run` - Unsubscribe from run updates  
- `get-run-logs` - Request recent log lines

**Server to Client:**
- `connection-established` - Connection confirmation
- `runs-status` - Current runs status
- `run-progress` - Evolution progress updates
- `run-log` - Log line updates
- `run-status-change` - Run status changes
- `run-started` - New run started
- `run-stopped` - Run stopped

## Configuration Templates

Templates are stored in `./templates/` directory. Each template contains:

- `template-info.jsonc` - Template metadata
- `evolution-run-config.jsonc` - Evolution run configuration  
- `evolutionary-hyperparameters.jsonc` - Algorithm hyperparameters
- `evolution-runs-config.jsonc` - Main configuration (optional)

### Example: Start Evolution Run

```bash
curl -X POST http://localhost:3005/api/runs \\
  -H "Content-Type: application/json" \\
  -d '{
    "templateName": "basic-quality-diversity",
    "options": {
      "maxGenerations": 100,
      "populationSize": 50
    }
  }'
```

### Example: WebSocket Client

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3005');

socket.on('connect', () => {
  console.log('Connected to evolution manager');
  
  // Subscribe to run updates
  socket.emit('subscribe-to-run', { runId: 'your-run-id' });
});

socket.on('run-progress', (data) => {
  console.log(`Run ${data.runId} progress:`, data.progress);
});
```

## Directory Structure

```
evolution-manager/
├── src/
│   ├── api/
│   │   └── routes.js          # REST API routes
│   ├── config/
│   │   └── config-manager.js  # JSONC template management
│   ├── core/
│   │   └── evolution-manager.js # Main PM2 process manager
│   ├── websocket/
│   │   └── socket-handler.js  # WebSocket event handlers
│   └── server.js              # Express server entry point
├── templates/
│   ├── basic-quality-diversity/
│   └── advanced-multi-objective/
├── working/                   # Runtime configuration files
├── logs/                      # PM2 process logs
└── package.json
```

## Template Development

### Creating Templates from Existing CLI Configurations

The fastest way to create templates is by importing existing kromosynth CLI configurations:

```bash
# First, discover available configurations
npm run list-configs [/path/to/kromosynth-cli/conf]

# Create template from existing config
npm run create-template /path/to/evolution-runs-config.jsonc [template-name] [evo-run-index]

# Example: Import the kuzudb integration test config
npm run create-template \
  /Users/bjornpjo/Developer/apps/kromosynth-cli/cli-app/conf/evolution-runs_single-map_kuzudb-integration-test.jsonc \
  single-map-kuzudb-test
```

The template creation process:
1. Parses the evolution-runs config and its referenced files
2. Merges base configurations with diff files using deep merge
3. Generates a complete template with auto-generated metadata
4. Handles multiple evoRuns (specify index if config contains multiple)
5. Cleans configuration for template use (removes absolute paths, etc.)

### Creating Templates Manually

To create a new template manually:

1. Create directory in `./templates/your-template-name/`
2. Add `template-info.jsonc` with metadata
3. Add required configuration files:
   - `evolution-run-config.jsonc`
   - `evolutionary-hyperparameters.jsonc`
4. Template will be automatically discovered

### Template Structure

Each template directory contains:
- `template-info.jsonc` - Metadata (name, description, resource requirements)
- `evolution-run-config.jsonc` - Evolution run configuration
- `evolutionary-hyperparameters.jsonc` - Algorithm hyperparameters
- `evolution-runs-config.jsonc` - Template wrapper (auto-generated)

## Monitoring

- **Logs**: Check `./logs/` directory for PM2 process outputs
- **Working Files**: Runtime configs in `./working/` directory
- **WebSocket**: Real-time updates via WebSocket connection
- **PM2**: Use `pm2 list` to see running processes

## Requirements

- Node.js 18+
- PM2 installed globally (`npm install -g pm2`)
- kromosynth-cli available at `../kromosynth-cli/`

## Auto-Run Scheduler

The evolution manager includes an automatic run scheduler that rotates between enabled templates. This allows continuous evolution across different configurations without manual intervention.

### Scheduling Modes

- **Round-Robin** (default): Templates take turns running, each for their configured time slice
- **Priority**: Templates run in priority order (lower number = higher priority)

### Enabling Templates for Auto-Scheduling

```bash
# Enable a template with default settings (priority 1, 30 min time slice)
curl -X POST http://localhost:3005/api/auto-run/templates/CMA-MAE/enable \
  -H "Content-Type: application/json" \
  -d '{}'

# Enable with custom priority and time slice
curl -X POST http://localhost:3005/api/auto-run/templates/CMA-MAE/enable \
  -H "Content-Type: application/json" \
  -d '{"priority": 1, "timeSliceMinutes": 30}'

curl -X POST http://localhost:3005/api/auto-run/templates/quality-musicality_spectral-clarity/enable \
  -H "Content-Type: application/json" \
  -d '{"priority": 2, "timeSliceMinutes": 45}'
```

### Updating Template Priority

```bash
# Update priority for an existing template
curl -X PUT http://localhost:3005/api/auto-run/templates/CMA-MAE/config \
  -H "Content-Type: application/json" \
  -d '{"priority": 2}'

# Update multiple settings
curl -X PUT http://localhost:3005/api/auto-run/templates/CMA-MAE/config \
  -H "Content-Type: application/json" \
  -d '{"priority": 1, "timeSliceMinutes": 60}'
```

### Switching Scheduling Mode

```bash
# Switch to priority-based scheduling
curl -X PUT http://localhost:3005/api/auto-run/config \
  -H "Content-Type: application/json" \
  -d '{"schedulingMode": "priority"}'

# Switch back to round-robin
curl -X PUT http://localhost:3005/api/auto-run/config \
  -H "Content-Type: application/json" \
  -d '{"schedulingMode": "round-robin"}'
```

### Controlling the Scheduler

```bash
# Start the auto-run scheduler
curl -X POST http://localhost:3005/api/auto-run/start

# Stop the auto-run scheduler
curl -X POST http://localhost:3005/api/auto-run/stop

# Get current scheduler status
curl http://localhost:3005/api/auto-run/status

# Get all templates with scheduling status
curl http://localhost:3005/api/auto-run/templates

# Disable a template from auto-scheduling
curl -X POST http://localhost:3005/api/auto-run/templates/CMA-MAE/disable \
  -H "Content-Type: application/json" \
  -d '{}'

# Remove a template entirely from auto-run config
curl -X DELETE "http://localhost:3005/api/auto-run/templates/CMA-MAE?ecosystemVariant=default"
```

### Priority System

- **Lower number = Higher priority**: A template with priority `1` runs before one with priority `2`
- **Default priority**: Templates are assigned priority `1` when enabled without specifying
- **Only applies in priority mode**: In round-robin mode, all templates get equal time regardless of priority

### Auto-Run WebSocket Events

**Server to Client:**
- `auto-run-status-change` - Scheduler started/stopped
- `template-config-change` - Template enabled/disabled/updated
- `run-rotation` - Run switched to a different template

## Environment Variables

- `PORT` - Service port (default: 3005)
- `NODE_ENV` - Environment mode (development/production)
- `KROMOSYNTH_CLI_SCRIPT` - Full path to kromosynth.js script
- `KROMOSYNTH_CLI_PATH` - Path to kromosynth-cli directory
- `LOG_LEVEL` - Logging level (info/debug/warn/error)
