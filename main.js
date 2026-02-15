// main.js - Haupt-Bot-Datei mit erweitertem Callback-Handling
import { Telegraf, session } from 'telegraf';
import http from 'http'; 
import { CONFIG } from './config.js';
import { logger } from './utils/logger.js';
import { handleStart } from './commands/start.js';
import { showTradeMenu, handleBuy, handleSell, initiateTradeInput, handleLeverageTrade } from './commands/trade.js';
import { showImmoMarket, handleBuyProperty, handlePropertyDetails, handleSellProperty, handleUpgradeProperty } from './commands/immo.js';
import { showWallet, showTransactionHistory } from './commands/wallet.js';
import { showLeaderboard } from './commands/rank.js';
import { showAchievements } from './commands/achievements.js';
import { startGlobalScheduler } from './core/scheduler.js';
import { getVersion } from './utils/versionLoader.js';
import { mainKeyboard } from './ui/buttons.js';
import { updateMarketPrices } from './logic/market.js';

if (!CONFIG.TELEGRAM_TOKEN) {
    logger.error("BOT_TOKEN fehlt!");
    process.exit(1);
}

const bot = new Telegraf(CONFIG.TELEGRAM_TOKEN);
bot.use(session());

// === ZENTRALER INTERFACE HANDLER ===
bot.use(async (ctx, next) => {
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
            logger.error("Interface-Reply fehlgeschlagen:", e);
        }
    };
    
    await next();
});

// === AUTO-CLEANUP & HANDEL-EINGABE ===
bot.on('text', async (ctx, next) => {
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
    logger.error(`Kritischer Fehler:`, err);
});

// === BEFEHLE ===
bot.command('start', (ctx) => {
    delete ctx.session.activeTrade;
    return handleStart(ctx);
});

bot.hears('📈 Trading Center', (ctx) => {
    delete ctx.session.activeTrade;
    return showTradeMenu(ctx);
});

bot.hears('💰 Mein Portfolio', (ctx) => {
    delete ctx.session.activeTrade;
    return showWallet(ctx);
});

bot.hears('🏠 Immobilien', (ctx) => {
    delete ctx.session.activeTrade;
    return showImmoMarket(ctx);
});

bot.hears('🏆 Bestenliste', (ctx) => {
    delete ctx.session.activeTrade;
    return showLeaderboard(ctx, 'wealth');
});

bot.hears('⭐ Achievements', (ctx) => {
    delete ctx.session.activeTrade;
    return showAchievements(ctx);
});

// === CALLBACK QUERIES ===
bot.on('callback_query', async (ctx) => {
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

        if (action === 'port_crypto' || action === 'port_immo') {
            await showWallet(ctx, action.replace('port_', ''));
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

// === LAUNCH ===
async function launch() {
    try {
        logger.info("Warte auf Cleanup...");
        await new Promise(resolve => setTimeout(resolve, 5000));

        await bot.launch({
            dropPendingUpdates: true
        });

        logger.info("Lade Marktdaten...");
        await updateMarketPrices().catch(e => 
            logger.error("Erster Fetch fehlgeschlagen", e)
        );
        
        startGlobalScheduler(bot);
        console.log(`🚀 MoonShot Tycoon v${getVersion()} ONLINE`);
    } catch (err) {
        if (err.description?.includes("409: Conflict")) {
            logger.error("Konflikt: Andere Instanz läuft noch.");
            process.exit(1); 
        }
        logger.error("Launch Error:", err);
        process.exit(1);
    }
}

const port = CONFIG.PORT || 3000;
http.createServer((req, res) => { 
    res.writeHead(200); 
    res.end('MoonShot Tycoon Bot Running'); 
}).listen(port);

launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
