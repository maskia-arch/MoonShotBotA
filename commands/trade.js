// commands/trade.js - V0.22 - TRANSPARENTE GEBÜHREN
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

const TRADING_FEE_PERCENT = "0,5"; // Für Display

/**
 * Zeigt Trading-Center
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
            // COIN-LISTE mit Gebühren-Info
            let listMsg = `📊 **Live-Marktübersicht (24h)**\n${divider}\n`;
            
            Object.keys(marketData).forEach(id => {
                const c = marketData[id];
                const emoji = c.change24h >= 0 ? '🟢' : '🔴';
                const trend = c.change24h >= 0 ? '+' : '';
                listMsg += `${emoji} **${id.toUpperCase()}**: \`${formatCurrency(c.price)}\` (${trend}${c.change24h.toFixed(2)}%)\n`;
            });
            
            // WICHTIG: Gebühren-Info
            listMsg += `\n${divider}\n💡 **Trading-Gebühr:** ${TRADING_FEE_PERCENT}% pro Trade\n`;
            listMsg += `_Wähle einen Coin für Details._`;
            
            return await ctx.sendInterface(listMsg, coinListButtons(marketData));
        }

        // COIN-DETAILS mit Gebühren-Kalkulation
        const coin = marketData[coinId.toLowerCase()];
        if (!coin) {
            return ctx.answerCbQuery(`❌ ${coinId.toUpperCase()} nicht verfügbar.`);
        }

        const { data: user } = await supabase
            .from('profiles')
            .select('balance')
            .eq('id', userId)
            .single();

        // Beispiel-Rechnung für Transparenz
        const exampleAmount = 1000; // 1000€ Investment
        const exampleCalc = calculateTrade(exampleAmount / coin.price, coin.price);

        const detailMsg = `
📊 **${coinId.toUpperCase()}/EUR**
${divider}
💰 Aktueller Kurs: ${formatCurrency(coin.price)}
📈 24h Change: ${coin.change24h >= 0 ? '+' : ''}${coin.change24h.toFixed(2)}%

💶 **Dein Konto:** ${formatCurrency(user.balance)}

${divider}
💡 **Gebühren-Info:**
• Trading-Fee: **${TRADING_FEE_PERCENT}%** (Kauf & Verkauf)

**Beispiel-Rechnung (1.000€ Kauf):**
Bruttokosten: ${formatCurrency(exampleCalc.subtotal)}
+ Gebühr (${TRADING_FEE_PERCENT}%): ${formatCurrency(exampleCalc.fee)}
= **Gesamt: ${formatCurrency(exampleCalc.totalCost)}**

_Die Gebühren fließen in den Community-Preispool!_
${divider}
⚠️ *Hebel-Trades haben höheres Risiko!*
`;

        await ctx.sendInterface(detailMsg, coinActionButtons(coinId));

    } catch (err) {
        logger.error(`Trade-System Error:`, err);
        if (ctx.callbackQuery) {
            ctx.answerCbQuery("🚨 Fehler beim Laden.");
        }
    }
}

/**
 * Hebel-Menü mit Gebühren-Info
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

        const warningMsg = `
🎰 **HEBEL-TRADING: ${coinId.toUpperCase()}**
${divider}
Aktueller Kurs: ${formatCurrency(coin.price)}
Verfügbar: ${formatCurrency(user.balance)}

⚠️ **ACHTUNG:**
• Hebel verstärkt Gewinne UND Verluste!
• Liquidation = Totalverlust des Einsatzes!
• Gebühr: ${TRADING_FEE_PERCENT}% auf Einsatz

**Beispiel 10x Hebel:**
Einsatz: 100€ → Position: 1.000€ Wert
Bei +10% Kurs: +100€ Gewinn (100%)
Bei -10% Kurs: **LIQUIDATION** (100% Verlust)

${divider}
Wähle deinen Hebel:
`;
        
        await ctx.sendInterface(warningMsg, leverageButtons(coinId));
    } catch (err) {
        logger.error("Hebel-Menü Error:", err);
        ctx.answerCbQuery("❌ Fehler beim Laden.");
    }
}

/**
 * Trade-Eingabe mit Gebühren-Vorschau
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

        let actionTitle, limitInfo, feeInfo;
        
        if (leverage > 1) {
            actionTitle = `🎰 HEBEL-TRADE (${leverage}x)`;
            const maxLeveraged = (user.balance * leverage) / coin.price;
            
            // Gebühren-Kalkulation für Hebel
            const exampleFee = user.balance * CONFIG.TRADING_FEE;
            
            limitInfo = `Max. Einsatz: \`${formatCurrency(user.balance)}\`\nMax. Coins (${leverage}x): \`${formatCrypto(maxLeveraged)}\` ${coinId.toUpperCase()}`;
            feeInfo = `\n💰 **Gebühr:** ${TRADING_FEE_PERCENT}% auf Einsatz (≈${formatCurrency(exampleFee)})\n⚠️ **Liquidation bei ${(100/leverage).toFixed(1)}% Kursverlust!**`;
        } else {
            actionTitle = type === 'buy' ? '🛒 KAUFEN' : '💰 VERKAUFEN';
            
            if (type === 'buy') {
                // Beispiel-Fee für maximalen Kauf
                const maxBuyCost = maxBuy * coin.price;
                const maxBuyFee = maxBuyCost * CONFIG.TRADING_FEE;
                
                limitInfo = `Max. kaufbar: \`${formatCrypto(maxBuy)}\` ${coinId.toUpperCase()}`;
                feeInfo = `\n💰 **Gebühr:** ${TRADING_FEE_PERCENT}% (max. ≈${formatCurrency(maxBuyFee)})`;
            } else {
                // Verkaufs-Fee
                const sellValue = userHoldings * coin.price;
                const sellFee = sellValue * CONFIG.TRADING_FEE;
                
                limitInfo = `Verfügbar: \`${formatCrypto(maxSell)}\` ${coinId.toUpperCase()}`;
                feeInfo = `\n💰 **Gebühr:** ${TRADING_FEE_PERCENT}% (≈${formatCurrency(sellFee)} bei Voll-Verkauf)`;
            }
        }

        const inputMsg = `
⌨️ **${actionTitle}: ${coinId.toUpperCase()}**
${divider}
Aktueller Kurs: \`${formatCurrency(coin.price)}\`
${limitInfo}${feeInfo}

${divider}
_Bitte sende jetzt die gewünschte Anzahl ${coinId.toUpperCase()} als Nachricht._

**Beispiel:** 0.01 oder 1.5
`;

        await ctx.sendInterface(inputMsg, Markup.inlineKeyboard([
            [Markup.button.callback('❌ Abbrechen', `view_coin_${coinId}`)]
        ]));
        
    } catch (err) {
        logger.error("Trade-Init Error:", err);
        if (ctx.callbackQuery) {
            ctx.answerCbQuery("🚨 Fehler.");
        }
    }
}

/**
 * KAUF mit Gebühren-Anzeige
 */
export async function handleBuy(ctx, coinId, cryptoAmount) {
    const userId = ctx.from.id;
    
    try {
        const coin = await getCoinPrice(coinId);
        if (!coin) throw new Error("Preis nicht verfügbar");

        const { totalCost, fee, subtotal } = calculateTrade(cryptoAmount, coin.price);
        
        const { data: user } = await supabase
            .from('profiles')
            .select('balance')
            .eq('id', userId)
            .single();
        
        if (user.balance < totalCost) {
            return ctx.reply(
                `❌ **Guthaben zu niedrig!**\n\nBenötigt: ${formatCurrency(totalCost)}\n(inkl. ${formatCurrency(fee)} Gebühr)\n\nVerfügbar: ${formatCurrency(user.balance)}`
            );
        }

        // RPC: Geld abziehen, Fee in Tax Pool
        const { error: rpcError } = await supabase.rpc('execute_trade_buy', { 
            p_user_id: userId, 
            p_total_cost: totalCost, 
            p_fee: fee 
        });
        
        if (rpcError) throw rpcError;

        // Asset aktualisieren
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
        
        await checkAndAwardAchievement(userId, 'first_trade');
        
        // WICHTIG: Transparente Erfolgs-Nachricht mit Gebühren
        const successMsg = `
✅ **Kauf erfolgreich!**

${formatCrypto(cryptoAmount, coinId)}

**Kostenaufstellung:**
Kaufpreis: ${formatCurrency(subtotal)}
Gebühr (${TRADING_FEE_PERCENT}%): ${formatCurrency(fee)}
━━━━━━━━━━━━━━━
**Gesamt:** ${formatCurrency(totalCost)}

Neues Guthaben: ${formatCurrency(user.balance - totalCost)}
`;
        
        await ctx.reply(successMsg);
        return showTradeMenu(ctx, coinId);
        
    } catch (err) {
        logger.error("Kauf-Error:", err);
        await ctx.reply("🚨 Kauf fehlgeschlagen.");
    }
}

/**
 * VERKAUF mit Gebühren-Anzeige
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
            return ctx.reply(`❌ **Bestand zu niedrig!**\n\nVerfügbar: ${asset ? formatCrypto(asset.amount, coinId) : '0'}`);
        }

        const isEligible = isTradeEligibleForVolume(asset.created_at);
        const { payout, fee, subtotal } = calculateTrade(cryptoAmount, coin.price);
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
        
        // WICHTIG: Transparente Erfolgs-Nachricht
        let successMsg = `
💰 **Verkauf erfolgreich!**

${formatCrypto(cryptoAmount, coinId)}

**Auszahlungsdetails:**
Verkaufswert: ${formatCurrency(subtotal)}
Gebühr (${TRADING_FEE_PERCENT}%): -${formatCurrency(fee)}
━━━━━━━━━━━━━━━
**Auszahlung:** ${formatCurrency(payout)}
`;
        
        if (!isEligible) {
            successMsg += `\n⚠️ _Haltedauer < 1h: Zählt nicht für Immobilien-Limit._`;
        }
        
        await ctx.reply(successMsg);
        return showTradeMenu(ctx, coinId);
        
    } catch (err) {
        logger.error("Verkauf-Error:", err);
        await ctx.reply("🚨 Verkauf fehlgeschlagen.");
    }
}

/**
 * Hebel-Trade (bereits vollständig implementiert)
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

        const actualCost = (cryptoAmount * coin.price) / leverage;
        const { fee } = calculateTrade(cryptoAmount, coin.price);
        const totalCost = actualCost + fee;

        if (user.balance < totalCost) {
            return ctx.reply(
                `❌ **Guthaben zu niedrig!**\n\nBedarf: ${formatCurrency(totalCost)}\n(inkl. ${formatCurrency(fee)} Gebühr)`
            );
        }

        const { error: balError } = await supabase.rpc('execute_trade_buy', {
            p_user_id: userId,
            p_total_cost: totalCost,
            p_fee: fee
        });
        
        if (balError) throw balError;

        const { data: currentAsset } = await supabase
            .from('user_crypto')
            .select('amount, avg_buy_price, leverage')
            .eq('user_id', userId)
            .eq('coin_id', coinId.toLowerCase())
            .maybeSingle();

        if (currentAsset && currentAsset.leverage > 1) {
            return ctx.reply(
                `⚠️ **Du hast bereits eine Hebel-Position in ${coinId.toUpperCase()}!**\n\nSchließe diese zuerst.`
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

        if (leverage >= 50) {
            await checkAndAwardAchievement(userId, 'high_roller');
        }

        const liqPrice = coin.price * (1 - (0.9 / leverage));
        
        const successMsg = `
🎰 **Hebel-Trade eröffnet!**

📊 ${formatCrypto(cryptoAmount, coinId)}
💰 Einsatz: ${formatCurrency(actualCost)}
💸 Gebühr: ${formatCurrency(fee)}
⚡ Hebel: ${leverage}x
📍 Entry: ${formatCurrency(coin.price)}
💀 Liquidation: ${formatCurrency(liqPrice)}

⚠️ **Risiko:** Fällt der Kurs unter ${formatCurrency(liqPrice)}, verlierst du deinen gesamten Einsatz!
`;
        
        await ctx.reply(successMsg);
        return showTradeMenu(ctx, coinId);
        
    } catch (err) {
        logger.error("Hebel-Trade Error:", err);
        await ctx.reply("🚨 Hebel-Trade fehlgeschlagen.");
    }
}