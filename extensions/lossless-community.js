/* iDuFi lossless extension v11 (Self-healing providers; resolve returns JSON string).
 * v9's qqdl mirrors all died (200 + HTML at the API route). v10:
 *  1. tracks.monochrome.st — direct-file provider, verified alive: the
 *     stream URL is simply {base}/track/{tidalId} (16-bit/44.1 kHz FLAC).
 *  2. Live hifi-api instances fetched at resolve time from the community
 *     uptime registry (tidal-uptime.geeked.wtf) — when instances churn,
 *     the list heals itself with no script update.
 *  3. Two documented-current static hifi-api instances as fallback.
 * The hosted copy of this script (GitHub extensions/) can also be updated
 * out-of-band via the remote registry; the provider order below is the
 * offline/bootstrap path. */
var TIDAL_TOKEN = '49YxDN9a2aFV6RTG';
var COMMUNITY_KEY = 'explore-obscure-chivalry-travesty-blinks';
var BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

var BASE_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': BROWSER_UA
};

var UPTIME_REGISTRY_URL = 'https://tidal-uptime.geeked.wtf/';

var PROVIDERS = [
  { name: 'monochrome-tracks', base: 'https://tracks.monochrome.st', direct: true },
  { name: 'hifi-geeked', base: 'https://hifi.geeked.wtf', hifi: true },
  { name: 'bini', base: 'https://tidal.401658.xyz', hifi: true }
];

function b64decode(input) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  var str = String(input).replace(/[\r\n\s]/g, '');
  var output = '';
  var i = 0;
  while (i < str.length) {
    var e1 = chars.indexOf(str.charAt(i++));
    var e2 = chars.indexOf(str.charAt(i++));
    var e3 = chars.indexOf(str.charAt(i++));
    var e4 = chars.indexOf(str.charAt(i++));
    var c1 = (e1 << 2) | (e2 >> 4);
    var c2 = ((e2 & 15) << 4) | (e3 >> 2);
    var c3 = ((e3 & 3) << 6) | e4;
    output += String.fromCharCode(c1);
    if (e3 !== 64) output += String.fromCharCode(c2);
    if (e4 !== 64) output += String.fromCharCode(c3);
  }
  return output;
}

// Self-healing: pull the currently-up hifi-api instances from the community
// uptime registry. Returns [] on any failure — statics still apply.
function fetchLiveProviders() {
  var out = [];
  try {
    var raw = safeGet(UPTIME_REGISTRY_URL, JSON.stringify(BASE_HEADERS));
    var envelope = parse(raw);
    var root = null;
    if (envelope && envelope.body) root = parse(envelope.body);
    else if (envelope && envelope.api) root = envelope;
    var list = (root && root.api) || [];
    for (var i = 0; i < list.length && out.length < 6; i++) {
      var url = list[i] && list[i].url ? String(list[i].url) : '';
      url = url.replace(/\/+$/, '');
      if (url.indexOf('https://') !== 0) continue;
      if (url.indexOf('squid.wtf') >= 0) continue; // previews only — filtered upstream too
      out.push({ name: 'live', base: url, hifi: true });
    }
  } catch (e) { /* statics still apply */ }
  log('LIVE_PROVIDERS=' + out.length);
  return out;
}

// hifi-api shape: GET /track/?id=&quality= → JSON with data.manifest
// (base64 BTS JSON carrying the real FLAC urls) or a direct URL field.
function downloadHifi(provider, id, quality) {
  var q = quality === '24' ? 'HI_RES_LOSSLESS' : 'LOSSLESS';
  var raw = safeGet(provider.base + '/track/?id=' + encodeURIComponent(id) + '&quality=' + q, JSON.stringify(BASE_HEADERS));
  var response = parse(raw);
  if (response) log('DL_STAT=' + response.status);
  else if (raw) log('DL_ENV_HEAD=' + raw.substring(0, 120));
  if (!response || response.status < 200 || response.status >= 300 || !response.body) return null;
  var root = parse(response.body);
  if (!root) { log('DL_BODY_HEAD=' + String(response.body).substring(0, 120)); return null; }
  var data = root.data || root;
  var directUrl = findUrl(data);
  if (directUrl) {
    var r1 = makeResult({ url: directUrl, mime_type: 'audio/flac' }, quality, id, 'Extension:' + provider.name);
    if (r1) { log('DL_HIFI_OK'); return r1; }
  }
  var manifest = data.manifest || data.Manifest || null;
  if (manifest) {
    try {
      var decoded = JSON.parse(b64decode(String(manifest)));
      var urls = decoded && decoded.urls;
      if (urls && urls.length) {
        var r2 = makeResult(
          { url: String(urls[0]), mime_type: String(decoded.mimeType || 'audio/flac') },
          quality, id, 'Extension:' + provider.name
        );
        if (r2) { log('DL_HIFI_OK'); return r2; }
      }
    } catch (e) { log('DL_MANIFEST_ERR'); }
  }
  return null;
}

var debugTrail = [];
function log(msg) {
  debugTrail.push(msg);
  if (typeof iDuFi !== 'undefined' && iDuFi.log) {
    try { iDuFi.log(String(msg)); } catch(e) {}
  }
}

function parse(raw) { 
  if (!raw || raw === 'null' || raw === 'undefined') return null;
  try { return JSON.parse(raw); } 
  catch (e) { log('PARSE_ERR'); return null; } 
}
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function number(v) { var n = Number(v); return isFinite(n) && n > 0 ? n : null; }
function pick(o, keys) {
  if (!o || typeof o !== 'object') return null;
  for (var i = 0; i < keys.length; i++) if (o[keys[i]] != null && String(o[keys[i]]).length) return o[keys[i]];
  return null;
}
function tracks(root) {
  if (!root || typeof root !== 'object') return [];
  var out = [];
  var candidates = [root.items, root.tracks, root.data && root.data.items, root.data && root.data.tracks, root.results && root.results.items];
  for (var i = 0; i < candidates.length; i++) if (Array.isArray(candidates[i])) out = out.concat(candidates[i]);
  return out;
}
function artistOf(t) {
  if (!t) return '';
  if (typeof t.artist === 'string') return t.artist;
  if (t.artist && t.artist.name) return t.artist.name;
  if (t.performer && t.performer.name) return t.performer.name;
  if (Array.isArray(t.artists)) return t.artists.map(function(a){ return a.name || ''; }).join(' ');
  return '';
}
function durationOf(t) {
  var n = number(pick(t, ['duration','durationSeconds']));
  if (n) return Math.round(n);
  n = number(pick(t, ['durationMs','duration_ms']));
  return n ? Math.round(n / 1000) : 0;
}

// SAFE WRAPPERS to force Java strings into JS strings
function safeGet(url, headers) {
  try {
    var res = iDuFi.get(String(url), String(headers));
    return res != null ? String(res) : null;
  } catch (e) { log('GET_ERR=' + e.message); return null; }
}

function safePost(url, body, headers) {
  try {
    var res = iDuFi.postJson(String(url), String(body), String(headers));
    return res != null ? String(res) : null;
  } catch (e) { log('POST_ERR=' + e.message); return null; }
}

function searchTidal(request) {
  var query = encodeURIComponent(request.title + ' ' + request.artist);
  var url = 'https://tidal.com/v1/search/tracks?query=' + query + '&limit=20&offset=0&countryCode=US&locale=en_US&deviceType=BROWSER';
  var headers = {
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'x-tidal-token': TIDAL_TOKEN,
    'User-Agent': BROWSER_UA
  };
  
  log('TIDAL_REQ');
  var raw = safeGet(url, JSON.stringify(headers));
  log('TIDAL_RAW=' + (raw ? raw.substring(0, 15) : 'null'));
  var response = parse(raw);
  
  if (!response) { log('TIDAL_NULL'); return null; }
  log('TIDAL_STAT=' + response.status);
  
  if (response.status < 200 || response.status >= 300) return null;
  var root = parse(response.body);
  if (!root) return null;
  
  var targetTitle = norm(request.title), targetArtist = norm(request.artist), targetDuration = number(request.durationSeconds);
  var best = null, bestScore = -1;
  var list = tracks(root);
  
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    var title = norm(t.title || t.name || '');
    var artist = norm(artistOf(t));
    if (!title || !artist) continue;
    var artistMatch = artist === targetArtist || artist.indexOf(targetArtist) >= 0 || targetArtist.indexOf(artist) >= 0;
    if (!artistMatch) continue;
    var titleMatch = title === targetTitle || title.indexOf(targetTitle) >= 0 || targetTitle.indexOf(title) >= 0;
    if (!titleMatch) continue;
    var d = durationOf(t);
    if (targetDuration && d && Math.abs(d - targetDuration) > 8) continue;
    var score = (title === targetTitle ? 1000 : 800) + (artist === targetArtist ? 300 : 100) - (d && targetDuration ? Math.abs(d-targetDuration) : 0);
    if (score > bestScore) { bestScore = score; best = String(t.id || ''); }
  }
  
  log(best ? 'TIDAL_ID=' + best : 'TIDAL_NO_MATCH');
  return best;
}

function directProviderSearch(request) {
  var query = encodeURIComponent(request.title + ' ' + request.artist);
  for (var i = 0; i < PROVIDERS.length; i++) {
    log('DIR_REQ=' + PROVIDERS[i].name);
    var raw = safeGet(PROVIDERS[i].base + '/search/?s=' + query, JSON.stringify(BASE_HEADERS));
    log('DIR_RAW=' + (raw ? raw.substring(0, 10) : 'null'));
    var response = parse(raw);
    
    if (response) log('DIR_STAT=' + response.status);
    
    var root = response && parse(response.body);
    if (!root) continue;
    var list = tracks(root), targetTitle = norm(request.title), targetArtist = norm(request.artist), targetDuration = number(request.durationSeconds);
    for (var j=0;j<list.length;j++) {
      var t=list[j], title=norm(t.title||t.name||''), artist=norm(artistOf(t)), d=durationOf(t);
      if ((title===targetTitle || title.indexOf(targetTitle)>=0) && (artist===targetArtist || artist.indexOf(targetArtist)>=0) && (!targetDuration || !d || Math.abs(d-targetDuration)<=8)) {
        log('DIR_MATCH=' + PROVIDERS[i].name);
        return { provider: PROVIDERS[i], id: String(t.id||'') };
      }
    }
  }
  return null;
}

function findUrl(root) {
  if (!root) return null;
  var direct = pick(root, ['url','download_url','downloadUrl','streamUrl','audioUrl','OriginalTrackUrl','originalTrackUrl']);
  if (typeof direct === 'string' && direct.indexOf('https://') === 0 && /flac/i.test(direct)) return direct;
  if (root.data) { var u = findUrl(root.data); if (u) return u; }
  if (root.track) { var u2 = findUrl(root.track); if (u2) return u2; }
  if (root.urls && Array.isArray(root.urls)) for (var i=0;i<root.urls.length;i++) if (/^https:\/\//.test(root.urls[i]) && /flac/i.test(root.urls[i])) return root.urls[i];
  return null;
}

function makeResult(root, quality, id, source) {
  var url = findUrl(root); if (!url) return null;
  var mime = String(pick(root,['mime_type','mimeType','contentType']) || 'audio/flac');
  if (mime.toLowerCase().indexOf('flac') < 0 && url.toLowerCase().indexOf('flac') < 0) return null;
  var bits = number(pick(root,['bit_depth','bitDepth','bits','bitsPerSample'])) || (quality === '24' ? 24 : 16);
  var rate = number(pick(root,['sample_rate','sampleRate','sampling_rate','samplingRate'])) || (quality === '24' ? 96000 : 44100);
  if (rate < 1000) rate *= 1000;
  var channels = number(pick(root,['channels','channel_count','channelCount'])) || 2;
  if (quality === '24' && (bits < 20 || rate < 48000)) return null;
  return { url:url, mimeType:'audio/flac', bitDepth:Math.round(bits), sampleRateHz:Math.round(rate), channels:Math.max(1,Math.min(2,Math.round(channels))), formatId:quality==='24'?7:6, trackId:String(id), source:source };
}

function download(provider, id, quality) {
  if (!id) return null;
  log('DL_REQ=' + provider.name);

  // Direct-file provider: the stream URL is the track URL itself.
  if (provider.direct) {
    return {
      url: provider.base + '/track/' + encodeURIComponent(id),
      mimeType: 'audio/flac',
      bitDepth: 16,
      sampleRateHz: 44100,
      channels: 2,
      formatId: 6,
      trackId: String(id),
      source: 'Extension:' + provider.name
    };
  }

  if (provider.hifi) return downloadHifi(provider, id, quality);

  var dlHeaders = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': BROWSER_UA,
    'x-api-key': COMMUNITY_KEY
  };
  
  var raw = safePost(provider.base + '/api/dl', JSON.stringify({id:String(id),quality:quality}), JSON.stringify(dlHeaders));
  log('DL_POST_RAW=' + (raw ? raw.substring(0, 10) : 'null'));
  var response = parse(raw);
  if (response) log('DL_STAT=' + response.status);
  else if (raw) log('DL_ENV_HEAD=' + raw.substring(0, 120));

  if (response && response.status >= 200 && response.status < 300 && response.body) {
    var root = parse(response.body);
    if (!root) log('DL_BODY_HEAD=' + String(response.body).substring(0, 120));
    var res = root && makeResult(root, quality, id, 'Extension:' + provider.name);
    if (res) { log('DL_POST_OK'); return res; }
  }

  var trackUrl = provider.base + '/track/?id=' + encodeURIComponent(id) + '&quality=' + (quality === '24' ? 'HI_RES' : 'LOSSLESS') + '&country=US';
  var rawTrack = safeGet(trackUrl, JSON.stringify(BASE_HEADERS));
  log('DL_GET_RAW=' + (rawTrack ? rawTrack.substring(0, 10) : 'null'));
  var respTrack = parse(rawTrack);
  if (respTrack) log('DL_GET_STAT=' + respTrack.status);
  else if (rawTrack) log('DL_GET_ENV_HEAD=' + rawTrack.substring(0, 120));

  if (respTrack && respTrack.status >= 200 && respTrack.status < 300 && respTrack.body) {
    var rootTrack = parse(respTrack.body);
    var resTrack = rootTrack && makeResult(rootTrack, quality, id, 'Extension:' + provider.name);
    if (resTrack) { log('DL_GET_OK'); return resTrack; }
  }

  return null;
}

// The Kotlin host converts the return value with Context.toString() and
// JSON-parses it — a plain object becomes "[object Object]" and dies.
// (This stayed hidden while every provider failed; the first successful
// result ever produced is what exposed it.) resolve() therefore returns a
// JSON STRING; the real work lives in resolveInternal().
function resolve(request) {
  var r = resolveInternal(request);
  return r == null ? null : JSON.stringify(r);
}

function resolveInternal(request) {
  var startedAt = Date.now();
  var budgetMs = 8000; // Increased budget to fight through the Cloudflare tarpit!
  try {
    if (!request) return null;
    log('START');

    if (typeof iDuFi === 'undefined') throw new Error('bridge_missing');
    if (typeof iDuFi.get !== 'function') throw new Error('get_missing');

    var tidalId = searchTidal(request);
    if (tidalId) {
      // 1) The direct provider is quality-agnostic and instant — try it
      //    before spending budget on the live-list fetch.
      var directResult = download(PROVIDERS[0], tidalId, '16');
      if (directResult) return directResult;

      // 2) Self-healing rotation: live uptime instances first, then the
      //    static hifi-api fallbacks.
      var providers = fetchLiveProviders().concat(PROVIDERS.slice(1));
      for (var p = 0; p < providers.length; p++) {
        var provider = providers[p];
        for (var qi = 0; qi < 2; qi++) {
          if (Date.now() - startedAt >= budgetMs) {
            log('BUDGET_EXPIRED stage=tidal_download');
            return null;
          }
          var quality = qi === 0 ? '24' : '16';
          var result = download(provider, tidalId, quality);
          if (result) return result;
        }
      }
    }

    log('NO_FLAC_MATCH');
    return null;
  } catch (e) {
    log('JS_EXCEPTION=' + String(e && e.message ? e.message : e));
    return null;
  }
}