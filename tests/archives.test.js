import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { publicArchives, savePost } from '../src/content.js';
import { archivesView } from '../src/views.js';
import { fixture, account, sample, removeTestRoot } from './helpers.js';

test('archive data groups only visible publications, validates input and bounds pages',async()=>{
  const f=fixture();
  try{
    const user=await account(f.db),now=Date.parse('2026-01-01T00:00:00Z');
    for(let i=0;i<35;i++)savePost(f.db,sample({slug:`archive-${i}`,status:'published',publishedAt:'2024-06-01T00:00:00Z'}),user);
    savePost(f.db,sample({slug:'boundary',status:'published',publishedAt:'2024-01-01T00:30:00+01:00'}),user);
    savePost(f.db,sample({slug:'old',status:'published',publishedAt:'2023-01-01T00:00:00Z'}),user);
    savePost(f.db,sample({slug:'draft-secret',publishedAt:'2022-01-01T00:00:00Z'}),user);
    savePost(f.db,sample({slug:'scheduled-secret',status:'published',publishedAt:'2030-01-01T00:00:00Z'}),user);
    const all=publicArchives(f.db,{},now),second=publicArchives(f.db,{page:2},now);
    assert.equal(all.total,37);assert.equal(all.posts.length,30);assert.equal(second.posts.length,7);
    assert.deepEqual(all.years,[{year:2024,n:35},{year:2023,n:2}]);
    assert.equal(new Set([...all.posts,...second.posts].map(p=>p.slug)).size,37);
    const tied=all.posts.map(p=>p.slug);
    assert.deepEqual(publicArchives(f.db,{},now).posts.map(p=>p.slug),tied);
    assert.equal(publicArchives(f.db,{year:'2023'},now).posts.length,2);
    assert.equal(publicArchives(f.db,{year:'2025'},now).total,0);
    for(const year of ['2024 OR 1=1','2024<script>','1969','02024','10000','NaN',[],2024])assert.throws(()=>publicArchives(f.db,{year},now),error=>error.status===400);
    for(const page of [0,-1,1.1,10001,'1 OR 1=1',Infinity])assert.throws(()=>publicArchives(f.db,{page},now),error=>error.status===400);
    assert.equal(publicArchives(f.db,{page:10000},now).posts.length,0);
  }finally{f.dispose();}
});

test('archive templates escape content, preserve native interaction and safe pagination',()=>{
  const result={posts:[{title:'<script>unsafe-title</script>',slug:'bad"<svg>',summary:'<img src=x onerror=unsafe>',published_at:Date.parse('2024-01-01T00:00:00Z')}],years:[{year:2024,n:31}],year:'2024',total:31,allTotal:31,page:1,pages:2};
  const html=archivesView(config(),result,null);
  assert.match(html,/&lt;script&gt;unsafe-title/);assert.doesNotMatch(html,/<script>unsafe|<img src=x|onerror="/);
  assert.match(html,/href="\/posts\/bad%22%3Csvg%3E"/);
  assert.match(html,/<details class="archive-year glass"[^>]* open>/);
  assert.match(html,/<summary><h2>2024/);assert.match(html,/<time datetime="2024-01-01T00:00:00.000Z">01.01/);
  assert.match(html,/href="\/archives\?year=2024&amp;page=2"/);
  assert.match(html,/<select id="archive-year" name="year">/);
  assert.match(html,/archive-toggle" type="button" hidden/);
  assert.doesNotMatch(html,/ style=| onclick=|<script(?! src=)/);
});

test('isolated archives HTTP route keeps publication, method and security boundaries',async t=>{
  const f=fixture(),c={...config({BLOG_MODE:'test'},f.root)};f.db.close();let app;
  try{
    app=await createApp(c,{logger:()=>{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));c.origin=`http://127.0.0.1:${app.server.address().port}`;
    const request=(path,options={})=>fetch(c.origin+path,{redirect:'manual',...options});
    await t.test('empty state and HEAD render without authentication',async()=>{
      const r=await request('/archives');assert.equal(r.status,200);assert.match(await r.text(),/这一页还没有记录/);
      const h=await request('/archives',{method:'HEAD'});assert.equal(h.status,200);assert.equal(await h.text(),'');
    });
    const user=await account(app.db);
    for(let i=0;i<31;i++)savePost(app.db,sample({slug:`public-archive-${i}`,title:`公开记录 ${i}`,status:'published',publishedAt:'2024-03-01T00:00:00Z'}),user);
    savePost(app.db,sample({slug:'private-draft',title:'PRIVATE_DRAFT_TITLE'}),user);
    savePost(app.db,sample({slug:'private-future',title:'PRIVATE_FUTURE_TITLE',status:'published',publishedAt:'2035-01-01T00:00:00Z'}),user);
    await t.test('years and pagination never reveal drafts or scheduled titles',async()=>{
      const r=await request('/archives?year=2024'),html=await r.text();assert.equal(r.status,200);assert.match(html,/31 篇公开记录/);assert.equal((html.match(/class="archive-dot"/g)??[]).length,30);
      assert.doesNotMatch(html,/PRIVATE_DRAFT_TITLE|PRIVATE_FUTURE_TITLE|2035 年/);
      const second=await request('/archives?year=2024&page=2');assert.equal((await second.text()).match(/class="archive-dot"/g).length,1);
      assert.match(await (await request('/archives?year=2020')).text(),/2020 年（暂无文章）/);
    });
    await t.test('malformed filters rejected without SQL or HTML injection',async()=>{
      for(const path of ['/archives?year=2024%27%20OR%201=1','/archives?year=%3Cscript%3E','/archives?page=-1','/archives?page=10001'])assert.equal((await request(path)).status,400,path);
      assert.equal(app.db.prepare('SELECT count(*) n FROM posts').get().n,33);
    });
    await t.test('new route keeps headers, rejects mutation and protected APIs',async()=>{
      const r=await request('/archives');assert.match(r.headers.get('Content-Security-Policy'),/script-src 'self'/);assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(r.headers.get('Cache-Control'),'no-store');
      for(const method of ['POST','PUT','DELETE'])assert.notEqual((await request('/archives',{method})).status,200);
      assert.equal((await request('/api/posts')).status,401);
      const link=app.db.prepare("SELECT slug FROM posts WHERE status='published' AND published_at<? LIMIT 1").get(Date.now()).slug;assert.equal((await request('/posts/'+link)).status,200);
    });
  }finally{if(app)await app.close();removeTestRoot(f.root,'open-blog-test-');}
});
