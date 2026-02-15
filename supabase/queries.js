// supabase/queries.js - Erweitert mit Achievements
import { supabase } from './client.js';
import { CONFIG } from '../config.js';
import { logger } from '../utils/logger.js';

export async function syncUser(id, username) {
    try {
        const { data: profile, error: pError } = await supabase
            .from('profiles')
            .upsert({ id, username }, { onConflict: 'id' })
            .select().single();

        if (pError) throw pError;
        
        await supabase.from('season_stats').upsert({ user_id: id }, { onConflict: 'user_id' });
        
        return profile;
    } catch (err) {
        logger.error(`syncUser Fehler für ${id}:`, err);
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

        if (existing) return; // Bereits freigeschaltet

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
