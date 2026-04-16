import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { PlusCircle, Link as LinkIcon, CheckCircle2 } from 'lucide-react';
import { InternalProductSelector } from './InternalProductSelector';
import { ProductFormDialog } from '@/components/ProductFormDialog/ProductFormDialog';

export interface UnmappedItem {
  vendor_product_id: string;
  vendor_product_name: string;
  // 可以擴展其他匯入欄位，如數量 單價等作為參考
}

interface UnmappedResolverProps {
  supplierId: string;
  unmappedItems: UnmappedItem[];
  onRuleCreated: (vendorProdId: string, vendorProdName: string, internalProdId: string, internalVarId: string | null) => void;
  onAllResolved?: () => void; // 所有未匹配項目都處理完畢時的回調
}

export function UnmappedResolver({ supplierId, unmappedItems, onRuleCreated, onAllResolved }: UnmappedResolverProps) {
  const [resolvingItem, setResolvingItem] = useState<UnmappedItem | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [productFormOpen, setProductFormOpen] = useState(false);

  // 追蹤已經在本畫面中被解決的項目
  const [resolvedVendorIds, setResolvedVendorIds] = useState<Set<string>>(new Set());

  const handleAssignCurrent = (internalProdId: string, internalVarId: string | null) => {
    if (resolvingItem) {
      onRuleCreated(resolvingItem.vendor_product_id, resolvingItem.vendor_product_name, internalProdId, internalVarId);
      markResolved(resolvingItem.vendor_product_id);
    }
    setSelectorOpen(false);
  };

  const markResolved = (vendorId: string) => {
    setResolvedVendorIds(prev => {
      const next = new Set(prev);
      next.add(vendorId);
      
      // 檢查是否全部解決
      if (next.size === unmappedItems.length && onAllResolved) {
        onAllResolved();
      }
      return next;
    });
  };

  const handleProductCreated = (newProduct: any) => {
    if (resolvingItem && newProduct && newProduct.id) {
      // 假設新建立的產品直接對應 (暫不處理新建變體對應，簡化流程，若有變體則對應首個變體或主產品)
      onRuleCreated(resolvingItem.vendor_product_id, resolvingItem.vendor_product_name, newProduct.id, null);
      markResolved(resolvingItem.vendor_product_id);
    }
    setProductFormOpen(false);
  };

  if (unmappedItems.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-md">
        <p className="text-amber-700 text-sm font-medium">
          發現 {unmappedItems.length - resolvedVendorIds.size} 個未識別的廠商產品。請先建立對照關係，系統才能正確匯入數量與價格。
        </p>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>廠商產品代號</TableHead>
              <TableHead>廠商產品名稱</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead className="text-right">對應操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {unmappedItems.map((item) => {
              const isResolved = resolvedVendorIds.has(item.vendor_product_id);

              return (
                <TableRow key={item.vendor_product_id} className={isResolved ? "opacity-50 bg-slate-50" : ""}>
                  <TableCell className="font-medium">{item.vendor_product_id}</TableCell>
                  <TableCell>{item.vendor_product_name}</TableCell>
                  <TableCell>
                    {isResolved ? (
                      <span className="flex items-center text-green-600 text-sm"><CheckCircle2 className="w-4 h-4 mr-1"/> 已設定</span>
                    ) : (
                      <span className="text-amber-600 text-sm">未對應</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isResolved}
                      onClick={() => {
                        setResolvingItem(item);
                        setSelectorOpen(true);
                      }}
                    >
                      <LinkIcon className="h-4 w-4 mr-1" />
                      指派現有產品
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isResolved}
                      onClick={() => {
                        setResolvingItem(item);
                        setProductFormOpen(true);
                      }}
                    >
                      <PlusCircle className="h-4 w-4 mr-1" />
                      新增內部產品
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* 指派現有產品對話框 */}
      <Dialog open={selectorOpen} onOpenChange={setSelectorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>指派內部產品對應 (廠商代號: {resolvingItem?.vendor_product_id})</DialogTitle>
            <DialogDescription>
              請搜尋並選擇系統內的產品與變體，以建立與廠商代號的連結對照關係。
            </DialogDescription>
          </DialogHeader>
 bitumen
          {selectorOpen && (
            <InternalProductSelector
              onSelect={handleAssignCurrent}
              onClose={() => setSelectorOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* 新增產品對話框 */}
      <ProductFormDialog
        open={productFormOpen}
        onOpenChange={setProductFormOpen}
        initialData={{ name: resolvingItem?.vendor_product_name || '', sku: resolvingItem?.vendor_product_id || '' } as any}
        onSubmit={handleProductCreated}
      />
    </div>
  );
}
