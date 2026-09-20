import fs from 'node:fs';
import vm from 'node:vm';
import ExcelJS from 'exceljs';

const filePath = '/home/ubuntu/Asset/PL_Driver_Operativi (69).xlsx';
const workerPath = '/home/ubuntu/Asset/src/worker/simulation.worker.js';

const workerCode = fs.readFileSync(workerPath, 'utf8');
let workerResponse = null;
const sandbox = {
    self: {
        postMessage: (msg) => { workerResponse = msg; }
    },
    console,
    structuredClone: global.structuredClone,
    Float64Array, Int32Array, Math, Date, JSON, Array, Object, Number, String,
    Set, Map, isNaN, isFinite, parseInt, parseFloat, Infinity, NaN
};
vm.createContext(sandbox);
vm.runInContext(workerCode, sandbox);

async function inspectOpex() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);

    // Read plants from CAPEX
    const sCapex = wb.getWorksheet('CAPEX');
    // Guasticce (C2): Solar = 2546376.59, Conn = 62240, SPV = 460130, DDS = 433820
    // Castenaso (C3): Solar = 2466856.76, Conn = 34943, SPV = 440352, Land = 436687
    
    // Total Kwp: 4140.68 + 4045.52 = 8186.2 kWp
    console.log("Reading plants from CAPEX...");
}

inspectOpex().catch(console.error);
