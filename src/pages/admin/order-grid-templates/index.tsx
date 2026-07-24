import React from 'react';
import { OrderGridTemplateList } from '@/components/order-grid/OrderGridTemplateList';
import { useProductCache } from '@/hooks/useProductCache';
import type { ProductWithPricing } from '@/types/order-grid';

export default function AdminOrderGridTemplates() {
  const { products: allProducts } = useProductCache();

  const products = (allProducts || []) as ProductWithPricing[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Table 式下單範本</h1>
        <p className="text-muted-foreground">
          管理 table 式下單的範本設定，建立後可在門市目錄中使用
        </p>
      </div>

      <OrderGridTemplateList
        products={products}
      />
    </div>
  );
}
