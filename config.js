// config.js - Zentrale Konfiguration für MoonShot Tycoon
import { getVersion } from './utils/versionLoader.js';

export const CONFIG = {
    // Version & Bot-Grundlagen
    VERSION: getVersion(),
    TELEGRAM_TOKEN: process.env.BOT_TOKEN, 
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_KEY: process.env.SUPABASE_KEY,
    PORT: process.env.PORT || 3000,
    
    // === WIRTSCHAFTS-BALANCE ===
    INITIAL_CASH: 10000,
    TRADING_FEE: 0.005, // 0,5% pro Trade
    MIN_VOL_FOR_REALESTATE: 30000, // Handelsvolumen für Immobilien
    
    // === ZEITSTEUERUNG ===
    SEASON_DURATION_DAYS: 30,
    TICK_SPEED_MS: 3600000, // Wirtschafts-Tick alle 60 Min
    MARKET_UPDATE_MS: 60000, // Markt-Preise alle 60 Sek
    EVENT_CHECK_MS: 1800000, // Events alle 30 Min prüfen
    
    // === IMMOBILIEN-SYSTEM ===
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
    
    MAINTENANCE_CHANCE: 0.08, // 8% Chance pro Tick
    RENT_CYCLE_HOURS: 24,
    CONDITION_DECAY_RATE: 2, // 2% pro Monat ohne Wartung
    
    // === HEBEL-TRADING ===
    LEVERAGE: {
        MIN: 2,
        MAX: 50,
        AVAILABLE: [2, 5, 10, 20, 50],
        LIQUIDATION_THRESHOLD: 0.9 // 90% des Einsatzes
    },
    
    // === ACHIEVEMENTS ===
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
    
    // === MARKT-EVENTS ===
    MARKET_EVENTS: {
        BULL_RUN: { multiplier: 1.15, probability: 0.1 },
        CRASH: { multiplier: 0.82, probability: 0.08 },
        SIDEWAYS: { multiplier: 1.02, probability: 0.15 },
        WHALE_BUY: { multiplier: 1.08, probability: 0.12 },
        FUD: { multiplier: 0.93, probability: 0.1 }
    },
    
    // === API-EINSTELLUNGEN ===
    CRYPTOCOMPARE_BASE_URL: 'https://min-api.cryptocompare.com/data',
    SUPPORTED_COINS: ['bitcoin', 'litecoin', 'ethereum'],
    
    // === UI & EMOJIS ===
    EMOJIS: {
        CASH: '💶',
        CRYPTO: '📈',
        IMMO: '🏠',
        MAINTENANCE: '🛠️',
        ERROR: '🚨',
        SUCCESS: '✅',
        TREND_UP: '🟢',
        TREND_DOWN: '🔴',
        FIRE: '🔥',
        ROCKET: '🚀',
        WARNING: '⚠️',
        CHART: '📊',
        TROPHY: '🏆',
        STAR: '⭐',
        CROWN: '👑'
    },
    
    // === RANGLISTEN ===
    LEADERBOARD: {
        TOP_COUNT: 10,
        PRIZE_POOL_PERCENT: 0.3 // 30% des Tax-Pools für Season-Ende
    }
};

// Validierung beim Start
if (!CONFIG.TELEGRAM_TOKEN) {
    console.error("❌ FEHLER: BOT_TOKEN fehlt!");
    process.exit(1);
}
if (!CONFIG.SUPABASE_URL) {
    console.error("❌ FEHLER: SUPABASE_URL fehlt!");
    process.exit(1);
}
