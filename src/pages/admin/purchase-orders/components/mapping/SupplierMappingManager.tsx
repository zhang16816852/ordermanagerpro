import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSupplierMappings } from '../../hooks/useSupplierMappings';
import { MappingConfigForm } from './MappingConfigForm';
import { MappedRulesList } from './MappedRulesList';
import { UnmappedResolver, UnmappedItem } from './UnmappedResolver';

interface SupplierMappingManagerProps {
  supplierId: string;
  supplierName: string;
  unmappedItems?: UnmappedItem[];
  onAllUnmappedResolved?: () => void;
}

export function SupplierMappingManager({ supplierId, supplierName, unmappedItems, onAllUnmappedResolved }: SupplierMappingManagerProps) {
  const {
    mappings,
    config,
    isLoadingMappings,
    isLoadingConfig,
    saveMappingMutation,
    deleteMappingMutation,
    saveConfigMutation,
  } = useSupplierMappings(supplierId);

  const handleRuleCreated = (vendorProdId: string, vendorProdName: string, internalProdId: string, internalVarId: string | null) => {
    saveMappingMutation.mutate({
      supplier_id: supplierId,
      vendor_product_id: vendorProdId,
      vendor_product_name: vendorProdName,
      internal_product_id: internalProdId,
      internal_variant_id: internalVarId,
    });
  };

  const hasUnmappedItems = unmappedItems && unmappedItems.length > 0;
  const defaultTab = hasUnmappedItems ? 'unmapped' : 'mappings';

  return (
    <div className="space-y-4">
      <Tabs defaultValue="mappings">
        <TabsList className="mb-4">
          <TabsTrigger value="mappings">已對照規則</TabsTrigger>
          {hasUnmappedItems && <TabsTrigger value="unmapped">未對應處理 ({unmappedItems.length})</TabsTrigger>}
          <TabsTrigger value="config">匯入欄位設定</TabsTrigger>
        </TabsList>

        {hasUnmappedItems && (
          <TabsContent value="unmapped">
            <UnmappedResolver
              supplierId={supplierId}
              unmappedItems={unmappedItems}
              onRuleCreated={handleRuleCreated}
              onAllResolved={onAllUnmappedResolved}
            />
          </TabsContent>
        )}

        <TabsContent value="mappings">
          <MappedRulesList
            mappings={mappings}
            onDelete={(id) => deleteMappingMutation.mutate(id)}
            onSave={(data) => saveMappingMutation.mutate(data)}
            isSaving={saveMappingMutation.isPending}
            isLoading={isLoadingMappings}
            supplierId={supplierId}
            supplierName={supplierName}
          />
        </TabsContent>

        <TabsContent value="config">
          <MappingConfigForm
            initialConfig={config}
            onSave={(data) => saveConfigMutation.mutate({ supplier_id: supplierId, ...data })}
            isLoading={saveConfigMutation.isPending || isLoadingConfig}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
