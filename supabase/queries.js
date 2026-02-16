// supabase/queries.js - V1.0.0 - FIX: syncUser + robustere Fehlerbehandlung
import { supabase } from './client.js';
import { CONFIG } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * FIX: User synchronisieren - Profil erstellen/aktualisieren
 * 
 * Probleme in V0.23:
 * 1. upsert + select().single() kann bei RLS-Policies scheitern
 * 2. season_stats Insert VOR Profil-Commit = FK-Violation
 * 3. Keine aussagekräftige Fehlermeldung
 * 
 * Fix: Erst prüfen ob User existiert, dann insert ODER update, 
 *      dann season_stats mit Retry
 */
export async function syncUser(id, username) {
    try {
        // Schritt 1: Prüfe ob Profil existiert
        const { data: existing, error: selectError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (selectError) {
            logger.error(`syncUser SELECT Fehler für ${id}:`, selectError);
            throw selectError;
        }

        let profile;

        if (existing) {
            // User existiert → Username aktualisieren
            const { data: updated, error: updateError } = await supabase
                .from('profiles')
                .update({ username, updated_at: new Date().toISOString() })
                .eq('id', id)
                .select()
                .single();

            if (updateError) {
                logger.error(`syncUser UPDATE Fehler für ${id}:`, updateError);
                throw updateError;
            }
            profile = updated;
        } else {
            // Neuer User → Insert mit allen Defaults
            const { data: created, error: insertError } = await supabase
                .from('profiles')
                .insert({
                    id,
                    username,
                    balance: CONFIG.INITIAL_CASH,
                    trading_volume: 0,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .select()
                .single();

            if (insertError) {
                logger.error(`syncUser INSERT Fehler für ${id}:`, insertError);
                // Falls Duplicate-Error (Race Condition), nochmal lesen
                if (insertError.code === '23505') {
                    const { data: retried } = await supabase
                        .from('profiles')
                        .select('*')
                        .eq('id', id)
                        .single();
                    profile = retried;
                } else {
                    throw insertError;
                }
            } else {
                profile = created;
            }

            // Schritt 2: Season-Stats NUR für neue User anlegen
            // FIX: Warte kurz damit FK-Constraint erfüllt ist
            if (profile) {
                const { error: seasonError } = await supabase
                    .from('season_stats')
                    .upsert({
                        user_id: id,
                        season_profit: 0,
                        season_loss: 0,
                        trades_count: 0
                    }, { onConflict: 'user_id' });

                if (seasonError) {
                    // Nicht kritisch - loggen aber nicht abbrechen
                    logger.warn(`syncUser season_stats Warnung für ${id}:`, seasonError.message);
                }
            }
        }

        if (!profile) {
            throw new Error(`Profil konnte nicht erstellt/geladen werden für ${id}`);
        }

        logger.info(`✅ syncUser OK: ${username} (${id}) - ${existing ? 'UPDATE' : 'NEU'}`);
        return profile;

    } catch (err) {
        logger.error(`❌ syncUser FATAL für ${id}:`, err);
        return null;
    }
}

export async function getUserProfile(id) {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('*, user_crypto(*), user_assets(*), season_stats(*)')
            .eq('id', id).single();

        if (error) throw error;
        return data;
    } catch (err) {
        logger.error(`getUserProfile Fehler für ${id}:`, err);
        return null;
    }
}

export async function logTransaction(userId, type, amount, description) {
    try {
        const { error } = await supabase.from('transactions').insert({
            user_id: userId,
            type,
            amount,
            description,
            created_at: new Date()
        });
        if (error) throw error;
    } catch (err) {
        logger.error("Transaction Log Fehler:", err.message);
    }
}

export async function checkAndAwardAchievement(userId, achievementId) {
    try {
        const achievement = CONFIG.ACHIEVEMENTS[achievementId];
        if (!achievement) return;

        const { data: existing } = await supabase
            .from('user_achievements')
            .select('id')
            .eq('user_id', userId)
            .eq('achievement_id', achievementId)
            .maybeSingle();

        if (existing) return;

        await supabase.from('user_achievements').insert({
            user_id: userId,
            achievement_id: achievementId,
            unlocked_at: new Date()
        });

        await supabase.rpc('increment_balance', {
            user_id: userId,
            amount: achievement.reward
        });

        await logTransaction(
            userId,
            'achievement',
            achievement.reward,
            `Achievement: ${achievement.title}`
        );

        logger.info(`🏆 User ${userId} unlocked: ${achievementId}`);
        return true;
    } catch (err) {
        logger.error("Achievement Award Fehler:", err);
        return false;
    }
}

export async function updateWealth(userId) {
    try {
        const userData = await getUserProfile(userId);
        if (!userData) return;

        let totalWealth = userData.balance;

        if (userData.user_crypto) {
            const { getMarketData } = await import('../logic/market.js');
            const market = await getMarketData();

            userData.user_crypto.forEach(crypto => {
                const price = market[crypto.coin_id]?.price || 0;
                totalWealth += crypto.amount * price;
            });
        }

        if (userData.user_assets) {
            userData.user_assets.forEach(asset => {
                totalWealth += asset.purchase_price * 0.8;
            });
        }

        if (totalWealth >= 1000000) {
            await checkAndAwardAchievement(userId, 'millionaire');
        }

        if (userData.user_assets && userData.user_assets.length >= 5) {
            await checkAndAwardAchievement(userId, 'property_mogul');
        }

        const uniqueTypes = [...new Set(userData.user_assets?.map(a => a.asset_type) || [])];
        if (uniqueTypes.length >= Object.keys(CONFIG.PROPERTIES).length) {
            await checkAndAwardAchievement(userId, 'portfolio_king');
        }

    } catch (err) {
        logger.error("Update Wealth Fehler:", err);
    }
}
