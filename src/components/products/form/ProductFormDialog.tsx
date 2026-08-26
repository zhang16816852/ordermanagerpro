import { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Save, AlertTriangle, Loader2 } from 'lucide-react';
import { Tables } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';
import { BasicInfoForm } from './BasicInfoForm';
import { VariantSection } from './VariantSection';
import { VariantSpecsMatrix, VariantSpecsMatrixHandle } from './sections/VariantSpecsMatrix';
import { VariantModelMatrix } from './sections/VariantModelMatrix';
import { DynamicSpecsFields } from './sections/DynamicSpecsFields';
import { ProductImageManager } from '@/components/products/images/ProductImageManager';
import { EntityBindingManager } from './sections/EntityBindingManager';

// 統一定義 Schema
const productSchema = z.object({
  name: z.string().min(1, '產品名稱為必填'),
  code: z.string().min(1, '產品代碼為必填'),
  category_ids: z.array(z.string().uuid()).default([]),
  device_model_ids: z.array(z.string().uuid()).default([]),
  device_model_group_ids: z.array(z.string().uuid()).default([]),
  device_model_exclusion_ids: z.array(z.string().uuid()).default([]),
  brand_ids: z.array(z.string().uuid()).default([]),
  brand_series_ids: z.array(z.string().uuid()).default([]),
  spec_values: z.any().nullable().optional(),
});

type Product = Tables<'products'>;

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  initialData: Product & { category_ids?: string[] } | null;
  isLoading?: boolean;
}

import { serializeSpecs, deserializeSpecs } from '@/utils/specLogic';
import { useSpecStore } from '@/store/useSpecStore';
import { useCategorySpecs } from '@/hooks/useCategorySpecs';
import { getVisibleSpecsTree } from '@/utils/specLogic';

export function ProductFormDialog({ open, onOpenChange, onSubmit, initialData, isLoading }: ProductFormDialogProps) {
  const [activeTab, setActiveTab] = useState('basic');
  const { specMap, fetchSpecs, specTriggers } = useSpecStore();
  const [matrixDirty, setMatrixDirty] = useState(false);
  const [unsavedWarning, setUnsavedWarning] = useState(false);
  const matrixRef = useRef<VariantSpecsMatrixHandle>(null);

  // 1. 在父層初始化 Form
  const form = useForm<z.infer<typeof productSchema>>({
    resolver: zodResolver(productSchema),
    defaultValues: {
            name: '', code: '', category_ids: [], device_model_ids: [], device_model_group_ids: [], device_model_exclusion_ids: [], brand_ids: [], brand_series_ids: [],
      spec_values: {},
    },
  });

  const { data: productSpecFields = [] } = useCategorySpecs(form.watch('category_ids') || []);

  const isDirty = form.formState.isDirty || matrixDirty;

  const requestClose = (next: boolean) => {
    if (!next && isDirty) {
      setUnsavedWarning(true);
      return;
    }
    onOpenChange(next);
  };

  const handleSaveAll = () => {
    form.handleSubmit(async (values) => {
      // 驗證產品層級必填規格（僅檢查目前可見者）
      const specValues = (values.spec_values as Record<string, any>) || {};
      const visibleInfo = getVisibleSpecsTree(productSpecFields, specValues, specTriggers);
      const missingNames = productSpecFields
        .filter(s => {
          if (!s.required) return false;
          const pathKey = Array.from(visibleInfo.keys()).find(k => k.split(':')[1] === (s as any).id);
          if (!pathKey) return false;
          const v = specValues[pathKey];
          const empty = v === '' || v === undefined || v === null ||
            (Array.isArray(v) && v.length === 0) ||
            (typeof v === 'object' && v && Object.keys(v).length === 0);
          return empty;
        })
        .map(s => (s as any).name);

      if (missingNames.length > 0) {
        toast.error(`以下必填規格尚未填寫：${missingNames.join('、')}`);
        return;
      }

      handleWrappedSubmit(values);
      await matrixRef.current?.save();
      form.reset(form.getValues());
      setMatrixDirty(false);
    })();
  };

  // 2. 當切換編輯對象或 Dialog 開關時，同步 Form 資料
  useEffect(() => {
    if (open) {
      // 開啟時同步抓取規格定義（快取會處理避免重複抓取）
      fetchSpecs();

      const loadInitialData = async () => {
        if (initialData) {
          console.log('[ProductFormDialog] Resetting form with initialData:', initialData);

          let currentSpecValues: any[] = [];

          // 編輯模式：從新資料表抓取規格數值
          if (initialData.id) {
            const { data, error } = await supabase
              .from('entity_spec_values')
              .select('*')
              .eq('entity_id', initialData.id)
              .eq('entity_type', 'product')
              .is('deleted_at', null);

            if (!error && data) {
              currentSpecValues = data;
            }
          }

          // 先設定基本資料
          form.reset({
            ...initialData,
            code: (initialData as any).code || '',
            category_ids: (initialData as any).category_ids || [],
            device_model_ids: [],
            device_model_group_ids: [],
            device_model_exclusion_ids: [],
            brand_ids: (initialData as any).brand_ids || [],
            brand_series_ids: (initialData as any).brand_series_ids || [],
            spec_values: deserializeSpecs(currentSpecValues.length > 0 ? currentSpecValues : (initialData as any).spec_values),
          });
          console.log(form)
          // 讀取型號標籤、群組標籤與排除的關聯
          if (initialData.id) {
            Promise.all([
              (supabase.from('entity_model_relations') as any).select('model_id').eq('product_id', initialData.id).eq('relation_type', 'include').not('model_id', 'is', null),
              (supabase.from('entity_model_relations') as any).select('group_id').eq('product_id', initialData.id).eq('relation_type', 'include').not('group_id', 'is', null),
              (supabase.from('entity_model_relations') as any).select('model_id').eq('product_id', initialData.id).eq('relation_type', 'exclude').not('model_id', 'is', null)
            ]).then(([models, groups, exclusions]) => {
              if (models.data) form.setValue('device_model_ids', models.data.map(d => d.model_id));
              if (groups.data) form.setValue('device_model_group_ids', groups.data.map(d => d.group_id));
              if (exclusions.data) form.setValue('device_model_exclusion_ids', exclusions.data.map(d => d.model_id));
            });
          }
        } else {
          form.reset({
      name: '', code: '', category_ids: [], device_model_ids: [], device_model_group_ids: [], device_model_exclusion_ids: [], brand_ids: [], brand_series_ids: [],
            spec_values: {},
          });
        }
      };

      loadInitialData();
      setActiveTab('basic'); // 每次打開預設回到基本資訊
    }
  }, [open, initialData, form, fetchSpecs]);

  // 封裝 Submit 以進行資料轉換 (Object -> Array)
  const handleWrappedSubmit = (values: any) => {
    // 將前端的路徑 Object 轉換為後端的 V6 Entry 格式
    const serializedSettings = serializeSpecs(
      values.spec_values,
      specMap
    );
    onSubmit({
      ...values,
      spec_values: serializedSettings as any
    });
  };

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent
        className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
        aria-describedby={undefined}
      >
        <DialogHeader className="p-6 pb-0">
          <DialogTitle>{initialData ? `編輯產品: ${form.watch('name') || initialData.name}` : '新增產品'}</DialogTitle>
          <DialogDescription>
            請在此填寫產品的基本資訊、型號與規格。完成後點擊「儲存所有變更」按鈕以同步資料。
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <div className="px-6 border-b">
            <TabsList className="w-full justify-start h-12 bg-transparent p-0 gap-6">
              <TabsTrigger value="basic" className="data-[state=active]:border-b-2 border-primary rounded-none px-2 h-12 bg-transparent shadow-none">
                基本資訊
              </TabsTrigger>
              <TabsTrigger
                value="productSpecs"
                disabled={(form.watch('category_ids') || []).length === 0}
                className="data-[state=active]:border-b-2 border-primary rounded-none px-2 h-12 bg-transparent shadow-none"
              >
                產品規格 {(!initialData || (form.watch('category_ids') || []).length === 0) && '(選擇分類後可用)'}
              </TabsTrigger>
              <TabsTrigger
                value="images"
                disabled={!initialData}
                className="data-[state=active]:border-b-2 border-primary rounded-none px-2 h-12 bg-transparent shadow-none"
              >
                圖片 {!initialData && '(儲存後可用)'}
              </TabsTrigger>
              <TabsTrigger
                value="variants"
                disabled={!initialData}
                className="data-[state=active]:border-b-2 border-primary rounded-none px-2 h-12 bg-transparent shadow-none"
              >
                變體列表 {!initialData && '(儲存後可用)'}
              </TabsTrigger>
              <TabsTrigger
                value="specs"
                disabled={!initialData}
                className="data-[state=active]:border-b-2 border-primary rounded-none px-2 h-12 bg-transparent shadow-none"
              >
                變體規格
              </TabsTrigger>
              <TabsTrigger
                value="models"
                disabled={!initialData}
                className="data-[state=active]:border-b-2 border-primary rounded-none px-2 h-12 bg-transparent shadow-none"
              >
                變體型號
              </TabsTrigger>
              <TabsTrigger
                value="bindings"
                disabled={!initialData}
                className="data-[state=active]:border-b-2 border-primary rounded-none px-2 h-12 bg-transparent shadow-none"
              >
                綁定
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <TabsContent value="basic" className="min-h-0 focus-visible:ring-0">
              {/* 3. 將 form 物件傳遞給子組件 */}
              <BasicInfoForm
                form={form}
                onSubmit={handleWrappedSubmit}
                isLoading={isLoading}
                onCancel={() => requestClose(false)}
              />
            </TabsContent>

            <TabsContent value="productSpecs" className="m-0 focus-visible:ring-0">
              <DynamicSpecsFields form={form} />
            </TabsContent>

            <TabsContent value="images" className="m-0 focus-visible:ring-0 p-2">
              {initialData && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">管理主商品封面與圖庫圖片。第一張圖片會自動設為封面，顯示在商品卡片上。</p>
                  <ProductImageManager entityType="product" entityId={initialData.id} />
                </div>
              )}
            </TabsContent>

            <TabsContent value="variants" className="m-0 focus-visible:ring-0">
              {initialData && <VariantSection product={initialData} />}
            </TabsContent>

            <TabsContent value="specs" className="m-0 focus-visible:ring-0">
              {initialData && (
                <div className="space-y-8">
                  <VariantSpecsMatrix
                    ref={matrixRef}
                    productId={initialData.id}
                    categoryIds={form.watch('category_ids')}
                    onDirtyChange={setMatrixDirty}
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="models" className="m-0 focus-visible:ring-0">
              {initialData && (
                <div className="space-y-8">
                  <VariantModelMatrix
                    productId={initialData.id}
                  />
                </div>
              )}
            </TabsContent>
            <TabsContent value="bindings" className="m-0 focus-visible:ring-0">
              {initialData && (
                <EntityBindingManager productId={initialData.id} />
              )}
            </TabsContent>
          </div>
        </Tabs>

        <div className="px-6 py-4 border-t bg-muted/20 flex items-center justify-between gap-3">
          {isDirty ? (
            <span className="text-xs text-amber-600 dark:text-amber-500 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              有尚未儲存的變更
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">所有變更已儲存</span>
          )}
          <Button onClick={handleSaveAll} disabled={!isDirty || isLoading} className="shadow-sm">
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            儲存所有變更
          </Button>
        </div>
      </DialogContent>

      <AlertDialog open={unsavedWarning} onOpenChange={setUnsavedWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>尚有未儲存的變更</AlertDialogTitle>
            <AlertDialogDescription>
              您剛才的修改尚未儲存，關閉後將會遺失。確定要捨棄這些變更嗎？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>繼續編輯</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                form.reset();
                setMatrixDirty(false);
                setUnsavedWarning(false);
                onOpenChange(false);
              }}
            >
              捨棄變更並關閉
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}