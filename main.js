// main.js - V0.23.5 - INLINE SCHEDULER (NO IMPORTS!)
import { Telegraf, session } from 'telegraf';
import http from 'http'; 
import { CONFIG } from './config.js';
import { logger } from './utils/logger.js';
import { handleStart } from './commands/start.js';
import { showTradeMenu, handleBuy, handleSell, initiateTradeInput, handleLeverageTrade } from './commands/trade.js';
import { showImmoMarket, handleBuyProperty, handlePropertyDetails, handleSellProperty, handleUpgradeProperty } from './commands/immo.js';
import { showWallet, showTransactionHistory } from './commands/wallet.js';
import { showCryptoWallet, showCoinDetails, quickSellFromWallet } from './commands/cryptoWallet.js';
import { showLeaderboard } from './commands/rank.js';
import { showAchievements } from './commands/achievements.js';
import { getVersion } from './utils/versionLoader.js';
import { mainKeyboard } from './ui/buttons.js';
import { updateMarketPrices, getMarketDebugInfo, getMarketUpdateStatus, invalidateCache } from './logic/market.js';

if (!CONFIG.TELEGRAM_TOKEN) {
    logger.error("BOT_TOKEN fehlt!");
    process.exit(1);
}

const bot = new Telegraf(CONFIG.TELEGRAM_TOKEN);
bot.use(session());

let isShuttingDown = false;
let server = null;

// === INLINE SCHEDULER STATE ===
let schedulerTimeouts = {
    market: null,
    ping: null
};
let schedulerRunning = false;
let pingCount = 0;

// === INLINE MARKET UPDATE LOOP ===
async function marketUpdateLoop() {
    if (!schedulerRunning || isShuttingDown) {
        logger.warn("⏹️ Market-Loop gestoppt");
        return;
    }
    
    try {
        logger.info("🔄 [SCHEDULED] Markt-Update START");
        await updateMarketPrices();
        logger.info("✅ [SCHEDULED] Markt-Update DONE");
    } catch (err) {
        logger.error(`❌ [SCHEDULED] Error: ${err.message}`);
    }
    
    // REKURSIV - nächster Call in 60s
    if (schedulerRunning && !isShuttingDown) {
        schedulerTimeouts.market = setTimeout(marketUpdateLoop, 60000);
        logger.debug("⏰ Nächster Update in 60s");
    }
}

// === INLINE PING LOOP ===
function healthPingLoop() {
    if (!schedulerRunning || isShuttingDown) {
        logger.warn("⏹️ Ping-Loop gestoppt");
        return;
    }
    
    pingCount++;
    const status = getMarketUpdateStatus();
    
    if (status.lastUpdate) {
        const ageMin = Math.floor(status.timeSinceUpdate / 60000);
        const ageSec = Math.floor((status.timeSinceUpdate % 60000) / 1000);
        logger.info(`💓 PING #${pingCount} - Update: ${ageMin}m ${ageSec}s alt`);
        
        // Auto-Recovery bei alten Daten
        if (ageMin > 5) {
            logger.error("🚨 RECOVERY: Update zu alt!");
            updateMarketPrices().catch(e => logger.error("Recovery failed:", e));
        }
    } else {
        logger.warn(`💓 PING #${pingCount} - ⚠️ NIE geupdatet!`);
    }
    
    // REKURSIV - nächster Ping in 30s
    if (schedulerRunning && !isShuttingDown) {
        schedulerTimeouts.ping = setTimeout(healthPingLoop, 30000);
    }
}

// === START SCHEDULER INLINE ===
function startScheduler() {
    if (schedulerRunning) {
        logger.warn("⚠️ Scheduler läuft bereits!");
        return;
    }
    
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    logger.info("⏰ STARTE INLINE-SCHEDULER V0.23.5");
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    
    schedulerRunning = true;
    pingCount = 0;
    
    // Start Market-Loop SOFORT
    logger.info("📊 Starte Market-Update-Loop...");
    marketUpdateLoop();
    
    // Start Ping-Loop nach 30s
    logger.info("💓 Starte Ping-Loop (30s delay)...");
    schedulerTimeouts.ping = setTimeout(healthPingLoop, 30000);
    
    logger.info("✅ SCHEDULER GESTARTET!");
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

// === STOP SCHEDULER ===
function stopScheduler() {
    logger.info("⏸️ Stoppe Scheduler...");
    schedulerRunning = false;
    
    if (schedulerTimeouts.market) {
        clearTimeout(schedulerTimeouts.market);
        schedulerTimeouts.market = null;
    }
    
    if (schedulerTimeouts.ping) {
        clearTimeout(schedulerTimeouts.ping);
        schedulerTimeouts.ping = null;
    }
    
    logger.info("✅ Scheduler gestoppt");
}

// === INTERFACE HANDLER ===
bot.use(async (ctx, next) => {
    if (isShuttingDown) return;
    if (ctx.from && !ctx.session) ctx.session = {};

    ctx.sendInterface = async (text, extra = {}) => {
        const lastId = ctx.session?.lastMessageId;
        
        if (lastId) {
            try {
                return await ctx.telegram.editMessageText(
                    ctx.chat.id, lastId, null, text, {
                        parse_mode: 'Markdown',
                        ...extra
                    }
                );
            } catch (e) {
                try {
                    await ctx.telegram.deleteMessage(ctx.chat.id, lastId).catch(() => {});
                } catch (delErr) {}
            }
        }

        try {
            const msg = await ctx.reply(text, { 
                parse_mode: 'Markdown', 
                ...extra 
            });
            ctx.session.lastMessageId = msg.message_id;
            return msg;
        } catch (e) {
            logger.error("Interface Error:", e);
        }
    };
    
    await next();
});

// === AUTO-CLEANUP ===
bot.on('text', async (ctx, next) => {
    if (isShuttingDown) return;

    try {
        await ctx.deleteMessage().catch(() => {});
    } catch (e) {}

    const menuCommands = [
        '📈 Trading Center', '💰 Mein Portfolio', 
        '🏠 Immobilien', '🏆 Bestenliste',
        '⭐ Achievements'
    ];
    
    if (ctx.message.text.startsWith('/') || menuCommands.includes(ctx.message.text)) {
        delete ctx.session.activeTrade;
        invalidateCache();
        return next();
    }

    if (!ctx.session?.activeTrade) return next();

    const amount = parseFloat(ctx.message.text.replace(',', '.'));
    const { coinId, type, leverage } = ctx.session.activeTrade;

    if (isNaN(amount) || amount <= 0) {
        const errorMsg = await ctx.reply(`🚨 Ungültige Anzahl`);
        setTimeout(() => 
            ctx.telegram.deleteMessage(ctx.chat.id, errorMsg.message_id).catch(() => {}), 
            3000
        );
        return;
    }

    if (leverage && leverage > 1) {
        await handleLeverageTrade(ctx, coinId, amount, leverage);
    } else if (type === 'buy') {
        await handleBuy(ctx, coinId, amount);
    } else if (type === 'sell') {
        await handleSell(ctx, coinId, amount);
    }
    
    delete ctx.session.activeTrade;
    invalidateCache();
});

// === ERROR HANDLING ===
bot.catch((err, ctx) => {
    if (err.description?.includes("message to delete not found") || 
        err.description?.includes("message is not modified")) return;
    
    if (err.description?.includes("409")) {
        logger.error("🚨 409 CONFLICT!");
        gracefulShutdown('409');
        return;
    }
    
    logger.error(`Error:`, err);
});

// === COMMANDS ===
bot.command('start', (ctx) => {
    if (isShuttingDown) return;
    delete ctx.session.activeTrade;
    invalidateCache();
    return handleStart(ctx);
});

// STATUS
bot.command('status', async (ctx) => {
    try {
        const marketStatus = getMarketUpdateStatus();

        let msg = `⚙️ **BOT STATUS** (V0.23.5)\n━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        msg += `**Scheduler:**\n`;
        msg += `Läuft: ${schedulerRunning ? '✅ JA' : '❌ NEIN'}\n`;
        msg += `\n`;

        msg += `**Timeouts:**\n`;
        msg += `• Markt: ${schedulerTimeouts.market !== null ? '✅' : '❌'}\n`;
        msg += `• Ping: ${schedulerTimeouts.ping !== null ? '✅' : '❌'}\n`;
        msg += `\n`;

        msg += `**Markt-Updates:**\n`;
        msg += `Gesamt: ${marketStatus.attempts}\n`;
        msg += `Failures: ${marketStatus.consecutiveFailures}\n`;
        
        if (marketStatus.lastUpdate) {
            const ageMin = Math.floor(marketStatus.timeSinceUpdate / 60000);
            const ageSec = Math.floor((marketStatus.timeSinceUpdate % 60000) / 1000);
            msg += `Letzter: ${marketStatus.lastUpdate.toLocaleTimeString('de-DE')}\n`;
            msg += `Alter: ${ageMin}min ${ageSec}s\n`;
            
            if (ageMin > 2) {
                msg += `⚠️ **PROBLEM: > 2min alt!**\n`;
            } else {
                msg += `✅ OK\n`;
            }
        } else {
            msg += `❌ **NIE erfolgreich!**\n`;
        }
        msg += `\n`;

        msg += `**Bot:**\n`;
        msg += `Version: ${getVersion()}\n`;
        msg += `Uptime: ${Math.floor(process.uptime() / 60)}min\n`;
        msg += `\n${new Date().toLocaleString('de-DE')}`;

        await ctx.reply(msg, { parse_mode: 'Markdown' });

    } catch (err) {
        logger.error("Status Error:", err);
        await ctx.reply(`❌ ${err.message}`);
    }
});

// DEBUG
bot.command('debug', async (ctx) => {
    try {
        const debugInfo = await getMarketDebugInfo();
        const status = getMarketUpdateStatus();

        let msg = `🔍 **MARKET DEBUG** (V0.23.5)\n━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        msg += `**Status:**\n`;
        msg += `Updates: ${status.attempts}\n`;
        msg += `Failures: ${status.consecutiveFailures}\n`;
        msg += `Letzter: ${status.lastUpdate ? status.lastUpdate.toLocaleString('de-DE') : 'NIE'}\n`;
        if (status.timeSinceUpdate) {
            msg += `Alter: ${Math.floor(status.timeSinceUpdate / 1000)}s\n`;
        }
        msg += `\n`;

        msg += `**Cache:**\n`;
        msg += `Aktiv: ${debugInfo.memoryCacheActive ? 'JA' : 'NEIN'}\n`;
        msg += `\n`;

        msg += `**market_cache:**\n`;
        if (debugInfo.cache && debugInfo.cache.length > 0) {
            debugInfo.cache.forEach(row => {
                const age = Math.floor((Date.now() - new Date(row.last_update).getTime()) / 1000);
                msg += `• ${row.coin_id}: ${row.price_eur}€ (${age}s alt)\n`;
            });
        } else {
            msg += `❌ LEER!\n`;
        }
        msg += `\n`;

        msg += `History: ${debugInfo.historyEntries || 0}\n`;
        msg += `${new Date().toLocaleString('de-DE')}`;

        await ctx.reply(msg, { parse_mode: 'Markdown' });

    } catch (err) {
        logger.error("Debug Error:", err);
        await ctx.reply(`❌ ${err.message}`);
    }
});

// FORCE UPDATE
bot.command('forceupdate', async (ctx) => {
    try {
        await ctx.reply("🔄 Force Update...");
        invalidateCache();
        await updateMarketPrices();
        await ctx.reply("✅ Done!");
    } catch (err) {
        logger.error("Force-Update Error:", err);
        await ctx.reply(`❌ ${err.message}`);
    }
});

// RESTART SCHEDULER
bot.command('restartscheduler', async (ctx) => {
    try {
        await ctx.reply("🔄 Restart...");
        stopScheduler();
        
        setTimeout(() => {
            startScheduler();
            ctx.reply("✅ Neu gestartet!");
        }, 2000);
    } catch (err) {
        logger.error("Restart Error:", err);
        await ctx.reply(`❌ ${err.message}`);
    }
});

bot.command('clearcache', async (ctx) => {
    try {
        invalidateCache();
        await ctx.reply("✅ Cache geleert!");
    } catch (err) {
        await ctx.reply(`❌ ${err.message}`);
    }
});

bot.hears('📈 Trading Center', (ctx) => {
    if (isShuttingDown) return;
    delete ctx.session.activeTrade;
    invalidateCache();
    return showTradeMenu(ctx);
});

bot.hears('💰 Mein Portfolio', (ctx) => {
    if (isShuttingDown) return;
    delete ctx.session.activeTrade;
    invalidateCache();
    return showWallet(ctx);
});

bot.hears('🏠 Immobilien', (ctx) => {
    if (isShuttingDown) return;
    delete ctx.session.activeTrade;
    return showImmoMarket(ctx);
});

bot.hears('🏆 Bestenliste', (ctx) => {
    if (isShuttingDown) return;
    delete ctx.session.activeTrade;
    return showLeaderboard(ctx, 'wealth');
});

bot.hears('⭐ Achievements', (ctx) => {
    if (isShuttingDown) return;
    delete ctx.session.activeTrade;
    return showAchievements(ctx);
});

// === CALLBACKS (gekürzt) ===
bot.on('callback_query', async (ctx) => {
    if (isShuttingDown) {
        await ctx.answerCbQuery("Restart...").catch(() => {});
        return;
    }

    const action = ctx.callbackQuery.data;
    
    try {
        const cacheInvalidatingActions = [
            'open_trading_center',
            'refresh_wallet',
            'port_crypto',
            'wallet_overview'
        ];
        
        if (cacheInvalidatingActions.includes(action) || action.startsWith('view_coin_')) {
            invalidateCache();
        }

        if (action === 'main_menu') {
            delete ctx.session.activeTrade;
            invalidateCache();
            await ctx.sendInterface("🏠 **Hauptmenü**", mainKeyboard);
            return ctx.answerCbQuery();
        }

        if (action === 'open_trading_center') {
            delete ctx.session.activeTrade;
            await showTradeMenu(ctx);
            return ctx.answerCbQuery();
        }
        
        if (action.startsWith('view_coin_')) {
            await showTradeMenu(ctx, action.split('_')[2]);
            return ctx.answerCbQuery();
        }

        if (action.startsWith('trade_buy_') || action.startsWith('trade_sell_')) {
            const parts = action.split('_');
            await initiateTradeInput(ctx, parts[2], parts[1]);
            return ctx.answerCbQuery();
        }

        if (action.startsWith('trade_leverage_')) {
            const { showLeverageMenu } = await import('./commands/trade.js');
            await showLeverageMenu(ctx, action.replace('trade_leverage_', ''));
            return ctx.answerCbQuery();
        }

        if (action.startsWith('set_lev_')) {
            const parts = action.split('_');
            await initiateTradeInput(ctx, parts[2], 'buy', parseInt(parts[3]));
            return ctx.answerCbQuery();
        }

        if (action === 'wallet_overview' || action === 'refresh_wallet') {
            await showCryptoWallet(ctx);
            return ctx.answerCbQuery(action === 'refresh_wallet' ? '🔄!' : '');
        }

        if (action.startsWith('wallet_coin_')) {
            await showCoinDetails(ctx, action.replace('wallet_coin_', ''));
            return ctx.answerCbQuery();
        }

        if (action.startsWith('quick_sell_')) {
            const parts = action.split('_');
            await quickSellFromWallet(ctx, parts[2], parseInt(parts[3]));
            return;
        }

        if (action.startsWith('buy_immo_')) {
            await handleBuyProperty(ctx, action.replace('buy_immo_', ''));
            return ctx.answerCbQuery();
        }

        if (action.startsWith('info_immo_')) {
            await handlePropertyDetails(ctx, action.replace('info_immo_', ''));
            return ctx.answerCbQuery();
        }

        if (action.startsWith('sell_immo_')) {
            await handleSellProperty(ctx, parseInt(action.replace('sell_immo_', '')));
            return ctx.answerCbQuery();
        }

        if (action.startsWith('upgrade_immo_')) {
            await handleUpgradeProperty(ctx, parseInt(action.replace('upgrade_immo_', '')));
            return ctx.answerCbQuery();
        }

        if (action === 'view_history') {
            await showTransactionHistory(ctx);
            return ctx.answerCbQuery();
        }

        if (action === 'port_crypto') {
            await showCryptoWallet(ctx);
            return ctx.answerCbQuery();
        }

        if (action === 'port_immo') {
            await showWallet(ctx, 'immo');
            return ctx.answerCbQuery();
        }

        if (action === 'port_all') {
            await showWallet(ctx, 'all');
            return ctx.answerCbQuery();
        }

        if (action.startsWith('rank_')) {
            await showLeaderboard(ctx, action.replace('rank_', ''));
            return ctx.answerCbQuery();
        }

        if (action === 'view_achievements') {
            await showAchievements(ctx);
            return ctx.answerCbQuery();
        }

        await ctx.answerCbQuery();
    } catch (err) {
        logger.error("Callback Error:", err);
        try {
            await ctx.answerCbQuery("❌ Fehler");
        } catch (e) {}
    }
});

// === GRACEFUL SHUTDOWN ===
async function gracefulShutdown(reason = 'unknown') {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    logger.info(`🛑 Shutdown (${reason})`);

    try {
        stopScheduler();
        await new Promise(resolve => setTimeout(resolve, 2000));
        await bot.stop(reason);
        
        if (server) {
            await new Promise((resolve) => {
                server.close(() => resolve());
            });
        }
        
        logger.info("✅ Shutdown komplett");
        process.exit(0);
    } catch (err) {
        logger.error("Shutdown Error:", err);
        process.exit(1);
    }
}

// === LAUNCH ===
async function launch() {
    try {
        logger.info("🚀 MoonShot Tycoon v0.23.5 (INLINE SCHEDULER)");
        logger.info("⏳ Warte 10s...");
        await new Promise(resolve => setTimeout(resolve, 10000));

        logger.info("📡 Starte Bot...");
        await bot.launch({
            dropPendingUpdates: true,
            allowedUpdates: ['message', 'callback_query']
        });

        logger.info("📊 Initial Marktdaten...");
        await updateMarketPrices();
        
        logger.info("⏰ Starte INLINE Scheduler...");
        startScheduler();
        
        // Check nach 30s
        setTimeout(() => {
            if (!schedulerRunning) {
                logger.error("🚨 Scheduler läuft NICHT! Retry...");
                startScheduler();
            } else {
                logger.info("✅ Scheduler-Check OK");
            }
        }, 30000);
        
        console.log(`✅ v${getVersion()} ONLINE`);
        console.log(`🔧 /status | /debug | /forceupdate`);

    } catch (err) {
        if (err.description?.includes("409")) {
            logger.error("🚨 409 - Warte 30s...");
            await new Promise(resolve => setTimeout(resolve, 30000));
            return launch();
        }
        logger.error("Launch Error:", err);
        process.exit(1);
    }
}

// === HTTP SERVER ===
const port = CONFIG.PORT || 3000;
server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(isShuttingDown ? 503 : 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: isShuttingDown ? 'shutting_down' : 'healthy',
            version: getVersion(),
            uptime: process.uptime(),
            scheduler: schedulerRunning
        }));
    } else {
        res.writeHead(200);
        res.end('MoonShot Tycoon v0.23.5');
    }
});

server.listen(port, () => {
    logger.info(`🌐 Port ${port}`);
});

// === SIGNALS ===
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
    logger.error("💥 Exception:", err);
    gracefulShutdown('exception');
});
process.on('unhandledRejection', (reason) => {
    logger.error("💥 Rejection:", reason);
    gracefulShutdown('rejection');
});

launch();
