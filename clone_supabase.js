const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// 1. Lettura dei file di configurazione
function parseConfig(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const urlMatch = content.match(/"SUPABASE_URL":\s*"([^"]+)"/);
        const keyMatch = content.match(/"SUPABASE_ANON_KEY":\s*"([^"]+)"/);
        
        if (urlMatch && keyMatch) {
            // Pulizia URL da rest/v1 per evitare errori con il client ufficiale
            let url = urlMatch[1].replace('/rest/v1/', '').replace(/\/$/, '');
            return { url, key: keyMatch[1] };
        }
    } catch (e) {
        console.error(`Errore nella lettura di ${filePath}:`, e);
    }
    return null;
}

const oldConfig = parseConfig(path.join(__dirname, 'supabase_config.js'));
const newConfig = parseConfig(path.join(__dirname, 'supabase_config copy.js'));

if (!oldConfig || !newConfig) {
    console.error("ERRORE: Impossibile leggere i file di configurazione.");
    process.exit(1);
}

console.log("-> SORGENTE:", oldConfig.url);
console.log("-> DESTINAZIONE:", newConfig.url);

const oldClient = createClient(oldConfig.url, oldConfig.key);
const newClient = createClient(newConfig.url, newConfig.key);

// L'ordine corretto è fondamentale per evitare errori di vincolo Foreign Key
const TABLES = [
    'simulation_config',
    'zonal_pun',
    'plants',             // Parent table
    'plant_generation',   // Dipende da plants
    'hourly_telemetry',   // Dipende da plants
    'stabilimenti',       // Parent table
    'stabilimento_load'   // Dipende da stabilimenti
];

async function cloneTable(tableName) {
    console.log(`\n--- Clonazione tabella: ${tableName} ---`);
    let allData = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    // FASE 1: Lettura totale dal Vecchio DB
    process.stdout.write(`Lettura`);
    while (hasMore) {
        const { data, error } = await oldClient
            .from(tableName)
            .select('*')
            .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
            console.error(`\n[ERRORE] Lettura ${tableName}:`, error.message);
            return;
        }

        if (data && data.length > 0) {
            allData = allData.concat(data);
            process.stdout.write(`...${allData.length}`);
            if (data.length < pageSize) {
                hasMore = false;
            } else {
                page++;
            }
        } else {
            hasMore = false;
        }
    }
    
    console.log(`\n> Trovati ${allData.length} record.`);
    if (allData.length === 0) return;

    // FASE 2: Inserimento Chunkato nel Nuovo DB
    console.log(`Scrittura in corso...`);
    const chunkSize = 250; // Chunk conservativo per limiti payload API
    let inserted = 0;
    
    for (let i = 0; i < allData.length; i += chunkSize) {
        const chunk = allData.slice(i, i + chunkSize);
        
        // Usiamo upsert per sovrascrivere in caso di ri-esecuzioni senza duplicare
        const { error } = await newClient.from(tableName).upsert(chunk);
        
        if (error) {
            console.error(`\n[ERRORE] Inserimento in ${tableName}:`, error.message);
        } else {
            inserted += chunk.length;
            process.stdout.write(`...${inserted}`);
        }
    }
    console.log(`\n> Clonazione ${tableName} completata!`);
}

async function run() {
    console.log("=========================================");
    console.log("  SUPABASE CLONE TOOL (REST API MODE)    ");
    console.log("=========================================\n");
    
    for (const table of TABLES) {
        await cloneTable(table);
    }
    
    console.log("\n====== TRASFERIMENTO COMPLETATO ======");
    console.log("Ricordati: l'API copia solo i Dati. Le tabelle (struttura) dovevano");
    console.log("essere già presenti nel nuovo database eseguendo gli script SQL.");
}

run();
