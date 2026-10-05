import { Fragment, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, X } from 'lucide-react';
import type { ImportCatalogProduct } from '../importMatchPreview';

interface ImportVariantPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 已載入於記憶體的產品目錄（含 variants），不另發查詢 */
  products: ImportCatalogProduct[];
  onSelect: (target: { productId: string; variantId: string; label: string }) => void;
  /** 說明本次指定的用途（例如「廠商料號 ABC」） */
  description?: string;
  disabledHint?: string;
}

/** 一次最多顯示的筆數；超過時明示剩餘數量，避免使用者誤以為「查無結果」 */
const MAX_RESULTS = 200;

interface VariantRow {
  variantId: string;
  productId: string;
  variantName: string;
  sku: string;
  productName: string;
  searchText: string;
}

/**
 * 匯入預覽的手動指定用變體選擇器。
 *
 * ⚠️ 刻意「只提供變體層級」：本專案的對照單位是變體（`supplier_product_mappings`
 * 的 725 筆既有對照全部為變體層級），產品層級僅是後端 fallback 的權宜之計。
 * 故此處不列出沒有變體的產品，也不提供產品層級選項。
 *
 * 搜尋與自動比對的語意刻意不同：搜尋可忽略大小寫的子字串（供人找），
 * 而自動比對必須完全相同且大小寫敏感（mirror 後端 SQL `=`）。
 */
export function ImportVariantPicker({
  open, onOpenChange, products, onSelect, description, disabledHint,
}: ImportVariantPickerProps) {
  const [keyword, setKeyword] = useState('');

  const allRows = useMemo<VariantRow[]>(() => {
    const rows: VariantRow[] = [];
    for (const product of products) {
      const productName = (product.name ?? '').trim();
      for (const variant of product.variants ?? []) {
        const variantName = (variant.name ?? '').trim() || (variant.sku ?? '').trim();
        rows.push({
          variantId: variant.id,
          productId: product.id,
          variantName,
          sku: (variant.sku ?? '').trim(),
          productName,
          searchText: [variantName, (variant.sku ?? '').trim(), productName, (product.code ?? '').trim()]
            .filter(Boolean)
            .join(' '),
        });
      }
    }
    return rows;
  }, [products]);

  const matched = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return allRows;
    return allRows.filter((r) => r.searchText.toLowerCase().includes(kw));
  }, [allRows, keyword]);

  const visible = matched.slice(0, MAX_RESULTS);
  const overflow = matched.length - visible.length;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setKeyword('');
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>指定內部變體</DialogTitle>
          <DialogDescription>
            {description ?? '選擇這個廠商料號要對應的內部變體，指定後會自動存成供應商對照規則。'}
          </DialogDescription>
        </DialogHeader>

        {disabledHint ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {disabledHint}
          </p>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜尋變體名稱／SKU／產品名稱"
                aria-label="搜尋內部變體"
                className="pl-8 pr-8"
              />
              {keyword && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="清除搜尋"
                  className="absolute right-0 top-1/2 h-8 w-8 -translate-y-1/2"
                  onClick={() => setKeyword('')}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              共 {matched.length.toLocaleString()} 個變體符合
              {allRows.length > 0 && `／目錄總計 ${allRows.length.toLocaleString()} 個變體`}
            </p>

            <ScrollArea className="h-[46vh] rounded-md border">
              {visible.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  查無符合「{keyword.trim()}」的變體
                </p>
              ) : (
                <ul className="divide-y">
                  {visible.map((row, i) => (
                    <Fragment key={row.variantId}>
                      <li>
                        <button
                          type="button"
                          className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                          onClick={() => {
                            onSelect({
                              productId: row.productId,
                              variantId: row.variantId,
                              label: row.variantName || row.sku || row.productName,
                            });
                            onOpenChange(false);
                          }}
                        >
                          <span className="text-sm font-medium">
                            {row.variantName || '（未命名變體）'}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {[row.sku && `SKU ${row.sku}`, row.productName]
                              .filter(Boolean)
                              .join(' ・ ')}
                          </span>
                        </button>
                      </li>
                      {i === visible.length - 1 && overflow > 0 && (
                        <li className="px-3 py-2.5 text-xs text-muted-foreground">
                          另有 {overflow.toLocaleString()} 個變體符合，請再縮小搜尋範圍。
                        </li>
                      )}
                    </Fragment>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
