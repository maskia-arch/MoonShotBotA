// commands/trade.js - Erweiterte Trading-Funktionen mit Hebel
import { getMarketData, getCoinPrice } from '../logic/market.js';
import { supabase } from '../supabase/client.js';
import { tradingViewLayout, leverageWarningLayout, divider } from '../ui/layouts.js';
import { coinListButtons, coinActionButtons, leverageButtons } from '../ui/buttons.js';
import { logger } from '../utils/logger.js';
import { logTransaction, checkAndAwardAchievement } from '../supabase/queries.js';
import { getTradeCalculations, calculateTrade, isTradeEligibleForVolume } from '../logic/tradeLogic.js';
import { formatCurrency, formatCrypto } from '../utils/formatter.js';
import { Markup } from 'telegraf';
import { CONFIG } from '../config.js';

/**
 * Zeigt Trading-Center: Coin-Liste oder Detail-Ansicht
 */
export async function showTradeMenu(ctx, coinId = null) {
    const userId = ctx.from.id;

    try {
        const marketData = await getMarketData();
        
        if (!marketData || Object.keys(marketData).length === 0) {
            return await ctx.sendInterface(
                "⏳ Märkte werden synchronisiert... Einen Moment bitte."
            );
        }

        if (!coinId) {
            // === COIN-LISTE ===
            let listMsg = `📊 **Live-Marktübersicht (24h)**\n${divider}\n`;
            
            Object.keys(marketData).forEach(id => {
                const c = marketData[id];
                const emoji = c.change24h >= 0 ? '🟢' : '🔴';
                const trend = c.change24h >= 0 ? '+' : '';
                listMsg += `${emoji} **${id.toUpperCase()}**: \`${formatCurrency(c.price)}\` (${trend}${c.change24h.toFixed(2)}%)\n`;
            });
            
            listMsg += `\n_Wähle einen Coin für Details und Trading._`;
            return await ctx.sendInterface(listMsg, coinListButtons(marketData));
        }

        // === COIN-DETAILS ===
        const coin = marketData[coinId.toLowerCase()];
        if (!coin) {
            return ctx.answerCbQuery(`❌ ${coinId.toUpperCase()} nicht verfügbar.`);
        }

        const { data: user, error: userError } = await supabase
            .from('profiles')
            .select('balance')
            .eq('id', userId)
            .single();
            
        if (userError) throw userError;

        const detailMsg = tradingViewLayout({
            symbol: coinId,
            price: coin.price,
            change24h: coin.change24h
        }, user.balance);

        await ctx.sendInterface(detailMsg, coinActionButtons(coinId));

    } catch (err) {
        logger.error(`Trade-System Fehler:`, err);
        if (ctx.callbackQuery) {
            ctx.answerCbQuery("🚨 Fehler beim Laden der Marktdaten.");
        }
    }
}

/**
 * Zeigt Hebel-Auswahl für riskante Trades
 */
export async function showLeverageMenu(ctx, coinId) {
    const userId = ctx.from.id;
    
    try {
        const coin = await getCoinPrice(coinId);
        const { data: user } = await supabase
            .from('profiles')
            .select('balance')
            .eq('id', userId)
            .single();

        const warningMsg = leverageWarningLayout(coinId, coin.price, user.balance);
        
        await ctx.sendInterface(warningMsg, leverageButtons(coinId));
    } catch (err) {
        logger.error("Hebel-Menü Fehler:", err);
        ctx.answerCbQuery("❌ Fehler beim Laden des Hebel-Menüs.");
    }
}

/**
 * Startet den Eingabe-Modus für normalen Trade oder Hebel-Trade
 */
export async function initiateTradeInput(ctx, coinId, type, leverage = 1) {
    const userId = ctx.from.id;
    
    try {
        const marketData = await getMarketData();
        const coin = marketData[coinId.toLowerCase()];
        
        if (!coin) throw new Error("Coin-Daten fehlen");

        const { data: user } = await supabase
            .from('profiles')
            .select('balance')
            .eq('id', userId)
            .single();
            
        const { data: asset } = await supabase
            .from('user_crypto')
            .select('amount')
            .eq('user_id', userId)
            .eq('coin_id', coinId.toLowerCase())
            .maybeSingle();

        const userHoldings = asset ? asset.amount : 0;
        const { maxBuy, maxSell } = getTradeCalculations(
            user.balance, 
            coin.price, 
            userHoldings
        );

        ctx.session.activeTrade = { 
            coinId: coinId.toLowerCase(), 
            type,
            leverage: leverage || 1
        };

        let actionTitle, limitInfo;
        
        if (leverage > 1) {
            actionTitle = `🎰 HEBEL-TRADE (${leverage}x)`;
            const maxLeveraged = (user.balance * leverage) / coin.price;
            limitInfo = `Max. Einsatz: \`${formatCurrency(user.balance)}\`\nMax. Coins (${leverage}x): \`${formatCrypto(maxLeveraged)}\` ${coinId.toUpperCase()}\n\n⚠️ **Liquidation bei ${(100/leverage).toFixed(1)}% Kursverlust!**`;
        } else {
            actionTitle = type === 'buy' ? '🛒 KAUFEN' : '💰 VERKAUFEN';
            limitInfo = type === 'buy' 
                ? `Max. kaufbar: \`${formatCrypto(maxBuy)}\` ${coinId.toUpperCase()}` 
                : `Verfügbar: \`${formatCrypto(maxSell)}\` ${coinId.toUpperCase()}`;
        }

        const inputMsg = `
⌨️ **${actionTitle}: ${coinId.toUpperCase()}**
${divider}
Aktueller Kurs: \`${formatCurrency(coin.price)}\`
${limitInfo}

_Bitte sende jetzt die gewünschte Anzahl ${coinId.toUpperCase()} als Nachricht._
`;

        await ctx.sendInterface(inputMsg, Markup.inlineKeyboard([
            [Markup.button.callback('❌ Abbrechen', `view_coin_${coinId}`)]
        ]));
        
    } catch (err) {
        logger.error("Trade-Initialisierung Fehler:", err);
        if (ctx.callbackQuery) {
            ctx.answerCbQuery("🚨 Fehler beim Starten.");
        }
    }
}

/**
 * Verarbeitet KAUF ohne Hebel
 */
export async function handleBuy(ctx, coinId, cryptoAmount) {
    const userId = ctx.from.id;
    
    try {
        const coin = await getCoinPrice(coinId);
        if (!coin) throw new Error("Preis nicht verfügbar");

        const { totalCost, fee } = calculateTrade(cryptoAmount, coin.price);
        const { data: user } = await supabase
            .from('profiles')
            .select('balance')
            .eq('id', userId)
            .single();
        
        if (user.balance < totalCost) {
            return ctx.reply(
                `❌ **Guthaben zu niedrig!**\nBedarf: \`${formatCurrency(totalCost)}\``
            );
        }

        // RPC: Geld abziehen, Fee in Tax Pool
        const { error: rpcError } = await supabase.rpc('execute_trade_buy', { 
            p_user_id: userId, 
            p_total_cost: totalCost, 
            p_fee: fee 
        });
        
        if (rpcError) throw rpcError;

        // Asset-Bestand aktualisieren
        const { data: currentAsset } = await supabase
            .from('user_crypto')
            .select('amount, avg_buy_price')
            .eq('user_id', userId)
            .eq('coin_id', coinId.toLowerCase())
            .maybeSingle();

        const oldAmount = currentAsset ? currentAsset.amount : 0;
        const newAmount = oldAmount + cryptoAmount;
        const newAvgPrice = currentAsset 
            ? ((oldAmount * currentAsset.avg_buy_price) + (cryptoAmount * coin.price)) / newAmount
            : coin.price;

        await supabase.from('user_crypto').upsert({ 
            user_id: userId, 
            coin_id: coinId.toLowerCase(), 
            amount: newAmount, 
            avg_buy_price: newAvgPrice,
            leverage: 1,
            created_at: new Date().toISOString()
        }, { onConflict: 'user_id,coin_id' });

        await logTransaction(
            userId, 
            'buy_crypto', 
            totalCost, 
            `Kauf ${formatCrypto(cryptoAmount, coinId)}`
        );
        
        // Achievement-Check
        await checkAndAwardAchievement(userId, 'first_trade');
        
        await ctx.reply(
            `✅ **Kauf erfolgreich!**\n${formatCrypto(cryptoAmount, coinId)}\nKosten: ${formatCurrency(totalCost)}`
        );
        
        return showTradeMenu(ctx, coinId);
        
    } catch (err) {
        logger.error("Kauf-Fehler:", err);
        await ctx.reply("🚨 Kauf fehlgeschlagen. Prüfe dein Guthaben.");
    }
}

/**
 * Verarbeitet VERKAUF
 */
export async function handleSell(ctx, coinId, cryptoAmount) {
    const userId = ctx.from.id;
    
    try {
        const coin = await getCoinPrice(coinId);
        const { data: asset } = await supabase
            .from('user_crypto')
            .select('*')
            .eq('user_id', userId)
            .eq('coin_id', coinId.toLowerCase())
            .maybeSingle();

        if (!asset || asset.amount < cryptoAmount) {
            return ctx.reply(`❌ **Bestand zu niedrig!**`);
        }

        const isEligible = isTradeEligibleForVolume(asset.created_at);
        const { payout, fee } = calculateTrade(cryptoAmount, coin.price);
        const tradeVolumeEuro = cryptoAmount * coin.price;

        // RPC: Payout gutschreiben
        const { error: rpcError } = await supabase.rpc('execute_trade_sell', {
            p_user_id: userId,
            p_payout: payout,
            p_fee: fee,
            p_volume: isEligible ? tradeVolumeEuro : 0
        });
        
        if (rpcError) throw rpcError;

        const newAmount = asset.amount - cryptoAmount;
        
        if (newAmount <= 0.00000001) {
            await supabase.from('user_crypto').delete().eq('id', asset.id);
        } else {
            await supabase.from('user_crypto').update({ 
                amount: newAmount 
            }).eq('id', asset.id);
        }

        await logTransaction(
            userId, 
            'sell_crypto', 
            payout, 
            `Verkauf ${formatCrypto(cryptoAmount, coinId)}`
        );
        
        let successMsg = `💰 **Verkauf erfolgreich!**\n+${formatCurrency(payout)}`;
        
        if (!isEligible) {
            successMsg += `\n\n⚠️ _Haltedauer < 1h: Zählt nicht für Immobilien-Limit._`;
        }
        
        await ctx.reply(successMsg);
        return showTradeMenu(ctx, coinId);
        
    } catch (err) {
        logger.error("Verkauf-Fehler:", err);
        await ctx.reply("🚨 Verkauf fehlgeschlagen.");
    }
}

/**
 * Verarbeitet HEBEL-TRADE (2x bis 50x)
 */
export async function handleLeverageTrade(ctx, coinId, cryptoAmount, leverage) {
    const userId = ctx.from.id;
    
    try {
        const coin = await getCoinPrice(coinId);
        if (!coin) throw new Error("Preis nicht verfügbar");

        const { data: user } = await supabase
            .from('profiles')
            .select('balance')
            .eq('id', userId)
            .single();

        // Berechnung: User will X Coins mit Y-fachem Hebel kaufen
        // Einsatz = (X * Preis) / Hebel
        // Tatsächliche Coins = X
        const actualCost = (cryptoAmount * coin.price) / leverage;
        const { fee } = calculateTrade(cryptoAmount, coin.price);
        const totalCost = actualCost + fee;

        if (user.balance < totalCost) {
            return ctx.reply(
                `❌ **Guthaben zu niedrig!**\nBedarf: \`${formatCurrency(totalCost)}\``
            );
        }

        // Geld abziehen
        const { error: balError } = await supabase.rpc('execute_trade_buy', {
            p_user_id: userId,
            p_total_cost: totalCost,
            p_fee: fee
        });
        
        if (balError) throw balError;

        // Hebel-Position eintragen
        const { data: currentAsset } = await supabase
            .from('user_crypto')
            .select('amount, avg_buy_price, leverage')
            .eq('user_id', userId)
            .eq('coin_id', coinId.toLowerCase())
            .maybeSingle();

        if (currentAsset && currentAsset.leverage > 1) {
            return ctx.reply(
                `⚠️ **Du hast bereits eine Hebel-Position in ${coinId.toUpperCase()}!**\nSchließe diese zuerst.`
            );
        }

        await supabase.from('user_crypto').insert({
            user_id: userId,
            coin_id: coinId.toLowerCase(),
            amount: cryptoAmount,
            avg_buy_price: coin.price,
            leverage: leverage,
            entry_price: coin.price,
            liquidation_price: coin.price * (1 - (0.9 / leverage)),
            created_at: new Date().toISOString()
        });

        await logTransaction(
            userId,
            'leverage_trade',
            totalCost,
            `Hebel ${leverage}x: ${formatCrypto(cryptoAmount, coinId)}`
        );

        // Achievement für High Roller
        if (leverage >= 50) {
            await checkAndAwardAchievement(userId, 'high_roller');
        }

        const liqPrice = coin.price * (1 - (0.9 / leverage));
        
        const successMsg = `
🎰 **Hebel-Trade eröffnet!**

📊 ${formatCrypto(cryptoAmount, coinId)}
💰 Einsatz: ${formatCurrency(actualCost)}
⚡ Hebel: ${leverage}x
📍 Entry: ${formatCurrency(coin.price)}
💀 Liquidation: ${formatCurrency(liqPrice)}

⚠️ **Achtung:** Fällt der Kurs unter ${formatCurrency(liqPrice)}, verlierst du deinen Einsatz komplett!
`;
        
        await ctx.reply(successMsg);
        return showTradeMenu(ctx, coinId);
        
    } catch (err) {
        logger.error("Hebel-Trade Fehler:", err);
        await ctx.reply("🚨 Hebel-Trade fehlgeschlagen.");
    }
}
