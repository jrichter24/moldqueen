/* Shared web-UI helper — see mk4_webui.h. */
#include "mk4_webui.h"
#include <string.h>

void mk4_webui_send_chunked(httpd_req_t *req, const char *tmpl,
                            const char *toks[], const char *vals[], int n)
{
    const char *p = tmpl;
    for (int i = 0; i < n; i++) {
        const char *m = strstr(p, toks[i]);
        if (!m) continue;
        httpd_resp_send_chunk(req, p, m - p);
        httpd_resp_send_chunk(req, vals[i], strlen(vals[i]));
        p = m + strlen(toks[i]);
    }
    httpd_resp_send_chunk(req, p, strlen(p));
    httpd_resp_send_chunk(req, NULL, 0);
}
