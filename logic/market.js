// logic/market.js - VERBESSERT für zuverlässige Updates
import fetch from 'node-fetch';
import { supabase } from '../supabase/client.js';
import { logger } from '../utils/logger.js';

const FALLBACK_PRICES = {
    bitcoin: { price: 61500, change24h: 0.5 },
    litecoin: { price: 41.20, change24h: -0.2 },
    ethereum: { price: 2150, change24h: 1.2 }
};

let lastSuccessfulUpdate = null;
let updateAttempts = 0;

/**
 * HAUPTFUNKTION: Aktualisiert Marktpreise von CryptoCompare
 * Wird alle 60 Sekunden aufgerufen
 */
export async function updateMarketPrices() {
    updateAttempts++;
    
    try {
        logger.info(`📊 Markt-Update Versuch #${updateAttempts}...`);
        
        const url = `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=BTC,LTC,ETH&tsyms=EUR`;
        
        const response = await fetch(url, {
            timeout: 10000 // 10 Sekunden Timeout
        });

        if (!response.ok) {
            throw new Error(`API returned ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Prüfen ob API-Limit erreicht
        if (data.Response === 'Error') {
            throw new Error(`CryptoCompare Error: ${data.Message}`);
        }

        if (!data.RAW || !data.RAW.BTC || !data.RAW.LTC || !data.RAW.ETH) {
            throw new Error("Unvollständige API-Antwort");
        }

        // Daten extrahieren und validieren
        const updates = [
            { 
                coin_id: 'bitcoin', 
                price_eur: parseFloat(data.RAW.BTC.EUR.PRICE.toFixed(2)), 
                change_24h: parseFloat(data.RAW.BTC.EUR.CHANGEPCT24HOUR.toFixed(2)),
                last_update: new Date().toISOString()
            },
            { 
                coin_id: 'litecoin', 
                price_eur: parseFloat(data.RAW.LTC.EUR.PRICE.toFixed(2)), 
                change_24h: parseFloat(data.RAW.LTC.EUR.CHANGEPCT24HOUR.toFixed(2)),
                last_update: new Date().toISOString()
            },
            { 
                coin_id: 'ethereum', 
                price_eur: parseFloat(data.RAW.ETH.EUR.PRICE.toFixed(2)), 
                change_24h: parseFloat(data.RAW.ETH.EUR.CHANGEPCT24HOUR.toFixed(2)),
                last_update: new Date().toISOString()
            }
        ];

        // Validierung: Preise müssen sinnvoll sein
        for (const update of updates) {
            if (update.price_eur <= 0 || isNaN(update.price_eur)) {
                throw new Error(`Ungültiger Preis für ${update.coin_id}: ${update.price_eur}`);
            }
        }

        // In Supabase schreiben
        const { error } = await supabase
            .from('market_cache')
            .upsert(updates, { onConflict: 'coin_id' });

        if (error) {
            throw new Error(`Supabase Error: ${error.message}`);
        }

        lastSuccessfulUpdate = new Date();
        
        logger.info(`✅ Markt aktualisiert! BTC: ${updates[0].price_eur}€, LTC: ${updates[1].price_eur}€, ETH: ${updates[2].price_eur}€`);
        
        return await getMarketData();

    } catch (err) {
        logger.error(`❌ Markt-Update #${updateAttempts} fehlgeschlagen: ${err.message}`);
        
        // Nach 3 Fehlversuchen: Fallback nutzen
        if (updateAttempts % 3 === 0) {
            logger.warn("⚠️ Nutze Fallback-Preise nach mehreren Fehlversuchen");
            await writeFallbackToDatabase();
        }
        
        return await getMarketData(); // Versuche trotzdem aus DB zu lesen
    }
}

/**
 * Schreibt Fallback-Preise in DB wenn API komplett down ist
 */
async function writeFallbackToDatabase() {
    try {
        const updates = Object.keys(FALLBACK_PRICES).map(coinId => ({
            coin_id: coinId,
            price_eur: FALLBACK_PRICES[coinId].price,
            change_24h: FALLBACK_PRICES[coinId].change24h,
            last_update: new Date().toISOString()
        }));

        await supabase.from('market_cache').upsert(updates, { onConflict: 'coin_id' });
        logger.info("💾 Fallback-Preise in DB geschrieben");
    } catch (err) {
        logger.error("Fehler beim Schreiben der Fallback-Preise:", err);
    }
}

/**
 * Holt aktuelle Preise aus der Datenbank
 * WICHTIG: Diese Funktion wird von allen Trading-Funktionen genutzt
 */
export async function getMarketData() {
    try {
        const { data, error } = await supabase
            .from('market_cache')
            .select('*');
        
        if (error) {
            logger.error("DB-Abfrage Fehler:", error);
            return FALLBACK_PRICES;
        }

        if (!data || data.length === 0) {
            logger.warn("⚠️ Keine Daten in market_cache - initiiere Update");
            await updateMarketPrices();
            return FALLBACK_PRICES;
        }

        // Formatieren für den Bot
        const formatted = {};
        data.forEach(row => {
            formatted[row.coin_id] = { 
                price: parseFloat(row.price_eur), 
                change24h: parseFloat(row.change_24h),
                lastUpdate: row.last_update
            };
        });

        // Warnung wenn Daten zu alt sind (> 5 Minuten)
        if (data[0]?.last_update) {
            const age = Date.now() - new Date(data[0].last_update).getTime();
            if (age > 300000) { // 5 Minuten
                logger.warn(`⚠️ Marktdaten sind ${Math.floor(age/1000)}s alt - Update könnte hängen`);
            }
        }

        return formatted;

    } catch (err) {
        logger.error("getMarketData Fehler:", err);
        return FALLBACK_PRICES;
    }
}

/**
 * Holt Preis für einen einzelnen Coin
 */
export async function getCoinPrice(coinId) {
    const market = await getMarketData();
    const id = coinId.toLowerCase();
    
    const result = market[id];
    
    if (!result) {
        logger.error(`🚨 Preis-Anfrage für unbekannten Coin: ${id}`);
        return FALLBACK_PRICES[id] || null;
    }
    
    return result;
}

/**
 * Gibt Status-Info über Markt-Updates zurück
 */
export function getMarketUpdateStatus() {
    return {
        lastUpdate: lastSuccessfulUpdate,
        attempts: updateAttempts,
        timeSinceUpdate: lastSuccessfulUpdate 
            ? Date.now() - lastSuccessfulUpdate.getTime() 
            : null
    };
}

// Initialer Aufruf beim Server-Start
logger.info("🔄 Initiiere ersten Markt-Fetch...");
updateMarketPrices()
    .then(() => logger.info("✅ Initialer Markt-Fetch erfolgreich"))
    .catch(e => logger.error("❌ Initialer Fetch fehlgeschlagen:", e));