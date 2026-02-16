// server/index.js - V1.0.0 - ValueTycoon API Server
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from '../config.js';
import { logger } from '../utils/logger.js';

// API Routes
import authRoutes from './api/auth.js';
import marketRoutes from './api/market.js';
import tradeRoutes from './api/trade.js';
import walletRoutes from './api/wallet.js';
import immoRoutes from './api/immo.js';
import rankRoutes from './api/rank.js';
import achievementRoutes from './api/achievements.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Request-Logging
app.use((req, res, next) => {
    logger.debug(`${req.method} ${req.url}`);
    next();
});

// Static Files: Web App
app.use(express.static(path.join(__dirname, '../webapp')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/trade', tradeRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/immo', immoRoutes);
app.use('/api/rank', rankRoutes);
app.use('/api/achievements', achievementRoutes);

// Health-Check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        version: CONFIG.VERSION,
        uptime: process.uptime()
    });
});

// SPA Fallback - alle unbekannten Routes → index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../webapp/index.html'));
});

// Error Handler
app.use((err, req, res, next) => {
    logger.error('API Error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
});

// Start
const PORT = CONFIG.API_PORT || 3001;
app.listen(PORT, () => {
    logger.info(`🌐 ValueTycoon API Server auf Port ${PORT}`);
    logger.info(`📁 Web App: http://localhost:${PORT}/`);
});

export default app;
