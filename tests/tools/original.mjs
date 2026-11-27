// Loads the pure logic of the ORIGINAL single-file app (git commit 2aaf0bd) so the
// expected values in the characterization tests can be generated from the real
// pre-refactor code. Not used by `node --test`.
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

export const BASELINE_COMMIT = '2aaf0bd';

export function loadOriginalSource(repoRoot) {
  const html = execFileSync('git', ['show', `${BASELINE_COMMIT}:index.html`], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 26 });
  const start = html.indexOf('<script>\n{') + '<script>\n{'.length;
  const end = html.lastIndexOf('}\n</script>');
  return html.slice(start, end);
}

function between(source, from, to) {
  const a = source.indexOf(from);
  const b = source.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`markers not found: ${from} .. ${to}`);
  return source.slice(a, b);
}

/** A DOM stand-in: remembers every property that report() writes. */
function fakeDom() {
  const nodes = {};
  const $ = (id) => (nodes[id] ??= { id, style: {}, dataset: {}, hidden: false, textContent: '', innerHTML: '', value: '' });
  return { $, nodes };
}

export function loadOriginal(repoRoot) {
  const source = loadOriginalSource(repoRoot);
  const storage = new Map();
  const localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
  };
  const dom = fakeDom();
  const sandbox = { localStorage, $: dom.$, Math, Date, JSON, Float32Array, Set, Object, Array, String, Number, parseFloat, isNaN, RegExp };
  const pure = between(source, 'const NOTE=', '/* ---------- photo');
  const trill = between(source, 'const TRILL=', 'function audio()');
  const detect = between(source, 'function detect', 'function spectral');
  const session = between(source, 'const CUE_GAP', 'const vt=f=>f.t-VL;') + 'const vt=f=>f.t-VL;\n';
  const scoring = between(source, 'const med=', '$(\'againBtn\')').replace(/\$\('againBtn'\)[\s\S]*$/, '');
  const code = `
    let seq=null, frames=[], queue=[], shown=3;
    const navTo=()=>{};
    ${pure}
    ${trill}
    ${detect}
    ${session}
    ${scoring}
    return {
      nm, toMidi, hz, fToM, esc, parsePat, rootsOf, parseLine, parseAll, normEx, detect, err, strictAt, estimateLag,
      scoreNotes, build, isTrill, med, mean, sd, report, desc: null, getExs: () => exs,
      setSeq(s){ seq = s; }, setFrames(f){ frames = f; }, setQueue(q){ queue = q; },
      setVL(v){ VL = v; }, getVL(){ return VL; }, setDefR(r){ defR = r; }, getDefR(){ return defR; },
    };`;
  const factory = vm.runInNewContext(`(function(){ ${code} })`, sandbox);
  return { api: factory(), dom, storage };
}
