"""Apply review/decisions.json to index.html: rebuilds CARBON_RUBRICS and SAMPLES from review/baseline.json, so it can be rerun safely."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
path = os.path.join(ROOT, 'index.html')
base = json.load(open(os.path.join(HERE, 'baseline.json'), encoding='utf-8'))
dec = json.load(open(os.path.join(HERE, 'decisions.json'), encoding='utf-8'))['rows']
C, S = base['CARBON_RUBRICS'], base['SAMPLES']
used = set()
for c in C:
    s = next(x for x in S if x['id'] == c['id'])
    assert [r['n'] for r in c['rows']] == [r['n'] for r in s['rubric']], c['id']
    keep_c, keep_s = [], []
    for rc, rs in zip(c['rows'], s['rubric']):
        k = f"{c['id']}:{rc['n']}"
        o = dec.get(k, {})
        if o: used.add(k)
        if o.get('removed'):
            continue
        if 'mh' in o: rc['mh'] = rs['m'] = o['mh']
        if 'rh' in o: rc['rh'] = rs['r'] = o['rh']
        if 'mhc' in o: rc['mhc'] = rs['mc'] = o['mhc']
        if 'rhc' in o: rc['rhc'] = rs['rc'] = o['rhc']
        keep_c.append(rc); keep_s.append(rs)
    c['rows'], s['rubric'] = keep_c, keep_s
missing = set(dec) - used
if missing: sys.exit(f'decisions for unknown rows: {sorted(missing)}')
lines = open(path, encoding='utf-8').read().split('\n')
for name, data in (('CARBON_RUBRICS', C), ('SAMPLES', S)):
    pre = f'const {name} = '
    i = next(i for i, l in enumerate(lines) if l.startswith(pre))
    lines[i] = pre + json.dumps(data, ensure_ascii=False) + ';'
open(path, 'w', encoding='utf-8').write('\n'.join(lines))
print('applied', len(dec), 'decisions')
