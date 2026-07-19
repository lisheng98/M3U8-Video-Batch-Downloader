# Grab .m3u8 — bookmarklet backup

Backup copy of the **Grab .m3u8** bookmarklet. It reads the `.m3u8` stream link
out of a video page and copies it, to paste into `yt_dlp_web.py`
(the M3U8 downloader, port 8765, field **Link (.m3u8)**).

Useful for sites that block automated tools but load fine in your **own browser
with your VPN on** (e.g. keke1.app). It runs inside your normal browser — no
DevTools, no remote debugging — so sites that detect debugging can't block it.

## The bookmarklet code

```
javascript:(function(){var r=document.documentElement.innerHTML;var v=[r,r.replace(/\\\//g,'/')];try{v.push(decodeURIComponent(r))}catch(e){}var f={};v.forEach(function(t){var re=/https?:\/\/[^\x22\x27\s\\]+?\.m3u8[^\x22\x27\s\\]*/gi;var m;while(m=re.exec(t)){f[m[0]]=1}});var a=Object.keys(f);if(!a.length){alert('No .m3u8 found. Play or click the episode first, then click this again.');return}var b=a[0];var x=document.createElement('textarea');x.value=b;document.body.appendChild(x);x.select();try{document.execCommand('copy')}catch(e){}x.remove();window.prompt('Copied. Paste into the Link (.m3u8) box in yt_dlp_web.py:',b)})();
```

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
3. Click **Grab .m3u8** — it copies the link and shows it in a popup.
4. Paste into **Link (.m3u8)**, add a **Video name**, click **Start**.
