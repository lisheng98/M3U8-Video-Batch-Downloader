# Grab .m3u8 — bookmarklet backup

Backup copy of the **Grab .m3u8** bookmarklet. It reads the `.m3u8` stream link
out of a video page and copies it, to paste into `yt_dlp_web.py`
(the M3U8 downloader, port 8765, field **Link (.m3u8)**).

Useful for sites that block automated tools but load fine in your **own browser
with your VPN on** (e.g. keke1.app). It runs inside your normal browser — no
DevTools, no remote debugging — so sites that detect debugging can't block it.

## The bookmarklet code (v6)

> On aggregator/index sites the panel may report **hundreds** of links — that's
> normal. The page embeds its *whole catalogue* (recommendations, other
> episodes) in its HTML, and the bookmarklet scans all of it. v6 solves this by
> splitting the results into **Playing now** (the stream your player actually
> requested — usually one or a few) and **Other videos found in page code** (the
> rest of the site's catalogue, collapsed).

```
javascript:(function(){var notes={frames:0,blocked:0,blob:0,armed:0};var f={},fn={};function add(u){if(!u)return;try{u=String(u)}catch(e){return}if(/\.m3u8/i.test(u))f[u]=1}function addnet(u){if(!u)return;try{u=String(u)}catch(e){return}if(/\.m3u8/i.test(u))fn[u]=1}function scan(t,base){if(!t||typeof t!=='string')return;var v=[t,t.replace(/\\\//g,'/'),t.replace(/\\u002[fF]/gi,'/')];try{v.push(decodeURIComponent(t))}catch(e){}v.forEach(function(s){var re=/https?:\/\/[^\x22\x27\s\\(),]+?\.m3u8[^\x22\x27\s\\(),]*/gi;var m;while(m=re.exec(s)){add(m[0])}var r2=/[\x22\x27]([^\x22\x27\s\\]{2,}?\.m3u8[^\x22\x27\s\\]*)[\x22\x27]/gi;var n;while(n=r2.exec(s)){try{add(new URL(n[1],base).href)}catch(e){}}})}function arm(w){if(w.__gm3){notes.armed++;return}var store={};try{Object.defineProperty(w,'__gm3',{value:store,writable:false,enumerable:false})}catch(e){try{w.__gm3=store}catch(e2){return}}var put=function(u){try{u=String(u);if(!/\.m3u8/i.test(u))return;store[new URL(u,w.location.href).href]=1}catch(e){}};try{var of=w.fetch;if(of){w.fetch=function(a){try{put(a&&a.url?a.url:a)}catch(e){}return of.apply(this,arguments)}}}catch(e){}try{var xp=w.XMLHttpRequest.prototype;var ox=xp.open;xp.open=function(m,u){try{put(u)}catch(e){}return ox.apply(this,arguments)}}catch(e){}try{w.performance.setResourceTimingBufferSize(5000)}catch(e){}notes.armed++}function doc(w){var d=w.document;var b=d.baseURI||w.location.href;try{Object.keys(w.__gm3||{}).forEach(addnet)}catch(e){}try{scan(d.documentElement.innerHTML,b)}catch(e){}try{Array.prototype.forEach.call(d.querySelectorAll('video,source,iframe,a,[src],[href],[data-src],[data-url],[data-video]'),function(el){['src','href','data-src','data-url','data-video'].forEach(function(k){scan(el.getAttribute(k)||'',b)});if(el.currentSrc){if(/^blob:/.test(el.currentSrc))notes.blob++;scan(el.currentSrc,b)}})}catch(e){}try{w.performance.getEntriesByType('resource').forEach(function(en){addnet(en.name)})}catch(e){}try{scan(JSON.stringify(w.localStorage),b)}catch(e){}try{scan(JSON.stringify(w.sessionStorage),b)}catch(e){}arm(w)}function walk(w){try{doc(w)}catch(e){notes.blocked++;return}var n=0;try{n=w.frames.length}catch(e){}notes.frames+=n;var i=0;for(i=0;i!==n;i++){try{walk(w.frames[i])}catch(e){notes.blocked++}}}walk(window);var srt=function(x,y){var s=function(u){return(/master|playlist|index/i.test(u)?0:1)};return s(x)-s(y)};var an=Object.keys(fn).sort(srt);var ap=Object.keys(f).filter(function(u){return !fn[u]}).sort(srt);if(!an.length&&!ap.length){alert('No .m3u8 yet - but the page is now ARMED.\n\nEvery .m3u8 the page requests from now on is recorded.\n\nDo this: press Play (or click the episode), let it run 2-3 seconds, then click Grab .m3u8 again. It should appear.\n\nScanned: page HTML, '+notes.armed+' readable frame(s), network log, storage.\niframes seen: '+notes.frames+' | unreadable (cross-origin): '+notes.blocked+' | blob/MSE video: '+notes.blob+(notes.blocked?'\n\nHeads up: an iframe here is cross-origin and cannot be read. If the player is in it, right-click the video, choose Open frame in new tab, then click this there.':''));return}if(!document.body){window.prompt('Paste into Link (.m3u8):',(an[0]||ap[0]));return}function mk(t,s){var e=document.createElement(t);if(s)e.setAttribute('style','box-sizing:border-box;'+s);return e}try{if(window.__gm3close)window.__gm3close()}catch(e){}var old=document.getElementById('grabm3u8box');if(old)old.remove();var box=mk('div','position:fixed;z-index:2147483647;top:12px;right:12px;width:620px;max-width:94vw;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;background:#15171c;color:#e8eaed;font:13px/1.45 -apple-system,system-ui,sans-serif;border:1px solid #3a3f4b;border-radius:10px;box-shadow:0 10px 34px rgba(0,0,0,.55)');box.id='grabm3u8box';var close=function(){try{box.remove()}catch(e){}try{document.removeEventListener('keydown',onkey,true);document.removeEventListener('mousedown',onout,true)}catch(e){}if(window.__gm3close===close)window.__gm3close=null};var onkey=function(e){if(e.key==='Escape'||e.keyCode===27){e.preventDefault();e.stopPropagation();close()}};var onout=function(e){if(!box.contains(e.target))close()};window.__gm3close=close;document.addEventListener('keydown',onkey,true);document.addEventListener('mousedown',onout,true);var hd=mk('div','position:relative;flex:none;padding:14px 46px 10px 14px;border-bottom:1px solid #262a33');var h=mk('div','font-weight:600;margin-bottom:2px');h.textContent='Grab .m3u8 - '+an.length+' playing / '+ap.length+' other';hd.appendChild(h);var sub=mk('div','font-size:11px;color:#9aa0a6');sub.textContent='Copy one, paste into Link (.m3u8) in yt_dlp_web.py';hd.appendChild(sub);var cl=mk('button','position:absolute;top:10px;right:10px;width:28px;height:28px;line-height:26px;text-align:center;padding:0;background:transparent;color:#9aa0a6;border:1px solid #3a3f4b;border-radius:6px;cursor:pointer;font-size:17px');cl.innerHTML='&times;';cl.title='Close (Esc)';cl.onclick=close;hd.appendChild(cl);box.appendChild(hd);var ct=mk('div','flex:1 1 auto;overflow:auto;padding:12px 14px 14px');function row(u){var rw=mk('div','margin-bottom:9px');var q=u.match(/(\d{3,4})p/);var lab=mk('div','font-size:11px;color:#9aa0a6;margin-bottom:3px');lab.textContent=(/master|playlist|index/i.test(u)&&!q?'master - all qualities (recommended)':(q?q[1]+'p - single quality':'variant'));rw.appendChild(lab);var fl=mk('div','display:flex;gap:6px;align-items:center');var inp=mk('input','flex:1;min-width:0;background:#0e1013;color:#e8eaed;border:1px solid #3a3f4b;border-radius:6px;padding:7px 8px;font:12px/1.3 ui-monospace,SFMono-Regular,monospace');inp.value=u;inp.readOnly=true;inp.onclick=function(){inp.select()};var bs='box-sizing:border-box;flex:none;color:#fff;border:0;border-radius:6px;padding:7px 14px;cursor:pointer;font-weight:600;font-size:12px;background:';var btn=document.createElement('button');function setb(t,c){btn.textContent=t;btn.setAttribute('style',bs+c)}setb('Copy','#3b82f6');btn.onclick=function(){inp.focus();inp.select();inp.setSelectionRange(0,u.length);var done=function(ok){setb(ok?'Copied':'Cmd+C now',ok?'#22a06b':'#b45309');setTimeout(function(){setb('Copy','#3b82f6')},ok?1400:3000)};var ok=false;try{ok=document.execCommand('copy')}catch(e){}if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(u).then(function(){done(true)},function(){done(ok)})}else{done(ok)}};fl.appendChild(inp);fl.appendChild(btn);rw.appendChild(fl);return rw}var s1=mk('div','font-size:11px;font-weight:700;color:#dfe6ee;margin:0 0 8px;padding:5px 9px;background:#16283a;border:1px solid #26496b;border-radius:6px');s1.textContent='▶ Playing now - requested over the network ('+an.length+')';ct.appendChild(s1);if(an.length){an.forEach(function(u){ct.appendChild(row(u))})}else{var hint=mk('div','font-size:12px;color:#9aa0a6;margin:0 0 14px;padding:2px');hint.textContent='Nothing requested yet. Press Play, let it run 2-3s, then click Grab .m3u8 again - the real stream shows up here.';ct.appendChild(hint)}if(ap.length){var wrap=mk('div','display:none;margin-top:2px');var s2=mk('button','width:100%;text-align:left;font:inherit;font-size:11px;font-weight:600;color:#9aa0a6;margin:8px 0 0;padding:6px 9px;background:#191b21;border:1px solid #2c313c;border-radius:6px;cursor:pointer');function upd(){s2.textContent=(wrap.style.display==='none'?'▸':'▾')+' Other videos found in page code ('+ap.length+') - click to '+(wrap.style.display==='none'?'show':'hide')}upd();s2.onclick=function(){wrap.style.display=(wrap.style.display==='none'?'block':'none');upd()};ct.appendChild(s2);ap.forEach(function(u){wrap.appendChild(row(u))});ct.appendChild(wrap)}box.appendChild(ct);document.body.appendChild(box)})();
```

### Two clicks, and why

If it finds nothing on the first click, **it does not just give up — it arms the
page.** It wraps `fetch` and `XMLHttpRequest.open` so every `.m3u8` the page
requests from that moment on is recorded. So the routine is:

1. Click **Grab .m3u8** → *"No .m3u8 yet - but the page is now ARMED."*
2. Press **Play**, let it run 2-3 seconds.
3. Click **Grab .m3u8** again → the link appears.

On a page that already exposes the link, the first click just shows it and step
2-3 are unnecessary.

### What it shows

Instead of a native popup (which only lets you copy the one pre-filled value),
it draws a small panel in the top-right of the page with **one row per link**,
each labelled (`master - all qualities`, `720p - single quality`, …) and each
with its own **Copy** button. Click the button for the one you want; the button
turns green and says *Copied*. If the browser blocks the clipboard write, it
turns amber and says *Cmd+C now* — the URL is already selected, so just press
⌘C. The **×** button is pinned to the panel's top-right corner (it stays put
even when the list is long enough to scroll), and pressing **Esc** or clicking
anywhere outside the panel also dismisses it.

The rows are split into two groups. **Playing now** (top, highlighted) holds only
the `.m3u8`s the page *actually requested over the network* — i.e. the stream
your player is loading. That's almost always the one you want, and it's usually
just one or a few rows. Below it, **Other videos found in page code** is a
collapsed section (click to expand) holding everything that was only *mentioned*
in the page's HTML/JSON — on an aggregator that's the site's whole catalogue,
which is why it can run to hundreds. If **Playing now** is empty, nothing has
streamed yet: press **Play**, wait 2-3 seconds, and click **Grab .m3u8** again —
the real link will drop into that top group.

### Why "No .m3u8 found" happens even when DevTools shows plenty

Each version fixed a different blind spot:

- **v1 searched only the top page's HTML.** That misses the player being in an
  **iframe**, the URL never entering the DOM at all (hls.js just `fetch()`es it),
  and URLs **assembled from pieces** (`base + id + '.m3u8'`) or relative
  (`/hls/x/index.m3u8`).
- **v2 added `performance.getEntriesByType('resource')`** — the browser's own
  record of every request — plus iframe walking, relative-path resolution,
  storage, and `\/` un-escaping.
- **v3** replaced the single-value prompt with the multi-link panel.
- **v4 stopped trusting the performance log.** On a heavy SPA (x.com is the case
  that exposed this) that log is a **ring buffer of ~250 entries** — by the time
  you click, the video's requests have been pushed out and are gone, even though
  DevTools still lists them. Hooking `fetch`/`XHR` records them as they happen,
  so nothing can age out. v4 also raises the buffer to 5000 as a belt-and-braces
  measure, and arms every readable iframe, not just the top page.
- **v5 is a UI fix, not a detection fix.** The close control became a fixed **×**
  in the panel's top-right corner so it's reachable without scrolling to the
  bottom of a long list, and the panel now also closes on **Esc** or a click
  outside it (a header/body split keeps the × out of the scroll area).
- **v6 splits results by source, to cut catalogue noise.** On aggregator/index
  sites the page bakes its entire catalogue of `.m3u8`s into the HTML, so the
  panel was showing 150+ links for a single video. v6 tracks *how* each link was
  seen: ones the page **requested over the network** (the `fetch`/XHR hook and
  the performance resource log) go into a **Playing now** group — that's your
  actual stream — while ones merely **scraped from the HTML/JSON/storage** go
  into a collapsed **Other videos found in page code** group. The one you want is
  now a short list at the top instead of buried in the catalogue.

Remaining hard case: the player is in a **cross-origin iframe** (the popup tells
you when it saw one). The browser blocks all reading and hooking there.
Right-click the video → **Open frame in new tab**, then click the bookmarklet on
that tab.

## How to reinstall it (if you lose the bookmark)

**Easiest — add a bookmark by hand:**
1. In your browser, add any bookmark (e.g. bookmark this page, or right-click the
   bookmarks bar → Add page/bookmark).
2. Edit that bookmark, set its **Name** to `Grab .m3u8`, and replace its **URL**
   with the entire `javascript:...` line above (copy it as one line).
3. Save. Click it on any video page to use.

**Or rebuild the draggable installer:** make a file `bookmarklet.html` with a
link whose `href` is the code above:
`<a href="PASTE_CODE_HERE">Grab .m3u8</a>`, open it, and drag the link to your
bookmarks bar.

## How to use

1. Start the downloader: `python3 yt_dlp_web.py --open-browser` → http://127.0.0.1:8765
2. Open the video page in your normal browser (VPN on); pick the quality/line.
3. Click **Grab .m3u8**. If it says *ARMED*, or if **Playing now** is empty,
   press **Play**, wait 2-3 seconds, and click **Grab .m3u8** again.
4. Take a row from the **Playing now** group (that's your actual stream). Click
   **Copy**, paste into **Link (.m3u8)**, add a **Video name**, click **Start**.
   Ignore the collapsed **Other videos** group unless the one you want isn't in
   **Playing now** — then expand it and search there.

The arming lasts until you reload the page. After a reload you start over at
step 3 (one click to arm, one to collect).

Which row to pick: work within the **Playing now** group first. There, the
**master** row (a `master`/`playlist`/`index` URL, listed first) contains all the
qualities and lets yt-dlp choose the best — take that one by default. The
`720p`-style rows are single-quality variants; pick one of those to force a
specific resolution or when the master fails. Only fall back to the **Other
videos found in page code** group if **Playing now** never populates (e.g. a
cross-origin player the hook can't see) — that group is the site's catalogue, so
you'll need to know your video's stream URL to spot it there.
