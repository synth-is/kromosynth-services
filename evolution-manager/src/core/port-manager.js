/**
 * Port allocation manager for ensuring unique port ranges across concurrent runs
 */
export class PortManager {
  constructor() {
    this.allocatedRanges = new Map(); // runId -> allocated ports
    this.usedPorts = new Set();
    
    // Base port ranges for different services
    this.servicePortBases = {
      geneVariation: 50000,      // 50051, 50052, 50053, etc.
      geneRendering: 60000,      // 60051, 60052, 60053, etc.
      evaluationFeatures: 61000, // 61051, 61052, 61053, etc.
      evaluationQuality: 32000,  // 32051, 32052, 32053, etc.
      evaluationProjection: 33000, // 33051, etc.
    };
    
    // Number of instances per service type
    this.serviceInstances = {
      geneVariation: 3,
      geneRendering: 3, 
      evaluationFeatures: 3,
      evaluationQuality: 3,
      evaluationProjection: 1,
    };
    
    // Port range size per run (enough space for all services)
    this.portRangeSize = 1000; // Each run gets 1000 ports
  }

  /**
   * Allocate a unique port range for a run
   * @param {string} runId - Unique run identifier
   * @returns {Object} Allocated port configuration
   */
  allocatePortRange(runId) {
    if (this.allocatedRanges.has(runId)) {
      return this.allocatedRanges.get(runId);
    }

    // Find the next available range
    let rangeStart = this.findAvailableRange();
    
    const allocation = {
      runId,
      rangeStart,
      rangeEnd: rangeStart + this.portRangeSize - 1,
      services: this.generateServicePorts(rangeStart),
      allocatedAt: new Date().toISOString()
    };

    // Mark ports as used
    for (let port = rangeStart; port <= allocation.rangeEnd; port++) {
      this.usedPorts.add(port);
    }

    this.allocatedRanges.set(runId, allocation);
    
    console.log(`🔌 Allocated port range ${rangeStart}-${allocation.rangeEnd} for run ${runId}`);
    return allocation;
  }

  /**
   * Generate specific service port mappings within a range
   */
  generateServicePorts(rangeStart) {
    const services = {};
    let currentOffset = 51; // Start at x051 within the range
    
    for (const [serviceName, instanceCount] of Object.entries(this.serviceInstances)) {
      services[serviceName] = [];
      for (let i = 0; i < instanceCount; i++) {
        services[serviceName].push(rangeStart + currentOffset + i);
      }
      currentOffset += 10; // Space services by 10 ports
    }
    
    return services;
  }

  /**
   * Find the next available port range
   */
  findAvailableRange() {
    let candidate = 50000; // Start from base
    
    while (this.isRangeInUse(candidate, candidate + this.portRangeSize - 1)) {
      candidate += this.portRangeSize;
      
      // Safety check to avoid infinite loop
      if (candidate > 65000) {
        throw new Error('Unable to allocate port range - too many concurrent runs');
      }
    }
    
    return candidate;
  }

  /**
   * Check if a port range conflicts with existing allocations
   */
  isRangeInUse(start, end) {
    for (let port = start; port <= end; port++) {
      if (this.usedPorts.has(port)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Release ports allocated to a run
   * @param {string} runId - Run identifier to deallocate
   */
  releasePortRange(runId) {
    const allocation = this.allocatedRanges.get(runId);
    if (!allocation) {
      return false;
    }

    // Remove ports from used set
    for (let port = allocation.rangeStart; port <= allocation.rangeEnd; port++) {
      this.usedPorts.delete(port);
    }

    this.allocatedRanges.delete(runId);
    console.log(`🔌 Released port range ${allocation.rangeStart}-${allocation.rangeEnd} for run ${runId}`);
    return true;
  }

  /**
   * Get allocation info for a run
   */
  getPortAllocation(runId) {
    return this.allocatedRanges.get(runId);
  }

  /**
   * Get all current allocations
   */
  getAllAllocations() {
    return Array.from(this.allocatedRanges.values());
  }

  /**
   * Generate WebSocket URLs for services
   */
  generateServiceUrls(runId) {
    const allocation = this.allocatedRanges.get(runId);
    if (!allocation) {
      throw new Error(`No port allocation found for run ${runId}`);
    }

    return {
      geneVariationServers: allocation.services.geneVariation.map(port => `ws://127.0.0.1:${port}`),
      geneRenderingServers: allocation.services.geneRendering.map(port => `ws://127.0.0.1:${port}`),
      geneEvaluationServers: [], // Empty as shown in config
      evaluationFeatureServers: allocation.services.evaluationFeatures.map(port => `ws://127.0.0.1:${port}`),
      evaluationQualityServers: allocation.services.evaluationQuality.map(port => `ws://127.0.0.1:${port}`),
      evaluationProjectionServers: allocation.services.evaluationProjection.map(port => `ws://127.0.0.1:${port}`)
    };
  }
}
