/**
 * 格式化貨幣顯示 (例如: $1,234)
 * @param amount 數值
 * @param currency 幣別碼, 預設為 USD
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
    TWD: 'NT$',
    USD: '$',
    CNY: '¥',
    JPY: '¥',
    EUR: '€',
    HKD: 'HK$',
    KRW: '₩',
    GBP: '£',
};

const CURRENCY_DECIMALS: Record<string, number> = {
    TWD: 0,
    JPY: 0,
    KRW: 0,
    USD: 2,
    CNY: 2,
    EUR: 2,
    HKD: 2,
    GBP: 2,
};

export function formatCurrency(amount: number | string, currency: string = 'USD'): string {
    const value = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(value)) return `${CURRENCY_SYMBOLS[currency] || currency}0`;

    const symbol = CURRENCY_SYMBOLS[currency] || currency;
    const decimals = CURRENCY_DECIMALS[currency] ?? 2;
    const formatted = Math.abs(value).toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals,
    });
    const sign = value < 0 ? '-' : '';
    return `${sign}${symbol}${formatted}`;
}

/**
 * 格式化台灣本地金額 (例如: NT$1,234)
 */
export function formatTWD(amount: number | string): string {
    const value = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(value)) return 'NT$0';

    return new Intl.NumberFormat('zh-TW', {
        style: 'currency',
        currency: 'TWD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);
}

/**
 * 格式化日期時間 (例如: 2024-04-10 15:30)
 */
const dateTimeFormatter = new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
});

export function formatDate(date: string | Date | null): string {
    if (!date) return '-';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '-';

    return dateTimeFormatter.format(d).replace(/\//g, '-');
}
