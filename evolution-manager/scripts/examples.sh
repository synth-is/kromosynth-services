#!/bin/bash

# Example usage script for creating templates from CLI configurations
# This demonstrates the complete workflow from discovery to template creation

echo "🧬 Kromosynth Template Creation Examples"
echo "======================================="
echo

# Step 1: Discover available configurations
echo "Step 1: Discover Available Configurations"
echo "=========================================="
echo "First, let's see what configurations are available to import:"
echo
echo "Command:"
echo "  npm run list-configs"
echo
echo "This will show all evolution-runs configs with their evo runs and import commands."
echo
echo "─────────────────────────────────────────────────────────────────────────────────"
echo

# Step 2: Import specific configuration
echo "Step 2: Import Configuration as Template"
echo "======================================="
echo
echo "Example 1: Import KuzuDB integration test config"
echo "Command:"
echo "  npm run create-template \\"
echo "    /Users/bjornpjo/Developer/apps/kromosynth-cli/cli-app/conf/evolution-runs_single-map_kuzudb-integration-test.jsonc \\"
echo "    kuzudb-integration-test"
echo
echo "Example 2: Auto-generate template name from config label"
echo "Command:"
echo "  npm run create-template \\"
echo "    /Users/bjornpjo/Developer/apps/kromosynth-cli/cli-app/conf/evolution-runs_single-map_kuzudb-integration-test.jsonc"
echo
echo "Example 3: Import specific evo run by index (for configs with multiple runs)"
echo "Command:"
echo "  npm run create-template \\"
echo "    /path/to/multi-run-config.jsonc \\"
echo "    my-template-name \\"
echo "    1  # Use evoRun at index 1"
echo
echo "─────────────────────────────────────────────────────────────────────────────────"
echo

# Step 3: Using the template
echo "Step 3: Use the Created Template"
echo "================================="
echo
echo "After creating a template, you can:"
echo
echo "1. View template files:"
echo "   ls -la ./templates/[template-name]/"
echo
echo "2. Start evolution run via REST API:"
echo "   curl -X POST http://localhost:3005/api/runs \\"
echo "     -H \"Content-Type: application/json\" \\"
echo "     -d '{\"templateName\": \"[template-name]\"}'"
echo
echo "3. Use the web interface:"
echo "   Open http://localhost:3005 and select your template"
echo
echo "4. Monitor progress via WebSocket or web interface"
echo
echo "─────────────────────────────────────────────────────────────────────────────────"
echo

# Additional tips
echo "Additional Tips"
echo "==============="
echo
echo "• View all available templates: curl http://localhost:3005/api/templates"
echo "• Check template contents: cat ./templates/[name]/template-info.jsonc"
echo "• Monitor runs: curl http://localhost:3005/api/runs"
echo "• Stop a run: curl -X DELETE http://localhost:3005/api/runs/[run-id]"
echo
echo "For detailed documentation, see:"
echo "• README.md - General service documentation"
echo "• TEMPLATE_CREATION_GUIDE.md - Complete template creation guide"
echo

# Uncomment lines below to actually run examples:
echo "To run the examples above, uncomment the lines at the bottom of this script."
echo

# Example 1: List available configs
# echo "Running: npm run list-configs"
# npm run list-configs

# Example 2: Create template from KuzuDB config
# echo "Running: npm run create-template with KuzuDB config"
# npm run create-template /Users/bjornpjo/Developer/apps/kromosynth-cli/cli-app/conf/evolution-runs_single-map_kuzudb-integration-test.jsonc kuzudb-integration-test
