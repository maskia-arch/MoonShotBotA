// logic/economy.js - Wirtschaftssystem
import { supabase } from '../supabase/client.js';
import { CONFIG } from '../config.js';
import { logger } from '../utils/logger.js';
import { logTransaction } from '../supabase/queries.js';

export async function runEconomyTick() {
    logger.info("🔄 Starte Wirtschafts-Tick...");

    try {
        const { data: assets, error } = await supabase
            .from('user_assets')
            .select('*, profiles(username, balance)');

        if (error) throw error;

        let processed = 0;
        for (const asset of assets) {
            await processAssetEconomy(asset);
            processed++;
        }

        logger.info(`✅ Tick beendet. ${processed} Assets verarbeitet.`);
    } catch (err) {
        logger.error("❌ Economy-Tick Fehler:", err);
    }
}

async function processAssetEconomy(asset) {
    const now = new Date();
    const lastCollection = asset.last_rent_collection 
        ? new Date(asset.last_rent_collection)
        : new Date(asset.created_at);
    
    const hoursSinceLast = (now - lastCollection) / (1000 * 60 * 60);

    // Miete alle 24 Stunden
    if (hoursSinceLast >= CONFIG.RENT_CYCLE_HOURS) {
        const property = CONFIG.PROPERTIES[asset.asset_type];
        if (!property) return;

        const rentAmount = calculateRent(asset, property);
        
        // Miete gutschreiben
        await supabase.rpc('increment_balance', { 
            user_id: asset.user_id, 
            amount: rentAmount 
        });

        // Zeitstempel aktualisieren
        await supabase
            .from('user_assets')
            .update({ last_rent_collection: now.toISOString() })
            .eq('id', asset.id);

        await logTransaction(
            asset.user_id, 
            'rent', 
            rentAmount, 
            `Miete: ${property.name}`
        );

        logger.debug(`💰 Miete: ${rentAmount}€ für User ${asset.user_id}`);
    }

    // Zufällige Wartungskosten
    if (Math.random() < CONFIG.MAINTENANCE_CHANCE) {
        await applyMaintenanceEvent(asset);
    }

    // Langsamer Zustandsverfall
    const monthsSincePurchase = (now - new Date(asset.created_at)) / (1000 * 60 * 60 * 24 * 30);
    if (monthsSincePurchase >= 1 && asset.condition > 50) {
        const decay = Math.floor(monthsSincePurchase * CONFIG.CONDITION_DECAY_RATE);
        const newCondition = Math.max(50, asset.condition - decay);
        
        if (newCondition !== asset.condition) {
            await supabase
                .from('user_assets')
                .update({ condition: newCondition })
                .eq('id', asset.id);
        }
    }
}

function calculateRent(asset, property) {
    const base = property.rent || 0;
    
    // Zustand unter 80% = reduzierte Miete
    const conditionFactor = asset.condition < 80 
        ? (asset.condition / 100) 
        : 1;
    
    return Math.floor(base * conditionFactor);
}

async function applyMaintenanceEvent(asset) {
    const property = CONFIG.PROPERTIES[asset.asset_type];
    const damage = Math.floor(Math.random() * 15) + 5; // 5-20% Schaden
    const newCondition = Math.max(0, asset.condition - damage);
    
    await supabase
        .from('user_assets')
        .update({ condition: newCondition })
        .eq('id', asset.id);

    const cost = property.maintenanceCost || 0;
    
    if (cost > 0) {
        await supabase.rpc('increment_balance', {
            user_id: asset.user_id,
            amount: -cost
        });

        await logTransaction(
            asset.user_id,
            'maintenance',
            -cost,
            `Wartung: ${property.name}`
        );
    }

    logger.info(`🛠️ Wartung: ${property.name} von User ${asset.user_id}, -${damage}% Zustand`);
}

export async function distributeSeasonRewards(bot) {
    try {
        logger.info("🏆 Starte Season-Belohnungen...");

        // Top 3 Spieler nach Gesamtvermögen
        const { data: topPlayers } = await supabase
            .from('profiles')
            .select('id, username, balance')
            .order('balance', { ascending: false })
            .limit(3);

        if (!topPlayers || topPlayers.length === 0) return;

        // Tax Pool holen
        const { data: economy } = await supabase
            .from('global_economy')
            .select('tax_pool')
            .eq('id', 1)
            .single();

        const prizePool = (economy?.tax_pool || 0) * CONFIG.LEADERBOARD.PRIZE_POOL_PERCENT;

        // Preise: 50%, 30%, 20%
        const prizes = [
            prizePool * 0.5,
            prizePool * 0.3,
            prizePool * 0.2
        ];

        for (let i = 0; i < Math.min(topPlayers.length, 3); i++) {
            const player = topPlayers[i];
            const prize = prizes[i];

            if (prize > 0) {
                await supabase.rpc('increment_balance', {
                    user_id: player.id,
                    amount: prize
                });

                await logTransaction(
                    player.id,
                    'season_reward',
                    prize,
                    `Platz ${i + 1} - Season-Belohnung`
                );

                // Benachrichtigung
                try {
                    await bot.telegram.sendMessage(
                        player.id,
                        `🏆 **SEASON ENDE - Du bist Platz ${i + 1}!**\n\nBelohnung: ${prize.toFixed(2)} €\n\nGlückwunsch!`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (e) {
                    logger.debug(`Konnte User ${player.id} nicht benachrichtigen`);
                }
            }
        }

        // Tax Pool zurücksetzen
        await supabase
            .from('global_economy')
            .update({ tax_pool: 0 })
            .eq('id', 1);

        logger.info("✅ Season-Belohnungen verteilt!");

    } catch (err) {
        logger.error("❌ Season Rewards Fehler:", err);
    }
}
