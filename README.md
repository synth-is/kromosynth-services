# Kromosynth Services

This project orchestrates the kromosynth microservices using Docker Compose. It references the original Dockerfiles from their respective repositories rather than maintaining local copies.

## Services

- **kromosynth-evoruns** - Evolution runs browser server (port 3004)
- **kromosynth-render** - Audio rendering WebSocket server (port 3000) with PM2 clustering

## Performance Optimization

The kromosynth-render service uses PM2 clustering to utilize multiple CPU cores for better performance. This allows parallel processing of audio rendering requests without the WebGL/GPU context issues encountered with worker threads.

For more details on the PM2 clustering implementation, see [PM2_CLUSTERING.md](./PM2_CLUSTERING.md).

## Quick Start

### Production & Development

```bash
# Start all services (builds images if needed)
docker compose up --build
```

- By default, this uses the minimal `docker-compose.yml` for both local and GitHub builds.
- Make sure you have the required data directories on your host (see below).
- The render service uses PM2 clustering to utilize all available CPU cores (see [PM2_CLUSTERING.md](PM2_CLUSTERING.md)).

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

## Repository Structure

Each service is maintained in its own repository with its own Dockerfile:

- **kromosynth-evoruns**: https://github.com/synth-is/kromosynth-evoruns
- **kromosynth-render**: https://github.com/synth-is/kromosynth-render

This project uses Docker Compose to reference and orchestrate these services directly from their GitHub repositories.

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
