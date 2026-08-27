// ═══════════════════════════════════════════════════════════════════════════
// clone_supabase.js — Clonazione dati tra due progetti Supabase (Master→Target)
//
// Uso:
//   node clone_supabase.js <config-sorgente> <config-destinazione> [--dry-run]
//
// Esempio:
//   node clone_supabase.js supabase_config.js supabase_config.target.js --dry-run
//
// I file di configurazione possono essere .js (window.SUPABASE_CONFIG = {...})
// oppure .json. Template: supabase_config.example.js / .example.json.
// Le chiavi restano nei file locali gitignorati: nessun segreto nel repo.
//
// Autenticazione (opzionale, necessaria su progetti con RLS restrittive):
//   ASSET_CLONE_EMAIL / ASSET_CLONE_PASSWORD — il clone gira come utente
//   autenticato (vede solo i propri dati + listini condivisi zonal_pun).
//
// --dry-run: legge e conta le righe del sorgente senza scrivere nulla.
//
// NOTE:
//  - L'ordine delle tabelle rispetta le Foreign Key (parent prima dei figli).
//  - Le scritture usano upsert: ri-eseguire non duplica i record.
//  - La struttura (tabelle/RLS) deve già esistere sul Target (eseguire prima
//    master_init_schema.sql + le migrazioni necessarie).
// ═══════════════════════════════════════════════════════════════════════════
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function usage() {
    console.error('Uso: node clone_supabase.js <config-sorgente> <config-destinazione> [--dry-run]');
    console.error('Esempio: node clone_supabase.js supabase_config.js supabase_config.target.js --dry-run');
    process.exit(1);
}

function parseConfig(filePath) {
    if (!fs.existsSync(filePath)) {
        console.error(`ERRORE: file di configurazione non trovato: ${filePath}`);
        usage();
    }
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const urlMatch = content.match(/"SUPABASE_URL"\s*:\s*"([^"]+)"/);
        const keyMatch = content.match(/"SUPABASE_ANON_KEY"\s*:\s*"([^"]+)"/);

        if (urlMatch && keyMatch) {
            // Pulizia URL da rest/v1 per evitare errori con il client ufficiale
            const url = urlMatch[1].replace('/rest/v1/', '').replace(/\/$/, '');
            return { url, key: keyMatch[1] };
        }
    } catch (e) {
        console.error(`Errore nella lettura di ${filePath}:`, e.message);
    }
    console.error(`ERRORE: SUPABASE_URL / SUPABASE_ANON_KEY non trovati in ${filePath}`);
    usage();
}

const args = process.argv.slice(2);
if (args.length < 2) usage();
const dryRun = args.includes('--dry-run');
const positional = args.filter(a => !a.startsWith('--'));
const sourcePath = path.resolve(positional[0]);
const targetPath = path.resolve(positional[1]);
if (sourcePath === targetPath && !dryRun) {
    console.error('ERRORE: sorgente e destinazione coincidono (consentito solo con --dry-run).');
    process.exit(1);
}

const source = parseConfig(sourcePath);
const target = dryRun ? source : parseConfig(targetPath);

const sourceClient = createClient(source.url, source.key);
const targetClient = dryRun ? null : createClient(target.url, target.key);

// Su progetti con RLS restrittive la anon key non legge nulla: se sono fornite
// credenziali via env, il clone avviene come utente autenticato (legge/scrive
// solo le righe di proprietà dell'utente + listini zonal_pun condivisi).
async function maybeAuth(client, label) {
    const email = process.env.ASSET_CLONE_EMAIL;
    const password = process.env.ASSET_CLONE_PASSWORD;
    if (!email || !password) return;
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
        console.error(`[ERRORE] Login fallito (${label}):`, error.message);
        process.exit(1);
    }
    console.log(`> Autenticato come ${email} (${label})`);
}

// L'ordine corretto è fondamentale per evitare errori di vincolo Foreign Key
const TABLES = [
    'simulation_config',
    'zonal_pun',
    'plants',             // Parent table
    'plant_generation',   // Dipende da plants
    'hourly_telemetry',   // Dipende da plants (PK composita con user_id)
    'stabilimenti',       // Parent table
    'stabilimento_load'   // Dipende da stabilimenti
];

async function cloneTable(tableName) {
    console.log(`\n--- ${dryRun ? 'Lettura' : 'Clonazione'} tabella: ${tableName} ---`);
    let allData = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    // FASE 1: Lettura totale dal DB sorgente
    process.stdout.write(`Lettura`);
    while (hasMore) {
        const { data, error } = await sourceClient
            .from(tableName)
            .select('*')
            .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
            console.error(`\n[ERRORE] Lettura ${tableName}:`, error.message);
            return false;
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
    if (dryRun || allData.length === 0) return true;

    // FASE 2: Inserimento chunkato nel DB destinazione
    console.log('Scrittura in corso...');
    const chunkSize = 250; // Chunk conservativo per limiti payload API
    let inserted = 0;

    for (let i = 0; i < allData.length; i += chunkSize) {
        const chunk = allData.slice(i, i + chunkSize);

        // Upsert per sovrascrivere in caso di ri-esecuzioni senza duplicare
        const { error } = await targetClient.from(tableName).upsert(chunk);

        if (error) {
            console.error(`\n[ERRORE] Inserimento ${tableName}:`, error.message);
            return false;
        }
        inserted += chunk.length;
        process.stdout.write(`...${inserted}`);
    }
    console.log(`\n> Clonazione ${tableName} completata!`);
    return true;
}

async function run() {
    console.log('=========================================');
    console.log('  SUPABASE CLONE TOOL (REST API MODE)    ');
    console.log('=========================================');
    console.log('-> SORGENTE:', source.url);
    console.log('-> DESTINAZIONE:', dryRun ? '(dry-run: nessuna scrittura)' : target.url);

    await maybeAuth(sourceClient, 'sorgente');
    if (!dryRun) await maybeAuth(targetClient, 'destinazione');

    let failures = 0;
    for (const table of TABLES) {
        const ok = await cloneTable(table);
        if (!ok) failures++;
    }

    if (dryRun) {
        console.log('\n====== DRY RUN COMPLETATO (nessuna scrittura) ======');
    } else {
        console.log('\n====== TRASFERIMENTO COMPLETATO ======');
        console.log("Ricordati: l'API copia solo i Dati. Le tabelle (struttura) dovevano");
        console.log('essere già presenti nel nuovo database eseguendo gli script SQL.');
    }
    if (failures > 0) process.exit(1);
}

run();
