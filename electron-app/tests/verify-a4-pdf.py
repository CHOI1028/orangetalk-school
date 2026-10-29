"""Validate PDF text, visit order and page count. Pair with DOM bounds and raster checks."""
import json,re,sys,logging
from pathlib import Path
import pdfplumber
logging.getLogger('pdfminer').setLevel(logging.ERROR)
base=Path(sys.argv[1]);report=json.loads((base/'report.json').read_text(encoding='utf-8'))
results=[]
for case in report['cases']:
    if not case['passed']:
        results.append({'name':case['name'],'passed':False,'error':case['error']});continue
    with pdfplumber.open(base/case['pdf']) as pdf:
        # A sliced block is painted with clipping; PDF streams can still contain
        # its off-page source text. Only count glyphs inside the physical page.
        visible=[p.filter(lambda c,p=p:c.get('object_type')!='char' or (c['x0']>=-1 and c['x1']<=p.width+1 and c['top']>=-1 and c['bottom']<=p.height+1)) for p in pdf.pages]
        # Small fit-to-width fonts have adjacent baselines closer than pdfplumber's
        # default 3pt grouping. Keep distinct lines separate in the text oracle.
        texts=[p.extract_text(layout=False,x_tolerance=0.5,y_tolerance=0.5) or '' for p in visible]
        text=re.sub(r'\s+','','\n'.join(texts))
        missing=[m for m in case['markers'] if m not in text]
        positions=[text.find(m) for m in case.get('visitOrder',[])]
        order_ok=positions==sorted(positions) and all(p>=0 for p in positions)
        duplicates=[m for m in case['markers'] if case.get('visitOrder') and text.count(m)!=1]
        rental_ok=not case['name'].startswith('rental-') or all('물품' in t and '대여' in t for t in texts)
        item={'name':case['name'],'passed':not missing and not duplicates and order_ok and rental_ok and len(pdf.pages)==case['pages'],'pages':len(pdf.pages),'expectedMarkers':len(case['markers']),'missingMarkers':missing,'visitOrderPreserved':order_ok,'duplicateMarkers':duplicates,'rentalHeaders':rental_ok}
        results.append(item)
        print(case['name'],'PASS' if item['passed'] else 'FAIL','missing',missing[:8],'duplicates',duplicates[:8],'order',order_ok,'rentalHeaders',rental_ok)
result={'passed':all(r['passed'] for r in results),'cases':results,'totalMarkers':sum(r.get('expectedMarkers',0) for r in results)}
(base/'pdf-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'passed':result['passed'],'cases':len(results),'totalMarkers':result['totalMarkers']}))
sys.exit(0 if result['passed'] else 1)
