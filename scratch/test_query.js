const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = "https://aweqytcelujpqezjitsk.supabase.co";
const SUPABASE_KEY = "sb_publishable_e_C3c9P1QHVwAVkfj_osHg_zMHKjCIB";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function test() {
  const { data, error } = await supabase
    .from('device_model_group_links')
    .select('entity_id, group_id, device_model_groups(id, name, device_model_group_items(device_models(id, name)))')
    .eq('entity_id', 'eec0036e-5f79-490c-85cf-97187d8f4b9f');

  if (error) {
    console.error("Error fetching device model group links:", error);
    return;
  }
  console.log("data:", JSON.stringify(data, null, 2));
}

test();
