import { useState } from 'react';
import { useDeviceModels, DeviceModel } from '../hooks/useDeviceModels';
import Papa from 'papaparse';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Import split components
import { DeviceModelActions } from './device-models/DeviceModelActions';
import { DeviceModelListView } from './device-models/DeviceModelListView';
import { DeviceModelGroupView } from './device-models/DeviceModelGroupView';
import { DeviceModelDialog } from './device-models/DeviceModelDialog';

export function DeviceModelManager() {
  const queryClient = useQueryClient();
  const { models, isLoading, createMutation, updateMutation, deleteMutation } = useDeviceModels();

  const { data: deviceBrands = [] } = useQuery({
    queryKey: ['device_brands'],
    queryFn: async () => {
      const { data } = await supabase.from('device_brands').select('*').order('sort_order', { ascending: true });
      return data || [];
    }
  });

  const createBrandMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase.from('device_brands').insert([{ name }]).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['device_brands'] });
    }
  });

  const [search, setSearch] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingData, setEditingData] = useState<Partial<DeviceModel> | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const [typeFilter, setTypeFilter] = useState('all');

  const uniqueTypes = Array.from(new Set(models.map(m => m.device_type).filter(Boolean))) as string[];

  const filteredModels = models.filter(m => {
    const matchSearch = m.name.toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === 'all' || m.device_type === typeFilter;
    return matchSearch && matchType;
  });

  const handleSave = () => {
    if (!editingData?.name?.trim()) return;

    const payload = {
      name: editingData.name,
      sort_order: editingData.sort_order || 0,
      brand_id: editingData.brand_id || null,
      device_type: editingData.device_type || null,
      screen_size: editingData.screen_size || null,
      device_series: editingData.device_series || null,
      device_remarks: editingData.device_remarks || null,
      release_date: editingData.release_date || null
    };

    if (editingData.id) {
      updateMutation.mutate({ id: editingData.id, values: payload }, {
        onSuccess: () => setIsDialogOpen(false)
      });
    } else {
      createMutation.mutate({ ...payload, is_active: true }, {
        onSuccess: () => setIsDialogOpen(false)
      });
    }
  };

  const openEdit = (model?: DeviceModel) => {
    if (model) {
      setEditingData(model);
    } else {
      setEditingData({ name: '', sort_order: 0, is_active: true, brand_id: null, device_type: '', screen_size: '', device_series: '', device_remarks: '', release_date: '' });
    }
    setIsDialogOpen(true);
  };

  const handleExport = () => {
    const exportData = models.map(m => ({
      '型號名稱': m.name || '',
      '廠牌': m.brand_id ? deviceBrands.find((b: any) => b.id === m.brand_id)?.name || '' : '',
      '系列': m.device_series || '',
      '設備類型': m.device_type || '',
      '螢幕尺寸': m.screen_size || '',
      '出廠年月': m.release_date || '',
      '備註': m.device_remarks || '',
      '排序': m.sort_order || 0
    }));

    const csvHtml = Papa.unparse(exportData);
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvHtml], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '型號標籤庫.csv';
    link.click();
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const result = event.target?.result as string;
        Papa.parse(result, {
          header: true,
          skipEmptyLines: true,
          complete: async (results) => {
            try {
              const rows = results.data as any[];
              if (rows.length === 0) {
                toast.error('檔案內無資料');
                return;
              }

              // 1. 整理出現的廠牌並動態建檔
              const uniqueBrands = Array.from(new Set(rows.map(r => (r['廠牌'] || '').trim()).filter(Boolean)));
              const existingBrandNames = deviceBrands.map((b: any) => b.name.toLowerCase());
              const newBrandsToCreate = uniqueBrands.filter(b => !existingBrandNames.includes(b.toLowerCase()));

              if (newBrandsToCreate.length > 0) {
                const { error: brandError } = await supabase.from('device_brands').insert(
                  newBrandsToCreate.map(name => ({ name }))
                );
                if (brandError) throw brandError;
              }

              // 重新拉取一次廠牌表以獲得所有 ID
              const { data: updatedBrands } = await supabase.from('device_brands').select('*');
              const brandMap = new Map((updatedBrands || []).map((b: any) => [b.name.toLowerCase(), b.id]));

              // 2. 整理模型準備 upsert
              const modelsToInsert = rows.map(r => {
                const name = (r['型號名稱'] || r['name'] || '').trim();
                if (!name) return null;
                const bName = (r['廠牌'] || r['brand'] || '').trim().toLowerCase();
                return {
                  name,
                  brand_id: bName ? brandMap.get(bName) || null : null,
                  device_type: (r['設備類型'] || r['device_type'] || '').trim() || null,
                  device_series: (r['系列'] || r['device_series'] || '').trim() || null,
                  screen_size: (r['螢幕尺寸'] || r['screen_size'] || '').trim() || null,
                  release_date: (r['出廠年月'] || r['release_date'] || '').trim() || null,
                  device_remarks: (r['備註'] || r['device_remarks'] || '').trim() || null,
                  sort_order: parseInt(r['排序'] || r['sort_order']) || 0,
                  is_active: true
                };
              }).filter(Boolean);

              if (modelsToInsert.length > 0) {
                const { error: modelsError } = await supabase.from('device_models').upsert(modelsToInsert as any, { onConflict: 'name' });
                if (modelsError) throw modelsError;
              }

              toast.success(`成功匯入 ${modelsToInsert.length} 筆型號`);
              queryClient.invalidateQueries({ queryKey: ['device_models'] });
              queryClient.invalidateQueries({ queryKey: ['device_brands'] });
            } catch (err: any) {
              toast.error(`匯入處理失敗: ${err.message}`);
            } finally {
              setIsImporting(false);
              e.target.value = '';
            }
          },
          error: (error) => {
            toast.error(`解析失敗：${error.message}`);
            setIsImporting(false);
            e.target.value = '';
          }
        });
      } catch (err) {
        setIsImporting(false);
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  // Calculate unique series for the currently selected brand
  const uniqueSeriesByBrand = Array.from(
    new Set(
      models
        .filter(m => m.brand_id === editingData?.brand_id && m.device_series)
        .map(m => m.device_series as string)
    )
  );

  return (
    <div className="space-y-4">
      <DeviceModelActions
        search={search}
        setSearch={setSearch}
        typeFilter={typeFilter}
        setTypeFilter={setTypeFilter}
        uniqueTypes={uniqueTypes}
        openEdit={openEdit}
        isImporting={isImporting}
        handleImport={handleImport}
        handleExport={handleExport}
      />

      <Tabs defaultValue="list" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
          <TabsTrigger value="list">詳細清單</TabsTrigger>
          <TabsTrigger value="group">依品牌檢視</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          <DeviceModelListView
            isLoading={isLoading}
            models={filteredModels}
            deviceBrands={deviceBrands}
            openEdit={openEdit}
            updateMutation={updateMutation}
            deleteMutation={deleteMutation}
          />
        </TabsContent>

        <TabsContent value="group" className="mt-4">
          <DeviceModelGroupView
            isLoading={isLoading}
            models={filteredModels}
            deviceBrands={deviceBrands}
            openEdit={openEdit}
            updateMutation={updateMutation}
            deleteMutation={deleteMutation}
          />
        </TabsContent>
      </Tabs>

      <DeviceModelDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        editingData={editingData}
        setEditingData={setEditingData}
        deviceBrands={deviceBrands}
        createBrandMutation={createBrandMutation}
        handleSave={handleSave}
        uniqueSeriesByBrand={uniqueSeriesByBrand}
      />
    </div>
  );
}
