/**
 * 格式化貨幣顯示 (例如: $1,234)
 * @param amount 數值
 * @param currency 幣別碼, 預設為 USD
 */
export function formatCurrency(amount: number | string, currency: string = 'USD'): string {
    const value = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(value)) return '$0';

    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);
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
