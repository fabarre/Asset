const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const configStr = fs.readFileSync('./supabase_config.json', 'utf-8');
const config = JSON.parse(configStr);

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

async function run() {
    const { data, error } = await supabase.from('simulation_config').select('*');
    if (error) {
        console.error("Error:", error);
    } else {
        console.log("Config entries:", data.length);
        console.log(data);
    }
}
run();
