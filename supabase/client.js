// supabase/client.js
import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Initialisiert den Supabase Client mit den Werten aus der config.js.
 * Der 'anon' Key ist sicher für Client-Abfragen, solange RLS-Policies 
 * in Supabase korrekt gesetzt sind.
 */
if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY) {
    logger.error("🚨 KRITISCH: Supabase URL oder Key fehlen in der Konfiguration!");
    process.exit(1); // Bot stoppen, da ohne DB nichts funktioniert
}

// Client mit globalen Einstellungen für bessere Stabilität
export const supabase = createClient(
    CONFIG.SUPABASE_URL, 
    CONFIG.SUPABASE_KEY,
    {
        auth: {
            persistSession: false // Verhindert Session-Konflikte im Bot-Betrieb
        }
    }
);

/**
 * Hilfsfunktion zum Testen der Verbindung beim Bot-Start.
 * Erweitert um detailliertes Error-Logging für die Fehlersuche.
 */
export async function testConnection() {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('id')
            .limit(1);

        if (error) {
            // Zeigt spezifische Fehler wie 'Invalid API Key' oder 'Connection Timeout'
            logger.error(`❌ Supabase-Abfrage fehlgeschlagen: ${error.message} (Code: ${error.code})`);
            return false;
        }

        logger.info("✅ Verbindung zu Supabase erfolgreich hergestellt.");
        return true;
    } catch (err) {
        logger.error("❌ Unerwarteter Fehler bei Supabase-Verbindung:", err.message);
        return false;
    }
}
