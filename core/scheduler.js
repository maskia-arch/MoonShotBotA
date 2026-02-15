// core/scheduler.js - Globaler Scheduler
import { updateMarketPrices } from '../logic/market.js';
import { runEconomyTick } from '../logic/economy.js';
import { checkLiquidations } from '../logic/liquidation.js';
import { triggerRandomMarketEvent } from '../logic/events.js';
import { logger } from '../utils/logger.js';
import { CONFIG } from '../config.js';

export function startGlobalScheduler(bot) {
    logger.info("⏰ Starte Scheduler...");

    // Markt-Preise alle 60 Sekunden aktualisieren
    setInterval(async () => {
        try {
            await updateMarketPrices();
            logger.debug("📊 Marktpreise aktualisiert");
        } catch (err) {
            logger.error("Markt-Update Fehler:", err);
        }
    }, CONFIG.MARKET_UPDATE_MS);

    // Wirtschafts-Tick alle 60 Minuten
    setInterval(async () => {
        try {
            await runEconomyTick();
            logger.info("💰 Economy-Tick abgeschlossen");
        } catch (err) {
            logger.error("Economy-Tick Fehler:", err);
        }
    }, CONFIG.TICK_SPEED_MS);

    // Liquidations-Check alle 5 Minuten
    setInterval(async () => {
        try {
            await checkLiquidations(bot);
            logger.debug("🔍 Liquidations gecheckt");
        } catch (err) {
            logger.error("Liquidation-Check Fehler:", err);
        }
    }, 300000); // 5 Min

    // Zufalls-Events alle 30 Minuten
    setInterval(async () => {
        try {
            await triggerRandomMarketEvent(bot);
        } catch (err) {
            logger.error("Event-Trigger Fehler:", err);
        }
    }, CONFIG.EVENT_CHECK_MS);

    logger.info("✅ Scheduler gestartet!");
}
