// server/middleware/telegramAuth.js - Telegram WebApp Auth Validation
import crypto from 'crypto';
import { CONFIG } from '../../config.js';
import { logger } from '../../utils/logger.js';

/**
 * Middleware: Validiert Telegram WebApp initData
 * Prüft HMAC-SHA256 Signatur gegen den Bot-Token
 * 
 * Header: X-Telegram-Init-Data: <initData string>
 */
export function telegramAuth(req, res, next) {
    const initData = req.headers['x-telegram-init-data'];

    if (!initData) {
        return res.status(401).json({ error: 'Keine Authentifizierung' });
    }

    try {
        const parsed = validateInitData(initData);

        if (!parsed) {
            return res.status(401).json({ error: 'Ungültige Authentifizierung' });
        }

        // User-Daten an Request anhängen
        req.telegramUser = parsed.user;
        req.userId = parsed.user.id;

        next();
    } catch (err) {
        logger.error('Auth Error:', err);
        return res.status(401).json({ error: 'Authentifizierung fehlgeschlagen' });
    }
}

/**
 * Validiert Telegram initData String
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function validateInitData(initData) {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');

    if (!hash) return null;

    // Sortierte Key-Value-Paare ohne hash
    params.delete('hash');
    const dataCheckString = [...params.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

    // HMAC Berechnung
    const secretKey = crypto
        .createHmac('sha256', 'WebAppData')
        .update(CONFIG.TELEGRAM_TOKEN)
        .digest();

    const computedHash = crypto
        .createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

    if (computedHash !== hash) {
        logger.warn('initData Hash mismatch');
        return null;
    }

    // Auth-Date prüfen (max 24h alt)
    const authDate = parseInt(params.get('auth_date'));
    if (Date.now() / 1000 - authDate > 86400) {
        logger.warn('initData abgelaufen');
        return null;
    }

    // User parsen
    const userStr = params.get('user');
    if (!userStr) return null;

    const user = JSON.parse(userStr);

    return { user, authDate };
}

/**
 * Optionale Auth - setzt User wenn vorhanden, blockt aber nicht
 */
export function optionalAuth(req, res, next) {
    const initData = req.headers['x-telegram-init-data'];

    if (initData) {
        try {
            const parsed = validateInitData(initData);
            if (parsed) {
                req.telegramUser = parsed.user;
                req.userId = parsed.user.id;
            }
        } catch (err) {
            // Ignorieren
        }
    }

    next();
}
