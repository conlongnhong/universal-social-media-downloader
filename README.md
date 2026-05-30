# Universal Social Media Downloader Converter

Tampermonkey userscript de tim anh, video, audio va HLS stream tren cac trang mang xa hoi/web media, sau do tai xuong hoac chuyen media co the truy cap sang MP3/MP4 bang ffmpeg.wasm trong trinh duyet.

## Files

- `usmd.payload.js`: code chinh, dai, nen host tren GitHub Raw.
- `universal-social-media-downloader.user.js`: loader Tampermonkey ngan, 21 dong.
- `loader.template.user.js`: template loader co placeholder `__USMD_PAYLOAD_RAW_URL__`.
- `publish-to-github.ps1`: tao/update repo GitHub bang GitHub API neu co `GITHUB_TOKEN` hoac `GH_TOKEN`.

## Upload len GitHub

May hien tai khong co `git`, `gh`, hoac token GitHub trong environment. De upload tu chinh workspace nay:

1. Tao token GitHub co quyen `public_repo` cho repo public, hoac `repo` cho repo private.
2. Trong PowerShell:

```powershell
$env:GITHUB_TOKEN="ghp_xxx"
.\publish-to-github.ps1 -RepoName "universal-social-media-downloader"
```

Script se in ra:

- Repo URL.
- Payload Raw URL: `https://raw.githubusercontent.com/<user>/<repo>/main/usmd.payload.js`
- Install Raw URL: `https://raw.githubusercontent.com/<user>/<repo>/main/universal-social-media-downloader.user.js`

Dung `Install Raw URL` de cai vao Tampermonkey. File nay rat ngan, con code that duoc nap qua `@require` tu `usmd.payload.js`.

## Cai thu cong

Neu ban tao repo/Gist bang tay:

1. Upload `usmd.payload.js`.
2. Copy Raw URL cua file payload.
3. Mo `universal-social-media-downloader.user.js`.
4. Thay `__USMD_PAYLOAD_RAW_URL__` bang Raw URL cua `usmd.payload.js`.
5. Upload loader da thay URL len GitHub.
6. Mo Raw URL cua loader de Tampermonkey cai dat.

## Cach dung

1. Mo trang/post/video can tai.
2. Cho media load hoac play mot lan.
3. Bam nut `DL` goc duoi ben phai.
4. Bam `Scan`, roi chon `Save`, `MP3`, hoac `MP4`.

## Tinh nang

- Quet media tu `img`, `video`, `audio`, `source`, `meta`, `link`, inline background va cac thuoc tinh `data-*`.
- Bat URL media tu `fetch`, `XMLHttpRequest`, va `performance.getEntriesByType("resource")`.
- Quet JSON/script nhung trong trang khi bam `Scan`.
- Ho tro media truc tiep va HLS `.m3u8` VOD co segment khong ma hoa.
- Tai truc tiep bang `GM_download`, fallback sang fetch/blob.
- Nap ffmpeg.wasm chi khi bam chuyen doi, roi xuat `mp3` hoac `mp4`.

## Gioi han thuc te

- Khong the dam bao "tat ca nen tang" theo nghia tuyet doi. DRM, stream ma hoa, DASH phuc tap, live stream, hoac media chi nam trong app/native API co the khong lay duoc.
- Mot so site dung MSE, blob URL, token ngan han, cookie, hoac segment rieng le. Script se lay nhung URL ma trinh duyet expose duoc, nhung khong bypass bao ve noi dung.
- Chuyen doi bang ffmpeg.wasm ton RAM/CPU va tai core khoang 31 MB trong lan dau. File qua lon co the loi do gioi han bo nho trinh duyet.
- Chi nen tai noi dung ban co quyen luu tru va phu hop dieu khoan cua tung nen tang.
