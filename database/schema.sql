-- MoonShot Tycoon Database Schema
-- Für Supabase PostgreSQL

-- Spieler-Profile
CREATE TABLE IF NOT EXISTS profiles (
    id BIGINT PRIMARY KEY,
    username TEXT,
    balance DECIMAL(15,2) DEFAULT 10000.00,
    trading_volume DECIMAL(15,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Krypto-Bestände
CREATE TABLE IF NOT EXISTS user_crypto (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES profiles(id) ON DELETE CASCADE,
    coin_id TEXT NOT NULL,
    amount DECIMAL(20,8) NOT NULL DEFAULT 0,
    avg_buy_price DECIMAL(15,2) NOT NULL DEFAULT 0,
    leverage INTEGER DEFAULT 1,
    entry_price DECIMAL(15,2),
    liquidation_price DECIMAL(15,2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, coin_id)
);

-- Immobilien
CREATE TABLE IF NOT EXISTS user_assets (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES profiles(id) ON DELETE CASCADE,
    asset_type TEXT NOT NULL,
    purchase_price DECIMAL(15,2) NOT NULL,
    condition INTEGER DEFAULT 100 CHECK (condition >= 0 AND condition <= 100),
    last_rent_collection TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transaktionen
CREATE TABLE IF NOT EXISTS transactions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);

-- Season-Statistiken
CREATE TABLE IF NOT EXISTS season_stats (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    season_profit DECIMAL(15,2) DEFAULT 0,
    season_loss DECIMAL(15,2) DEFAULT 0,
    trades_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Achievements
CREATE TABLE IF NOT EXISTS user_achievements (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES profiles(id) ON DELETE CASCADE,
    achievement_id TEXT NOT NULL,
    unlocked_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, achievement_id)
);

-- Markt-Cache
CREATE TABLE IF NOT EXISTS market_cache (
    id BIGSERIAL PRIMARY KEY,
    coin_id TEXT UNIQUE NOT NULL,
    price_eur DECIMAL(15,2) NOT NULL,
    change_24h DECIMAL(10,2) DEFAULT 0,
    last_update TIMESTAMPTZ DEFAULT NOW()
);

-- Globale Wirtschaft
CREATE TABLE IF NOT EXISTS global_economy (
    id INTEGER PRIMARY KEY DEFAULT 1,
    tax_pool DECIMAL(15,2) DEFAULT 0,
    total_volume DECIMAL(15,2) DEFAULT 0,
    last_season_reset TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO global_economy (id) VALUES (1) ON CONFLICT DO NOTHING;

-- RPC-Funktionen

-- Balance erhöhen/verringern (Atomic)
CREATE OR REPLACE FUNCTION increment_balance(user_id BIGINT, amount DECIMAL)
RETURNS VOID AS $$
BEGIN
    UPDATE profiles SET balance = balance + amount WHERE id = user_id;
END;
$$ LANGUAGE plpgsql;

-- Trade-Kauf ausführen
CREATE OR REPLACE FUNCTION execute_trade_buy(
    p_user_id BIGINT,
    p_total_cost DECIMAL,
    p_fee DECIMAL
) RETURNS VOID AS $$
BEGIN
    UPDATE profiles SET balance = balance - p_total_cost WHERE id = p_user_id;
    UPDATE global_economy SET tax_pool = tax_pool + p_fee WHERE id = 1;
END;
$$ LANGUAGE plpgsql;

-- Trade-Verkauf ausführen
CREATE OR REPLACE FUNCTION execute_trade_sell(
    p_user_id BIGINT,
    p_payout DECIMAL,
    p_fee DECIMAL,
    p_volume DECIMAL
) RETURNS VOID AS $$
BEGIN
    UPDATE profiles SET 
        balance = balance + p_payout,
        trading_volume = trading_volume + p_volume
    WHERE id = p_user_id;
    
    UPDATE global_economy SET tax_pool = tax_pool + p_fee WHERE id = 1;
END;
$$ LANGUAGE plpgsql;

-- Handelsvolumen hinzufügen
CREATE OR REPLACE FUNCTION add_trading_volume(
    p_user_id BIGINT,
    p_volume DECIMAL
) RETURNS VOID AS $$
BEGIN
    UPDATE profiles SET trading_volume = trading_volume + p_volume WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- Indizes für Performance
CREATE INDEX IF NOT EXISTS idx_user_crypto_user ON user_crypto(user_id);
CREATE INDEX IF NOT EXISTS idx_user_assets_user ON user_assets(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_balance ON profiles(balance DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_volume ON profiles(trading_volume DESC);

-- Initial Market Data
INSERT INTO market_cache (coin_id, price_eur, change_24h) VALUES
    ('bitcoin', 61500.00, 0.5),
    ('litecoin', 41.20, -0.2),
    ('ethereum', 2150.00, 1.2)
ON CONFLICT (coin_id) DO NOTHING;

