// ui/layouts.js - Kompakte Text-Layouts
import { formatCurrency, formatPercent, formatProgressBar, formatCrypto } from '../utils/formatter.js';
import { CONFIG } from '../config.js';

export const divider = "━━━━━━━━━━━━━━━━━━━━";
const renderFooter = () => `\n🎮 _MoonShot Tycoon v${CONFIG.VERSION}_`;

export const uncleLetterLayout = (name) => `
✉️ **EIN BRIEF AUS DER TOSKANA**
${divider}
Mein lieber ${name},

die Luft hier ist herrlich, aber mein altes Händlerherz ist unruhig. Ich habe dir **10.000 €** überwiesen.

Die Welt der Coins ist wild – pass auf, dass du nicht alles verhebelst. Wenn du klug bist, sicherst du deine Gewinne in Steinen und Mörtel.

Enttäusche mich nicht!

Dein Onkel Willi
${renderFooter()}
`;

export const portfolioLayout = (userData, assets) => {
    const target = 30000;
    const current = userData.trading_volume || 0;
    let msg = `💰 **DEIN VERMÖGEN**\n${divider}\nKonto: ${formatCurrency(userData.balance)}\nHandelsvolumen: ${formatCurrency(current)}\n`;
    
    if (current < target) {
        msg += `\n⚠️ **Immobilien gesperrt**\n${formatProgressBar(current, target)}\nNoch: ${formatCurrency(target - current)}\n`;
    } else {
        msg += `\n✅ **Immobilien freigeschaltet!**\n`;
    }
    
    msg += `\n📊 **Assets:** ${assets.length || 'Keine'}\n`;
    assets.forEach(a => {
        if (a.type === 'crypto') {
            const emoji = a.profit >= 0 ? '📈' : '📉';
            const lev = a.leverage > 1 ? ` (${a.leverage}x)` : '';
            msg += `${emoji} ${a.symbol.toUpperCase()}: ${formatCrypto(a.amount)}${lev} (${formatPercent(a.profit)})\n`;
        } else {
            msg += `🏠 ${a.name}: ${formatProgressBar(a.condition, 100)}\n`;
        }
    });
    
    return msg + renderFooter();
};

export const tradingViewLayout = (coin, balance) => `
📊 **${coin.symbol.toUpperCase()}/EUR**
${divider}
Preis: ${formatCurrency(coin.price)}
24h: ${formatPercent(coin.change24h)}

Dein Konto: ${formatCurrency(balance)}
${divider}
💡 *Hohe Hebel = hohes Risiko!*
${renderFooter()}
`;

export const leverageWarningLayout = (coinId, price, balance) => `
🎰 **HEBEL-TRADING: ${coinId.toUpperCase()}**
${divider}
Aktueller Kurs: ${formatCurrency(price)}
Verfügbar: ${formatCurrency(balance)}

⚠️ **ACHTUNG:**
• Hebel verstärkt Gewinne UND Verluste!
• Liquidation = Totalverlust!
• Nur für erfahrene Trader!

Wähle deinen Hebel:
`;

export const immoMarketLayout = (props, balance, owned) => {
    let msg = `🏠 **IMMOBILIEN-MARKT**\n${divider}\nKonto: ${formatCurrency(balance)}\n\nVerfügbare Objekte:\n`;
    props.forEach(p => {
        const status = owned.includes(p.id) ? ' ✅' : '';
        msg += `\n${p.emoji} **${p.name}**${status}\nPreis: ${formatCurrency(p.price)}\nMiete: ${formatCurrency(p.rent)}/24h\n`;
    });
    return msg + renderFooter();
};

export const propertyDetailsLayout = (id, prop, balance) => `
${prop.emoji} **${prop.name.toUpperCase()}**
${divider}
💰 Kaufpreis: ${formatCurrency(prop.price)}
📊 Miet-Einnahmen: ${formatCurrency(prop.rent)}/24h
🛠️ Wartung: ${formatCurrency(prop.maintenanceCost)}/Monat
🏆 Tier: ${prop.tier}/6

Dein Konto: ${formatCurrency(balance)}
${renderFooter()}
`;

export const myPropertiesLayout = (properties) => {
    let msg = `🏠 **MEINE IMMOBILIEN**\n${divider}\n`;
    properties.forEach(p => {
        const prop = CONFIG.PROPERTIES[p.asset_type];
        msg += `\n${prop.emoji} ${prop.name}\nZustand: ${formatProgressBar(p.condition, 100)}\nWert: ${formatCurrency(p.purchase_price)}\n`;
    });
    return msg + renderFooter();
};

export const leaderboardLayout = (data, title, type) => {
    let msg = `${title}\n${divider}\n`;
    if (!data || data.length === 0) {
        msg += '\nNoch keine Daten vorhanden.\n';
    } else {
        data.forEach((entry, i) => {
            const rank = ['🥇', '🥈', '🥉'][i] || `${i+1}.`;
            const name = entry.username || entry.profiles?.username || 'Anonym';
            const value = type === 'wealth' ? formatCurrency(entry.balance) 
                : type === 'profit' ? formatCurrency(entry.season_profit)
                : formatCurrency(entry.season_loss);
            msg += `${rank} ${name}: ${value}\n`;
        });
    }
    return msg + renderFooter();
};

export const achievementsLayout = (achievements, unlocked) => {
    let msg = `⭐ **ACHIEVEMENTS**\n${divider}\n`;
    Object.keys(achievements).forEach(key => {
        const a = achievements[key];
        const status = unlocked.includes(key) ? '✅' : '🔒';
        msg += `\n${status} **${a.title}**\n${a.description}\nBelohnung: ${formatCurrency(a.reward)}\n`;
    });
    return msg + renderFooter();
};

export const transactionHistoryLayout = (transactions) => {
    let msg = `🧾 **TRANSAKTIONSVERLAUF**\n${divider}\n`;
    transactions.slice(0, 10).forEach(t => {
        const date = new Date(t.created_at).toLocaleString('de-DE', { 
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' 
        });
        const amount = t.amount >= 0 ? `+${formatCurrency(t.amount)}` : formatCurrency(t.amount);
        msg += `\n${date}\n${t.description}\n${amount}\n`;
    });
    return msg + renderFooter();
};
