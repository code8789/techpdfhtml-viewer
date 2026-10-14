/** Tiny looping GIF (16×16) so the sample lesson proves animation is not flattened. */
const SPINNER_GIF =
  "data:image/gif;base64,R0lGODlhEAAQAPIAAP///wAAAMLCwkJCQgAAAGJiYoKCgpKSkiH+EUNyZWF0ZWQgd2l0aCBhamF4bG9hZC5pbmZvACH5BAAKAAAAIf8LTkVUU0NBUEUyLjADAQAAACwAAAAAEAAQAAADMwi63P4wyklrE2MIOggZnAdOmGYJRbExwroUmcG2LmDEwnHQLVsYOd2mBzkYDAdKa+dIAAAh+QQACgABACwAAAAAEAAQAAADNAi63P5OjCEgG4QMu7DmikRxQlFUYDEZIGBMRVsaqHwctXXf7WEYBDB+QItz2cLCgUQmU8mKAgAh+QQACgACACwAAAAAEAAQAAADMwi63P4wyklrE2MIOggZnAdOmGYJRbExwroUmcG2LmDEwnHQLVsYOd2mBzkYDAdKa+dIAAAh+QQACgADACwAAAAAEAAQAAADNAi63P5OjCEgG4QMu7DmikRxQlFUYDEZIGBMRVsaqHwctXXf7WEYBDB+QItz2cLCgUQmU8mKAgAh+QQACgAEACwAAAAAEAAQAAADMwi63P4wyklrE2MIOggZnAdOmGYJRbExwroUmcG2LmDEwnHQLVsYOd2mBzkYDAdKa+dIAAA7";

export function sampleHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Fractions in motion</title>
<style>
  body { margin: 0; font-family: Georgia, "Source Sans 3", serif; color: #1c1915; background: #fffdf8; }
  article { padding: 28px 22px 48px; }
  h1 { font-size: 32px; line-height: 1.15; margin: 0 0 8px; }
  .kicker { letter-spacing: .14em; text-transform: uppercase; font-family: "Source Sans 3", sans-serif; font-size: 12px; color: #0f6e8c; margin: 0 0 18px; }
  p { font-size: 18px; line-height: 1.5; margin: 0 0 14px; }
  figure { margin: 18px 0; }
  figcaption { font-family: "Source Sans 3", sans-serif; font-size: 13px; color: #5c564c; margin-top: 6px; }
  svg { width: 100%; height: auto; display: block; }
  img.spin { width: 64px; height: 64px; image-rendering: pixelated; }
  video { width: 100%; max-height: 280px; background: #111; border-radius: 12px; }
  .card { display: flex; gap: 14px; align-items: center; padding: 12px; border: 1px solid #e4dccb; border-radius: 14px; }
</style>
</head>
<body>
<article>
  <p class="kicker">Sample HTML lesson</p>
  <h1>Fractions in motion</h1>
  <p>This page is real HTML. The diagram animates, the GIF loops, and the video can play. Nothing was flattened into a picture.</p>
  <figure>
    <svg viewBox="0 0 360 200" role="img" aria-label="A pie chart with a slice that moves">
      <rect width="360" height="200" rx="16" fill="#f6f1e6"/>
      <circle cx="110" cy="100" r="68" fill="#f4d35e"/>
      <path d="M110 100 L110 32 A68 68 0 0 1 170 78 Z" fill="#ee6c4d">
        <animateTransform attributeName="transform" type="rotate" from="0 110 100" to="360 110 100" dur="6s" repeatCount="indefinite"/>
      </path>
      <text x="200" y="92" font-size="22" fill="#1c1915" font-family="Georgia, serif">1 / 4</text>
      <text x="200" y="120" font-size="14" fill="#5c564c" font-family="sans-serif">turns as you watch</text>
    </svg>
    <figcaption>Animated drawing — it keeps moving while you zoom.</figcaption>
  </figure>
  <div class="card">
    <img class="spin" alt="Animated GIF" src="${SPINNER_GIF}">
    <p>Animated GIF. It stays a GIF, so the frames keep playing on your phone.</p>
  </div>
  <figure>
    <video controls playsinline webkit-playsinline preload="metadata" poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='360'%3E%3Crect fill='%23141820' width='640' height='360'/%3E%3Ctext x='32' y='180' fill='%23e8eef6' font-size='28' font-family='sans-serif'%3ETap Hand, then tap the video%3C/text%3E%3C/svg%3E">
      <source src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" type="video/mp4">
    </video>
    <figcaption>Video stays playable. Choose Hand, tap the video, then use its controls.</figcaption>
  </figure>
  <p>Switch to the pen and write on top. Two fingers still zoom and move the page, the same way a PDF viewer does.</p>
</article>
</body>
</html>`;
}
