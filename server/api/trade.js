// server/api/trade.js - Trading API
import { Router } from 'express';
import { telegramAuth } from '../middleware/telegramAuth.js';
import { getMarketData, getCoinPrice } from '../../logic/market.js';
import { calculateTrade, getTradeCalculations, isTradeEligibleForVolume } from '../../logic/tradeLogic.js';
import { logTransaction, checkAndAwardAchievement } from '../../supabase/queries.js';
import { supabase } from '../../supabase/client.js';
import { CONFIG } from '../../config.js';
import { logger } from '../../utils/logger.js';

const router = Router();

/**
 * GET /api/trade/info/:coinId
 * Trade-Infos für einen Coin (Limits, Gebühren etc.)
 */
router.get('/info/:coinId', telegramAuth, async (req, res) => {
    try {
        const { coinId } = req.params;
        const coin = await getCoinPrice(coinId);

        if (!coin) return res.status(404).json({ error: 'Coin nicht gefunden' });

        const { data: user } = await supabase
            .from('profiles')
            .select('balance')
            .eq('id', req.userId)
            .single();

        const { data: asset } = await supabase
            .from('user_crypto')
            .select('amount')
            .eq('user_id', req.userId)
            .eq('coin_id', coinId.toLowerCase())
            .maybeSingle();

        const holdings = asset ? parseFloat(asset.amount) : 0;
        const calc = getTradeCalculations(parseFloat(user.balance), coin.price, holdings);

        res.json({
            coinId,
            price: coin.price,
            change24h: coin.change24h,
            balance: parseFloat(user.balance),
            holdings,
            maxBuy: calc.maxBuy,
            maxSell: calc.maxSell,
            feePercent: calc.feePercent,
            leverageOptions: CONFIG.LEVERAGE.AVAILABLE
        });
    } catch (err) {
        logger.error('Trade Info Error:', err);
        res.status(500).json({ error: 'Trade-Info nicht verfügbar' });
    }
});

/**
 * POST /api/trade/buy
 * Body: { coinId, amount }
 */
router.post('/buy', telegramAuth, async (req, res) => {
    const { coinId, amount: cryptoAmount } = req.body;

    if (!coinId || !cryptoAmount || cryptoAmount <= 0) {
        return res.status(400).json({ error: 'Ungültige Parameter' });
    }

    try {
        const coin = await getCoinPrice(coinId);
        if (!coin) return res.status(404).json({ error: 'Coin nicht gefunden' });

        const { totalCost, fee, subtotal } = calculateTrade(cryptoAmount, coin.price);

        const { data: user } = await supabase
            .from('profiles')
            .select('balance')
            .eq('id', req.userId)
            .single();

        if (parseFloat(user.balance) < totalCost) {
            return res.status(400).json({
                error: 'Guthaben zu niedrig',
                required: totalCost,
                available: parseFloat(user.balance)
            });
        }

        // RPC: Geld abziehen
        const { error: rpcError } = await supabase.rpc('execute_trade_buy', {
            p_user_id: req.userId,
            p_total_cost: totalCost,
            p_fee: fee
        });
        if (rpcError) throw rpcError;

        // Asset aktualisieren
        const { data: currentAsset } = await supabase
            .from('user_crypto')
            .select('amount, avg_buy_price')
            .eq('user_id', req.userId)
            .eq('coin_id', coinId.toLowerCase())
            .maybeSingle();

        const oldAmount = currentAsset ? parseFloat(currentAsset.amount) : 0;
        const newAmount = oldAmount + cryptoAmount;
        const newAvgPrice = currentAsset
            ? ((oldAmount * parseFloat(currentAsset.avg_buy_price)) + (cryptoAmount * coin.price)) / newAmount
            : coin.price;

        await supabase.from('user_crypto').upsert({
            user_id: req.userId,
            coin_id: coinId.toLowerCase(),
            amount: newAmount,
            avg_buy_price: newAvgPrice,
            leverage: 1,
            created_at: new Date().toISOString()
        }, { onConflict: 'user_id,coin_id' });

        await logTransaction(req.userId, 'buy_crypto', totalCost, `Kauf ${cryptoAmount} ${coinId.toUpperCase()}`);
        await checkAndAwardAchievement(req.userId, 'first_trade');

        res.json({
            success: true,
            trade: {
                type: 'buy',
                coinId,
                amount: cryptoAmount,
                subtotal,
                fee,
                totalCost,
                newBalance: parseFloat(user.balance) - totalCost
            }
        });
    } catch (err) {
        logger.error('Buy Error:', err);
        res.status(500).json({ error: 'Kauf fehlgeschlagen' });
    }
});

/**
 * POST /api/trade/sell
 * Body: { coinId, amount }
 */
router.post('/sell', telegramAuth, async (req, res) => {
    const { coinId, amount: cryptoAmount } = req.body;

    if (!coinId || !cryptoAmount || cryptoAmount <= 0) {
        return res.status(400).json({ error: 'Ungültige Parameter' });
    }

    try {
        const coin = await getCoinPrice(coinId);

        const { data: asset } = await supabase
            .from('user_crypto')
            .select('*')
            .eq('user_id', req.userId)
            .eq('coin_id', coinId.toLowerCase())
            .maybeSingle();

        if (!asset || parseFloat(asset.amount) < cryptoAmount) {
            return res.status(400).json({
                error: 'Bestand zu niedrig',
                available: asset ? parseFloat(asset.amount) : 0
            });
        }

        const isEligible = isTradeEligibleForVolume(asset.created_at);
        const { payout, fee, subtotal } = calculateTrade(cryptoAmount, coin.price);
        const tradeVolumeEuro = cryptoAmount * coin.price;

        const { error: rpcError } = await supabase.rpc('execute_trade_sell', {
            p_user_id: req.userId,
            p_payout: payout,
            p_fee: fee,
            p_volume: isEligible ? tradeVolumeEuro : 0
        });
        if (rpcError) throw rpcError;

        const newAmount = parseFloat(asset.amount) - cryptoAmount;

        if (newAmount <= 0.00000001) {
            await supabase.from('user_crypto').delete().eq('id', asset.id);
        } else {
            await supabase.from('user_crypto').update({ amount: newAmount }).eq('id', asset.id);
        }

        await logTransaction(req.userId, 'sell_crypto', payout, `Verkauf ${cryptoAmount} ${coinId.toUpperCase()}`);

        res.json({
            success: true,
            trade: {
                type: 'sell',
                coinId,
                amount: cryptoAmount,
                subtotal,
                fee,
                payout,
                volumeEligible: isEligible
            }
        });
    } catch (err) {
        logger.error('Sell Error:', err);
        res.status(500).json({ error: 'Verkauf fehlgeschlagen' });
    }
});

/**
 * POST /api/trade/leverage
 * Body: { coinId, amount, leverage }
 */
router.post('/leverage', telegramAuth, async (req, res) => {
    const { coinId, amount: cryptoAmount, leverage } = req.body;

    if (!coinId || !cryptoAmount || !leverage || cryptoAmount <= 0) {
        return res.status(400).json({ error: 'Ungültige Parameter' });
    }

    if (!CONFIG.LEVERAGE.AVAILABLE.includes(leverage)) {
        return res.status(400).json({ error: 'Ungültiger Hebel' });
    }

    try {
        const coin = await getCoinPrice(coinId);
        if (!coin) return res.status(404).json({ error: 'Coin nicht gefunden' });

        const { data: user } = await supabase
            .from('profiles')
            .select('balance')
            .eq('id', req.userId)
            .single();

        const actualCost = (cryptoAmount * coin.price) / leverage;
        const { fee } = calculateTrade(cryptoAmount, coin.price);
        const totalCost = actualCost + fee;

        if (parseFloat(user.balance) < totalCost) {
            return res.status(400).json({ error: 'Guthaben zu niedrig', required: totalCost });
        }

        // Prüfe ob bereits Hebel-Position existiert
        const { data: existing } = await supabase
            .from('user_crypto')
            .select('leverage')
            .eq('user_id', req.userId)
            .eq('coin_id', coinId.toLowerCase())
            .maybeSingle();

        if (existing && existing.leverage > 1) {
            return res.status(400).json({ error: 'Bereits eine Hebel-Position offen' });
        }

        const { error: rpcError } = await supabase.rpc('execute_trade_buy', {
            p_user_id: req.userId,
            p_total_cost: totalCost,
            p_fee: fee
        });
        if (rpcError) throw rpcError;

        const liqPrice = coin.price * (1 - (0.9 / leverage));

        await supabase.from('user_crypto').insert({
            user_id: req.userId,
            coin_id: coinId.toLowerCase(),
            amount: cryptoAmount,
            avg_buy_price: coin.price,
            leverage,
            entry_price: coin.price,
            liquidation_price: liqPrice,
            created_at: new Date().toISOString()
        });

        await logTransaction(req.userId, 'leverage_trade', totalCost, `Hebel ${leverage}x: ${cryptoAmount} ${coinId.toUpperCase()}`);

        if (leverage >= 50) {
            await checkAndAwardAchievement(req.userId, 'high_roller');
        }

        res.json({
            success: true,
            trade: {
                type: 'leverage',
                coinId,
                amount: cryptoAmount,
                leverage,
                actualCost,
                fee,
                totalCost,
                entryPrice: coin.price,
                liquidationPrice: liqPrice
            }
        });
    } catch (err) {
        logger.error('Leverage Error:', err);
        res.status(500).json({ error: 'Hebel-Trade fehlgeschlagen' });
    }
});

export default router;
