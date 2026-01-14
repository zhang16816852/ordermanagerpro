import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tables } from '@/integrations/supabase/types';
import { BasicInfoForm } from './BasicInfoForm';
import { VariantSection } from './VariantSection';

type Product = Tables<'products'>;

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void; // 處理基本資訊提交
  initialData: Product | null;
  isLoading?: boolean;
}

export function ProductFormDialog({ open, onOpenChange, onSubmit, initialData, isLoading }: ProductFormDialogProps) {
  const [activeTab, setActiveTab] = useState('basic');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle>{initialData ? `編輯產品: ${initialData.name}` : '新增產品'}</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
          <div className="px-6 border-b">
            <TabsList className="w-full justify-start h-12 bg-transparent p-0 gap-6">
              <TabsTrigger value="basic" className="data-[state=active]:border-b-2 border-primary rounded-none px-2 h-12 bg-transparent shadow-none">
                基本資訊
              </TabsTrigger>
              <TabsTrigger 
                value="variants" 
                disabled={!initialData || !initialData.has_variants}
                className="data-[state=active]:border-b-2 border-primary rounded-none px-2 h-12 bg-transparent shadow-none"
              >
                變體管理 {!initialData && '(儲存後可用)'}
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <TabsContent value="basic" className="m-0 focus-visible:ring-0">
              <BasicInfoForm 
                initialData={initialData} 
                onSubmit={onSubmit} 
                isLoading={isLoading} 
                onCancel={() => onOpenChange(false)}
              />
            </TabsContent>

            <TabsContent value="variants" className="m-0 focus-visible:ring-0">
              {initialData && <VariantSection product={initialData} />}
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}