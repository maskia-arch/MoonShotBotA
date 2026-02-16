// server/api/immo.js - Immobilien API
import { Router } from 'express';
import { telegramAuth } from '../middleware/telegramAuth.js';
import { supabase } from '../../supabase/client.js';
import { logTransaction, checkAndAwardAchievement } from '../../supabase/queries.js';
import { CONFIG } from '../../config.js';
import { logger } from '../../utils/logger.js';

const router = Router();

/**
 * GET /api/immo
 * Immobilien-Markt anzeigen
 */
router.get('/', telegramAuth, async (req, res) => {
    try {
        const { data: user } = await supabase
            .from('profiles')
            .select('balance, trading_volume')
            .eq('id', req.userId)
            .single();

        const { data: owned } = await supabase
            .from('user_assets')
            .select('*')
            .eq('user_id', req.userId);

        const ownedTypes = (owned || []).map(o => o.asset_type);

        const properties = Object.entries(CONFIG.PROPERTIES).map(([id, prop]) => ({
            id,
            ...prop,
            owned: ownedTypes.includes(id),
            ownedAsset: (owned || []).find(o => o.asset_type === id) || null
        }));

        res.json({
            balance: parseFloat(user.balance),
            tradingVolume: parseFloat(user.trading_volume),
            minVolume: CONFIG.MIN_VOL_FOR_REALESTATE,
            unlocked: parseFloat(user.trading_volume) >= CONFIG.MIN_VOL_FOR_REALESTATE,
            properties
        });
    } catch (err) {
        logger.error('Immo Market Error:', err);
        res.status(500).json({ error: 'Immobilien-Markt nicht verfügbar' });
    }
});

/**
 * POST /api/immo/buy
 * Body: { propertyType }
 */
router.post('/buy', telegramAuth, async (req, res) => {
    const { propertyType } = req.body;
    const property = CONFIG.PROPERTIES[propertyType];

    if (!property) return res.status(400).json({ error: 'Immobilie nicht gefunden' });

    try {
        const { data: user } = await supabase
            .from('profiles').select('balance, trading_volume').eq('id', req.userId).single();

        if (parseFloat(user.trading_volume) < CONFIG.MIN_VOL_FOR_REALESTATE) {
            return res.status(400).json({ error: 'Handelsvolumen zu niedrig' });
        }
        if (parseFloat(user.balance) < property.price) {
            return res.status(400).json({ error: 'Guthaben zu niedrig' });
        }

        const { data: existing } = await supabase
            .from('user_assets').select('id').eq('user_id', req.userId).eq('asset_type', propertyType).maybeSingle();

        if (existing) return res.status(400).json({ error: 'Bereits im Besitz' });

        await supabase.rpc('increment_balance', { user_id: req.userId, amount: -property.price });

        await supabase.from('user_assets').insert({
            user_id: req.userId, asset_type: propertyType,
            purchase_price: property.price, condition: 100,
            last_rent_collection: new Date().toISOString()
        });

        await logTransaction(req.userId, 'buy_property', -property.price, `Kauf: ${property.name}`);

        const { count } = await supabase.from('user_assets').select('*', { count: 'exact', head: true }).eq('user_id', req.userId);
        if (count >= 5) await checkAndAwardAchievement(req.userId, 'property_mogul');

        const { data: allOwned } = await supabase.from('user_assets').select('asset_type').eq('user_id', req.userId);
        if (allOwned && allOwned.length >= Object.keys(CONFIG.PROPERTIES).length) {
            await checkAndAwardAchievement(req.userId, 'portfolio_king');
        }

        res.json({ success: true, property: propertyType, price: property.price });
    } catch (err) {
        logger.error('Buy Property Error:', err);
        res.status(500).json({ error: 'Kauf fehlgeschlagen' });
    }
});

/**
 * POST /api/immo/sell
 * Body: { assetId }
 */
router.post('/sell', telegramAuth, async (req, res) => {
    try {
        const { data: asset } = await supabase
            .from('user_assets').select('*').eq('id', req.body.assetId).eq('user_id', req.userId).single();

        if (!asset) return res.status(404).json({ error: 'Immobilie nicht gefunden' });

        const property = CONFIG.PROPERTIES[asset.asset_type];
        const sellPrice = parseFloat(asset.purchase_price) * 0.8;

        await supabase.rpc('increment_balance', { user_id: req.userId, amount: sellPrice });
        await supabase.from('user_assets').delete().eq('id', req.body.assetId);
        await logTransaction(req.userId, 'sell_property', sellPrice, `Verkauf: ${property.name}`);

        res.json({ success: true, sellPrice });
    } catch (err) {
        logger.error('Sell Property Error:', err);
        res.status(500).json({ error: 'Verkauf fehlgeschlagen' });
    }
});

/**
 * POST /api/immo/repair
 * Body: { assetId }
 */
router.post('/repair', telegramAuth, async (req, res) => {
    try {
        const { data: asset } = await supabase
            .from('user_assets').select('*').eq('id', req.body.assetId).eq('user_id', req.userId).single();

        if (!asset) return res.status(404).json({ error: 'Immobilie nicht gefunden' });

        const property = CONFIG.PROPERTIES[asset.asset_type];
        const cost = property.maintenanceCost * 3;

        const { data: user } = await supabase.from('profiles').select('balance').eq('id', req.userId).single();

        if (parseFloat(user.balance) < cost) {
            return res.status(400).json({ error: 'Guthaben zu niedrig', cost });
        }

        await supabase.rpc('increment_balance', { user_id: req.userId, amount: -cost });
        await supabase.from('user_assets').update({ condition: 100 }).eq('id', req.body.assetId);
        await logTransaction(req.userId, 'property_repair', -cost, `Reparatur: ${property.name}`);

        res.json({ success: true, cost, newCondition: 100 });
    } catch (err) {
        logger.error('Repair Error:', err);
        res.status(500).json({ error: 'Reparatur fehlgeschlagen' });
    }
});

export default router;
