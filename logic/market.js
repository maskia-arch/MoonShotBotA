// logic/market.js - V0.23.1 - OHNE RPC, DIREKTES SCHREIBEN
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
 * V0.23.1: VEREINFACHT - Direktes Schreiben ohne RPC
 */
export async function updateMarketPrices() {
    updateAttempts++;
    
    try {
        logger.info(`📊 [Update #${updateAttempts}] START`);
        
        // === STEP 1: API Call ===
        logger.info(`   [1/4] Rufe CryptoCompare API...`);
        const url = `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=BTC,LTC,ETH&tsyms=EUR`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'MoonShotBot/0.23.1' },
            timeout: 15000
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        logger.info(`   ✅ API Response OK`);

        if (data.Response === 'Error') {
            throw new Error(`API Error: ${data.Message}`);
        }

        if (!data.RAW?.BTC?.EUR || !data.RAW?.LTC?.EUR || !data.RAW?.ETH?.EUR) {
            throw new Error("Unvollständige API-Daten");
        }

        // === STEP 2: Daten extrahieren ===
        logger.info(`   [2/4] Extrahiere Preise...`);
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

        // === STEP 3: In market_cache schreiben (DIREKT!) ===
        logger.info(`   [3/4] Schreibe in market_cache...`);
        
        for (const [coinId, priceData] of Object.entries(prices)) {
            logger.info(`      → ${coinId}...`);
            
            const { data: upsertData, error: upsertError } = await supabase
                .from('market_cache')
                .upsert({
                    coin_id: coinId,
                    price_eur: priceData.price_eur,
                    change_24h: priceData.change_24h,
                    last_update: new Date().toISOString()
                }, { 
                    onConflict: 'coin_id',
                    ignoreDuplicates: false
                })
                .select();

            if (upsertError) {
                logger.error(`      ❌ Upsert Error für ${coinId}:`, upsertError);
                throw new Error(`DB Write Error: ${upsertError.message} (${upsertError.code})`);
            }

            logger.info(`      ✅ ${coinId} geschrieben (${upsertData?.length || 0} rows)`);
        }

        // === STEP 4: In price_history schreiben (SEPARAT!) ===
        logger.info(`   [4/4] Speichere Historie...`);
        
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
            // Historie ist optional - loggen aber nicht crashen
            logger.warn(`   ⚠️ Historie-Write failed: ${historyError.message}`);
        } else {
            logger.info(`   ✅ Historie gespeichert (${historyEntries.length} entries)`);
        }

        // === VERIFY: Lesen zurück ===
        logger.info(`   [VERIFY] Lese zurück aus DB...`);
        const { data: verifyData, error: verifyError } = await supabase
            .from('market_cache')
            .select('coin_id, price_eur, last_update')
            .order('coin_id');

        if (verifyError) {
            logger.error(`   ❌ Verify failed:`, verifyError);
        } else if (!verifyData || verifyData.length === 0) {
            logger.error(`   ❌ DB ist leer nach Write!`);
            throw new Error("Verify failed: DB leer");
        } else {
            logger.info(`   ✅ Verify OK: ${verifyData.length} coins in DB`);
            verifyData.forEach(row => {
                const ageMs = Date.now() - new Date(row.last_update).getTime();
                logger.info(`      • ${row.coin_id}: ${row.price_eur}€ (${Math.floor(ageMs/1000)}s alt)`);
            });
        }

        // Reset Failures
        consecutiveFailures = 0;
        lastSuccessfulUpdate = new Date();
        
        logger.info(`✅ [Update #${updateAttempts}] ERFOLGREICH!`);
        logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        
        return await getMarketData();

    } catch (err) {
        consecutiveFailures++;
        logger.error(`❌ [Update #${updateAttempts}] FEHLGESCHLAGEN (${consecutiveFailures}x):`);
        logger.error(`   Error: ${err.message}`);
        logger.error(`   Stack: ${err.stack}`);
        
        if (consecutiveFailures >= 3) {
            logger.warn(`⚠️ 3+ Fehler in Folge - schreibe Fallback`);
            await writeFallbackToDatabase();
        }
        
        return await getMarketData();
    }
}

/**
 * Fallback: Schreibt statische Preise wenn API komplett down
 */
async function writeFallbackToDatabase() {
    try {
        logger.info("💾 Schreibe Fallback-Preise...");
        
        for (const [coinId, data] of Object.entries(FALLBACK_PRICES)) {
            const { error } = await supabase
                .from('market_cache')
                .upsert({
                    coin_id: coinId,
                    price_eur: data.price,
                    change_24h: data.change24h,
                    last_update: new Date().toISOString()
                }, { onConflict: 'coin_id' });

            if (error) {
                logger.error(`   ❌ Fallback ${coinId} Error:`, error);
            } else {
                logger.info(`   ✅ Fallback ${coinId} geschrieben`);
            }
        }
        
        logger.info("✅ Fallback komplett");
    } catch (err) {
        logger.error("❌ Kritischer Fallback-Fehler:", err);
    }
}

/**
 * Marktdaten aus DB lesen
 */
export async function getMarketData() {
    try {
        const { data, error } = await supabase
            .from('market_cache')
            .select('*')
            .order('coin_id');
        
        if (error) {
            logger.error("❌ getMarketData DB-Error:", error);
            return FALLBACK_PRICES;
        }

        if (!data || data.length === 0) {
            logger.warn("⚠️ market_cache ist LEER!");
            return FALLBACK_PRICES;
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
            const ageSec = Math.floor(ageMs / 1000);
            
            if (ageMs > 300000) {
                logger.warn(`⚠️ Daten sind ${ageSec}s alt!`);
            }
        }

        return formatted;

    } catch (err) {
        logger.error("❌ getMarketData Exception:", err);
        return FALLBACK_PRICES;
    }
}

export async function getCoinPrice(coinId) {
    const market = await getMarketData();
    return market[coinId.toLowerCase()] || FALLBACK_PRICES[coinId.toLowerCase()] || null;
}

/**
 * NEU: Preis-Historie abrufen (ohne RPC)
 */
export async function getPriceHistory(coinId, hours = 24) {
    try {
        const { data, error } = await supabase
            .from('price_history')
            .select('price_eur, recorded_at')
            .eq('coin_id', coinId.toLowerCase())
            .gte('recorded_at', new Date(Date.now() - hours * 60 * 60 * 1000).toISOString())
            .order('recorded_at', { ascending: true });

        if (error) {
            logger.error("getPriceHistory Error:", error);
            return [];
        }
        
        return data || [];
    } catch (err) {
        logger.error("getPriceHistory Exception:", err);
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
            : null
    };
}

/**
 * NEU: Debug-Info für Troubleshooting
 */
export async function getMarketDebugInfo() {
    try {
        const { data: cacheData } = await supabase
            .from('market_cache')
            .select('*')
            .order('coin_id');

        const { data: historyCount } = await supabase
            .from('price_history')
            .select('coin_id', { count: 'exact', head: true });

        const status = getMarketUpdateStatus();

        return {
            status,
            cache: cacheData || [],
            historyEntries: historyCount?.length || 0,
            timestamp: new Date().toISOString()
        };
    } catch (err) {
        logger.error("Debug Info Error:", err);
        return { error: err.message };
    }
}

// Initial-Fetch
logger.info("🚀 market.js V0.23.1 geladen (DIRECT WRITE)");
updateMarketPrices()
    .then(() => logger.info("✅ Initial-Fetch komplett"))
    .catch(e => logger.error("❌ Initial-Fetch Error:", e));
