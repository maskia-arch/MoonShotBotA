// logic/market.js - V0.22 - AGGRESSIVES UPDATE-SYSTEM
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
let consecutiveFailures = 0;

/**
 * HAUPTFUNKTION: Marktpreise aktualisieren
 * V0.22: Aggressiveres Error-Handling + direktes DB-Update
 */
export async function updateMarketPrices() {
    updateAttempts++;
    
    try {
        logger.info(`📊 Markt-Update #${updateAttempts} - Start`);
        
        // API-Call
        const url = `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=BTC,LTC,ETH&tsyms=EUR`;
        
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'MoonShotBot/0.22'
            },
            timeout: 15000
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Validierung
        if (data.Response === 'Error') {
            throw new Error(`CryptoCompare: ${data.Message}`);
        }

        if (!data.RAW?.BTC?.EUR || !data.RAW?.LTC?.EUR || !data.RAW?.ETH?.EUR) {
            throw new Error("Unvollständige API-Daten");
        }

        // Daten extrahieren
        const btcPrice = parseFloat(data.RAW.BTC.EUR.PRICE.toFixed(2));
        const ltcPrice = parseFloat(data.RAW.LTC.EUR.PRICE.toFixed(2));
        const ethPrice = parseFloat(data.RAW.ETH.EUR.PRICE.toFixed(2));

        logger.info(`💰 API-Daten: BTC=${btcPrice}€, LTC=${ltcPrice}€, ETH=${ethPrice}€`);

        // Sanity-Check
        if (btcPrice <= 0 || ltcPrice <= 0 || ethPrice <= 0) {
            throw new Error("Ungültige Preise von API");
        }

        // === KRITISCH: Direkt in DB schreiben ===
        const updates = [
            { 
                coin_id: 'bitcoin', 
                price_eur: btcPrice,
                change_24h: parseFloat(data.RAW.BTC.EUR.CHANGEPCT24HOUR.toFixed(2)),
                last_update: new Date().toISOString()
            },
            { 
                coin_id: 'litecoin', 
                price_eur: ltcPrice,
                change_24h: parseFloat(data.RAW.LTC.EUR.CHANGEPCT24HOUR.toFixed(2)),
                last_update: new Date().toISOString()
            },
            { 
                coin_id: 'ethereum', 
                price_eur: ethPrice,
                change_24h: parseFloat(data.RAW.ETH.EUR.CHANGEPCT24HOUR.toFixed(2)),
                last_update: new Date().toISOString()
            }
        ];

        logger.info(`💾 Schreibe in Supabase...`);

        // WICHTIG: onConflict muss coin_id sein
        const { data: upsertData, error: upsertError } = await supabase
            .from('market_cache')
            .upsert(updates, { 
                onConflict: 'coin_id',
                ignoreDuplicates: false 
            })
            .select();

        if (upsertError) {
            logger.error(`❌ Supabase Upsert Error:`, upsertError);
            throw new Error(`DB Error: ${upsertError.message} (Code: ${upsertError.code})`);
        }

        logger.info(`✅ Upsert erfolgreich, Rows affected: ${upsertData?.length || 'unknown'}`);

        // Verify: Daten wirklich in DB?
        const { data: verifyData, error: verifyError } = await supabase
            .from('market_cache')
            .select('coin_id, price_eur, last_update')
            .order('coin_id');

        if (verifyError) {
            logger.warn(`⚠️ Verify failed:`, verifyError);
        } else {
            logger.info(`🔍 DB-Verify: ${verifyData?.length || 0} rows found`);
            verifyData?.forEach(row => {
                const age = Date.now() - new Date(row.last_update).getTime();
                logger.debug(`  ${row.coin_id}: ${row.price_eur}€ (${Math.floor(age/1000)}s alt)`);
            });
        }

        // Reset failure counter
        consecutiveFailures = 0;
        lastSuccessfulUpdate = new Date();
        
        logger.info(`✅ Markt-Update #${updateAttempts} ERFOLGREICH!`);
        
        return await getMarketData();

    } catch (err) {
        consecutiveFailures++;
        logger.error(`❌ Markt-Update #${updateAttempts} FEHLGESCHLAGEN (Streak: ${consecutiveFailures}): ${err.message}`);
        logger.error(`   Stack: ${err.stack}`);
        
        // Nach 3 Fehlern: Fallback in DB schreiben
        if (consecutiveFailures >= 3) {
            logger.warn(`⚠️ ${consecutiveFailures} Fehler in Folge - nutze Fallback`);
            await writeFallbackToDatabase();
        }
        
        return await getMarketData();
    }
}

/**
 * Fallback-Preise in DB schreiben
 */
async function writeFallbackToDatabase() {
    try {
        logger.info("💾 Schreibe Fallback-Preise in DB...");
        
        const updates = Object.keys(FALLBACK_PRICES).map(coinId => ({
            coin_id: coinId,
            price_eur: FALLBACK_PRICES[coinId].price,
            change_24h: FALLBACK_PRICES[coinId].change24h,
            last_update: new Date().toISOString()
        }));

        const { error } = await supabase
            .from('market_cache')
            .upsert(updates, { onConflict: 'coin_id' });

        if (error) {
            logger.error("❌ Fallback-Write failed:", error);
        } else {
            logger.info("✅ Fallback-Preise geschrieben");
        }
    } catch (err) {
        logger.error("❌ Kritischer Fehler beim Fallback-Write:", err);
    }
}

/**
 * Marktdaten aus DB holen
 */
export async function getMarketData() {
    try {
        const { data, error } = await supabase
            .from('market_cache')
            .select('*')
            .order('coin_id');
        
        if (error) {
            logger.error("❌ DB-Read Error:", error);
            return FALLBACK_PRICES;
        }

        if (!data || data.length === 0) {
            logger.warn("⚠️ market_cache ist leer - triggere Update");
            // Don't await - fire and forget
            updateMarketPrices().catch(e => logger.error("Update-Trigger failed:", e));
            return FALLBACK_PRICES;
        }

        // Formatieren
        const formatted = {};
        data.forEach(row => {
            formatted[row.coin_id] = { 
                price: parseFloat(row.price_eur), 
                change24h: parseFloat(row.change_24h),
                lastUpdate: row.last_update
            };
        });

        // Age-Check
        if (data[0]?.last_update) {
            const ageMs = Date.now() - new Date(data[0].last_update).getTime();
            const ageSec = Math.floor(ageMs / 1000);
            
            if (ageMs > 300000) { // > 5 Min
                logger.warn(`⚠️ Marktdaten sind ${ageSec}s alt - Update hängt wahrscheinlich!`);
            }
        }

        return formatted;

    } catch (err) {
        logger.error("❌ getMarketData Error:", err);
        return FALLBACK_PRICES;
    }
}

/**
 * Einzelner Coin-Preis
 */
export async function getCoinPrice(coinId) {
    const market = await getMarketData();
    const id = coinId.toLowerCase();
    const result = market[id];
    
    if (!result) {
        logger.error(`🚨 Unbekannter Coin: ${id}`);
        return FALLBACK_PRICES[id] || null;
    }
    
    return result;
}

/**
 * Status-Info
 */
export function getMarketUpdateStatus() {
    return {
        lastUpdate: lastSuccessfulUpdate,
        attempts: updateAttempts,
        consecutiveFailures,
        timeSinceUpdate: lastSuccessfulUpdate 
            ? Date.now() - lastSuccessfulUpdate.getTime() 
            : null
    };
}

/**
 * Test-Funktion für manuellen Trigger
 */
export async function testMarketUpdate() {
    logger.info("🧪 TEST: Manueller Markt-Update...");
    const result = await updateMarketPrices();
    const status = getMarketUpdateStatus();
    
    return {
        success: consecutiveFailures === 0,
        data: result,
        status
    };
}

// Initial-Fetch beim Import
logger.info("🚀 market.js geladen - starte Initial-Fetch...");
updateMarketPrices()
    .then(() => logger.info("✅ Initial-Fetch komplett"))
    .catch(e => logger.error("❌ Initial-Fetch Error:", e));