import { useState } from 'react';
import { useDeviceModels } from '../../products/hooks/useDeviceModels';
import { FullDeviceModel as DeviceModel } from '@/types/device-models';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Import split components
import { DeviceModelActions } from './DeviceModelActions';
import { DeviceModelListView } from './DeviceModelListView';
import { DeviceModelGroupView } from './DeviceModelGroupView';
import { DeviceModelDialog } from './DeviceModelDialog';
import { DeviceModelGroupManager } from './DeviceModelGroupManager';

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
      release_date: editingData.release_date || null,
      aliases: editingData.aliases || null
    };
    console.log("發送", payload)
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
    console.log("openEdit", model)
    if (model) {
      setEditingData(model);
    } else {
      setEditingData({ name: '', sort_order: 0, is_active: true, brand_id: null, device_type: '', screen_size: '', device_series: '', device_remarks: '', release_date: '' });
    }
    setIsDialogOpen(true);
  };

  const handleExport = () => {
    const exportData = models.map(m => ({
      '型號ID': m.id,
      '型號名稱': m.name || '',
      '別名': (m.aliases || []).join(', '),
      '廠牌': m.brand_id ? deviceBrands.find((b: any) => b.id === m.brand_id)?.name || '' : '',
      '系列': m.device_series || '',
      '設備類型': m.device_type || '',
      '螢幕尺寸': m.screen_size || '',
      '出廠年月': m.release_date || '',
      '備註': m.device_remarks || '',
      '排序': m.sort_order || 0,
      '啟用': m.is_active !== false ? '是' : '否'
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    // 隱藏第一欄 (型號ID)
    worksheet['!cols'] = [{ hidden: true }];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '型號標籤庫');

    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '型號標籤庫.xlsx';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const result = event.target?.result as ArrayBuffer;
        const workbook = XLSX.read(result, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet) as any[];

        if (rows.length === 0) {
          toast.error('檔案內無資料');
          setIsImporting(false);
          e.target.value = '';
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

        // 2. 整理模型準備，按 UUID 判斷為更新或插入
        const modelsToInsert = rows.map(r => {
          const name = String(r['型號名稱'] || r['name'] || '').trim();
          if (!name) return null;
          const bName = String(r['廠牌'] || r['brand'] || '').trim().toLowerCase();
          const modelId = r['型號ID'] || r['id']; // 直接取，不做預設查詢
          
          const aliasesStr = String(r['別名'] || r['aliases'] || '');
          const aliases = aliasesStr.split(',').map((a: string) => a.trim()).filter(Boolean);

          return {
            ...(modelId ? { id: modelId } : {}), // 只有當有明確的 UUID 時才包含 id
            name,
            aliases: aliases.length > 0 ? aliases : null,
            brand_id: bName ? brandMap.get(bName) || null : null,
            device_type: String(r['設備類型'] || r['device_type'] || '').trim() || null,
            device_series: String(r['系列'] || r['device_series'] || '').trim() || null,
            screen_size: String(r['螢幕尺寸'] || r['screen_size'] || '').trim() || null,
            release_date: String(r['出廠年月'] || r['release_date'] || '').trim() || null,
            device_remarks: String(r['備註'] || r['device_remarks'] || '').trim() || null,
            sort_order: parseInt(r['排序'] || r['sort_order'] || '0', 10) || 0,
            is_active: r['啟用'] !== '否'
          };
        }).filter(Boolean);

        // 二次驗證：無 UUID 的記錄檢查是否已存在相同名稱
        const modelsWithoutId = modelsToInsert.filter(m => !m.id);
        const duplicateNames = modelsWithoutId
          .map(m => m.name)
          .filter((name, index, self) => self.indexOf(name) !== index);

        if (duplicateNames.length > 0) {
          throw new Error(`匯入檔案中有重複的型號名稱（無 UUID）：${duplicateNames.join(', ')}`);
        }
        
        const changedRecordsToUpdate = modelsToInsert.filter((m: any) => m.id);
        const recordsToInsert = modelsToInsert.filter((m: any) => !m.id);

        if (changedRecordsToUpdate.length > 0) {
          const batchSize = 50;
          for (let i = 0; i < changedRecordsToUpdate.length; i += batchSize) {
            const batch = changedRecordsToUpdate.slice(i, i + batchSize);
            const { error: updateError } = await supabase.from('device_models').upsert(batch);
            if (updateError) {
              console.error('批量更新失敗', updateError);
              throw updateError;
            }
          }
        }

        if (recordsToInsert.length > 0) {
          const batchSize = 50;
          for (let i = 0; i < recordsToInsert.length; i += batchSize) {
            const batch = recordsToInsert.slice(i, i + batchSize).map((record: any) => {
              const { id, ...rest } = record;
              return rest;
            });
            const { error: insertError } = await supabase.from('device_models').insert(batch);
            if (insertError) {
              console.error(`批量新增失敗，範圍 ${i} - ${i + batchSize - 1}`, insertError);
              throw insertError;
            }
          }
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
    };
    
    reader.onerror = (error) => {
      toast.error('檔案讀取失敗');
      setIsImporting(false);
      e.target.value = '';
    };

    reader.readAsArrayBuffer(file);
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
        <TabsList className="grid w-full grid-cols-3 max-w-[500px]">
          <TabsTrigger value="list">詳細清單</TabsTrigger>
          <TabsTrigger value="group">依品牌檢視</TabsTrigger>
          <TabsTrigger value="model-group">型號群組 (快捷鍵)</TabsTrigger>
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

        <TabsContent value="model-group" className="mt-4">
          <DeviceModelGroupManager />
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
