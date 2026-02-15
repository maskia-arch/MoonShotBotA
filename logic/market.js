// logic/market.js
import fetch from 'node-fetch';
import { supabase } from '../supabase/client.js';
import { logger } from '../utils/logger.js';

const FALLBACK_PRICES = {
    bitcoin: { price: 61500, change24h: 0.5 },
    litecoin: { price: 41.20, change24h: -0.2 },
    ethereum: { price: 2150, change24h: 1.2 }
};

export async function updateMarketPrices() {
    try {
        const url = `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=BTC,LTC,ETH&tsyms=EUR`;
        const response = await fetch(url);
        const data = await response.json();

        if (!data.RAW) throw new Error("API-Limit erreicht");

        const updates = [
            { coin_id: 'bitcoin', price_eur: parseFloat(data.RAW.BTC.EUR.PRICE.toFixed(2)), 
              change_24h: parseFloat(data.RAW.BTC.EUR.CHANGEPCT24HOUR.toFixed(2)), last_update: new Date() },
            { coin_id: 'litecoin', price_eur: parseFloat(data.RAW.LTC.EUR.PRICE.toFixed(2)), 
              change_24h: parseFloat(data.RAW.LTC.EUR.CHANGEPCT24HOUR.toFixed(2)), last_update: new Date() },
            { coin_id: 'ethereum', price_eur: parseFloat(data.RAW.ETH.EUR.PRICE.toFixed(2)), 
              change_24h: parseFloat(data.RAW.ETH.EUR.CHANGEPCT24HOUR.toFixed(2)), last_update: new Date() }
        ];

        await supabase.from('market_cache').upsert(updates);
        logger.debug("✅ Markt aktualisiert");
        return getMarketData();
    } catch (err) {
        logger.error(`Markt-Update fehlgeschlagen: ${err.message}`);
        return FALLBACK_PRICES;
    }
}

export async function getMarketData() {
    try {
        const { data } = await supabase.from('market_cache').select('*');
        if (!data || data.length === 0) return FALLBACK_PRICES;
        
        const formatted = {};
        data.forEach(row => {
            formatted[row.coin_id] = { 
                price: parseFloat(row.price_eur), 
                change24h: parseFloat(row.change_24h) 
            };
        });
        return formatted;
    } catch { return FALLBACK_PRICES; }
}

export async function getCoinPrice(coinId) {
    const market = await getMarketData();
    return market[coinId.toLowerCase()] || FALLBACK_PRICES[coinId.toLowerCase()] || null;
}

updateMarketPrices().catch(e => logger.error("Init fetch failed", e));
