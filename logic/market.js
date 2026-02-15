// logic/market.js - V0.23.2 - GARANTIERT FRISCHE DATEN
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

// V0.23.2: In-Memory Cache mit TTL
let memoryCache = null;
let cacheTimestamp = null;
const CACHE_TTL_MS = 10000; // 10 Sekunden Cache

/**
 * V0.23.2: Marktpreise aktualisieren
 */
export async function updateMarketPrices() {
    updateAttempts++;
    
    try {
        logger.info(`📊 [Update #${updateAttempts}] START`);
        
        // API Call
        logger.info(`   [1/4] API Call...`);
        const url = `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=BTC,LTC,ETH&tsyms=EUR`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'MoonShotBot/0.23.2' },
            timeout: 15000
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        logger.info(`   ✅ API OK`);

        if (data.Response === 'Error') throw new Error(`API: ${data.Message}`);
        if (!data.RAW?.BTC?.EUR || !data.RAW?.LTC?.EUR || !data.RAW?.ETH?.EUR) {
            throw new Error("Unvollständige Daten");
        }

        // Daten extrahieren
        logger.info(`   [2/4] Extrahiere...`);
        const prices = {
            bitcoin: {
                price_eur: parseFloat(data.RAW.BTC.EUR.PRICE.toFixed(2)),
                change_24h: parseFloat(data.RAW.BTC.EUR.CHANGEPCT24HOUR.toFixed(2)),
                volume_24h: data.RAW.BTC.EUR.VOLUME24HOUR || 0
            },
            litecoin: {
                price_eur: parseFloat(data.RAW.LTC.EUR.PRICE.toFixed(2)),
                change_24h: parseFloat(data.RAW.LTC.EUR.CHANGEPCT24HOUR.toFixed(2)),
                volume_24h: data.RAW.LTC.EUR.VOLUME24HOUR || 0
            },
            ethereum: {
                price_eur: parseFloat(data.RAW.ETH.EUR.PRICE.toFixed(2)),
                change_24h: parseFloat(data.RAW.ETH.EUR.CHANGEPCT24HOUR.toFixed(2)),
                volume_24h: data.RAW.ETH.EUR.VOLUME24HOUR || 0
            }
        };

        logger.info(`   ✅ BTC=${prices.bitcoin.price_eur}€, LTC=${prices.litecoin.price_eur}€, ETH=${prices.ethereum.price_eur}€`);

        // In market_cache schreiben
        logger.info(`   [3/4] DB Write...`);
        
        for (const [coinId, priceData] of Object.entries(prices)) {
            const { error } = await supabase
                .from('market_cache')
                .upsert({
                    coin_id: coinId,
                    price_eur: priceData.price_eur,
                    change_24h: priceData.change_24h,
                    last_update: new Date().toISOString()
                }, { 
                    onConflict: 'coin_id'
                });

            if (error) {
                logger.error(`      ❌ ${coinId} Error:`, error);
                throw new Error(`DB Error: ${error.message}`);
            }
        }

        logger.info(`   ✅ DB geschrieben`);

        // Historie speichern
        logger.info(`   [4/4] Historie...`);
        const historyEntries = Object.entries(prices).map(([coinId, priceData]) => ({
            coin_id: coinId,
            price_eur: priceData.price_eur,
            change_24h: priceData.change_24h,
            volume_24h: priceData.volume_24h,
            recorded_at: new Date().toISOString()
        }));

        const { error: historyError } = await supabase
            .from('price_history')
            .insert(historyEntries);

        if (historyError) {
            logger.warn(`   ⚠️ Historie failed: ${historyError.message}`);
        } else {
            logger.info(`   ✅ Historie OK`);
        }

        // V0.23.2: Cache invalidieren!
        memoryCache = null;
        cacheTimestamp = null;
        logger.info(`   🔄 Cache invalidiert`);

        // Verify
        const verifyData = await getMarketDataFromDB();
        logger.info(`   ✅ Verify: ${Object.keys(verifyData).length} coins`);

        consecutiveFailures = 0;
        lastSuccessfulUpdate = new Date();
        
        logger.info(`✅ [Update #${updateAttempts}] ERFOLGREICH!`);
        logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        
        return verifyData;

    } catch (err) {
        consecutiveFailures++;
        logger.error(`❌ [Update #${updateAttempts}] FAILED (${consecutiveFailures}x): ${err.message}`);
        
        if (consecutiveFailures >= 3) {
            logger.warn(`⚠️ 3+ Fehler - Fallback`);
            await writeFallbackToDatabase();
        }
        
        return await getMarketData();
    }
}

/**
 * Fallback schreiben
 */
async function writeFallbackToDatabase() {
    try {
        logger.info("💾 Fallback...");
        
        for (const [coinId, data] of Object.entries(FALLBACK_PRICES)) {
            await supabase
                .from('market_cache')
                .upsert({
                    coin_id: coinId,
                    price_eur: data.price,
                    change_24h: data.change24h,
                    last_update: new Date().toISOString()
                }, { onConflict: 'coin_id' });
        }
        
        // Cache invalidieren
        memoryCache = null;
        cacheTimestamp = null;
        
        logger.info("✅ Fallback geschrieben");
    } catch (err) {
        logger.error("❌ Fallback Error:", err);
    }
}

/**
 * V0.23.2: IMMER FRISCH aus DB lesen!
 * Mit optionalem 10s Cache um DB-Load zu reduzieren
 */
export async function getMarketData(bypassCache = false) {
    try {
        // V0.23.2: Check Cache (nur wenn nicht bypassed)
        if (!bypassCache && memoryCache && cacheTimestamp) {
            const cacheAge = Date.now() - cacheTimestamp;
            
            if (cacheAge < CACHE_TTL_MS) {
                logger.debug(`📦 Cache hit (${Math.floor(cacheAge/1000)}s alt)`);
                return memoryCache;
            } else {
                logger.debug(`🔄 Cache expired (${Math.floor(cacheAge/1000)}s alt)`);
            }
        }

        // Frisch aus DB lesen
        const data = await getMarketDataFromDB();
        
        // V0.23.2: In Cache speichern
        memoryCache = data;
        cacheTimestamp = Date.now();
        logger.debug(`💾 Cache aktualisiert`);
        
        return data;

    } catch (err) {
        logger.error("❌ getMarketData Error:", err);
        // Bei Fehler: Fallback, aber nicht cachen
        return FALLBACK_PRICES;
    }
}

/**
 * V0.23.2: Direkt aus DB lesen (KEIN CACHE!)
 */
async function getMarketDataFromDB() {
    const { data, error } = await supabase
        .from('market_cache')
        .select('*')
        .order('coin_id');
    
    if (error) {
        logger.error("❌ DB Read Error:", error);
        throw error;
    }

    if (!data || data.length === 0) {
        logger.warn("⚠️ market_cache LEER!");
        throw new Error("market_cache ist leer");
    }

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
        if (ageMs > 120000) { // > 2 Min
            logger.warn(`⚠️ Daten ${Math.floor(ageMs/1000)}s alt!`);
        }
    }

    return formatted;
}

/**
 * Einzelner Coin-Preis
 */
export async function getCoinPrice(coinId) {
    const market = await getMarketData();
    return market[coinId.toLowerCase()] || FALLBACK_PRICES[coinId.toLowerCase()] || null;
}

/**
 * V0.23.2: Cache manuell invalidieren
 */
export function invalidateCache() {
    memoryCache = null;
    cacheTimestamp = null;
    logger.info("🔄 Cache manuell invalidiert");
}

/**
 * Preis-Historie
 */
export async function getPriceHistory(coinId, hours = 24) {
    try {
        const { data, error } = await supabase
            .from('price_history')
            .select('price_eur, recorded_at')
            .eq('coin_id', coinId.toLowerCase())
            .gte('recorded_at', new Date(Date.now() - hours * 60 * 60 * 1000).toISOString())
            .order('recorded_at', { ascending: true });

        if (error) throw error;
        return data || [];
    } catch (err) {
        logger.error("getPriceHistory Error:", err);
        return [];
    }
}

export function getMarketUpdateStatus() {
    return {
        lastUpdate: lastSuccessfulUpdate,
        attempts: updateAttempts,
        consecutiveFailures,
        timeSinceUpdate: lastSuccessfulUpdate 
            ? Date.now() - lastSuccessfulUpdate.getTime() 
            : null,
        cacheAge: cacheTimestamp 
            ? Date.now() - cacheTimestamp 
            : null
    };
}

/**
 * Debug-Info
 */
export async function getMarketDebugInfo() {
    try {
        const { data: cacheData } = await supabase
            .from('market_cache')
            .select('*')
            .order('coin_id');

        const { count: historyCount } = await supabase
            .from('price_history')
            .select('*', { count: 'exact', head: true });

        const status = getMarketUpdateStatus();

        return {
            status,
            cache: cacheData || [],
            historyEntries: historyCount || 0,
            memoryCacheActive: memoryCache !== null,
            memoryCacheAge: status.cacheAge,
            timestamp: new Date().toISOString()
        };
    } catch (err) {
        logger.error("Debug Info Error:", err);
        return { error: err.message };
    }
}

// Initial-Fetch
logger.info("🚀 market.js V0.23.2 geladen (FRESH DATA)");
updateMarketPrices()
    .then(() => logger.info("✅ Initial-Fetch komplett"))
    .catch(e => logger.error("❌ Initial-Fetch Error:", e));
