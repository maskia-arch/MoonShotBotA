// server/api/achievements.js - Achievements API
import { Router } from 'express';
import { telegramAuth } from '../middleware/telegramAuth.js';
import { supabase } from '../../supabase/client.js';
import { CONFIG } from '../../config.js';
import { logger } from '../../utils/logger.js';

const router = Router();

/**
 * GET /api/achievements
 */
router.get('/', telegramAuth, async (req, res) => {
    try {
        const { data: unlocked } = await supabase
            .from('user_achievements')
            .select('achievement_id, unlocked_at')
            .eq('user_id', req.userId);

        const unlockedMap = {};
        (unlocked || []).forEach(a => {
            unlockedMap[a.achievement_id] = a.unlocked_at;
        });

        const achievements = Object.entries(CONFIG.ACHIEVEMENTS).map(([id, ach]) => ({
            id,
            title: ach.title,
            description: ach.description,
            reward: ach.reward,
            unlocked: !!unlockedMap[id],
            unlockedAt: unlockedMap[id] || null
        }));

        res.json({
            total: achievements.length,
            unlocked: achievements.filter(a => a.unlocked).length,
            achievements
        });
    } catch (err) {
        logger.error('Achievements Error:', err);
        res.status(500).json({ error: 'Achievements nicht verfügbar' });
    }
});

export default router;
