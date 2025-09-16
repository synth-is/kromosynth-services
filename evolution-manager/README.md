# Kromosynth Evolution Manager

A service for managing and monitoring kromosynth evolutionary runs via PM2 with REST API and WebSocket support.

## Features

- **PM2 Integration**: Manage evolutionary simulations as PM2 processes
- **REST API**: Start, stop, and monitor evolution runs
- **WebSocket Support**: Real-time progress updates and logs
- **Template System**: JSONC-based configuration templates
- **Process Monitoring**: CPU, memory, and progress tracking

## Installation

```bash
cd /Users/bjornpjo/Developer/apps/kromosynth-services/evolution-manager
npm install
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

To create a new template:

1. Create directory in `./templates/your-template-name/`
2. Add `template-info.jsonc` with metadata
3. Add required configuration files:
   - `evolution-run-config.jsonc`
   - `evolutionary-hyperparameters.jsonc`
4. Template will be automatically discovered

## Monitoring

- **Logs**: Check `./logs/` directory for PM2 process outputs
- **Working Files**: Runtime configs in `./working/` directory
- **WebSocket**: Real-time updates via WebSocket connection
- **PM2**: Use `pm2 list` to see running processes

## Requirements

- Node.js 18+
- PM2 installed globally (`npm install -g pm2`)
- kromosynth-cli available at `../kromosynth-cli/`

## Environment Variables

- `PORT` - Service port (default: 3005)
- `NODE_ENV` - Environment mode
