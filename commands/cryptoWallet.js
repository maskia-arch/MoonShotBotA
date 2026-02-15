// commands/cryptoWallet.js - NEU für V0.21: Dedizierte Krypto-Wallet
import { supabase } from '../supabase/client.js';
import { getMarketData } from '../logic/market.js';
import { logger } from '../utils/logger.js';
import { formatCurrency, formatCrypto, formatPercent } from '../utils/formatter.js';
import { Markup } from 'telegraf';
import { CONFIG } from '../config.js';

/**
 * Zeigt die Krypto-Wallet mit allen Holdings
 */
export async function showCryptoWallet(ctx) {
    const userId = ctx.from.id;

    try {
        await ctx.sendChatAction('typing');

        // User-Kryptos laden
        const { data: cryptos, error } = await supabase
            .from('user_crypto')
            .select('*')
            .eq('user_id', userId);

        if (error) throw error;

        // Aktuelle Marktdaten
        const marketData = await getMarketData();

        if (!cryptos || cryptos.length === 0) {
            // Keine Kryptos vorhanden
            return await ctx.sendInterface(
                buildEmptyWalletMessage(marketData),
                buildMarketButtons(marketData)
            );
        }

        // Wallet mit Holdings anzeigen
        const message = buildWalletMessage(cryptos, marketData);
        const buttons = buildWalletButtons(cryptos, marketData);

        await ctx.sendInterface(message, buttons);

    } catch (err) {
        logger.error("Crypto Wallet Error:", err);
        await ctx.reply("❌ Fehler beim Laden der Wallet.");
    }
}

/**
 * Zeigt Details für einen spezifischen Coin
 */
export async function showCoinDetails(ctx, coinId) {
    const userId = ctx.from.id;

    try {
        // User-Position in diesem Coin
        const { data: position } = await supabase
            .from('user_crypto')
            .select('*')
            .eq('user_id', userId)
            .eq('coin_id', coinId)
            .maybeSingle();

        // Aktueller Marktpreis
        const marketData = await getMarketData();
        const currentPrice = marketData[coinId];

        if (!currentPrice) {
            return ctx.answerCbQuery("❌ Coin-Daten nicht verfügbar");
        }

        const message = buildCoinDetailsMessage(position, currentPrice, coinId);
        const buttons = buildCoinActionButtons(coinId, position);

        await ctx.sendInterface(message, buttons);
        await ctx.answerCbQuery();

    } catch (err) {
        logger.error("Coin Details Error:", err);
        ctx.answerCbQuery("❌ Fehler beim Laden");
    }
}

/**
 * Quick-Trade aus der Wallet (Verkauf von 25%, 50%, 100%)
 */
export async function quickSellFromWallet(ctx, coinId, percentage) {
    const userId = ctx.from.id;

    try {
        const { data: position } = await supabase
            .from('user_crypto')
            .select('*')
            .eq('user_id', userId)
            .eq('coin_id', coinId)
            .single();

        if (!position) {
            return ctx.answerCbQuery("❌ Keine Position vorhanden", { show_alert: true });
        }

        const sellAmount = position.amount * (percentage / 100);

        // Verkauf durchführen (importiere handleSell)
        const { handleSell } = await import('./trade.js');
        
        await ctx.answerCbQuery(`Verkaufe ${percentage}%...`);
        await handleSell(ctx, coinId, sellAmount);

        // Wallet neu anzeigen
        setTimeout(() => showCryptoWallet(ctx), 1000);

    } catch (err) {
        logger.error("Quick Sell Error:", err);
        ctx.answerCbQuery("❌ Verkauf fehlgeschlagen", { show_alert: true });
    }
}

// === MESSAGE BUILDER ===

function buildEmptyWalletMessage(marketData) {
    let msg = `
💼 **KRYPTO-WALLET**
━━━━━━━━━━━━━━━━━━━━

Du besitzt noch keine Kryptowährungen.

📊 **Verfügbare Coins:**
`;

    Object.keys(marketData).forEach(coinId => {
        const coin = marketData[coinId];
        const emoji = coin.change24h >= 0 ? '🟢' : '🔴';
        const trend = coin.change24h >= 0 ? '+' : '';
        
        msg += `\n${emoji} **${coinId.toUpperCase()}**\n`;
        msg += `   Preis: ${formatCurrency(coin.price)}\n`;
        msg += `   24h: ${trend}${coin.change24h.toFixed(2)}%\n`;
    });

    msg += `\n💡 _Kaufe Coins im Trading Center!_`;
    msg += `\n\n🎮 _MoonShot Tycoon v${CONFIG.VERSION}_`;

    return msg;
}

function buildWalletMessage(cryptos, marketData) {
    let totalValue = 0;
    let totalPnL = 0;

    let msg = `
💼 **KRYPTO-WALLET**
━━━━━━━━━━━━━━━━━━━━
`;

    cryptos.forEach(crypto => {
        const currentPrice = marketData[crypto.coin_id]?.price || 0;
        const currentValue = crypto.amount * currentPrice;
        const costBasis = crypto.amount * crypto.avg_buy_price;
        const pnl = currentValue - costBasis;
        const pnlPercent = crypto.avg_buy_price > 0 
            ? ((currentPrice - crypto.avg_buy_price) / crypto.avg_buy_price) * 100 
            : 0;

        totalValue += currentValue;
        totalPnL += pnl;

        const emoji = pnl >= 0 ? '📈' : '📉';
        const pnlColor = pnl >= 0 ? '🟢' : '🔴';
        const leverageTag = crypto.leverage > 1 ? ` (${crypto.leverage}x 🎰)` : '';

        msg += `\n${emoji} **${crypto.coin_id.toUpperCase()}**${leverageTag}\n`;
        msg += `   Bestand: ${formatCrypto(crypto.amount)}\n`;
        msg += `   Wert: ${formatCurrency(currentValue)}\n`;
        msg += `   Ø Kauf: ${formatCurrency(crypto.avg_buy_price)}\n`;
        msg += `   ${pnlColor} PnL: ${formatCurrency(pnl)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)\n`;

        // Liquidations-Warnung bei Hebel
        if (crypto.leverage > 1 && crypto.liquidation_price) {
            const distanceToLiq = ((currentPrice - crypto.liquidation_price) / crypto.liquidation_price) * 100;
            
            if (distanceToLiq < 10) {
                msg += `   ⚠️ **LIQUIDATION NAHE!** (${formatCurrency(crypto.liquidation_price)})\n`;
            } else if (distanceToLiq < 20) {
                msg += `   ⚡ Liq: ${formatCurrency(crypto.liquidation_price)}\n`;
            }
        }
    });

    msg += `\n━━━━━━━━━━━━━━━━━━━━`;
    msg += `\n💰 **Gesamt:** ${formatCurrency(totalValue)}`;
    
    const totalPnLEmoji = totalPnL >= 0 ? '🟢' : '🔴';
    msg += `\n${totalPnLEmoji} **Total PnL:** ${formatCurrency(totalPnL)}`;

    msg += `\n\n_Wähle einen Coin für Details & Trading_`;
    msg += `\n🎮 _MoonShot Tycoon v${CONFIG.VERSION}_`;

    return msg;
}

function buildCoinDetailsMessage(position, currentPrice, coinId) {
    const symbol = coinId.toUpperCase();
    
    let msg = `
📊 **${symbol} DETAILS**
━━━━━━━━━━━━━━━━━━━━

💹 **Markt:**
Aktueller Kurs: ${formatCurrency(currentPrice.price)}
24h Change: ${formatPercent(currentPrice.change24h)}
Letztes Update: ${new Date(currentPrice.lastUpdate).toLocaleTimeString('de-DE')}
`;

    if (position) {
        const currentValue = position.amount * currentPrice.price;
        const costBasis = position.amount * position.avg_buy_price;
        const pnl = currentValue - costBasis;
        const pnlPercent = ((currentPrice.price - position.avg_buy_price) / position.avg_buy_price) * 100;

        msg += `\n💼 **Deine Position:**\n`;
        msg += `Bestand: ${formatCrypto(position.amount)} ${symbol}\n`;
        msg += `Ø Kaufpreis: ${formatCurrency(position.avg_buy_price)}\n`;
        msg += `Aktueller Wert: ${formatCurrency(currentValue)}\n`;
        
        const pnlEmoji = pnl >= 0 ? '🟢' : '🔴';
        msg += `${pnlEmoji} PnL: ${formatCurrency(pnl)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)\n`;

        if (position.leverage > 1) {
            msg += `\n🎰 **Hebel-Position:**\n`;
            msg += `Leverage: ${position.leverage}x\n`;
            msg += `Entry: ${formatCurrency(position.entry_price)}\n`;
            msg += `Liquidation: ${formatCurrency(position.liquidation_price)}\n`;
            
            const distanceToLiq = ((currentPrice.price - position.liquidation_price) / position.liquidation_price) * 100;
            
            if (distanceToLiq < 10) {
                msg += `⚠️ **GEFAHR: Nur noch ${distanceToLiq.toFixed(1)}% bis Liquidation!**\n`;
            }
        }
    } else {
        msg += `\n💼 **Deine Position:**\nDu besitzt keinen ${symbol}\n`;
    }

    msg += `\n_Kaufe oder verkaufe direkt aus dieser Ansicht_`;

    return msg;
}

// === BUTTON BUILDER ===

function buildWalletButtons(cryptos, marketData) {
    const buttons = [];

    // Coin-Buttons (max 6 anzeigen)
    const coinButtons = cryptos.slice(0, 6).map(crypto => {
        const emoji = marketData[crypto.coin_id]?.change24h >= 0 ? '📈' : '📉';
        const leverage = crypto.leverage > 1 ? '🎰' : '';
        
        return Markup.button.callback(
            `${emoji} ${crypto.coin_id.toUpperCase()} ${leverage}`,
            `wallet_coin_${crypto.coin_id}`
        );
    });

    // 2 Buttons pro Zeile
    for (let i = 0; i < coinButtons.length; i += 2) {
        buttons.push(coinButtons.slice(i, i + 2));
    }

    // Action-Buttons
    buttons.push([
        Markup.button.callback('📈 Trading Center', 'open_trading_center'),
        Markup.button.callback('🔄 Aktualisieren', 'refresh_wallet')
    ]);

    buttons.push([
        Markup.button.callback('⬅️ Portfolio', 'port_all'),
        Markup.button.callback('🏠 Hauptmenü', 'main_menu')
    ]);

    return Markup.inlineKeyboard(buttons);
}

function buildMarketButtons(marketData) {
    const buttons = [];

    Object.keys(marketData).forEach(coinId => {
        const coin = marketData[coinId];
        const emoji = coin.change24h >= 0 ? '📈' : '📉';
        
        buttons.push([
            Markup.button.callback(
                `${emoji} ${coinId.toUpperCase()} kaufen`,
                `view_coin_${coinId}`
            )
        ]);
    });

    buttons.push([Markup.button.callback('⬅️ Zurück', 'main_menu')]);

    return Markup.inlineKeyboard(buttons);
}

function buildCoinActionButtons(coinId, position) {
    const buttons = [];

    if (position) {
        // Schnell-Verkauf Buttons
        buttons.push([
            Markup.button.callback('💸 25% verkaufen', `quick_sell_${coinId}_25`),
            Markup.button.callback('💸 50% verkaufen', `quick_sell_${coinId}_50`)
        ]);
        
        buttons.push([
            Markup.button.callback('💸 100% verkaufen', `quick_sell_${coinId}_100`)
        ]);

        if (position.leverage === 1) {
            // Nur bei nicht-Hebel-Positionen
            buttons.push([
                Markup.button.callback('🛒 Nachkaufen', `trade_buy_${coinId}`)
            ]);
        } else {
            // Hebel-Position: Nur schließen möglich
            buttons.push([
                Markup.button.callback('❌ Position schließen', `quick_sell_${coinId}_100`)
            ]);
        }
    } else {
        // Keine Position: Kaufen anbieten
        buttons.push([
            Markup.button.callback('🛒 Kaufen', `trade_buy_${coinId}`),
            Markup.button.callback('🎰 Hebel-Trade', `trade_leverage_${coinId}`)
        ]);
    }

    buttons.push([
        Markup.button.callback('⬅️ Zurück zur Wallet', 'wallet_overview')
    ]);

    return Markup.inlineKeyboard(buttons);
}