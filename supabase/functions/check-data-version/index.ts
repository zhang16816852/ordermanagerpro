import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { tableName, clientVersion } = await req.json()

    if (!tableName) {
      return new Response(JSON.stringify({ error: 'tableName is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 取得伺服器端版本號與觸發來源
    const { data: versionData, error: versionError } = await supabase
      .from('data_versions')
      .select('version, updated_at, last_triggered_by')
      .eq('table_name', tableName)
      .maybeSingle()

    if (versionError) throw versionError

    const serverVersion = versionData?.version || 0
    const lastTriggeredBy = versionData?.last_triggered_by || 'unknown'
    const updatedAt = versionData?.updated_at

    console.log(`[VersionCheck] 正在檢查 ${tableName}: 客戶端 v${clientVersion} vs 伺服器 v${serverVersion} (最後更新由: ${lastTriggeredBy})`)

    // 版本一致
    if (clientVersion !== null && clientVersion !== undefined && clientVersion === serverVersion) {
      return new Response(
        JSON.stringify({
          needsUpdate: false,
          version: serverVersion,
          updatedAt,
          lastTriggeredBy,
          data: null
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 版本不一致，抓取最新資料
    console.log(`[VersionCheck] ⚠️ 版本不符！${tableName} 需要更新。來源表: ${lastTriggeredBy}, 更新時間: ${updatedAt}`)

    let data = null

    if (tableName === 'products') {
      const { data: products, error: productsError } = await supabase
        .from('products')
        .select(`
          *,
          product_category_links(category_id, categories(name))
        `)
        .order('name')

      if (productsError) throw productsError
      data = products

    } else if (tableName === 'specs') {
      const [
        { data: definitions },
        { data: triggers },
        { data: catLinks }
      ] = await Promise.all([
        supabase.from('specification_definitions').select('*').order('sort_order', { ascending: true }).order('name'),
        supabase.from('specification_triggers').select('*').order('priority', { ascending: false }),
        supabase.from('category_spec_links').select('*')
      ])

      data = {
        definitions: definitions || [],
        triggers: triggers || [],
        categoryLinks: catLinks || []
      }
    }

    return new Response(
      JSON.stringify({
        needsUpdate: true,
        version: serverVersion,
        updatedAt,
        lastTriggeredBy,
        data
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('[VersionCheck] 🔥 發生錯誤:', error)
    return new Response(JSON.stringify({ error: errorMessage }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
