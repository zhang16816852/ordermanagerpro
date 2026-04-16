import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';

interface Brand {
    id: string;
    name: string;
}

interface BrandState {
    brandMap: Map<string, string>; // ID -> Name
    isLoading: boolean;
    fetchBrands: () => Promise<void>;
}

/**
 * v4.11 全域品牌商店：提供高效的名稱查找地圖
 */
export const useBrandStore = create<BrandState>((set) => ({
    brandMap: new Map(),
    isLoading: false,
    fetchBrands: async () => {
        set({ isLoading: true });
        try {
            const { data, error } = await supabase
                .from('brands' as any)
                .select('id, name');
            
            if (error) throw error;

            const map = new Map<string, string>();
            if (data) {
                (data as unknown as Brand[]).forEach(b => map.set(b.id, b.name));
            }
            
            set({ brandMap: map, isLoading: false });
        } catch (err) {
            console.error('Failed to fetch brands:', err);
            set({ isLoading: false });
        }
    }
}));
