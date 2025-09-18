import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { EvolutionManager } from './core/evolution-manager.js';
import { setupApiRoutes } from './api/routes.js';
import { setupWebSocket } from './websocket/socket-handler.js';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Initialize evolution manager
const evolutionManager = new EvolutionManager();

// Setup routes and websocket
setupApiRoutes(app, evolutionManager, io);
setupWebSocket(io, evolutionManager);

const PORT = process.env.PORT || 3005;

server.listen(PORT, () => {
  console.log(`🧬 Kromosynth Evolution Manager running on port ${PORT}`);
  console.log(`📊 WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`🔗 REST API: http://localhost:${PORT}/api`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down evolution manager...');
  await evolutionManager.shutdown();
  server.close(() => {
    console.log('👋 Evolution manager stopped');
    process.exit(0);
  });
});
