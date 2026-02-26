# PM2 Clustering for KromoSynth Services

This project configures kromosynth-render to use PM2 clustering for better performance and resource utilization.

## What is PM2?

PM2 is a production process manager for Node.js applications with a built-in load balancer. It allows you to keep applications alive forever, reloads them without downtime, and facilitates common system admin tasks.

## Why PM2 Clustering Instead of Worker Threads?

While worker threads might seem like a good option for parallelization, they share memory space which can cause issues with WebGL/GPU contexts. PM2 uses separate processes with isolated memory spaces, which works much better with WebGL-dependent applications like KromoSynth.

## Benefits of PM2 Clustering

1. **Full GPU Support**: Each process has its own isolated GPU/WebGL context
2. **Automatic Load Balancing**: Incoming connections are distributed across processes
3. **Process Isolation**: Crashes in one process don't affect others
4. **Zero-downtime Reloads**: Updates without service interruption
5. **Simple Configuration**: Easy to set up and maintain

## Configuration

The PM2 clustering is configured through environment variables in the Docker Compose file:

```yaml
kromosynth-render:
  build:
    context: https://github.com/synth-is/kromosynth-render.git
    dockerfile: Dockerfile
    args:
      - USE_PM2=true
  environment:
    # PM2 clustering settings
    - USE_PM2=true
    - PM2_INSTANCES=max
```

The `USE_PM2` argument tells the build process to include PM2 support, and the environment variables configure the PM2 runtime behavior.

Available options for `PM2_INSTANCES`:
- `max`: Use all available CPU cores
- `1`, `2`, etc.: Specify exact number of instances
- `-1`: Use all cores except one

## How It Works

When the Docker container starts:

1. PM2 reads the configuration from environment variables
2. It creates the specified number of Node.js processes
3. All processes share the same port (3000 by default)
4. PM2 load-balances incoming connections across all processes

## Monitoring and Management

You can monitor and manage the PM2 cluster by connecting to the container:

```bash
# Find the container ID
docker ps

# Monitor processes
docker exec -it <container_id> pm2 monit

# View logs
docker exec -it <container_id> pm2 logs

# List processes
docker exec -it <container_id> pm2 list

# Restart all processes
docker exec -it <container_id> pm2 restart all
```

## Troubleshooting

If you encounter issues with PM2 clustering:

1. Check container logs: `docker-compose logs kromosynth-render`
2. Reduce number of instances: Set `PM2_INSTANCES=1` to troubleshoot
3. Disable PM2: Set `USE_PM2=false` to revert to single-process mode

## References

- [PM2 Documentation](https://pm2.keymetrics.io/docs/usage/cluster-mode/)
- [Node.js Clustering Guide](https://nodejs.org/api/cluster.html)
