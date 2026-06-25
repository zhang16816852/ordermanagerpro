import { supabase } from '@/integrations/supabase/client';

export interface EntityBinding {
  id: string;
  binding_type: 'product' | 'variant';
  product_id: string | null;
  variant_id: string | null;
  bound_product_id: string | null;
  bound_variant_id: string | null;
}

export interface BoundProductInfo {
  id: string;
  name: string;
  sku: string;
}

export interface BoundVariantInfo {
  id: string;
  name: string;
  sku: string;
  product_name: string;
}

export const entityBindingService = {
  async fetchBindings(entityType: 'product' | 'variant', entityId: string): Promise<EntityBinding[]> {
    if (entityType === 'product') {
      const { data, error } = await supabase
        .from('entity_bindings')
        .select('*')
        .or(`product_id.eq.${entityId},bound_product_id.eq.${entityId}`)
        .eq('binding_type', 'product');
      if (error) throw error;
      return data || [];
    } else {
      const { data, error } = await supabase
        .from('entity_bindings')
        .select('*')
        .or(`variant_id.eq.${entityId},bound_variant_id.eq.${entityId}`)
        .eq('binding_type', 'variant');
      if (error) throw error;
      return data || [];
    }
  },

  getBoundProductIds(bindings: EntityBinding[], entityId: string): string[] {
    return bindings.map(b => {
      if (b.product_id === entityId) return b.bound_product_id!;
      if (b.bound_product_id === entityId) return b.product_id!;
      return null;
    }).filter(Boolean) as string[];
  },

  async fetchBoundProducts(productIds: string[]): Promise<BoundProductInfo[]> {
    if (productIds.length === 0) return [];
    const { data, error } = await supabase
      .from('products')
      .select('id, name, sku')
      .in('id', productIds);
    if (error) throw error;
    return data || [];
  },

  async addBinding(entityType: 'product' | 'variant', entityId: string, targetId: string) {
    if (entityType === 'product') {
      const { error } = await supabase
        .from('entity_bindings')
        .insert({
          binding_type: 'product',
          product_id: entityId,
          bound_product_id: targetId,
        });
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('entity_bindings')
        .insert({
          binding_type: 'variant',
          variant_id: entityId,
          bound_variant_id: targetId,
        });
      if (error) throw error;
    }
  },

  async removeBinding(bindingId: string) {
    const { error } = await supabase
      .from('entity_bindings')
      .delete()
      .eq('id', bindingId);
    if (error) throw error;
  },

  getBoundVariantIds(bindings: EntityBinding[], entityId: string): string[] {
    return bindings.map(b => {
      if (b.variant_id === entityId) return b.bound_variant_id!;
      if (b.bound_variant_id === entityId) return b.variant_id!;
      return null;
    }).filter(Boolean) as string[];
  },

  async fetchBoundVariants(variantIds: string[]): Promise<BoundVariantInfo[]> {
    if (variantIds.length === 0) return [];
    const { data, error } = await supabase
      .from('product_variants')
      .select('id, name, sku, product_id, products(name)')
      .in('id', variantIds);
    if (error) throw error;
    return (data || []).map((v: any) => ({
      id: v.id,
      name: v.name,
      sku: v.sku,
      product_name: v.products?.name || '',
    }));
  },

  async searchVariants(query: string): Promise<BoundVariantInfo[]> {
    if (!query || query.length < 1) return [];
    const { data, error } = await supabase
      .from('product_variants')
      .select('id, name, sku, product_id, products(name)')
      .or(`name.ilike.%${query}%,sku.ilike.%${query}%`)
      .limit(15);
    if (error) throw error;
    return (data || []).map((v: any) => ({
      id: v.id,
      name: v.name,
      sku: v.sku,
      product_name: v.products?.name || '',
    }));
  },

  async searchProducts(query: string): Promise<BoundProductInfo[]> {
    if (!query || query.length < 1) return [];
    const { data, error } = await supabase
      .from('products')
      .select('id, name, sku')
      .or(`name.ilike.%${query}%,sku.ilike.%${query}%`)
      .limit(10);
    if (error) throw error;
    return data || [];
  },
};
