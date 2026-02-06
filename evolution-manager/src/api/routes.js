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

  // Get specific template with full configuration
  router.get('/templates/:templateName', async (req, res) => {
    try {
      const template = await evolutionManager.getTemplate(req.params.templateName);
      if (!template) {
        return res.status(404).json({
          error: 'Template not found',
          message: `Template '${req.params.templateName}' does not exist`
        });
      }
      res.json({ template });
    } catch (error) {
      if (error.message.includes('not found')) {
        res.status(404).json({
          error: 'Template not found',
          message: error.message
        });
      } else {
        res.status(500).json({
          error: 'Failed to get template',
          message: error.message
        });
      }
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
      const { templateName, ecosystemVariant, options = {} } = req.body;
      
      if (!templateName) {
        return res.status(400).json({ 
          error: 'Template name is required' 
        });
      }

      // Add ecosystem variant to options if specified
      if (ecosystemVariant) {
        options.ecosystemVariant = ecosystemVariant;
      }

      const runId = await evolutionManager.startRun(templateName, options);
      
      // Emit websocket event
      io.emit('run-started', { runId, templateName, ecosystemVariant, options });
      
      res.status(201).json({ 
        runId, 
        templateName,
        ecosystemVariant: ecosystemVariant || 'default',
        message: 'Evolution run started successfully' 
      });
    } catch (error) {
      console.error('Error starting evolution run:', error);
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

  // Resume a stopped/failed evolution run
  router.post('/runs/:runId/resume', async (req, res) => {
    try {
      const runId = await evolutionManager.resumeRun(req.params.runId);

      // Emit websocket event
      io.emit('run-started', { runId, resumed: true });

      res.json({
        runId,
        message: 'Evolution run resumed successfully'
      });
    } catch (error) {
      if (error.message.includes('not found')) {
        res.status(404).json({
          error: 'Run not found',
          message: error.message
        });
      } else if (error.message.includes('already running')) {
        res.status(409).json({
          error: 'Run already running',
          message: error.message
        });
      } else {
        console.error('Error resuming evolution run:', error);
        res.status(500).json({
          error: 'Failed to resume evolution run',
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
      
      // Get service dependency status
      const serviceRuns = evolutionManager.serviceDependencyManager.getAllServiceRuns();
      const totalServices = serviceRuns.reduce((count, run) => count + run.services.length, 0);
      
      res.json({
        timestamp: new Date().toISOString(),
        totalRuns: runs.length,
        runningRuns: runningRuns.length,
        completedRuns: completedRuns.length,
        failedRuns: failedRuns.length,
        serviceRuns: serviceRuns.length,
        totalServices: totalServices,
        systemLoad: {
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

  // Get service status for all runs
  router.get('/services', async (req, res) => {
    try {
      const serviceRuns = evolutionManager.serviceDependencyManager.getAllServiceRuns();
      res.json({ serviceRuns });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to get service status', 
        message: error.message 
      });
    }
  });

  // Get service status for specific run
  router.get('/runs/:runId/services', async (req, res) => {
    try {
      const serviceInfo = evolutionManager.serviceDependencyManager.getServiceInfo(req.params.runId);
      if (!serviceInfo) {
        return res.status(404).json({
          error: 'No services found for this run'
        });
      }
      res.json({ serviceInfo });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get service info',
        message: error.message
      });
    }
  });

  // ========================================
  // Auto-Run Scheduler Endpoints
  // ========================================

  const scheduler = evolutionManager.autoRunScheduler;

  // Get auto-run scheduler status
  router.get('/auto-run/status', (req, res) => {
    try {
      const status = scheduler.getStatus();
      res.json({ status });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get scheduler status',
        message: error.message
      });
    }
  });

  // Get auto-run configuration
  router.get('/auto-run/config', (req, res) => {
    try {
      const config = scheduler.getConfig();
      res.json({ config });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get scheduler config',
        message: error.message
      });
    }
  });

  // Update auto-run configuration
  router.put('/auto-run/config', async (req, res) => {
    try {
      const config = await scheduler.updateConfig(req.body);
      io.emit('auto-run-status-change', scheduler.getStatus());
      res.json({ config });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to update scheduler config',
        message: error.message
      });
    }
  });

  // Enable auto-run scheduling
  router.post('/auto-run/enable', async (req, res) => {
    try {
      await scheduler.enable();
      io.emit('auto-run-status-change', scheduler.getStatus());
      res.json({
        message: 'Auto-run scheduling enabled',
        status: scheduler.getStatus()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to enable scheduler',
        message: error.message
      });
    }
  });

  // Disable auto-run scheduling
  router.post('/auto-run/disable', async (req, res) => {
    try {
      await scheduler.disable();
      io.emit('auto-run-status-change', scheduler.getStatus());
      res.json({
        message: 'Auto-run scheduling disabled',
        status: scheduler.getStatus()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to disable scheduler',
        message: error.message
      });
    }
  });

  // Resume auto-run scheduling (after pause due to failures)
  router.post('/auto-run/resume', async (req, res) => {
    try {
      await scheduler.resumeScheduling();
      io.emit('auto-run-status-change', scheduler.getStatus());
      res.json({
        message: 'Auto-run scheduling resumed',
        status: scheduler.getStatus()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to resume scheduler',
        message: error.message
      });
    }
  });

  // Get current schedule information
  router.get('/auto-run/schedule', async (req, res) => {
    try {
      const schedule = await scheduler.getScheduleInfo();
      res.json({ schedule });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get schedule info',
        message: error.message
      });
    }
  });

  // Get all templates with their scheduling status
  router.get('/auto-run/templates', async (req, res) => {
    try {
      const allTemplates = await evolutionManager.getTemplates();
      const enabledTemplates = scheduler.getEnabledTemplates();
      const schedulerConfig = scheduler.getConfig();

      // Merge template info with scheduling status
      const templatesWithStatus = allTemplates.map(template => {
        const scheduledConfig = schedulerConfig.enabledTemplates.find(
          t => t.templateName === template.name
        );
        return {
          ...template,
          autoRunEnabled: scheduledConfig?.enabled || false,
          autoRunConfig: scheduledConfig || null
        };
      });

      res.json({ templates: templatesWithStatus });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get templates with scheduling status',
        message: error.message
      });
    }
  });

  // Enable a template for auto-scheduling
  router.post('/auto-run/templates/:templateName/enable', async (req, res) => {
    try {
      const { templateName } = req.params;
      const { ecosystemVariant = 'default', priority, timeSliceMinutes } = req.body;

      const template = await scheduler.enableTemplate(templateName, ecosystemVariant, {
        priority,
        timeSliceMinutes
      });

      io.emit('template-config-change', {
        templateName,
        ecosystemVariant,
        enabled: true
      });

      res.json({
        message: `Template ${templateName} enabled for auto-scheduling`,
        template
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to enable template',
        message: error.message
      });
    }
  });

  // Disable a template from auto-scheduling
  router.post('/auto-run/templates/:templateName/disable', async (req, res) => {
    try {
      const { templateName } = req.params;
      const { ecosystemVariant = 'default' } = req.body;

      await scheduler.disableTemplate(templateName, ecosystemVariant);

      io.emit('template-config-change', {
        templateName,
        ecosystemVariant,
        enabled: false
      });

      res.json({
        message: `Template ${templateName} disabled from auto-scheduling`
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to disable template',
        message: error.message
      });
    }
  });

  // Update template scheduling configuration
  router.put('/auto-run/templates/:templateName/config', async (req, res) => {
    try {
      const { templateName } = req.params;
      const { ecosystemVariant = 'default', ...updates } = req.body;

      const template = await scheduler.updateTemplateConfig(templateName, ecosystemVariant, updates);

      if (!template) {
        return res.status(404).json({
          error: 'Template not found in auto-run configuration'
        });
      }

      io.emit('template-config-change', {
        templateName,
        ecosystemVariant,
        ...updates
      });

      res.json({ template });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to update template config',
        message: error.message
      });
    }
  });

  // Remove a template completely from auto-scheduling
  router.delete('/auto-run/templates/:templateName', async (req, res) => {
    try {
      const { templateName } = req.params;
      const { ecosystemVariant = 'default' } = req.query;

      const removed = await scheduler.removeTemplate(templateName, ecosystemVariant);

      if (!removed) {
        return res.status(404).json({
          error: 'Template not found in auto-run configuration'
        });
      }

      io.emit('template-config-change', {
        templateName,
        ecosystemVariant,
        removed: true
      });

      res.json({
        message: `Template ${templateName} removed from auto-scheduling`
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to remove template',
        message: error.message
      });
    }
  });

  // ========================================
  // Data Sync Endpoints
  // ========================================

  const syncManager = evolutionManager.syncManager;

  // Get sync status for all runs
  router.get('/sync/status', (req, res) => {
    try {
      const status = syncManager.getStatus();
      res.json({ status });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get sync status',
        message: error.message
      });
    }
  });

  // Get sync status for a specific run
  router.get('/sync/:runId/status', (req, res) => {
    try {
      const status = syncManager.getRunStatus(req.params.runId);
      if (!status) {
        return res.status(404).json({ error: 'No sync data found for this run' });
      }
      res.json({ status });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get sync status',
        message: error.message
      });
    }
  });

  // Manually trigger sync for a specific run
  router.post('/sync/:runId/trigger', async (req, res) => {
    try {
      const { types } = req.body || {};
      await syncManager.triggerSync(req.params.runId, 'manual');
      res.json({ message: 'Sync triggered', runId: req.params.runId });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to trigger sync',
        message: error.message
      });
    }
  });

  // Update global sync configuration
  router.put('/sync/config', (req, res) => {
    try {
      const config = syncManager.updateConfig(req.body);
      io.emit('sync-config-updated', config);
      res.json({ config });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to update sync config',
        message: error.message
      });
    }
  });

  // ========================================
  // Global Configuration Defaults Endpoints
  // ========================================

  const configManager = evolutionManager.configManager;

  // Get current global defaults
  router.get('/config/global-defaults', async (req, res) => {
    try {
      const defaults = await configManager.loadGlobalDefaults();
      res.json(defaults);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to load global defaults',
        message: error.message
      });
    }
  });

  // Update global defaults (persists to global-defaults.json)
  router.put('/config/global-defaults', async (req, res) => {
    try {
      const saved = await configManager.saveGlobalDefaults(req.body);
      const defaults = await configManager.loadGlobalDefaults();

      io.emit('global-defaults-updated', defaults);

      res.json({
        success: true,
        defaults,
        message: 'Global defaults updated successfully'
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to save global defaults',
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
        status: '/api/status',
        services: '/api/services',
        config: {
          globalDefaults: {
            get: 'GET /api/config/global-defaults',
            update: 'PUT /api/config/global-defaults'
          }
        },
        autoRun: {
          status: '/api/auto-run/status',
          config: '/api/auto-run/config',
          schedule: '/api/auto-run/schedule',
          templates: '/api/auto-run/templates',
          enable: 'POST /api/auto-run/enable',
          disable: 'POST /api/auto-run/disable',
          resume: 'POST /api/auto-run/resume'
        },
        sync: {
          status: 'GET /api/sync/status',
          runStatus: 'GET /api/sync/:runId/status',
          trigger: 'POST /api/sync/:runId/trigger',
          config: 'PUT /api/sync/config'
        }
      },
      websocket: 'Available on same port'
    });
  });
}
