// core/scheduler.js - V0.23.3 - GARANTIERT LAUFENDER SCHEDULER
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

let isRunning = false;

/**
 * V0.23.3: ROBUSTER Scheduler der GARANTIERT läuft
 */
export function startGlobalScheduler(bot) {
    if (isRunning) {
        logger.warn("⚠️ Scheduler läuft bereits!");
        return;
    }

    logger.info("⏰ === STARTE SCHEDULER V0.23.3 ===");

    // === MARKT-UPDATES: Alle 60 Sekunden ===
    logger.info("📊 Starte Markt-Update-Loop...");
    
    // WICHTIG: Wrapper-Funktion für Error-Handling
    const marketUpdateLoop = async () => {
        try {
            logger.info(`🔄 [SCHEDULED] Markt-Update getriggert`);
            await updateMarketPrices();
        } catch (err) {
            logger.error(`❌ [SCHEDULED] Markt-Update Error: ${err.message}`);
            // Weiter machen, nicht crashen!
        }
    };

    // Erster Update SOFORT
    logger.info("🚀 Starte initialen Markt-Update...");
    marketUpdateLoop().catch(e => logger.error("Initial-Update Error:", e));

    // Dann regelmäßig alle 60 Sekunden
    intervals.market = setInterval(marketUpdateLoop, 60000);
    logger.info("✅ Markt-Interval gesetzt (60s)");

    // === TEST-PING: Alle 30 Sekunden ===
    // Zeigt dass Scheduler lebt
    let pingCount = 0;
    setInterval(() => {
        pingCount++;
        const status = getMarketUpdateStatus();
        
        if (status.lastUpdate) {
            const ageMin = Math.floor(status.timeSinceUpdate / 60000);
            logger.info(`💓 Scheduler ALIVE (Ping #${pingCount}) - Letztes Update: ${ageMin}min alt`);
        } else {
            logger.warn(`💓 Scheduler ALIVE (Ping #${pingCount}) - ⚠️ NOCH NIE geupdatet!`);
        }
    }, 30000);

    // === ECONOMY-TICK: Alle 60 Minuten ===
    logger.info("💰 Starte Economy-Tick...");
    intervals.economy = setInterval(async () => {
        try {
            logger.info("🏠 [SCHEDULED] Economy-Tick...");
            await runEconomyTick();
            logger.info("✅ Economy-Tick done");
        } catch (err) {
            logger.error("❌ Economy-Tick Error:", err);
        }
    }, CONFIG.TICK_SPEED_MS || 3600000);
    logger.info("✅ Economy-Interval gesetzt (60min)");

    // === LIQUIDATIONS: Alle 5 Minuten ===
    logger.info("🔍 Starte Liquidation-Check...");
    intervals.liquidation = setInterval(async () => {
        try {
            logger.info("⚡ [SCHEDULED] Liquidation-Check...");
            await checkLiquidations(bot);
        } catch (err) {
            logger.error("❌ Liquidation-Check Error:", err);
        }
    }, 300000);
    logger.info("✅ Liquidation-Interval gesetzt (5min)");

    // === EVENTS: Alle 30 Minuten ===
    logger.info("🎲 Starte Event-System...");
    intervals.events = setInterval(async () => {
        try {
            logger.info("🎰 [SCHEDULED] Event-Trigger...");
            await triggerRandomMarketEvent(bot);
        } catch (err) {
            logger.error("❌ Event-Trigger Error:", err);
        }
    }, CONFIG.EVENT_CHECK_MS || 1800000);
    logger.info("✅ Event-Interval gesetzt (30min)");

    // === HEALTH-CHECK: Alle 2 Minuten ===
    logger.info("🏥 Starte Health-Check...");
    intervals.healthCheck = setInterval(() => {
        const status = getMarketUpdateStatus();
        
        if (!status.lastUpdate) {
            logger.error("🚨 KRITISCH: Noch NIE ein Update erfolgreich!");
            logger.error("   → Versuche Force-Update...");
            updateMarketPrices().catch(e => logger.error("Force failed:", e));
        } else {
            const ageMin = Math.floor(status.timeSinceUpdate / 60000);
            
            if (ageMin > 5) {
                logger.error(`🚨 KRITISCH: Letztes Update vor ${ageMin} Minuten!`);
                logger.error(`   Failures: ${status.consecutiveFailures}`);
                logger.error("   → Triggere Recovery-Update...");
                updateMarketPrices().catch(e => logger.error("Recovery failed:", e));
            } else if (ageMin > 2) {
                logger.warn(`⚠️ Letztes Update vor ${ageMin} Minuten`);
            } else {
                logger.debug(`✅ Health OK (${ageMin}min alt)`);
            }
        }
        
        // Log Interval-Status
        logger.debug(`📊 Intervals: market=${intervals.market !== null}, economy=${intervals.economy !== null}`);
        
    }, 120000); // 2 Min
    logger.info("✅ Health-Check-Interval gesetzt (2min)");

    isRunning = true;
    
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    logger.info("✅ ALLE SCHEDULER GESTARTET!");
    logger.info("📊 Markt-Updates: Alle 60s");
    logger.info("💓 Health-Pings: Alle 30s");
    logger.info("🏥 Health-Checks: Alle 2min");
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

/**
 * Stoppe alle Scheduler
 */
export function stopAllSchedulers() {
    logger.info("⏸️ Stoppe Scheduler...");
    
    Object.keys(intervals).forEach(key => {
        if (intervals[key]) {
            clearInterval(intervals[key]);
            intervals[key] = null;
        }
    });
    
    isRunning = false;
    logger.info("✅ Scheduler gestoppt");
}

/**
 * Check ob Scheduler läuft
 */
export function isSchedulerRunning() {
    return isRunning;
}

/**
 * Status aller Scheduler
 */
export function getSchedulerStatus() {
    const marketStatus = getMarketUpdateStatus();
    
    return {
        running: isRunning,
        intervals: {
            market: intervals.market !== null,
            economy: intervals.economy !== null,
            liquidation: intervals.liquidation !== null,
            events: intervals.events !== null,
            healthCheck: intervals.healthCheck !== null
        },
        marketUpdates: {
            lastUpdate: marketStatus.lastUpdate,
            attempts: marketStatus.attempts,
            failures: marketStatus.consecutiveFailures,
            age: marketStatus.timeSinceUpdate
        }
    };
}

/**
 * Force-Restart des Schedulers (für Recovery)
 */
export function restartScheduler(bot) {
    logger.warn("🔄 RESTART Scheduler...");
    stopAllSchedulers();
    
    setTimeout(() => {
        logger.info("🔄 Starte Scheduler neu...");
        startGlobalScheduler(bot);
    }, 2000);
}
