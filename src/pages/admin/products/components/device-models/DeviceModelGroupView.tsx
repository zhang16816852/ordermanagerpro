import { useMemo } from 'react';
import { DeviceModel } from '../../hooks/useDeviceModels';
import { UseMutationResult } from '@tanstack/react-query';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Edit, Trash2 } from 'lucide-react';

interface DeviceModelGroupViewProps {
  isLoading: boolean;
  models: DeviceModel[];
  deviceBrands: any[];
  openEdit: (model: DeviceModel) => void;
  updateMutation: UseMutationResult<any, Error, { id: string; values: any }, unknown>;
  deleteMutation: UseMutationResult<void, Error, string, unknown>;
}

export function DeviceModelGroupView({
  isLoading,
  models,
  deviceBrands,
  openEdit,
  updateMutation,
  deleteMutation
}: DeviceModelGroupViewProps) {

  // Group models by brand, then by type, then by series
  const groupedData = useMemo(() => {
    const brandMap: Record<string, {
      name: string;
      types: Record<string, {
        name: string;
        series: Record<string, {
          name: string;
          models: DeviceModel[];
        }>
      }>
    }> = {};

    models.forEach(model => {
      const brandId = model.brand_id || 'unassigned';
      const typeName = model.device_type || '一般類型';
      const seriesName = model.device_series || '一般系列';

      if (!brandMap[brandId]) {
        brandMap[brandId] = {
          name: brandId === 'unassigned' ? '未分類廠牌' : (deviceBrands.find(b => b.id === brandId)?.name || '未知廠牌'),
          types: {}
        };
      }

      if (!brandMap[brandId].types[typeName]) {
        brandMap[brandId].types[typeName] = { name: typeName, series: {} };
      }

      if (!brandMap[brandId].types[typeName].series[seriesName]) {
        brandMap[brandId].types[typeName].series[seriesName] = { name: seriesName, models: [] };
      }

      brandMap[brandId].types[typeName].series[seriesName].models.push(model);
    });

    // Convert to sorted arrays
    const sortedBrands = Object.entries(brandMap).sort((a, b) => {
      if (a[0] === 'unassigned') return 1;
      if (b[0] === 'unassigned') return -1;
      return a[1].name.localeCompare(b[1].name);
    });

    return sortedBrands.map(([brandId, brand]) => ({
      id: brandId,
      name: brand.name,
      totalCount: models.filter(m => (m.brand_id || 'unassigned') === brandId).length,
      types: Object.values(brand.types).sort((a, b) => a.name.localeCompare(b.name)).map(type => ({
        name: type.name,
        count: Object.values(type.series).reduce((acc, s) => acc + s.models.length, 0),
        series: Object.values(type.series).sort((a, b) => a.name.localeCompare(b.name)).map(s => ({
          name: s.name,
          models: s.models.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        }))
      }))
    }));
  }, [models, deviceBrands]);

  if (isLoading) {
    return <div className="h-24 flex items-center justify-center text-muted-foreground">載入中...</div>;
  }

  if (models.length === 0) {
    return <div className="h-24 flex items-center justify-center text-muted-foreground border rounded-lg bg-background">尚無型號資料</div>;
  }

  return (
    <div className="border rounded-lg bg-background overflow-hidden p-4">
      <Accordion type="multiple" className="w-full space-y-4">
        {groupedData.map((brand) => (
          <AccordionItem key={brand.id} value={brand.id} className="border rounded-lg px-4 bg-muted/10 shadow-sm overflow-hidden">
            <AccordionTrigger className="hover:no-underline py-4">
              <div className="flex items-center gap-3">
                <span className="font-bold text-xl text-primary">{brand.name}</span>
                <Badge variant="secondary" className="font-normal">{brand.totalCount} 個型號</Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <Accordion type="multiple" className="w-full space-y-2 pl-4 border-l-2 border-primary/10 ml-2">
                {brand.types.map((type) => (
                  <AccordionItem key={type.name} value={type.name} className="border-none">
                    <AccordionTrigger className="hover:no-underline py-2 bg-muted/20 px-3 rounded-md">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-base">{type.name}</span>
                        <span className="text-xs text-muted-foreground">({type.count})</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pt-2 pb-0">
                      <div className="space-y-4 pt-2">
                        {type.series.map((s) => (
                          <div key={s.name} className="space-y-3 pl-2">
                            <div className="flex items-center gap-2 px-1">
                              <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                              <h4 className="font-bold text-sm text-muted-foreground uppercase tracking-tight">
                                {s.name} <span className="text-[10px] font-normal lowercase opacity-70">({s.models.length})</span>
                              </h4>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pl-4">
                              {s.models.map(model => (
                                <div key={model.id} className={`flex flex-col gap-2 p-3 border rounded-md bg-card shadow-sm transition-all hover:shadow-md ${!model.is_active ? 'opacity-60 bg-muted/30' : ''}`}>
                                  <div className="flex items-start justify-between">
                                    <div className="flex flex-col max-w-[80%]">
                                      <div className="font-bold text-sm truncate" title={model.name}>{model.name}</div>
                                      {model.release_date && (
                                        <div className="text-[10px] text-muted-foreground">{model.release_date}</div>
                                      )}
                                    </div>
                                    <Switch
                                      checked={model.is_active || false}
                                      onCheckedChange={(checked) => updateMutation.mutate({ id: model.id, values: { is_active: checked } })}
                                    />
                                  </div>
                                  
                                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground mt-1">
                                    {model.screen_size && <span className="bg-muted px-1 rounded">{model.screen_size}</span>}
                                  </div>
                                  
                                  {model.device_remarks && (
                                    <div className="text-[10px] text-muted-foreground bg-muted/50 p-1.5 rounded line-clamp-1 italic mt-1" title={model.device_remarks}>
                                      {model.device_remarks}
                                    </div>
                                  )}
                                  
                                  <div className="flex justify-between items-center mt-2 border-t pt-2 border-dashed">
                                    <span className="text-[10px] text-muted-foreground">排序: {model.sort_order}</span>
                                    <div className="flex gap-1">
                                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(model)}>
                                        <Edit className="h-3 w-3 text-muted-foreground" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                                        onClick={() => {
                                          if (confirm(`確定要刪除「${model.name}」嗎？此操作不可逆。`)) {
                                            deleteMutation.mutate(model.id);
                                          }
                                        }}
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}

