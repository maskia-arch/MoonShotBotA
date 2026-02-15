// logic/liquidation.js - Hebel-Liquidation System
import { supabase } from '../supabase/client.js';
import { getMarketData } from './market.js';
import { logger } from '../utils/logger.js';
import { logTransaction } from '../supabase/queries.js';
import { checkLiquidationRisk } from './tradeLogic.js';

export async function checkLiquidations(bot) {
    try {
        const marketData = await getMarketData();
        
        const { data: positions } = await supabase
            .from('user_crypto')
            .select('*, profiles(username)')
            .gt('leverage', 1);

        if (!positions || positions.length === 0) return;

        for (const pos of positions) {
            const currentPrice = marketData[pos.coin_id]?.price;
            if (!currentPrice) continue;

            const risk = checkLiquidationRisk(
                currentPrice,
                pos.entry_price || pos.avg_buy_price,
                pos.leverage
            );

            if (risk.liquidated) {
                await performLiquidation(bot, pos, currentPrice);
            } else if (risk.riskLevel === 'extreme' || risk.riskLevel === 'high') {
                // Warnung senden
                try {
                    await bot.telegram.sendMessage(
                        pos.user_id,
                        `⚠️ **LIQUIDATIONS-WARNUNG**\n\n${pos.coin_id.toUpperCase()}: Deine ${pos.leverage}x Position ist in Gefahr!\n\nAktueller Kurs: ${currentPrice.toFixed(2)} €\nLiquidation bei: ${pos.liquidation_price.toFixed(2)} €\n\nSchließe die Position oder füge Kapital hinzu!`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (e) {}
            }
        }
    } catch (err) {
        logger.error("Liquidation Check Fehler:", err);
    }
}

async function performLiquidation(bot, pos, currentPrice) {
    try {
        await supabase.from('user_crypto').delete().eq('id', pos.id);

        const totalLoss = (pos.amount * pos.entry_price) / pos.leverage;
        
        await logTransaction(
            pos.user_id, 
            'liquidation', 
            -totalLoss, 
            `LIQUIDATION: ${pos.coin_id.toUpperCase()} (${pos.leverage}x)`
        );

        const msg = `🚨 **LIQUIDATION** 🚨\n\nDeine ${pos.leverage}x Position in **${pos.coin_id.toUpperCase()}** wurde zwangsliquidiert!\n\nEntry: ${pos.entry_price.toFixed(2)} €\nLiquidation: ${pos.liquidation_price.toFixed(2)} €\nAktuell: ${currentPrice.toFixed(2)} €\n\nVerlust: -${totalLoss.toFixed(2)} €`;
        
        await bot.telegram.sendMessage(pos.user_id, msg, { parse_mode: 'Markdown' });
        
        logger.info(`💀 User ${pos.user_id} liquidiert in ${pos.coin_id}`);
    } catch (err) {
        logger.error("Liquidation Execution Fehler:", err);
    }
}
