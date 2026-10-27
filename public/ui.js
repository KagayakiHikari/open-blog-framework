(() => {
  const root=document.documentElement,system=matchMedia('(prefers-color-scheme: dark)'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  root.dataset.interactive='true';
  let preference=root.dataset.defaultTheme;
  try{const saved=localStorage.getItem('framework-theme');if(['light','dark','system'].includes(saved))preference=saved;}catch{}
  const apply=()=>{root.dataset.theme=preference==='system'?(system.matches?'dark':'light'):preference;document.querySelectorAll('.theme-toggle').forEach(button=>{button.setAttribute('aria-pressed',String(root.dataset.theme==='dark'));button.setAttribute('aria-label',root.dataset.theme==='dark'?'切换浅色主题':'切换深色主题');});};
  apply();system.addEventListener('change',apply);
  document.querySelectorAll('.theme-toggle').forEach(button=>button.addEventListener('click',()=>{preference=root.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem('framework-theme',preference);}catch{}apply();}));
  const menu=document.getElementById('mobile-menu'),nav=document.getElementById('main-nav');
  const closeMenu=(focus=false)=>{nav?.classList.remove('open');menu?.setAttribute('aria-expanded','false');menu?.setAttribute('aria-label','打开菜单');if(focus)menu?.focus();};
  menu?.addEventListener('click',()=>{const open=!nav.classList.contains('open');nav.classList.toggle('open',open);menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'关闭菜单':'打开菜单');});
  nav?.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>closeMenu()));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&nav?.classList.contains('open'))closeMenu(true);});
  document.addEventListener('pointerdown',event=>{if(nav?.classList.contains('open')&&!event.target.closest('.site-header'))closeMenu();});
  matchMedia('(min-width:801px)').addEventListener('change',event=>{if(event.matches)closeMenu();});
  const home=document.querySelector('.home-experience'),header=document.getElementById('site-header');
  if(home){
    let frame=0,released=false,previous=0,entering=false,timer;
    const top=()=>scrollY+home.getBoundingClientRect().top;
    const snap=value=>{home.classList.add('is-snapping');clearTimeout(timer);timer=setTimeout(()=>home.classList.remove('is-snapping'),750);scrollTo({top:value,behavior:reduced.matches?'instant':'smooth'});};
    const update=()=>{
      frame=0;const height=innerHeight,progress=Math.max(0,Math.min(1,-home.getBoundingClientRect().top/height));
      if(!released&&progress>previous&&progress>=.5){released=true;if(!reduced.matches&&!entering&&progress<.98)snap(top()+height);}
      else if(released&&progress<previous&&progress<=.7){released=false;entering=false;if(!reduced.matches&&progress>.02)snap(top());}
      if(progress<=.02)entering=false;
      const curve=reduced.matches?progress:released?(progress>.5?1-.06*Math.pow((1-progress)/.5,3):.94*Math.pow(progress/.5,3)):(progress<.5?.06*Math.pow(progress/.5,3):.06+.94*(1-Math.pow(1-(progress-.5)*2,3)));
      previous=progress;home.style.setProperty('--entry',String(curve));home.style.setProperty('--travel',height+'px');
      const cover=home.querySelector('.fullscreen-cover'),arrival=home.querySelector('.home-arrival');
      cover.inert=progress>=.9;arrival.inert=progress<.8;
      const hidden=progress<.8;header?.classList.toggle('intro-hidden',hidden);if(header)header.inert=hidden;
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
    addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule);reduced.addEventListener('change',schedule);
    document.querySelectorAll('a[href="#home-content"]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();entering=true;released=true;history.replaceState(null,'','#home-content');snap(top()+innerHeight);document.getElementById('home-content').focus({preventScroll:true});}));
    const visitHash=()=>{if(location.hash==='#home-content'){entering=true;released=true;scrollTo({top:top()+innerHeight,behavior:'instant'});}schedule();};
    addEventListener('hashchange',visitHash);visitHash();update();
    // The skip link must make main content reachable without traversing the cover.
    document.querySelector('.skip-link')?.addEventListener('click',()=>{entering=true;released=true;scrollTo({top:top()+innerHeight,behavior:'instant'});update();});
  }
  document.querySelectorAll('.copy-button').forEach(button=>button.addEventListener('click',async()=>{const code=button.parentElement.querySelector('code')?.textContent??'';try{await navigator.clipboard.writeText(code);button.textContent='已复制';}catch{button.textContent='复制失败，请手动选择';}setTimeout(()=>{button.textContent='复制';},1800);}));
  const headings=[...document.querySelectorAll('.prose h1[id],.prose h2[id],.prose h3[id]')];
  const years=[...document.querySelectorAll('.archive-year')],archiveToggle=document.querySelector('.archive-toggle');
  if(archiveToggle&&years.length){
    archiveToggle.hidden=false;
    archiveToggle.setAttribute('aria-controls',years.map(year=>year.id).join(' '));
    const updateArchive=()=>{const expanded=years.every(year=>year.open);archiveToggle.textContent=expanded?'收起年份':'展开年份';archiveToggle.setAttribute('aria-expanded',String(expanded));};
    archiveToggle.addEventListener('click',()=>{const expanded=years.every(year=>year.open);years.forEach(year=>{year.open=!expanded;});updateArchive();});
    years.forEach(year=>year.addEventListener('toggle',updateArchive));updateArchive();
  }
  if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){document.querySelectorAll('.toc a').forEach(a=>{if(a.getAttribute('href')==='#'+entry.target.id)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});}},{rootMargin:'-110px 0px -60% 0px'});headings.forEach(h=>observer.observe(h));}
})();
