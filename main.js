// main.js - V0.23.1 - MIT DEBUG-COMMAND
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
import { startGlobalScheduler, stopAllSchedulers } from './core/scheduler.js';
import { getVersion } from './utils/versionLoader.js';
import { mainKeyboard } from './ui/buttons.js';
import { updateMarketPrices, getMarketDebugInfo, getMarketUpdateStatus } from './logic/market.js';

if (!CONFIG.TELEGRAM_TOKEN) {
    logger.error("BOT_TOKEN fehlt!");
    process.exit(1);
}

const bot = new Telegraf(CONFIG.TELEGRAM_TOKEN);
bot.use(session());

let isShuttingDown = false;
let server = null;

// === INTERFACE HANDLER ===
bot.use(async (ctx, next) => {
    if (isShuttingDown) {
        logger.warn("Bot ist im Shutdown-Modus");
        return;
    }

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
            logger.error("Interface-Reply Error:", e);
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
        '⭐ Achievements', '⚙️ Einstellungen'
    ];
    
    if (ctx.message.text.startsWith('/') || menuCommands.includes(ctx.message.text)) {
        delete ctx.session.activeTrade;
        return next();
    }

    if (!ctx.session?.activeTrade) return next();

    const amount = parseFloat(ctx.message.text.replace(',', '.'));
    const { coinId, type, leverage } = ctx.session.activeTrade;

    if (isNaN(amount) || amount <= 0) {
        const errorMsg = await ctx.reply(`🚨 **Fehler:** Bitte gib eine gültige Anzahl ein.`);
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
});

// === ERROR HANDLING ===
bot.catch((err, ctx) => {
    if (err.description?.includes("message to delete not found") || 
        err.description?.includes("message is not modified")) return;
    
    if (err.description?.includes("409") || err.description?.includes("Conflict")) {
        logger.error("🚨 409 CONFLICT!");
        gracefulShutdown('409_conflict');
        return;
    }
    
    logger.error(`Error:`, err);
});

// === BEFEHLE ===
bot.command('start', (ctx) => {
    if (isShuttingDown) return;
    delete ctx.session.activeTrade;
    return handleStart(ctx);
});

// NEU: DEBUG-COMMAND (nur für Admins/Entwickler)
bot.command('debug', async (ctx) => {
    try {
        logger.info(`Debug-Command von User ${ctx.from.id}`);
        
        // Optional: Nur bestimmte User erlauben
        // const ADMIN_IDS = [123456789]; // Deine Telegram-ID
        // if (!ADMIN_IDS.includes(ctx.from.id)) {
        //     return ctx.reply("⛔ Kein Zugriff");
        // }

        await ctx.sendChatAction('typing');

        const debugInfo = await getMarketDebugInfo();
        const status = getMarketUpdateStatus();

        let msg = `🔍 **MARKET DEBUG INFO**\n━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        msg += `**Status:**\n`;
        msg += `Updates: ${status.attempts}\n`;
        msg += `Failures: ${status.consecutiveFailures}\n`;
        msg += `Letzter Erfolg: ${status.lastUpdate ? status.lastUpdate.toLocaleString('de-DE') : 'NIE'}\n`;
        if (status.timeSinceUpdate) {
            msg += `Alter: ${Math.floor(status.timeSinceUpdate / 1000)}s\n`;
        }
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

        msg += `**price_history:**\n`;
        msg += `Einträge: ${debugInfo.historyEntries || 0}\n`;
        msg += `\n`;

        msg += `**Bot:**\n`;
        msg += `Version: ${getVersion()}\n`;
        msg += `Uptime: ${Math.floor(process.uptime())}s\n`;
        msg += `Memory: ${Math.floor(process.memoryUsage().heapUsed / 1024 / 1024)}MB\n`;
        msg += `\n`;

        msg += `**Timestamp:**\n${new Date().toLocaleString('de-DE')}\n`;
        msg += `\n━━━━━━━━━━━━━━━━━━━━`;

        await ctx.reply(msg, { parse_mode: 'Markdown' });

    } catch (err) {
        logger.error("Debug-Command Error:", err);
        await ctx.reply(`❌ Debug Error: ${err.message}`);
    }
});

// NEU: FORCE UPDATE COMMAND
bot.command('forceupdate', async (ctx) => {
    try {
        logger.info(`Force-Update von User ${ctx.from.id}`);
        
        await ctx.reply("🔄 Force Update läuft...");
        await updateMarketPrices();
        await ctx.reply("✅ Update abgeschlossen! Nutze /debug für Details.");
        
    } catch (err) {
        logger.error("Force-Update Error:", err);
        await ctx.reply(`❌ Update Error: ${err.message}`);
    }
});

bot.hears('📈 Trading Center', (ctx) => {
    if (isShuttingDown) return;
    delete ctx.session.activeTrade;
    return showTradeMenu(ctx);
});

bot.hears('💰 Mein Portfolio', (ctx) => {
    if (isShuttingDown) return;
    delete ctx.session.activeTrade;
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

// === CALLBACKS (wie vorher) ===
bot.on('callback_query', async (ctx) => {
    if (isShuttingDown) {
        await ctx.answerCbQuery("Bot wird neu gestartet...").catch(() => {});
        return;
    }

    const action = ctx.callbackQuery.data;
    
    try {
        if (action === 'main_menu') {
            delete ctx.session.activeTrade;
            await ctx.sendInterface("🏠 **Hauptmenü**", mainKeyboard);
            return ctx.answerCbQuery();
        }

        if (action === 'open_trading_center') {
            delete ctx.session.activeTrade;
            await showTradeMenu(ctx);
            return ctx.answerCbQuery();
        }
        
        if (action.startsWith('view_coin_')) {
            const coinId = action.split('_')[2];
            await showTradeMenu(ctx, coinId);
            return ctx.answerCbQuery();
        }

        if (action.startsWith('trade_buy_') || action.startsWith('trade_sell_')) {
            const parts = action.split('_');
            await initiateTradeInput(ctx, parts[2], parts[1]);
            return ctx.answerCbQuery();
        }

        if (action.startsWith('trade_leverage_')) {
            const coinId = action.replace('trade_leverage_', '');
            const { showLeverageMenu } = await import('./commands/trade.js');
            await showLeverageMenu(ctx, coinId);
            return ctx.answerCbQuery();
        }

        if (action.startsWith('set_lev_')) {
            const parts = action.split('_');
            await initiateTradeInput(ctx, parts[2], 'buy', parseInt(parts[3]));
            return ctx.answerCbQuery();
        }

        if (action === 'wallet_overview' || action === 'refresh_wallet') {
            await showCryptoWallet(ctx);
            return ctx.answerCbQuery(action === 'refresh_wallet' ? '🔄 Aktualisiert!' : '');
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
        stopAllSchedulers();
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
        logger.info("🚀 Starte MoonShot Tycoon v0.23.1...");
        logger.info("⏳ Warte 10s auf Cleanup...");
        await new Promise(resolve => setTimeout(resolve, 10000));

        await bot.launch({
            dropPendingUpdates: true,
            allowedUpdates: ['message', 'callback_query']
        });

        logger.info("📊 Lade Marktdaten...");
        await updateMarketPrices();
        
        startGlobalScheduler(bot);
        
        console.log(`✅ MoonShot Tycoon v${getVersion()} ONLINE`);
        console.log(`🤖 Bot: @${bot.botInfo?.username || 'unknown'}`);
        console.log(`💡 Debug: /debug | Force Update: /forceupdate`);

    } catch (err) {
        if (err.description?.includes("409")) {
            logger.error("🚨 409 CONFLICT - Warte 30s...");
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
            uptime: process.uptime()
        }));
    } else {
        res.writeHead(200);
        res.end('MoonShot Tycoon Bot v0.23.1');
    }
});

server.listen(port, () => {
    logger.info(`🌐 HTTP Server: Port ${port}`);
});

// === SIGNALS ===
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
    logger.error("💥 Uncaught Exception:", err);
    gracefulShutdown('exception');
});
process.on('unhandledRejection', (reason) => {
    logger.error("💥 Unhandled Rejection:", reason);
    gracefulShutdown('rejection');
});

launch();
