import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type TableName = keyof Database['public']['Tables'] & string;
export type TableRow<T extends TableName> = Database['public']['Tables'][T]['Row'];
export type TableInsert<T extends TableName> = Database['public']['Tables'][T]['Insert'];
export type TableUpdate<T extends TableName> = Database['public']['Tables'][T]['Update'];

export type ViewName = keyof Database['public']['Views'] & string;
export type ViewRow<T extends ViewName> = Database['public']['Views'][T]['Row'];

export type EnumName = keyof Database['public']['Enums'] & string;
export type EnumValues<T extends EnumName> = Database['public']['Enums'][T];

export function getTableName<T extends TableName>(name: T): T {
  return name;
}

export function asTableRow<T extends TableName>(data: unknown, _table: T): TableRow<T> {
  return data as TableRow<T>;
}

export function asTableRowArray<T extends TableName>(data: unknown, _table: T): TableRow<T>[] {
  return (data || []) as TableRow<T>[];
}
