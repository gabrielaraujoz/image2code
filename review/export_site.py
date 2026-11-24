"""Build review/export-site/image2code/ (+ .zip): the page with only the files it uses, no external links to the repo."""
import os, re, shutil
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'review', 'export-site')
SITE = os.path.join(OUT_DIR, 'image2code')

shutil.rmtree(OUT_DIR, ignore_errors=True)
os.makedirs(SITE)
for f in ('index.html', 'licenses.csv'):
    shutil.copy2(os.path.join(ROOT, f), SITE)
for d in ('css', 'fonts', 'img'):
    shutil.copytree(os.path.join(ROOT, d), os.path.join(SITE, d))
for s in ('moraine', 'bamboo', 'lighthouse'):
    os.makedirs(os.path.join(SITE, 'samples', s))
    shutil.copy2(os.path.join(ROOT, 'samples', s, 'model.html'), os.path.join(SITE, 'samples', s))
    shutil.copytree(os.path.join(ROOT, 'samples', s, 'redesign'), os.path.join(SITE, 'samples', s, 'redesign'))

p = os.path.join(SITE, 'index.html')
html = open(p, encoding='utf-8').read()
old_btn = re.search(r'  <a class="dl" href="https://github\.com/[^"]+">.*?<span>Download samples</span></a>', html).group(0)
new_btn = ('  <a class="dl" id="open-sample" target="_blank" rel="noopener" style="display:none">'
           '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
           '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>'
           '<span>Open sample in new window</span></a>')
html = html.replace(old_btn, new_btn)
hook = "  if (s) renderSample(s); else if (id === 'carbon') renderCarbon(); else renderOverview();"
assert html.count(hook) == 1
html = html.replace(hook, "  const open = document.getElementById('open-sample');\n"
                          "  if (s) { open.href = s.redesign; open.style.display = ''; } else open.style.display = 'none';\n" + hook)
assert 'willsertorio' not in html
open(p, 'w', encoding='utf-8').write(html)

for dirpath, _, files in os.walk(SITE):
    for f in files:
        if f == '.DS_Store':
            os.remove(os.path.join(dirpath, f))
shutil.make_archive(SITE, 'zip', OUT_DIR, 'image2code')
print(SITE + '.zip')
