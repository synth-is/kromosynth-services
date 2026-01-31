export function setupWebSocket(io, evolutionManager) {
  // Set socket handler reference in evolution manager
  evolutionManager.setSocketHandler(io);

  // Set up auto-run scheduler event forwarding
  setupSchedulerEvents(io, evolutionManager.autoRunScheduler);

  io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // Send current runs status on connection
    socket.emit('connection-established', {
      message: 'Connected to Kromosynth Evolution Manager',
      timestamp: new Date().toISOString()
    });

    // Send current auto-run scheduler status on connection
    if (evolutionManager.autoRunScheduler) {
      socket.emit('auto-run-status', {
        status: evolutionManager.autoRunScheduler.getStatus()
      });
    }

    // Handle client requests for current status
    socket.on('get-runs-status', async () => {
      try {
        const runs = await evolutionManager.getAllRuns();
        socket.emit('runs-status', { runs });
      } catch (error) {
        socket.emit('error', { 
          message: 'Failed to get runs status', 
          error: error.message 
        });
      }
    });

    // Handle subscription to specific run updates
    socket.on('subscribe-to-run', (data) => {
      const { runId } = data;
      socket.join(`run-${runId}`);
      console.log(`👁️ Client ${socket.id} subscribed to run ${runId}`);
    });

    // Handle unsubscription from run updates
    socket.on('unsubscribe-from-run', (data) => {
      const { runId } = data;
      socket.leave(`run-${runId}`);
      console.log(`👋 Client ${socket.id} unsubscribed from run ${runId}`);
    });

    // Handle client requests for run logs
    socket.on('get-run-logs', async (data) => {
      const { runId, lines = 50 } = data;
      try {
        const logs = await getRecentLogs(runId, lines);
        socket.emit('run-logs', { runId, logs });
      } catch (error) {
        socket.emit('error', { 
          message: 'Failed to get logs', 
          error: error.message 
        });
      }
    });

    // Handle ping/pong for connection health
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: new Date().toISOString() });
    });

    // ========================================
    // Auto-Run Scheduler WebSocket Handlers
    // ========================================

    // Get current auto-run scheduler status
    socket.on('get-auto-run-status', () => {
      if (evolutionManager.autoRunScheduler) {
        socket.emit('auto-run-status', {
          status: evolutionManager.autoRunScheduler.getStatus()
        });
      }
    });

    // Get auto-run schedule info
    socket.on('get-auto-run-schedule', async () => {
      if (evolutionManager.autoRunScheduler) {
        try {
          const schedule = await evolutionManager.autoRunScheduler.getScheduleInfo();
          socket.emit('auto-run-schedule', { schedule });
        } catch (error) {
          socket.emit('error', {
            message: 'Failed to get schedule info',
            error: error.message
          });
        }
      }
    });

    // Get auto-run config
    socket.on('get-auto-run-config', () => {
      if (evolutionManager.autoRunScheduler) {
        socket.emit('auto-run-config', {
          config: evolutionManager.autoRunScheduler.getConfig()
        });
      }
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      console.log(`🔌 Client disconnected: ${socket.id} (${reason})`);
    });
  });

  // Custom emit functions for the evolution manager
  io.emitRunProgress = (runId, progress) => {
    io.to(`run-${runId}`).emit('run-progress', { runId, progress });
    io.emit('global-run-progress', { runId, progress }); // For dashboard
  };

  io.emitRunLog = (runId, logData) => {
    io.to(`run-${runId}`).emit('run-log', { runId, ...logData });
  };

  io.emitRunStatusChange = (runId, status, metadata = {}) => {
    const eventData = { runId, status, timestamp: new Date().toISOString(), ...metadata };
    io.to(`run-${runId}`).emit('run-status-change', eventData);
    io.emit('global-run-status-change', eventData); // For dashboard
  };

  console.log('🔌 WebSocket handlers configured');
}

/**
 * Get recent log lines for a run
 */
async function getRecentLogs(runId, lines = 50) {
  const fs = await import('fs-extra');
  const path = await import('path');

  const logTypes = ['out', 'err', 'combined'];
  const logs = {};

  for (const type of logTypes) {
    const logPath = path.join(process.cwd(), 'logs', `${runId}.${type}.log`);

    try {
      if (await fs.pathExists(logPath)) {
        const content = await fs.readFile(logPath, 'utf8');
        const logLines = content.split('\n');
        logs[type] = logLines.slice(-lines).join('\n');
      } else {
        logs[type] = '';
      }
    } catch (error) {
      logs[type] = `Error reading log: ${error.message}`;
    }
  }

  return logs;
}

/**
 * Set up event forwarding from AutoRunScheduler to Socket.IO
 */
function setupSchedulerEvents(io, scheduler) {
  if (!scheduler) {
    console.warn('⚠️ AutoRunScheduler not available for WebSocket events');
    return;
  }

  // Forward all scheduler events to connected clients
  const schedulerEvents = [
    'auto-run-status-change',
    'time-slice-started',
    'time-slice-ending',
    'time-slice-expired',
    'run-paused',
    'run-resumed',
    'run-ended',
    'template-config-change'
  ];

  for (const eventName of schedulerEvents) {
    scheduler.on(eventName, (data) => {
      io.emit(eventName, {
        ...data,
        timestamp: new Date().toISOString()
      });
    });
  }

  console.log('📅 Auto-run scheduler WebSocket events configured');
}
