import React from 'react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { filterRowsColsForTab } from '@/lib/order-grid-utils';
import type { GridCellVariant } from '@/types/order-grid';

interface PreviewTableProps {
  rowValues: string[];
  colValues: string[];
  cells: Map<string, GridCellVariant[]>;
  tabValue: string;
  rowLabel: string;
  colLabel: string;
}

function PreviewTable({
  rowValues,
  colValues,
  cells,
  tabValue,
  rowLabel,
  colLabel,
}: PreviewTableProps) {
  return (
    <ScrollArea className="h-full">
      <div className="min-w-[300px]">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-background border-b border-r px-2 py-1.5 font-medium text-muted-foreground text-left">
                {rowLabel} \ {colLabel}
              </th>
              {colValues.map((cv) => (
                <th
                  key={cv}
                  className="border-b border-r px-2 py-1.5 font-medium text-muted-foreground text-center"
                >
                  {cv}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowValues.map((rv) => (
              <tr key={rv}>
                <td className="sticky left-0 z-10 bg-background border-b border-r px-2 py-1.5 font-medium text-muted-foreground">
                  {rv}
                </td>
                {colValues.map((cv) => {
                  const key = `${tabValue}|${rv}|${cv}`;
                  const cellItems = cells.get(key) || [];
                  return (
                    <td
                      key={cv}
                      className="border-b border-r px-2 py-1 text-center"
                    >
                      {cellItems.length > 0 ? (
                        <div className="flex items-center justify-center h-6">
                          <span className="text-xs text-muted-foreground">
                            ✓ {cellItems.length}
                          </span>
                        </div>
                      ) : (
                        <span className="text-red-400/60 text-base leading-none">✕</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

interface GridPreviewSidebarProps {
  open: boolean;
  onClose: () => void;
  grid: {
    rowValues: string[];
    colValues: string[];
    tabValues: string[];
    cells: Map<string, GridCellVariant[]>;
  } | null;
  rowLabel: string;
  colLabel: string;
}

export function GridPreviewSidebar({
  open,
  onClose,
  grid,
  rowLabel,
  colLabel,
}: GridPreviewSidebarProps) {
  if (!open) return null;

  return (
    <div className="w-[420px] shrink-0 border-l bg-background flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <h4 className="text-sm font-medium">Grid 預覽</h4>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 min-h-0 p-4 overflow-hidden">
        {!grid || grid.rowValues.length === 0 || grid.colValues.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground border border-dashed rounded-lg">
            選擇產品變體並設定維度後可預覽
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden flex flex-col h-full">
            <div className="bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground border-b shrink-0">
              {grid.rowValues.length} rows × {grid.colValues.length} cols
              {grid.tabValues.length > 1 && grid.tabValues[0] !== '__all__' && (
                <> × {grid.tabValues.length} tabs</>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {grid.tabValues.length <= 1 || grid.tabValues[0] === '__all__' ? (
                <PreviewTable
                  rowValues={grid.rowValues}
                  colValues={grid.colValues}
                  cells={grid.cells}
                  tabValue="__all__"
                  rowLabel={rowLabel}
                  colLabel={colLabel}
                />
              ) : (
                <Tabs defaultValue={grid.tabValues[0]} className="h-full flex flex-col">
                  <TabsList className="shrink-0 mx-3 mt-2">
                    {grid.tabValues.map((tv) => (
                      <TabsTrigger key={tv} value={tv} className="text-xs">
                        {tv}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  <div className="flex-1 min-h-0 mt-2 px-3 pb-3">
                    {grid.tabValues.map((tv) => {
                      const { rowValues: tabRows, colValues: tabCols } = filterRowsColsForTab(
                        grid.rowValues,
                        grid.colValues,
                        grid.cells,
                        tv
                      );
                      if (tabRows.length === 0 || tabCols.length === 0) return null;
                      return (
                        <TabsContent key={tv} value={tv} className="h-full mt-0">
                          <PreviewTable
                            rowValues={tabRows}
                            colValues={tabCols}
                            cells={grid.cells}
                            tabValue={tv}
                            rowLabel={rowLabel}
                            colLabel={colLabel}
                          />
                        </TabsContent>
                      );
                    })}
                  </div>
                </Tabs>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
