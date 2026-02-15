// commands/start.js - Erweiterter Start mit Tutorial-Elementen
import { syncUser } from '../supabase/queries.js';
import { uncleLetterLayout } from '../ui/layouts.js';
import { mainKeyboard } from '../ui/buttons.js';
import { logger } from '../utils/logger.js';

/**
 * Verarbeitet den /start Befehl.
 * Erstellt User-Account und zeigt Onkel Willi's Brief.
 */
export async function handleStart(ctx) {
    const userId = ctx.from.id;
    const firstName = ctx.from.first_name || 'Hustler';
    const username = ctx.from.username || firstName;

    try {
        try {
            await ctx.deleteMessage().catch(() => {});
        } catch (e) {}

        await ctx.sendChatAction('typing');

        // User synchronisieren
        const userData = await syncUser(userId, username);

        if (!userData) {
            throw new Error("User-Synchronisierung fehlgeschlagen");
        }

        // Prüfen ob neuer User
        const isNewUser = new Date() - new Date(userData.created_at) < 15000;

        if (isNewUser) {
            // === NEUER SPIELER ===
            const welcomeMessage = uncleLetterLayout(firstName);

            const sentMsg = await ctx.reply(welcomeMessage, {
                parse_mode: 'Markdown'
            });

            // Brief pinnen
            try {
                await ctx.pinChatMessage(sentMsg.message_id);
            } catch (e) {
                logger.debug("Pinnen fehlgeschlagen: " + e.message);
            }

            // Tutorial-Text
            const tutorial = `
🚀 **Willkommen bei MoonShot Tycoon!**

**Deine Mission:**
1. 💶 Starte mit 10.000 € Startkapital
2. 📈 Trade Kryptowährungen (Bitcoin, Litecoin, Ethereum)
3. 🎰 Nutze Hebel für höhere Gewinne (aber auch Risiken!)
4. 🏠 Kaufe Immobilien (erst ab 30.000 € Handelsvolumen)
5. 👑 Werde Millionär und dominiere die Rangliste!

**Wichtige Features:**
• ⚡ Echte Live-Kurse alle 60 Sekunden
• 🎯 Achievements freischalten = Extra-Geld
• 📊 Miet-Einnahmen alle 24h
• 🛠️ Immobilien benötigen Wartung
• 🏆 Season-Ranglisten mit Preisgeldern

**Erste Schritte:**
Nutze die Buttons unten um:
• Trading Center → Coins kaufen/verkaufen
• Immobilien → Ab 30k Volumen verfügbar
• Portfolio → Dein Vermögen checken

Viel Erfolg! 🚀
`;
            
            await ctx.sendInterface(tutorial, mainKeyboard);

            logger.info(`Neuer Spieler: ${username} (${userId})`);

        } else {
            // === RÜCKKEHRER ===
            const welcomeBack = `
👋 **Willkommen zurück, ${firstName}!**

Der Markt wartet auf dich. Was ist dein nächster Move?

💡 *Tipp: Check dein Portfolio und die aktuellen Kurse!*
`;
            
            await ctx.sendInterface(welcomeBack, mainKeyboard);
        }

    } catch (err) {
        logger.error("Fehler im Start-Command:", err);
        await ctx.reply(
            "🚨 Verbindungsproblem. Versuch es gleich nochmal."
        );
    }
}

/**
 * Zeigt eine Hilfe-Nachricht mit allen verfügbaren Befehlen
 */
export async function showHelp(ctx) {
    const helpText = `
📚 **MoonShot Tycoon - Hilfe**

**Haupt-Features:**
📈 Trading Center - Kryptos handeln
🏠 Immobilien - Objekte kaufen & verwalten
💰 Portfolio - Vermögensübersicht
🏆 Bestenliste - Top Spieler
⭐ Achievements - Belohnungen freischalten

**Trading:**
• Kaufen/Verkaufen von BTC, LTC, ETH
• Hebel: 2x bis 50x (Achtung: Liquidationsrisiko!)
• Gebühr: 0,5% pro Trade
• Anti-Wash-Trading: Mindestens 1h halten

**Immobilien:**
• Verfügbar ab 30.000 € Handelsvolumen
• 6 Immobilien-Typen (15k bis 10M)
• Miet-Einnahmen alle 24h
• Wartungskosten & Zustandsystem
• Verkaufen für 80% des Kaufpreises

**Rangliste:**
• Reichste Spieler
• Höchster Profit
• Größter Verlust (Wall of Shame)
• Season-Preise am Monatsende

**Tipps:**
💡 Diversifiziere dein Portfolio
💡 Immobilien = passives Einkommen
💡 Hohe Hebel = hohes Risiko
💡 Achievements geben Bonus-Geld

Viel Erfolg! 🚀
`;
    
    await ctx.sendInterface(helpText, mainKeyboard);
}
