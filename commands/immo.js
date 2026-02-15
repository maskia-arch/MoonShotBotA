// commands/immo.js - Vollständiges Immobilien-System
import { supabase } from '../supabase/client.js';
import { logger } from '../utils/logger.js';
import { immoMarketLayout, propertyDetailsLayout, myPropertiesLayout } from '../ui/layouts.js';
import { immoMarketButtons, propertyActionButtons, myPropertiesButtons } from '../ui/buttons.js';
import { formatCurrency } from '../utils/formatter.js';
import { logTransaction, checkAndAwardAchievement } from '../supabase/queries.js';
import { CONFIG } from '../config.js';
import { Markup } from 'telegraf';

/**
 * Zeigt den Immobilienmarkt - verfügbare Objekte
 */
export async function showImmoMarket(ctx) {
    const userId = ctx.from.id;

    try {
        const { data: user, error } = await supabase
            .from('profiles')
            .select('balance, trading_volume')
            .eq('id', userId)
            .single();

        if (error) throw error;

        // Prüfung: Mindestvolumen erreicht?
        if (user.trading_volume < CONFIG.MIN_VOL_FOR_REALESTATE) {
            const missing = CONFIG.MIN_VOL_FOR_REALESTATE - user.trading_volume;
            const missingFormatted = formatCurrency(missing);
            
            return ctx.sendInterface(`
⚠️ **Immobilien-Markt gesperrt**

Onkel Willi möchte sehen, dass du dich am Markt beweist!

${CONFIG.EMOJIS.CHART} Dein Handelsvolumen: ${formatCurrency(user.trading_volume)}
${CONFIG.EMOJIS.WARNING} Benötigt: ${formatCurrency(CONFIG.MIN_VOL_FOR_REALESTATE)}
${CONFIG.EMOJIS.FIRE} Noch zu handeln: **${missingFormatted}**

💡 _Tipp: Kaufe und verkaufe Kryptos (min. 1h Haltefrist)_
`);
        }

        // Verfügbare Immobilien aus CONFIG
        const availableProps = Object.keys(CONFIG.PROPERTIES).map(id => ({
            id,
            ...CONFIG.PROPERTIES[id]
        }));

        // Bereits gekaufte Objekte prüfen
        const { data: userProps } = await supabase
            .from('user_assets')
            .select('asset_type')
            .eq('user_id', userId);

        const ownedTypes = userProps ? userProps.map(p => p.asset_type) : [];

        const message = immoMarketLayout(availableProps, user.balance, ownedTypes);
        
        await ctx.sendInterface(message, immoMarketButtons(availableProps[0].id));

    } catch (err) {
        logger.error("Immo-Markt Fehler:", err);
        ctx.reply("❌ Immobilienmarkt momentan nicht erreichbar.");
    }
}

/**
 * Zeigt Details einer Immobilie
 */
export async function handlePropertyDetails(ctx, propId) {
    const userId = ctx.from.id;
    
    try {
        const property = CONFIG.PROPERTIES[propId];
        
        if (!property) {
            return ctx.answerCbQuery("❌ Immobilie nicht gefunden.");
        }

        const { data: user } = await supabase
            .from('profiles')
            .select('balance')
            .eq('id', userId)
            .single();

        const detailsMsg = propertyDetailsLayout(propId, property, user.balance);
        
        const buttons = Markup.inlineKeyboard([
            [Markup.button.callback(
                `💰 Kaufen (${formatCurrency(property.price)})`, 
                `buy_immo_${propId}`
            )],
            [Markup.button.callback('⬅️ Zurück zum Markt', 'main_menu')]
        ]);

        await ctx.sendInterface(detailsMsg, buttons);
        await ctx.answerCbQuery();

    } catch (err) {
        logger.error("Property Details Fehler:", err);
        ctx.answerCbQuery("❌ Fehler beim Laden der Details.");
    }
}

/**
 * Kauft eine Immobilie
 */
export async function handleBuyProperty(ctx, propType) {
    const userId = ctx.from.id;
    
    try {
        const property = CONFIG.PROPERTIES[propType];
        
        if (!property) {
            return ctx.answerCbQuery("❌ Immobilie nicht gefunden.", { show_alert: true });
        }

        const { data: user } = await supabase
            .from('profiles')
            .select('balance')
            .eq('id', userId)
            .single();
        
        if (user.balance < property.price) {
            return ctx.answerCbQuery(
                `❌ Nicht genug Guthaben!\nBenötigt: ${formatCurrency(property.price)}`,
                { show_alert: true }
            );
        }

        // Prüfen ob User diesen Typ bereits besitzt
        const { data: existing } = await supabase
            .from('user_assets')
            .select('id')
            .eq('user_id', userId)
            .eq('asset_type', propType)
            .maybeSingle();

        if (existing) {
            return ctx.answerCbQuery(
                "⚠️ Du besitzt bereits diese Immobilie!",
                { show_alert: true }
            );
        }

        // Geld abziehen
        const { error: balError } = await supabase.rpc('increment_balance', {
            user_id: userId,
            amount: -property.price
        });
        
        if (balError) throw balError;

        // Asset hinzufügen
        const { error: assetError } = await supabase.from('user_assets').insert({
            user_id: userId,
            asset_type: propType,
            purchase_price: property.price,
            condition: 100,
            last_rent_collection: new Date().toISOString()
        });

        if (assetError) throw assetError;

        await logTransaction(
            userId,
            'buy_property',
            -property.price,
            `Kauf: ${property.name}`
        );

        // Achievement-Checks
        const { count } = await supabase
            .from('user_assets')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId);

        if (count >= 5) {
            await checkAndAwardAchievement(userId, 'property_mogul');
        }

        // Check für Portfolio King
        const uniqueTypes = await supabase
            .from('user_assets')
            .select('asset_type')
            .eq('user_id', userId);

        if (uniqueTypes.data && uniqueTypes.data.length >= Object.keys(CONFIG.PROPERTIES).length) {
            await checkAndAwardAchievement(userId, 'portfolio_king');
        }

        await ctx.answerCbQuery("✅ Kauf erfolgreich!", { show_alert: true });
        
        const successMsg = `
🎉 **Glückwunsch!**

Du bist nun Besitzer:
${property.emoji} **${property.name}**

💰 Kaufpreis: ${formatCurrency(property.price)}
📊 Miet-Einnahmen: ${formatCurrency(property.rent)}/24h
🛠️ Wartungskosten: ${formatCurrency(property.maintenanceCost)}/Monat

Die ersten Mieteinnahmen kommen in 24 Stunden!
`;

        await ctx.sendInterface(successMsg);
        
        setTimeout(() => showImmoMarket(ctx), 2000);

    } catch (err) {
        logger.error("Immobilienkauf Fehler:", err);
        ctx.answerCbQuery("🚨 Kauf fehlgeschlagen.", { show_alert: true });
    }
}

/**
 * Verkauft eine Immobilie (80% des Kaufpreises)
 */
export async function handleSellProperty(ctx, assetId) {
    const userId = ctx.from.id;
    
    try {
        const { data: asset } = await supabase
            .from('user_assets')
            .select('*')
            .eq('id', assetId)
            .eq('user_id', userId)
            .single();

        if (!asset) {
            return ctx.answerCbQuery("❌ Immobilie nicht gefunden.", { show_alert: true });
        }

        const property = CONFIG.PROPERTIES[asset.asset_type];
        const sellPrice = asset.purchase_price * 0.8; // 80% des Kaufpreises

        // Geld gutschreiben
        await supabase.rpc('increment_balance', {
            user_id: userId,
            amount: sellPrice
        });

        // Asset löschen
        await supabase.from('user_assets').delete().eq('id', assetId);

        await logTransaction(
            userId,
            'sell_property',
            sellPrice,
            `Verkauf: ${property.name}`
        );

        await ctx.answerCbQuery("✅ Verkauf erfolgreich!", { show_alert: true });
        
        const msg = `
💰 **Immobilie verkauft!**

${property.emoji} ${property.name}
Erlös: ${formatCurrency(sellPrice)}

_20% Wertverlust durch Verkauf_
`;

        await ctx.sendInterface(msg);

    } catch (err) {
        logger.error("Immobilien-Verkauf Fehler:", err);
        ctx.answerCbQuery("🚨 Verkauf fehlgeschlagen.", { show_alert: true });
    }
}

/**
 * Repariert/Upgraded eine Immobilie
 */
export async function handleUpgradeProperty(ctx, assetId) {
    const userId = ctx.from.id;
    
    try {
        const { data: asset } = await supabase
            .from('user_assets')
            .select('*')
            .eq('id', assetId)
            .eq('user_id', userId)
            .single();

        if (!asset) {
            return ctx.answerCbQuery("❌ Immobilie nicht gefunden.", { show_alert: true });
        }

        const property = CONFIG.PROPERTIES[asset.asset_type];
        const repairCost = property.maintenanceCost * 3; // 3x Wartungskosten

        const { data: user } = await supabase
            .from('profiles')
            .select('balance')
            .eq('id', userId)
            .single();

        if (user.balance < repairCost) {
            return ctx.answerCbQuery(
                `❌ Nicht genug Geld für Reparatur!\nKosten: ${formatCurrency(repairCost)}`,
                { show_alert: true }
            );
        }

        // Geld abziehen
        await supabase.rpc('increment_balance', {
            user_id: userId,
            amount: -repairCost
        });

        // Zustand auf 100% setzen
        await supabase.from('user_assets').update({
            condition: 100
        }).eq('id', assetId);

        await logTransaction(
            userId,
            'property_repair',
            -repairCost,
            `Reparatur: ${property.name}`
        );

        await ctx.answerCbQuery("✅ Reparatur abgeschlossen!", { show_alert: true });
        
        const msg = `
🛠️ **Reparatur abgeschlossen!**

${property.emoji} ${property.name}
Zustand: 100% ✨
Kosten: ${formatCurrency(repairCost)}

Die Immobilie ist wie neu!
`;

        await ctx.sendInterface(msg);

    } catch (err) {
        logger.error("Property Upgrade Fehler:", err);
        ctx.answerCbQuery("🚨 Reparatur fehlgeschlagen.", { show_alert: true });
    }
}

/**
 * Zeigt die eigenen Immobilien
 */
export async function showMyProperties(ctx) {
    const userId = ctx.from.id;
    
    try {
        const { data: properties } = await supabase
            .from('user_assets')
            .select('*')
            .eq('user_id', userId)
            .order('purchase_price', { ascending: false });

        if (!properties || properties.length === 0) {
            return ctx.sendInterface(`
🏠 **Meine Immobilien**

Du besitzt noch keine Immobilien.

💡 Kaufe welche im Immobilien-Markt!
`);
        }

        const message = myPropertiesLayout(properties);
        await ctx.sendInterface(message, myPropertiesButtons(properties));

    } catch (err) {
        logger.error("My Properties Fehler:", err);
        ctx.reply("❌ Fehler beim Laden deiner Immobilien.");
    }
}
