import React from 'react';
import { Database, Check, Link as LinkIcon } from 'lucide-react';
import { getStaticSpecTree } from '@/utils/specLogic';

interface CategorySpecLibraryTabProps {
    specDefinitions: any[];
    engine: {
        isSelected: (id: string) => boolean;
        isManual: (id: string) => boolean;
        toggle: (id: string) => void;
    };
}

export const CategorySpecLibraryTab = ({ specDefinitions, engine }: CategorySpecLibraryTabProps) => {
    return (
        <div className="flex flex-col gap-1 p-4 max-h-[400px] overflow-y-auto bg-slate-50/30">
            {getStaticSpecTree(specDefinitions).map(({ spec, level, id }) => {
                const isSelected = engine.isSelected(spec.id);
                const isManual = engine.isManual(spec.id);
                const isRoot = level === 0;

                return (
                    <div
                        key={id} // 使用路徑 ID 解決多次引用衝突
                        onClick={() => isRoot && engine.toggle(spec.id)}
                        style={{ marginLeft: `${level * 20}px` }}
                        className={`
                            flex items-center justify-between p-3 rounded-lg border transition-all
                            ${isSelected
                                ? (isManual ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-100' : 'bg-slate-100 border-slate-200 opacity-80')
                                : 'bg-white hover:border-slate-300 hover:shadow-sm'
                            }
                            ${isRoot ? 'cursor-pointer' : 'cursor-default opacity-70'}
                        `}
                    >
                        <div className="flex items-center gap-3">
                            {level > 0 && <LinkIcon className="h-3 w-3 text-slate-300" />}
                            <div className="flex flex-col">
                                <span className={`text-sm font-medium ${isSelected && isManual ? 'text-blue-700' : 'text-slate-700'}`}>
                                    {spec.name}
                                </span>
                                <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                                    {spec.type}
                                    {!isRoot && ' (連動)'}
                                </span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {isSelected && (
                                isManual ? <Check className="h-4 w-4 text-blue-600" /> : <LinkIcon className="h-3 w-3 text-slate-400 animate-pulse" />
                            )}
                        </div>
                    </div>
                );
            })}
            {specDefinitions.length === 0 && (
                <div className="p-12 text-center text-muted-foreground italic">
                    尚未建立任何規格定義
                </div>
            )}
        </div>
    );
};
