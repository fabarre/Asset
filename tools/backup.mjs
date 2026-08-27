// ═══════════════════════════════════════════════════════════════════════════
// backup.mjs — Backup/restore dati Supabase via Management API
//
// Uso:
//   node tools/backup.mjs run <dev|prod> [--keep N]
//       Esporta tutte le tabelle in scratch/backups/<timestamp>_<target>/
//       (JSONL per tabella + schema/policy snapshot + manifest con sha256).
//       Retention: mantiene gli ultimi N backup (default 10).
//   node tools/backup.mjs list
//       Elenca i backup disponibili.
//   node tools/backup.mjs restore <dir> <dev|prod> [--only tab1,tab2] [--dry-run]
//       Ripristina le tabelle dal backup (DELETE + INSERT a chunk).
//       AVVERTENZA: sovrascrive i dati correnti delle tabelle indicate.
//
// Token: scratch/.sbp_token (gitignored), stesso meccanismo di tools/sb.mjs.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TOKEN_FILE = path.join(ROOT, 'scratch', '.sbp_token');
const BACKUP_ROOT = path.join(ROOT, 'scratch', 'backups');

const PROJECTS = {
    dev: 'ozexeaqnvlkflzweikph',
    prod: 'bfszzyeysqijxrqxsofk'
};

// Ordine di dump/restore compatibile con le Foreign Key
const TABLES = [
    { name: 'simulation_config', pk: ['parameter_key', 'user_id'] },
    { name: 'zonal_pun', pk: ['hour_index'] },
    { name: 'plants', pk: ['id'] },
    { name: 'plant_generation', pk: ['plant_id', 'hour_index'] },
    { name: 'hourly_telemetry', pk: ['hour_index', 'user_id'] },
    { name: 'stabilimenti', pk: ['id'] },
    { name: 'stabilimento_load', pk: ['stabilimento_id', 'hour_index'] }
];

function getToken() {
    const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (!t) throw new Error('Token vuoto in ' + TOKEN_FILE);
    return t;
}

async function mgmt(pathname, { method = 'GET', body = null } = {}) {
    const resp = await fetch('https://api.supabase.com' + pathname, {
        method,
        headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : null
    });
    const text = await resp.text();
    let out;
    try { out = JSON.parse(text); } catch { out = text; }
    if (!resp.ok) {
        const msg = out && out.msg ? out.msg : text.slice(0, 300);
        throw new Error(`Management API ${resp.status}: ${msg}`);
    }
    return out;
}

const runSql = (ref, query) => mgmt(`/v1/projects/${ref}/database/query`, { method: 'POST', body: { query } });

function sha256File(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// ── RUN ────────────────────────────────────────────────────────────────────
async function run(target, keep = 10) {
    const ref = PROJECTS[target];
    if (!ref) throw new Error('Target sconosciuto: ' + target);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = path.join(BACKUP_ROOT, `${ts}_${target}`);
    fs.mkdirSync(dir, { recursive: true });
    const manifest = { created_at: new Date().toISOString(), target, project_ref: ref, tables: {} };

    for (const t of TABLES) {
        const orderCols = t.pk.join(', ');
        const total = await runSql(ref, `SELECT count(*)::int AS n FROM public.${t.name}`);
        const n = total[0].n;
        const file = path.join(dir, t.name + '.jsonl');
        const ws = fs.createWriteStream(file);
        let fetched = 0;
        const PAGE = 10000;
        while (fetched < n) {
            const rows = await runSql(ref,
                `SELECT * FROM public.${t.name} ORDER BY ${orderCols} LIMIT ${PAGE} OFFSET ${fetched}`);
            if (!Array.isArray(rows) || rows.length === 0) break;
            for (const r of rows) ws.write(JSON.stringify(r) + '\n');
            fetched += rows.length;
            process.stdout.write(`  ${t.name}: ${fetched}/${n}\r`);
        }
        ws.end();
        await new Promise((res) => ws.on('finish', res));
        manifest.tables[t.name] = { rows_expected: n, rows_dumped: fetched, sha256: sha256File(file) };
        console.log(`  ${t.name}: ${fetched}/${n} righe`);
    }

    // Snapshot schema/policy (per audit e confronto post-restore)
    const schema = {
        policies: await runSql(ref, `SELECT tablename, policyname, cmd, roles::text AS roles, qual, with_check FROM pg_policies ORDER BY tablename, policyname`),
        columns: await runSql(ref, `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`),
        grants: await runSql(ref, `SELECT grantee, table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs FROM information_schema.role_table_grants WHERE table_schema='public' GROUP BY grantee, table_name ORDER BY table_name, grantee`),
        routines: await runSql(ref, `SELECT routine_name, routine_definition FROM information_schema.routines WHERE routine_schema='public'`)
    };
    fs.writeFileSync(path.join(dir, 'schema_snapshot.json'), JSON.stringify(schema, null, 2));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log('Backup completato in', dir);

    // Retention
    const dirs = fs.readdirSync(BACKUP_ROOT, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
        .reverse();
    for (const old of dirs.slice(keep)) {
        fs.rmSync(path.join(BACKUP_ROOT, old), { recursive: true, force: true });
        console.log('Retention: rimosso backup', old);
    }
    return dir;
}

// ── RESTORE ────────────────────────────────────────────────────────────────
function sqlLiteral(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return "'" + String(v).replace(/'/g, "''") + "'";
}

async function restore(dir, target, only = null, dryRun = false) {
    const ref = PROJECTS[target];
    if (!ref) throw new Error('Target sconosciuto: ' + target);
    const manifestPath = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) throw new Error('manifest.json non trovato in ' + dir);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    console.log(`Restore da ${dir} (${manifest.created_at}) verso ${target} [${ref}]${dryRun ? ' — DRY RUN' : ''}`);

    for (const t of TABLES) {
        if (only && !only.includes(t.name)) continue;
        const file = path.join(dir, t.name + '.jsonl');
        if (!fs.existsSync(file)) { console.log(`  ${t.name}: file assente, salto`); continue; }
        const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
        const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        const expected = manifest.tables[t.name];
        if (expected && expected.sha256 !== sha) throw new Error(`SHA256 mismatch per ${t.name}: backup corrotto?`);
        if (expected && expected.rows_dumped !== lines.length) throw new Error(`Conteggio righe incoerente per ${t.name}`);
        console.log(`  ${t.name}: ${lines.length} righe da ripristinare`);
        if (dryRun) continue;

        await runSql(ref, `DELETE FROM public.${t.name}`);
        const CHUNK = 500;
        for (let i = 0; i < lines.length; i += CHUNK) {
            const rows = lines.slice(i, i + CHUNK).map((l) => JSON.parse(l));
            const cols = Object.keys(rows[0]);
            const values = rows.map((r) => '(' + cols.map((c) => sqlLiteral(r[c])).join(', ') + ')').join(', ');
            const res = await runSql(ref,
                `INSERT INTO public.${t.name} (${cols.join(', ')}) VALUES ${values}`);
            if (res && res.error) throw new Error(`Insert fallito su ${t.name}: ${res.error}`);
        }
        const check = await runSql(ref, `SELECT count(*)::int AS n FROM public.${t.name}`);
        console.log(`  ${t.name}: ripristinate, count attuale = ${check[0].n}`);
    }
    console.log('Restore completato' + (dryRun ? ' (dry run)' : ''));
}

// ── LIST ───────────────────────────────────────────────────────────────────
function list() {
    if (!fs.existsSync(BACKUP_ROOT)) { console.log('Nessun backup (cartella assente).'); return; }
    const dirs = fs.readdirSync(BACKUP_ROOT, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
    for (const d of dirs) {
        const m = path.join(BACKUP_ROOT, d, 'manifest.json');
        if (fs.existsSync(m)) {
            const man = JSON.parse(fs.readFileSync(m, 'utf8'));
            const rows = Object.values(man.tables).reduce((a, t) => a + t.rows_dumped, 0);
            console.log(`${d}  (${man.target}, ${rows} righe totali)`);
        } else {
            console.log(`${d}  (manifest mancante)`);
        }
    }
}

// ── CLI ────────────────────────────────────────────────────────────────────
const [cmd, arg1, arg2, ...rest] = process.argv.slice(2);
try {
    if (cmd === 'run') {
        const keepIdx = rest.indexOf('--keep');
        const keep = keepIdx >= 0 ? parseInt(rest[keepIdx + 1], 10) : 10;
        await run(arg1, keep);
    } else if (cmd === 'restore') {
        if (!arg1 || !arg2) throw new Error('Uso: backup.mjs restore <dir> <dev|prod> [--only t1,t2] [--dry-run]');
        const onlyIdx = rest.indexOf('--only');
        const only = onlyIdx >= 0 ? rest[onlyIdx + 1].split(',') : null;
        const dryRun = rest.includes('--dry-run');
        const dir = fs.existsSync(arg1) ? arg1 : path.join(BACKUP_ROOT, arg1);
        await restore(dir, arg2, only, dryRun);
    } else if (cmd === 'list') {
        list();
    } else {
        console.error('Uso: node tools/backup.mjs <run|restore|list> ...');
        process.exit(1);
    }
} catch (e) {
    console.error('ERRORE:', e.message);
    process.exit(1);
}
