import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { supabase } from "@/integrations/supabase/client";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export async function fetchAllRows<T = any>(
  table: string,
  select: string,
  options?: {
    eq?: [string, any][];
    order?: { column: string; ascending?: boolean }[];
  }
): Promise<T[]> {
  const pageSize = 1000;
  const all: T[] = [];
  let from = 0;
  const orders = options?.order?.length ? options.order : [{ column: 'id', ascending: true }];

  while (true) {
    let query = supabase.from(table).select(select).range(from, from + pageSize - 1);
    for (const o of orders) {
      query = query.order(o.column, { ascending: o.ascending ?? true });
    }
    if (options?.eq) {
      for (const [col, val] of options.eq) {
        query = query.eq(col, val);
      }
    }
    const { data } = await query;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}
