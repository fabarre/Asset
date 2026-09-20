import { chromium } from 'playwright';

async function inspectBrowser() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

    // Wait 3 seconds for simulation to finish
    await page.waitForTimeout(3000);

    const stateSummary = await page.evaluate(() => {
        const p = window.State ? window.State.inputs : null;
        const res = window.State ? window.State.results : null;
        const plants = window.State ? window.State.plants : null;
        const opexEvents = window.State ? window.State.opexEvents : null;

        // DOM inputs
        const exitOptVal = document.getElementById('input-exit-option') ? document.getElementById('input-exit-option').value : 'not found';
        const exitOptText = document.getElementById('val-exit-option') ? document.getElementById('val-exit-option').textContent : 'not found';
        const exitMwpVal = document.getElementById('input-exit-value-mwp') ? document.getElementById('input-exit-value-mwp').value : 'not found';
        const exitEvVal = document.getElementById('input-exit-ev') ? document.getElementById('input-exit-ev').value : 'not found';
        const exitMultVal = document.getElementById('input-exit-multiple') ? document.getElementById('input-exit-multiple').value : 'not found';

        return {
            inputs: {
                exitOption: p ? p.exitOption : null,
                exitMultiple: p ? p.exitMultiple : null,
                exitValuePerMwp: p ? p.exitValuePerMwp : null,
                exitEnterpriseValue: p ? p.exitEnterpriseValue : null,
                leverage: p ? p.leverage : null,
                interestRate: p ? p.interestRate : null,
                loanTerm: p ? p.loanTerm : null,
                graceMonths: p ? p.graceMonths : null
            },
            dom: {
                exitOptVal,
                exitOptText,
                exitMwpVal,
                exitEvVal,
                exitMultVal
            },
            plantsCount: plants ? plants.length : 0,
            plants: plants ? plants.map(pl => ({ id: pl.id, name: pl.name, capacity: pl.capacity, cod: pl.cod, capex: pl.capex })) : [],
            matrixEbitdaY20: (res && res.matrix && res.matrix.ebitda) ? res.matrix.ebitda[19] : null,
            matrixExitEvY20: (res && res.matrix && res.matrix.exitEnterpriseValue) ? res.matrix.exitEnterpriseValue[19] : null,
            matrixExitProceedsY20: (res && res.matrix && res.matrix.exitNetProceedsRow) ? res.matrix.exitNetProceedsRow[19] : null,
            matrixFcfeY20: (res && res.matrix && res.matrix.holdcoFCFE) ? res.matrix.holdcoFCFE[19] : null,
            matrixFcfeCumulY20: (res && res.matrix && res.matrix.holdcoFCFECumulated) ? res.matrix.holdcoFCFECumulated[19] : null,
            opexEventsKeys: opexEvents ? Object.keys(opexEvents) : []
        };
    });

    console.log('=== STATO LIVE BROWSER WEB APP ===');
    console.log('DOM inputs:', stateSummary.dom);
    console.log('State.inputs:', stateSummary.inputs);
    console.log('Plants count:', stateSummary.plantsCount, stateSummary.plants);
    console.log('Matrix Year 20 values in Web App:');
    console.log('- EBITDA Y20:', stateSummary.matrixEbitdaY20);
    console.log('- Exit EV Y20:', stateSummary.matrixExitEvY20);
    console.log('- Exit Proceeds Y20:', stateSummary.matrixExitProceedsY20);
    console.log('- FCFE Y20:', stateSummary.matrixFcfeY20);
    console.log('- FCFE Cumulato Y20:', stateSummary.matrixFcfeCumulY20);

    await browser.close();
}

inspectBrowser().catch(console.error);
