import { useState, useEffect, useRef } from 'react';
import { useForm, UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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

import { serializeSpecs, deserializeSpecs } from '@/utils/specLogic';
import { useSpecStore } from '@/store/useSpecStore';
import { useCategorySpecs } from '@/hooks/useCategorySpecs';
import { getVisibleSpecsTree } from '@/utils/specLogic';

interface ProductFormBodyProps {
  active: boolean;
  initialData: Product & { category_ids?: string[] } | null;
  onSubmit: (data: any) => void;
  isLoading?: boolean;
  onClose: () => void;
  registerForm?: (form: UseFormReturn<any>) => void;
}

export function ProductFormBody({ active, initialData, onSubmit, isLoading, onClose, registerForm }: ProductFormBodyProps) {
  const [activeTab, setActiveTab] = useState('basic');
  const { specMap, refreshIfStale, specTriggers } = useSpecStore();
  const [matrixDirty, setMatrixDirty] = useState(false);
  const [unsavedWarning, setUnsavedWarning] = useState(false);
  const matrixRef = useRef<VariantSpecsMatrixHandle>(null);

  // 統一價格狀態
  const [unifiedPricing, setUnifiedPricing] = useState(false);
  const [unifiedWholesale, setUnifiedWholesale] = useState('0');
  const [unifiedRetail, setUnifiedRetail] = useState('0');
  const [unifiedDirty, setUnifiedDirty] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const initialUnifiedRef = useRef({ unified_pricing: false, unified_wholesale_price: 0, unified_retail_price: 0 });

  // 1. 在父層初始化 Form
  const form = useForm<z.infer<typeof productSchema>>({
    resolver: zodResolver(productSchema),
    defaultValues: {
            name: '', code: '', category_ids: [], device_model_ids: [], device_model_group_ids: [], device_model_exclusion_ids: [], brand_ids: [], brand_series_ids: [],
      spec_values: {},
    },
  });

  const { data: productSpecFields = [] } = useCategorySpecs(form.watch('category_ids') || []);

  const isDirty = form.formState.isDirty || matrixDirty || unifiedDirty;

  const requestClose = (next: boolean) => {
    if (!next && isDirty) {
      setUnsavedWarning(true);
      return;
    }
    onClose();
  };

  useEffect(() => {
    (form as any).__getVariantSpecs = () => matrixRef.current?.getState?.() ?? null;
    registerForm?.(form);
  }, [registerForm, form]);

  const proceedSave = () => {
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
      setUnifiedDirty(false);
      initialUnifiedRef.current = {
        unified_pricing: unifiedPricing,
        unified_wholesale_price: parseFloat(unifiedWholesale) || 0,
        unified_retail_price: parseFloat(unifiedRetail) || 0,
      };
    })();
  };

  const handleSaveAll = () => {
    // 首次開啟統一價格時，提醒將覆寫所有現有變體價格
    if (unifiedPricing && !initialUnifiedRef.current.unified_pricing) {
      setConfirmOverwrite(true);
      return;
    }
    proceedSave();
  };

  // 2. 當切換編輯對象或 active 時，同步 Form 資料
  useEffect(() => {
    if (active) {
      // 開啟時確保規格定義為最新（比對版本、落後才重抓，避免沿用舊快取）
      refreshIfStale();

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

          // 同步統一價格狀態
          setUnifiedPricing(!!(initialData as any).unified_pricing);
          setUnifiedWholesale(String((initialData as any).unified_wholesale_price ?? 0));
          setUnifiedRetail(String((initialData as any).unified_retail_price ?? 0));
          setUnifiedDirty(false);
          initialUnifiedRef.current = {
            unified_pricing: !!(initialData as any).unified_pricing,
            unified_wholesale_price: Number((initialData as any).unified_wholesale_price ?? 0),
            unified_retail_price: Number((initialData as any).unified_retail_price ?? 0),
          };
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
          setUnifiedPricing(false);
          setUnifiedWholesale('0');
          setUnifiedRetail('0');
          setUnifiedDirty(false);
          initialUnifiedRef.current = { unified_pricing: false, unified_wholesale_price: 0, unified_retail_price: 0 };
        }
      };

      loadInitialData();
      setActiveTab('basic'); // 每次打開預設回到基本資訊
    }
  }, [active, initialData, form, refreshIfStale]);

  // 封裝 Submit 以進行資料轉換 (Object -> Array)
  const handleWrappedSubmit = (values: any) => {
    // 將前端的路徑 Object 轉換為後端的 V6 Entry 格式
    const serializedSettings = serializeSpecs(
      values.spec_values,
      specMap
    );
    onSubmit({
      ...values,
      spec_values: serializedSettings as any,
      unified_pricing: unifiedPricing,
      unified_wholesale_price: parseFloat(unifiedWholesale) || 0,
      unified_retail_price: parseFloat(unifiedRetail) || 0,
    });
  };

  return (
    <>
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

            {/* 統一價格標記（DAIGO 風格） */}
            <Card className="mt-6 border-dashed">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">統一價格</CardTitle>
                    {unifiedPricing && (
                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300">已啟用</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="unified-pricing"
                      checked={unifiedPricing}
                      onCheckedChange={(v) => {
                        setUnifiedPricing(!!v);
                        setUnifiedDirty(true);
                      }}
                    />
                    <Label htmlFor="unified-pricing" className="cursor-pointer text-sm font-medium">
                      此產品所有變體共用同一組價格
                    </Label>
                  </div>
                </div>
                <CardDescription>
                  勾選後，所有型號／顏色變體的批發價與零售價將被綁定為同一組價格；未來新增變體也會自動繼承。連鎖客戶價格將以產品層級統一生效。
                </CardDescription>
              </CardHeader>
              {unifiedPricing && (
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="unified-wholesale" className="text-sm">統一批發價</Label>
                    <Input
                      id="unified-wholesale"
                      type="number"
                      value={unifiedWholesale}
                      onChange={(e) => { setUnifiedWholesale(e.target.value); setUnifiedDirty(true); }}
                      placeholder="批發價"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="unified-retail" className="text-sm">統一零售價</Label>
                    <Input
                      id="unified-retail"
                      type="number"
                      value={unifiedRetail}
                      onChange={(e) => { setUnifiedRetail(e.target.value); setUnifiedDirty(true); }}
                      placeholder="零售價"
                    />
                  </div>
                </CardContent>
              )}
            </Card>
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
                onClose();
              }}
            >
              捨棄變更並關閉
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmOverwrite} onOpenChange={setConfirmOverwrite}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>啟用統一價格</AlertDialogTitle>
            <AlertDialogDescription>
              啟用後，此產品「所有現有變體」的批發價與零售價將被覆寫為統一價格，且未來新增變體也會繼承。確定要套用嗎？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmOverwrite(false)}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOverwrite(false);
                proceedSave();
              }}
            >
              確認套用統一價格
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  initialData: Product & { category_ids?: string[] } | null;
  isLoading?: boolean;
}

export function ProductFormDialog({ open, onOpenChange, onSubmit, initialData, isLoading }: ProductFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
        aria-describedby={undefined}
      >
        <DialogHeader className="p-6 pb-0">
          <DialogTitle>{initialData ? `編輯產品: ${initialData.name}` : '新增產品'}</DialogTitle>
          <DialogDescription>
            請在此填寫產品的基本資訊、型號與規格。完成後點擊「儲存所有變更」按鈕以同步資料。
          </DialogDescription>
        </DialogHeader>

        <ProductFormBody
          active={open}
          initialData={initialData}
          onSubmit={onSubmit}
          isLoading={isLoading}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}