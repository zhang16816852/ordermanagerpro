import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { Download, Link2, Plus, FileSpreadsheet } from 'lucide-react';
import { PurchaseProductPicker } from './PurchaseProductPicker';
import { ImportFromOrdersDialog } from './ImportFromOrdersDialog';
import { BindSourceOrdersDialog } from './BindSourceOrdersDialog';
import { BatchBindSourceOrdersDialog } from './BatchBindSourceOrdersDialog';
import { ExcelImportDialog } from './ExcelImportDialog';
import type { PurchaseOrder, PurchaseOrderItem } from '../types';

interface Props {
  order: PurchaseOrder;
  products: any[];
  isLoading: boolean;
  canEdit: boolean;
  localItems: PurchaseOrderItem[];
  sourceOrderMap: Record<string, string>;
  sourceOrderStoreMap: Record<string, string>;
  sourceOrderDateMap: Record<string, string>;
  submitNewItems: (items: any[]) => Promise<boolean>;
  handleBindSources: (binds: { orderId: string; quantity: number }[]) => Promise<void>;
  handleBatchBindSources: (items: PurchaseOrderItem[]) => Promise<void>;
  bindItem: PurchaseOrderItem | null;
  setBindItem: (v: PurchaseOrderItem | null) => void;
  addItemOpen: boolean;
  setAddItemOpen: (v: boolean) => void;
  importOpen: boolean;
  setImportOpen: (v: boolean) => void;
  batchBindOpen: boolean;
  setBatchBindOpen: (v: boolean) => void;
  excelImportOpen: boolean;
  setExcelImportOpen: (v: boolean) => void;
}

export function PurchaseOrderDetailImportSection(props: Props) {
  const {
    order, products, isLoading, canEdit, localItems,
    sourceOrderMap, sourceOrderStoreMap, sourceOrderDateMap,
    submitNewItems, handleBindSources, handleBatchBindSources,
    bindItem, setBindItem, addItemOpen, setAddItemOpen,
    importOpen, setImportOpen, batchBindOpen, setBatchBindOpen,
    excelImportOpen, setExcelImportOpen,
  } = props;

  return (
    <>
      <Dialog open={addItemOpen} onOpenChange={setAddItemOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" />預算外品項</Button>
        </DialogTrigger>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>新增品項</DialogTitle>
            <DialogDescription>請挑選預算外需額外採購的品項，可調整數量與進貨價後一次加入。</DialogDescription>
          </DialogHeader>
          <PurchaseProductPicker
            purchaseOrderId={order.id}
            supplierId={order.supplier_id}
            isLoading={isLoading}
            onSubmit={async (items) => { if (await submitNewItems(items)) setAddItemOpen(false); }}
          />
        </DialogContent>
      </Dialog>

      {canEdit && (
        <Button size="sm" variant="outline" onClick={() => setBatchBindOpen(true)}>
          <Link2 className="h-4 w-4 mr-1" /> 批次綁定來源訂單
        </Button>
      )}

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline"><Download className="h-4 w-4 mr-1" />匯入銷售需求</Button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>匯入待採購品項</DialogTitle>
            <DialogDescription>從現有的銷售訂單中選取待採購的需求，自動填入採購清單。</DialogDescription>
          </DialogHeader>
          <ImportFromOrdersDialog products={products} supplierId={order.supplier_id || undefined} isLoading={isLoading} onSubmit={async (items) => { if (await submitNewItems(items)) setImportOpen(false); }} />
        </DialogContent>
      </Dialog>

      <BindSourceOrdersDialog
        open={!!bindItem}
        onOpenChange={(open) => { if (!open) setBindItem(null); }}
        poItem={bindItem}
        sourceOrderMap={sourceOrderMap}
        sourceOrderStoreMap={sourceOrderStoreMap}
        sourceOrderDateMap={sourceOrderDateMap}
        isLoading={isLoading}
        onSubmit={handleBindSources}
      />

      <BatchBindSourceOrdersDialog
        open={batchBindOpen}
        onOpenChange={setBatchBindOpen}
        items={localItems}
        sourceOrderMap={sourceOrderMap}
        sourceOrderStoreMap={sourceOrderStoreMap}
        sourceOrderDateMap={sourceOrderDateMap}
        isLoading={isLoading}
        onSubmit={handleBatchBindSources}
      />

      <Dialog open={excelImportOpen} onOpenChange={setExcelImportOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" disabled={!order.supplier_id} title={!order.supplier_id ? '請先在編輯中指定供應商' : '從供應商格式的 Excel 匯入'}>
            <FileSpreadsheet className="h-4 w-4 mr-1" />
            廠商格式匯入
          </Button>
        </DialogTrigger>
        {order.supplier_id && (
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>從廠商 Excel 匯入</DialogTitle>
              <DialogDescription>上傳供應商提供的特定格式 Excel 檔案，系統將自動解析並載入採購品項。</DialogDescription>
            </DialogHeader>
            <ExcelImportDialog
              supplierId={order.supplier_id}
              supplierName={order.supplier?.name || '未知供應商'}
              isLoading={isLoading}
              onImport={async (items) => { if (await submitNewItems(items)) setExcelImportOpen(false); }}
            />
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}