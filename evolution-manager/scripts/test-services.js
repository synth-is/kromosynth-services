import { PortManager } from '../src/core/port-manager.js';
import { ServiceDependencyManager } from '../src/core/service-dependency-manager.js';
import { ConfigManager } from '../src/config/config-manager.js';
import path from 'path';
import { ulid } from 'ulid';

/**
 * Test script for the service dependency management system
 * Tests port allocation, ecosystem loading, and service management without starting actual services
 */


class ServiceTester {
  constructor() {
    this.portManager = new PortManager();
    this.serviceDependencyManager = new ServiceDependencyManager();
    this.configManager = new ConfigManager();
    this.testResults = [];
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = {
      'info': 'ℹ️',
      'success': '✅',
      'error': '❌',
      'warning': '⚠️',
      'test': '🧪'
    }[type] || 'ℹ️';

    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  addTestResult(testName, passed, message = '') {
    this.testResults.push({ testName, passed, message });
    this.log(`${testName}: ${passed ? 'PASSED' : 'FAILED'}${message ? ' - ' + message : ''}`, passed ? 'success' : 'error');
  }

  async runTests() {
    this.log('🧪 Starting service dependency system tests...', 'test');

    try {
      await this.testPortManager();
      await this.testConfigManager();
      await this.testServiceDependencyManager();
      await this.testIntegration();

      this.printSummary();

    } catch (error) {
      this.log(`Test suite failed: ${error.message}`, 'error');
      process.exit(1);
    }
  }

  async testPortManager() {
    this.log('Testing Port Manager...', 'test');

    // Test 1: Basic port allocation
    const runId1 = ulid();
    const allocation1 = this.portManager.allocatePortRange(runId1);
    const hasAllServices = ['geneVariation', 'geneRendering', 'evaluationFeatures', 'evaluationQuality', 'evaluationProjection']
      .every(service => allocation1.services[service] && allocation1.services[service].length > 0);

    this.addTestResult('Port Allocation - Basic', hasAllServices, `Range: ${allocation1.rangeStart}-${allocation1.rangeEnd}`);

    // Test 2: Unique port ranges
    const runId2 = ulid();
    const allocation2 = this.portManager.allocatePortRange(runId2);
    const noOverlap = allocation1.rangeEnd < allocation2.rangeStart || allocation2.rangeEnd < allocation1.rangeStart;

    this.addTestResult('Port Allocation - No Overlap', noOverlap, `Range1: ${allocation1.rangeStart}-${allocation1.rangeEnd}, Range2: ${allocation2.rangeStart}-${allocation2.rangeEnd}`);

    // Test 3: Service URL generation
    const urls = this.portManager.generateServiceUrls(runId1);
    const hasCorrectUrls = urls.geneVariationServers.length === 3 &&
                          urls.geneVariationServers[0].includes('127.0.0.1') &&
                          urls.evaluationProjectionServers.length === 1;

    this.addTestResult('Service URL Generation', hasCorrectUrls, `Generated ${Object.values(urls).flat().length} URLs`);

    // Test 4: Port release
    const released = this.portManager.releasePortRange(runId1);
    this.addTestResult('Port Release', released, 'Ports released successfully');

    // Test 5: Re-allocation after release
    const runId3 = ulid();
    const allocation3 = this.portManager.allocatePortRange(runId3);
    const canReuse = allocation3.rangeStart === allocation1.rangeStart; // Should reuse the released range

    this.addTestResult('Port Reallocation', canReuse, `Reused range: ${allocation3.rangeStart}-${allocation3.rangeEnd}`);

    // Cleanup
    this.portManager.releasePortRange(runId2);
    this.portManager.releasePortRange(runId3);
  }

  async testConfigManager() {
    this.log('Testing Config Manager...', 'test');

    // Test 1: List templates
    const templates = await this.configManager.listTemplates();
    const hasTemplates = templates.length > 0;

    this.addTestResult('Template Discovery', hasTemplates, `Found ${templates.length} templates`);

    if (templates.length > 0) {
      // Test 2: Load template info with ecosystems
      const templateName = templates[0].templateName;
      const templateInfo = await this.configManager.getTemplateInfo(templateName);
      const hasEcosystemInfo = templateInfo.hasOwnProperty('ecosystemConfigs');

      this.addTestResult('Template Info with Ecosystems', hasEcosystemInfo,
        `Template: ${templateName}, Ecosystems: ${templateInfo.ecosystemConfigs?.length || 0}`);

      // Test 3: Load template configuration
      try {
        const config = await this.configManager.loadTemplate(templateName);
        const hasConfig = config && config.evolutionRunConfig && config.hyperparameters;

        this.addTestResult('Template Loading', hasConfig, `Loaded config for ${templateName}`);

      } catch (error) {
        this.addTestResult('Template Loading', false, `Failed to load ${templateName}: ${error.message}`);
      }
    }
  }

  async testServiceDependencyManager() {
    this.log('Testing Service Dependency Manager...', 'test');

    // Test 1: Ecosystem template discovery
    const templates = await this.configManager.listTemplates();
    if (templates.length > 0) {
      const templateName = templates[0].templateName;

      // Test default ecosystem
      try {
        const ecosystem = await this.serviceDependencyManager.loadEcosystemTemplate(templateName, 'default');
        const hasEcosystem = ecosystem && ecosystem.config && ecosystem.config.apps;

        this.addTestResult('Ecosystem Loading - Default', hasEcosystem,
          `Found ${ecosystem?.config?.apps?.length || 0} services`);

        if (hasEcosystem) {
          // Test 2: Service name mapping
          const firstApp = ecosystem.config.apps[0];
          const serviceType = this.serviceDependencyManager.mapAppToServiceType(firstApp.name);
          const hasMapping = serviceType !== null;

          this.addTestResult('Service Name Mapping', hasMapping,
            `${firstApp.name} → ${serviceType || 'unmapped'}`);

          // Test 3: Ecosystem config generation
          const runId = ulid();
          const portAllocation = this.portManager.allocatePortRange(runId);
          const runConfig = this.serviceDependencyManager.generateRunEcosystemConfig(
            runId, ecosystem, portAllocation
          );

          const hasRunConfig = runConfig.apps.length > 0 &&
                              runConfig.apps[0].name.includes(runId);

          this.addTestResult('Run Config Generation', hasRunConfig,
            `Generated config with ${runConfig.apps.length} services`);

          // Cleanup
          this.portManager.releasePortRange(runId);
        }

      } catch (error) {
        this.addTestResult('Ecosystem Loading - Default', false, error.message);
      }

      // Test 3D ecosystem if available
      try {
        const ecosystem3d = await this.serviceDependencyManager.loadEcosystemTemplate(templateName, '3d');
        const has3dEcosystem = ecosystem3d && ecosystem3d.config;

        this.addTestResult('Ecosystem Loading - 3D Variant', has3dEcosystem,
          has3dEcosystem ? `Found 3D variant with ${ecosystem3d.config.apps.length} services` : 'No 3D variant found');

      } catch (error) {
        this.addTestResult('Ecosystem Loading - 3D Variant', false, error.message);
      }
    }
  }

  async testIntegration() {
    this.log('Testing Integration...', 'test');

    const templates = await this.configManager.listTemplates();
    if (templates.length > 0) {
      const templateName = templates[0].templateName;

      // Test 1: Port allocation + ecosystem loading integration
      const runId = ulid();
      const portAllocation = this.portManager.allocatePortRange(runId);

      try {
        const ecosystem = await this.serviceDependencyManager.loadEcosystemTemplate(templateName, 'default');

        if (ecosystem) {
          const serviceUrls = this.portManager.generateServiceUrls(runId);
          const config = await this.configManager.loadTemplate(templateName);

          if (config && config.evolutionRunConfig) {
            const updatedConfig = this.serviceDependencyManager.updateEvolutionConfigWithServices(
              config.evolutionRunConfig,
              { serviceUrls }
            );

            const hasServiceEndpoints = updatedConfig.geneVariationServers &&
                                       updatedConfig.geneVariationServers.length > 0;

            this.addTestResult('Full Integration Test', hasServiceEndpoints,
              `Updated config with ${Object.values(serviceUrls).flat().length} service endpoints`);
          }
        }

      } catch (error) {
        this.addTestResult('Full Integration Test', false, error.message);
      }

      // Cleanup
      this.portManager.releasePortRange(runId);
    } else {
      this.addTestResult('Full Integration Test', false, 'No templates available for testing');
    }
  }

  printSummary() {
    this.log('\n📊 Test Summary:', 'test');

    const passed = this.testResults.filter(r => r.passed).length;
    const failed = this.testResults.filter(r => r.passed === false).length;
    const total = this.testResults.length;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📊 Total:  ${total}`);
    console.log(`💯 Rate:   ${Math.round((passed / total) * 100)}%`);
    console.log(`${'='.repeat(60)}\n`);

    if (failed > 0) {
      this.log('❌ Failed Tests:', 'error');
      this.testResults
        .filter(r => !r.passed)
        .forEach(r => {
          console.log(`  • ${r.testName}: ${r.message}`);
        });
      console.log('');
    }

    this.log(`🎯 Service dependency system ${failed === 0 ? 'FULLY FUNCTIONAL' : 'HAS ISSUES'}`,
             failed === 0 ? 'success' : 'warning');

    if (failed > 0) {
      process.exit(1);
    }
  }
}

// Run tests
const tester = new ServiceTester();
tester.runTests().catch(error => {
  console.error('❌ Test suite crashed:', error);
  process.exit(1);
});