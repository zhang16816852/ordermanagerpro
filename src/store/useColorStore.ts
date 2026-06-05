import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { ProductColor } from '@/types/colors';

interface ColorStore {
    colors: ProductColor[];
    isLoading: boolean;
    isAdding: boolean;
    isInitialized: boolean;
    fetchColors: (force?: boolean) => Promise<ProductColor[]>;
    getColorByName: (name: string) => ProductColor | undefined;
    getColorByCode: (code: string) => ProductColor | undefined;
    addColor: (newColor: Partial<ProductColor>) => Promise<ProductColor | null>;
    importColors: (newColors: Partial<ProductColor>[]) => Promise<boolean>;
    updateColor: (color: ProductColor) => Promise<boolean>;
    deleteColor: (id: string) => Promise<boolean>;
}

export const useColorStore = create<ColorStore>((set, get) => ({
    colors: [],
    isLoading: false,
    isAdding: false,
    isInitialized: false,
    
    fetchColors: async (force = false) => {
        if (!force && get().isInitialized) return get().colors;
        
        set({ isLoading: true });
        try {
            const { data, error } = await supabase
                .from('product_colors' as any)
                .select('*')
                .order('sort_order', { ascending: true })
                .order('name', { ascending: true });
                
            if (error) throw error;
            
            const colors = data as unknown as ProductColor[];
            set({ colors, isLoading: false, isInitialized: true });
            return colors;
        } catch (err) {
            console.error('[ColorStore] Fetch failed:', err);
            set({ isLoading: false });
            return get().colors;
        }
    },

    getColorByName: (name: string) => {
        if (!name) return undefined;
        const search = name.trim().toLowerCase();
        return get().colors.find(c => c.name.trim().toLowerCase() === search);
    },

    getColorByCode: (code: string) => {
        if (!code) return undefined;
        return get().colors.find(c => c.code === code.toUpperCase());
    },

    addColor: async (newColor) => {
        set({ isAdding: true });
        try {
            const { data, error } = await supabase
                .from('product_colors' as any)
                .insert([newColor])
                .select()
                .single();
                
            if (error) throw error;
            
            const created = data as unknown as ProductColor;
            set(state => ({
                colors: [...state.colors, created].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
                isAdding: false
            }));
            return created;
        } catch (err) {
            return null;
        }
    },

    importColors: async (newColors) => {
        set({ isAdding: true });
        try {
            // Upsert: 有 id 時以 id 配對更新，無 id 時新增
            const { error } = await supabase
                .from('product_colors' as any)
                .upsert(newColors, { 
                    onConflict: 'id',
                    ignoreDuplicates: false 
                });
                
            if (error) throw error;
            
            await get().fetchColors(true);
            set({ isAdding: false });
            return true;
        } catch (err) {
            console.error('[ColorStore] Import failed:', err);
            set({ isAdding: false });
            return false;
        }
    },

    updateColor: async (color) => {
        try {
            const { error } = await supabase
                .from('product_colors' as any)
                .update(color)
                .eq('id', color.id);
                
            if (error) throw error;
            
            set(state => ({
                colors: state.colors.map(c => c.id === color.id ? color : c)
                    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
            }));
            return true;
        } catch (err) {
            console.error('[ColorStore] Update failed:', err);
            return false;
        }
    },

    deleteColor: async (id) => {
        try {
            const { error } = await supabase
                .from('product_colors' as any)
                .delete()
                .eq('id', id);
                
            if (error) throw error;
            
            set(state => ({
                colors: state.colors.filter(c => c.id !== id)
            }));
            return true;
        } catch (err) {
            console.error('[ColorStore] Delete failed:', err);
            return false;
        }
    }
}));
