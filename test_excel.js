const fs = require('fs');

global.alert = console.log; global.window = {
    State: {
        results: { matrix: {
            years: [1,2,3],
            qtySolarGen: [100, 100, 100],
            qtySolarPpa: [50, 50, 50],
            qtySolarRid: [20, 20, 20],
            qtySolarToBess: [30, 30, 30],
            priceSolarAvg: [50, 50, 50],
            priceSolarPpa: [60, 60, 60],
            priceSolarRid: [40, 40, 40]
        } },
        stabilimenti: [
            { enabled: true, ppaType: 'cer' }
        ]
    }
};

global.ExcelJS = require('exceljs');
global.saveAs = function(blob, filename) {
    console.log("saveAs called with filename:", filename);
};
global.Blob = class Blob {
    constructor(buffers) {
        this.buffers = buffers;
    }
};

const code = fs.readFileSync('./src/excelExport.js', 'utf8');
eval(code);

exportPnlToExcel().then(() => console.log("Done")).catch(console.error);
