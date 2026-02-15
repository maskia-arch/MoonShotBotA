// utils/logger.js
import fs from 'fs';
import path from 'path';

/**
 * Logger Utility für MoonShot Tycoon
 * Unterstützt: INFO, WARN, ERROR, DEBUG
 */

const LOG_LEVELS = {
    INFO: '🔹 INFO',
    WARN: '⚠️ WARN',
    ERROR: '❌ ERROR',
    DEBUG: '🐛 DEBUG'
};

// Pfad zur Log-Datei (optional, falls spck Schreibzugriff erlaubt)
const logFilePath = path.join(process.cwd(), 'bot.log');

const formatMessage = (level, message, data = '') => {
    const timestamp = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
    const dataString = data ? ` | Data: ${JSON.stringify(data)}` : '';
    return `[${timestamp}] ${level}: ${message}${dataString}`;
};

const writeToFile = (msg) => {
    try {
        // Asynchrones Anhängen an die Datei, um den Event-Loop nicht zu blockieren
        fs.appendFileSync(logFilePath, msg + '\n');
    } catch (err) {
        // Falls Schreibrechte fehlen (manche Mobile-Editoren), ignorieren wir es
    }
};

export const logger = {
    info: (msg, data) => {
        const formatted = formatMessage(LOG_LEVELS.INFO, msg, data);
        console.log(formatted);
        writeToFile(formatted);
    },

    warn: (msg, data) => {
        const formatted = formatMessage(LOG_LEVELS.WARN, msg, data);
        console.warn(formatted);
        writeToFile(formatted);
    },

    error: (msg, errorObj) => {
        // Bei Fehlern extrahieren wir die Message, falls ein Error-Objekt übergeben wurde
        const errorMsg = errorObj?.message || errorObj;
        const formatted = formatMessage(LOG_LEVELS.ERROR, msg, { error: errorMsg });
        console.error(formatted);
        writeToFile(formatted);
    },

    debug: (msg, data) => {
        // Debugging könnte man über eine Umgebungsvariable abschaltbar machen
        if (process.env.DEBUG === 'true' || true) { 
            const formatted = formatMessage(LOG_LEVELS.DEBUG, msg, data);
            console.debug(formatted);
        }
    }
};
