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

  // Group models by brand
  const groupedModels = useMemo(() => {
    const groups: Record<string, { brandName: string, models: DeviceModel[] }> = {};
    
    // Initialize groups based on existing brands to keep order, or just dynamically
    models.forEach(model => {
      const brandId = model.brand_id || 'unassigned';
      if (!groups[brandId]) {
        groups[brandId] = {
          brandName: brandId === 'unassigned' ? '未分類廠牌' : (deviceBrands.find(b => b.id === brandId)?.name || '未知廠牌'),
          models: []
        };
      }
      groups[brandId].models.push(model);
    });

    // Sort models within each group
    Object.values(groups).forEach(g => {
        g.models.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    });

    // Sort groups alphabetically by brandName, put 'unassigned' at the bottom
    const sortedGroupEntries = Object.entries(groups).sort((a, b) => {
      if (a[0] === 'unassigned') return 1;
      if (b[0] === 'unassigned') return -1;
      return a[1].brandName.localeCompare(b[1].brandName);
    });

    return sortedGroupEntries;
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
        {groupedModels.map(([brandId, group]) => (
          <AccordionItem key={brandId} value={brandId} className="border rounded-lg px-4 bg-muted/10">
            <AccordionTrigger className="hover:no-underline py-3">
              <div className="flex items-center gap-3">
                <span className="font-bold text-lg">{group.brandName}</span>
                <Badge variant="secondary">{group.models.length} 個型號</Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-2 pb-4">
                {group.models.map(model => (
                  <div key={model.id} className={`flex flex-col gap-2 p-3 border rounded-md bg-card shadow-sm ${!model.is_active ? 'opacity-60 bg-muted/30' : ''}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex flex-col max-w-[80%]">
                        <div className="font-medium text-base truncate" title={model.name}>{model.name}</div>
                        {model.device_series && (
                          <div className="text-xs text-muted-foreground mt-0.5">{model.device_series}</div>
                        )}
                      </div>
                      <Switch
                        checked={model.is_active || false}
                        onCheckedChange={(checked) => updateMutation.mutate({ id: model.id, values: { is_active: checked } })}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-1">
                      {model.device_type && <Badge variant="outline" className="text-[10px] h-4">{model.device_type}</Badge>}
                      {model.screen_size && <span>{model.screen_size}</span>}
                      {model.release_date && <span className="bg-muted px-1.5 py-0.5 rounded text-[10px]">{model.release_date}</span>}
                    </div>
                    {model.device_remarks && (
                      <div className="text-[11px] text-muted-foreground bg-muted/30 p-1.5 rounded line-clamp-2 mt-1" title={model.device_remarks}>
                        {model.device_remarks}
                      </div>
                    )}
                    <div className="flex justify-between items-center mt-2 border-t pt-2">
                      <span className="text-xs text-muted-foreground">排序: {model.sort_order}</span>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(model)}>
                          <Edit className="h-3 w-3 text-muted-foreground" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
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
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
