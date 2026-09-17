import React from 'react';
import { BooleanEditor } from './specValue/BooleanEditor';
import { NumberWithUnitEditor } from './specValue/NumberWithUnitEditor';
import { DefaultEditor } from './specValue/DefaultEditor';
import { TableSpecEditor } from './specValue/TableSpecEditor';
import { SelectSpecEditor } from './specValue/SelectSpecEditor';
import { MultiSelectEditor } from './specValue/MultiSelectEditor';
import { QuantityAllocationEditor } from './specValue/QuantityAllocationEditor';
import type { SpecValueEditorProps } from './specValue/types';

/**
 * v4.7 物件化編輯器註冊表 (Registry)
 * 每個屬性對應一個特定 spec.type 的渲染組件
 */
const SpecRenderers: Record<string, React.FC<SpecValueEditorProps>> = {
    boolean: (props) => <BooleanEditor {...props} />,
    number_with_unit: (props) => <NumberWithUnitEditor {...props} />,
    multiselect: (props) => <MultiSelectEditor {...props} />,
    select: (props) => <SelectSpecEditor {...props} />,
    default: (props) => <DefaultEditor {...props} />,
    table: (props) => <TableSpecEditor {...props} />,
};

/**
 * 主組件：SpecValueEditor
 */
export function SpecValueEditor(props: SpecValueEditorProps) {
    const { spec, sourceValue, isQuantityDetail } = props;

    // 優先檢查是否為數量明細 (觸發總量連動)
    // v4.8 優化：只有在明確標記為數量明細，或者當前 sourceValue 是有效數字且有選項時才觸發
    const numericSource = parseInt(String(sourceValue));
    const isActuallyQuantity = isQuantityDetail || (!isNaN(numericSource) && numericSource > 0);

    if (isActuallyQuantity && spec.options?.length > 0) {
        return <QuantityAllocationEditor {...props} />;
    }

    // 根據型別查找渲染器
    let type = spec.type;
    // 如果有選項且非特殊型別，預設導向 select
    if (spec.options?.length > 0 && 
        !['multiselect', 'number_with_unit', 'boolean', 'text', 'default', 'table'].includes(type)) {
        type = 'select';
    }

    const Renderer = SpecRenderers[type] || SpecRenderers.default;
    return <Renderer {...props} />;
}