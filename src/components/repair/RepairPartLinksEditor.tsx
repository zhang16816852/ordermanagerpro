import { useMemo } from 'react';
import { Plus, Trash2, Star, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { RepairPartLinkInput, useRepairPartProductOptions } from '@/hooks/useRepairParts';

interface RepairPartLinksEditorProps {
  links: RepairPartLinkInput[];
  onChange: (links: RepairPartLinkInput[]) => void;
}

export function RepairPartLinksEditor({ links, onChange }: RepairPartLinksEditorProps) {
  const { options: productOptions } = useRepairPartProductOptions();

  const { options, targetMap } = useMemo(() => {
    const opts: { id: string; name: string; subLabel?: string; group?: string }[] = [];
    const map = new Map<string, { product_id: string; variant_id: string | null; variant_name: string | null }>();
    productOptions.forEach(o => {
      const key = o.variant_id || o.product_id;
      opts.push({ id: key, name: o.label, subLabel: o.subLabel || undefined, group: o.product_name });
      map.set(key, { product_id: o.product_id, variant_id: o.variant_id, variant_name: o.variant_name });
    });
    return { options: opts, targetMap: map };
  }, [productOptions]);

  const patch = (index: number, next: Partial<RepairPartLinkInput>) => {
    onChange(links.map((l, i) => (i === index ? { ...l, ...next } : l)));
  };

  const setDefault = (index: number) => {
    onChange(links.map((l, i) => ({ ...l, is_default: i === index })));
  };

  const addLink = () => {
    onChange([...links, { id: null, product_id: '', variant_id: null, spec_label: null, is_default: links.length === 0 }]);
  };

  const removeLink = (index: number) => {
    const next = links.filter((_, i) => i !== index);
    // 移除預設時，自動把第一筆設為預設，避免零件無可用連結
    if (next.length > 0 && !next.some(l => l.is_default)) {
      onChange(next.map((l, i) => (i === 0 ? { ...l, is_default: true } : l)));
      return;
    }
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <Link2 className="h-3.5 w-3.5" />
          庫存商品連結
        </p>
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addLink}>
          <Plus className="h-3 w-3" />
          新增連結
        </Button>
      </div>

      {links.length === 0 ? (
        <p className="text-xs text-muted-foreground rounded-md border border-dashed px-3 py-3 text-center">
          尚未綁定庫存商品。未綁定的零件無法扣庫存或叫料。
        </p>
      ) : (
        <div className="space-y-2">
          {links.map((link, index) => {
            const target = link.variant_id || link.product_id;
            return (
              <div key={index} className="rounded-md border p-2 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <SearchableSelect
                      options={options}
                      value={target || null}
                      onChange={(id) => {
                        if (!id) {
                          patch(index, { product_id: '', variant_id: null, spec_label: null });
                          return;
                        }
                        const t = targetMap.get(id);
                        if (!t) return;
                        patch(index, {
                          product_id: t.product_id,
                          variant_id: t.variant_id,
                          spec_label: link.spec_label || t.variant_name,
                        });
                      }}
                      placeholder="選擇維修零件商品／變體"
                      searchPlaceholder="搜尋商品名稱或 SKU"
                      emptyText="找不到可綁定的維修零件商品"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => setDefault(index)}
                    title="設為預設連結"
                    aria-label="設為預設連結"
                  >
                    <Star className={link.is_default ? 'h-4 w-4 fill-amber-400 text-amber-500' : 'h-4 w-4'} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10"
                    onClick={() => removeLink(index)}
                    title="移除連結"
                    aria-label="移除連結"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <Input
                    value={link.spec_label || ''}
                    onChange={(e) => patch(index, { spec_label: e.target.value || null })}
                    placeholder="規格／顏色標籤（例：黑色、OLED）"
                    className="h-8 text-xs"
                  />
                  {link.is_default && (
                    <Badge variant="outline" className="h-6 px-1.5 text-[10px] shrink-0">預設</Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
