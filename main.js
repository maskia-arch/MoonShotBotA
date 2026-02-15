// main.js - V0.23.6 - SUPER SIMPLE AUTO-UPDATE
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

// === SUPER SIMPLE AUTO-UPDATE STATE ===
let autoUpdateRunning = false;
let autoUpdateCount = 0;

// === AUTO-UPDATE LOOP (60s) ===
async function autoUpdateLoop() {
    if (!autoUpdateRunning || isShuttingDown) {
        logger.info("⏹️ Auto-Update gestoppt");
        return;
    }
    
    try {
        autoUpdateCount++;
        logger.info(`🔄 [AUTO-UPDATE #${autoUpdateCount}] START`);
        
        // Das gleiche wie /forceupdate!
        invalidateCache();
        await updateMarketPrices();
        
        logger.info(`✅ [AUTO-UPDATE #${autoUpdateCount}] DONE`);
    } catch (err) {
        logger.error(`❌ [AUTO-UPDATE #${autoUpdateCount}] Error: ${err.message}`);
    }
    
    // REKURSIV - nächster Update in 60s
    if (autoUpdateRunning && !isShuttingDown) {
        setTimeout(autoUpdateLoop, 60000); // 60 Sekunden
        logger.debug(`⏰ Nächster Auto-Update in 60s`);
    }
}

// === START AUTO-UPDATE ===
function startAutoUpdate() {
    if (autoUpdateRunning) {
        logger.warn("⚠️ Auto-Update läuft bereits!");
        return;
    }
    
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    logger.info("⏰ STARTE AUTO-UPDATE V0.23.6");
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    
    autoUpdateRunning = true;
    autoUpdateCount = 0;
    
    // Start SOFORT
    logger.info("🚀 Starte Auto-Update-Loop (60s interval)...");
    autoUpdateLoop();
    
    logger.info("✅ AUTO-UPDATE GESTARTET!");
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

// === STOP AUTO-UPDATE ===
function stopAutoUpdate() {
    logger.info("⏸️ Stoppe Auto-Update...");
    autoUpdateRunning = false;
    logger.info("✅ Auto-Update gestoppt");
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

// STATUS (FIX: Kein Markdown für Emojis!)
bot.command('status', async (ctx) => {
    try {
        const marketStatus = getMarketUpdateStatus();

        let msg = `BOT STATUS V0.23.6\n`;
        msg += `================================\n\n`;
        
        msg += `Auto-Update:\n`;
        msg += `Status: ${autoUpdateRunning ? 'AKTIV' : 'INAKTIV'}\n`;
        msg += `Count: ${autoUpdateCount}\n`;
        msg += `\n`;

        msg += `Markt-Updates:\n`;
        msg += `Gesamt: ${marketStatus.attempts}\n`;
        msg += `Failures: ${marketStatus.consecutiveFailures}\n`;
        
        if (marketStatus.lastUpdate) {
            const ageMin = Math.floor(marketStatus.timeSinceUpdate / 60000);
            const ageSec = Math.floor((marketStatus.timeSinceUpdate % 60000) / 1000);
            msg += `Letzter: ${marketStatus.lastUpdate.toLocaleTimeString('de-DE')}\n`;
            msg += `Alter: ${ageMin}min ${ageSec}s\n`;
            
            if (ageMin > 2) {
                msg += `STATUS: PROBLEM (zu alt)\n`;
            } else {
                msg += `STATUS: OK\n`;
            }
        } else {
            msg += `STATUS: NIE erfolgreich\n`;
        }
        msg += `\n`;

        msg += `Bot:\n`;
        msg += `Version: ${getVersion()}\n`;
        msg += `Uptime: ${Math.floor(process.uptime() / 60)}min\n`;
        msg += `\n${new Date().toLocaleString('de-DE')}`;

        // KEIN parse_mode!
        await ctx.reply(msg);

    } catch (err) {
        logger.error("Status Error:", err);
        await ctx.reply(`Error: ${err.message}`);
    }
});

// DEBUG (FIX: Kein Markdown!)
bot.command('debug', async (ctx) => {
    try {
        const debugInfo = await getMarketDebugInfo();
        const status = getMarketUpdateStatus();

        let msg = `MARKET DEBUG V0.23.6\n`;
        msg += `================================\n\n`;
        
        msg += `Status:\n`;
        msg += `Updates: ${status.attempts}\n`;
        msg += `Failures: ${status.consecutiveFailures}\n`;
        msg += `Letzter: ${status.lastUpdate ? status.lastUpdate.toLocaleString('de-DE') : 'NIE'}\n`;
        if (status.timeSinceUpdate) {
            msg += `Alter: ${Math.floor(status.timeSinceUpdate / 1000)}s\n`;
        }
        msg += `\n`;

        msg += `Cache:\n`;
        msg += `Aktiv: ${debugInfo.memoryCacheActive ? 'JA' : 'NEIN'}\n`;
        msg += `\n`;

        msg += `market_cache:\n`;
        if (debugInfo.cache && debugInfo.cache.length > 0) {
            debugInfo.cache.forEach(row => {
                const age = Math.floor((Date.now() - new Date(row.last_update).getTime()) / 1000);
                msg += `${row.coin_id}: ${row.price_eur} EUR (${age}s alt)\n`;
            });
        } else {
            msg += `LEER\n`;
        }
        msg += `\n`;

        msg += `History: ${debugInfo.historyEntries || 0} Eintraege\n`;
        msg += `\n${new Date().toLocaleString('de-DE')}`;

        // KEIN parse_mode!
        await ctx.reply(msg);

    } catch (err) {
        logger.error("Debug Error:", err);
        await ctx.reply(`Error: ${err.message}`);
    }
});

// FORCE UPDATE
bot.command('forceupdate', async (ctx) => {
    try {
        await ctx.reply("Force Update laeuft...");
        invalidateCache();
        await updateMarketPrices();
        await ctx.reply("Done!");
    } catch (err) {
        logger.error("Force-Update Error:", err);
        await ctx.reply(`Error: ${err.message}`);
    }
});

// RESTART AUTO-UPDATE
bot.command('restart', async (ctx) => {
    try {
        await ctx.reply("Restart Auto-Update...");
        stopAutoUpdate();
        
        setTimeout(() => {
            startAutoUpdate();
            ctx.reply("Neu gestartet!");
        }, 2000);
    } catch (err) {
        logger.error("Restart Error:", err);
        await ctx.reply(`Error: ${err.message}`);
    }
});

bot.command('clearcache', async (ctx) => {
    try {
        invalidateCache();
        await ctx.reply("Cache geleert!");
    } catch (err) {
        await ctx.reply(`Error: ${err.message}`);
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

// === CALLBACKS (gekürzt - wie vorher) ===
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
            await ctx.sendInterface("Hauptmenue", mainKeyboard);
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
            return ctx.answerCbQuery(action === 'refresh_wallet' ? 'Aktualisiert!' : '');
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
            await ctx.answerCbQuery("Fehler");
        } catch (e) {}
    }
});

// === GRACEFUL SHUTDOWN ===
async function gracefulShutdown(reason = 'unknown') {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    logger.info(`Shutdown (${reason})`);

    try {
        stopAutoUpdate();
        await new Promise(resolve => setTimeout(resolve, 2000));
        await bot.stop(reason);
        
        if (server) {
            await new Promise((resolve) => {
                server.close(() => resolve());
            });
        }
        
        logger.info("Shutdown komplett");
        process.exit(0);
    } catch (err) {
        logger.error("Shutdown Error:", err);
        process.exit(1);
    }
}

// === LAUNCH ===
async function launch() {
    try {
        logger.info("MoonShot Tycoon v0.23.6 (SUPER SIMPLE AUTO-UPDATE)");
        logger.info("Warte 10s...");
        await new Promise(resolve => setTimeout(resolve, 10000));

        logger.info("Starte Bot...");
        await bot.launch({
            dropPendingUpdates: true,
            allowedUpdates: ['message', 'callback_query']
        });

        logger.info("Initial Marktdaten...");
        await updateMarketPrices();
        
        logger.info("Starte Auto-Update (60s)...");
        startAutoUpdate();
        
        console.log(`v${getVersion()} ONLINE`);
        console.log(`Commands: /status /debug /forceupdate /restart`);

    } catch (err) {
        if (err.description?.includes("409")) {
            logger.error("409 - Warte 30s...");
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
            autoUpdate: autoUpdateRunning
        }));
    } else {
        res.writeHead(200);
        res.end('MoonShot Tycoon v0.23.6');
    }
});

server.listen(port, () => {
    logger.info(`HTTP Server: Port ${port}`);
});

// === SIGNALS ===
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
    logger.error("Exception:", err);
    gracefulShutdown('exception');
});
process.on('unhandledRejection', (reason) => {
    logger.error("Rejection:", reason);
    gracefulShutdown('rejection');
});

launch();
