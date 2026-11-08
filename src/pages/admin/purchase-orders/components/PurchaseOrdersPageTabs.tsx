import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ClipboardList, Users, PackageCheck } from 'lucide-react';
import { PurchaseOrdersPageOrdersTab } from './PurchaseOrdersPageOrdersTab';
import { ReceivingTab } from './ReceivingTab';
import { SupplierTab } from './SupplierTab';

interface Props {
  activeTab: string;
  onTabChange: (v: string) => void;
  // orders tab props passed through
  ordersTabProps: any;
  suppliers: any[];
  onAddSupplier: () => void;
  onEditSupplier: (s: any) => void;
  isLoadingSuppliers: boolean;
}

export function PurchaseOrdersPageTabs({
  activeTab,
  onTabChange,
  ordersTabProps,
  suppliers,
  onAddSupplier,
  onEditSupplier,
  isLoadingSuppliers,
}: Props) {
  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="space-y-4">
      <TabsList>
        <TabsTrigger value="orders" className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4" aria-hidden="true" /> 採購單
        </TabsTrigger>
        <TabsTrigger value="receiving" className="flex items-center gap-2">
          <PackageCheck className="h-4 w-4" aria-hidden="true" /> 進貨處理
        </TabsTrigger>
        <TabsTrigger value="suppliers" className="flex items-center gap-2">
          <Users className="h-4 w-4" aria-hidden="true" /> 供應商夥伴
        </TabsTrigger>
      </TabsList>

      <TabsContent value="orders" className="space-y-4">
        <PurchaseOrdersPageOrdersTab {...ordersTabProps} />
      </TabsContent>

      <TabsContent value="receiving" className="space-y-4">
        <ReceivingTab />
      </TabsContent>

      <TabsContent value="suppliers" className="space-y-4">
        <SupplierTab
          suppliers={suppliers}
          onAdd={onAddSupplier}
          onEdit={onEditSupplier}
          isLoading={isLoadingSuppliers}
        />
      </TabsContent>
    </Tabs>
  );
}