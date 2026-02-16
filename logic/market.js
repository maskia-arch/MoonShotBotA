// logic/market.js - V1.0.0 - FIXED: AbortController + kein Modul-Scope-Fetch
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

// In-Memory Cache mit TTL
let memoryCache = null;
let cacheTimestamp = null;
const CACHE_TTL_MS = 10000; // 10 Sekunden Cache

/**
 * FIX: Marktpreise aktualisieren mit AbortController (node-fetch v3 hat kein timeout!)
 */
export async function updateMarketPrices() {
    updateAttempts++;

    try {
        logger.info(`📊 [Update #${updateAttempts}] START`);

        // FIX: AbortController statt timeout-Property
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        logger.info(`   [1/4] API Call...`);
        const url = `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=BTC,LTC,ETH&tsyms=EUR`;

        let response;
        try {
            response = await fetch(url, {
                headers: { 'User-Agent': 'ValueTycoon/1.0.0' },
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeoutId);
        }

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

        // Cache invalidieren
        memoryCache = null;
        cacheTimestamp = null;
        logger.info(`   🔄 Cache invalidiert`);

        // Verify
        const verifyData = await getMarketDataFromDB();
        logger.info(`   ✅ Verify: ${Object.keys(verifyData).length} coins`);

        consecutiveFailures = 0;
        lastSuccessfulUpdate = new Date();

        logger.info(`✅ [Update #${updateAttempts}] ERFOLGREICH!`);

        return verifyData;

    } catch (err) {
        consecutiveFailures++;

        // FIX: AbortError erkennen
        if (err.name === 'AbortError') {
            logger.error(`❌ [Update #${updateAttempts}] TIMEOUT nach 15s (${consecutiveFailures}x)`);
        } else {
            logger.error(`❌ [Update #${updateAttempts}] FAILED (${consecutiveFailures}x): ${err.message}`);
        }

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

        memoryCache = null;
        cacheTimestamp = null;

        logger.info("✅ Fallback geschrieben");
    } catch (err) {
        logger.error("❌ Fallback Error:", err);
    }
}

/**
 * Marktdaten abrufen mit optionalem Cache
 */
export async function getMarketData(bypassCache = false) {
    try {
        if (!bypassCache && memoryCache && cacheTimestamp) {
            const cacheAge = Date.now() - cacheTimestamp;
            if (cacheAge < CACHE_TTL_MS) {
                logger.debug(`📦 Cache hit (${Math.floor(cacheAge / 1000)}s alt)`);
                return memoryCache;
            }
        }

        const data = await getMarketDataFromDB();

        memoryCache = data;
        cacheTimestamp = Date.now();

        return data;

    } catch (err) {
        logger.error("❌ getMarketData Error:", err);
        return FALLBACK_PRICES;
    }
}

/**
 * Direkt aus DB lesen
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
 * Cache manuell invalidieren
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

// FIX: KEIN Initial-Fetch mehr im Modul-Scope!
// Wird jetzt ausschließlich über main.js gesteuert.
logger.info("🚀 market.js V1.0.0 geladen (NO auto-fetch)");
