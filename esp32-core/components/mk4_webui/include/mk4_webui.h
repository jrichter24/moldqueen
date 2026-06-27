/*
 * Shared MoldQueen web-UI assets, so the AP-mode provisioning pages (mk4_provision) and the
 * normal-op management page (mk4_mgmt) read as ONE product with no drift: the inlined icon,
 * the branded dark theme, the copy/lang JS, and the chunked-template sender.
 *
 * Everything here is self-contained (no external URLs) so a page works offline — the AP has
 * no internet, and we keep the LAN management page identical for consistency/robustness.
 */
#ifndef MK4_WEBUI_H
#define MK4_WEBUI_H

#include "esp_http_server.h"

#ifdef __cplusplus
extern "C" {
#endif

/* The optimized MoldQueen icon as a base64 data URI — defined once (mk4_webui/icon_data.c),
   referenced by every page, so the ~6.5 KB image lives in flash exactly once. */
extern const char MK4_ICON_DATA_URI[];

/* Shared base look (website palette + header + footer + key/value rows + copy buttons).
   Adjacent string-literal concatenation keeps it DRY at compile time. */
#define MK4_CSS_BASE \
":root{--bg:#0a0d12;--ink:#eef2f7;--accent:#46a0dc;--muted:rgba(238,242,247,.66);" \
"--line:rgba(238,242,247,.16);--surface:rgba(238,242,247,.06)}" \
"*{box-sizing:border-box}" \
"body{margin:0;background:var(--bg);color:var(--ink);line-height:1.5;" \
"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}" \
".wrap{max-width:440px;margin:0 auto;padding:26px 18px 42px}" \
".top{display:flex;align-items:center;gap:12px}" \
".top img{width:46px;height:46px;flex:none;border-radius:11px}" \
".top .nm{font-weight:800;font-size:1.35rem;letter-spacing:-.02em;flex:1}" \
".lang{display:flex;gap:2px;align-items:center}" \
".lang button{background:none;border:0;color:var(--muted);font:inherit;font-weight:700;" \
"font-size:.82rem;cursor:pointer;padding:3px 5px}.lang button.on{color:var(--accent)}.lang .sep{color:var(--line)}" \
".eyebrow{font-size:.68rem;text-transform:uppercase;letter-spacing:.24em;color:var(--accent);" \
"font-weight:700;margin:8px 0 16px 58px}" \
"h2{font-weight:800;letter-spacing:-.01em;font-size:1.05rem;margin:16px 0 4px}" \
"p.sub{color:var(--muted);margin:0 0 10px;font-size:.9rem}" \
".foot{margin-top:22px;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:.8rem}" \
".kv{display:flex;align-items:center;gap:8px;margin:8px 0}.kv .k{flex:none}" \
".kv b{color:var(--ink);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow:hidden;" \
"text-overflow:ellipsis;white-space:nowrap}" \
".cp{margin-left:auto;flex:none;background:var(--surface);border:1px solid var(--line);color:var(--accent);" \
"border-radius:7px;padding:4px 10px;font:inherit;font-size:.78rem;font-weight:700;cursor:pointer}.cp:hover{border-color:var(--accent)}"

/* Form + scanned-network-list look (inputs, the scrollable list with signal bars,
   show-password, the primary button) — shared by the provisioning form and the management
   change-network section. */
#define MK4_CSS_FORM \
"label{display:block;font-weight:600;font-size:.83rem;margin:15px 0 5px}" \
"input{width:100%;padding:11px 12px;background:var(--surface);border:1px solid var(--line);" \
"border-radius:9px;color:var(--ink);font-size:16px}" \
"input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}" \
".hint{color:var(--muted);font-size:.78rem;margin:6px 0 0}" \
".nets{max-height:174px;overflow-y:auto;border:1px solid var(--line);border-radius:10px;background:var(--surface);margin:5px 0 2px}" \
".netrow{display:flex;align-items:center;gap:10px;width:100%;background:none;border:0;" \
"border-bottom:1px solid var(--line);color:var(--ink);font:inherit;text-align:left;padding:11px 13px;cursor:pointer}" \
".netrow:last-child{border-bottom:0}.netrow:hover{background:rgba(70,160,220,.12)}" \
".netrow .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.92rem}" \
".sig{display:flex;align-items:flex-end;gap:2px;height:15px}.sig .bar{width:3px;background:var(--line);border-radius:1px}" \
".sig .bar:nth-child(1){height:5px}.sig .bar:nth-child(2){height:8px}" \
".sig .bar:nth-child(3){height:11px}.sig .bar:nth-child(4){height:15px}.sig .bar.on{background:var(--accent)}" \
".empty{padding:13px;color:var(--muted);font-size:.86rem}" \
".showpw{display:flex;align-items:center;gap:6px;margin-top:8px;color:var(--muted);font-size:.82rem;cursor:pointer}" \
".showpw input{width:auto;margin:0}" \
"button.go{margin-top:22px;width:100%;padding:13px;border:0;border-radius:9px;" \
"background:var(--accent);color:#06121d;font-size:16px;font-weight:800;cursor:pointer}"

/* Copy-to-clipboard with a non-secure-context fallback (these pages are plain http, where
   navigator.clipboard may be absent). The page must define T + lang before using cp(). */
#define MK4_COPY_JS \
"function fb(t){var a=document.createElement('textarea');a.value=t;a.style.position='fixed';a.style.left='-9999px';" \
"document.body.appendChild(a);a.select();try{document.execCommand('copy');}catch(e){}document.body.removeChild(a);}" \
"function cp(t,btn){function ok(){btn.textContent=T[lang].copied;setTimeout(function(){btn.textContent=T[lang].copy;},1200);}" \
"if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(ok,function(){fb(t);ok();});}else{fb(t);ok();}}"

/* EN/DE toggle wiring (the page must define T + applyLang's body uses [data-i18n]). */
#define MK4_LANG_JS \
"function applyLang(l){lang=l;document.documentElement.lang=l;" \
"document.querySelectorAll('[data-i18n]').forEach(function(e){var k=e.getAttribute('data-i18n');if(T[l][k]!=null)e.textContent=T[l][k];});" \
"en.classList.toggle('on',l==='en');de.classList.toggle('on',l==='de');}" \
"en.onclick=function(){applyLang('en');};de.onclick=function(){applyLang('de');};"

/* Send `tmpl` to the client, replacing ordered tokens with values (chunked — keeps the big
   inlined icon out of any fixed buffer; tokens MUST appear in `tmpl` in the given order). */
void mk4_webui_send_chunked(httpd_req_t *req, const char *tmpl,
                            const char *toks[], const char *vals[], int n);

#ifdef __cplusplus
}
#endif

#endif /* MK4_WEBUI_H */
