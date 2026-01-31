/**
 * AutoRunScheduler - Manages automatic scheduling of evolution runs
 *
 * Features:
 * - Maintains configured number of concurrent runs
 * - Time-sliced scheduling: runs are paused/resumed based on time allocation
 * - Round-robin and priority-based scheduling modes
 * - Automatic run start when existing runs complete or time slice expires
 */

import fs from 'fs-extra';
import path from 'path';
import { EventEmitter } from 'events';

export class AutoRunScheduler extends EventEmitter {
  constructor(evolutionManager) {
    super();
    this.evolutionManager = evolutionManager;
    this.config = null;
    this.configPath = path.join(process.cwd(), 'working', 'auto-run-config.json');

    // Time slice management
    this.timeSliceTimers = new Map(); // runId -> { warningTimer, expiryTimer, startedAt }
    this.activeTimeSlices = new Map(); // runId -> templateKey

    // Scheduling state
    this.isScheduling = false;
    this.schedulerPaused = false;
    this.pauseReason = null;

    // Template rotation tracking
    this.rotationIndex = 0;
  }

  /**
   * Initialize the scheduler
   */
  async initialize() {
    await this.loadConfig();

    // Clean up any invalid templates from the config
    await this.cleanupInvalidTemplates();

    console.log('📅 AutoRunScheduler initialized');

    // If scheduler was enabled before restart, resume scheduling
    if (this.config.enabled && !this.schedulerPaused) {
      console.log('📅 Resuming auto-run scheduling...');
      await this.resumeScheduling();
    }
  }

  /**
   * Remove templates from config that don't have valid template directories
   */
  async cleanupInvalidTemplates() {
    if (!this.config.enabledTemplates || this.config.enabledTemplates.length === 0) {
      return;
    }

    const validTemplates = [];
    const invalidTemplates = [];

    for (const template of this.config.enabledTemplates) {
      try {
        const templateInfo = await this.evolutionManager.getTemplate(template.templateName);
        if (templateInfo) {
          validTemplates.push(template);
        } else {
          invalidTemplates.push(template.templateName);
        }
      } catch (error) {
        invalidTemplates.push(template.templateName);
      }
    }

    if (invalidTemplates.length > 0) {
      console.log(`📅 Removing ${invalidTemplates.length} invalid templates from config: ${invalidTemplates.join(', ')}`);
      this.config.enabledTemplates = validTemplates;
      await this.saveConfig();
    }
  }

  /**
   * Load configuration from disk
   */
  async loadConfig() {
    try {
      if (await fs.pathExists(this.configPath)) {
        this.config = await fs.readJson(this.configPath);
        console.log(`📅 Loaded auto-run config: ${this.config.enabledTemplates?.length || 0} templates`);
      } else {
        this.config = this.getDefaultConfig();
        await this.saveConfig();
        console.log('📅 Created default auto-run config');
      }
    } catch (error) {
      console.error('Failed to load auto-run config:', error);
      this.config = this.getDefaultConfig();
    }
  }

  /**
   * Save configuration to disk
   */
  async saveConfig() {
    try {
      await fs.ensureDir(path.dirname(this.configPath));
      await fs.writeJson(this.configPath, this.config, { spaces: 2 });
    } catch (error) {
      console.error('Failed to save auto-run config:', error);
    }
  }

  /**
   * Get default configuration
   */
  getDefaultConfig() {
    return {
      enabled: false,
      maxConcurrentRuns: 1,
      schedulingMode: 'round-robin', // 'round-robin' or 'priority'
      defaultTimeSliceMinutes: 30,
      enabledTemplates: [],
      pauseOnFailure: true,
      maxFailuresBeforePause: 3,
      consecutiveFailures: 0,
      lastScheduledAt: null
    };
  }

  // ========================================
  // Configuration Management
  // ========================================

  /**
   * Enable auto-run scheduling
   */
  async enable() {
    if (this.config.enabled) return;

    this.config.enabled = true;
    this.schedulerPaused = false;
    this.pauseReason = null;
    await this.saveConfig();

    console.log('📅 Auto-run scheduling enabled');
    this.emit('auto-run-status-change', this.getStatus());

    // Start scheduling if there are enabled templates
    await this.startScheduling();
  }

  /**
   * Disable auto-run scheduling
   */
  async disable() {
    if (!this.config.enabled) return;

    this.config.enabled = false;
    await this.saveConfig();

    // Clear all time slice timers
    this.clearAllTimers();

    console.log('📅 Auto-run scheduling disabled');
    this.emit('auto-run-status-change', this.getStatus());
  }

  /**
   * Pause scheduling (e.g., due to failures)
   */
  pause(reason) {
    this.schedulerPaused = true;
    this.pauseReason = reason;
    this.clearAllTimers();

    console.log(`📅 Auto-run scheduling paused: ${reason}`);
    this.emit('auto-run-status-change', this.getStatus());
  }

  /**
   * Resume scheduling after pause
   */
  async resumeScheduling() {
    this.schedulerPaused = false;
    this.pauseReason = null;
    this.config.consecutiveFailures = 0;
    await this.saveConfig();

    console.log('📅 Auto-run scheduling resumed');
    this.emit('auto-run-status-change', this.getStatus());

    await this.startScheduling();
  }

  /**
   * Set maximum concurrent runs
   */
  async setMaxConcurrentRuns(count) {
    this.config.maxConcurrentRuns = Math.max(1, Math.min(5, count));
    await this.saveConfig();

    console.log(`📅 Max concurrent runs set to ${this.config.maxConcurrentRuns}`);
    this.emit('auto-run-status-change', this.getStatus());

    // Trigger scheduling check in case we can now start more runs
    if (this.config.enabled && !this.schedulerPaused) {
      await this.scheduleNextRun();
    }
  }

  /**
   * Set scheduling mode
   */
  async setSchedulingMode(mode) {
    if (!['round-robin', 'priority'].includes(mode)) {
      throw new Error('Invalid scheduling mode. Use "round-robin" or "priority"');
    }
    this.config.schedulingMode = mode;
    await this.saveConfig();

    console.log(`📅 Scheduling mode set to ${mode}`);
    this.emit('auto-run-status-change', this.getStatus());
  }

  /**
   * Set default time slice duration
   */
  async setDefaultTimeSlice(minutes) {
    this.config.defaultTimeSliceMinutes = Math.max(1, minutes);
    await this.saveConfig();
  }

  // ========================================
  // Template Management
  // ========================================

  /**
   * Enable a template for auto-scheduling
   */
  async enableTemplate(templateName, ecosystemVariant = 'default', options = {}) {
    const key = this.getTemplateKey(templateName, ecosystemVariant);

    // Validate that the template actually exists before enabling
    try {
      const templateInfo = await this.evolutionManager.getTemplate(templateName);
      if (!templateInfo) {
        throw new Error(`Template '${templateName}' not found`);
      }
    } catch (error) {
      console.error(`📅 Cannot enable template ${key}: ${error.message}`);
      throw error;
    }

    // Check if already exists in config
    let template = this.config.enabledTemplates.find(
      t => t.templateName === templateName && t.ecosystemVariant === ecosystemVariant
    );

    if (template) {
      template.enabled = true;
      template.priority = options.priority ?? template.priority ?? 1;
      template.timeSliceMinutes = options.timeSliceMinutes ?? template.timeSliceMinutes ?? this.config.defaultTimeSliceMinutes;
    } else {
      template = {
        templateName,
        ecosystemVariant,
        priority: options.priority ?? 1,
        enabled: true,
        timeSliceMinutes: options.timeSliceMinutes ?? this.config.defaultTimeSliceMinutes,
        lastRunAt: null,
        totalRunTimeMinutes: 0,
        currentRunId: null
      };
      this.config.enabledTemplates.push(template);
    }

    await this.saveConfig();
    console.log(`📅 Template enabled: ${key}`);
    this.emit('template-config-change', { templateName, ecosystemVariant, enabled: true });

    // Trigger scheduling if auto-run is active
    if (this.config.enabled && !this.schedulerPaused) {
      await this.scheduleNextRun();
    }

    return template;
  }

  /**
   * Disable a template from auto-scheduling
   */
  async disableTemplate(templateName, ecosystemVariant = 'default') {
    const template = this.config.enabledTemplates.find(
      t => t.templateName === templateName && t.ecosystemVariant === ecosystemVariant
    );

    if (template) {
      template.enabled = false;
      await this.saveConfig();

      console.log(`📅 Template disabled: ${this.getTemplateKey(templateName, ecosystemVariant)}`);
      this.emit('template-config-change', { templateName, ecosystemVariant, enabled: false });
    }
  }

  /**
   * Remove a template completely from auto-scheduling configuration
   */
  async removeTemplate(templateName, ecosystemVariant = 'default') {
    const index = this.config.enabledTemplates.findIndex(
      t => t.templateName === templateName && t.ecosystemVariant === ecosystemVariant
    );

    if (index !== -1) {
      const template = this.config.enabledTemplates[index];

      // If this template has an active time slice, clear it
      if (template.currentRunId) {
        this.clearTimeSliceTimer(template.currentRunId);
      }

      // Remove from the array
      this.config.enabledTemplates.splice(index, 1);
      await this.saveConfig();

      console.log(`📅 Template removed: ${this.getTemplateKey(templateName, ecosystemVariant)}`);
      this.emit('template-config-change', { templateName, ecosystemVariant, removed: true });

      return true;
    }

    return false;
  }

  /**
   * Update template configuration
   */
  async updateTemplateConfig(templateName, ecosystemVariant = 'default', updates) {
    const template = this.config.enabledTemplates.find(
      t => t.templateName === templateName && t.ecosystemVariant === ecosystemVariant
    );

    if (template) {
      if (updates.priority !== undefined) template.priority = updates.priority;
      if (updates.timeSliceMinutes !== undefined) template.timeSliceMinutes = updates.timeSliceMinutes;
      if (updates.enabled !== undefined) template.enabled = updates.enabled;
      await this.saveConfig();

      this.emit('template-config-change', { templateName, ecosystemVariant, ...updates });
    }

    return template;
  }

  /**
   * Get all templates with their scheduling status
   */
  getEnabledTemplates() {
    if (!this.config || !this.config.enabledTemplates) return [];
    return this.config.enabledTemplates.filter(t => t.enabled);
  }

  /**
   * Get template key for identification
   */
  getTemplateKey(templateName, ecosystemVariant) {
    return `${templateName}:${ecosystemVariant}`;
  }

  // ========================================
  // Scheduling Logic
  // ========================================

  /**
   * Start the scheduling process
   */
  async startScheduling() {
    if (!this.config.enabled || this.schedulerPaused) return;

    const enabledTemplates = this.getEnabledTemplates();
    if (enabledTemplates.length === 0) {
      console.log('📅 No enabled templates for auto-scheduling');
      return;
    }

    // Get current active runs
    const activeRuns = await this.getActiveScheduledRuns();
    const slotsAvailable = this.config.maxConcurrentRuns - activeRuns.length;

    if (slotsAvailable > 0) {
      console.log(`📅 Starting scheduling: ${slotsAvailable} slots available`);
      for (let i = 0; i < slotsAvailable; i++) {
        await this.scheduleNextRun();
      }
    }
  }

  /**
   * Schedule the next run based on scheduling mode
   */
  async scheduleNextRun() {
    if (!this.config.enabled || this.schedulerPaused || this.isScheduling) return;

    this.isScheduling = true;
    try {
      const activeRuns = await this.getActiveScheduledRuns();

      if (activeRuns.length >= this.config.maxConcurrentRuns) {
        console.log('📅 Max concurrent runs reached, waiting...');
        return;
      }

      const template = this.selectNextTemplate();
      if (!template) {
        console.log('📅 No available templates to schedule');
        return;
      }

      await this.resumeOrStartRun(template);
    } catch (error) {
      console.error('📅 Error scheduling next run:', error);
    } finally {
      this.isScheduling = false;
    }
  }

  /**
   * Select the next template based on scheduling mode
   */
  selectNextTemplate() {
    const enabledTemplates = this.getEnabledTemplates();
    if (enabledTemplates.length === 0) return null;

    // Filter out templates that already have an active run
    const availableTemplates = enabledTemplates.filter(t => {
      if (!t.currentRunId) return true;
      // Check if the current run is actually running or paused (not stopped/terminated)
      const run = this.evolutionManager.runs.get(t.currentRunId);
      return !run || ['stopped', 'terminated', 'failed'].includes(run.status);
    });

    if (availableTemplates.length === 0) return null;

    if (this.config.schedulingMode === 'priority') {
      // Sort by priority (lower number = higher priority)
      return availableTemplates.sort((a, b) => a.priority - b.priority)[0];
    } else {
      // Round-robin: sort by lastRunAt (oldest first)
      return availableTemplates.sort((a, b) => {
        if (!a.lastRunAt) return -1;
        if (!b.lastRunAt) return 1;
        return new Date(a.lastRunAt) - new Date(b.lastRunAt);
      })[0];
    }
  }

  /**
   * Resume a paused run or start a fresh run for a template
   */
  async resumeOrStartRun(templateConfig) {
    const key = this.getTemplateKey(templateConfig.templateName, templateConfig.ecosystemVariant);

    // Check if there's a paused run for this template
    const pausedRun = await this.findPausedRun(templateConfig.templateName, templateConfig.ecosystemVariant);

    let runId;
    if (pausedRun) {
      // Resume existing paused run
      console.log(`📅 Resuming paused run ${pausedRun.id} for ${key}`);
      await this.evolutionManager.resumeRun(pausedRun.id);
      runId = pausedRun.id;

      this.emit('run-resumed', { runId, templateName: templateConfig.templateName, ecosystemVariant: templateConfig.ecosystemVariant });
    } else {
      // Start fresh run
      console.log(`📅 Starting fresh run for ${key}`);
      // startRun returns runId directly, not { runId }
      runId = await this.evolutionManager.startRun(
        templateConfig.templateName,
        {
          ecosystemVariant: templateConfig.ecosystemVariant,
          autoScheduled: true
        }
      );

      // The autoScheduled flag is now set in startRun via options
    }

    // Update template tracking
    templateConfig.currentRunId = runId;
    templateConfig.lastRunAt = new Date().toISOString();
    await this.saveConfig();

    // Start time slice timer
    const durationMs = templateConfig.timeSliceMinutes * 60 * 1000;
    this.startTimeSliceTimer(runId, durationMs, templateConfig);

    this.emit('time-slice-started', {
      runId,
      templateName: templateConfig.templateName,
      ecosystemVariant: templateConfig.ecosystemVariant,
      durationMinutes: templateConfig.timeSliceMinutes
    });

    return runId;
  }

  /**
   * Find a paused run for a template
   */
  async findPausedRun(templateName, ecosystemVariant) {
    const runs = await this.evolutionManager.getAllRuns();
    return runs.find(r =>
      r.templateName === templateName &&
      r.ecosystemVariant === ecosystemVariant &&
      r.status === 'paused' &&
      r.pausedByScheduler === true
    );
  }

  // ========================================
  // Time Slice Management
  // ========================================

  /**
   * Start a time slice timer for a run
   */
  startTimeSliceTimer(runId, durationMs, templateConfig) {
    // Clear existing timer if any
    this.clearTimeSliceTimer(runId);

    const startedAt = Date.now();

    // Warning timer (5 minutes before expiry, or half the duration if less than 10 min)
    const warningTime = Math.min(5 * 60 * 1000, durationMs / 2);
    const warningTimer = setTimeout(() => {
      this.emit('time-slice-ending', {
        runId,
        remainingMs: durationMs - (Date.now() - startedAt),
        templateName: templateConfig.templateName
      });
    }, durationMs - warningTime);

    // Expiry timer
    const expiryTimer = setTimeout(() => {
      this.onTimeSliceExpired(runId, templateConfig);
    }, durationMs);

    this.timeSliceTimers.set(runId, { warningTimer, expiryTimer, startedAt, durationMs });
    this.activeTimeSlices.set(runId, this.getTemplateKey(templateConfig.templateName, templateConfig.ecosystemVariant));
  }

  /**
   * Clear time slice timer for a run
   */
  clearTimeSliceTimer(runId) {
    const timers = this.timeSliceTimers.get(runId);
    if (timers) {
      clearTimeout(timers.warningTimer);
      clearTimeout(timers.expiryTimer);
      this.timeSliceTimers.delete(runId);
    }
    this.activeTimeSlices.delete(runId);
  }

  /**
   * Clear all time slice timers
   */
  clearAllTimers() {
    for (const runId of this.timeSliceTimers.keys()) {
      this.clearTimeSliceTimer(runId);
    }
  }

  /**
   * Handle time slice expiration
   */
  async onTimeSliceExpired(runId, templateConfig) {
    console.log(`📅 Time slice expired for run ${runId}`);

    // Clear the timer
    this.clearTimeSliceTimer(runId);

    // Get the run
    const run = this.evolutionManager.runs.get(runId);
    if (!run || run.status !== 'running') {
      // Run already stopped/terminated, just schedule next
      await this.scheduleNextRun();
      return;
    }

    // Pause the run (not stop - it will be resumed later)
    await this.pauseRunForScheduling(runId);

    // Update template tracking
    const template = this.findTemplateConfig(templateConfig.templateName, templateConfig.ecosystemVariant);
    if (template) {
      // Keep currentRunId so we can resume this run later
      template.totalRunTimeMinutes = (template.totalRunTimeMinutes || 0) + templateConfig.timeSliceMinutes;
      await this.saveConfig();
    }

    this.emit('time-slice-expired', {
      runId,
      templateName: templateConfig.templateName,
      ecosystemVariant: templateConfig.ecosystemVariant
    });

    // Schedule next run
    await this.scheduleNextRun();
  }

  /**
   * Pause a run for scheduling (different from user stop)
   */
  async pauseRunForScheduling(runId) {
    console.log(`📅 Pausing run ${runId} for scheduling rotation`);

    // Use the evolution manager's pause method
    await this.evolutionManager.pauseRun(runId);

    // Mark as paused by scheduler
    const run = this.evolutionManager.runs.get(runId);
    if (run) {
      run.pausedByScheduler = true;
      run.pauseCount = (run.pauseCount || 0) + 1;
    }

    this.emit('run-paused', { runId, pausedByScheduler: true });
  }

  // ========================================
  // Run Event Handlers
  // ========================================

  /**
   * Handle when a run ends (stopped, terminated, or failed)
   */
  onRunEnded(runId, reason) {
    // reason: 'stopped' (user), 'terminated' (natural completion), 'failed' (crash)
    console.log(`📅 Run ${runId} ended: ${reason}`);

    // Clear time slice timer if active
    this.clearTimeSliceTimer(runId);

    // Find which template this run belongs to
    const template = this.findTemplateByRunId(runId);

    if (template) {
      // Clear the current run reference - next time slice will start fresh
      template.currentRunId = null;
      this.saveConfig();
    }

    // Track failures
    if (reason === 'failed') {
      this.config.consecutiveFailures++;
      if (this.config.pauseOnFailure && this.config.consecutiveFailures >= this.config.maxFailuresBeforePause) {
        this.pause(`Too many consecutive failures (${this.config.consecutiveFailures})`);
        return;
      }
    } else {
      this.config.consecutiveFailures = 0;
    }
    this.saveConfig();

    this.emit('run-ended', { runId, reason });

    // Schedule next run if auto-run is active
    if (this.config.enabled && !this.schedulerPaused) {
      this.scheduleNextRun();
    }
  }

  /**
   * Find template configuration by run ID
   */
  findTemplateByRunId(runId) {
    return this.config.enabledTemplates.find(t => t.currentRunId === runId);
  }

  /**
   * Find template configuration by name and variant
   */
  findTemplateConfig(templateName, ecosystemVariant) {
    return this.config.enabledTemplates.find(
      t => t.templateName === templateName && t.ecosystemVariant === ecosystemVariant
    );
  }

  // ========================================
  // Status and Queries
  // ========================================

  /**
   * Get current scheduler status
   */
  getStatus() {
    // Return safe defaults if config hasn't been loaded yet
    if (!this.config) {
      return {
        enabled: false,
        paused: false,
        pauseReason: null,
        maxConcurrentRuns: 1,
        schedulingMode: 'round-robin',
        defaultTimeSliceMinutes: 30,
        enabledTemplatesCount: 0,
        totalTemplatesCount: 0,
        consecutiveFailures: 0,
        activeTimeSlices: 0,
        initialized: false
      };
    }

    return {
      enabled: this.config.enabled,
      paused: this.schedulerPaused,
      pauseReason: this.pauseReason,
      maxConcurrentRuns: this.config.maxConcurrentRuns,
      schedulingMode: this.config.schedulingMode,
      defaultTimeSliceMinutes: this.config.defaultTimeSliceMinutes,
      enabledTemplatesCount: this.getEnabledTemplates().length,
      totalTemplatesCount: this.config.enabledTemplates.length,
      consecutiveFailures: this.config.consecutiveFailures,
      activeTimeSlices: this.activeTimeSlices.size,
      initialized: true
    };
  }

  /**
   * Get active scheduled runs
   */
  async getActiveScheduledRuns() {
    const runs = await this.evolutionManager.getAllRuns();
    return runs.filter(r => r.autoScheduled && r.status === 'running');
  }

  /**
   * Get paused scheduled runs
   */
  async getPausedScheduledRuns() {
    const runs = await this.evolutionManager.getAllRuns();
    return runs.filter(r => r.autoScheduled && r.status === 'paused' && r.pausedByScheduler);
  }

  /**
   * Get current schedule information
   */
  async getScheduleInfo() {
    // Return empty schedule if config not loaded yet
    if (!this.config) {
      return {
        activeRuns: [],
        pausedRuns: [],
        timeSlices: [],
        enabledTemplates: []
      };
    }

    const activeRuns = await this.getActiveScheduledRuns();
    const pausedRuns = await this.getPausedScheduledRuns();

    const timeSliceInfo = [];
    for (const [runId, templateKey] of this.activeTimeSlices) {
      const timers = this.timeSliceTimers.get(runId);
      if (timers) {
        const elapsed = Date.now() - timers.startedAt;
        const remaining = timers.durationMs - elapsed;
        timeSliceInfo.push({
          runId,
          templateKey,
          elapsedMs: elapsed,
          remainingMs: Math.max(0, remaining),
          totalMs: timers.durationMs
        });
      }
    }

    return {
      activeRuns: activeRuns.map(r => ({
        runId: r.id,
        templateName: r.templateName,
        ecosystemVariant: r.ecosystemVariant
      })),
      pausedRuns: pausedRuns.map(r => ({
        runId: r.id,
        templateName: r.templateName,
        ecosystemVariant: r.ecosystemVariant,
        pauseCount: r.pauseCount || 0
      })),
      timeSlices: timeSliceInfo,
      enabledTemplates: this.config.enabledTemplates.map(t => ({
        templateName: t.templateName,
        ecosystemVariant: t.ecosystemVariant,
        enabled: t.enabled,
        priority: t.priority,
        timeSliceMinutes: t.timeSliceMinutes,
        currentRunId: t.currentRunId,
        lastRunAt: t.lastRunAt,
        totalRunTimeMinutes: t.totalRunTimeMinutes || 0
      }))
    };
  }

  /**
   * Get full configuration
   */
  getConfig() {
    if (!this.config) return this.getDefaultConfig();
    return { ...this.config };
  }

  /**
   * Update full configuration
   */
  async updateConfig(updates) {
    if (updates.maxConcurrentRuns !== undefined) {
      this.config.maxConcurrentRuns = Math.max(1, Math.min(5, updates.maxConcurrentRuns));
    }
    if (updates.schedulingMode !== undefined) {
      this.config.schedulingMode = updates.schedulingMode;
    }
    if (updates.defaultTimeSliceMinutes !== undefined) {
      this.config.defaultTimeSliceMinutes = Math.max(1, updates.defaultTimeSliceMinutes);
    }
    if (updates.pauseOnFailure !== undefined) {
      this.config.pauseOnFailure = updates.pauseOnFailure;
    }
    if (updates.maxFailuresBeforePause !== undefined) {
      this.config.maxFailuresBeforePause = Math.max(1, updates.maxFailuresBeforePause);
    }

    await this.saveConfig();
    this.emit('auto-run-status-change', this.getStatus());

    return this.config;
  }

  /**
   * Shutdown the scheduler
   */
  async shutdown() {
    console.log('📅 Shutting down AutoRunScheduler');
    this.clearAllTimers();
    await this.saveConfig();
  }
}
