import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/layout/PageHeader';
import { Truck } from 'lucide-react';
import DeliveryMethodsPage from '@/pages/admin/DeliveryMethodsPage';
import ShippingSettlementsPage from '@/pages/admin/shipping-settlements/ShippingSettlementsPage';

type LogisticsTab = 'delivery-methods' | 'shipping-settlements';

// 物流管理統一頁：配送方式＋運費月結，tab 以 ?tab= url 路由（預設配送方式）
export default function LogisticsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: LogisticsTab =
    searchParams.get('tab') === 'shipping-settlements' ? 'shipping-settlements' : 'delivery-methods';

  const handleTabChange = (v: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v === 'delivery-methods') next.delete('tab');
        else next.set('tab', v);
        return next;
      },
      { replace: true }
    );
  };

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="物流管理"
        subtitle="統一管理配送方式與運費月結結算"
        icon={<Truck className="h-5 w-5 text-emerald-500" />}
      />
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList>
          <TabsTrigger value="delivery-methods">配送方式</TabsTrigger>
          <TabsTrigger value="shipping-settlements">運費月結</TabsTrigger>
        </TabsList>
        <TabsContent value="delivery-methods" className="space-y-4">
          <DeliveryMethodsPage embedded />
        </TabsContent>
        <TabsContent value="shipping-settlements" className="space-y-4">
          <ShippingSettlementsPage embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}