# 🚀 MoonShot Tycoon v2.0

Ein vollständiges Krypto-Trading Telegram-Spiel mit Immobilien, Hebel-Trading, Achievements und Season-System.

## 📋 Features

### 🎮 Kern-Features
- **Live Krypto-Trading**: Bitcoin, Litecoin, Ethereum mit Echtzeit-Kursen
- **Hebel-Trading**: 2x bis 50x Leverage mit Liquidations-System
- **Immobilien-System**: 6 Immobilien-Typen (15k € bis 10M €)
- **Achievement-System**: Freischaltbare Belohnungen
- **Season-Ranglisten**: Monatliche Preisgelder
- **Wirtschafts-Simulation**: Mieten, Wartung, Zustandssystem

### 💰 Trading
- **3 Coins**: BTC, LTC, ETH mit Live-Kursen (CryptoCompare API)
- **Gebühren**: 0,5% pro Trade → Tax Pool für Preise
- **Anti-Wash-Trading**: Mindestens 1h Haltefrist für Immobilien-Volumen
- **Hebel**: 2x, 5x, 10x, 20x, 50x mit Liquidationsrisiko

### 🏠 Immobilien
- **6 Typen**:
  - Garage (15k €) - 110 €/24h Miete
  - Wohnung (85k €) - 450 €/24h
  - Haus (350k €) - 1.800 €/24h
  - Penthouse (1,2M €) - 6.500 €/24h
  - Gewerbe (2,5M €) - 15.000 €/24h
  - Wolkenkratzer (10M €) - 75.000 €/24h

- **Features**:
  - Automatische Mieteinnahmen alle 24h
  - Zustandssystem (0-100%)
  - Wartungskosten & Events
  - Verkauf für 80% des Kaufpreises

### 🏆 Achievements
- **Erster Trade**: 100 € Bonus
- **Immobilien-Mogul**: 5.000 € (5 Immobilien)
- **Millionär**: 10.000 € (1M € Vermögen)
- **High Roller**: 2.000 € (50x Hebel)
- **Portfolio König**: 25.000 € (Alle Immobilien-Typen)

### 📊 Season-System
- **30 Tage Seasons**
- **Ranglisten**:
  - Reichste Spieler
  - Höchster Profit
  - Wall of Shame (Verluste)
- **Preisgelder**: 30% des Tax Pools

## 🛠️ Installation

### Voraussetzungen
- Node.js 18+
- Supabase-Account
- Telegram Bot Token

### Setup

1. **Repository klonen**
```bash
git clone <your-repo>
cd MoonShotBotV2
```

2. **Dependencies installieren**
```bash
npm install
```

3. **Umgebungsvariablen setzen**
Erstelle `.env`:
```env
BOT_TOKEN=your_telegram_bot_token
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_anon_key
PORT=3000
```

4. **Supabase-Datenbank einrichten**
Führe die SQL-Befehle aus `database/schema.sql` in deiner Supabase-Instanz aus.

5. **Bot starten**
```bash
npm start
```

## 📁 Projekt-Struktur

```
MoonShotBotV2/
├── commands/          # Bot-Befehle
│   ├── start.js      # /start & Tutorial
│   ├── trade.js      # Trading-System
│   ├── immo.js       # Immobilien
│   ├── wallet.js     # Portfolio
│   ├── rank.js       # Ranglisten
│   └── achievements.js
├── logic/            # Game-Logik
│   ├── market.js     # Markt-Daten
│   ├── economy.js    # Wirtschafts-Tick
│   ├── events.js     # Zufallsevents
│   ├── liquidation.js # Hebel-Liquidation
│   └── tradeLogic.js # Trade-Berechnungen
├── ui/               # User Interface
│   ├── buttons.js    # Telegram-Buttons
│   └── layouts.js    # Text-Layouts
├── utils/            # Hilfsfunktionen
│   ├── formatter.js  # Formatierung
│   ├── logger.js     # Logging
│   └── versionLoader.js
├── supabase/         # Datenbank
│   ├── client.js     # Supabase-Client
│   └── queries.js    # DB-Queries
├── core/             # Kern-Systeme
│   └── scheduler.js  # Cron-Jobs
├── config.js         # Konfiguration
├── main.js           # Bot-Entry-Point
└── package.json
```

## 🎯 Game-Flow

### Für neue Spieler:
1. `/start` → Brief von Onkel Willi + 10.000 € Startkapital
2. Trading Center → Coins kaufen/verkaufen
3. 30.000 € Handelsvolumen erreichen
4. Immobilien freischalten
5. Passives Einkommen aufbauen
6. Achievements sammeln
7. Rangliste dominieren!

### Tägliche Aktivitäten:
- Markt beobachten (Live-Kurse alle 60s)
- Profite sichern
- Immobilien checken (Mieten, Wartung)
- Portfolio balancieren

## 🔧 Konfiguration

Alle Einstellungen in `config.js`:

```javascript
// Wirtschaft
INITIAL_CASH: 10000,
TRADING_FEE: 0.005,
MIN_VOL_FOR_REALESTATE: 30000,

// Zeitsteuerung
TICK_SPEED_MS: 3600000,        // Economy-Tick
MARKET_UPDATE_MS: 60000,       // Markt-Update
EVENT_CHECK_MS: 1800000,       // Event-Check

// Hebel
LEVERAGE: {
    MIN: 2,
    MAX: 50,
    AVAILABLE: [2, 5, 10, 20, 50]
}
```

## 📊 Datenbank-Schema

Haupttabellen:
- `profiles` - Spieler-Accounts
- `user_crypto` - Krypto-Bestände
- `user_assets` - Immobilien
- `transactions` - Transaktionsverlauf
- `season_stats` - Season-Statistiken
- `user_achievements` - Freigeschaltete Achievements
- `market_cache` - Aktuelle Kurse
- `global_economy` - Tax Pool

## 🚦 API-Limits

- **CryptoCompare**: ~100k Calls/Monat (Free Tier)
- **Telegram**: 30 Msgs/Sekunde
- **Supabase**: Siehe deinen Plan

## 💡 Tipps für Deployment

### Render.com / Railway:
```bash
# Build Command
npm install

# Start Command
npm start

# Environment Variables
BOT_TOKEN=...
SUPABASE_URL=...
SUPABASE_KEY=...
```

### Docker:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["npm", "start"]
```

## 🐛 Debugging

**Logger aktivieren:**
```javascript
// utils/logger.js
DEBUG: process.env.DEBUG === 'true' || true
```

**Logs checken:**
```bash
tail -f bot.log
```

## 📈 Roadmap

- [ ] NFT-System
- [ ] Team-Battles
- [ ] Börsengang (IPO-Feature)
- [ ] Multiplayer-Events
- [ ] Referral-System
- [ ] Premium-Features

## 🤝 Contributing

1. Fork das Projekt
2. Feature Branch erstellen
3. Commit deine Changes
4. Push zum Branch
5. Pull Request öffnen

## 📄 Lizenz

MIT License - siehe LICENSE Datei

## 👨‍💻 Support

Bei Fragen oder Problemen:
- GitHub Issues öffnen
- Telegram: @yourusername

---

**Made with ❤️ for the Crypto Community**

🚀 MoonShot Tycoon - *To the Moon!*
