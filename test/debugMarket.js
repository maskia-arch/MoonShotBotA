// test/debugMarket.js - MANUELLER TEST für Markt-Updates
// Nutze dieses Script um Updates manuell zu testen!

import { supabase } from '../supabase/client.js';
import fetch from 'node-fetch';

console.log("🧪 === MARKET UPDATE DEBUG TEST ===\n");

async function testSupabaseConnection() {
    console.log("1️⃣ Teste Supabase-Verbindung...");
    
    try {
        const { data, error } = await supabase
            .from('market_cache')
            .select('*')
            .limit(1);
        
        if (error) {
            console.error("❌ Supabase Error:", error);
            return false;
        }
        
        console.log("✅ Supabase verbunden!");
        console.log(`   Gefundene Rows: ${data?.length || 0}`);
        return true;
    } catch (err) {
        console.error("❌ Connection Error:", err.message);
        return false;
    }
}

async function testCryptoCompareAPI() {
    console.log("\n2️⃣ Teste CryptoCompare API...");
    
    try {
        const url = 'https://min-api.cryptocompare.com/data/pricemultifull?fsyms=BTC,LTC,ETH&tsyms=EUR';
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.Response === 'Error') {
            console.error("❌ API Error:", data.Message);
            return false;
        }
        
        console.log("✅ API erreichbar!");
        console.log(`   BTC: ${data.RAW.BTC.EUR.PRICE.toFixed(2)}€`);
        console.log(`   LTC: ${data.RAW.LTC.EUR.PRICE.toFixed(2)}€`);
        console.log(`   ETH: ${data.RAW.ETH.EUR.PRICE.toFixed(2)}€`);
        return data;
    } catch (err) {
        console.error("❌ API Error:", err.message);
        return false;
    }
}

async function testSupabaseWrite(apiData) {
    console.log("\n3️⃣ Teste Supabase WRITE...");
    
    try {
        const testData = {
            coin_id: 'bitcoin',
            price_eur: parseFloat(apiData.RAW.BTC.EUR.PRICE.toFixed(2)),
            change_24h: parseFloat(apiData.RAW.BTC.EUR.CHANGEPCT24HOUR.toFixed(2)),
            last_update: new Date().toISOString()
        };
        
        console.log("   Schreibe:", testData);
        
        const { data, error } = await supabase
            .from('market_cache')
            .upsert(testData, { onConflict: 'coin_id' })
            .select();
        
        if (error) {
            console.error("❌ Write Error:", error);
            console.error("   Code:", error.code);
            console.error("   Details:", error.details);
            console.error("   Hint:", error.hint);
            return false;
        }
        
        console.log("✅ Write erfolgreich!");
        console.log("   Affected:", data?.length || 0);
        return true;
    } catch (err) {
        console.error("❌ Write Exception:", err.message);
        return false;
    }
}

async function testSupabaseRead() {
    console.log("\n4️⃣ Teste Supabase READ...");
    
    try {
        const { data, error } = await supabase
            .from('market_cache')
            .select('*')
            .order('coin_id');
        
        if (error) {
            console.error("❌ Read Error:", error);
            return false;
        }
        
        console.log("✅ Read erfolgreich!");
        console.log(`   Rows: ${data?.length || 0}`);
        
        data?.forEach(row => {
            const age = Math.floor((Date.now() - new Date(row.last_update).getTime()) / 1000);
            console.log(`   ${row.coin_id}: ${row.price_eur}€ (${age}s alt)`);
        });
        
        return true;
    } catch (err) {
        console.error("❌ Read Exception:", err.message);
        return false;
    }
}

async function checkRLS() {
    console.log("\n5️⃣ Prüfe RLS (Row Level Security)...");
    
    try {
        // Versuche direkt zu updaten
        const { data, error } = await supabase
            .from('market_cache')
            .update({ 
                price_eur: 99999.99,
                last_update: new Date().toISOString()
            })
            .eq('coin_id', 'bitcoin')
            .select();
        
        if (error) {
            if (error.code === '42501' || error.message.includes('policy')) {
                console.error("❌ RLS BLOCKIERT UPDATES!");
                console.error("   → Führe fix_v022.sql in Supabase aus!");
                return false;
            }
            console.error("❌ Update Error:", error.message);
            return false;
        }
        
        console.log("✅ RLS OK - Updates erlaubt!");
        
        // Zurücksetzen
        await testCryptoCompareAPI().then(apiData => {
            if (apiData) {
                supabase.from('market_cache').update({
                    price_eur: parseFloat(apiData.RAW.BTC.EUR.PRICE.toFixed(2)),
                    last_update: new Date().toISOString()
                }).eq('coin_id', 'bitcoin');
            }
        });
        
        return true;
    } catch (err) {
        console.error("❌ RLS Check Error:", err.message);
        return false;
    }
}

// === HAUPT-TEST ===
async function runAllTests() {
    console.log("🚀 Starte Tests...\n");
    
    const results = {
        supabase: await testSupabaseConnection(),
        api: false,
        write: false,
        read: false,
        rls: false
    };
    
    if (!results.supabase) {
        console.error("\n🚨 Supabase-Verbindung fehlgeschlagen!");
        console.error("   Prüfe SUPABASE_URL und SUPABASE_KEY in .env");
        return;
    }
    
    const apiData = await testCryptoCompareAPI();
    results.api = !!apiData;
    
    if (!results.api) {
        console.error("\n🚨 API nicht erreichbar!");
        console.error("   Prüfe Internet-Verbindung");
        return;
    }
    
    results.write = await testSupabaseWrite(apiData);
    results.read = await testSupabaseRead();
    results.rls = await checkRLS();
    
    // === ZUSAMMENFASSUNG ===
    console.log("\n" + "=".repeat(40));
    console.log("📊 TEST-ERGEBNIS:");
    console.log("=".repeat(40));
    console.log(`Supabase Verbindung: ${results.supabase ? '✅' : '❌'}`);
    console.log(`CryptoCompare API: ${results.api ? '✅' : '❌'}`);
    console.log(`Supabase WRITE: ${results.write ? '✅' : '❌'}`);
    console.log(`Supabase READ: ${results.read ? '✅' : '❌'}`);
    console.log(`RLS Check: ${results.rls ? '✅' : '❌'}`);
    console.log("=".repeat(40));
    
    if (Object.values(results).every(r => r)) {
        console.log("\n🎉 ALLE TESTS ERFOLGREICH!");
        console.log("   Markt-Updates sollten funktionieren!");
    } else {
        console.log("\n🚨 FEHLER GEFUNDEN!");
        
        if (!results.write || !results.rls) {
            console.log("\n💡 LÖSUNG:");
            console.log("   1. Gehe zu Supabase → SQL Editor");
            console.log("   2. Führe database/fix_v022.sql aus");
            console.log("   3. Starte den Bot neu");
        }
    }
    
    console.log("\n✅ Test abgeschlossen!");
}

// Script ausführen
runAllTests().catch(err => {
    console.error("\n💥 KRITISCHER FEHLER:", err);
    process.exit(1);
});