// app.js - ValueTycoon Web App (Telegram Mini App)
// =================================================

const API_BASE = window.location.origin + '/api';
const tg = window.Telegram?.WebApp;

// State
let state = {
    user: null,
    market: {},
    portfolio: null,
    currentPage: 'market'
};

// =========================================
// API Helper
// =========================================
async function api(endpoint, options = {}) {
    const headers = { 'Content-Type': 'application/json' };

    if (tg?.initData) {
        headers['X-Telegram-Init-Data'] = tg.initData;
    }

    const res = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: { ...headers, ...options.headers }
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unbekannter Fehler' }));
        throw new Error(err.error || `HTTP ${res.status}`);
    }

    return res.json();
}

// =========================================
// Formatting
// =========================================
function formatEUR(amount) {
    return new Intl.NumberFormat('de-DE', {
        style: 'currency', currency: 'EUR',
        minimumFractionDigits: 2, maximumFractionDigits: 2
    }).format(amount || 0);
}

function formatCrypto(amount) {
    return new Intl.NumberFormat('de-DE', {
        minimumFractionDigits: 2, maximumFractionDigits: 8
    }).format(amount || 0);
}

function formatPercent(val) {
    const v = parseFloat(val || 0);
    const sign = v >= 0 ? '+' : '';
    return `${sign}${v.toFixed(2)}%`;
}

function coinIcon(id) {
    const icons = { bitcoin: '₿', litecoin: 'Ł', ethereum: 'Ξ' };
    return icons[id] || '🪙';
}

// =========================================
// Toast
// =========================================
function showToast(msg, type = 'success') {
    let toast = document.querySelector('.toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = `toast ${type}`;
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// =========================================
// Navigation
// =========================================
function navigate(page) {
    state.currentPage = page;

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.page === page);
    });

    const content = document.getElementById('content');

    switch (page) {
        case 'market': renderMarket(content); break;
        case 'portfolio': renderPortfolio(content); break;
        case 'immo': renderImmo(content); break;
        case 'rank': renderRank(content); break;
        case 'profile': renderProfile(content); break;
    }
}

// =========================================
// Market Page
// =========================================
async function renderMarket(el) {
    el.innerHTML = '<div class="page-title">📊 Live-Markt</div><div id="coin-list"></div>';

    try {
        const data = await api('/market');
        state.market = data.coins;
        updateHeader();

        const list = document.getElementById('coin-list');
        list.innerHTML = Object.entries(data.coins).map(([id, coin]) => {
            const isUp = coin.change24h >= 0;
            return `
                <div class="coin-row" onclick="openTrade('${id}')">
                    <div class="coin-info">
                        <span class="coin-icon">${coinIcon(id)}</span>
                        <div>
                            <div class="coin-name">${id.charAt(0).toUpperCase() + id.slice(1)}</div>
                            <div class="coin-symbol">${id.toUpperCase()}/EUR</div>
                        </div>
                    </div>
                    <div class="coin-price">
                        <div class="price">${formatEUR(coin.price)}</div>
                        <div class="change ${isUp ? 'positive' : 'negative'}">${formatPercent(coin.change24h)}</div>
                    </div>
                </div>
            `;
        }).join('');

        if (data.age) {
            list.innerHTML += `<p style="text-align:center;color:var(--text-dim);font-size:11px;margin-top:12px;">
                Aktualisiert vor ${data.age}s</p>`;
        }
    } catch (err) {
        el.innerHTML += `<div class="empty-state"><div class="emoji">⚠️</div><p>${err.message}</p></div>`;
    }
}

// =========================================
// Trade Modal
// =========================================
window.openTrade = async function(coinId) {
    try {
        const info = await api(`/trade/info/${coinId}`);
        showTradeModal(coinId, info);
    } catch (err) {
        showToast(err.message, 'error');
    }
};

function showTradeModal(coinId, info) {
    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    const isUp = info.change24h >= 0;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
        <div class="modal">
            <div class="modal-handle"></div>
            <h2>${coinIcon(coinId)} ${coinId.toUpperCase()}/EUR</h2>

            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-label">Kurs</div>
                    <div class="stat-value">${formatEUR(info.price)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">24h</div>
                    <div class="stat-value ${isUp ? 'green' : 'red'}">${formatPercent(info.change24h)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Guthaben</div>
                    <div class="stat-value">${formatEUR(info.balance)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Bestand</div>
                    <div class="stat-value">${formatCrypto(info.holdings)}</div>
                </div>
            </div>

            <div class="tabs" id="trade-tabs">
                <button class="tab active" data-type="buy">Kaufen</button>
                <button class="tab" data-type="sell">Verkaufen</button>
                <button class="tab" data-type="leverage">Hebel</button>
            </div>

            <div id="trade-form">
                <div class="input-group">
                    <label>Anzahl ${coinId.toUpperCase()}</label>
                    <input type="number" id="trade-amount" step="0.00000001" placeholder="0.00"
                           inputmode="decimal">
                    <div class="input-hint" id="trade-max">Max: ${formatCrypto(info.maxBuy)}</div>
                </div>

                <div id="leverage-section" style="display:none;">
                    <label style="font-size:12px;color:var(--text-dim);margin-bottom:8px;display:block;">Hebel wählen</label>
                    <div class="leverage-pills" id="leverage-pills">
                        ${info.leverageOptions.map(l =>
                            `<button class="leverage-pill ${l >= 20 ? 'danger' : ''}" data-lev="${l}">${l}x</button>`
                        ).join('')}
                    </div>
                </div>

                <div id="trade-preview" style="margin:12px 0;font-size:13px;color:var(--text-dim);"></div>

                <button class="btn btn-green" id="trade-execute">🛒 Kaufen</button>
            </div>

            <button class="btn btn-outline" style="margin-top:8px;" onclick="closeModal()">Abbrechen</button>
        </div>
    `;

    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    // Tab-Logik
    let tradeType = 'buy';
    let selectedLeverage = 2;
    const tabs = overlay.querySelectorAll('.tab');
    const levSection = overlay.querySelector('#leverage-section');
    const maxHint = overlay.querySelector('#trade-max');
    const execBtn = overlay.querySelector('#trade-execute');
    const amountInput = overlay.querySelector('#trade-amount');
    const preview = overlay.querySelector('#trade-preview');

    tabs.forEach(tab => tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        tradeType = tab.dataset.type;

        levSection.style.display = tradeType === 'leverage' ? 'block' : 'none';

        if (tradeType === 'buy' || tradeType === 'leverage') {
            maxHint.textContent = `Max: ${formatCrypto(info.maxBuy)}`;
            execBtn.textContent = '🛒 Kaufen';
            execBtn.className = 'btn btn-green';
        } else {
            maxHint.textContent = `Verfügbar: ${formatCrypto(info.maxSell)}`;
            execBtn.textContent = '💰 Verkaufen';
            execBtn.className = 'btn btn-red';
        }
        updatePreview();
    }));

    // Leverage Pills
    overlay.querySelectorAll('.leverage-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            overlay.querySelectorAll('.leverage-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            selectedLeverage = parseInt(pill.dataset.lev);
            updatePreview();
        });
    });

    // Preview
    amountInput.addEventListener('input', updatePreview);

    function updatePreview() {
        const amount = parseFloat(amountInput.value) || 0;
        if (amount <= 0) { preview.textContent = ''; return; }

        const subtotal = amount * info.price;
        const fee = subtotal * 0.005;

        if (tradeType === 'buy') {
            preview.innerHTML = `Kosten: ${formatEUR(subtotal)} + ${formatEUR(fee)} Gebühr = <b>${formatEUR(subtotal + fee)}</b>`;
        } else if (tradeType === 'sell') {
            preview.innerHTML = `Erlös: ${formatEUR(subtotal)} - ${formatEUR(fee)} Gebühr = <b>${formatEUR(subtotal - fee)}</b>`;
        } else {
            const cost = subtotal / selectedLeverage;
            preview.innerHTML = `Einsatz: ${formatEUR(cost)} + ${formatEUR(fee)} Gebühr | Liq bei -${(100/selectedLeverage).toFixed(0)}%`;
        }
    }

    // Execute
    execBtn.addEventListener('click', async () => {
        const amount = parseFloat(amountInput.value);
        if (!amount || amount <= 0) return showToast('Ungültige Anzahl', 'error');

        execBtn.disabled = true;
        execBtn.textContent = '⏳...';

        try {
            let result;
            if (tradeType === 'leverage') {
                result = await api('/trade/leverage', {
                    method: 'POST',
                    body: JSON.stringify({ coinId, amount, leverage: selectedLeverage })
                });
            } else {
                result = await api(`/trade/${tradeType}`, {
                    method: 'POST',
                    body: JSON.stringify({ coinId, amount })
                });
            }

            showToast(tradeType === 'sell' ? '💰 Verkauf erfolgreich!' : '✅ Kauf erfolgreich!');
            closeModal();
            refreshData();
        } catch (err) {
            showToast(err.message, 'error');
            execBtn.disabled = false;
            execBtn.textContent = tradeType === 'sell' ? '💰 Verkaufen' : '🛒 Kaufen';
        }
    });
}

window.closeModal = function() {
    document.querySelector('.modal-overlay')?.remove();
};

// =========================================
// Portfolio Page
// =========================================
async function renderPortfolio(el) {
    el.innerHTML = '<div class="page-title">💼 Portfolio</div><div id="portfolio-content"><div class="spinner" style="margin:20px auto;"></div></div>';

    try {
        const data = await api('/wallet');
        state.portfolio = data;
        updateHeader(data);

        const c = document.getElementById('portfolio-content');

        // Stats
        let html = `
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-label">Bargeld</div>
                    <div class="stat-value">${formatEUR(data.balance)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Kryptos</div>
                    <div class="stat-value">${formatEUR(data.cryptoValue)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Immobilien</div>
                    <div class="stat-value">${formatEUR(data.propertyValue)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Volumen</div>
                    <div class="stat-value">${formatEUR(data.tradingVolume)}</div>
                </div>
            </div>
        `;

        // Krypto-Positionen
        if (data.cryptos.length > 0) {
            html += '<h3 style="margin:16px 0 8px;font-size:14px;">📊 Krypto-Positionen</h3>';
            data.cryptos.forEach(pos => {
                const isUp = pos.pnl >= 0;
                const levTag = pos.leverage > 1 ? `<span style="color:var(--orange);font-size:11px;">⚡${pos.leverage}x</span>` : '';
                html += `
                    <div class="card" onclick="openTrade('${pos.coinId}')">
                        <div class="card-header">
                            <div>
                                <span class="card-title">${coinIcon(pos.coinId)} ${pos.coinId.toUpperCase()}</span> ${levTag}
                            </div>
                            <span style="font-weight:700;">${formatEUR(pos.value)}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-dim);">
                            <span>${formatCrypto(pos.amount)} Stk</span>
                            <span>Ø ${formatEUR(pos.avgBuyPrice)}</span>
                            <span class="${isUp ? 'change positive' : 'change negative'}">
                                ${formatEUR(pos.pnl)} (${formatPercent(pos.pnlPercent)})
                            </span>
                        </div>
                    </div>
                `;
            });
        }

        // Immobilien
        if (data.properties.length > 0) {
            html += '<h3 style="margin:16px 0 8px;font-size:14px;">🏠 Immobilien</h3>';
            data.properties.forEach(p => {
                const condColor = p.condition > 70 ? 'green' : p.condition > 40 ? 'orange' : 'red';
                html += `
                    <div class="property-card">
                        <div class="property-header">
                            <span class="property-emoji">${p.emoji}</span>
                            <div><div class="property-name">${p.name}</div><div class="property-tier">Miete: ${formatEUR(p.rent)}/24h</div></div>
                        </div>
                        <div class="progress-bar"><div class="progress-fill ${condColor}" style="width:${p.condition}%"></div></div>
                        <div style="font-size:11px;color:var(--text-dim);">Zustand: ${p.condition}%</div>
                    </div>
                `;
            });
        }

        if (data.cryptos.length === 0 && data.properties.length === 0) {
            html += '<div class="empty-state"><div class="emoji">📭</div><p>Noch keine Positionen.<br>Starte im Markt!</p></div>';
        }

        // Transaktionen-Button
        html += `<button class="btn btn-outline" style="margin-top:16px;" onclick="showTransactions()">📜 Transaktionsverlauf</button>`;

        c.innerHTML = html;
    } catch (err) {
        document.getElementById('portfolio-content').innerHTML =
            `<div class="empty-state"><div class="emoji">⚠️</div><p>${err.message}</p></div>`;
    }
}

window.showTransactions = async function() {
    const content = document.getElementById('content');
    content.innerHTML = '<div class="page-title">📜 Transaktionen</div><div id="tx-list"><div class="spinner" style="margin:20px auto;"></div></div>';

    try {
        const data = await api('/wallet/transactions?limit=30');
        const list = document.getElementById('tx-list');

        if (data.transactions.length === 0) {
            list.innerHTML = '<div class="empty-state"><p>Keine Transaktionen</p></div>';
            return;
        }

        list.innerHTML = data.transactions.map(tx => {
            const date = new Date(tx.createdAt).toLocaleDateString('de-DE', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
            });
            const isPositive = tx.amount >= 0;
            return `
                <div class="tx-row">
                    <div><div class="tx-desc">${tx.description}</div><div class="tx-date">${date}</div></div>
                    <div class="tx-amount ${isPositive ? 'positive' : 'negative'}">${isPositive ? '+' : ''}${formatEUR(tx.amount)}</div>
                </div>
            `;
        }).join('');

        list.innerHTML += `<button class="btn btn-outline" style="margin-top:16px;" onclick="navigate('portfolio')">⬅️ Zurück</button>`;
    } catch (err) {
        document.getElementById('tx-list').innerHTML = `<p style="color:var(--red);">${err.message}</p>`;
    }
};

// =========================================
// Immo Page
// =========================================
async function renderImmo(el) {
    el.innerHTML = '<div class="page-title">🏠 Immobilien-Markt</div><div id="immo-content"><div class="spinner" style="margin:20px auto;"></div></div>';

    try {
        const data = await api('/immo');
        const c = document.getElementById('immo-content');

        if (!data.unlocked) {
            const pct = Math.min(100, (data.tradingVolume / data.minVolume) * 100);
            c.innerHTML = `
                <div class="card">
                    <h3 style="margin-bottom:8px;">🔒 Gesperrt</h3>
                    <p style="font-size:13px;color:var(--text-dim);margin-bottom:12px;">
                        Handelsvolumen von ${formatEUR(data.minVolume)} erforderlich.
                    </p>
                    <div class="progress-bar"><div class="progress-fill orange" style="width:${pct}%"></div></div>
                    <p style="font-size:12px;color:var(--text-dim);margin-top:4px;">
                        ${formatEUR(data.tradingVolume)} / ${formatEUR(data.minVolume)} (${pct.toFixed(0)}%)
                    </p>
                </div>
            `;
            return;
        }

        c.innerHTML = data.properties.map(p => {
            const canBuy = !p.owned && data.balance >= p.price;
            return `
                <div class="property-card">
                    <div class="property-header">
                        <span class="property-emoji">${p.emoji}</span>
                        <div>
                            <div class="property-name">${p.name} ${p.owned ? '✅' : ''}</div>
                            <div class="property-tier">Tier ${p.tier}/6</div>
                        </div>
                    </div>
                    <div class="property-stats">
                        <span>💰 ${formatEUR(p.price)}</span>
                        <span>📊 ${formatEUR(p.rent)}/24h</span>
                        <span>🛠️ ${formatEUR(p.maintenanceCost)}/Mo</span>
                    </div>
                    ${p.owned ? `
                        <div class="progress-bar"><div class="progress-fill ${p.ownedAsset.condition > 70 ? 'green' : 'orange'}" style="width:${p.ownedAsset.condition}%"></div></div>
                        <div class="btn-row">
<button class="btn btn-sm btn-outline" 
        onclick="repairProperty('${p.ownedAsset.id}')">
    🛠️ Reparieren
</button>
                            <button class="btn btn-sm btn-red" onclick="sellProperty(${p.ownedAsset.id})">💸 Verkaufen</button>
                        </div>
                    ` : `
                        <button class="btn btn-sm ${canBuy ? 'btn-primary' : 'btn-outline'}" ${!canBuy ? 'disabled' : ''}
                            onclick="buyProperty('${p.id}')">
                            ${canBuy ? '💰 Kaufen' : '🔒 Zu teuer'}
                        </button>
                    `}
                </div>
            `;
        }).join('');
    } catch (err) {
        document.getElementById('immo-content').innerHTML = `<div class="empty-state"><div class="emoji">⚠️</div><p>${err.message}</p></div>`;
    }
}

window.buyProperty = async function(type) {
    try {
        await api('/immo/buy', { method: 'POST', body: JSON.stringify({ propertyType: type }) });
        showToast('🎉 Immobilie gekauft!');
        renderImmo(document.getElementById('content'));
        refreshData();
    } catch (err) { showToast(err.message, 'error'); }
};

window.sellProperty = async function(id) {
    if (!confirm('Verkaufen für 80% des Kaufpreises?')) return;
    try {
        const res = await api('/immo/sell', { method: 'POST', body: JSON.stringify({ assetId: id }) });
        showToast(`💰 Verkauft für ${formatEUR(res.sellPrice)}`);
        renderImmo(document.getElementById('content'));
        refreshData();
    } catch (err) { showToast(err.message, 'error'); }
};

window.repairProperty = async function(id) {
    try {
        const res = await api('/immo/repair', { method: 'POST', body: JSON.stringify({ assetId: id }) });
        showToast(`🛠️ Repariert für ${formatEUR(res.cost)}`);
        renderImmo(document.getElementById('content'));
        refreshData();
    } catch (err) { showToast(err.message, 'error'); }
};

// =========================================
// Rank Page
// =========================================
async function renderRank(el) {
    el.innerHTML = `
        <div class="page-title">🏆 Bestenliste</div>
        <div class="tabs" id="rank-tabs">
            <button class="tab active" data-type="wealth">💰 Reichste</button>
            <button class="tab" data-type="profit">📈 Profit</button>
            <button class="tab" data-type="loser">📉 Verluste</button>
        </div>
        <div id="rank-list"><div class="spinner" style="margin:20px auto;"></div></div>
    `;

    const loadRank = async (type) => {
        const list = document.getElementById('rank-list');
        list.innerHTML = '<div class="spinner" style="margin:20px auto;"></div>';

        try {
            const data = await api(`/rank?type=${type}`);
            const medals = ['🥇', '🥈', '🥉'];

            list.innerHTML = data.leaderboard.length === 0
                ? '<div class="empty-state"><p>Noch keine Daten</p></div>'
                : data.leaderboard.map((e, i) => `
                    <div class="rank-row ${e.isCurrentUser ? 'me' : ''}">
                        <span class="rank-pos">${medals[i] || (i+1) + '.'}</span>
                        <span class="rank-name">${e.username || 'Anonym'}</span>
                        <span class="rank-value">${formatEUR(e.value)}</span>
                    </div>
                `).join('');
        } catch (err) {
            list.innerHTML = `<p style="color:var(--red);">${err.message}</p>`;
        }
    };

    loadRank('wealth');

    el.querySelectorAll('#rank-tabs .tab').forEach(tab => {
        tab.addEventListener('click', () => {
            el.querySelectorAll('#rank-tabs .tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            loadRank(tab.dataset.type);
        });
    });
}

// =========================================
// Profile Page
// =========================================
async function renderProfile(el) {
    el.innerHTML = '<div class="page-title">👤 Profil & Achievements</div><div id="profile-content"><div class="spinner" style="margin:20px auto;"></div></div>';

    try {
        const [profile, achievements] = await Promise.all([
            api('/auth/profile'),
            api('/achievements')
        ]);

        const c = document.getElementById('profile-content');
        const since = new Date(profile.createdAt).toLocaleDateString('de-DE');

        let html = `
            <div class="card">
                <div class="card-title" style="font-size:18px;">👤 ${profile.username}</div>
                <div style="font-size:12px;color:var(--text-dim);margin-top:4px;">Dabei seit ${since}</div>
                <div class="stats-grid" style="margin-top:12px;">
                    <div class="stat-card"><div class="stat-label">Guthaben</div><div class="stat-value">${formatEUR(profile.balance)}</div></div>
                    <div class="stat-card"><div class="stat-label">Volumen</div><div class="stat-value">${formatEUR(profile.tradingVolume)}</div></div>
                </div>
            </div>

            <h3 style="margin:16px 0 8px;font-size:14px;">⭐ Achievements (${achievements.unlocked}/${achievements.total})</h3>
        `;

        html += achievements.achievements.map(a => `
            <div class="achievement-row ${a.unlocked ? '' : 'locked'}">
                <span class="achievement-icon">${a.unlocked ? '✅' : '🔒'}</span>
                <div class="achievement-info">
                    <div class="achievement-title">${a.title}</div>
                    <div class="achievement-desc">${a.description}</div>
                </div>
                <span class="achievement-reward">${formatEUR(a.reward)}</span>
            </div>
        `).join('');

        c.innerHTML = html;
    } catch (err) {
        document.getElementById('profile-content').innerHTML = `<div class="empty-state"><div class="emoji">⚠️</div><p>${err.message}</p></div>`;
    }
}

// =========================================
// Header Update
// =========================================
function updateHeader(portfolio) {
    if (portfolio) {
        document.getElementById('balance').textContent = formatEUR(portfolio.balance);
        document.getElementById('total-wealth').textContent = formatEUR(portfolio.totalWealth);
    }
}

async function refreshData() {
    try {
        const data = await api('/wallet');
        state.portfolio = data;
        updateHeader(data);
    } catch (e) { /* stilles Fehlen */ }
}

// =========================================
// Init
// =========================================
async function init() {
    // Telegram WebApp Setup
    if (tg) {
        tg.ready();
        tg.expand();
        tg.setHeaderColor('#0f1118');
        tg.setBackgroundColor('#0f1118');
    }

    try {
        // Login
        const auth = await api('/auth/login', { method: 'POST' });
        state.user = auth.profile;

        if (auth.isNewUser) {
            showToast('🎉 Willkommen bei ValueTycoon!');
        }

        // Initial Portfolio laden
        const wallet = await api('/wallet');
        state.portfolio = wallet;
        updateHeader(wallet);

        // UI anzeigen
        document.getElementById('loading').classList.remove('active');
        document.getElementById('main').classList.add('active');

        // Navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => navigate(btn.dataset.page));
        });

        // Startseite
        navigate('market');

        // Auto-Refresh alle 30s
        setInterval(async () => {
            if (state.currentPage === 'market') {
                const data = await api('/market').catch(() => null);
                if (data) state.market = data.coins;
            }
            refreshData();
        }, 30000);

    } catch (err) {
        console.error('Init Error:', err);
        document.querySelector('#loading p').textContent = `Fehler: ${err.message}`;
        document.querySelector('.spinner').style.display = 'none';
    }
}

// Start
init();
