// commands/wallet.js - V0.23 - MIT ZURÜCK-BUTTON
import { supabase } from '../supabase/client.js';
import { getMarketData } from '../logic/market.js';
import { logger } from '../utils/logger.js';
import { formatCurrency, formatCrypto } from '../utils/formatter.js';
import { Markup } from 'telegraf';
import { CONFIG } from '../config.js';

/**
 * Zeigt Portfolio-Übersicht
 */
export async function showWallet(ctx, filter = 'all') {
    const userId = ctx.from.id;

    try {
        await ctx.sendChatAction('typing');

        const { data: user } = await supabase
            .from('profiles')
            .select('balance, trading_volume')
            .eq('id', userId)
            .single();

        const { data: cryptos } = await supabase
            .from('user_crypto')
            .select('*')
            .eq('user_id', userId);

        const { data: properties } = await supabase
            .from('user_assets')
            .select('*')
            .eq('user_id', userId)
            .eq('asset_type', 'property');

        const marketData = await getMarketData();

        // Krypto-Wert berechnen
        let cryptoValue = 0;
        if (cryptos && cryptos.length > 0) {
            cryptos.forEach(c => {
                const price = marketData[c.coin_id]?.price || 0;
                cryptoValue += c.amount * price;
            });
        }

        // Immobilien-Wert
        let propertyValue = 0;
        if (properties && properties.length > 0) {
            properties.forEach(p => {
                const prop = CONFIG.PROPERTY_TYPES.find(pt => pt.id === p.property_id);
                if (prop) propertyValue += prop.price;
            });
        }

        const totalWealth = user.balance + cryptoValue + propertyValue;

        let msg = `
💼 **MEIN PORTFOLIO**
━━━━━━━━━━━━━━━━━━━━

💶 **Bargeld:** ${formatCurrency(user.balance)}
📊 **Kryptos:** ${formatCurrency(cryptoValue)}
🏠 **Immobilien:** ${formatCurrency(propertyValue)}
━━━━━━━━━━━━━━━━━━━━
💰 **Gesamt:** ${formatCurrency(totalWealth)}

📈 Trading-Volumen: ${formatCurrency(user.trading_volume)}
`;

        // Filter-spezifische Info
        if (filter === 'crypto' && cryptos && cryptos.length > 0) {
            msg += `\n📊 **Krypto-Holdings:**\n`;
            cryptos.forEach(c => {
                const value = c.amount * (marketData[c.coin_id]?.price || 0);
                msg += `• ${c.coin_id.toUpperCase()}: ${formatCurrency(value)}\n`;
            });
        }

        if (filter === 'immo' && properties && properties.length > 0) {
            msg += `\n🏠 **Immobilien-Besitz:**\n`;
            properties.forEach(p => {
                const prop = CONFIG.PROPERTY_TYPES.find(pt => pt.id === p.property_id);
                if (prop) {
                    msg += `• ${prop.name}: ${p.condition}% Zustand\n`;
                }
            });
        }

        msg += `\n_Wähle eine Kategorie zur Detailansicht_`;
        msg += `\n🎮 _MoonShot Tycoon v${CONFIG.VERSION}_`;

        const buttons = buildPortfolioButtons();
        await ctx.sendInterface(msg, buttons);

    } catch (err) {
        logger.error("Wallet Error:", err);
        await ctx.reply("❌ Fehler beim Laden des Portfolios.");
    }
}

/**
 * Zeigt Transaktionsverlauf mit ZURÜCK-BUTTON
 */
export async function showTransactionHistory(ctx) {
    const userId = ctx.from.id;

    try {
        await ctx.sendChatAction('typing');

        const { data: transactions, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) throw error;

        if (!transactions || transactions.length === 0) {
            return await ctx.sendInterface(
                `📜 **TRANSAKTIONSVERLAUF**\n━━━━━━━━━━━━━━━━━━━━\n\nNoch keine Transaktionen vorhanden.\n\n_Starte mit Trading oder Immobilien!_`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('⬅️ Zurück zum Portfolio', 'port_all')]
                ])
            );
        }

        let msg = `📜 **TRANSAKTIONSVERLAUF**\n━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `_Letzte ${transactions.length} Transaktionen_\n\n`;

        transactions.forEach((tx, idx) => {
            const date = new Date(tx.created_at).toLocaleDateString('de-DE', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });

            let emoji = '•';
            if (tx.type.includes('buy')) emoji = '🛒';
            else if (tx.type.includes('sell')) emoji = '💰';
            else if (tx.type.includes('rent')) emoji = '🏠';
            else if (tx.type.includes('maintenance')) emoji = '🔧';

            msg += `${emoji} **${tx.description}**\n`;
            msg += `   ${formatCurrency(Math.abs(tx.amount))} • ${date}\n`;
            
            if (idx < transactions.length - 1) {
                msg += `\n`;
            }
        });

        msg += `\n━━━━━━━━━━━━━━━━━━━━`;
        msg += `\n_Zeigt max. 20 Einträge_`;

        // WICHTIG: Zurück-Button!
        const buttons = Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Aktualisieren', 'view_history')],
            [Markup.button.callback('⬅️ Zurück zum Portfolio', 'port_all')]
        ]);

        await ctx.sendInterface(msg, buttons);

    } catch (err) {
        logger.error("Transaction History Error:", err);
        await ctx.reply("❌ Fehler beim Laden der Transaktionen.");
    }
}

function buildPortfolioButtons() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('📊 Kryptos', 'port_crypto'),
            Markup.button.callback('🏠 Immobilien', 'port_immo')
        ],
        [
            Markup.button.callback('📜 Transaktionen', 'view_history'),
            Markup.button.callback('🔄 Aktualisieren', 'port_all')
        ],
        [
            Markup.button.callback('🏠 Hauptmenü', 'main_menu')
        ]
    ]);
}