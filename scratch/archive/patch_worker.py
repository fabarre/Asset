import re

with open('src/worker/simulation.worker.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update simulateBessHourly arguments extraction
target1 = r"""            const spread = p.traderSpread;
            const disp = p.traderDisp;
            const ppaPrice = p.ppaPrice || 0;"""
replace1 = r"""            const spread = p.traderSpread;
            const disp = p.traderDisp;
            const ppaPrice = p.ppaPrice || 0;
            const marketType = p.marketType || 'rid';
            const ferxTariff = p.ferxTariff !== undefined ? p.ferxTariff : 85;"""
content = content.replace(target1, replace1)

# 2. Update priceRID calculation inside simulateBessHourly (around line 178)
target2 = r"""                    const pricePUN = punProfile[t];
                    const priceRID = (pricePUN * lossMult - gseImb) / 1000;
                    const pricePPA = ppaPrice / 1000;"""
replace2 = r"""                    const pricePUN = punProfile[t];
                    const priceRID = (marketType === 'fer_x') ? (ferxTariff / 1000) : ((pricePUN * lossMult - gseImb) / 1000);
                    const pricePPA = ppaPrice / 1000;"""
content = content.replace(target2, replace2)

# 3. Update priceRID calculation inside simulateBessHourly (around line 543)
target3 = r"""                        const pricePPA = ppaPrice / 1000;
                        const priceRID = (pricePUN * lossMult - gseImb) / 1000;
                        const costGrid = (traderPrice * lossWithdrawMult + spread + disp) / 1000;"""
replace3 = r"""                        const pricePPA = ppaPrice / 1000;
                        const priceRID = (marketType === 'fer_x') ? (ferxTariff / 1000) : ((pricePUN * lossMult - gseImb) / 1000);
                        const costGrid = (traderPrice * lossWithdrawMult + spread + disp) / 1000;"""
content = content.replace(target3, replace3)

# 4. Update priceRID calculation inside simulateBessHourly (around line 668)
target4 = r"""                        const lodVal = loadProfile[h];
                        const pricePUN = punProfile[h];
                        const priceRID = (pricePUN * lossMult - gseImb) / 1000;
                        const pricePPA = ppaPrice / 1000;"""
replace4 = r"""                        const lodVal = loadProfile[h];
                        const pricePUN = punProfile[h];
                        const priceRID = (marketType === 'fer_x') ? (ferxTariff / 1000) : ((pricePUN * lossMult - gseImb) / 1000);
                        const pricePPA = ppaPrice / 1000;"""
content = content.replace(target4, replace4)

# 5. Add marketType and ferxTariff to simulateBessHourly call (around line 892)
target5 = r"""                    traderContractType: plant.traderContractType || 'pun_orario',
                    traderSpread: plant.traderSpread || 0,
                    traderDisp: plant.traderDisp || 0,"""
replace5 = r"""                    traderContractType: plant.traderContractType || 'pun_orario',
                    traderSpread: plant.traderSpread || 0,
                    traderDisp: plant.traderDisp || 0,
                    marketType: plant.marketType || 'rid',
                    ferxTariff: plant.ferxTariff !== undefined ? plant.ferxTariff : 85,"""
content = content.replace(target5, replace5)

# 6. Update priceRID calculation outside simulateBessHourly (around line 976)
target6 = r"""                    const traderPrice = plant.traderContractType === 'pun_medio' ? monthlyAveragePun[month] : pricePUN;
                    
                    const priceRID = (pricePUN * lossMult - gseImb) / 1000;
                    const costGrid = (traderPrice * (1 + lossWithdraw / 100) + spread + disp) / 1000;"""
replace6 = r"""                    const traderPrice = plant.traderContractType === 'pun_medio' ? monthlyAveragePun[month] : pricePUN;
                    
                    const priceRID = (plant.marketType === 'fer_x') ? (plant.ferxTariff / 1000) : ((pricePUN * lossMult - gseImb) / 1000);
                    const costGrid = (traderPrice * (1 + lossWithdraw / 100) + spread + disp) / 1000;"""
content = content.replace(target6, replace6)

# 7. Update priceRID calculation outside simulateBessHourly (around line 1017)
target7 = r"""                    for (let t = 0; t < 8760; t++) {
                        const pricePUN = zonePrices[t];
                        const priceRID = (pricePUN * lossMult - gseImb) / 1000;"""
replace7 = r"""                    for (let t = 0; t < 8760; t++) {
                        const pricePUN = zonePrices[t];
                        const priceRID = (plant.marketType === 'fer_x') ? (plant.ferxTariff / 1000) : ((pricePUN * lossMult - gseImb) / 1000);"""
content = content.replace(target7, replace7)

# 8. Update priceRID calculation outside simulateBessHourly (around line 1081)
target8 = r"""                        const pricePUN = zonePrices[t];
                        const priceRID = (pricePUN * lossMult - gseImb) / 1000;
                        const month = getMonthOfHour(t);"""
replace8 = r"""                        const pricePUN = zonePrices[t];
                        const priceRID = (plant.marketType === 'fer_x') ? (plant.ferxTariff / 1000) : ((pricePUN * lossMult - gseImb) / 1000);
                        const month = getMonthOfHour(t);"""
content = content.replace(target8, replace8)

# 9. Update priceRID calculation outside simulateBessHourly (around line 1662)
target9 = r"""                            const pricePUN = zonePrices[t];
                            const priceRID = ((pricePUN * lossMult - gseImb) / 1000) * currentRidDecay;
                            const month = getMonthOfHour(t);"""
replace9 = r"""                            const pricePUN = zonePrices[t];
                            const basePrice = (plant.marketType === 'fer_x') ? (plant.ferxTariff / 1000) : ((pricePUN * lossMult - gseImb) / 1000);
                            const priceRID = basePrice * currentRidDecay;
                            const month = getMonthOfHour(t);"""
content = content.replace(target9, replace9)

with open('src/worker/simulation.worker.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patch completed.")
