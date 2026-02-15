// commands/achievements.js
import { supabase } from '../supabase/client.js';
import { achievementsLayout } from '../ui/layouts.js';
import { logger } from '../utils/logger.js';
import { CONFIG } from '../config.js';

export async function showAchievements(ctx) {
    const userId = ctx.from.id;

    try {
        const { data: unlocked } = await supabase
            .from('user_achievements')
            .select('achievement_id')
            .eq('user_id', userId);

        const unlockedIds = unlocked ? unlocked.map(a => a.achievement_id) : [];
        const message = achievementsLayout(CONFIG.ACHIEVEMENTS, unlockedIds);

        await ctx.sendInterface(message);

    } catch (err) {
        logger.error("Achievements Fehler:", err);
        ctx.reply("❌ Achievements konnten nicht geladen werden.");
    }
}
