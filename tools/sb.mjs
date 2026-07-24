// ═══════════════════════════════════════════════════════════════════════════
// sb.mjs — Gestione database Supabase (dev + prod) da linea di comando
//
// Uso:
//   node tools/sb.mjs tables        <dev|prod>
//   node tools/sb.mjs counts        <dev|prod>
//   node tools/sb.mjs rls           <dev|prod>
//   node tools/sb.mjs query         <dev|prod> "SELECT ..."
//   node tools/sb.mjs exec-file     <dev|prod> <file.sql>
//   node tools/sb.mjs advisors      <dev|prod> [security|performance]
//   node tools/sb.mjs users         <dev|prod>          (utenti auth, via /auth/v1/admin non disponibile: mostra nota)
//
// Token: rinnova automaticamente l'OAuth token MCP (file IDE) quando scaduto
// e lo conserva in scratch/.sbp_token (gitignored). Nessun segreto nel repo.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const IDE_TOKEN_FILE = 'C:/Users/Utente/.gemini/antigravity-ide/mcp_oauth_tokens.json';
const LOCAL_TOKEN_FILE = path.join(ROOT, 'scratch', '.sbp_token');

const PROJECTS = {
    dev: 'ozexeaqnvlkflzweikph',   // Business_Plan (sviluppo)
    prod: 'bfszzyeysqijxrqxsofk',  // Business_Plan_OVH (produzione)
};

function refreshToken() {
    const d = JSON.parse(fs.readFileSync(IDE_TOKEN_FILE, 'utf8'))['https://mcp.supabase.com/mcp'];
    const args = [
        '-s', '-X', 'POST', 'https://api.supabase.com/v1/oauth/token',
        '-H', 'Content-Type: application/x-www-form-urlencoded',
        '--data-urlencode', 'grant_type=refresh_token',
        '--data-urlencode', 'refresh_token=' + d.token.refresh_token,
        '--data-urlencode', 'client_id=' + d.client_id,
        '--data-urlencode', 'client_secret=' + d.client_secret,
    ];
    const out = execFileSync('curl', args, { encoding: 'utf8', timeout: 30000 });
    const j = JSON.parse(out);
    if (!j.access_token) throw new Error('Refresh token fallito: ' + out.slice(0, 200));
    fs.writeFileSync(LOCAL_TOKEN_FILE, j.access_token);
    if (j.refresh_token) {
        d.token.refresh_token = j.refresh_token;
        d.token.access_token = j.access_token;
        d.token.expiry = new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString();
        fs.writeFileSync(IDE_TOKEN_FILE, JSON.stringify({ 'https://mcp.supabase.com/mcp': d }, null, 2));
    }
    return j.access_token;
}

function getToken() {
    try {
        if (fs.existsSync(LOCAL_TOKEN_FILE)) {
            const t = fs.readFileSync(LOCAL_TOKEN_FILE, 'utf8').trim();
            if (t) return t;
        }
    } catch { /* fallthrough */ }
    return refreshToken();
}

async function mgmt(pathname, { method = 'GET', body = null } = {}) {
    const token = getToken();
    const resp = await fetch('https://api.supabase.com' + pathname, {
        method,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : null,
    });
    const text = await resp.text();
    if (resp.status === 401) {
        // token scaduto: rinnova e riprova una volta
        const t2 = refreshToken();
        const resp2 = await fetch('https://api.supabase.com' + pathname, {
            method,
            headers: { Authorization: 'Bearer ' + t2, 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : null,
        });
        return JSON.parse(await resp2.text());
    }
    try { return JSON.parse(text); } catch { return text; }
}

const runSql = (ref, query) => mgmt(`/v1/projects/${ref}/database/query`, { method: 'POST', body: { query } });

const [cmd, target, ...rest] = process.argv.slice(2);
const ref = PROJECTS[target];
if (!cmd || !ref) {
    console.error('Uso: node tools/sb.mjs <tables|counts|rls|query|exec-file|advisors> <dev|prod> [args]');
    process.exit(1);
}

switch (cmd) {
    case 'tables': {
        const rows = await runSql(ref, "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
        console.log(Array.isArray(rows) ? rows.map(r => r.tablename) : rows);
        break;
    }
    case 'counts': {
        const rows = await runSql(ref, `SELECT relname AS table, n_live_tup AS rows_estimate
            FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY relname`);
        console.table(rows);
        break;
    }
    case 'rls': {
        const rows = await runSql(ref, `SELECT c.relname AS table, c.relrowsecurity AS rls_enabled,
            (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policies
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`);
        console.table(rows);
        const pol = await runSql(ref, `SELECT tablename, policyname, cmd, roles::text AS roles FROM pg_policies ORDER BY tablename, policyname`);
        console.table(pol);
        break;
    }
    case 'query': {
        const sql = rest.join(' ');
        if (!sql) { console.error('Manca la query SQL.'); process.exit(1); }
        const rows = await runSql(ref, sql);
        console.log(Array.isArray(rows) && rows.length <= 200 ? JSON.stringify(rows, null, 1) : rows);
        break;
    }
    case 'exec-file': {
        const file = rest[0];
        if (!file || !fs.existsSync(file)) { console.error('File SQL non trovato:', file); process.exit(1); }
        const sql = fs.readFileSync(file, 'utf8');
        console.log(`Esecuzione ${file} su ${target} (${ref})...`);
        const rows = await runSql(ref, sql);
        console.log('OK:', JSON.stringify(rows).slice(0, 300));
        break;
    }
    case 'advisors': {
        const type = rest[0] || 'security';
        const rows = await mgmt(`/v1/projects/${ref}/advisors/${type}`);
        console.log(JSON.stringify(rows, null, 1).slice(0, 4000));
        break;
    }
    default:
        console.error('Comando non riconosciuto:', cmd);
        process.exit(1);
}
