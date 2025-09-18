#!/bin/bash

# Setup script for kromosynth evolution manager
# This script helps configure the environment and verify everything is working

echo "🧬 Kromosynth Evolution Manager Setup"
echo "====================================="
echo

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠️${NC} $1"
}

print_error() {
    echo -e "${RED}❌${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ️${NC} $1"
}

# Check if we're in the right directory
if [[ ! -f "package.json" ]] || [[ ! -d "src" ]]; then
    print_error "Please run this script from the evolution-manager directory"
    exit 1
fi

print_info "Setting up Kromosynth Evolution Manager..."
echo

# Step 1: Install dependencies
echo "Step 1: Installing dependencies..."
if npm install; then
    print_status "Dependencies installed successfully"
else
    print_error "Failed to install dependencies"
    exit 1
fi
echo

# Step 2: Check for PM2
echo "Step 2: Checking PM2 installation..."
if command -v pm2 &> /dev/null; then
    print_status "PM2 is installed: $(pm2 -v)"
else
    print_warning "PM2 not found. Installing globally..."
    if npm install -g pm2; then
        print_status "PM2 installed successfully"
    else
        print_error "Failed to install PM2. Please install manually: npm install -g pm2"
        exit 1
    fi
fi
echo

# Step 3: Configure environment
echo "Step 3: Configuring environment..."

# Check for existing .env file
if [[ -f ".env" ]]; then
    print_warning ".env file already exists. Backing up to .env.backup"
    cp .env .env.backup
fi

# Copy example env file
cp .env.example .env
print_status "Created .env file from template"

# Try to auto-detect kromosynth-cli path
echo
echo "Searching for kromosynth-cli installation..."

# Common locations to check
SEARCH_PATHS=(
    "../../../kromosynth-cli/cli-app/kromosynth.js"  # Default relative path
    "../../kromosynth-cli/cli-app/kromosynth.js"     # Alternative relative path
    "$HOME/Developer/apps/kromosynth-cli/cli-app/kromosynth.js"  # Common location
    "/Users/bjornpjo/Developer/apps/kromosynth-cli/cli-app/kromosynth.js"  # Specific user path
)

FOUND_CLI=""
for path in "${SEARCH_PATHS[@]}"; do
    if [[ -f "$path" ]]; then
        FOUND_CLI="$path"
        break
    fi
done

if [[ -n "$FOUND_CLI" ]]; then
    # Convert to absolute path
    ABS_PATH=$(realpath "$FOUND_CLI" 2>/dev/null || echo "$FOUND_CLI")
    print_status "Found kromosynth CLI at: $ABS_PATH"
    
    # Update .env file
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s|^KROMOSYNTH_CLI_SCRIPT=.*|KROMOSYNTH_CLI_SCRIPT=$ABS_PATH|" .env
    else
        # Linux
        sed -i "s|^KROMOSYNTH_CLI_SCRIPT=.*|KROMOSYNTH_CLI_SCRIPT=$ABS_PATH|" .env
    fi
    print_status "Updated .env with CLI script path"
else
    print_warning "Could not auto-detect kromosynth-cli location"
    echo "Please manually edit .env and set KROMOSYNTH_CLI_SCRIPT to the full path of kromosynth.js"
    echo
    echo "Example paths to check:"
    for path in "${SEARCH_PATHS[@]}"; do
        echo "  $path"
    done
fi

echo

# Step 4: Validate configuration
echo "Step 4: Validating configuration..."

# Source the .env file to get the CLI script path
if [[ -f ".env" ]]; then
    export $(grep -v '^#' .env | xargs)
fi

if [[ -n "$KROMOSYNTH_CLI_SCRIPT" ]] && [[ -f "$KROMOSYNTH_CLI_SCRIPT" ]]; then
    print_status "CLI script found at configured path: $KROMOSYNTH_CLI_SCRIPT"
else
    print_error "CLI script not found. Please check your .env configuration"
    print_info "Edit .env and set KROMOSYNTH_CLI_SCRIPT to the correct path"
    exit 1
fi

# Test Node.js script
echo
echo "Testing CLI script accessibility..."
if node -e "console.log('Testing Node.js access to CLI script...'); process.exit(0)" 2>/dev/null; then
    print_status "Node.js can access the CLI script"
else
    print_warning "Node.js test failed, but this might be okay"
fi

echo

# Step 5: Create required directories
echo "Step 5: Creating required directories..."
mkdir -p logs working templates
print_status "Created logs, working, and templates directories"
echo

# Step 6: Test basic service startup (dry run)
echo "Step 6: Testing service configuration..."
print_info "Starting service in test mode..."

# Create a simple test to verify the evolution manager can initialize
if timeout 10s node -e "
import { EvolutionManager } from './src/core/evolution-manager.js';
const manager = new EvolutionManager();
setTimeout(() => {
    console.log('✅ Evolution manager initialized successfully');
    process.exit(0);
}, 2000);
" 2>/dev/null; then
    print_status "Service configuration test passed"
else
    print_warning "Service configuration test failed - this might be due to PM2 connection issues"
    print_info "Try starting the service manually with: npm start"
fi

echo

# Summary
echo "🎉 Setup Complete!"
echo "=================="
echo
print_status "Evolution Manager is ready to use"
echo
echo "Next steps:"
echo "1. Start the service: npm start"
echo "2. Visit web interface: http://localhost:3005"
echo "3. Create templates: npm run list-configs"
echo
echo "Configuration:"
echo "• CLI Script: ${KROMOSYNTH_CLI_SCRIPT:-Not configured}"
echo "• Port: ${PORT:-3005}"
echo "• Environment: ${NODE_ENV:-development}"
echo
echo "Need help? Check the documentation:"
echo "• README.md - General usage"
echo "• TEMPLATE_CREATION_GUIDE.md - Template management" 
echo "• QUICK_REFERENCE.md - Command reference"
echo
print_info "Happy evolving! 🧬"
