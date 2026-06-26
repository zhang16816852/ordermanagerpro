import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { OrderGridCell } from './OrderGridCell';
import { OrderGridToolbar } from './OrderGridToolbar';
import { buildGridMatrix, filterRowsColsForTab } from '@/lib/order-grid-utils';
import type {
  OrderGridTemplateWithProducts,
  ProductWithPricing,
  VariantWithPricing,
  GridMode,
  GridQuantities,
} from '@/types/order-grid';

interface OrderGridRendererProps {
  template: OrderGridTemplateWithProducts;
  products: ProductWithPricing[];
  onAddToCart: (
    items: { variant: VariantWithPricing; product: ProductWithPricing; quantity: number }[]
  ) => void;
  initialQuantities?: GridQuantities;
}

export function OrderGridRenderer({
  template,
  products,
  onAddToCart,
  initialQuantities,
}: OrderGridRendererProps) {
  const [mode, setMode] = useState<GridMode>('button');
  const [quantities, setQuantities] = useState<GridQuantities>(initialQuantities || {});

  useEffect(() => {
    setQuantities(initialQuantities || {});
  }, [initialQuantities]);

  const templateVariantIds = useMemo(
    () => new Set(template.template_variants?.map((tv) => tv.variant_id) || []),
    [template.template_variants]
  );

  const templateProducts = useMemo(() => {
    const productIds = new Set<string>();
    (products || []).forEach(p => {
      p.variants?.forEach((v: any) => {
        if (templateVariantIds.has(v.id)) {
          productIds.add(p.id);
        }
      });
    });
    return (products || [])
      .filter((p) => productIds.has(p.id))
      .map((p) => ({
        ...p,
        variants: (p.variants || []).filter((v: any) => templateVariantIds.has(v.id)),
      }));
  }, [products, templateVariantIds]);

  const grid = useMemo(
    () => buildGridMatrix(template, templateProducts),
    [template, templateProducts]
  );

  const handleQuantityChange = useCallback(
    (variantId: string, quantity: number) => {
      setQuantities((prev) => ({
        ...prev,
        [variantId]: quantity,
      }));
    },
    []
  );

  const handleClear = useCallback(() => {
    setQuantities({});
  }, []);

  const handleAddToCart = useCallback(() => {
    const items: {
      variant: VariantWithPricing;
      product: ProductWithPricing;
      quantity: number;
    }[] = [];

    grid.cells.forEach((cellVariants) => {
      cellVariants.forEach(({ variant, product }) => {
        const qty = quantities[variant.id] || 0;
        if (qty > 0) {
          items.push({ variant, product, quantity: qty });
        }
      });
    });

    if (items.length > 0) {
      onAddToCart(items);
      setQuantities({});
    }
  }, [grid.cells, quantities, onAddToCart]);

  const renderGridTable = (tabValue?: string) => {
    const { rowValues, colValues, cells } = grid;
    const filtered = tabValue
      ? filterRowsColsForTab(rowValues, colValues, cells, tabValue)
      : { rowValues, colValues };
    const displayRows = filtered.rowValues;
    const displayCols = filtered.colValues;

    if (displayRows.length === 0 || displayCols.length === 0) return null;

    return (
      <ScrollArea className="w-full">
        <div className="min-w-[400px]">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-background border-b border-r p-2 text-xs font-medium text-muted-foreground text-left min-w-[100px]">
                  {template.row_config.label} \ {template.col_config.label}
                </th>
                {displayCols.map((cv) => (
                  <th
                    key={cv}
                    className="border-b border-r p-2 text-xs font-medium text-muted-foreground text-center min-w-[120px]"
                  >
                    {cv}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((rv) => (
                <tr key={rv}>
                  <td className="sticky left-0 z-10 bg-background border-b border-r p-2 text-xs font-medium text-muted-foreground">
                    {rv}
                  </td>
                  {displayCols.map((cv) => {
                    const key = `${tabValue || '__all__'}|${rv}|${cv}`;
                    const rawItems = cells.get(key) || [];
                    const cellItems = rawItems.map((item) => ({
                      ...item,
                      quantity: quantities[item.variant.id] || 0,
                    }));
                    return (
                      <td
                        key={cv}
                        className="border-b border-r p-1.5 align-top min-w-[120px]"
                      >
                        <OrderGridCell
                          items={cellItems}
                          mode={mode}
                          onQuantityChange={handleQuantityChange}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    );
  };

  if (grid.tabValues.length <= 1 || !template.tab_config) {
    const nonEmpty = renderGridTable();
    if (!nonEmpty && (grid.rowValues.length === 0 || grid.colValues.length === 0)) {
      return (
        <div className="space-y-3">
          <OrderGridToolbar
            templateName={template.name}
            mode={mode}
            onModeChange={setMode}
            quantities={quantities}
            onAddToCart={handleAddToCart}
            onClear={handleClear}
          />
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground border rounded-lg">
            無法產生 grid：維度值為空
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <OrderGridToolbar
          templateName={template.name}
          mode={mode}
          onModeChange={setMode}
          quantities={quantities}
          onAddToCart={handleAddToCart}
          onClear={handleClear}
        />
        {nonEmpty}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <OrderGridToolbar
        templateName={template.name}
        mode={mode}
        onModeChange={setMode}
        quantities={quantities}
        onAddToCart={handleAddToCart}
        onClear={handleClear}
      />
      <Tabs defaultValue={grid.tabValues[0]}>
        <TabsList>
          {grid.tabValues.map((tv) => (
            <TabsTrigger key={tv} value={tv} className="text-xs">
              {tv}
            </TabsTrigger>
          ))}
        </TabsList>
        {grid.tabValues.map((tv) => {
          const tabContent = renderGridTable(tv);
          return tabContent ? (
            <TabsContent key={tv} value={tv}>
              {tabContent}
            </TabsContent>
          ) : null;
        })}
      </Tabs>
    </div>
  );
}
