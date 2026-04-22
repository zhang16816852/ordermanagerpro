/**
 * 處理產品與變體價格的通用工具
 */

interface PriceRangeResult {
    min: number;
    max: number;
    display: string;
    hasRange: boolean;
}

/**
 * 計算價格區間
 * @param basePrice 基礎價 (主商品價格)
 * @param variantPrices 變體價格陣列
 * @returns 包含最小值、最大值與格式化字串的物件
 */
export function calculatePriceRange(
    basePrice: number | null | undefined,
    variantPrices: (number | null | undefined)[]
): PriceRangeResult {
    // 合併基礎價與變體價，過濾掉無效值
    let allPrices = [
        ...(basePrice != null ? [Number(basePrice)] : []),
        ...variantPrices.filter(p => p != null).map(p => Number(p))
    ];

    // 如果同時存在 0 和非 0 的價格，通常 0 是預設值而非實際價格，應予過濾
    const hasNonZero = allPrices.some(p => p > 0);
    if (hasNonZero) {
        allPrices = allPrices.filter(p => p !== 0);
    }

    if (allPrices.length === 0) {
        return { min: 0, max: 0, display: '$0', hasRange: false };
    }

    const min = Math.min(...allPrices);
    const max = Math.max(...allPrices);
    const hasRange = min !== max;

    return {
        min,
        max,
        display: hasRange ? `$${min} ~ $${max}` : `$${min}`,
        hasRange
    };
}
