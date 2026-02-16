// server/api/wallet.js - Wallet & Portfolio API
import { Router } from 'express';
import { telegramAuth } from '../middleware/telegramAuth.js';
import { supabase } from '../../supabase/client.js';
import { getMarketData } from '../../logic/market.js';
import { CONFIG } from '../../config.js';
import { logger } from '../../utils/logger.js';

const router = Router();

/**
 * GET /api/wallet
 * Portfolio-Übersicht
 */
router.get('/', telegramAuth, async (req, res) => {
    try {
        const { data: user } = await supabase
            .from('profiles')
            .select('balance, trading_volume')
            .eq('id', req.userId)
            .single();

        const { data: cryptos } = await supabase
            .from('user_crypto')
            .select('*')
            .eq('user_id', req.userId);

        const { data: properties } = await supabase
            .from('user_assets')
            .select('*')
            .eq('user_id', req.userId);

        const marketData = await getMarketData();

        // Krypto-Werte berechnen
        let cryptoValue = 0;
        const cryptoPositions = (cryptos || []).map(c => {
            const price = marketData[c.coin_id]?.price || 0;
            const value = parseFloat(c.amount) * price;
            const cost = parseFloat(c.amount) * parseFloat(c.avg_buy_price);
            const pnl = value - cost;
            const pnlPercent = cost > 0 ? (pnl / cost) * 100 : 0;
            cryptoValue += value;

            return {
                coinId: c.coin_id,
                amount: parseFloat(c.amount),
                avgBuyPrice: parseFloat(c.avg_buy_price),
                currentPrice: price,
                value,
                pnl,
                pnlPercent,
                leverage: c.leverage,
                entryPrice: c.entry_price ? parseFloat(c.entry_price) : null,
                liquidationPrice: c.liquidation_price ? parseFloat(c.liquidation_price) : null,
                createdAt: c.created_at
            };
        });

        // Immobilien-Werte
        let propertyValue = 0;
        const propertyPositions = (properties || []).map(p => {
            const prop = CONFIG.PROPERTIES[p.asset_type];
            const value = parseFloat(p.purchase_price) * 0.8;
            propertyValue += value;

            return {
                id: p.id,
                type: p.asset_type,
                name: prop?.name || p.asset_type,
                emoji: prop?.emoji || '🏠',
                purchasePrice: parseFloat(p.purchase_price),
                sellValue: value,
                condition: p.condition,
                rent: prop?.rent || 0,
                lastRentCollection: p.last_rent_collection,
                createdAt: p.created_at
            };
        });

        const balance = parseFloat(user.balance);
        const totalWealth = balance + cryptoValue + propertyValue;

        res.json({
            balance,
            tradingVolume: parseFloat(user.trading_volume),
            cryptoValue,
            propertyValue,
            totalWealth,
            cryptos: cryptoPositions,
            properties: propertyPositions
        });
    } catch (err) {
        logger.error('Wallet Error:', err);
        res.status(500).json({ error: 'Portfolio nicht verfügbar' });
    }
});

/**
 * GET /api/wallet/transactions?limit=20
 * Transaktionsverlauf
 */
router.get('/transactions', telegramAuth, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);

        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', req.userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;

        res.json({
            transactions: (data || []).map(tx => ({
                id: tx.id,
                type: tx.type,
                amount: parseFloat(tx.amount),
                description: tx.description,
                createdAt: tx.created_at
            }))
        });
    } catch (err) {
        logger.error('Transactions Error:', err);
        res.status(500).json({ error: 'Transaktionen nicht verfügbar' });
    }
});

export default router;
