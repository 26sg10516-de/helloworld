// Vercel 서버리스 함수 (CommonJS)
const enc = (s) => Buffer.from(s, 'utf-8').toString('base64url');
const dec = (s) => Buffer.from(String(s || ''), 'base64').toString('utf-8');
const P = (abs) => '/api/proxy?u=' + enc(abs);

function toAbs(val, base) {
  try {
    if (!val || /^(data:|javascript:|mailto:|tel:|#|blob:|about:)/i.test(val.trim())) return null;
    return new URL(val.trim(), base).href;
  } catch { return null; }
}

function rewriteHtml(html, base) {
  // 문서 내 CSP meta 제거
  html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
  // href / src / action / poster 재작성
  html = html.replace(/\b(href|src|action|poster)\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, attr, q, d1, d2) => {
    const val = d1 !== undefined ? d1 : d2;
    const abs = toAbs(val, base);
    if (!abs) return m;
    return `${attr}="${P(abs)}"`;
  });
  // srcset 단순 처리: 첫 URL만 사용
  html = html.replace(/\bsrcset\s*=\s*"([^"]*)"/gi, (m, v) => {
    const first = v.split(',')[0].trim().split(/\s+/)[0];
    const abs = toAbs(first, base);
    return abs ? `src="${P(abs)}"` : m;
  });
  // 인라인 style url(...)
  html = rewriteCss(html, base);
  // fetch / XHR 가로채기 스크립트 주입
  const inject = `<script>(function(){
    var B=${JSON.stringify(base)};
    function e(s){return btoa(unescape(encodeURIComponent(s))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}
    function w(u){try{if(typeof u!=='string')u=u.url||String(u);if(/^(data:|blob:|javascript:)/i.test(u))return u;
      var a=new URL(u,B).href;if(a.indexOf(location.origin+'/api/proxy')===0)return u;return '/api/proxy?u='+e(a);}catch(x){return u;}}
    var f=window.fetch;if(f)window.fetch=function(i,o){return f.call(this,w(i),o);};
    var x=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=w(u);return x.apply(this,arguments);};
  })();</script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + inject);
  return inject + html;
}

function rewriteCss(css, base) {
  return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (m, q, v) => {
    const abs = toAbs(v, base);
    return abs ? `url("${P(abs)}")` : m;
  });
}

module.exports = async (req, res) => {
  try {
    const target = dec(req.query.u);
    if (!/^https?:\/\//i.test(target)) {
      res.status(400).send('잘못된 주소입니다.');
      return;
    }
    const r = await fetch(target, {
      redirect: 'follow',
      headers: {
        'user-agent': req.headers['user-agent'] || 'Mozilla/5.0',
        'accept': req.headers['accept'] || '*/*',
        'accept-language': req.headers['accept-language'] || 'ko,en;q=0.8'
      }
    });
    const finalUrl = r.url || target;
    const ct = r.headers.get('content-type') || 'application/octet-stream';

    // 막힐 수 있는 보안 헤더는 전달하지 않음
    res.setHeader('content-type', ct);
    res.setHeader('cache-control', 'no-store');
    res.status(r.status);

    if (/text\/html/i.test(ct)) {
      res.send(rewriteHtml(await r.text(), finalUrl));
    } else if (/text\/css/i.test(ct)) {
      res.send(rewriteCss(await r.text(), finalUrl));
    } else {
      res.send(Buffer.from(await r.arrayBuffer()));
    }
  } catch (e) {
    res.status(500).send('오류: ' + e.message);
  }
};
