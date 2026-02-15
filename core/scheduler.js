// core/scheduler.js - V0.23.4 - MIT setTimeout (GARANTIERT)
import { updateMarketPrices, getMarketUpdateStatus } from '../logic/market.js';
import { runEconomyTick } from '../logic/economy.js';
import { checkLiquidations } from '../logic/liquidation.js';
import { triggerRandomMarketEvent } from '../logic/events.js';
import { logger } from '../utils/logger.js';
import { CONFIG } from '../config.js';

let timeouts = {
    market: null,
    economy: null,
    liquidation: null,
    events: null,
    healthCheck: null,
    ping: null
};

let isRunning = false;
let bot = null;

/**
 * V0.23.4: REKURSIVES setTimeout statt setInterval
 * Funktioniert IMMER, auch wenn setInterval blockiert wird!
 */
export function startGlobalScheduler(botInstance) {
    bot = botInstance;
    
    if (isRunning) {
        logger.warn("⚠️ Scheduler läuft bereits!");
        return;
    }

    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    logger.info("⏰ STARTE SCHEDULER V0.23.4 (setTimeout)");
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // WICHTIG: isRunning ERST setzen wenn alles startet
    isRunning = true;

    // === 1. MARKT-UPDATES: Alle 60 Sekunden ===
    logger.info("📊 Starte Markt-Update-Loop...");
    
    const marketLoop = async () => {
        if (!isRunning) {
            logger.warn("⏹️ Markt-Loop gestoppt (isRunning=false)");
            return;
        }
        
        try {
            logger.info(`🔄 [SCHEDULED] Markt-Update getriggert`);
            await updateMarketPrices();
            logger.info(`✅ [SCHEDULED] Markt-Update done`);
        } catch (err) {
            logger.error(`❌ [SCHEDULED] Markt-Update Error: ${err.message}`);
        }
        
        // REKURSIV: Nächster Call nach 60s
        if (isRunning) {
            timeouts.market = setTimeout(marketLoop, 60000);
            logger.debug("⏰ Nächster Markt-Update in 60s");
        }
    };

    // Initial-Call SOFORT
    logger.info("🚀 Initialer Markt-Update...");
    marketLoop().catch(e => logger.error("Initial-Update Error:", e));
    
    logger.info("✅ Markt-Loop gestartet");

    // === 2. HEALTH-PINGS: Alle 30 Sekunden ===
    logger.info("💓 Starte Health-Ping-Loop...");
    
    let pingCount = 0;
    const pingLoop = () => {
        if (!isRunning) {
            logger.warn("⏹️ Ping-Loop gestoppt");
            return;
        }
        
        pingCount++;
        const status = getMarketUpdateStatus();
        
        if (status.lastUpdate) {
            const ageMin = Math.floor(status.timeSinceUpdate / 60000);
            const ageSec = Math.floor((status.timeSinceUpdate % 60000) / 1000);
            logger.info(`💓 PING #${pingCount} - Letztes Update: ${ageMin}min ${ageSec}s alt`);
        } else {
            logger.warn(`💓 PING #${pingCount} - ⚠️ NOCH NIE geupdatet!`);
        }
        
        // REKURSIV
        if (isRunning) {
            timeouts.ping = setTimeout(pingLoop, 30000);
        }
    };
    
    // Erster Ping nach 30s
    timeouts.ping = setTimeout(pingLoop, 30000);
    logger.info("✅ Ping-Loop gestartet");

    // === 3. HEALTH-CHECK: Alle 2 Minuten ===
    logger.info("🏥 Starte Health-Check-Loop...");
    
    const healthLoop = () => {
        if (!isRunning) {
            logger.warn("⏹️ Health-Loop gestoppt");
            return;
        }
        
        const status = getMarketUpdateStatus();
        
        if (!status.lastUpdate) {
            logger.error("🚨 KRITISCH: Noch NIE ein Update!");
            logger.error("   → Triggere Recovery...");
            updateMarketPrices().catch(e => logger.error("Recovery failed:", e));
        } else {
            const ageMin = Math.floor(status.timeSinceUpdate / 60000);
            
            if (ageMin > 5) {
                logger.error(`🚨 KRITISCH: Update ${ageMin}min alt!`);
                logger.error(`   Failures: ${status.consecutiveFailures}`);
                logger.error("   → Recovery-Update...");
                updateMarketPrices().catch(e => logger.error("Recovery failed:", e));
            } else if (ageMin > 2) {
                logger.warn(`⚠️ Update ${ageMin}min alt`);
            } else {
                logger.debug(`✅ Health OK (${ageMin}min alt)`);
            }
        }
        
        // Timeout-Status loggen
        logger.debug(`📊 Timeouts aktiv: market=${timeouts.market !== null}, ping=${timeouts.ping !== null}`);
        
        // REKURSIV
        if (isRunning) {
            timeouts.healthCheck = setTimeout(healthLoop, 120000);
        }
    };
    
    // Erster Health-Check nach 2min
    timeouts.healthCheck = setTimeout(healthLoop, 120000);
    logger.info("✅ Health-Check-Loop gestartet");

    // === 4. ECONOMY-TICK: Alle 60 Minuten ===
    logger.info("💰 Starte Economy-Loop...");
    
    const economyLoop = async () => {
        if (!isRunning) return;
        
        try {
            logger.info("🏠 [SCHEDULED] Economy-Tick...");
            await runEconomyTick();
            logger.info("✅ Economy-Tick done");
        } catch (err) {
            logger.error("❌ Economy-Tick Error:", err);
        }
        
        if (isRunning) {
            timeouts.economy = setTimeout(economyLoop, CONFIG.TICK_SPEED_MS || 3600000);
        }
    };
    
    timeouts.economy = setTimeout(economyLoop, CONFIG.TICK_SPEED_MS || 3600000);
    logger.info("✅ Economy-Loop gestartet");

    // === 5. LIQUIDATIONS: Alle 5 Minuten ===
    logger.info("🔍 Starte Liquidation-Loop...");
    
    const liquidationLoop = async () => {
        if (!isRunning || !bot) return;
        
        try {
            logger.info("⚡ [SCHEDULED] Liquidation-Check...");
            await checkLiquidations(bot);
        } catch (err) {
            logger.error("❌ Liquidation-Check Error:", err);
        }
        
        if (isRunning) {
            timeouts.liquidation = setTimeout(liquidationLoop, 300000);
        }
    };
    
    timeouts.liquidation = setTimeout(liquidationLoop, 300000);
    logger.info("✅ Liquidation-Loop gestartet");

    // === 6. EVENTS: Alle 30 Minuten ===
    logger.info("🎲 Starte Event-Loop...");
    
    const eventLoop = async () => {
        if (!isRunning || !bot) return;
        
        try {
            logger.info("🎰 [SCHEDULED] Event-Trigger...");
            await triggerRandomMarketEvent(bot);
        } catch (err) {
            logger.error("❌ Event-Trigger Error:", err);
        }
        
        if (isRunning) {
            timeouts.events = setTimeout(eventLoop, CONFIG.EVENT_CHECK_MS || 1800000);
        }
    };
    
    timeouts.events = setTimeout(eventLoop, CONFIG.EVENT_CHECK_MS || 1800000);
    logger.info("✅ Event-Loop gestartet");

    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    logger.info("✅ ALLE SCHEDULER GESTARTET!");
    logger.info("📊 Markt-Updates: Alle 60s (setTimeout)");
    logger.info("💓 Health-Pings: Alle 30s");
    logger.info("🏥 Health-Checks: Alle 2min");
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

/**
 * Stoppe alle Scheduler
 */
export function stopAllSchedulers() {
    logger.info("⏸️ Stoppe Scheduler...");
    
    isRunning = false;
    
    Object.keys(timeouts).forEach(key => {
        if (timeouts[key]) {
            clearTimeout(timeouts[key]);
            timeouts[key] = null;
        }
    });
    
    logger.info("✅ Alle Timeouts gestoppt");
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
        timeouts: {
            market: timeouts.market !== null,
            economy: timeouts.economy !== null,
            liquidation: timeouts.liquidation !== null,
            events: timeouts.events !== null,
            healthCheck: timeouts.healthCheck !== null,
            ping: timeouts.ping !== null
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
 * Force-Restart
 */
export function restartScheduler(botInstance) {
    logger.warn("🔄 RESTART Scheduler...");
    stopAllSchedulers();
    
    setTimeout(() => {
        logger.info("🔄 Starte Scheduler neu...");
        startGlobalScheduler(botInstance);
    }, 2000);
}
