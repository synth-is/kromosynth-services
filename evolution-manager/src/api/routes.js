import express from 'express';
import path from 'path';
import fs from 'fs-extra';

export function setupApiRoutes(app, evolutionManager, io) {
  const router = express.Router();

  // Health check
  router.get('/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      service: 'kromosynth-evolution-manager'
    });
  });

  // Get all available templates
  router.get('/templates', async (req, res) => {
    try {
      const templates = await evolutionManager.getTemplates();
      res.json({ templates });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to get templates', 
        message: error.message 
      });
    }
  });

  // Get all evolution runs
  router.get('/runs', async (req, res) => {
    try {
      const runs = await evolutionManager.getAllRuns();
      res.json({ runs });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to get runs', 
        message: error.message 
      });
    }
  });

  // Get specific evolution run
  router.get('/runs/:runId', async (req, res) => {
    try {
      const run = await evolutionManager.getRun(req.params.runId);
      res.json({ run });
    } catch (error) {
      if (error.message.includes('not found')) {
        res.status(404).json({ 
          error: 'Run not found', 
          message: error.message 
        });
      } else {
        res.status(500).json({ 
          error: 'Failed to get run', 
          message: error.message 
        });
      }
    }
  });

  // Start new evolution run
  router.post('/runs', async (req, res) => {
    try {
      const { templateName, options = {} } = req.body;
      
      if (!templateName) {
        return res.status(400).json({ 
          error: 'Template name is required' 
        });
      }

      const runId = await evolutionManager.startRun(templateName, options);
      
      // Emit websocket event
      io.emit('run-started', { runId, templateName, options });
      
      res.status(201).json({ 
        runId, 
        message: 'Evolution run started successfully' 
      });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to start evolution run', 
        message: error.message 
      });
    }
  });

  // Stop evolution run
  router.delete('/runs/:runId', async (req, res) => {
    try {
      await evolutionManager.stopRun(req.params.runId);
      
      // Emit websocket event
      io.emit('run-stopped', { runId: req.params.runId });
      
      res.json({ 
        message: 'Evolution run stopped successfully' 
      });
    } catch (error) {
      if (error.message.includes('not found')) {
        res.status(404).json({ 
          error: 'Run not found', 
          message: error.message 
        });
      } else {
        res.status(500).json({ 
          error: 'Failed to stop evolution run', 
          message: error.message 
        });
      }
    }
  });

  // Get run logs (if we want to serve logs via REST)
  router.get('/runs/:runId/logs', async (req, res) => {
    try {
      const run = await evolutionManager.getRun(req.params.runId);
      const logTypes = ['out', 'err', 'combined'];
      const logs = {};
      
      for (const type of logTypes) {
        const logPath = path.join(process.cwd(), 'logs', `${req.params.runId}.${type}.log`);
        try {
          logs[type] = await fs.readFile(logPath, 'utf8');
        } catch (err) {
          logs[type] = 'Log file not found or empty';
        }
      }
      
      res.json({ logs });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to get logs', 
        message: error.message 
      });
    }
  });

  // Get system status
  router.get('/status', async (req, res) => {
    try {
      const runs = await evolutionManager.getAllRuns();
      const runningRuns = runs.filter(run => run.status === 'running');
      const completedRuns = runs.filter(run => run.status === 'completed');
      const failedRuns = runs.filter(run => run.status === 'failed');
      
      res.json({
        timestamp: new Date().toISOString(),
        totalRuns: runs.length,
        runningRuns: runningRuns.length,
        completedRuns: completedRuns.length,
        failedRuns: failedRuns.length,
        systemLoad: {
          // Add system monitoring if needed
          uptime: process.uptime(),
          memory: process.memoryUsage()
        }
      });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to get system status', 
        message: error.message 
      });
    }
  });

  // Mount router
  app.use('/api', router);

  // Serve static files (for any web interface later)
  app.use(express.static('public'));

  // Default route
  app.get('/', (req, res) => {
    res.json({
      service: 'Kromosynth Evolution Manager',
      version: '1.0.0',
      endpoints: {
        health: '/api/health',
        templates: '/api/templates',
        runs: '/api/runs',
        status: '/api/status'
      },
      websocket: 'Available on same port'
    });
  });
}
