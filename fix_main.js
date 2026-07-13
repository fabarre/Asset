const fs = require('fs');
let c = fs.readFileSync('src/main.js', 'utf8');

c = c.replace(/â‚¬/g, '€');
c = c.replace(/â€”/g, '—');
c = c.replace(/â€“/g, '–');
c = c.replace(/â€œ/g, '“');
c = c.replace(/â€/g, '”');
c = c.replace(/â€˜/g, '‘');
c = c.replace(/â€™/g, '’');
c = c.replace(/Ã¨/g, 'è');
c = c.replace(/Ã©/g, 'é');
c = c.replace(/Ã/g, 'à');
c = c.replace(/Â·/g, '·');
c = c.replace(/â€¢/g, '•');
c = c.replace(/â†’/g, '→');
c = c.replace(/âš /g, '⚠');
c = c.replace(/âœ"/g, '✔');
c = c.replace(/â•/g, '═');
c = c.replace(/â”€/g, '─');

fs.writeFileSync('src/main.js', c, 'utf8');
