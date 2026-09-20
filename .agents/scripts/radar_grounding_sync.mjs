#!/usr/bin/env node
/**
 * Radar Grounding Sync (Verification Gate)
 * Valida e sincronizza parametri esterni con la memoria semantica (semantic_grounding.md).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const memoryDir = path.resolve(__dirname, '../memory');
const semanticPath = path.join(memoryDir, 'semantic_grounding.md');

const ALLOWED_DOMAINS = [
    'arera.it',
    'gse.it',
    'mercatoelettrico.org',
    'mase.gov.it',
    'agenziaentrate.gov.it',
    'bancaditalia.it',
    'ecb.europa.eu',
    'euribor-rates.eu',
    'ieee.org',
    'sciencedirect.com',
    'catl.com',
    'byd.com',
    'tesla.com'
];

function parseArgs() {
    const args = process.argv.slice(2);
    const parsed = {};
    for (let i = 0; i < args.length; i += 2) {
        if (args[i].startsWith('--')) {
            const key = args[i].replace(/^--/, '');
            parsed[key] = args[i + 1];
        }
    }
    return parsed;
}

export function validateAndSync({ section, key, value, source, impact }) {
    console.log("\n=======================================================");
    console.log("🔍 RADAR GROUNDING SYNC: VERIFICATION GATE");
    console.log("=======================================================");

    if (!section || !key || !value || !source) {
        console.error("❌ Errore: parametri obbligatori mancanti (--section, --key, --value, --source).");
        return false;
    }

    // Verifica dominio sorgente
    let isDomainValid = false;
    try {
        const url = new URL(source);
        isDomainValid = ALLOWED_DOMAINS.some(d => url.hostname.endsWith(d));
    } catch (e) {
        console.error(`❌ URL sorgente non valido: ${source}`);
        return false;
    }

    if (!isDomainValid) {
        console.error(`❌ GATE REJECTION: Il dominio sorgente '${source}' non è presente nella whitelist delle fonti verificate.`);
        console.error(`Domini ammessi: ${ALLOWED_DOMAINS.join(', ')}`);
        return false;
    }

    console.log(`✓ Fonte verificata: ${source}`);
    console.log(`✓ Parametro: [${section}] ${key} = ${value}`);
    console.log(`✓ Impatto stimato: ${impact || 'N/A'}`);

    if (!fs.existsSync(semanticPath)) {
        console.error("❌ File semantic_grounding.md non trovato.");
        return false;
    }

    const timestamp = new Date().toISOString();
    const entry = `\n<!-- RADAR_UPDATE_${key}_${Date.now()} -->\n- **${key}** (${section}): \`${value}\`\n  - *Fonte Verificata*: [${source}](${source})\n  - *Impatto*: ${impact || 'Aggiornamento standard'}\n  - *Data Rilevazione*: ${timestamp}\n`;

    fs.appendFileSync(semanticPath, entry, 'utf8');
    console.log(`🎉 Parametro sincronizzato con successo in semantic_grounding.md!`);
    return true;
}

// CLI Execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = parseArgs();
    if (Object.keys(args).length === 0) {
        console.log("Uso: node radar_grounding_sync.mjs --section <sec> --key <param> --value <val> --source <url> [--impact <desc>]");
    } else {
        const success = validateAndSync(args);
        process.exit(success ? 0 : 1);
    }
}
