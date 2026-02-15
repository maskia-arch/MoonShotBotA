// logic/events.js - Zufallsevents
import { supabase } from '../supabase/client.js';
import { logger } from '../utils/logger.js';
import { CONFIG } from '../config.js';

const MARKET_EVENTS = [
    { id: 'bull_run', msg: "🚀 BREAKING: Institutionelle Investoren kaufen massiv BTC!", effect: 1.12 },
    { id: 'crash', msg: "📉 PANIK: Major Exchange gehackt - Millionen verloren!", effect: 0.85 },
    { id: 'regulation', msg: "⚖️ EU plant strenge Krypto-Regulierung!", effect: 0.92 },
    { id: 'adoption', msg: "✨ Fortune 500 Unternehmen akzeptiert Krypto-Zahlungen!", effect: 1.08 },
    { id: 'elon', msg: "🐦 Tech-Milliardär postet kryptisches Krypto-Meme!", effect: 1.05 }
];

export async function triggerRandomMarketEvent(bot) {
    if (Math.random() > 0.12) return; // 12% Chance

    const event = MARKET_EVENTS[Math.floor(Math.random() * MARKET_EVENTS.length)];
    logger.info(`📰 Markt-Event: ${event.id}`);

    await broadcastEvent(bot, event.msg);
}

async function broadcastEvent(bot, message) {
    const { data: profiles } = await supabase.from('profiles').select('id').limit(100);
    if (!profiles) return;

    for (const profile of profiles) {
        try {
            await bot.telegram.sendMessage(
                profile.id, 
                `📢 **MARKET NEWS**\n\n${message}`,
                { parse_mode: 'Markdown' }
            );
        } catch (e) {
            // User blockiert Bot
        }
    }
}

export async function triggerPropertyEvent(bot, userId, asset) {
    const EVENTS = [
        { title: "🌊 Wasserschaden!", cost: [800, 2500], condition: 20 },
        { title: "💎 Premium-Mieter!", cost: [0, 0], condition: -10 },
        { title: "⚖️ Steuerprüfung!", cost: [1500, 4000], condition: 0 },
        { title: "🔥 Brand im Treppenhaus!", cost: [2000, 5000], condition: 25 }
    ];

    const event = EVENTS[Math.floor(Math.random() * EVENTS.length)];
    const cost = Math.floor(Math.random() * (event.cost[1] - event.cost[0] + 1)) + event.cost[0];

    try {
        const newCondition = Math.max(0, Math.min(100, asset.condition - event.condition));
        
        await supabase.from('user_assets').update({ 
            condition: newCondition 
        }).eq('id', asset.id);

        if (cost > 0) {
            await supabase.rpc('increment_balance', { 
                user_id: userId, 
                amount: -cost 
            });
        }

        const property = CONFIG.PROPERTIES[asset.asset_type];
        const msg = `⚠️ **EVENT: ${event.title}**\n\n${property.emoji} ${property.name}\nKosten: -${cost} €\nZustand: ${newCondition}%`;
        
        await bot.telegram.sendMessage(userId, msg, { parse_mode: 'Markdown' });

    } catch (err) {
        logger.error("Property Event Fehler:", err);
    }
}
