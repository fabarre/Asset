// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATE — copiare come supabase_config.js e valorizzare per l'ambiente.
// supabase_config.js è GITIGNORED: non committare MAI chiavi reali.
//
// Dove trovi i valori: Supabase Dashboard → Project Settings → API:
//   - SUPABASE_URL        = "Project URL"
//   - SUPABASE_ANON_KEY   = chiave "anon/public" (publishable, sicura per il browser;
//                           la protezione vera è fatta dalle policy RLS)
//
// ALLOW_ANONYMOUS (opzionale, default false):
//   true  → l'app mostra "Continua senza autenticazione" anche su host non locali
//   false → accesso anonimo consentito solo su localhost/127.0.0.1 (sviluppo).
//   In produzione DEVE restare false/assente: le RLS sono owner-based e un
//   accesso anonimo non potrebbe comunque leggere né scrivere dati.
// ═══════════════════════════════════════════════════════════════════════════
window.SUPABASE_CONFIG = {
    "SUPABASE_URL": "https://<PROJECT_REF>.supabase.co",
    "SUPABASE_ANON_KEY": "sb_publishable_...",
    "ALLOW_ANONYMOUS": false
};
