const fs = require('fs');
let c = fs.readFileSync('index.html', 'utf8');

// remove duplicated lines 1-7
if (c.startsWith("<!DOCTYPE html>\n<html lang=\"it\">\n<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n    <title>Solar & BESS M&A Deal Simulator - Enterprise Edition</title>\n    <link rel=\"icon\" href=\"data:,\">\n<!DOCTYPE html>")) {
    c = c.substring(c.indexOf("<!DOCTYPE html>", 10));
}

c = c.replace(/â‚¬/g, '€');
c = c.replace(/â€“/g, '–');
c = c.replace(/â€”/g, '—');
c = c.replace(/Â·/g, '·');
c = c.replace(/Â/g, '');

fs.writeFileSync('index.html', c, 'utf8');

// Also modify index.html to include excelExport.js
if (!c.includes('excelExport.js')) {
    let newScript = '<script src="./src/excelExport.js"></script>\n    <style>';
    c = c.replace('<style>', newScript);
    fs.writeFileSync('index.html', c, 'utf8');
}
