import { SpecDefinition } from '../../types';
import { SpecRelationInfo } from '../../hooks/useSpecRelations';
import { SpecLibraryCard } from './SpecLibraryCard';

interface GridViewProps {
    specs: SpecDefinition[];
    relations: Map<string, SpecRelationInfo>;
    onEdit: (spec: SpecDefinition) => void;
    onDelete: (spec: SpecDefinition) => void;
}

export function SpecLibraryGridView({ specs, relations, onEdit, onDelete }: GridViewProps) {
    if (specs.length === 0) {
        return <div className="py-20 text-center animate-pulse text-muted-foreground">還沒有建立任何規格定義，請點擊右上方新增。</div>;
    }

    return (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 animate-in fade-in duration-300">
            {specs.map(spec => (
                <SpecLibraryCard 
                    key={spec.id}
                    spec={spec}
                    relation={relations.get(spec.id)}
                    onEdit={onEdit}
                    onDelete={onDelete}
                />
            ))}
        </div>
    );
}
