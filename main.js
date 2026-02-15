// main.js - V0.23 - FIX für 409 Conflict + Graceful Shutdown
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
import { updateMarketPrices } from './logic/market.js';

if (!CONFIG.TELEGRAM_TOKEN) {
    logger.error("BOT_TOKEN fehlt!");
    process.exit(1);
}

const bot = new Telegraf(CONFIG.TELEGRAM_TOKEN);
bot.use(session());

// === GLOBALE STATE FÜR SHUTDOWN ===
let isShuttingDown = false;
let server = null;

// === ZENTRALER INTERFACE HANDLER ===
bot.use(async (ctx, next) => {
    if (isShuttingDown) {
        logger.warn("Bot ist im Shutdown-Modus, ignoriere neue Requests");
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
                // Nachricht existiert nicht mehr oder kann nicht editiert werden
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
            logger.error("Interface-Reply fehlgeschlagen:", e);
        }
    };
    
    await next();
});

// === AUTO-CLEANUP & HANDEL-EINGABE ===
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
        delete ctx.session.activeLeverage;
        return next();
    }

    if (!ctx.session?.activeTrade) return next();

    const amount = parseFloat(ctx.message.text.replace(',', '.'));
    const { coinId, type, leverage } = ctx.session.activeTrade;

    if (isNaN(amount) || amount <= 0) {
        const errorMsg = await ctx.reply(
            `🚨 **Fehler:** Bitte gib eine gültige Anzahl ein.`
        );
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
    delete ctx.session.activeLeverage;
});

// === ERROR HANDLING ===
bot.catch((err, ctx) => {
    if (err.description?.includes("message to delete not found") || 
        err.description?.includes("message is not modified")) return;
    
    // 409 Conflict speziell behandeln
    if (err.description?.includes("409") || err.description?.includes("Conflict")) {
        logger.error("🚨 409 CONFLICT DETECTED - Andere Bot-Instanz läuft!");
        logger.error("   → Bot wird heruntergefahren...");
        gracefulShutdown('409_conflict');
        return;
    }
    
    logger.error(`Kritischer Fehler:`, err);
});

// === BEFEHLE ===
bot.command('start', (ctx) => {
    if (isShuttingDown) return;
    delete ctx.session.activeTrade;
    return handleStart(ctx);
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

// === CALLBACK QUERIES ===
bot.on('callback_query', async (ctx) => {
    if (isShuttingDown) {
        await ctx.answerCbQuery("Bot wird neu gestartet...").catch(() => {});
        return;
    }

    const action = ctx.callbackQuery.data;
    
    try {
        // === MENU NAVIGATION ===
        if (action === 'main_menu') {
            delete ctx.session.activeTrade;
            delete ctx.session.activeLeverage;
            await ctx.sendInterface("🏠 **Hauptmenü**\nWas möchtest du tun?", mainKeyboard);
            return ctx.answerCbQuery();
        }

        // === TRADING ===
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
            const coinId = parts[2];
            const leverage = parseInt(parts[3]);
            await initiateTradeInput(ctx, coinId, 'buy', leverage);
            return ctx.answerCbQuery();
        }

        // === KRYPTO-WALLET ===
        if (action === 'wallet_overview') {
            await showCryptoWallet(ctx);
            return ctx.answerCbQuery();
        }

        // FIX: Wallet-Refresh editiert statt neu senden
        if (action === 'refresh_wallet') {
            await showCryptoWallet(ctx);
            return ctx.answerCbQuery('🔄 Aktualisiert!');
        }

        if (action.startsWith('wallet_coin_')) {
            const coinId = action.replace('wallet_coin_', '');
            await showCoinDetails(ctx, coinId);
            return ctx.answerCbQuery();
        }

        if (action.startsWith('quick_sell_')) {
            const parts = action.split('_');
            const coinId = parts[2];
            const percentage = parseInt(parts[3]);
            await quickSellFromWallet(ctx, coinId, percentage);
            return;
        }

        // === IMMOBILIEN ===
        if (action.startsWith('buy_immo_')) {
            const propId = action.replace('buy_immo_', '');
            await handleBuyProperty(ctx, propId);
            return ctx.answerCbQuery();
        }

        if (action.startsWith('info_immo_')) {
            const propId = action.replace('info_immo_', '');
            await handlePropertyDetails(ctx, propId);
            return ctx.answerCbQuery();
        }

        if (action.startsWith('sell_immo_')) {
            const assetId = parseInt(action.replace('sell_immo_', ''));
            await handleSellProperty(ctx, assetId);
            return ctx.answerCbQuery();
        }

        if (action.startsWith('upgrade_immo_')) {
            const assetId = parseInt(action.replace('upgrade_immo_', ''));
            await handleUpgradeProperty(ctx, assetId);
            return ctx.answerCbQuery();
        }

        // === PORTFOLIO ===
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

        // === LEADERBOARD ===
        if (action.startsWith('rank_')) {
            const rankType = action.replace('rank_', '');
            await showLeaderboard(ctx, rankType);
            return ctx.answerCbQuery();
        }

        // === ACHIEVEMENTS ===
        if (action === 'view_achievements') {
            await showAchievements(ctx);
            return ctx.answerCbQuery();
        }

        await ctx.answerCbQuery();
    } catch (err) {
        logger.error("Callback Error:", err);
        try {
            await ctx.answerCbQuery("❌ Ein Fehler ist aufgetreten.");
        } catch (e) {}
    }
});

// === GRACEFUL SHUTDOWN ===
async function gracefulShutdown(reason = 'unknown') {
    if (isShuttingDown) {
        logger.warn("Shutdown bereits im Gange...");
        return;
    }

    isShuttingDown = true;
    logger.info(`🛑 Graceful Shutdown initiiert (Grund: ${reason})`);

    try {
        // 1. Stoppe neue Requests
        logger.info("1️⃣ Stoppe neue Requests...");
        
        // 2. Stoppe Scheduler
        logger.info("2️⃣ Stoppe Scheduler...");
        stopAllSchedulers();
        
        // 3. Warte auf laufende Operationen
        logger.info("3️⃣ Warte auf laufende Operationen...");
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // 4. Stoppe Bot
        logger.info("4️⃣ Stoppe Telegram Bot...");
        await bot.stop(reason);
        
        // 5. Schließe Server
        if (server) {
            logger.info("5️⃣ Schließe HTTP Server...");
            await new Promise((resolve) => {
                server.close(() => {
                    logger.info("✅ Server geschlossen");
                    resolve();
                });
            });
        }
        
        logger.info("✅ Graceful Shutdown abgeschlossen");
        process.exit(0);
        
    } catch (err) {
        logger.error("❌ Fehler beim Shutdown:", err);
        process.exit(1);
    }
}

// === LAUNCH mit 409-Prevention ===
async function launch() {
    try {
        logger.info("🚀 Starte MoonShot Tycoon Bot...");
        
        // WICHTIG: Längere Wartezeit um 409 zu vermeiden
        logger.info("⏳ Warte 10 Sekunden auf Cleanup alter Instanzen...");
        await new Promise(resolve => setTimeout(resolve, 10000));

        logger.info("📡 Starte Bot mit Polling...");
        
        // Launch mit explizitem dropPendingUpdates
        await bot.launch({
            dropPendingUpdates: true,
            allowedUpdates: ['message', 'callback_query']
        });

        logger.info("📊 Lade initiale Marktdaten...");
        await updateMarketPrices().catch(e => 
            logger.error("Initial-Fetch fehlgeschlagen:", e)
        );
        
        logger.info("⏰ Starte Scheduler...");
        startGlobalScheduler(bot);
        
        logger.info(`✅ MoonShot Tycoon v${getVersion()} ONLINE`);
        logger.info(`🤖 Bot Username: @${bot.botInfo?.username || 'unknown'}`);

    } catch (err) {
        if (err.description?.includes("409") || err.description?.includes("Conflict")) {
            logger.error("🚨 409 CONFLICT beim Launch!");
            logger.error("   Eine andere Instanz läuft noch.");
            logger.error("   → Warte 30s und versuche erneut...");
            
            await new Promise(resolve => setTimeout(resolve, 30000));
            
            logger.info("🔄 Retry Launch...");
            return launch(); // Recursive retry
        }
        
        logger.error("❌ Launch Error:", err);
        process.exit(1);
    }
}

// === HTTP SERVER für Health-Checks ===
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
        res.end('MoonShot Tycoon Bot Running');
    }
});

server.listen(port, () => {
    logger.info(`🌐 HTTP Server läuft auf Port ${port}`);
});

// === SIGNAL HANDLERS ===
process.once('SIGINT', () => {
    logger.info("📡 SIGINT empfangen");
    gracefulShutdown('SIGINT');
});

process.once('SIGTERM', () => {
    logger.info("📡 SIGTERM empfangen");
    gracefulShutdown('SIGTERM');
});

process.on('uncaughtException', (err) => {
    logger.error("💥 Uncaught Exception:", err);
    gracefulShutdown('uncaught_exception');
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error("💥 Unhandled Rejection:", reason);
    gracefulShutdown('unhandled_rejection');
});

// === START ===
launch();