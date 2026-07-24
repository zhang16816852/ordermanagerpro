import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, PackageCheck, CreditCard, Download, FileSpreadsheet } from 'lucide-react';
import { PurchaseOrder, PurchaseOrderItem, ProductWithPrice } from '../types';
import { ItemForm } from './ItemForm';
import { ImportFromOrdersDialog } from './ImportFromOrdersDialog';
import { ReceiveForm } from './ReceiveForm';
import { PaymentForm } from './PaymentForm';
import { ExcelImportDialog } from './ExcelImportDialog';
import { exportToCSV } from '@/lib/exportUtils';
import * as xlsx from 'xlsx';


interface OrderDetailDialogProps {
  order: PurchaseOrder;
  orderItems: PurchaseOrderItem[];
  products: ProductWithPrice[];
  accounts: any[];
  sourceOrderMap: Record<string, string>;
  supplierMappingMap: Record<string, { vendor_product_id: string; vendor_product_name: string }>;
  onAddItem: (data: any) => void;
  onImportItems: (items: any[]) => void;
  onReceiveItems: (data: any) => void;
  onMakePayment: (data: any) => void;
  isLoading: boolean;
}

export function OrderDetailDialog({
  order,
  orderItems,
  products,
  accounts,
  sourceOrderMap,
  supplierMappingMap,
  onAddItem,
  onImportItems,
  onReceiveItems,
  onMakePayment,
  isLoading
}: OrderDetailDialogProps) {
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [excelImportOpen, setExcelImportOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const getMappingKey = (item: PurchaseOrderItem) => `${item.product_id}_${item.variant_id || 'null'}`;

  const handleExportCSV = () => {
    const data = orderItems.map(item => {
      const mapping = supplierMappingMap[getMappingKey(item)];
      return {
        'SKU': item.variant?.sku || item.product?.sku || '',
        '產品名稱': item.product?.name || '',
        '變體': item.variant?.name || '',
        '廠商代碼': mapping?.vendor_product_id || '',
        '廠商名稱': mapping?.vendor_product_name || '',
        '數量': item.quantity,
        '已收': item.received_quantity,
        '單價': item.unit_cost,
        '總額': item.quantity * item.unit_cost,
        '來源訂單': (item.source_order_ids || []).map(id => sourceOrderMap[id] || id.slice(0, 8)).join(', '),
      };
    });
    exportToCSV(data, `採購單_${order.id.slice(0, 8)}`);
  };

  const handleExportExcel = () => {
    const data = orderItems.map(item => {
      const mapping = supplierMappingMap[getMappingKey(item)];
      return {
        'SKU': item.variant?.sku || item.product?.sku || '',
        '產品名稱': item.product?.name || '',
        '變體': item.variant?.name || '',
        '廠商代碼': mapping?.vendor_product_id || '',
        '廠商名稱': mapping?.vendor_product_name || '',
        '數量': item.quantity,
        '已收': item.received_quantity,
        '單價': item.unit_cost,
        '總額': item.quantity * item.unit_cost,
        '來源訂單': (item.source_order_ids || []).map(id => sourceOrderMap[id] || id.slice(0, 8)).join(', '),
      };
    });
    const ws = xlsx.utils.json_to_sheet(data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, '採購單');
    xlsx.writeFile(wb, `採購單_${order.id.slice(0, 8)}_${Date.now()}.xlsx`);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft': return <Badge variant="secondary">草稿</Badge>;
      case 'ordered': return <Badge variant="outline" className="border-blue-500 text-blue-500">已下單</Badge>;
      case 'partial_received': return <Badge variant="outline" className="border-orange-500 text-orange-500">部分收貨</Badge>;
      case 'received': return <Badge variant="outline" className="border-green-500 text-green-500">已收貨</Badge>;
      case 'cancelled': return <Badge variant="destructive">已取消</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6 py-4">
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold">採購單 #{order.id.slice(0, 8)}</h2>
            {getStatusBadge(order.status)}
          </div>
          <p className="text-sm text-muted-foreground">供應商: {order.supplier?.name || '未指定'}</p>
          {order.supplier_order_number && (
            <p className="text-sm text-muted-foreground">廠商單號: {order.supplier_order_number}</p>
          )}
          <p className="text-sm text-muted-foreground">日期: {order.order_date}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={handleExportCSV}>
            <Download className="h-4 w-4 mr-1" />匯出 CSV
          </Button>
          <Button size="sm" variant="outline" onClick={handleExportExcel}>
            <FileSpreadsheet className="h-4 w-4 mr-1" />匯出 Excel
          </Button>
          <Dialog open={addItemOpen} onOpenChange={setAddItemOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" />預算外品項</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>新增品項</DialogTitle>
                <DialogDescription>
                  請手動輸入產品與變體資訊，以新增預算外獲額外採購的品項。
                </DialogDescription>
              </DialogHeader>
              <ItemForm products={products} isLoading={isLoading} onSubmit={(data) => { onAddItem(data); setAddItemOpen(false); }} />
            </DialogContent>
          </Dialog>

          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline"><Download className="h-4 w-4 mr-1" />匯入銷售需求</Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>匯入待採購品項</DialogTitle>
                <DialogDescription>
                  從現有的銷售訂單中選取待採購的需求，自動填入採購清單。
                </DialogDescription>
              </DialogHeader>
              <ImportFromOrdersDialog products={products} isLoading={isLoading} onSubmit={(items) => { onImportItems(items); setImportOpen(false); }} />
            </DialogContent>
          </Dialog>

          <Dialog open={excelImportOpen} onOpenChange={setExcelImportOpen}>
            <DialogTrigger asChild>
              <Button 
                size="sm" 
                variant="outline" 
                disabled={!order.supplier_id} 
                title={!order.supplier_id ? "請先在編輯中指定供應商" : "從供應商格式的 Excel 匯入"}
              >
                <FileSpreadsheet className="h-4 w-4 mr-1" />
                廠商格式匯入
              </Button>
            </DialogTrigger>
            {order.supplier_id && (
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>從廠商 Excel 匯入</DialogTitle>
                  <DialogDescription>
                    上傳供應商提供的特定格式 Excel 檔案，系統將自動解析並載入採購品項。
                  </DialogDescription>
                </DialogHeader>
                <ExcelImportDialog 
                  supplierId={order.supplier_id} 
                  supplierName={order.supplier?.name || '未知供應商'}
                  isLoading={isLoading} 
                  onImport={(items) => { onImportItems(items); setExcelImportOpen(false); }} 
                />
              </DialogContent>
            )}
          </Dialog>
        </div>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>產品名稱</TableHead>
              <TableHead>廠商代碼</TableHead>
              <TableHead>廠商名稱</TableHead>
              <TableHead>來源訂單</TableHead>
              <TableHead className="text-right">數量</TableHead>
              <TableHead className="text-right">已收</TableHead>
              <TableHead className="text-right">單價</TableHead>
              <TableHead className="text-right">總額</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orderItems.map((item) => {
              const mapping = supplierMappingMap[getMappingKey(item)];
              return (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs">{item.variant?.sku || item.product?.sku}</TableCell>
                  <TableCell>
                    <p className="text-sm font-medium">{item.product?.name}</p>
                    {item.variant?.name && <p className="text-xs text-muted-foreground">{item.variant.name}</p>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{mapping?.vendor_product_id || '-'}</TableCell>
                  <TableCell className="text-sm">{mapping?.vendor_product_name || '-'}</TableCell>
                  <TableCell>
                    {(item.source_order_ids || []).length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {item.source_order_ids!.map(id => (
                          <Badge key={id} variant="outline" className="text-xs">
                            {sourceOrderMap[id] || id.slice(0, 8)}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">{item.quantity}</TableCell>
                  <TableCell className="text-right">
                    <span className={item.received_quantity >= item.quantity ? 'text-green-600 font-bold' : 'text-orange-600'}>
                      {item.received_quantity}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">${item.unit_cost.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-bold">${(item.quantity * item.unit_cost).toLocaleString()}</TableCell>
                </TableRow>
              );
            })}
            {orderItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground italic">目前無任何品項</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-between items-end bg-muted/30 p-4 rounded-lg">
        <div className="flex gap-3">
          <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
            <DialogTrigger asChild>
              <Button variant="default" className="bg-green-600 hover:bg-green-700">
                <PackageCheck className="h-4 w-4 mr-2" /> 收貨錄入
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>記錄收貨</DialogTitle>
                <DialogDescription>
                  請核對收到的實物數量，錄入系統以增加庫存。支援部分收貨。
                </DialogDescription>
              </DialogHeader>
              <ReceiveForm items={orderItems} isLoading={isLoading} onSubmit={(data) => { onReceiveItems(data); setReceiveOpen(false); }} />
            </DialogContent>
          </Dialog>

          <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="border-blue-500 text-blue-500 hover:bg-blue-50">
                <CreditCard className="h-4 w-4 mr-2" /> 付款對帳
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>記錄付款</DialogTitle>
                <DialogDescription>
                  記錄對供應商的付款流水，關聯至特定帳戶以進行對帳。
                </DialogDescription>
              </DialogHeader>
              <PaymentForm accounts={accounts} amount={order.total_amount} isLoading={isLoading} onSubmit={(data) => { onMakePayment(data); setPaymentOpen(false); }} />
            </DialogContent>
          </Dialog>
        </div>

        <div className="text-right space-y-1">
          <p className="text-sm text-muted-foreground">總計金額</p>
          <p className="text-3xl font-bold text-primary">${order.total_amount.toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}
