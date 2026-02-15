// ui/components.js
import { formatCurrency, formatPercent, formatProgressBar } from '../utils/formatter.js';
import { CONFIG } from '../config.js';

/**
 * Erzeugt einen Header für Menüs
 * Beispiel: ─── 📈 TRADING CENTER ───
 */
export const renderHeader = (title) => {
    return `\n─── **${title.toUpperCase()}** ───\n`;
};

/**
 * Eine Status-Zeile für das Guthaben
 */
export const renderBalanceSnippet = (balance) => {
    return `${CONFIG.EMOJIS.CASH} **Konto:** \`${formatCurrency(balance)}\``;
};

/**
 * Erzeugt eine kleine Karte für ein Krypto-Asset
 */
export const renderCryptoCard = (symbol, price, change24h) => {
    return `
${CONFIG.EMOJIS.CRYPTO} **${symbol.toUpperCase()}/EUR**
Price: \`${formatCurrency(price)}\`
24h: ${formatPercent(change24h)}
`;
};

/**
 * Erzeugt eine Status-Karte für eine Immobilie
 * Inklusive Zustandsbalken
 */
export const renderImmoCard = (name, value, condition, rent) => {
    return `
${CONFIG.EMOJIS.IMMO} **${name}**
Wert: \`${formatCurrency(value)}\`
Miete: \`+${formatCurrency(rent)}/Tick\`
Zustand: ${formatProgressBar(condition, 100)}
`;
};

/**
 * Ein kompakter "Margin-Call" Warner für Hebel-Trades
 */
export const renderRiskIndicator = (riskLevel) => {
    let emoji = '🟢 Low';
    if (riskLevel > 5) emoji = '🟡 Medium';
    if (riskLevel > 20) emoji = '🔴 HIGH RISK';
    
    return `Risiko-Level: **${emoji}**`;
};

/**
 * Trennlinie für bessere Lesbarkeit in langen Nachrichten
 */
export const divider = "------------------------------------------";

/**
 * Footer mit Version und Timestamp
 */
export const renderFooter = () => {
    const now = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return `\n_${now} | ${CONFIG.VERSION}_`;
};
