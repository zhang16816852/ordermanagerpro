import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { tableName, clientVersion } = await req.json()

    if (!tableName) {
      return new Response(
        JSON.stringify({ error: 'tableName is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Checking version for table: ${tableName}, client version: ${clientVersion}`)

    // Get current server version
    const { data: versionData, error: versionError } = await supabase
      .from('data_versions')
      .select('version')
      .eq('table_name', tableName)
      .maybeSingle()

    if (versionError) {
      console.error('Error fetching version:', versionError)
      throw versionError
    }

    const serverVersion = versionData?.version || 0

    // If client version matches server version, no update needed
    if (clientVersion !== null && clientVersion !== undefined && clientVersion === serverVersion) {
      console.log(`Version match (${serverVersion}), no data transfer needed`)
      return new Response(
        JSON.stringify({ 
          needsUpdate: false, 
          version: serverVersion,
          data: null 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Version mismatch, fetch and return data
    console.log(`Version mismatch (client: ${clientVersion}, server: ${serverVersion}), fetching data`)

    let data = null

    if (tableName === 'products') {
      const { data: products, error: productsError } = await supabase
        .from('products')
        .select('*')
        .order('name')

      if (productsError) {
        console.error('Error fetching products:', productsError)
        throw productsError
      }

      data = products
    } else {
      return new Response(
        JSON.stringify({ error: `Unsupported table: ${tableName}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Returning ${data?.length || 0} records with version ${serverVersion}`)

    return new Response(
      JSON.stringify({ 
        needsUpdate: true, 
        version: serverVersion,
        data 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Error in check-data-version:', error)
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
