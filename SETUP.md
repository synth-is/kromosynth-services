# Setup Instructions

## What's Been Created

### In kromosynth-services (orchestration project):
- ✅ `docker-compose.yml` - Production builds from GitHub
- ✅ `docker-compose.dev.yml` - Development builds from local repos
- ✅ `start.sh` - Convenient startup script
- ✅ `README.md` - Complete documentation
- ✅ `package.json` - NPM scripts for common operations
- ✅ `.gitignore` - Standard ignore patterns

### What Needs to Be Added to kromosynth-evoruns Repository:

1. **Add Dockerfile** (content in `kromosynth-evoruns-Dockerfile`):
   ```bash
   # Copy the content from kromosynth-evoruns-Dockerfile to kromosynth-evoruns/Dockerfile
   ```

2. **Add health check endpoint** to `evorun-browser-server.js`:
   ```javascript
   // Add this route to your Express/HTTP server
   app.get('/health', (req, res) => {
     res.json({ status: 'ok', timestamp: new Date().toISOString() });
   });
   ```

3. **Update server to bind to 0.0.0.0** instead of localhost:
   ```javascript
   // Instead of:
   server.listen(3004);
   
   // Use:
   const PORT = process.env.PORT || 3004;
   server.listen(PORT, '0.0.0.0', () => {
     console.log(`Server listening on port ${PORT}`);
   });
   ```

## How to Use

### Option 1: Production (GitHub builds)
```bash
cd kromosynth-services
./start.sh prod
```

### Option 2: Development (local repos)
```bash
# Ensure you have all repos cloned:
# /Users/bjornpjo/Developer/apps/kromosynth-evoruns
# /Users/bjornpjo/Developer/apps/kromosynth-render
# /Users/bjornpjo/Developer/apps/kromosynth-services

cd kromosynth-services
./start.sh dev
```

## Service Communication

- **kromosynth-evoruns**: `http://kromosynth-evoruns:3004` (internal)
- **kromosynth-render**: `http://kromosynth-render:3000` (internal)
- **External access**: 
  - localhost:3004 → evoruns
  - localhost:3000 → render

## Next Steps

1. ✅ kromosynth-render already has URL rewriting implemented
2. ❓ Add Dockerfile to kromosynth-evoruns repository
3. ❓ Add health endpoint to kromosynth-evoruns server
4. ❓ Update kromosynth-evoruns server to bind to 0.0.0.0
5. ✅ Test the complete setup
