// server/api/auth.js - User-Authentifizierung & Profil
import { Router } from 'express';
import { telegramAuth } from '../middleware/telegramAuth.js';
import { syncUser, getUserProfile } from '../../supabase/queries.js';
import { logger } from '../../utils/logger.js';

const router = Router();

/**
 * POST /api/auth/login
 * Telegram User einloggen/registrieren
 */
router.post('/login', telegramAuth, async (req, res) => {
    try {
        const { id, first_name, username } = req.telegramUser;
        const profile = await syncUser(id, username || first_name);

        if (!profile) {
            return res.status(500).json({ error: 'Registrierung fehlgeschlagen' });
        }

        const isNew = Date.now() - new Date(profile.created_at).getTime() < 15000;

        res.json({
            success: true,
            isNewUser: isNew,
            profile: {
                id: profile.id,
                username: profile.username,
                balance: parseFloat(profile.balance),
                tradingVolume: parseFloat(profile.trading_volume),
                createdAt: profile.created_at
            }
        });
    } catch (err) {
        logger.error('Login Error:', err);
        res.status(500).json({ error: 'Login fehlgeschlagen' });
    }
});

/**
 * GET /api/auth/profile
 * Vollständiges Profil abrufen
 */
router.get('/profile', telegramAuth, async (req, res) => {
    try {
        const profile = await getUserProfile(req.userId);

        if (!profile) {
            return res.status(404).json({ error: 'Profil nicht gefunden' });
        }

        res.json({
            id: profile.id,
            username: profile.username,
            balance: parseFloat(profile.balance),
            tradingVolume: parseFloat(profile.trading_volume),
            cryptos: profile.user_crypto || [],
            assets: profile.user_assets || [],
            seasonStats: profile.season_stats || null,
            createdAt: profile.created_at
        });
    } catch (err) {
        logger.error('Profile Error:', err);
        res.status(500).json({ error: 'Profil laden fehlgeschlagen' });
    }
});

export default router;
