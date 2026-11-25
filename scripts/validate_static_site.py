#!/usr/bin/env python3
import json
import re
from pathlib import Path

root=Path(__file__).resolve().parents[1]
for page in ('index.html','etf.html'):
    text=(root/page).read_text(encoding='utf-8')
    for ref in re.findall(r'(?:src|href)="([^"]+)"',text):
        if ref.startswith(('http:','https:','#')):
            continue
        target=root/ref.split('?',1)[0]
        if not target.exists():
            raise SystemExit(f'{page}: missing asset {ref}')
payload=json.loads((root/'etf-data.json').read_text(encoding='utf-8'))
required={'net_flow','btc_holdings','usd_balances','btc_price'}
if not required.issubset(payload.get('datasets',{})):
    raise SystemExit('ETF data schema is incomplete')
if 'window.ETF_DATA=' not in (root/'etf-data.js').read_text(encoding='utf-8'):
    raise SystemExit('ETF browser data wrapper is invalid')
print('Static production validation passed: index.html, etf.html, assets, and ETF data')
