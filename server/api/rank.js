// server/api/rank.js - Ranglisten API
import { Router } from 'express';
import { optionalAuth } from '../middleware/telegramAuth.js';
import { supabase } from '../../supabase/client.js';
import { logger } from '../../utils/logger.js';

const router = Router();

/**
 * GET /api/rank?type=wealth|profit|loser
 */
router.get('/', optionalAuth, async (req, res) => {
    const type = req.query.type || 'wealth';

    try {
        let data;

        if (type === 'wealth') {
            const result = await supabase
                .from('profiles')
                .select('id, username, balance')
                .order('balance', { ascending: false })
                .limit(10);
            data = (result.data || []).map(d => ({
                id: d.id,
                username: d.username,
                value: parseFloat(d.balance),
                isCurrentUser: d.id === req.userId
            }));
        } else if (type === 'profit') {
            const result = await supabase
                .from('season_stats')
                .select('user_id, season_profit, profiles(username)')
                .order('season_profit', { ascending: false })
                .limit(10);
            data = (result.data || []).map(d => ({
                id: d.user_id,
                username: d.profiles?.username || 'Anonym',
                value: parseFloat(d.season_profit),
                isCurrentUser: d.user_id === req.userId
            }));
        } else if (type === 'loser') {
            const result = await supabase
                .from('season_stats')
                .select('user_id, season_loss, profiles(username)')
                .order('season_loss', { ascending: false })
                .limit(10);
            data = (result.data || []).map(d => ({
                id: d.user_id,
                username: d.profiles?.username || 'Anonym',
                value: parseFloat(d.season_loss),
                isCurrentUser: d.user_id === req.userId
            }));
        }

        res.json({ type, leaderboard: data || [] });
    } catch (err) {
        logger.error('Rank Error:', err);
        res.status(500).json({ error: 'Rangliste nicht verfügbar' });
    }
});

export default router;
