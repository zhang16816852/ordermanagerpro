import { Checkbox } from '@/components/ui/checkbox';
import type { SpecValueEditorProps } from './types';

export function BooleanEditor({ spec, value, onChange }: SpecValueEditorProps) {
    const isTrue = value === 'true' || value === true;
    return (
        <div className="flex items-center space-x-2 h-9 border rounded-md px-3 bg-background group-hover:border-primary/30 transition-colors">
            <Checkbox
                id={`spec-editor-${spec.id}`}
                checked={isTrue}
                onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')}
            />
            <label htmlFor={`spec-editor-${spec.id}`} className="text-sm cursor-pointer select-none flex-1">
                是/否
            </label>
        </div>
    );
}