import re

worker_file = r'c:\Users\Utente\ASSET\src\worker\simulation.worker.js'

with open(worker_file, 'r', encoding='utf-8') as f:
    content = f.read()

target = "const fallbackPrice = (plant.marketType === 'fer_x') ? (plant.ferxTariff / 1000) : (plant._weightedPun * lossMult - gseImb);"
replacement = "const fallbackPrice = (plant.marketType === 'fer_x') ? plant.ferxTariff : (plant._weightedPun * lossMult - gseImb);"

content = content.replace(target, replacement)

with open(worker_file, 'w', encoding='utf-8') as f:
    f.write(content)
