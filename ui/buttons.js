// ui/buttons.js
import { Markup } from 'telegraf';
import { formatCurrency } from '../utils/formatter.js';
import { CONFIG } from '../config.js';

export const mainKeyboard = Markup.keyboard([
    ['📈 Trading Center', '🏠 Immobilien'],
    ['💰 Mein Portfolio', '🏆 Bestenliste'],
    ['⭐ Achievements', '⚙️ Einstellungen']
]).resize();

export const coinListButtons = (marketData) => {
    const buttons = Object.keys(marketData).map(id => {
        const coin = marketData[id];
        const emoji = coin.change24h >= 0 ? '📈' : '📉';
        return [Markup.button.callback(`${emoji} ${id.toUpperCase()} (${formatCurrency(coin.price)})`, `view_coin_${id}`)];
    });
    buttons.push([Markup.button.callback('🏠 Hauptmenü', 'main_menu')]);
    return Markup.inlineKeyboard(buttons);
};

export const coinActionButtons = (coinId) => Markup.inlineKeyboard([
    [Markup.button.callback('🎰 Hebel-Trade', `trade_leverage_${coinId}`)],
    [Markup.button.callback('🛒 Kaufen', `trade_buy_${coinId}`), Markup.button.callback('💰 Verkaufen', `trade_sell_${coinId}`)],
    [Markup.button.callback('⬅️ Zurück', 'open_trading_center')]
]);

export const leverageButtons = (coinId) => {
    const buttons = CONFIG.LEVERAGE.AVAILABLE.map(lev => Markup.button.callback(lev >= 20 ? `${lev}x 🔥` : `${lev}x`, `set_lev_${coinId}_${lev}`));
    const rows = [];
    for (let i = 0; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3));
    rows.push([Markup.button.callback('⬅️ Abbrechen', `view_coin_${coinId}`)]);
    return Markup.inlineKeyboard(rows);
};

export const immoMarketButtons = (firstPropId) => Markup.inlineKeyboard([
    [Markup.button.callback('📍 Details', `info_immo_${firstPropId}`)],
    [Markup.button.callback('🏠 Meine Immobilien', 'my_properties')],
    [Markup.button.callback('⬅️ Hauptmenü', 'main_menu')]
]);

export const propertyActionButtons = (propId, assetId = null) => {
    const buttons = assetId 
        ? [[Markup.button.callback('🛠️ Reparieren', `upgrade_immo_${assetId}`), Markup.button.callback('💸 Verkaufen', `sell_immo_${assetId}`)]]
        : [[Markup.button.callback('💰 Kaufen', `buy_immo_${propId}`)]];
    buttons.push([Markup.button.callback('⬅️ Zurück', 'main_menu')]);
    return Markup.inlineKeyboard(buttons);
};

export const myPropertiesButtons = (properties) => {
    const buttons = properties.slice(0, 5).map(p => Markup.button.callback(`${CONFIG.PROPERTIES[p.asset_type]?.emoji || '🏠'} ${p.asset_type}`, `info_immo_${p.id}`));
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
    rows.push([Markup.button.callback('⬅️ Zurück', 'main_menu')]);
    return Markup.inlineKeyboard(rows);
};

export const portfolioButtons = Markup.inlineKeyboard([
    [Markup.button.callback('📊 Kryptos', 'port_crypto'), Markup.button.callback('🏠 Immobilien', 'port_immo')],
    [Markup.button.callback('🧾 Verlauf', 'view_history')],
    [Markup.button.callback('⬅️ Hauptmenü', 'main_menu')]
]);

export const leaderboardButtons = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Reichste', 'rank_wealth'), Markup.button.callback('📈 Profit', 'rank_profit')],
    [Markup.button.callback('📉 Verluste', 'rank_loser'), Markup.button.callback('⬅️ Menü', 'main_menu')]
]);

export const confirmAction = (actionId) => Markup.inlineKeyboard([
    [Markup.button.callback('✅ Bestätigen', `confirm_${actionId}`)],
    [Markup.button.callback('❌ Abbrechen', 'main_menu')]
]);
