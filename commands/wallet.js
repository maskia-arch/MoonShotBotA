// commands/wallet.js - Erweitertes Portfolio
import { supabase } from '../supabase/client.js';
import { getUserProfile } from '../supabase/queries.js';
import { portfolioLayout, transactionHistoryLayout } from '../ui/layouts.js';
import { portfolioButtons } from '../ui/buttons.js';
import { getMarketData } from '../logic/market.js';
import { logger } from '../utils/logger.js';

export async function showWallet(ctx, filter = 'all') {
    const userId = ctx.from.id;

    try {
        const userData = await getUserProfile(userId);
        
        if (!userData) {
            return ctx.reply("❌ Profil nicht gefunden. Nutze /start.");
        }

        const marketData = await getMarketData();
        
        const processedAssets = [];

        // Kryptos
        if (userData.user_crypto && filter !== 'immo') {
            userData.user_crypto.forEach(coin => {
                const currentPrice = marketData[coin.coin_id]?.price || 0;
                const currentVal = coin.amount * currentPrice;
                const profitPercent = coin.avg_buy_price 
                    ? ((currentPrice - coin.avg_buy_price) / coin.avg_buy_price) * 100 
                    : 0;

                processedAssets.push({
                    type: 'crypto',
                    symbol: coin.coin_id,
                    amount: coin.amount,
                    profit: profitPercent,
                    value: currentVal,
                    leverage: coin.leverage || 1,
                    liquidationPrice: coin.liquidation_price
                });
            });
        }

        // Immobilien
        if (userData.user_assets && filter !== 'crypto') {
            userData.user_assets.forEach(asset => {
                processedAssets.push({
                    type: 'immo',
                    name: asset.asset_type,
                    condition: asset.condition,
                    id: asset.id
                });
            });
        }

        const message = portfolioLayout(userData, processedAssets);
        await ctx.sendInterface(message, portfolioButtons);

    } catch (err) {
        logger.error("Wallet Fehler:", err);
        ctx.reply("🚨 Fehler beim Laden des Portfolios.");
    }
}

export async function showTransactionHistory(ctx) {
    const userId = ctx.from.id;

    try {
        const { data: transactions } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(15);

        if (!transactions || transactions.length === 0) {
            return ctx.sendInterface(`
📜 **Transaktionsverlauf**

Noch keine Transaktionen vorhanden.
`);
        }

        const message = transactionHistoryLayout(transactions);
        await ctx.sendInterface(message);

    } catch (err) {
        logger.error("Transaction History Fehler:", err);
        ctx.reply("❌ Fehler beim Laden der Historie.");
    }
}
