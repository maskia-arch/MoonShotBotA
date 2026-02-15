// logic/tradeLogic.js - Erweiterte Handelslogik
import { CONFIG } from '../config.js';

const TRADING_FEE = CONFIG.TRADING_FEE;

export function getTradeCalculations(balance, coinPrice, userHoldings = 0) {
    if (!coinPrice || coinPrice <= 0) {
        return { maxBuy: 0, maxSell: 0, feePercent: "0.5", currentPrice: 0 };
    }

    const maxBuy = (balance / coinPrice) / (1 + TRADING_FEE);
    const maxSell = userHoldings;

    return {
        maxBuy: parseFloat(maxBuy.toFixed(8)),
        maxSell: parseFloat(maxSell.toFixed(8)),
        feePercent: (TRADING_FEE * 100).toFixed(1),
        currentPrice: coinPrice
    };
}

export function calculateTrade(amount, price) {
    const safeAmount = parseFloat(amount) || 0;
    const safePrice = parseFloat(price) || 0;

    const subtotal = safeAmount * safePrice;
    const fee = subtotal * TRADING_FEE;
    
    return {
        subtotal,
        fee,
        totalCost: subtotal + fee,
        payout: subtotal - fee
    };
}

export function isTradeEligibleForVolume(boughtAt) {
    if (!boughtAt) return false;
    
    const oneHourInMs = 60 * 60 * 1000;
    const timeHeld = Date.now() - new Date(boughtAt).getTime();
    
    return timeHeld >= oneHourInMs;
}

export function calculateEligibleVolume(amountInEuro, boughtAt) {
    if (!isTradeEligibleForVolume(boughtAt)) return 0;

    const startTime = new Date(boughtAt).getTime();
    const hoursHeld = (Date.now() - startTime) / (1000 * 60 * 60);
    
    const weight = Math.min(hoursHeld / 24, 1);
    
    return amountInEuro * weight;
}

export function calculateLiquidationPrice(entryPrice, leverage) {
    // Bei 10x Hebel: 10% Kursverlust = Totalverlust
    // Liquidation bei 90% des Einsatzes verloren
    const lossThreshold = CONFIG.LEVERAGE.LIQUIDATION_THRESHOLD; // 0.9
    const priceDropPercent = lossThreshold / leverage;
    
    return entryPrice * (1 - priceDropPercent);
}

export function checkLiquidationRisk(currentPrice, entryPrice, leverage) {
    const liqPrice = calculateLiquidationPrice(entryPrice, leverage);
    
    if (currentPrice <= liqPrice) {
        return { liquidated: true, lossPercent: 100 };
    }
    
    const priceChange = ((currentPrice - entryPrice) / entryPrice) * 100;
    const leveragedChange = priceChange * leverage;
    
    // Risiko-Level basierend auf wie nah wir der Liquidation sind
    const distanceToLiq = ((currentPrice - liqPrice) / liqPrice) * 100;
    
    return {
        liquidated: false,
        currentPnL: leveragedChange,
        distanceToLiquidation: distanceToLiq,
        riskLevel: distanceToLiq < 5 ? 'extreme' : distanceToLiq < 15 ? 'high' : 'medium'
    };
}
