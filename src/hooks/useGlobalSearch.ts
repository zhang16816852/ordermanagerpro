import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface SearchResult {
    id: string;
    type: 'product' | 'order' | 'store';
    title: string;
    subtitle?: string;
    href: string;
}

export function useGlobalSearch(query: string) {
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!query || query.length < 2) {
            setResults([]);
            return;
        }

        const fetchResults = async () => {
            setIsLoading(true);
            try {
                const [productRes, orderRes, storeRes] = await Promise.all([
                    // 1. Search Products
                    supabase
                        .from('products')
                        .select('id, name, sku')
                        .or(`name.ilike.%${query}%,sku.ilike.%${query}%`)
                        .limit(5),
                    
                    // 2. Search Orders
                    supabase
                        .from('orders')
                        .select('id, code')
                        .or(`id.ilike.%${query}%,code.ilike.%${query}%`)
                        .limit(5),

                    // 3. Search Stores
                    supabase
                        .from('stores')
                        .select('id, name, code')
                        .or(`name.ilike.%${query}%,code.ilike.%${query}%`)
                        .limit(5)
                ]);

                const formattedResults: SearchResult[] = [
                    ...(productRes.data || []).map(p => ({
                        id: p.id,
                        type: 'product' as const,
                        title: p.name,
                        subtitle: `SKU: ${p.sku}`,
                        href: `/admin/products?search=${p.sku}`
                    })),
                    ...(orderRes.data || []).map(o => ({
                        id: o.id,
                        type: 'order' as const,
                        title: `訂單: ${o.code || o.id.slice(0, 8)}`,
                        subtitle: `ID: ${o.id}`,
                        href: `/admin/orders?search=${o.id}`
                    })),
                    ...(storeRes.data || []).map(s => ({
                        id: s.id,
                        type: 'store' as const,
                        title: s.name,
                        subtitle: `編號: ${s.code}`,
                        href: `/admin/stores?search=${s.code}`
                    }))
                ];

                setResults(formattedResults);
            } catch (error) {
                console.error('Global search error:', error);
            } finally {
                setIsLoading(false);
            }
        };

        const timeoutId = setTimeout(fetchResults, 300);
        return () => clearTimeout(timeoutId);
    }, [query]);

    return { results, isLoading };
}
