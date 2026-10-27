import { readFileSync, existsSync, lstatSync, statSync } from 'node:fs';
import { join } from 'node:path';

const defaults = {
  subtitle: '记录 / 技术 / 日常', heroTitle1: '把日常写成故事，', heroTitle2: '让灵感慢慢生长。',
  heroHighlight: '灵感', heroDescription: '记录微小的发现，也收藏生活的回响。\n这里是一个独立的示例博客，所有内容均为虚构。',
  primaryText: '开始阅读', caption: 'LOCAL DEMO · 独立演示资源', galleryTitle: '一些值得留下的瞬间',
  author: '示例作者', bio: '一个喜欢记录的写作者。\n分享技术笔记，也留住日常灵感。',
  noteTitle: '让文字，成为时间的回声。', noteText: '在这里慢慢记录，在下一次更新时再见。',
  footerText: '© {year} 示例小站', footerTagline: '保持好奇，继续记录。',
  logo: '/theme/logo.svg', favicon: '/theme/logo.svg', wallpaper: '/theme/wallpaper.svg', avatar: '/theme/avatar.svg',
  font: '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
  headingFont: '"Noto Serif SC", "Songti SC", "SimSun", serif', fontFile: '',
  accent: '#8170ba', darkAccent: '#c0afea', heroAccent: '#ffc2ac',
  nav: [{ label: '首页', href: '/#home-content' }, { label: '文章', href: '/posts' }, { label: '归档', href: '/archives' }, { label: '标签', href: '/tags' }, { label: '搜索', href: '/search' }]
};
const limits = { subtitle:120, heroTitle1:120, heroTitle2:120, heroHighlight:60, heroDescription:600, primaryText:40, caption:120, galleryTitle:120, author:80, bio:500, noteTitle:160, noteText:500, footerText:300, footerTagline:300 };
export function localHref(value) {
  if (typeof value !== 'string' || value.length > 300 || !value.startsWith('/') || /[\s\\\u0000-\u001f]|%0[ad]/i.test(value)) return false;
  try { return new URL(value, 'https://local.invalid').origin === 'https://local.invalid'; } catch { return false; }
}
export function themeAsset(value, font = false) {
  return typeof value === 'string' && (font ? /^\/theme\/[a-z0-9][a-z0-9-]*\.woff2$/ : /^\/theme\/[a-z0-9][a-z0-9-]*\.(?:svg|png|webp|jpg)$/).test(value);
}
export function designInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !Object.hasOwn(defaults,k))) throw new Error('Unknown design configuration');
  const result = {};
  for (const key of Object.keys(defaults)) {
    const value = input[key] ?? defaults[key];
    if (key in limits) { if (typeof value !== 'string' || value.length > limits[key] || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('Invalid design text'); }
    else if (['logo','favicon','wallpaper','avatar'].includes(key)) { if (!themeAsset(value)) throw new Error('Design images must be local theme assets'); }
    else if (key === 'fontFile') { if (value !== '' && !themeAsset(value,true)) throw new Error('Invalid local font'); }
    else if (['font','headingFont'].includes(key)) { if (typeof value !== 'string' || !/^[\p{L}\p{N}\s,"'-]{1,180}$/u.test(value)) throw new Error('Invalid font family'); }
    else if (['accent','darkAccent','heroAccent'].includes(key)) { if (typeof value !== 'string' || !/^#[a-f0-9]{6}$/i.test(value)) throw new Error('Invalid theme color'); }
    else if (key === 'nav') {
      if (!Array.isArray(value) || value.length > 7) throw new Error('Invalid navigation');
      result[key] = Object.freeze(value.map(item => {
        if (!item || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 30 || !localHref(item.href) || Object.keys(item).some(k=>!['label','href'].includes(k))) throw new Error('Invalid navigation item');
        return Object.freeze({ label:item.label, href:item.href });
      })); continue;
    }
    result[key] = value;
  }
  return Object.freeze(result);
}
export function loadDesign(root, filename) {
  const name = filename ?? 'design.json';
  if (!/^[a-zA-Z][a-zA-Z0-9-]*\.json$/.test(name) || ['package.json','package-lock.json'].includes(name)) throw new Error('Invalid design filename');
  const file = join(root,name);
  if (!existsSync(file)) { if (filename) throw new Error('Design file missing'); return designInput(); }
  if (lstatSync(file).isSymbolicLink() || !statSync(file).isFile() || statSync(file).size > 32768) throw new Error('Invalid design file');
  return designInput(JSON.parse(readFileSync(file,'utf8')));
}
export function themeCss(design) {
  // Only validated colors, font-family grammar and local resource paths reach CSS.
  const d = designInput(design);
  return `${d.fontFile ? `@font-face{font-family:BlogCustom;src:url("${d.fontFile}") format("woff2");font-display:swap;}` : ''}:root{--accent-light:${d.accent};--font-body:${d.fontFile?'BlogCustom,':''}${d.font};--font-heading:${d.headingFont};--accent:${d.accent};--hero-accent:${d.heroAccent};--accent-soft:color-mix(in srgb,${d.accent} 12%,transparent)}html[data-theme=dark]{--accent:${d.darkAccent};--accent-soft:color-mix(in srgb,${d.darkAccent} 14%,transparent)}`;
}
