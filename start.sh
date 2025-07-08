#!/bin/bash

# Startup script for kromosynth services

set -e

echo "🚀 Starting Kromosynth Services"

# Check if we should use development or production compose
if [ "$1" = "dev" ] || [ "$1" = "development" ]; then
    echo "📝 Starting in development mode (using local repositories)"
    
    # Check if local repositories exist
    if [ ! -d "../kromosynth-evoruns" ]; then
        echo "❌ Error: ../kromosynth-evoruns not found"
        echo "Please clone: git clone https://github.com/synth-is/kromosynth-evoruns.git ../kromosynth-evoruns"
        exit 1
    fi
    
    if [ ! -d "../kromosynth-render" ]; then
        echo "❌ Error: ../kromosynth-render not found"
        echo "Please clone: git clone https://github.com/synth-is/kromosynth-render.git ../kromosynth-render"
        exit 1
    fi
    
    echo "✅ Local repositories found"
    echo "🔧 Using docker-compose.dev.yml"
    docker compose -f docker-compose.dev.yml up --build "${@:2}"
    
elif [ "$1" = "prod" ] || [ "$1" = "production" ]; then
    echo "🏭 Starting in production mode (using GitHub repositories)"
    echo "🔧 Using docker-compose.yml"
    docker compose up --build "${@:2}"
    
else
    echo "📋 Usage: $0 [dev|prod] [docker-compose-options]"
    echo ""
    echo "Examples:"
    echo "  $0 dev              # Development mode with local repos"
    echo "  $0 dev -d           # Development mode, detached"
    echo "  $0 prod             # Production mode from GitHub"
    echo "  $0 prod -d          # Production mode, detached"
    echo ""
    echo "📁 For development mode, ensure these repositories are cloned:"
    echo "  ../kromosynth-evoruns"
    echo "  ../kromosynth-render"
    exit 1
fi
