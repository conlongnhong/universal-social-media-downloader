(function () {
  "use strict";

  if (window.__USMD_LOADED__) return;
  window.__USMD_LOADED__ = true;

  var APP = {
    name: "USMD",
    title: "Universal Social Media Downloader",
    coreBase: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd",
    maxItems: 250,
  };

  var EXT = {
    image: ["jpg", "jpeg", "png", "webp", "gif", "avif", "bmp", "svg"],
    video: ["mp4", "m4v", "mov", "webm", "mkv", "3gp", "ts", "m2ts"],
    audio: ["mp3", "m4a", "aac", "ogg", "opus", "wav", "flac"],
    stream: ["m3u8", "mpd"],
  };

  var MIME_EXT = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "image/svg+xml": "svg",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/mp2t": "ts",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "application/vnd.apple.mpegurl": "m3u8",
    "application/x-mpegurl": "m3u8",
    "application/dash+xml": "mpd",
  };

  var URL_RE = /(?:https?:\\?\/\\?\/|blob:|data:(?:image|video|audio)\/)[^\s"'<>\\)]+/gi;
  var CSS_URL_RE = /url\((["']?)(.*?)\1\)/gi;
  var HOST_HINT_RE = /(?:twimg|fbcdn|cdninstagram|instagram|tiktokcdn|tiktokv|googlevideo|ytimg|pinimg|redd\.it|redditmedia|snapchat|vimeocdn|discordapp|cloudfront|akamai|akamaized|imgur|tumblr|bilibili|douyin|xiaohongshu|kwai|kuaishou)/i;
  var PATH_HINT_RE = /(?:\/(?:image|img|photo|photos|media|video|videos|reel|story|stories|playback|videoplayback|hls|dash|stream|manifest|attachments?)\/|[?&](?:format|mime|type|ext)=)/i;
  var NEVER_RE = /\.(?:js|mjs|css|json|map|woff2?|ttf|otf|eot|html?|xml)(?:[?#]|$)/i;

  var pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  var state = {
    items: new Map(),
    nextId: 1,
    filter: "all",
    panelOpen: false,
    ui: null,
    scanTimer: 0,
    renderTimer: 0,
    ffmpeg: null,
    ffmpegLoading: null,
    queue: Promise.resolve(),
  };

  patchNetwork();
  registerMenus();
  ready(function () {
    createUi();
    watchDom();
    scanAll(false);
    scheduleScan(1500, false);
  });

  function ready(fn) {
    if (document.body) fn();
    else document.addEventListener("DOMContentLoaded", fn, { once: true });
  }

  function registerMenus() {
    if (typeof GM_registerMenuCommand !== "function") return;
    GM_registerMenuCommand("USMD: Open panel", function () {
      togglePanel(true);
    });
    GM_registerMenuCommand("USMD: Rescan media", function () {
      scanAll(true);
      togglePanel(true);
    });
  }

  function patchNetwork() {
    try {
      var oldFetch = pageWindow.fetch;
      if (typeof oldFetch === "function" && !oldFetch.__usmd) {
        var newFetch = function () {
          var url = requestUrl(arguments[0]);
          noteUrl(url, { source: "fetch" });
          return oldFetch.apply(this, arguments).then(function (res) {
            try {
              noteUrl(res.url || url, { source: "fetch", mime: res.headers && res.headers.get("content-type") });
            } catch (_) {}
            return res;
          });
        };
        newFetch.__usmd = true;
        pageWindow.fetch = newFetch;
      }
    } catch (_) {}

    try {
      var Xhr = pageWindow.XMLHttpRequest;
      if (!Xhr || !Xhr.prototype || Xhr.prototype.open.__usmd) return;
      var oldOpen = Xhr.prototype.open;
      Xhr.prototype.open = function (method, url) {
        this.__usmdUrl = requestUrl(url);
        noteUrl(this.__usmdUrl, { source: "xhr" });
        try {
          this.addEventListener(
            "load",
            function () {
              noteUrl(this.responseURL || this.__usmdUrl, {
                source: "xhr",
                mime: this.getResponseHeader && this.getResponseHeader("content-type"),
              });
            },
            { once: true }
          );
        } catch (_) {}
        return oldOpen.apply(this, arguments);
      };
      Xhr.prototype.open.__usmd = true;
    } catch (_) {}
  }

  function requestUrl(input) {
    if (!input) return "";
    if (typeof input === "string") return input;
    return input.url || String(input || "");
  }

  function watchDom() {
    try {
      new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          if (mutation.type === "attributes") scanElement(mutation.target);
        });
        scheduleScan(700, false);
      }).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src", "srcset", "href", "poster", "style", "content"],
      });
    } catch (_) {}
  }

  function scheduleScan(delay, deep) {
    clearTimeout(state.scanTimer);
    state.scanTimer = setTimeout(function () {
      scanAll(deep);
    }, delay);
  }

  function scanAll(deep) {
    scanDom();
    scanPerformance();
    if (deep) scanScripts();
    renderSoon();
  }

  function scanDom() {
    qsa("img, picture source").forEach(function (el) {
      addFromElement(el.currentSrc || el.src, el, { type: "image", source: el.tagName.toLowerCase() });
      srcset(el.getAttribute("srcset")).forEach(function (url) {
        addFromElement(url, el, { type: "image", source: "srcset" });
      });
    });

    qsa("video, audio, video source, audio source").forEach(function (el) {
      var tag = el.tagName.toLowerCase();
      var parent = el.parentElement && el.parentElement.tagName.toLowerCase();
      var type = tag === "audio" || parent === "audio" ? "audio" : "video";
      addFromElement(el.currentSrc || el.src, el, { type: type, source: tag });
      addFromElement(el.getAttribute("src"), el, { type: type, source: tag + ":src" });
      addFromElement(el.getAttribute("poster"), el, { type: "image", source: tag + ":poster" });
    });

    qsa("a[href], link[href], meta[content], object[data], embed[src]").forEach(function (el) {
      var raw = el.getAttribute("href") || el.getAttribute("content") || el.getAttribute("data") || el.getAttribute("src");
      var html = el.outerHTML || "";
      var hint = /image/i.test(html) ? "image" : /audio/i.test(html) ? "audio" : /video/i.test(html) ? "video" : "";
      addFromElement(raw, el, { type: hint, source: el.tagName.toLowerCase() });
    });

    qsa("[style*='url(']").forEach(function (el) {
      cssUrls(el.getAttribute("style")).forEach(function (url) {
        addFromElement(url, el, { type: "image", source: "style" });
      });
    });

    qsa("[data-src], [data-original], [data-url], [data-href], [data-image], [data-video], [data-poster]").forEach(scanElement);
  }

  function scanElement(el) {
    if (!el || !el.attributes) return;
    Array.prototype.forEach.call(el.attributes, function (attr) {
      if (!/(src|href|url|image|video|audio|poster|content|style)/i.test(attr.name)) return;
      if (attr.name === "srcset") {
        srcset(attr.value).forEach(function (url) {
          addFromElement(url, el, { source: "srcset" });
        });
        return;
      }
      if (attr.name === "style") {
        cssUrls(attr.value).forEach(function (url) {
          addFromElement(url, el, { type: "image", source: "style" });
        });
        return;
      }
      urlsFromText(attr.value).forEach(function (url) {
        addFromElement(url, el, { source: attr.name });
      });
      if (looksLikeUrl(attr.value)) addFromElement(attr.value, el, { source: attr.name });
    });
  }

  function scanPerformance() {
    try {
      performance.getEntriesByType("resource").forEach(function (entry) {
        noteUrl(entry.name, { source: "perf:" + (entry.initiatorType || "resource") });
      });
    } catch (_) {}
  }

  function scanScripts() {
    var bytes = 0;
    qsa("script").some(function (script) {
      if (script.src) return false;
      var text = script.textContent || "";
      bytes += text.length;
      if (bytes > 2000000) return true;
      urlsFromText(text).forEach(function (url) {
        noteUrl(url, { source: "script" });
      });
      return false;
    });
  }

  function addFromElement(raw, el, meta) {
    var url = normalizeUrl(raw);
    if (!url) return;
    var size = elementSize(el);
    addItem({
      url: url,
      type: meta.type,
      mime: meta.mime,
      source: meta.source,
      width: size.width,
      height: size.height,
      label: labelFor(el),
    });
  }

  function noteUrl(raw, meta) {
    var url = normalizeUrl(raw);
    if (!url) return;
    addItem({ url: url, type: meta.type, mime: meta.mime, source: meta.source });
  }

  function addItem(candidate) {
    if (!candidate || !candidate.url) return;
    var type = inferType(candidate.url, candidate.mime, candidate.type);
    if (!isMedia(candidate.url, candidate.mime, type)) return;

    var key = mediaKey(candidate.url);
    var ext = inferExt(candidate.url, candidate.mime, type);
    var now = Date.now();
    var item = state.items.get(key);
    if (!item) {
      item = {
        id: String(state.nextId++),
        key: key,
        url: candidate.url,
        type: type,
        ext: ext,
        mime: cleanMime(candidate.mime),
        source: candidate.source || "scan",
        sources: new Set([candidate.source || "scan"]),
        width: candidate.width || 0,
        height: candidate.height || 0,
        label: candidate.label || "",
        score: score(candidate, type),
        filename: filenameFor(candidate.url, type, ext),
        selected: false,
        firstSeen: now,
        lastSeen: now,
      };
      state.items.set(key, item);
    } else {
      item.type = item.type === "unknown" ? type : item.type;
      item.ext = item.ext || ext;
      item.width = Math.max(item.width || 0, candidate.width || 0);
      item.height = Math.max(item.height || 0, candidate.height || 0);
      item.score = Math.max(item.score || 0, score(candidate, type));
      item.sources.add(candidate.source || "scan");
      item.lastSeen = now;
    }
    renderSoon();
  }

  function score(candidate, type) {
    var s = 1;
    if (type === "video" || type === "stream") s += 1000000;
    if (type === "audio") s += 500000;
    if (candidate.width && candidate.height) s += candidate.width * candidate.height;
    if (HOST_HINT_RE.test(candidate.url || "")) s += 10000;
    return s;
  }

  function createUi() {
    if (state.ui) return;
    var host = document.createElement("div");
    host.id = "usmd-host";
    host.style.position = "fixed";
    host.style.zIndex = "2147483647";
    var root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      '<style>' +
      ':host{all:initial;color-scheme:light dark}*,*:before,*:after{box-sizing:border-box}button,input,select{font:inherit}' +
      '.fab{position:fixed;right:16px;bottom:16px;width:54px;height:54px;border:0;border-radius:12px;background:#111827;color:white;font:700 14px system-ui;box-shadow:0 12px 36px rgba(0,0,0,.28);cursor:pointer}.fab span{display:block;margin-top:2px;font-size:11px;color:#a7f3d0}' +
      '.panel{position:fixed;right:16px;bottom:84px;width:min(470px,calc(100vw - 28px));max-height:min(720px,calc(100vh - 110px));display:grid;grid-template-rows:auto auto auto 1fr auto;overflow:hidden;border:1px solid rgba(148,163,184,.45);border-radius:10px;background:rgba(255,255,255,.98);color:#111827;box-shadow:0 18px 60px rgba(15,23,42,.32);font:13px/1.35 system-ui,-apple-system,Segoe UI,sans-serif}' +
      '@media(prefers-color-scheme:dark){.panel{background:rgba(17,24,39,.98);color:#f9fafb;border-color:#4b5563}.muted,.meta,.status{color:#cbd5e1}.control,select{background:#1f2937;color:#f9fafb;border-color:#4b5563}.thumb{background:#111827}}' +
      '[hidden]{display:none!important}header,.bar,footer{display:flex;gap:7px;flex-wrap:wrap;align-items:center;padding:9px 10px;border-bottom:1px solid rgba(148,163,184,.25)}header{justify-content:space-between}.title{font-weight:750;font-size:14px}.control,select{min-height:30px;border:1px solid rgba(148,163,184,.65);border-radius:7px;background:#fff;color:#111827;padding:0 9px;cursor:pointer}.primary{background:#2563eb!important;border-color:#2563eb!important;color:white!important}.good{background:#059669!important;border-color:#059669!important;color:white!important}.warn{background:#d97706!important;border-color:#d97706!important;color:white!important}.ghost{background:transparent!important}' +
      '.status{padding:8px 12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#4b5563;border-bottom:1px solid rgba(148,163,184,.18)}.list{overflow:auto;min-height:120px}.empty{padding:28px 16px;text-align:center;color:#64748b}.row{display:grid;grid-template-columns:22px 56px minmax(0,1fr);gap:9px;padding:9px 10px;border-bottom:1px solid rgba(148,163,184,.22)}.thumb{width:56px;height:56px;border-radius:7px;overflow:hidden;display:grid;place-items:center;background:#f1f5f9;color:#334155;font-weight:750;font-size:11px}.thumb img{width:100%;height:100%;object-fit:cover}.info{min-width:0;display:grid;gap:5px}.top{display:flex;align-items:center;gap:6px;min-width:0}.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}.badge{flex:0 0 auto;min-width:42px;text-align:center;padding:2px 5px;border-radius:999px;background:#e0f2fe;color:#075985;font-size:10px;font-weight:750;text-transform:uppercase}.badge.video{background:#fee2e2;color:#991b1b}.badge.audio{background:#ede9fe;color:#5b21b6}.badge.stream{background:#fef3c7;color:#92400e}.meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b;font-size:11px}.actions{display:flex;flex-wrap:wrap;gap:5px}.mini{min-height:26px;padding:0 7px;border-radius:6px;font-size:12px}footer{border-top:1px solid rgba(148,163,184,.25);border-bottom:0}' +
      "</style>" +
      '<button class="fab" data-act="toggle" title="Open downloader">DL<span data-count>0</span></button>' +
      '<section class="panel" data-panel hidden><header><div class="title">Universal Media Downloader</div><button class="control ghost" data-act="close">x</button></header>' +
      '<div class="bar"><button class="control primary" data-act="scan">Scan</button><select data-filter><option value="all">All</option><option value="image">Images</option><option value="video">Videos</option><option value="audio">Audio</option><option value="stream">Streams</option></select><label><input type="checkbox" data-select-all> Select</label><button class="control" data-act="copy">Copy URLs</button><button class="control ghost" data-act="clear">Clear</button></div>' +
      '<div class="status" data-status>Ready.</div><div class="list" data-list></div>' +
      '<footer><button class="control good" data-act="download-selected">Download</button><button class="control warn" data-act="mp3-selected">To MP3</button><button class="control warn" data-act="mp4-selected">To MP4</button></footer></section>';
    (document.body || document.documentElement).appendChild(host);

    state.ui = {
      host: host,
      root: root,
      panel: root.querySelector("[data-panel]"),
      count: root.querySelector("[data-count]"),
      list: root.querySelector("[data-list]"),
      status: root.querySelector("[data-status]"),
      filter: root.querySelector("[data-filter]"),
      selectAll: root.querySelector("[data-select-all]"),
    };

    root.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-act]");
      if (!btn) return;
      event.preventDefault();
      handle(btn.getAttribute("data-act"), btn.getAttribute("data-id")).catch(report);
    });
    root.addEventListener("change", function (event) {
      if (event.target.matches("[data-filter]")) {
        state.filter = event.target.value;
        render();
      } else if (event.target.matches("[data-select-all]")) {
        visibleItems().forEach(function (item) {
          item.selected = event.target.checked;
        });
        render();
      } else if (event.target.matches("[data-select-item]")) {
        var item = byId(event.target.getAttribute("data-id"));
        if (item) item.selected = event.target.checked;
      }
    });
    render();
  }

  function handle(action, id) {
    switch (action) {
      case "toggle":
        togglePanel(!state.panelOpen);
        return Promise.resolve();
      case "close":
        togglePanel(false);
        return Promise.resolve();
      case "scan":
        setStatus("Scanning page and embedded JSON...");
        scanAll(true);
        setStatus("Found " + state.items.size + " candidate media URLs.");
        return Promise.resolve();
      case "clear":
        state.items.clear();
        render();
        setStatus("Cleared.");
        return Promise.resolve();
      case "copy":
        copyUrls();
        return Promise.resolve();
      case "download-item":
        return downloadItem(mustItem(id));
      case "mp3-item":
        return convertItem(mustItem(id), "mp3");
      case "mp4-item":
        return convertItem(mustItem(id), "mp4");
      case "download-selected":
        return downloadMany(selectedItems());
      case "mp3-selected":
        return convertMany(selectedItems(), "mp3");
      case "mp4-selected":
        return convertMany(selectedItems(), "mp4");
      default:
        return Promise.resolve();
    }
  }

  function togglePanel(open) {
    state.panelOpen = !!open;
    if (state.ui) state.ui.panel.hidden = !state.panelOpen;
    if (open) scanAll(false);
  }

  function renderSoon() {
    if (!state.ui || state.renderTimer) return;
    state.renderTimer = setTimeout(function () {
      state.renderTimer = 0;
      render();
    }, 100);
  }

  function render() {
    if (!state.ui) return;
    var items = visibleItems();
    state.ui.count.textContent = String(state.items.size);
    state.ui.filter.value = state.filter;
    state.ui.selectAll.checked = items.length > 0 && items.every(function (item) { return item.selected; });
    if (!items.length) {
      state.ui.list.innerHTML = '<div class="empty">No media found yet. Play/open the post, then press Scan.</div>';
      return;
    }
    state.ui.list.innerHTML = items.slice(0, APP.maxItems).map(rowHtml).join("");
  }

  function rowHtml(item) {
    var thumb = item.type === "image" && !/^blob:/i.test(item.url) ? '<img src="' + esc(item.url) + '">' : esc(item.type === "stream" ? "HLS" : item.type.slice(0, 3).toUpperCase());
    var dims = item.width && item.height ? item.width + "x" + item.height + " - " : "";
    var sources = Array.from(item.sources).slice(0, 3).join(", ");
    return (
      '<div class="row"><input type="checkbox" data-select-item data-id="' + esc(item.id) + '"' + (item.selected ? " checked" : "") + ">" +
      '<div class="thumb">' + thumb + '</div><div class="info"><div class="top"><span class="badge ' + esc(item.type) + '">' + esc(item.type) + '</span><span class="name" title="' + esc(item.filename) + '">' + esc(item.filename) + "</span></div>" +
      '<div class="meta" title="' + esc(item.url) + '">' + esc(dims + sources + " - " + hostOf(item.url)) + '</div><div class="actions">' +
      '<button class="control mini" data-act="download-item" data-id="' + esc(item.id) + '">Save</button>' +
      '<button class="control mini warn" data-act="mp3-item" data-id="' + esc(item.id) + '">MP3</button>' +
      '<button class="control mini warn" data-act="mp4-item" data-id="' + esc(item.id) + '">MP4</button></div></div></div>'
    );
  }

  function visibleItems() {
    return Array.from(state.items.values())
      .filter(function (item) {
        return state.filter === "all" || item.type === state.filter;
      })
      .sort(function (a, b) {
        return b.score - a.score || b.lastSeen - a.lastSeen;
      });
  }

  function selectedItems() {
    var selected = visibleItems().filter(function (item) {
      return item.selected;
    });
    return selected.length ? selected : visibleItems().slice(0, 1);
  }

  function byId(id) {
    return Array.from(state.items.values()).find(function (item) {
      return item.id === String(id);
    });
  }

  function mustItem(id) {
    var item = byId(id);
    if (!item) throw new Error("Media item is no longer available.");
    return item;
  }

  function setStatus(text) {
    if (state.ui && state.ui.status) state.ui.status.textContent = text;
  }

  function report(error) {
    var msg = error && error.message ? error.message : String(error);
    setStatus("Error: " + msg);
    try {
      GM_notification({ title: "USMD", text: msg, timeout: 4500 });
    } catch (_) {}
    console.error("[USMD]", error);
  }

  function copyUrls() {
    var text = visibleItems().map(function (item) { return item.url; }).join("\n");
    if (!text) return setStatus("No URLs to copy.");
    if (typeof GM_setClipboard === "function") GM_setClipboard(text, "text");
    else if (navigator.clipboard) navigator.clipboard.writeText(text);
    setStatus("Copied " + visibleItems().length + " URL(s).");
  }

  function downloadMany(items) {
    return series(items, function (item, index) {
      setStatus("Downloading " + (index + 1) + "/" + items.length + ": " + item.filename);
      return downloadItem(item);
    }).then(function () {
      setStatus("Downloaded " + items.length + " item(s).");
    });
  }

  function downloadItem(item) {
    if (item.type === "stream") {
      if (/\.mpd(?:[?#]|$)/i.test(item.url)) return downloadText(item.url, item.filename);
      return hlsBlob(item.url).then(function (hls) {
        saveBlob(hls.blob, replaceExt(item.filename, hls.ext));
      });
    }
    if (/^(blob:|data:)/i.test(item.url)) {
      triggerDownload(item.url, item.filename);
      return Promise.resolve();
    }
    return gmDownload(item.url, item.filename).catch(function () {
      return fetchBlob(item.url).then(function (blob) {
        saveBlob(blob, item.filename);
      });
    });
  }

  function gmDownload(url, name) {
    if (typeof GM_download !== "function") return Promise.reject(new Error("GM_download is not available."));
    return new Promise(function (resolve, reject) {
      GM_download({
        url: url,
        name: name,
        saveAs: false,
        onload: resolve,
        onerror: function (e) { reject(new Error((e && e.error) || "GM_download failed.")); },
        ontimeout: function () { reject(new Error("GM_download timed out.")); },
      });
    });
  }

  function convertMany(items, target) {
    return series(items, function (item, index) {
      setStatus("Converting " + (index + 1) + "/" + items.length + " to " + target.toUpperCase() + ": " + item.filename);
      return convertItem(item, target);
    }).then(function () {
      setStatus("Converted " + items.length + " item(s).");
    });
  }

  function convertItem(item, target) {
    var task = function () {
      if (target === "mp3" && item.type === "image") throw new Error("Images cannot be converted to MP3.");
      var inputExt = item.ext;
      var sourceType = item.type;
      var blobPromise;
      if (item.type === "stream") {
        if (/\.mpd(?:[?#]|$)/i.test(item.url)) throw new Error("DASH/MPD conversion is not bundled. Copy URL and use yt-dlp/ffmpeg.");
        blobPromise = hlsBlob(item.url).then(function (hls) {
          inputExt = hls.ext;
          sourceType = "video";
          return hls.blob;
        });
      } else {
        blobPromise = blobFor(item);
      }
      return blobPromise
        .then(function (blob) {
          return convertBlob(blob, { target: target, inputExt: inputExt, sourceType: sourceType });
        })
        .then(function (out) {
          saveBlob(out, replaceExt(item.filename, target));
          setStatus("Saved " + replaceExt(item.filename, target) + ".");
        });
    };
    var next = state.queue.then(task, task);
    state.queue = next.catch(function () {});
    return next;
  }

  function convertBlob(blob, options) {
    var ffmpeg;
    var token = Date.now() + "_" + Math.random().toString(36).slice(2);
    var input = "input_" + token + "." + (cleanExt(options.inputExt) || "bin");
    var output = "output_" + token + "." + options.target;
    return ensureFfmpeg()
      .then(function (instance) {
        ffmpeg = instance;
        return blob.arrayBuffer();
      })
      .then(function (buffer) {
        return ffmpeg.writeFile(input, new Uint8Array(buffer));
      })
      .then(function () {
        return tryFfmpeg(ffmpeg, commandsFor(options, input, output), output);
      })
      .then(function (data) {
        return new Blob([data], { type: options.target === "mp3" ? "audio/mpeg" : "video/mp4" });
      })
      .finally(function () {
        if (ffmpeg) {
          safeDelete(ffmpeg, input);
          safeDelete(ffmpeg, output);
        }
      });
  }

  function commandsFor(options, input, output) {
    if (options.target === "mp3") {
      return [
        ["-y", "-i", input, "-vn", "-map", "0:a?", "-codec:a", "libmp3lame", "-q:a", "2", output],
        ["-y", "-i", input, "-vn", "-q:a", "2", output],
      ];
    }
    if (options.sourceType === "image") {
      return [
        ["-y", "-loop", "1", "-i", input, "-t", "3", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-movflags", "faststart", output],
        ["-y", "-loop", "1", "-i", input, "-t", "3", output],
      ];
    }
    return [
      ["-y", "-i", input, "-map", "0:v?", "-map", "0:a?", "-c:v", "copy", "-c:a", "aac", "-movflags", "faststart", output],
      ["-y", "-i", input, "-map", "0:v?", "-map", "0:a?", "-c:a", "aac", "-movflags", "faststart", output],
      ["-y", "-i", input, output],
    ];
  }

  function tryFfmpeg(ffmpeg, commands, output) {
    var last;
    return series(commands, function (args) {
      if (last === "done") return Promise.resolve();
      return ffmpeg.exec(args)
        .then(function (code) {
          if (code !== 0) throw new Error("ffmpeg exited with code " + code);
          return ffmpeg.readFile(output);
        })
        .then(function (data) {
          last = "done";
          return data;
        })
        .catch(function (err) {
          last = err;
          return safeDelete(ffmpeg, output).then(function () {
            return undefined;
          });
        });
    }).then(function (results) {
      var hit = results.find(function (item) { return item; });
      if (hit) return hit;
      throw new Error("FFmpeg conversion failed: " + (last && last.message ? last.message : last));
    });
  }

  function ensureFfmpeg() {
    if (state.ffmpeg) return Promise.resolve(state.ffmpeg);
    if (state.ffmpegLoading) return state.ffmpegLoading;
    state.ffmpegLoading = Promise.resolve().then(function () {
      var ns = globalValue("FFmpegWASM");
      var util = globalValue("FFmpegUtil");
      if (!ns || !ns.FFmpeg) throw new Error("ffmpeg.wasm did not load. Check @require URLs.");
      var ffmpeg = new ns.FFmpeg();
      ffmpeg.on("log", function (event) {
        if (event && event.message) setStatus("FFmpeg: " + event.message.slice(0, 120));
      });
      ffmpeg.on("progress", function (event) {
        if (event && isFinite(event.progress)) setStatus("FFmpeg progress: " + Math.round(event.progress * 100) + "%");
      });
      setStatus("Loading ffmpeg.wasm core, about 31 MB...");
      var coreURL = APP.coreBase + "/ffmpeg-core.js";
      var wasmURL = APP.coreBase + "/ffmpeg-core.wasm";
      var make = util && util.toBlobURL ? util.toBlobURL : function (url) { return Promise.resolve(url); };
      return Promise.all([make(coreURL, "text/javascript"), make(wasmURL, "application/wasm")])
        .then(function (urls) {
          return ffmpeg.load({ coreURL: urls[0], wasmURL: urls[1] });
        })
        .then(function () {
          state.ffmpeg = ffmpeg;
          setStatus("ffmpeg.wasm loaded.");
          return ffmpeg;
        });
    });
    return state.ffmpegLoading;
  }

  function globalValue(name) {
    try { if (window[name]) return window[name]; } catch (_) {}
    try { if (pageWindow[name]) return pageWindow[name]; } catch (_) {}
    return undefined;
  }

  function hlsBlob(url) {
    return resolveHls(url, 0).then(function (playlist) {
      if (playlist.encrypted) throw new Error("Encrypted HLS streams are not supported.");
      if (playlist.byteRange) throw new Error("HLS byte-range streams are not supported yet.");
      if (!playlist.segments.length) throw new Error("No HLS segments found.");
      var urls = playlist.init ? [playlist.init].concat(playlist.segments) : playlist.segments;
      var chunks = [];
      return series(urls, function (segmentUrl, index) {
        setStatus("Downloading HLS segment " + (index + 1) + "/" + urls.length + "...");
        return gmRequest(segmentUrl, "arraybuffer").then(function (res) {
          chunks.push(res.response);
        });
      }).then(function () {
        var fmp4 = !!playlist.init || urls.some(function (u) { return /\.(?:m4s|mp4|cmfv)(?:[?#]|$)/i.test(u); });
        return { blob: new Blob(chunks, { type: fmp4 ? "video/mp4" : "video/mp2t" }), ext: fmp4 ? "mp4" : "ts" };
      });
    });
  }

  function resolveHls(url, depth) {
    if (depth > 4) return Promise.reject(new Error("HLS nesting is too deep."));
    return gmRequest(url, "text").then(function (res) {
      var parsed = parseM3u8(res.responseText || res.response || "", res.finalUrl || url);
      if (!parsed.variants.length) return parsed;
      parsed.variants.sort(function (a, b) { return b.bandwidth - a.bandwidth; });
      return resolveHls(parsed.variants[0].url, depth + 1);
    });
  }

  function parseM3u8(text, base) {
    var out = { variants: [], segments: [], init: "", encrypted: false, byteRange: false };
    var lines = String(text || "").split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var variant = null;
    lines.forEach(function (line) {
      if (/^#EXT-X-STREAM-INF/i.test(line)) {
        variant = attrs(line.split(":").slice(1).join(":"));
      } else if (/^#EXT-X-KEY/i.test(line) && !/METHOD=NONE/i.test(line)) {
        out.encrypted = true;
      } else if (/^#EXT-X-BYTERANGE/i.test(line)) {
        out.byteRange = true;
      } else if (/^#EXT-X-MAP/i.test(line)) {
        var a = attrs(line.split(":").slice(1).join(":"));
        if (a.URI) out.init = absUrl(a.URI, base);
      } else if (!/^#/.test(line)) {
        if (variant) {
          out.variants.push({ url: absUrl(line, base), bandwidth: Number(variant.BANDWIDTH || 0), resolution: variant.RESOLUTION || "" });
          variant = null;
        } else {
          out.segments.push(absUrl(line, base));
        }
      }
    });
    return out;
  }

  function attrs(text) {
    var out = {};
    var re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
    var match;
    while ((match = re.exec(text || ""))) out[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, "");
    return out;
  }

  function blobFor(item) {
    if (/^(blob:|data:)/i.test(item.url)) return fetch(item.url).then(function (r) { return r.blob(); });
    return fetchBlob(item.url);
  }

  function fetchBlob(url) {
    return gmRequest(url, "blob").then(function (res) {
      if (res.response instanceof Blob) return res.response;
      if (res.response instanceof ArrayBuffer) return new Blob([res.response]);
      return new Blob([res.response || res.responseText || ""]);
    });
  }

  function downloadText(url, name) {
    return gmRequest(url, "text").then(function (res) {
      saveBlob(new Blob([res.responseText || res.response || ""], { type: "text/plain;charset=utf-8" }), name);
    });
  }

  function gmRequest(url, type) {
    if (typeof GM_xmlhttpRequest !== "function") {
      return fetch(url, { credentials: "include" }).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status + " fetching media.");
        if (type === "text") return res.text().then(function (text) { return { responseText: text, finalUrl: res.url }; });
        if (type === "arraybuffer") return res.arrayBuffer().then(function (buf) { return { response: buf, finalUrl: res.url }; });
        return res.blob().then(function (blob) { return { response: blob, finalUrl: res.url }; });
      });
    }
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: "GET",
        url: url,
        responseType: type,
        timeout: 120000,
        anonymous: false,
        onload: function (res) { res.status >= 200 && res.status < 400 ? resolve(res) : reject(new Error("HTTP " + res.status + " fetching media.")); },
        onerror: function () { reject(new Error("Network error fetching media.")); },
        ontimeout: function () { reject(new Error("Timed out fetching media.")); },
      });
    });
  }

  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    triggerDownload(url, name);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 60000);
  }

  function triggerDownload(url, name) {
    var a = document.createElement("a");
    a.href = url;
    a.download = name || "media";
    a.rel = "noopener";
    a.style.display = "none";
    (document.body || document.documentElement).appendChild(a);
    a.click();
    a.remove();
  }

  function series(items, fn) {
    var results = [];
    return items.reduce(function (p, item, index) {
      return p.then(function () {
        return fn(item, index);
      }).then(function (result) {
        results.push(result);
      });
    }, Promise.resolve()).then(function () {
      return results;
    });
  }

  function safeDelete(ffmpeg, name) {
    try {
      return ffmpeg.deleteFile(name).catch(function () {});
    } catch (_) {
      return Promise.resolve();
    }
  }

  function qsa(selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector));
  }

  function srcset(value) {
    return String(value || "").split(",").map(function (part) { return part.trim().split(/\s+/)[0]; }).filter(Boolean);
  }

  function cssUrls(value) {
    var urls = [];
    var match;
    CSS_URL_RE.lastIndex = 0;
    while ((match = CSS_URL_RE.exec(value || ""))) if (match[2]) urls.push(match[2]);
    return urls;
  }

  function urlsFromText(text) {
    var urls = [];
    var normalized = htmlDecode(text || "").replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
    var match;
    URL_RE.lastIndex = 0;
    while ((match = URL_RE.exec(normalized))) urls.push(match[0].replace(/[),.;]+$/g, ""));
    return urls;
  }

  function normalizeUrl(raw) {
    if (!raw) return "";
    var value = htmlDecode(String(raw).trim()).replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
    if (!value || /^(javascript|mailto|tel|about|chrome|moz-extension|edge-extension):/i.test(value)) return "";
    if (/^\/\//.test(value)) value = location.protocol + value;
    if (/^(blob:|data:)/i.test(value)) return value;
    try { return new URL(value, location.href).href; } catch (_) { return ""; }
  }

  function looksLikeUrl(value) {
    return /^(?:https?:|blob:|data:|\/\/|\/)/i.test(String(value || "").trim());
  }

  function isMedia(url, mime, type) {
    if (type && type !== "unknown") return true;
    if (mime && inferType("", mime, "") !== "unknown") return true;
    if (/^data:(?:image|video|audio)\//i.test(url) || /^blob:/i.test(url)) return true;
    if (NEVER_RE.test(url)) return false;
    if (knownExt(url)) return true;
    if (/[?&](?:format|fm)=(?:jpg|jpeg|png|webp|gif|avif|mp4|webm|mp3|m4a|m3u8|mpd)\b/i.test(url)) return true;
    if (/[?&]mime=(?:video|audio|image)(?:%2f|\/)/i.test(url)) return true;
    return HOST_HINT_RE.test(url) && PATH_HINT_RE.test(url);
  }

  function inferType(url, mime, hint) {
    if (hint && ["image", "video", "audio", "stream"].indexOf(hint) > -1) return hint;
    mime = cleanMime(mime);
    if (/^image\//.test(mime)) return "image";
    if (/^video\//.test(mime)) return "video";
    if (/^audio\//.test(mime)) return "audio";
    if (/mpegurl|m3u8|dash\+xml/.test(mime)) return "stream";
    if (/^data:image\//i.test(url)) return "image";
    if (/^data:video\//i.test(url)) return "video";
    if (/^data:audio\//i.test(url)) return "audio";
    var ext = urlExt(url);
    if (EXT.image.indexOf(ext) > -1) return "image";
    if (EXT.video.indexOf(ext) > -1) return "video";
    if (EXT.audio.indexOf(ext) > -1) return "audio";
    if (EXT.stream.indexOf(ext) > -1) return "stream";
    if (/videoplayback|\/video\/|[?&](?:format|mime|type)=(?:mp4|video|video%2f)/i.test(url)) return "video";
    if (/\/audio\/|[?&](?:format|mime|type)=(?:mp3|m4a|audio|audio%2f)/i.test(url)) return "audio";
    if (/\.m3u8(?:[?#]|$)|\/hls\/|mpegurl/i.test(url)) return "stream";
    if (/\.mpd(?:[?#]|$)|\/dash\//i.test(url)) return "stream";
    return "unknown";
  }

  function inferExt(url, mime, type) {
    mime = cleanMime(mime);
    if (MIME_EXT[mime]) return MIME_EXT[mime];
    var ext = urlExt(url);
    if (ext) return ext;
    var fm = String(url).match(/[?&](?:format|fm|ext)=([a-z0-9]+)/i);
    if (fm) return cleanExt(fm[1]);
    if (type === "image") return "jpg";
    if (type === "video") return "mp4";
    if (type === "audio") return "mp3";
    if (type === "stream") return /\.mpd(?:[?#]|$)/i.test(url) ? "mpd" : "m3u8";
    return "bin";
  }

  function urlExt(url) {
    if (/^data:/i.test(url)) {
      var mime = url.slice(5, url.indexOf(";") > -1 ? url.indexOf(";") : url.indexOf(",")).toLowerCase();
      return MIME_EXT[mime] || "";
    }
    try {
      var m = new URL(url, location.href).pathname.match(/\.([a-z0-9]{2,5})$/i);
      return m ? cleanExt(m[1]) : "";
    } catch (_) {
      return "";
    }
  }

  function knownExt(url) {
    var ext = urlExt(url);
    return [].concat(EXT.image, EXT.video, EXT.audio, EXT.stream).indexOf(ext) > -1;
  }

  function filenameFor(url, type, ext) {
    var base = "";
    try {
      if (/^(data|blob):/i.test(url)) base = slug(document.title || location.hostname || "media") + "-" + Date.now();
      else {
        var parsed = new URL(url);
        base = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname);
        base = base.replace(/\.[a-z0-9]{2,5}$/i, "");
      }
    } catch (_) {
      base = type || "media";
    }
    return (slug(base).slice(0, 80) || "media") + "." + (ext || "bin");
  }

  function mediaKey(url) {
    if (/^(data|blob):/i.test(url)) return url.slice(0, 180);
    try {
      var u = new URL(url);
      u.hash = "";
      return u.href;
    } catch (_) {
      return url;
    }
  }

  function elementSize(el) {
    return {
      width: Number(el && (el.naturalWidth || el.videoWidth || el.clientWidth) || 0),
      height: Number(el && (el.naturalHeight || el.videoHeight || el.clientHeight) || 0),
    };
  }

  function labelFor(el) {
    return (el && (el.getAttribute("alt") || el.getAttribute("aria-label") || el.getAttribute("title"))) || "";
  }

  function cleanMime(mime) {
    return String(mime || "").split(";")[0].trim().toLowerCase();
  }

  function cleanExt(ext) {
    ext = String(ext || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return ext === "jpeg" ? "jpg" : ext;
  }

  function replaceExt(name, ext) {
    return String(name || "media.bin").replace(/\.[a-z0-9]{2,5}$/i, "") + "." + ext;
  }

  function slug(value) {
    return String(value || "").normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  }

  function htmlDecode(value) {
    return String(value).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  }

  function hostOf(url) {
    if (/^data:/i.test(url)) return "data-url";
    if (/^blob:/i.test(url)) return "blob-url";
    try { return new URL(url).hostname; } catch (_) { return "unknown-host"; }
  }

  function absUrl(url, base) {
    try { return new URL(url, base).href; } catch (_) { return url; }
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/`/g, "&#96;");
  }
})();
