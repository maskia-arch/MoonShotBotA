// main.js - V1.0.0 - ValueTycoon Bot (Launcher + Push Notifications)
// Der Bot ist NUR noch Startmodul + Benachrichtigungs-Sender.
// Alle Spiellogik läuft in der Web App.
import { Telegraf, session } from 'telegraf';
import http from 'http';
import { CONFIG } from './config.js';
import { logger } from './utils/logger.js';
import { syncUser } from './supabase/queries.js';
import { getVersion } from './utils/versionLoader.js';
import { updateMarketPrices, invalidateCache, getMarketUpdateStatus, getMarketDebugInfo } from './logic/market.js';
import { startGlobalScheduler, stopAllSchedulers } from './core/scheduler.js';
import { Markup } from 'telegraf';

if (!CONFIG.TELEGRAM_TOKEN) {
    logger.error("BOT_TOKEN fehlt!");
    process.exit(1);
}

if (!CONFIG.WEBAPP_URL) {
    logger.error("WEBAPP_URL fehlt! Setze WEBAPP_URL in .env");
    process.exit(1);
}

const bot = new Telegraf(CONFIG.TELEGRAM_TOKEN);
bot.use(session());

let isShuttingDown = false;
let server = null;

// =======================================================
// === /start - User anlegen + Web App Button anzeigen ===
// =======================================================
bot.command('start', async (ctx) => {
    if (isShuttingDown) return;

    const userId = ctx.from.id;
    const firstName = ctx.from.first_name || 'Spieler';
    const username = ctx.from.username || firstName;

    try {
        await ctx.sendChatAction('typing');

        // User synchronisieren (FIX: neue syncUser-Logik)
        const userData = await syncUser(userId, username);

        if (!userData) {
            return ctx.reply("🚨 Verbindungsproblem. Versuch es gleich nochmal.");
        }

        // Prüfen ob neuer User (innerhalb letzter 15s erstellt)
        const isNewUser = Date.now() - new Date(userData.created_at).getTime() < 15000;

        if (isNewUser) {
            // Willkommensbrief
            const welcomeMsg = `
✉️ *EIN BRIEF AUS DER TOSKANA*
━━━━━━━━━━━━━━━━━━━━

Mein lieber ${firstName},

die Luft hier ist herrlich, aber mein altes Händlerherz ist unruhig. Ich habe dir *10.000 €* überwiesen.

Die Welt der Coins ist wild – pass auf, dass du nicht alles verhebelst. Wenn du klug bist, sicherst du deine Gewinne in Steinen und Mörtel.

Enttäusche mich nicht!

_Dein Onkel Willi_
━━━━━━━━━━━━━━━━━━━━
`;
            await ctx.reply(welcomeMsg, { parse_mode: 'Markdown' });
            logger.info(`🆕 Neuer Spieler: ${username} (${userId})`);
        } else {
            await ctx.reply(
                `👋 *Willkommen zurück, ${firstName}!*\n\nDer Markt wartet auf dich.`,
                { parse_mode: 'Markdown' }
            );
        }

        // Web App Button
        await ctx.reply(
            "🚀 *ValueTycoon* – Dein Krypto-Trading-Spiel\n\nÖffne das Spiel über den Button unten:",
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.webApp('🎮 Spiel öffnen', CONFIG.WEBAPP_URL)],
                    [Markup.button.callback('📊 Markt-Status', 'market_status')]
                ])
            }
        );

    } catch (err) {
        logger.error("Start-Command Error:", err);
        await ctx.reply("🚨 Verbindungsproblem. Versuch es gleich nochmal.");
    }
});

// =======================================================
// === /play - Schnellstart für Web App                ===
// =======================================================
bot.command('play', async (ctx) => {
    if (isShuttingDown) return;

    await ctx.reply(
        "🎮 *ValueTycoon öffnen:*",
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.webApp('🚀 Jetzt spielen', CONFIG.WEBAPP_URL)]
            ])
        }
    );
});

// =======================================================
// === Admin-Commands (Status, Debug, Force-Update)    ===
// =======================================================
bot.command('status', async (ctx) => {
    try {
        const marketStatus = getMarketUpdateStatus();

        let msg = `BOT STATUS V${getVersion()}\n`;
        msg += `================================\n\n`;

        msg += `Markt-Updates:\n`;
        msg += `Gesamt: ${marketStatus.attempts}\n`;
        msg += `Failures: ${marketStatus.consecutiveFailures}\n`;

        if (marketStatus.lastUpdate) {
            const ageMin = Math.floor(marketStatus.timeSinceUpdate / 60000);
            const ageSec = Math.floor((marketStatus.timeSinceUpdate % 60000) / 1000);
            msg += `Letzter: ${marketStatus.lastUpdate.toLocaleTimeString('de-DE')}\n`;
            msg += `Alter: ${ageMin}min ${ageSec}s\n`;
            msg += `STATUS: ${ageMin > 2 ? 'PROBLEM (zu alt)' : 'OK'}\n`;
        } else {
            msg += `STATUS: NIE erfolgreich\n`;
        }

        msg += `\nUptime: ${Math.floor(process.uptime() / 60)}min\n`;
        msg += `${new Date().toLocaleString('de-DE')}`;

        await ctx.reply(msg);
    } catch (err) {
        logger.error("Status Error:", err);
        await ctx.reply(`Error: ${err.message}`);
    }
});

bot.command('debug', async (ctx) => {
    try {
        const debugInfo = await getMarketDebugInfo();
        const status = getMarketUpdateStatus();

        let msg = `MARKET DEBUG V${getVersion()}\n`;
        msg += `================================\n\n`;
        msg += `Updates: ${status.attempts}\n`;
        msg += `Failures: ${status.consecutiveFailures}\n`;
        msg += `Letzter: ${status.lastUpdate ? status.lastUpdate.toLocaleString('de-DE') : 'NIE'}\n\n`;

        msg += `market_cache:\n`;
        if (debugInfo.cache && debugInfo.cache.length > 0) {
            debugInfo.cache.forEach(row => {
                const age = Math.floor((Date.now() - new Date(row.last_update).getTime()) / 1000);
                msg += `${row.coin_id}: ${row.price_eur} EUR (${age}s alt)\n`;
            });
        } else {
            msg += `LEER\n`;
        }
        msg += `\nHistorie: ${debugInfo.historyEntries || 0} Eintraege`;

        await ctx.reply(msg);
    } catch (err) {
        logger.error("Debug Error:", err);
        await ctx.reply(`Error: ${err.message}`);
    }
});

bot.command('forceupdate', async (ctx) => {
    try {
        await ctx.reply("Force Update laeuft...");
        invalidateCache();
        await updateMarketPrices();
        await ctx.reply("Done!");
    } catch (err) {
        await ctx.reply(`Error: ${err.message}`);
    }
});

// =======================================================
// === Callback-Queries                                 ===
// =======================================================
bot.on('callback_query', async (ctx) => {
    if (isShuttingDown) return;

    const action = ctx.callbackQuery.data;

    try {
        if (action === 'market_status') {
            const status = getMarketUpdateStatus();
            const msg = status.lastUpdate
                ? `📊 Letztes Update: vor ${Math.floor(status.timeSinceUpdate / 1000)}s\n✅ System läuft`
                : `⚠️ Noch kein Update`;
            await ctx.answerCbQuery(msg, { show_alert: true });
        } else {
            await ctx.answerCbQuery();
        }
    } catch (err) {
        logger.error("Callback Error:", err);
        await ctx.answerCbQuery("Fehler").catch(() => {});
    }
});

// =======================================================
// === Error Handling                                   ===
// =======================================================
bot.catch((err, ctx) => {
    if (err.description?.includes("message to delete not found") ||
        err.description?.includes("message is not modified")) return;

    if (err.description?.includes("409")) {
        logger.error("🚨 409 CONFLICT!");
        gracefulShutdown('409');
        return;
    }

    logger.error(`Bot Error:`, err);
});

// =======================================================
// === Push Notifications (export für Server-API)       ===
// =======================================================
export async function sendPushNotification(userId, message) {
    try {
        await bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
        return true;
    } catch (err) {
        logger.error(`Push an ${userId} fehlgeschlagen:`, err.message);
        return false;
    }
}

export async function broadcastMessage(message) {
    try {
        const { supabase } = await import('./supabase/client.js');
        const { data: profiles } = await supabase.from('profiles').select('id').limit(500);
        if (!profiles) return 0;

        let sent = 0;
        for (const profile of profiles) {
            const ok = await sendPushNotification(profile.id, message);
            if (ok) sent++;
        }
        return sent;
    } catch (err) {
        logger.error("Broadcast Error:", err);
        return 0;
    }
}

// =======================================================
// === Graceful Shutdown                                ===
// =======================================================
async function gracefulShutdown(reason = 'unknown') {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`Shutdown (${reason})`);

    try {
        stopAllSchedulers();
        await new Promise(resolve => setTimeout(resolve, 2000));
        await bot.stop(reason);

        if (server) {
            await new Promise((resolve) => server.close(() => resolve()));
        }

        logger.info("Shutdown komplett");
        process.exit(0);
    } catch (err) {
        logger.error("Shutdown Error:", err);
        process.exit(1);
    }
}

// =======================================================
// === Launch                                           ===
// =======================================================
async function launch() {
    try {
        logger.info(`ValueTycoon Bot V${getVersion()} (Launcher + Scheduler)`);
        logger.info("Warte 5s...");
        await new Promise(resolve => setTimeout(resolve, 5000));

        logger.info("Starte Bot...");
        await bot.launch({
            dropPendingUpdates: true,
            allowedUpdates: ['message', 'callback_query']
        });

        // FIX: Ein einziger initialer Markt-Fetch
        logger.info("Initial Marktdaten...");
        await updateMarketPrices();

        // FIX: Scheduler starten (STATT eigenem Loop in main.js)
        logger.info("Starte Scheduler...");
        startGlobalScheduler(bot);

        console.log(`ValueTycoon Bot v${getVersion()} ONLINE`);
        console.log(`Web App: ${CONFIG.WEBAPP_URL}`);
        console.log(`Commands: /start /play /status /debug /forceupdate`);

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

// =======================================================
// === HTTP Server (Health-Check + Push-API)            ===
// =======================================================
const port = CONFIG.PORT || 3000;
server = http.createServer(async (req, res) => {
    // CORS Headers für Web App
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    if (req.url === '/health') {
        res.writeHead(isShuttingDown ? 503 : 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: isShuttingDown ? 'shutting_down' : 'healthy',
            version: getVersion(),
            uptime: process.uptime()
        }));
    } else if (req.url === '/api/notify' && req.method === 'POST') {
        // Push-API für die Web App
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { userId, message } = JSON.parse(body);
                const ok = await sendPushNotification(userId, message);
                res.writeHead(ok ? 200 : 500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: ok }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
    } else {
        res.writeHead(200);
        res.end(`ValueTycoon Bot v${getVersion()}`);
    }
});

server.listen(port, () => logger.info(`HTTP Server: Port ${port}`));

// Signals
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
