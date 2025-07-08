# Kromosynth Services

This project orchestrates the kromosynth microservices using Docker Compose.

## Services

- **kromosynth-evoruns** - Evolution runs browser server (port 3004)
- **kromosynth-render** - Audio rendering WebSocket server (port 3000)

## Quick Start

### Production & Development

```bash
# Start all services (builds images if needed)
docker compose up --build
```

- By default, this uses the minimal `docker-compose.yml` for both local and GitHub builds.
- Make sure you have the required data directories on your host (see below).

## Configuration

### Environment Variables

- `PORT` - Service port
- `NODE_ENV` - Environment (development/production)
- `EVORUN_ROOT_DIR` - Host directory for evoruns data (mounted into containers)
- `EVORENDERS_ROOT_DIR` - Host directory for renders data (mounted into containers)
- `EVORUNS_SERVER_URL` - URL for the evoruns service (used by render service)

### Network

Services communicate via the default Docker network:
- `kromosynth-evoruns` is accessible at `http://kromosynth-evoruns:3004`
- `kromosynth-render` is accessible at `http://kromosynth-render:3000`

## Data Directories

You must create and mount the following host directories for persistent data:

- `evoruns` (for evolution run data)
- `evorenders` (for render output)

Example (from the root of your workspace):

```bash
mkdir -p evoruns evorenders
```

These will be mounted into the containers automatically by `docker compose`.

## Service Dockerfiles

Each service repository needs a `Dockerfile`:

#### kromosynth-evoruns/Dockerfile
```dockerfile
FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Expose the port
EXPOSE 3004

# Command to run the server
CMD ["node", "evorun-browser-server.js"]
```

#### kromosynth-render/Dockerfile
Already exists and is configured.

## Deployment

### Start Services
```bash
docker compose up --build
```

- Add `-d` to run in detached mode.
- Use `docker compose logs -f` to view logs for all services.
- Use `docker compose logs <service>` to view logs for a specific service.
- Use `docker compose down` to stop all services.

## Troubleshooting

### Common Issues

1. **Service discovery**: Services use Docker network names, not localhost
2. **Port conflicts**: Ensure ports 3000 and 3004 are available
3. **Health checks**: Services wait for dependencies to be healthy

### Debugging

```bash
# Check service status
docker compose ps

# View logs for specific service
docker compose logs kromosynth-evoruns
docker compose logs kromosynth-render

# Access service shell
docker compose exec kromosynth-evoruns bash
```

### Network Testing

```bash
# Test service connectivity from inside a container
docker compose exec kromosynth-render curl http://kromosynth-evoruns:3004/health
```
