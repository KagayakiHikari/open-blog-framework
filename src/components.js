import { escape as e } from './content.js';
import { iconShapes } from './icon-data.js';
import { designInput } from './design.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.js';
export const assetVersion=createHash('sha256').update(readFileSync(join(ROOT,'public','style.css'))).update(readFileSync(join(ROOT,'public','ui.js'))).digest('hex').slice(0,12);

export function icon(name, size=18) { return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconShapes[name]??iconShapes.spark}</svg>`; }
export const date = timestamp => new Date(timestamp).toISOString().slice(0,10).replaceAll('-','.');
export const dsgn = c => c.design ?? designInput();
export function tagLink(tag,count) { return `<a class="tag" href="/?${e(new URLSearchParams({tag}).toString())}">${icon('hash',12)}${e(tag)}${count!==undefined?`<span>${count}</span>`:''}</a>`; }
export function heading(eyebrow,title,description='') { return `<div class="page-heading"><span class="eyebrow">${e(eyebrow)}</span><h1>${e(title)}<span class="heading-dot">.</span></h1><p>${e(description)}</p></div>`; }
export function searchForm(query,tag='',action='/posts') { return `<form action="${e(action)}" method="get" class="search-form glass posts-search">${icon('search',21)}<input name="q" aria-label="搜索关键词" maxlength="120" value="${e(query)}" placeholder="搜索文章标题、摘要或正文…" autocomplete="off">${tag?`<input type="hidden" name="tag" value="${e(tag)}">`:''}<button class="button primary">搜索</button></form>`; }
export function postCard(post,index=0,tags=[]) { return `<article class="post-card glass"><a href="/posts/${post.slug}" class="post-cover cover-${index%4}" tabindex="-1" aria-hidden="true"><span class="cover-orbit"></span><span class="cover-art">${index%3===1?'<span class="code-art">&lt;/&gt;</span>':index%3===2?'<span class="type-art">Aa<small>WORDS & IDEAS</small></span>':icon('book',55)}</span><span class="cover-label">${e(tags[0]??'随手记录')}</span></a><div class="post-card-body"><div class="post-meta"><span>${icon('calendar',13)}${date(post.published_at)}</span><span>${icon('clock',13)}记录与分享</span></div><h3><a href="/posts/${post.slug}">${e(post.title)}</a></h3><p>${e(post.summary)}</p><div class="post-card-footer"><div class="tag-list">${tags.slice(0,2).map(t=>tagLink(t)).join('')}</div><a class="read-link" href="/posts/${post.slug}" aria-label="${e('阅读：'+post.title)}">${icon('arrow',19)}</a></div></div></article>`; }
export function galleryCard(post,kind,wallpaper,tags=[]) { if(!post)return '';return `<article class="gallery-article gallery-${kind}">${kind==='writing'?'':`<a class="gallery-cover" href="/posts/${post.slug}" tabindex="-1" aria-hidden="true"><img src="${e(kind==='feature'?wallpaper:`/theme/cover-${kind}.svg`)}" alt="" loading="lazy"></a>`}<div class="gallery-article-copy"><span class="gallery-category">${e(tags[0]??'随手记录')}</span><h3><a href="/posts/${post.slug}">${e(post.title)}</a></h3><p>${e(post.summary)}</p></div>${kind==='writing'?'<span class="gallery-type-art" aria-hidden="true">Aa</span>':''}</article>`; }
export function empty() { return `<div class="empty-state glass">${icon('book',34)}<h2>这里还没有文章</h2><p>一些新的故事，正在慢慢酝酿。</p><a class="text-link" href="/posts">查看文章 ${icon('right',14)}</a></div>`; }
