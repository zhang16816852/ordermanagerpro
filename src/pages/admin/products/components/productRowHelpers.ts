export function getSpecFormatInfo(specValues: any, hasSyncedToNewTable?: boolean): {
    label: string;
    color: string;
    icon: 'new' | 'legacy' | 'empty';
    tip: string;
} {
    // 已同步至新表 product_spec_values
    if (hasSyncedToNewTable) {
        return { label: '新格式', color: 'text-emerald-600 bg-emerald-50 border-emerald-200', icon: 'new', tip: '規格已同步至新版關聯資料表' };
    }
    if (!specValues) {
        return { label: '無規格', color: 'text-slate-400 bg-slate-50 border-slate-200', icon: 'empty', tip: '此產品/變體尚未設定規格' };
    }

    // v6 格式是字典物件且包含 ":" 路徑 key
    if (typeof specValues === 'object' && !Array.isArray(specValues)) {
        const keys = Object.keys(specValues).filter(k => k !== '_metadata');
        if (keys.length === 0) {
            return { label: '無規格', color: 'text-slate-400 bg-slate-50 border-slate-200', icon: 'empty', tip: '規格為空' };
        }
        const isV6 = keys.some(k => k.includes(':'));
        if (isV6) {
            return { label: '新格式', color: 'text-emerald-600 bg-emerald-50 border-emerald-200', icon: 'new', tip: '規格已符合 v6 標準' };
        }
        return { label: '待遷移', color: 'text-amber-600 bg-amber-50 border-amber-200', icon: 'legacy', tip: '規格使用舊版物件格式，重新儲存即可自動升級' };
    }

    if (Array.isArray(specValues)) {
        return { label: '舊格式', color: 'text-amber-600 bg-amber-50 border-amber-200', icon: 'legacy', tip: '規格仍為舊版陣列格式' };
    }

    return { label: '未知', color: 'text-slate-400 bg-slate-50 border-slate-200', icon: 'empty', tip: '格式不明' };
}

export const PRODUCT_STATUS_LABELS: Record<string, string> = {
    active: '上架中',
    discontinued: '已停售',
    preorder: '預購中',
    sold_out: '售完停產',
};

export const PRODUCT_STATUS_VARIANTS: Record<string, string> = {
    active: 'bg-success text-success-foreground',
    preorder: 'bg-blue-500 text-white',
    sold_out: 'bg-orange-500 text-white',
    discontinued: '',
};

export function getProductBrandLabel(
    product: { primary_brand_name?: string | null; brand_ids?: string[] | null } | any,
    brandMap: Record<string, string>
): string {
    return product?.primary_brand_name
        || ((product?.brand_ids?.length > 0)
            ? product.brand_ids.map((id: string) => brandMap[id]).filter(Boolean).join(', ')
            : null)
        || '-';
}
