import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/config.js';
import { designInput,themeCss,localHref,themeAsset,loadDesign } from '../src/design.js';
import { layout,article,home } from '../src/views.js';
import { fixture } from './helpers.js';

test('design accepts configurable text, local assets, fonts, colors and menus',()=>{
  const d=designInput({author:'虚构作者',accent:'#224466',font:'Arial, sans-serif',nav:[{label:'文章',href:'/posts?q=hello'}]});
  assert.equal(d.author,'虚构作者');assert.ok(Object.isFrozen(d.nav));assert.match(themeCss(d),/--accent:#224466/);assert.equal(themeAsset('/theme/logo.svg'),true);assert.equal(themeAsset('/theme/local-font.woff2',true),true);
});
test('design rejects CSS injection, external resources and unsafe navigation',()=>{
  for(const input of [{accent:'red;display:none'},{font:'Arial; background:url(https://example.invalid)'},{wallpaper:'https://example.invalid/image.jpg'},{logo:'/media/anything.svg'},{favicon:'/theme/../private.svg'},{fontFile:'https://example.invalid/font.woff2'},{nav:[{label:'bad',href:'//attacker.invalid'}]},{nav:[{label:'bad',href:'javascript:alert(1)'}]},{unknown:true}])assert.throws(()=>designInput(input));
  for(const href of ['//attacker.invalid','/\\attacker.invalid','/a\nb','https://example.invalid'])assert.equal(localHref(href),false);
});
test('design files use explicit local filenames and fail closed',()=>{const f=fixture();try{writeFileSync(join(f.root,'appearance.json'),JSON.stringify({author:'示例二'}));assert.equal(loadDesign(f.root,'appearance.json').author,'示例二');assert.throws(()=>loadDesign(f.root,'../private.json'));assert.throws(()=>loadDesign(f.root,'package.json'));assert.throws(()=>loadDesign(f.root,'missing.json'));writeFileSync(join(f.root,'bad.json'),'{bad');assert.throws(()=>loadDesign(f.root,'bad.json'));}finally{f.dispose();}});
test('all theme aliases preserve existing paper/night configuration',()=>{assert.equal(config({BLOG_THEME:'paper'}).theme,'light');assert.equal(config({BLOG_THEME:'night'}).theme,'dark');assert.equal(config({BLOG_THEME:'system'}).theme,'system');});
test('configured identity and text are escaped and do not create inline scripts or styles',()=>{const c={...config(),title:'<img onerror=alert(1)>',design:designInput({heroTitle1:'<script>bad</script>',footerText:'<script>bad</script>',nav:[{label:'<svg onload=bad>',href:'/posts'}]})};const html=home(c,{posts:[],total:0,page:1,pages:1},'','',null);assert.doesNotMatch(html,/<script>bad|<svg onload|<img onerror| style=|<script(?! src=)/);assert.match(html,/&lt;script&gt;/);assert.match(html,/\/assets\/style\.css\?v=[a-f0-9]+/);});
test('reading TOC uses generated unique IDs and sanitized heading text',()=>{const c=config();const html=article(c,{title:'Synthetic',slug:'synthetic',content:'# <img src=x onerror=bad>Heading\n\n## Duplicate\n\n## Duplicate\n\n```js\nconsole.log(1)\n```',summary:'Synthetic',published_at:Date.now()},[],null);assert.match(html,/id="section-1"/);assert.match(html,/href="#section-3"/);assert.doesNotMatch(html,/<img[^>]*onerror/);assert.match(html,/class="copy-button"/);});
