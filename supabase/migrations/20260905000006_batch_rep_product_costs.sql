-- 業務進貨成本批次寫入 RPC（統一批次送出：upsert + delete 單一交易內完成）
-- 前端「全部儲存」一次送出所有變更，取代原本逐筆 upsert / delete。

CREATE OR REPLACE FUNCTION public.upsert_rep_product_costs(
  p_rep_id uuid,
  p_items jsonb -- array of {product_id, variant_id, cost}；cost 為 null 表示刪除該成本
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_item jsonb;
  v_cost_val numeric;
  v_upserted int := 0;
  v_deleted int := 0;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception '僅限管理員操作';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('upserted', 0, 'deleted', 0);
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if (v_item->>'product_id') is null then
      continue;
    end if;

    -- 無 cost 欄位或 json null → 刪除該成本列
    if (v_item->'cost') is null or (v_item->'cost') = 'null'::jsonb then
      delete from public.rep_product_costs
      where rep_id = p_rep_id
        and product_id = (v_item->>'product_id')::uuid
        and variant_id is not distinct from nullif(v_item->>'variant_id', '')::uuid;
      v_deleted := v_deleted + 1;
    else
      v_cost_val := (v_item->>'cost')::numeric;
      if v_cost_val < 0 then
        raise exception '成本不可為負數';
      end if;

      if nullif(v_item->>'variant_id', '') is null then
        -- 產品層級（variant_id null）：先刪除既有 NULL 列再 insert，
        -- 避免 UNIQUE 對 NULL 不生效導致重複列累積
        delete from public.rep_product_costs
        where rep_id = p_rep_id
          and product_id = (v_item->>'product_id')::uuid
          and variant_id is null;
        insert into public.rep_product_costs (rep_id, product_id, variant_id, cost)
        values (p_rep_id, (v_item->>'product_id')::uuid, null, v_cost_val);
      else
        insert into public.rep_product_costs (rep_id, product_id, variant_id, cost)
        values (
          p_rep_id,
          (v_item->>'product_id')::uuid,
          (v_item->>'variant_id')::uuid,
          v_cost_val
        )
        on conflict (rep_id, product_id, variant_id)
        do update set cost = excluded.cost;
      end if;
      v_upserted := v_upserted + 1;
    end if;
  end loop;

  return jsonb_build_object('upserted', v_upserted, 'deleted', v_deleted);
end;
$$;

REVOKE ALL ON FUNCTION public.upsert_rep_product_costs(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_rep_product_costs(uuid, jsonb) TO authenticated;