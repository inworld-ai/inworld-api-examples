import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Import our modules
import SessionManager from './src/managers/sessionManager.js';
import { graphManager } from './src/managers/graphManager.js';
import createTTSRoutes from './src/routes/ttsRoutes.js';

// Create session manager instance
const sessionManager = new SessionManager();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));

// Setup routes
const ttsRoutes = createTTSRoutes(sessionManager);
app.use('/', ttsRoutes);

const server = app.listen(port, async () => {
  console.log(`Server running at http://localhost:${port}`);
  
  // Initialize the graph manager
  try {
    await graphManager.initialize(sessionManager);
    console.log('Graph manager initialized successfully');
  } catch (error) {
    console.error('Failed to initialize graph manager:', error);
    process.exit(1);
  }
});

// Graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully`);
  
  try {
    // Shutdown graph manager first
    await graphManager.shutdown();
    console.log('Graph manager shutdown complete');
  } catch (error) {
    console.error('Error shutting down graph manager:', error);
  }
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
