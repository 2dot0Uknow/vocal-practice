#!/bin/sh
# One-off: how fonts/inter.woff2 and fonts/nunito.woff2 were made. The woff2 files are committed; nothing in the app or its deploy runs this.
# Needs git, python3 with fontTools (pyftsubset) and brotli. Sources (both SIL OFL 1.1):
#   Inter   https://github.com/rsms/inter        docs/font-files/InterVariable.ttf   (commit 353b61b)
#   Nunito  https://github.com/googlefonts/nunito fonts/variable/Nunito[wght].ttf     (commit 8c6a9bb)
# Usage: tools/make-fonts.sh <Inter checkout> <Nunito checkout> <output folder>
set -e
INTER="$1"; NUNITO="$2"; OUT="$3"
mkdir -p "$OUT"
# Keep only the weights the app uses: Inter 400-600 (bold text is 600, as it was with Google Fonts), Nunito 700-800.
python3 - "$INTER" "$NUNITO" "$OUT" <<'PY'
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
inter, nunito, out = sys.argv[1:4]
instancer.instantiateVariableFont(TTFont(inter + '/docs/font-files/InterVariable.ttf'), {'opsz': 14, 'wght': (400, 600)}).save(out + '/inter-lim.ttf')
instancer.instantiateVariableFont(TTFont(nunito + '/fonts/variable/Nunito[wght].ttf'), {'wght': (700, 800)}).save(out + '/nunito-lim.ttf')
PY
# Latin + the punctuation, arrows and symbols the app's text uses.
UNICODES="U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+2013-2014,U+2018-201A,U+201C-201E,U+2022,U+2026,U+2039-203A,U+20AC,U+2122,U+2190-2193,U+2212,U+2713,U+266D,U+266F,U+25B6"
for name in inter nunito; do
  pyftsubset "$OUT/$name-lim.ttf" --unicodes="$UNICODES" --flavor=woff2 --layout-features='kern,liga,calt,ccmp,locl,mark,mkmk' --no-hinting --desubroutinize --output-file="$OUT/$name.woff2"
done
ls -l "$OUT"/*.woff2
