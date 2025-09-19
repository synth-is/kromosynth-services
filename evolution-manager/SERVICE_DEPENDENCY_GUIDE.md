# Service Dependency Management for Quality Diversity Evolution Runs

The Kromosynth Evolution Manager now supports **automatic service dependency management** for QD simulations. This system dynamically allocates unique port ranges, starts required services, and manages their lifecycles.

## 🏗️ Architecture Overview

Quality Diversity evolution runs require multiple specialized services:
- **Gene Variation** - Genome mutation and variation services
- **Gene Rendering** - Audio synthesis and rendering services  
- **Feature Evaluation** - Audio feature extraction services
- **Quality Evaluation** - Reference-based quality assessment services
- **Projection Services** - Dimensionality reduction for MAP-Elites (2D/3D variants)

Each concurrent run needs **unique port ranges** to avoid conflicts, and different run types may need **different service configurations** (e.g., 2D vs 3D projections).

## 🔧 How It Works

### 1. Template + Ecosystem Association
Each template can have multiple ecosystem configuration variants:
```
templates/my-template/
├── ecosystem_default.config.js    # Default 2D configuration
├── ecosystem_3d.config.js         # 3D projection variant  
├── ecosystem_minimal.config.js    # Minimal services for testing
└── template-info.jsonc             # Template metadata
```

### 2. Dynamic Port Allocation
When starting a run:
1. **Port Manager** allocates unique port range (e.g., 51000-51999)
2. **Service Manager** updates ecosystem config with allocated ports
3. **Evolution Config** is updated with correct service endpoints
4. Services start with **collision-free** port assignments

### 3. Service Lifecycle Management
```
Start Run Request
     ↓
🔌 Allocate Port Range (e.g., 52000-52999)
     ↓  
🔧 Load Ecosystem Template (variant: 3d)
     ↓
📝 Generate Working Ecosystem Config
     ↓
🚀 Start Service Dependencies via PM2
     ↓
⏳ Wait for Services Ready
     ↓
🔗 Update Evolution Config with Endpoints
     ↓
🧬 Start Evolution Process
     ↓
✅ Run Active with Services
```

## 📋 Creating Ecosystem Configurations

### Basic Structure
Ecosystem configs are PM2 ecosystem files with service definitions:

```javascript
// ecosystem_default.config.js
module.exports = {
  apps: [
    {
      name: "kromosynth-gRPC-variation",
      script: "gRPC/genomeVariationWS.js",
      instances: 3,
      env: { "PORT": 50051 } // Will be updated with allocated port
    },
    {
      name: "kromosynth-evaluation-socket-server_projection_pca_quantised",
      script: "projection_quantised.py",
      args: "--dimensions 2 --dimension-cells 100", // 2D configuration
      env: { "PORT": 33051 }
    }
    // ... more services
  ]
};
```

### Variant Examples

**3D Projection Variant:**
```javascript
// ecosystem_3d.config.js
module.exports = {
  apps: [
    // ... same base services ...
    {
      name: "kromosynth-evaluation-socket-server_projection_pca_quantised",
      script: "projection_quantised.py",
      args: "--dimensions 3 --dimension-cells 22", // 3D configuration
      env: { "PORT": 33051 }
    }
  ]
};
```

**Minimal Testing Variant:**
```javascript
// ecosystem_minimal.config.js
module.exports = {
  apps: [
    {
      name: "kromosynth-gRPC-variation",
      script: "gRPC/genomeVariationWS.js",
      instances: 1, // Reduced for testing
      env: { "PORT": 50051 }
    }
    // Only essential services for quick testing
  ]
};
```

**High-Performance Variant:**
```javascript
// ecosystem_performance.config.js
module.exports = {
  apps: [
    {
      name: "kromosynth-gRPC-variation",
      script: "gRPC/genomeVariationWS.js",
      instances: 6, // More instances for performance
      max_memory_restart: '4G', // Higher memory limits
      env: { "PORT": 50051 }
    }
    // ... other services with performance optimizations
  ]
};
```

### Service Name Mapping
The system maps PM2 app names to service types:
- `kromosynth-gRPC-variation` → **geneVariation** servers
- `kromosynth-render-socket-server` → **geneRendering** servers
- `kromosynth-evaluation-socket-server_features` → **evaluationFeatures** servers
- `kromosynth-evaluation-socket-server_quality_ref_features` → **evaluationQuality** servers
- `kromosynth-evaluation-socket-server_projection_pca_quantised` → **evaluationProjection** servers

## 🚀 Using Service Dependencies

### Via REST API
```bash
# Start run with default ecosystem
curl -X POST http://localhost:3005/api/runs \
  -H "Content-Type: application/json" \
  -d '{
    "templateName": "evoconf_single-map_x100_noosc_kuzudb"
  }'

# Start run with 3D ecosystem variant
curl -X POST http://localhost:3005/api/runs \
  -H "Content-Type: application/json" \
  -d '{
    "templateName": "evoconf_single-map_x100_noosc_kuzudb",
    "ecosystemVariant": "3d"
  }'

# Start run with minimal services for testing
curl -X POST http://localhost:3005/api/runs \
  -H "Content-Type: application/json" \
  -d '{
    "templateName": "evoconf_single-map_x100_noosc_kuzudb",
    "ecosystemVariant": "minimal"
  }'
```

### Via Web Interface
1. Select template from dropdown
2. Choose ecosystem variant (if available)
3. Set additional options
4. Start run - services auto-start with unique ports

### Checking Service Status
```bash
# Get all service status
curl http://localhost:3005/api/services

# Get services for specific run
curl http://localhost:3005/api/runs/{runId}/services
```

## 📊 Monitoring and Management

### Service Information
Each run shows:
- **Port Range**: Allocated port range (e.g., 52051-53050)
- **Service Count**: Number of active services
- **Service Status**: Status of each service process
- **Endpoints**: WebSocket URLs for each service type

### Real-time Updates
WebSocket events provide:
- Service startup/shutdown notifications
- Port allocation changes
- Service health status updates
- Run lifecycle with dependency status

### PM2 Integration
Services appear in PM2 with run-specific names:
```bash
pm2 list
# Shows:
# kromosynth-gRPC-variation_01HJKM...
# kromosynth-render-socket-server_01HJKM...
# kromosynth-evolution-01HJKM...  # Main evolution process
```

## ⚙️ Configuration Options

### Port Range Configuration
Configure in `src/core/port-manager.js`:
```javascript
this.servicePortBases = {
  geneVariation: 50000,      // Base port for gene variation
  geneRendering: 60000,      // Base port for rendering
  // ...
};

this.portRangeSize = 1000;   // Ports per run
```

### Service Instance Counts
```javascript
this.serviceInstances = {
  geneVariation: 3,        // 3 variation service instances
  geneRendering: 3,        // 3 rendering service instances
  evaluationProjection: 1, // 1 projection service (GPU intensive)
  // ...
};
```

## 🛠️ Advanced Features

### Template-Specific Ecosystems
Place ecosystem configs directly in template directories:
```
templates/my-template/
├── ecosystem_default.config.js
├── ecosystem_3d.config.js
└── ecosystem_minimal.config.js
```

### CLI Ecosystem Fallback
If no template-specific ecosystem exists, the system searches CLI directory for:
- `ecosystem_{templateName}_{variant}.config.js`
- `ecosystem_{templateName}.config.js`

### Service Health Checks
The system waits for services to reach 'online' status before starting evolution runs, ensuring all dependencies are ready.

### Automatic Cleanup
When runs stop or fail:
1. Evolution process stops
2. All service dependencies stop
3. PM2 processes are deleted
4. Port ranges are released
5. Temporary config files are cleaned up

## 🚨 Troubleshooting

### Common Issues

**"No ecosystem template found"**
- Add ecosystem config to template directory
- Or place in CLI directory with correct naming
- Run will continue without services if none found

**"Services did not become ready"**
- Check service logs in `./logs/` directory
- Verify service paths and interpreters in ecosystem config
- Ensure required dependencies are installed

**"Port allocation failed"**
- Too many concurrent runs
- Increase port range size or clean up stopped runs
- Check for port conflicts with other applications

### Service Logs
Check individual service logs:
```bash
# PM2 logs for services
pm2 logs kromosynth-gRPC-variation_01HJKM...

# Evolution manager logs
tail -f logs/01HJKM....combined.log
```

### Debug Mode
Set environment variable for verbose service management:
```bash
export DEBUG_SERVICES=true
npm start
```

This system ensures **zero-configuration concurrent QD runs** with **automatic service dependency management** and **collision-free port allocation**! 🎯
