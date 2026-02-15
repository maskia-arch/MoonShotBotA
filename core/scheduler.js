// core/scheduler.js - V0.22 - AGGRESSIVER UPDATE-MODE
import { updateMarketPrices, getMarketUpdateStatus } from '../logic/market.js';
import { runEconomyTick } from '../logic/economy.js';
import { checkLiquidations } from '../logic/liquidation.js';
import { triggerRandomMarketEvent } from '../logic/events.js';
import { logger } from '../utils/logger.js';
import { CONFIG } from '../config.js';

let intervals = {
    market: null,
    economy: null,
    liquidation: null,
    events: null,
    healthCheck: null
};

export function startGlobalScheduler(bot) {
    logger.info("⏰ Starte Scheduler-System V0.22...");

    // === MARKT-UPDATES: Alle 60 Sekunden (AGGRESSIV) ===
    logger.info("📊 Initialisiere Markt-Update-System...");
    
    // Initial-Update SOFORT (mit Retry)
    performMarketUpdateWithRetry(3);

    // Dann regelmäßig alle 60s
    intervals.market = setInterval(async () => {
        try {
            await updateMarketPrices();
        } catch (err) {
            logger.error("❌ Scheduler Market-Update Error:", err);
            // Bei Fehler: Retry nach 10s
            setTimeout(() => {
                logger.info("🔄 Retry Market-Update nach Fehler...");
                updateMarketPrices().catch(e => logger.error("Retry failed:", e));
            }, 10000);
        }
    }, CONFIG.MARKET_UPDATE_MS || 60000);

    // === HEALTH-CHECK: Alle 5 Minuten ===
    intervals.healthCheck = setInterval(() => {
        const status = getMarketUpdateStatus();
        
        if (!status.lastUpdate) {
            logger.error("🚨 KRITISCH: Noch NIE ein Update erfolgreich!");
            performMarketUpdateWithRetry(5);
        } else {
            const ageMin = Math.floor(status.timeSinceUpdate / 60000);
            
            if (ageMin > 10) {
                logger.error(`🚨 KRITISCH: Letztes Update vor ${ageMin} Minuten!`);
                logger.error(`   Consecutive Failures: ${status.consecutiveFailures}`);
                performMarketUpdateWithRetry(3);
            } else if (ageMin > 5) {
                logger.warn(`⚠️ Letztes Update vor ${ageMin} Minuten - Check läuft`);
            } else {
                logger.debug(`✅ Market-Health OK (${ageMin}min alt)`);
            }
        }
    }, 300000); // 5 Min

    // === ECONOMY-TICK: Alle 60 Minuten ===
    logger.info("💰 Starte Economy-Tick (60min)");
    intervals.economy = setInterval(async () => {
        try {
            await runEconomyTick();
            logger.info("✅ Economy-Tick done");
        } catch (err) {
            logger.error("❌ Economy-Tick Error:", err);
        }
    }, CONFIG.TICK_SPEED_MS || 3600000);

    // === LIQUIDATIONS: Alle 5 Minuten ===
    logger.info("🔍 Starte Liquidation-Check (5min)");
    intervals.liquidation = setInterval(async () => {
        try {
            await checkLiquidations(bot);
        } catch (err) {
            logger.error("❌ Liquidation-Check Error:", err);
        }
    }, 300000);

    // === EVENTS: Alle 30 Minuten ===
    logger.info("🎲 Starte Event-System (30min)");
    intervals.events = setInterval(async () => {
        try {
            await triggerRandomMarketEvent(bot);
        } catch (err) {
            logger.error("❌ Event-Trigger Error:", err);
        }
    }, CONFIG.EVENT_CHECK_MS || 1800000);

    logger.info("✅ Alle Scheduler gestartet!");
    logger.info(`📅 Nächstes Market-Update in 60s`);
    logger.info(`💰 Nächster Economy-Tick in 60min`);
    logger.info(`🔍 Nächster Liquidation-Check in 5min`);
}

/**
 * Markt-Update mit automatischen Retries
 */
async function performMarketUpdateWithRetry(maxRetries = 3) {
    for (let i = 1; i <= maxRetries; i++) {
        try {
            logger.info(`🔄 Market-Update Versuch ${i}/${maxRetries}...`);
            await updateMarketPrices();
            logger.info(`✅ Market-Update erfolgreich!`);
            return true;
        } catch (err) {
            logger.error(`❌ Versuch ${i} fehlgeschlagen:`, err.message);
            
            if (i < maxRetries) {
                const waitMs = i * 5000; // 5s, 10s, 15s...
                logger.info(`⏳ Warte ${waitMs/1000}s vor nächstem Versuch...`);
                await new Promise(resolve => setTimeout(resolve, waitMs));
            }
        }
    }
    
    logger.error(`🚨 Alle ${maxRetries} Versuche fehlgeschlagen!`);
    return false;
}

/**
 * Stoppt alle Scheduler
 */
export function stopAllSchedulers() {
    logger.info("⏸️ Stoppe alle Scheduler...");
    
    Object.keys(intervals).forEach(key => {
        if (intervals[key]) {
            clearInterval(intervals[key]);
            intervals[key] = null;
        }
    });
    
    logger.info("✅ Alle Scheduler gestoppt");
}

/**
 * Manueller Force-Update
 */
export async function forceMarketUpdate() {
    logger.info("🔄 Manueller Force-Update...");
    return await performMarketUpdateWithRetry(5);
}

/**
 * Status aller Scheduler
 */
export function getSchedulerStatus() {
    const marketStatus = getMarketUpdateStatus();
    
    return {
        running: Object.values(intervals).some(i => i !== null),
        market: {
            active: intervals.market !== null,
            lastUpdate: marketStatus.lastUpdate,
            attempts: marketStatus.attempts,
            failures: marketStatus.consecutiveFailures
        },
        economy: { active: intervals.economy !== null },
        liquidation: { active: intervals.liquidation !== null },
        events: { active: intervals.events !== null },
        healthCheck: { active: intervals.healthCheck !== null }
    };
}