// core/scheduler.js - VERBESSERT mit robustem Markt-Update
import { updateMarketPrices, getMarketUpdateStatus } from '../logic/market.js';
import { runEconomyTick } from '../logic/economy.js';
import { checkLiquidations } from '../logic/liquidation.js';
import { triggerRandomMarketEvent } from '../logic/events.js';
import { logger } from '../utils/logger.js';
import { CONFIG } from '../config.js';

let marketUpdateInterval = null;
let economyInterval = null;
let liquidationInterval = null;
let eventInterval = null;

export function startGlobalScheduler(bot) {
    logger.info("⏰ Starte Scheduler-System...");

    // === MARKT-UPDATES: Alle 60 Sekunden ===
    // WICHTIG: Sofort beim Start + dann alle 60s
    logger.info("📊 Starte Markt-Update-Loop (60s Intervall)");
    
    // Erster Update SOFORT
    updateMarketPrices()
        .then(() => logger.info("✅ Initial-Update erfolgreich"))
        .catch(err => logger.error("❌ Initial-Update fehlgeschlagen:", err));

    // Dann regelmäßig alle 60 Sekunden
    marketUpdateInterval = setInterval(async () => {
        try {
            await updateMarketPrices();
            
            // Status-Check alle 10 Updates
            const status = getMarketUpdateStatus();
            if (status.attempts % 10 === 0) {
                logger.info(`📈 Markt-Status: ${status.attempts} Updates, letzte: ${status.lastUpdate?.toLocaleTimeString('de-DE')}`);
            }
        } catch (err) {
            logger.error("❌ Scheduler: Markt-Update Error:", err);
        }
    }, CONFIG.MARKET_UPDATE_MS || 60000);

    // === WIRTSCHAFTS-TICK: Alle 60 Minuten ===
    logger.info("💰 Starte Economy-Tick (60min Intervall)");
    economyInterval = setInterval(async () => {
        try {
            await runEconomyTick();
            logger.info("✅ Economy-Tick abgeschlossen");
        } catch (err) {
            logger.error("❌ Economy-Tick Error:", err);
        }
    }, CONFIG.TICK_SPEED_MS || 3600000);

    // === LIQUIDATIONS-CHECK: Alle 5 Minuten ===
    logger.info("🔍 Starte Liquidation-Check (5min Intervall)");
    liquidationInterval = setInterval(async () => {
        try {
            await checkLiquidations(bot);
        } catch (err) {
            logger.error("❌ Liquidation-Check Error:", err);
        }
    }, 300000); // 5 Min

    // === RANDOM EVENTS: Alle 30 Minuten ===
    logger.info("🎲 Starte Event-System (30min Intervall)");
    eventInterval = setInterval(async () => {
        try {
            await triggerRandomMarketEvent(bot);
        } catch (err) {
            logger.error("❌ Event-Trigger Error:", err);
        }
    }, CONFIG.EVENT_CHECK_MS || 1800000);

    logger.info("✅ Alle Scheduler gestartet!");
    
    // Status-Log alle 10 Minuten
    setInterval(() => {
        const status = getMarketUpdateStatus();
        logger.debug(`🔄 System-Status - Markt: ${status.lastUpdate ? 'OK' : 'FEHLT'}, Uptime: ${process.uptime().toFixed(0)}s`);
    }, 600000); // 10 Min
}

/**
 * Stoppt alle Scheduler (für sauberes Shutdown)
 */
export function stopAllSchedulers() {
    logger.info("⏸️ Stoppe alle Scheduler...");
    
    if (marketUpdateInterval) clearInterval(marketUpdateInterval);
    if (economyInterval) clearInterval(economyInterval);
    if (liquidationInterval) clearInterval(liquidationInterval);
    if (eventInterval) clearInterval(eventInterval);
    
    logger.info("✅ Alle Scheduler gestoppt");
}

/**
 * Manueller Trigger für Markt-Update (z.B. bei Problemen)
 */
export async function forceMarketUpdate() {
    logger.info("🔄 Manueller Markt-Update getriggert...");
    try {
        await updateMarketPrices();
        logger.info("✅ Manueller Update erfolgreich");
        return true;
    } catch (err) {
        logger.error("❌ Manueller Update fehlgeschlagen:", err);
        return false;
    }
}