import re

with open('src/worker/simulation.worker.js', 'r', encoding='utf-8') as f:
    content = f.read()

target1 = r"""                    const ridPriceY1 = (plant._solarGridFeedMwhY1 > 0) ? (plant._solarRidRevY1 / plant._solarGridFeedMwhY1) : (plant._weightedPun * lossMult - gseImb);"""
replace1 = r"""                    const fallbackPrice = (plant.marketType === 'fer_x') ? (plant.ferxTariff / 1000) : (plant._weightedPun * lossMult - gseImb);
                    const ridPriceY1 = (plant._solarGridFeedMwhY1 > 0) ? (plant._solarRidRevY1 / plant._solarGridFeedMwhY1) : fallbackPrice;"""
content = content.replace(target1, replace1)

with open('src/worker/simulation.worker.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patch 2 completed.")
