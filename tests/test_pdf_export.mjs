import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mock jsPDF doc
function createMockDoc() {
    let pageCount = 1;
    let currentOrientation = 'portrait';
    const calls = {
        pages: [],
        tables: [],
        texts: [],
        rects: []
    };

    const doc = {
        internal: {
            pageSize: {
                getWidth: () => currentOrientation === 'landscape' ? 297 : 210,
                getHeight: () => currentOrientation === 'landscape' ? 210 : 297
            }
        },
        addPage: (fmt, orientation) => {
            pageCount++;
            if (orientation) currentOrientation = orientation;
            calls.pages.push({ pageNumber: pageCount, format: fmt, orientation: currentOrientation });
            return doc;
        },
        setFont: () => {},
        setFontSize: () => {},
        setTextColor: () => {},
        setFillColor: () => {},
        setDrawColor: () => {},
        setLineWidth: () => {},
        line: () => {},
        rect: (x, y, w, h, s) => { calls.rects.push({ x, y, w, h, s }); },
        roundedRect: (x, y, w, h, rx, ry, s) => { calls.rects.push({ x, y, w, h, rx, ry, s }); },
        text: (txt, x, y) => {
            calls.texts.push({ txt, x, y });
        },
        splitTextToSize: (txt) => [txt],
        lastAutoTable: { finalY: 100 },
        autoTable: (opts) => {
            calls.tables.push(opts);
            // Simula didParseCell su ogni riga del body per verificare l'assenza di errori di runtime
            if (typeof opts.didParseCell === 'function' && Array.isArray(opts.body)) {
                opts.body.forEach((row, rIdx) => {
                    row.forEach((cellVal, cIdx) => {
                        const cellData = {
                            section: 'body',
                            row: { index: rIdx },
                            column: { index: cIdx },
                            cell: { styles: {} }
                        };
                        opts.didParseCell(cellData);
                    });
                });
            }
            doc.lastAutoTable = { finalY: (opts.startY || 30) + (opts.body ? opts.body.length * 2 : 50) };
        },
        save: (fname) => {
            calls.savedFile = fname;
        }
    };
    doc._calls = calls;

    return { doc, calls };
}

// Dati sintetici simulazione a 72 mesi
const monthlyCashflow = {
    mode: 'dated',
    anchorYear: 2026,
    months: Array.from({ length: 72 }, (_, i) => i + 1),
    labels: Array.from({ length: 72 }, (_, i) => {
        const y = 2025 + Math.floor(i / 12);
        const m = (i % 12) + 1;
        return `${m < 10 ? '0' + m : m}/${y}${i < 12 ? ' (Y0)' : ''}`;
    }),
    revenueAccrued: Array.from({ length: 72 }, (_, i) => i < 12 ? 0 : 8500),
    revenueTotal: Array.from({ length: 72 }, (_, i) => i < 12 ? 0 : 8500),
    opex: Array.from({ length: 72 }, (_, i) => i < 12 ? 200 : 1700),
    taxes: Array.from({ length: 72 }, (_, i) => (i >= 12 && i % 12 === 6) ? 5000 : 0),
    debtService: Array.from({ length: 72 }, (_, i) => i < 12 ? 0 : 1666),
    capexOutflow: Array.from({ length: 72 }, (_, i) => i === 0 ? 500000 : (i === 6 ? 300000 : 0)),
    fundingInflow: Array.from({ length: 72 }, (_, i) => i === 0 ? 600000 : (i === 6 ? 250000 : 0)),
    vatCollected: Array.from({ length: 72 }, (_, i) => i < 12 ? 0 : 850),
    vatPaidToSuppliers: Array.from({ length: 72 }, (_, i) => i === 0 ? 50000 : 170),
    vatRemitted: Array.from({ length: 72 }, () => 0),
    vatRefundReceived: Array.from({ length: 72 }, (_, i) => (i === 5 ? 40000 : 0)),
    vatCreditEnd: Array.from({ length: 72 }, () => 15000),
    vatCashFlow: Array.from({ length: 72 }, (_, i) => (i === 0 ? -50000 : (i === 5 ? 40000 : 680))),
    netCashflow: Array.from({ length: 72 }, (_, i) => (i === 0 ? -550000 : 4500)),
    cashClosing: Array.from({ length: 72 }, (_, i) => -100000 + i * 5000),
    fundedCashClosing: Array.from({ length: 72 }, (_, i) => (i === 0 ? -50000 : 50000 + i * 5000)),
    holdcoSociService: Array.from({ length: 72 }, () => 0),
    holdcoPdService: Array.from({ length: 72 }, () => 0),
    holdcoOtherCosts: Array.from({ length: 72 }, () => 100),
    holdcoCashClosing: Array.from({ length: 72 }, (_, i) => 10000 + i * 1000),
    minCashClosing: -550000,
    minCashMonth: '01/2025 (Y0)',
    fundedMinCashClosing: -50000,
    fundedMinMonth: '01/2025 (Y0)',
    negativeMonths: 14,
    negativeNetMonths: 12,
    vatMaxCredit: 50000,
    vatNetCumulative: -14000,
    datedXirr: 12.45,
    capexBudget: 800000,
    capexAllocated: 800000,
    capexResidual: 0
};

// Setup mock window environment
global.window = {
    _currentProjectName: 'Parco Solare & BESS Tuscania 5MW',
    State: {
        branding: {
            company: 'Green Energy Holding SPV'
        },
        inputs: {
            exitOption: '20',
            sociEquityPct: 80,
            pdEnabled: false
        },
        plants: [{ id: 1, name: 'FV Tuscania', capacity: 5000, enabled: true }],
        stabilimenti: [{ id: 1, name: 'Alpha', enabled: true }],
        results: {
            monthlyCashflow,
            matrix: {
                years: [1, 2, 3, 4, 5],
                netProfitSpv: [10000, 11000, 12000, 13000, 14000],
                depreciationCivil: [5000, 5000, 5000, 5000, 5000],
                deferredTaxes: [0, 0, 0, 0, 0],
                interest: [4000, 3800, 3600, 3400, 3200],
                sociInterestAccrued: [1000, 1000, 1000, 1000, 1000],
                pdInterestAccrued: [0, 0, 0, 0, 0],
                afInterestAccrued: [0, 0, 0, 0, 0],
                opexMaintReserve: [0, 0, 0, 0, 0],
                bessAugmentationCost: [0, 0, 0, 0, 0],
                mraRelease: [0, 0, 0, 0, 0],
                cfads: [20000, 20800, 21600, 22400, 23200],
                interestPaid: [4000, 3800, 3600, 3400, 3200],
                principalScheduled: [6000, 6200, 6400, 6600, 6800],
                principalVoluntary: [0, 0, 0, 0, 0],
                spvFCFE: [10000, 10800, 11600, 12400, 13200],
                pdInterestPaid: [0, 0, 0, 0, 0],
                pdPrincipalPaid: [0, 0, 0, 0, 0],
                peDividendPaid: [0, 0, 0, 0, 0],
                holdcoInterestReceived: [1000, 1000, 1000, 1000, 1000],
                holdcoLoanRepaymentReceived: [0, 0, 0, 0, 0],
                spvLockedDividends: [0, 0, 0, 0, 0],
                holdcoDividendReceived: [9000, 9800, 10600, 11400, 12200],
                spvCashTrap: [0, 0, 0, 0, 0]
            },
            debtSchedule: {
                years: [1, 2, 3, 4, 5],
                beginningBalance: [50000, 44000, 37800, 31400, 24800],
                interestAccrued: [4000, 3800, 3600, 3400, 3200],
                principalScheduled: [6000, 6200, 6400, 6600, 6800],
                principalVoluntary: [0, 0, 0, 0, 0],
                endingBalance: [44000, 37800, 31400, 24800, 18000],
                totalDebtService: [10000, 10000, 10000, 10000, 10000],
                dscr: [2.0, 2.08, 2.16, 2.24, 2.32],
                beginningBalanceSoci: [20000, 20000, 20000, 20000, 20000],
                interestAccruedSoci: [1000, 1000, 1000, 1000, 1000],
                interestPaidSoci: [1000, 1000, 1000, 1000, 1000],
                principalPaidSoci: [0, 0, 0, 0, 0],
                endingBalanceSoci: [20000, 20000, 20000, 20000, 20000]
            }
        }
    }
};

global.window.jspdf = {
    jsPDF: class {
        constructor(opts) {
            const m = createMockDoc();
            if (opts && opts.orientation === 'landscape') {
                m.doc.addPage('a4', 'landscape');
            }
            return m.doc;
        }
    }
};

global.document = {
    addEventListener: () => {},
    getElementById: (id) => ({
        id,
        value: '',
        textContent: '',
        classList: { add: () => {}, remove: () => {}, contains: () => false },
        addEventListener: () => {},
        style: {}
    }),
    querySelectorAll: () => [],
    querySelector: () => null,
    body: { appendChild: () => {}, removeChild: () => {} },
    createElement: () => ({ click: () => {}, style: {} })
};
global.window.document = global.document;
global.window.addEventListener = () => {};
global.window.navigator = { userAgent: 'node' };

// Carica il file src/main.js
const mainJsCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

// Estraiamo le funzioni PDF da testare
const extractFns = new Function(
    'window',
    `${mainJsCode}\n
    return {
        _repCashFlowMensileInline,
        _repRendicontoFinanziario,
        _repBilancioHolding,
        _repContoEconomicoHoldingInline,
        _repRendicontoFinanziarioHoldingInline,
        _repFullDueDiligence
    };`
);

const { _repCashFlowMensileInline, _repRendicontoFinanziario, _repBilancioHolding, _repContoEconomicoHoldingInline, _repRendicontoFinanziarioHoldingInline, _repFullDueDiligence } = extractFns(global.window);

// Imposta i risultati nello State dopo l'inizializzazione di main.js
global.window.State.inputs = {
    exitOption: '20',
    sociEquityPct: 80,
    pdEnabled: false
};
global.window.State.plants = [{ id: 1, name: 'FV Tuscania', capacity: 5000, enabled: true }];
global.window.State.stabilimenti = [{ id: 1, name: 'Alpha', enabled: true }];
global.window.State.results = {
    monthlyCashflow,
    matrix: {
        years: [1, 2, 3, 4, 5],
        netProfitSpv: [10000, 11000, 12000, 13000, 14000],
        depreciationCivil: [5000, 5000, 5000, 5000, 5000],
        deferredTaxes: [0, 0, 0, 0, 0],
        interest: [4000, 3800, 3600, 3400, 3200],
        sociInterestAccrued: [1000, 1000, 1000, 1000, 1000],
        pdInterestAccrued: [0, 0, 0, 0, 0],
        afInterestAccrued: [0, 0, 0, 0, 0],
        opexMaintReserve: [0, 0, 0, 0, 0],
        bessAugmentationCost: [0, 0, 0, 0, 0],
        mraRelease: [0, 0, 0, 0, 0],
        cfads: [20000, 20800, 21600, 22400, 23200],
        interestPaid: [4000, 3800, 3600, 3400, 3200],
        principalScheduled: [6000, 6200, 6400, 6600, 6800],
        principalVoluntary: [0, 0, 0, 0, 0],
        spvFCFE: [10000, 10800, 11600, 12400, 13200],
        pdInterestPaid: [0, 0, 0, 0, 0],
        pdPrincipalPaid: [0, 0, 0, 0, 0],
        peDividendPaid: [0, 0, 0, 0, 0],
        holdcoInterestReceived: [1000, 1000, 1000, 1000, 1000],
        holdcoLoanRepaymentReceived: [0, 0, 0, 0, 0],
        spvLockedDividends: [0, 0, 0, 0, 0],
        holdcoDividendReceived: [9000, 9800, 10600, 11400, 12200],
        spvCashTrap: [0, 0, 0, 0, 0]
    },
    debtSchedule: {
        years: [1, 2, 3, 4, 5],
        beginningBalance: [50000, 44000, 37800, 31400, 24800],
        interestAccrued: [4000, 3800, 3600, 3400, 3200],
        principalScheduled: [6000, 6200, 6400, 6600, 6800],
        principalVoluntary: [0, 0, 0, 0, 0],
        endingBalance: [44000, 37800, 31400, 24800, 18000],
        totalDebtService: [10000, 10000, 10000, 10000, 10000],
        dscr: [2.0, 2.08, 2.16, 2.24, 2.32],
        beginningBalanceSoci: [20000, 20000, 20000, 20000, 20000],
        interestAccruedSoci: [1000, 1000, 1000, 1000, 1000],
        interestPaidSoci: [1000, 1000, 1000, 1000, 1000],
        principalPaidSoci: [0, 0, 0, 0, 0],
        endingBalanceSoci: [20000, 20000, 20000, 20000, 20000]
    }
};

console.log("▶ Test 1: Esecuzione di _repCashFlowMensileInline()...");
const mock1 = createMockDoc();
const endY = _repCashFlowMensileInline(mock1.doc, 30);
if (!mock1.calls.tables.length) {
    throw new Error("❌ Nessuna tabella autoTable generata in _repCashFlowMensileInline!");
}
const cfTable = mock1.calls.tables[0];
if (!cfTable.head || cfTable.head[0].length !== 11) {
    throw new Error(`❌ Attese 11 colonne nella tabella Cash Flow Mensile PDF, trovate: ${cfTable.head ? cfTable.head[0].length : 0}`);
}
console.log(`✓ Tabella autoTable generata con 11 colonne: ${cfTable.head[0].join(' | ')}`);

if (!cfTable.body || cfTable.body.length !== 72) {
    throw new Error(`❌ Attese 72 righe di dati mensili nel PDF, trovate: ${cfTable.body ? cfTable.body.length : 0}`);
}
console.log(`✓ Tabella autoTable contiene esattamente 72 mesi di dati con formattazione e didParseCell validati.`);

// Verifica box KPI
const kpiBoxText = mock1.calls.texts.find(t => t.txt && t.txt.includes('SINTESI INDICATORI BANCARI'));
if (!kpiBoxText) {
    throw new Error("❌ Box KPI di sintesi bancaria non trovato nell'output PDF!");
}
console.log(`✓ Box KPI di sintesi bancaria posizionato correttamente a Y=${kpiBoxText.y}`);

console.log("\n▶ Test 2: Esecuzione di _repRendicontoFinanziario()...");
const mock2 = createMockDoc();
const rep3Doc = _repRendicontoFinanziario(mock2.doc);
const calls2 = (rep3Doc && rep3Doc._calls) ? rep3Doc._calls : mock2.calls;
// Deve contenere la pagina annuale e la pagina mensile (landscape)
const cfTableInRep3 = calls2.tables.find(t => t.head && t.head[0].length === 11);
if (!cfTableInRep3) {
    throw new Error("❌ Tabella Cash Flow Mensile a 11 colonne non trovata nel Report 3 (Rendiconto Finanziario)!");
}
console.log("✓ Report 3 include la tabella Cash Flow Mensile a 11 colonne sincronizzata.");

console.log("\n▶ Test 3: Esecuzione di _repFullDueDiligence()...");
const mock3 = createMockDoc();
_repFullDueDiligence(mock3.doc);
// Verifica che l'indice contenga Sezione 8
const tocSection8 = mock3.calls.texts.find(t => t.txt && t.txt.includes('Sezione 8'));
if (!tocSection8) {
    throw new Error("❌ 'Sezione 8' non trovata nell'indice del Report 8 (Full Due Diligence)!");
}
console.log(`✓ Indice del Report 8 include: "${tocSection8.txt}"`);

// Verifica che la tabella a 11 colonne sia presente tra le tabelle generate
const cfTableInRep8 = mock3.calls.tables.find(t => t.head && t.head[0].length === 11);
if (!cfTableInRep8) {
    throw new Error("❌ Sezione 8 Cash Flow Mensile non presente tra le tabelle del Report 8!");
}
console.log("✓ Sezione 8 Cash Flow Mensile generata con successo all'interno della Full Due Diligence.");

// Verifica Sezione 6 e Sezione 7 Holding nell'indice di Full Due Diligence
const tocSec6 = mock3.calls.texts.find(t => t.txt && t.txt.includes('Sezione 6 - Conto Economico Holding'));
const tocSec7 = mock3.calls.texts.find(t => t.txt && t.txt.includes('Sezione 7 - Rendiconto Finanziario Holding'));
if (!tocSec6 || !tocSec7) {
    throw new Error("❌ Sezione 6 o Sezione 7 Holding non trovata nell'indice di Full Due Diligence!");
}
console.log(`✓ Indice del Report include Sez. 6: "${tocSec6.txt}" e Sez. 7: "${tocSec7.txt}"`);

console.log("\n▶ Test 4: Esecuzione di _repBilancioHolding()...");
const mock4 = createMockDoc();
const repHoldDoc = _repBilancioHolding(mock4.doc);
const calls4 = (repHoldDoc && repHoldDoc._calls) ? repHoldDoc._calls : mock4.calls;
if (calls4.tables.length < 2) {
    throw new Error(`❌ Attese almeno 2 tabelle in _repBilancioHolding (CE + RF), trovate: ${calls4.tables.length}`);
}
console.log(`✓ Report Bilancio Holding genera correttamente ${calls4.tables.length} tabelle (Conto Economico + Rendiconto Finanziario).`);

// Verifica intestazioni tabelle Holding
const ceHoldTable = calls4.tables[0];
const rfHoldTable = calls4.tables[1];
if (!ceHoldTable.head || !ceHoldTable.head[0] || ceHoldTable.head[0][0] !== 'Voce') {
    throw new Error("❌ Tabella Conto Economico Holding priva di colonna 'Voce'!");
}
if (!rfHoldTable.head || !rfHoldTable.head[0] || rfHoldTable.head[0][0] !== 'Voce') {
    throw new Error("❌ Tabella Rendiconto Finanziario Holding priva di colonna 'Voce'!");
}
console.log(`✓ Tabelle Conto Economico e Rendiconto Holding strutturate con successo a ${ceHoldTable.head[0].length} colonne.`);

console.log("\n========================================================");
console.log("🎉 TUTTI I TEST REPORT PDF (SPV + HOLDING + CF) SUPERATI AL 100%!");
console.log("========================================================\n");
