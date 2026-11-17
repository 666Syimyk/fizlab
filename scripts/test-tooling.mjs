import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';

const cases=[
  [undefined,false],['http://physics.school.edu/api',false],
  ['https://localhost/api',false],['https://127.0.0.1/api',false],['https://[::1]/api',false],
  ['https://user:password@physics.school.edu/api',false],
  ['https://physics.school.edu/api?token=secret',false],['https://physics.school.edu/api#fragment',false],
  ['https://physics.school.edu:invalid/api',false],['https://temporary.trycloudflare.com/api',false],
  ['https://your-domain.example/api',false],['https://example.com/api',false],
  ['https://physics.school.edu/api',true],['https://physics.school.edu/api/',true],
];
for(const [url,valid] of cases){
  const env={...process.env};
  if(url===undefined)delete env.VITE_API_URL;else env.VITE_API_URL=url;
  const result=spawnSync(process.execPath,['scripts/check-mobile-api.mjs'],{env,encoding:'utf8'});
  assert.equal(result.status===0,valid,`Mobile API validator: ${url}`);
}
// xcode uses UUID v4 only; protect the compatibility assumption behind its scoped security override.
const require=createRequire(import.meta.url);
const project=require('xcode').project('test.pbxproj');
project.hash={project:{objects:{}}};
const ids=Array.from({length:1000},()=>project.generateUuid());
assert.equal(new Set(ids).size,1000);
assert.ok(ids.every(id=>/^[A-F0-9]{24}$/.test(id)));
// Keep the browser renderer, imported CSS and content validator on one version.
const rendererRequire=createRequire(require.resolve('react-katex'));
assert.equal(rendererRequire('katex').version,require('katex').version,'react-katex must share the root KaTeX renderer/CSS version');
console.log(`PASS ${cases.length} mobile API boundaries, patched xcode UUID generation and aligned KaTeX runtime`);
