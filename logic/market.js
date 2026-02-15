// logic/market.js - V0.23 - MIT KURS-HISTORIE
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
 * V0.23: Aktualisiert Preise UND speichert Historie
 */
export async function updateMarketPrices() {
    updateAttempts++;
    
    try {
        logger.info(`📊 Markt-Update #${updateAttempts}`);
        
        const url = `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=BTC,LTC,ETH&tsyms=EUR`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'MoonShotBot/0.23' },
            timeout: 15000
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        if (data.Response === 'Error') throw new Error(data.Message);
        if (!data.RAW?.BTC?.EUR || !data.RAW?.LTC?.EUR || !data.RAW?.ETH?.EUR) {
            throw new Error("Unvollständige Daten");
        }

        // Daten extrahieren
        const updates = [
            {
                coin_id: 'bitcoin',
                price_eur: parseFloat(data.RAW.BTC.EUR.PRICE.toFixed(2)),
                change_24h: parseFloat(data.RAW.BTC.EUR.CHANGEPCT24HOUR.toFixed(2)),
                volume_24h: data.RAW.BTC.EUR.VOLUME24HOUR || 0
            },
            {
                coin_id: 'litecoin',
                price_eur: parseFloat(data.RAW.LTC.EUR.PRICE.toFixed(2)),
                change_24h: parseFloat(data.RAW.LTC.EUR.CHANGEPCT24HOUR.toFixed(2)),
                volume_24h: data.RAW.LTC.EUR.VOLUME24HOUR || 0
            },
            {
                coin_id: 'ethereum',
                price_eur: parseFloat(data.RAW.ETH.EUR.PRICE.toFixed(2)),
                change_24h: parseFloat(data.RAW.ETH.EUR.CHANGEPCT24HOUR.toFixed(2)),
                volume_24h: data.RAW.ETH.EUR.VOLUME24HOUR || 0
            }
        ];

        logger.info(`💰 BTC=${updates[0].price_eur}€, LTC=${updates[1].price_eur}€, ETH=${updates[2].price_eur}€`);

        // V0.23: Nutze neue Funktion die beides macht!
        for (const update of updates) {
            const { error } = await supabase.rpc('save_price_with_history', {
                p_coin_id: update.coin_id,
                p_price_eur: update.price_eur,
                p_change_24h: update.change_24h,
                p_volume_24h: update.volume_24h
            });

            if (error) {
                logger.error(`❌ RPC Error für ${update.coin_id}:`, error);
                throw new Error(`DB Error: ${error.message}`);
            }
        }

        // Verify
        const { data: verify } = await supabase
            .from('market_cache')
            .select('coin_id, price_eur, last_update')
            .order('coin_id');

        logger.info(`✅ Update erfolgreich! ${verify?.length || 0} coins in DB`);

        consecutiveFailures = 0;
        lastSuccessfulUpdate = new Date();
        
        return await getMarketData();

    } catch (err) {
        consecutiveFailures++;
        logger.error(`❌ Update #${updateAttempts} fehlgeschlagen (${consecutiveFailures}x): ${err.message}`);
        
        if (consecutiveFailures >= 3) {
            logger.warn(`⚠️ 3 Fehler - Fallback`);
            await writeFallbackToDatabase();
        }
        
        return await getMarketData();
    }
}

async function writeFallbackToDatabase() {
    try {
        for (const [coinId, data] of Object.entries(FALLBACK_PRICES)) {
            await supabase.rpc('save_price_with_history', {
                p_coin_id: coinId,
                p_price_eur: data.price,
                p_change_24h: data.change24h,
                p_volume_24h: 0
            });
        }
        logger.info("✅ Fallback geschrieben");
    } catch (err) {
        logger.error("❌ Fallback-Write Error:", err);
    }
}

export async function getMarketData() {
    try {
        const { data, error } = await supabase
            .from('market_cache')
            .select('*')
            .order('coin_id');
        
        if (error || !data || data.length === 0) {
            logger.warn("⚠️ market_cache leer");
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

        return formatted;
    } catch (err) {
        logger.error("❌ getMarketData Error:", err);
        return FALLBACK_PRICES;
    }
}

export async function getCoinPrice(coinId) {
    const market = await getMarketData();
    return market[coinId.toLowerCase()] || FALLBACK_PRICES[coinId.toLowerCase()] || null;
}

/**
 * NEU V0.23: Holt Preis-Historie für Charts
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
        logger.error("❌ getPriceHistory Error:", err);
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

// Initial-Fetch
logger.info("🚀 market.js V0.23 geladen");
updateMarketPrices()
    .then(() => logger.info("✅ Initial-Fetch komplett"))
    .catch(e => logger.error("❌ Initial-Fetch Error:", e));