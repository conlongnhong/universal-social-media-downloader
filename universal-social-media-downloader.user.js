// ==UserScript==
// @name         Universal Social Media Downloader Converter
// @namespace    https://local.codex/universal-media-downloader
// @version      0.2.0
// @description  Loader for the GitHub Raw hosted USMD payload.
// @author       Codex
// @match        *://*/*
// @run-at       document-start
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @connect      *
// @require      https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js
// @require      https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/umd/index.js
// @require      https://raw.githubusercontent.com/conlongnhong/universal-social-media-downloader/main/usmd.payload.js
// ==/UserScript==

// This loader is intentionally tiny for Tampermonkey editors with line limits.
// Replace https://raw.githubusercontent.com/conlongnhong/universal-social-media-downloader/main/usmd.payload.js with the raw GitHub URL to usmd.payload.js.
