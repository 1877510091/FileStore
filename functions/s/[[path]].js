/**
 * 分享落地页 /s/:token  或  /s/:token=提取码
 * 纯静态 HTML，数据由公开接口 /api/share/:token 提供
 */
export async function onRequest(context) {
    return new Response(PAGE, {
        headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
        },
    });
}

const PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>文件分享 · FileStore</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23A78BFA' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z'/%3E%3C/svg%3E">
<style>
:root{--bg0:#15131f;--surface:rgba(42,36,64,.72);--surface-hi:rgba(54,46,82,.92);--border:#3a2f55;--text:#ECE9FB;--text2:#B8A6F0;--text3:#8A82B8;--accent:#F472B6;--grad:linear-gradient(90deg,#A78BFA,#F472B6);--input-bg:rgba(54,47,80,.65);--btn-bg:rgba(58,50,86,.72);--green:#34C759;--red:#EE5A6F;--radius:12px}
[data-theme="light"]{--bg0:#FFF0F5;--surface:rgba(255,255,255,.75);--surface-hi:rgba(255,255,255,.94);--border:#F3DCE9;--text:#1E1B4B;--text2:#6366F1;--text3:#A5A8D8;--accent:#EC4899;--grad:linear-gradient(90deg,#8B5CF6,#EC4899);--input-bg:rgba(255,255,255,.7);--btn-bg:rgba(255,255,255,.65)}
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;font-family:"Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",sans-serif;background:var(--bg0);color:var(--text);transition:background .3s,color .3s}
body::before{content:"";position:fixed;inset:0;background:radial-gradient(ellipse at 20% 20%,rgba(167,139,250,.18) 0%,transparent 50%),radial-gradient(ellipse at 80% 80%,rgba(244,114,182,.15) 0%,transparent 50%);pointer-events:none}
.card{position:relative;width:400px;max-width:100%;padding:36px 32px;text-align:center;background:var(--surface);backdrop-filter:blur(12px);border:1px solid var(--border);border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.25);animation:in .35s ease}
@keyframes in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
.logo{width:64px;height:64px;margin:0 auto 16px;border-radius:50%;background:var(--grad);display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 8px 28px rgba(167,139,250,.32)}
.logo svg{width:32px;height:32px}
h1{font-size:19px;font-weight:700;margin-bottom:6px}
.sub{font-size:12px;color:var(--text3);margin-bottom:22px}
.fbox{display:flex;align-items:center;gap:12px;padding:14px;border:1px solid var(--border);border-radius:var(--radius);background:var(--input-bg);text-align:left;margin-bottom:16px}
.ficon{width:44px;height:44px;border-radius:10px;background:var(--grad);display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0}
.ficon svg{width:22px;height:22px}
.fname{font-size:14px;font-weight:600;word-break:break-all;line-height:1.4}
.fmeta{font-size:12px;color:var(--text3);margin-top:3px}
input{width:100%;padding:11px 14px;border:1px solid var(--border);border-radius:var(--radius);background:var(--input-bg);color:var(--text);font-size:15px;text-align:center;letter-spacing:4px;outline:none;margin-bottom:12px;font-family:inherit}
input:focus{border-color:var(--accent)}
.btn{width:100%;padding:12px;border:none;border-radius:var(--radius);background:var(--grad);color:#fff;font-size:15px;font-weight:600;cursor:pointer;transition:all .2s;font-family:inherit}
.btn:hover{opacity:.92;transform:translateY(-1px)}
.btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
.err{color:var(--red);font-size:12.5px;min-height:18px;margin-top:10px}
.tip{font-size:11.5px;color:var(--text3);margin-top:16px;padding-top:14px;border-top:1px solid var(--border);line-height:1.7}
.spin{width:26px;height:26px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:sp .8s linear infinite;margin:22px auto}
@keyframes sp{to{transform:rotate(360deg)}}
.theme{position:fixed;top:16px;right:16px;width:38px;height:38px;border-radius:50%;border:1px solid var(--border);background:var(--btn-bg);color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s}
.theme:hover{transform:rotate(30deg);color:var(--accent)}
.stats{display:flex;gap:14px;justify-content:center;font-size:11.5px;color:var(--text3);margin-top:12px}
.stats b{color:var(--text2);font-weight:600}
</style>
</head>
<body>
<button class="theme" id="th" title="切换主题"></button>
<div class="card">
  <div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg></div>
  <h1 id="title">文件分享</h1>
  <div class="sub" id="sub">正在读取分享信息…</div>
  <div id="body"><div class="spin"></div></div>
  <div class="err" id="err"></div>
  <div class="tip">由 FileStore 自建网盘分享 · 通过浏览器下载</div>
</div>
<script>
const CLOUD='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>';
const FILE='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
const LOCK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
const SUN='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
const MOON='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const raw=decodeURIComponent(location.pathname.replace(/^\\/s\\//,''));
const eq=raw.indexOf('=');
const T=eq>=0?raw.slice(0,eq):raw;
const PRE=eq>=0?raw.slice(eq+1):'';
const $=id=>document.getElementById(id);
let HAS=false,VERIFIED=false,CODE='';
const btn=(text,id)=>'<button class="btn" id="'+id+'">'+text+'</button>';
function fmt(b){if(!b)return'0 B';const u=['B','KB','MB','GB','TB'];const i=Math.floor(Math.log(b)/Math.log(1024));return(b/Math.pow(1024,i)).toFixed(i>0?1:0)+' '+u[i]}
function th(t){document.documentElement.setAttribute('data-theme',t);localStorage.setItem('fs_share_theme',t);$('th').innerHTML=t==='dark'?SUN:MOON}
th(localStorage.getItem('fs_share_theme')||(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'));
$('th').onclick=()=>th(document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark');
async function check(code){
  const r=await fetch('/api/share/'+T+'?code='+encodeURIComponent(code||''));
  const d=await r.json();
  if(r.status===410){$('title').textContent='链接已过期';$('sub').textContent='这个分享链接已经失效';$('body').innerHTML='';return false}
  if(!d.ok){$('title').textContent='无法访问';$('sub').textContent=d.error||'分享不存在';$('body').innerHTML='';return false}
  if(d.hasCode&&!d.verified){
    HAS=true;
    $('title').textContent='加密分享';
    $('sub').textContent='请输入提取码后查看文件';
    $('body').innerHTML='<input id="code" placeholder="提取码" maxlength="16" autocomplete="off"><div id="op"></div>';
    $('op').innerHTML=btn('下 载','dl');
    $('dl').onclick=dl;
    const ci=$('code');ci.focus();
    ci.onkeydown=e=>{if(e.key==='Enter')dl()};
    if(PRE){CODE=PRE;ci.value=PRE;return await check(PRE)}
    return false;
  }
  VERIFIED=true;
  CODE=code||'';
  $('title').textContent='文件分享';
  $('sub').textContent='点击下方按钮下载文件';
  $('body').innerHTML='<div class="fbox"><div class="ficon">'+FILE+'</div><div style="min-width:0"><div class="fname">'+esc(d.name)+'</div><div class="fmeta">'+fmt(d.size)+(d.owner?' · 来自 '+esc(d.owner):'')+'</div></div></div>'
    +'<div id="op"></div>'
    +'<div class="stats"><span>已被下载 <b>'+d.downloads+'</b> 次</span><span>浏览 <b>'+d.views+'</b> 次</span></div>';
  $('op').innerHTML=btn('下 载','dl');
  $('dl').onclick=dl;
  $('err').textContent='';
  return true;
}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function dl(){
  if(!VERIFIED){
    const ci=$('code');
    const code=PRE||(ci?ci.value.trim():'');
    if(HAS&&!code){$('err').textContent='请输入提取码';shake();return}
    const b=$('dl');if(b){b.disabled=true;b.textContent='验证中…'}
    const ok=await check(code);
    if(b&&document.body.contains(b)){b.disabled=false;b.textContent='下 载'}
    if(!ok){if(HAS){$('err').textContent='提取码错误，请重新输入';shake()}return}
  }
  const url='/api/share/'+T+'/download'+(HAS?'?code='+encodeURIComponent(CODE):'');
  const a=document.createElement('a');
  a.href=url;a.rel='noopener';a.download='';
  document.body.appendChild(a);a.click();a.remove();
  $('err').textContent='';
}
function shake(){const ci=$('code');if(!ci)return;ci.style.animation='shake .3s';setTimeout(()=>ci.style.animation='',320)}
check(PRE||'');
</script>
</body>
</html>`;
