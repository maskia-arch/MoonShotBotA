// config.js - V1.0.0 - ValueTycoon Konfiguration
import { getVersion } from './utils/versionLoader.js';

export const CONFIG = {
    // Version & Grundlagen
    VERSION: getVersion(),
    TELEGRAM_TOKEN: process.env.BOT_TOKEN,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_KEY: process.env.SUPABASE_KEY,
    PORT: process.env.PORT || 3000,

    // NEU: Web App URL (Telegram Mini App)
    WEBAPP_URL: process.env.WEBAPP_URL || 'https://valuetycoon.app',
    // NEU: API URL für den Express-Server
    API_URL: process.env.API_URL || 'http://localhost:3001',
    // NEU: API Port für Express-Server (separater Port)
    API_PORT: process.env.API_PORT || 3001,

    // NEU: Bot Notify Endpoint (für Server → Bot Push-Nachrichten)
    BOT_NOTIFY_URL: process.env.BOT_NOTIFY_URL || 'http://localhost:3000/api/notify',

    // Wirtschafts-Balance
    INITIAL_CASH: 10000,
    TRADING_FEE: 0.005,
    MIN_VOL_FOR_REALESTATE: 30000,

    // Zeitsteuerung
    SEASON_DURATION_DAYS: 30,
    TICK_SPEED_MS: 3600000,       // Wirtschafts-Tick alle 60 Min
    MARKET_UPDATE_MS: 60000,      // Markt-Preise alle 60 Sek
    EVENT_CHECK_MS: 1800000,      // Events alle 30 Min

    // Immobilien
    PROPERTIES: {
        garage: {
            name: 'Garage in Berlin',
            price: 15000,
            rent: 110,
            maintenanceCost: 50,
            emoji: '🚗',
            tier: 1
        },
        apartment: {
            name: '1-Zimmer Wohnung',
            price: 85000,
            rent: 450,
            maintenanceCost: 120,
            emoji: '🏢',
            tier: 2
        },
        house: {
            name: 'Einfamilienhaus',
            price: 350000,
            rent: 1800,
            maintenanceCost: 350,
            emoji: '🏡',
            tier: 3
        },
        luxury_apartment: {
            name: 'Luxus-Penthouse',
            price: 1200000,
            rent: 6500,
            maintenanceCost: 1000,
            emoji: '🏰',
            tier: 4
        },
        commercial: {
            name: 'Gewerbeimmobilie',
            price: 2500000,
            rent: 15000,
            maintenanceCost: 2500,
            emoji: '🏪',
            tier: 5
        },
        skyscraper: {
            name: 'Wolkenkratzer',
            price: 10000000,
            rent: 75000,
            maintenanceCost: 10000,
            emoji: '🏙️',
            tier: 6
        }
    },

    MAINTENANCE_CHANCE: 0.08,
    RENT_CYCLE_HOURS: 24,
    CONDITION_DECAY_RATE: 2,

    // Hebel-Trading
    LEVERAGE: {
        MIN: 2,
        MAX: 50,
        AVAILABLE: [2, 5, 10, 20, 50],
        LIQUIDATION_THRESHOLD: 0.9
    },

    // Achievements
    ACHIEVEMENTS: {
        first_trade: {
            title: '🎯 Erster Trade',
            description: 'Führe deinen ersten Trade aus',
            reward: 100
        },
        property_mogul: {
            title: '🏠 Immobilien-Mogul',
            description: 'Besitze 5 Immobilien',
            reward: 5000
        },
        millionaire: {
            title: '💎 Millionär',
            description: 'Erreiche 1.000.000 € Gesamtvermögen',
            reward: 10000
        },
        high_roller: {
            title: '🎰 High Roller',
            description: 'Nutze einen 50x Hebel',
            reward: 2000
        },
        portfolio_king: {
            title: '👑 Portfolio König',
            description: 'Besitze alle Immobilien-Typen',
            reward: 25000
        }
    },

    // API
    CRYPTOCOMPARE_BASE_URL: 'https://min-api.cryptocompare.com/data',
    SUPPORTED_COINS: ['bitcoin', 'litecoin', 'ethereum'],

    // Emojis
    EMOJIS: {
        CASH: '💶', CRYPTO: '📈', IMMO: '🏠', MAINTENANCE: '🛠️',
        ERROR: '🚨', SUCCESS: '✅', TREND_UP: '🟢', TREND_DOWN: '🔴',
        FIRE: '🔥', ROCKET: '🚀', WARNING: '⚠️', CHART: '📊',
        TROPHY: '🏆', STAR: '⭐', CROWN: '👑'
    },

    // Ranglisten
    LEADERBOARD: {
        TOP_COUNT: 10,
        PRIZE_POOL_PERCENT: 0.3
    }
};

// Validierung
if (!CONFIG.TELEGRAM_TOKEN) {
    console.error("❌ FEHLER: BOT_TOKEN fehlt!");
    process.exit(1);
}
if (!CONFIG.SUPABASE_URL) {
    console.error("❌ FEHLER: SUPABASE_URL fehlt!");
    process.exit(1);
}
