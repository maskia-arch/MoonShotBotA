// utils/formatter.js

/**
 * Formatiert Geldbeträge nach deutschem Standard (Punkt als Tausender-Trennzeichen, Komma für Cent)
 * Beispiel: 58649.209 -> 58.649,21 €
 */
export const formatCurrency = (amount) => {
    // Falls kein Wert vorhanden ist, 0,00 € zurückgeben
    const value = amount || 0;
    return new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
};

/**
 * Formatiert Krypto-Mengen (Präzision bis zu 8 Nachkommastellen)
 * Beispiel: 107.628434 -> 107,628434 LTC
 */
export const formatCrypto = (amount, symbol = '') => {
    const value = amount || 0;
    const formatted = new Intl.NumberFormat('de-DE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 8
    }).format(value);
    return symbol ? `${formatted} ${symbol.toUpperCase()}` : formatted;
};

/**
 * Formatiert prozentuale Änderungen mit Emojis und Vorzeichen
 * Korrigiert Fehler wie: +0,90% ohne Leerzeichen oder falsche Emojis
 */
export const formatPercent = (percent) => {
    const value = parseFloat(percent || 0);
    const sign = value >= 0 ? '+' : '';
    // Emoji-Logik für 24h Trends
    const emoji = value >= 0 ? '🟢' : '🔴';
    
    const formatted = new Intl.NumberFormat('de-DE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(Math.abs(value)); // Absolutwert, da das Vorzeichen manuell gesetzt wird

    return `${emoji} ${sign}${formatted}%`;
};

/**
 * NEU: Formatiert Zeitabstände für die 1-Stunden-Haltefrist
 * Hilft dem Spieler zu sehen, wie lange er noch halten muss.
 */
export const formatTimeRemaining = (timestamp) => {
    const oneHour = 60 * 60 * 1000;
    const elapsed = Date.now() - new Date(timestamp).getTime();
    const remaining = oneHour - elapsed;

    if (remaining <= 0) return "✅ Bereit für Immobilien-Volumen";

    const minutes = Math.floor(remaining / (1000 * 60));
    return `⏳ Noch ${minutes} Min. halten`;
};

/**
 * Kürzt lange Usernamen oder Texte für Tabellen/Leaderboards
 */
export const truncateText = (text, maxLength = 15) => {
    if (!text) return 'Unbekannt';
    return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
};

/**
 * Erstellt einen visuellen Fortschrittsbalken aus Emojis
 * Beispiel: (80, 100) -> ████████░░ (80%)
 */
export const formatProgressBar = (value, max = 100, length = 10) => {
    const percentage = Math.min(Math.max(value / max, 0), 1);
    const filledLength = Math.round(length * percentage);
    const emptyLength = length - filledLength;

    const bar = '█'.repeat(filledLength) + '░'.repeat(emptyLength);
    const label = Math.round(percentage * 100) + '%';
    
    return `\`${bar}\` (${label})`;
};
