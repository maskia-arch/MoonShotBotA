// server/api/market.js - Marktdaten API
import { Router } from 'express';
import { getMarketData, getCoinPrice, getPriceHistory, getMarketUpdateStatus } from '../../logic/market.js';
import { optionalAuth } from '../middleware/telegramAuth.js';
import { logger } from '../../utils/logger.js';

const router = Router();

/**
 * GET /api/market
 * Alle Marktdaten
 */
router.get('/', optionalAuth, async (req, res) => {
    try {
        const data = await getMarketData();
        const status = getMarketUpdateStatus();

        res.json({
            coins: data,
            lastUpdate: status.lastUpdate,
            age: status.timeSinceUpdate ? Math.floor(status.timeSinceUpdate / 1000) : null
        });
    } catch (err) {
        logger.error('Market API Error:', err);
        res.status(500).json({ error: 'Marktdaten nicht verfügbar' });
    }
});

/**
 * GET /api/market/:coinId
 * Einzelner Coin
 */
router.get('/:coinId', optionalAuth, async (req, res) => {
    try {
        const coin = await getCoinPrice(req.params.coinId);

        if (!coin) {
            return res.status(404).json({ error: 'Coin nicht gefunden' });
        }

        res.json({
            coinId: req.params.coinId,
            ...coin
        });
    } catch (err) {
        logger.error('Coin API Error:', err);
        res.status(500).json({ error: 'Coin-Daten nicht verfügbar' });
    }
});

/**
 * GET /api/market/:coinId/history?hours=24
 * Preis-Historie
 */
router.get('/:coinId/history', optionalAuth, async (req, res) => {
    try {
        const hours = parseInt(req.query.hours) || 24;
        const history = await getPriceHistory(req.params.coinId, hours);

        res.json({ coinId: req.params.coinId, hours, data: history });
    } catch (err) {
        logger.error('History API Error:', err);
        res.status(500).json({ error: 'Historie nicht verfügbar' });
    }
});

export default router;
