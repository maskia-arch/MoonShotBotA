// commands/rank.js
import { supabase } from '../supabase/client.js';
import { leaderboardLayout } from '../ui/layouts.js';
import { leaderboardButtons } from '../ui/buttons.js';
import { logger } from '../utils/logger.js';

export async function showLeaderboard(ctx, type = 'wealth') {
    try {
        let data, title;
        
        if (type === 'wealth') {
            const { data: leaders } = await supabase
                .from('profiles')
                .select('username, balance')
                .order('balance', { ascending: false })
                .limit(10);
            data = leaders;
            title = '💰 Reichste Spieler';
        } else if (type === 'profit') {
            const { data: leaders } = await supabase
                .from('season_stats')
                .select('user_id, season_profit, profiles(username)')
                .order('season_profit', { ascending: false })
                .limit(10);
            data = leaders;
            title = '📈 Höchster Profit';
        } else if (type === 'loser') {
            const { data: leaders } = await supabase
                .from('season_stats')
                .select('user_id, season_loss, profiles(username)')
                .order('season_loss', { ascending: false })
                .limit(10);
            data = leaders;
            title = '📉 Wall of Shame';
        }

        const message = leaderboardLayout(data, title, type);
        await ctx.sendInterface(message, leaderboardButtons);

    } catch (err) {
        logger.error("Leaderboard Fehler:", err);
        ctx.reply("❌ Rangliste konnte nicht geladen werden.");
    }
}
