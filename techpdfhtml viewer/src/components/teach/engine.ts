import {
  boundsOf,
  drawObj,
  hitObj,
  objSvg,
  snapShape,
  type DrawObj,
  type MediaObj,
  type Pt,
} from "@/components/teach/ink";

const TILE = 1800;
const MIN_Z = 0.5;
const MAX_Z = 6;
const HISTORY = 40;
const DOCK_GAP = 92;
const MAX_EDGE = 1536;
const MAX_CANVAS_EDGE = 8192;
/** Soft limits — files above these still open, but we use a leaner path. */
const LARGE_HTML_BYTES = 12 * 1024 * 1024; // 12 MB
const HUGE_HTML_BYTES = 40 * 1024 * 1024; // 40 MB
const LARGE_PDF_BYTES = 25 * 1024 * 1024;
const HUGE_PDF_BYTES = 90 * 1024 * 1024;
const LARGE_MEDIA_BYTES = 20 * 1024 * 1024;

export type Tool =
  | "hand"
  | "pen"
  | "highlighter"
  | "eraser"
  | "scrub"
  | "text"
  | "line"
  | "arrow"
  | "rect"
  | "circle"
  | "triangle"
  | "laser";

export type Prefs = {
  tool: Tool;
  color: string;
  size: number;
  eraserSize: number;
  opacity: number;
  invert: boolean;
  shapeDetect: boolean;
  laserSize: number;
};

export type TeachPatch = {
  docName?: string;
  kind?: "pdf" | "html" | null;
  page?: number;
  pageCount?: number;
  zoom?: number;
  canUndo?: boolean;
  canRedo?: boolean;
  status?: string;
  progress?: { label: string; ratio: number } | null;
  video?: boolean;
  ready?: boolean;
  selectedMedia?: boolean;
};

export type TeachHooks = {
  getPrefs: () => Prefs;
  patch: (p: TeachPatch) => void;
  onZoom: (z: number) => void;
  requestText: (opts: { title: string; placeholder?: string }) => Promise<string | null>;
  requestPage: (current: number, total: number) => Promise<number | null>;
  onEscape: () => void;
  onJump: () => void;
};

export type StageEls = {
  scroll: HTMLDivElement;
  sizer: HTMLDivElement;
  stage: HTMLDivElement;
};

type PdfRenderTask = { promise: Promise<void>; cancel: () => void };
type PdfPageProxy = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => PdfRenderTask;
  cleanup: () => void;
};
type PdfDocProxy = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPageProxy>;
  destroy: () => Promise<void> | void;
};

type Tile = {
  y0: number;
  baseH: number;
  el: HTMLDivElement;
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
};

type Page = {
  index: number;
  baseW: number;
  baseH: number;
  shell: HTMLDivElement;
  inner: HTMLDivElement;
  mediaLayer: HTMLDivElement;
  tilesHost: HTMLDivElement;
  tiles: Tile[];
  objects: DrawObj[];
  media: MediaObj[];
  past: string[];
  future: string[];
  pdfCanvas?: HTMLCanvasElement;
  pdfPage?: PdfPageProxy;
  renderTask?: PdfRenderTask | null;
  renderGen: number;
  iframe?: HTMLIFrameElement;
  mounted: boolean;
  thumbBtn?: HTMLButtonElement;
  pdfNumber: number | null;
  paper: string | null;
};

type Doc = {
  kind: "pdf" | "html";
  pages: Page[];
};

type MediaMode = "move" | "resize" | "rotate";

type MediaHit = {
  page: Page;
  media: MediaObj;
  el: HTMLElement;
  mode: MediaMode | null;
  isHandle: boolean;
};

type Draft = { page: Page; obj: DrawObj; origin: Pt; moved: boolean };

/**
 * FIXED:
 * 1. Zero line gap between pages (margin/padding set to 0, strict 0-1 line gap).
 * 2. Optimized HTML video handling, autoplay, playsinline, and pointer event passthrough.
 */
const MOBILE_FIX = `<meta name="viewport" content="width=device-width, initial-scale=1">
<style id="teachpdf-view-fix">
html,body{margin:0!important;padding:0!important;height:auto!important;min-height:100%;overflow:visible!important;touch-action:auto!important;}
/* Images/video fluid — but NOT canvas (interactive sims need crisp pixel sizing) */
img,video,svg{max-width:100%;height:auto;}
canvas{max-width:none;image-rendering:auto;}
video{
  background:#000;
  touch-action:manipulation!important;
  pointer-events:auto!important;
  -webkit-playsinline:true;
  playsinline:true;
}
.page,.pdf-page,.pdfPage,.slide,section.page,[data-page]{
  display:block!important;visibility:visible!important;opacity:1!important;
  position:relative!important;inset:auto!important;transform:none!important;
  overflow:visible!important;height:auto!important;margin:0 0 1px 0!important;padding:0!important;
}
.iframe-wrap,.live-frame,iframe{
  touch-action:auto!important;
  pointer-events:auto!important;
}
.tap-to-play{
  touch-action:manipulation!important;
  pointer-events:auto!important;
  cursor:pointer;
  z-index:10!important;
}
@media (max-width: 760px) {
  .iframe-wrap{
    width:100%!important;
    max-width:100%!important;
    height:auto!important;
    min-height:280px!important;
    aspect-ratio:1 / 1.05;
    margin:0 auto!important;
  }
  .live-frame, .iframe-wrap > iframe{
    width:100%!important;
    height:100%!important;
    min-height:280px!important;
    border:0!important;
    display:block!important;
  }
  .page video, video{
    width:100%!important;
    max-width:100%!important;
    height:auto!important;
    max-height:none!important;
    display:block!important;
    margin:0 auto!important;
  }
  .page img{
    max-width:100%!important;
    height:auto!important;
    max-height:none!important;
  }
  .page{
    padding:0!important;
    margin:0 0 1px 0!important;
    min-height:auto!important;
  }
}
</style>
<script id="teachpdf-media-fix">
(function(){
  function fix(v){
    v.setAttribute("playsinline","");
    v.setAttribute("webkit-playsinline","");
    v.setAttribute("controls","true");
    if(!v.getAttribute("preload")) v.preload="metadata";
    v.style.touchAction = "manipulation";
    v.style.pointerEvents = "auto";
  }
  function scan(root){
    if(!root.querySelectorAll) return;
    root.querySelectorAll("video").forEach(fix);
    root.querySelectorAll(".tap-to-play").forEach(function(btn){
      btn.style.pointerEvents = "auto";
      btn.style.touchAction = "manipulation";
    });
  }
  function sharpenCanvas(){
    try{
      document.querySelectorAll("canvas").forEach(function(c){
        if(!c.getContext) return;
        var r=c.getBoundingClientRect();
        if(r.width<2||r.height<2) return;
        c.style.maxWidth="none";
      });
    }catch(e){}
  }
  function start(){
    scan(document);
    sharpenCanvas();
    window.addEventListener("resize",function(){ setTimeout(sharpenCanvas,50); });
    new MutationObserver(function(ms){
      ms.forEach(function(m){
        m.addedNodes.forEach(function(n){
          if(!n.tagName) return;
          if(n.tagName==="VIDEO") fix(n);
          else scan(n);
        });
      });
    }).observe(document.documentElement,{childList:true,subtree:true});
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
</script>`;

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function yieldThread() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function isPdf(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function isHtml(file: File) {
  return file.type === "text/html" || /\.html?$/i.test(file.name);
}

function isMedia(file: File) {
  if (file.type.startsWith("image/") || file.type.startsWith("video/")) return true;
  return /\.(gif|png|jpe?g|webp|svg|mp4|webm|mov|ogv|m4v)$/i.test(file.name);
}

function mediaKind(file: File): "image" | "video" {
  if (file.type.startsWith("video/") || /\.(mp4|webm|mov|ogv|m4v)$/i.test(file.name)) return "video";
  return "image";
}

function esc(s: string) {
  const amp = "&" + "amp;";
  const lt = "&" + "lt;";
  const gt = "&" + "gt;";
  const quot = "&" + "quot;";
  const apos = "&" + "#39;";
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return amp;
      case "<":
        return lt;
      case ">":
        return gt;
      case '"':
        return quot;
      default:
        return apos;
    }
  });
}

async function readBytes(file: Blob, onRatio: (n: number) => void) {
  const total = file.size || 1;
  const reader = file.stream().getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  let last = 0;
  let chunkN = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.byteLength;
    chunkN++;
    if (got / total - last > 0.03 || got >= total) {
      last = got / total;
      onRatio(Math.min(1, last));
    }
    if (chunkN % (total > LARGE_PDF_BYTES ? 2 : 8) === 0) await yieldThread();
  }
  const out = new Uint8Array(got);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

async function readText(file: Blob, onRatio: (n: number) => void) {
  const total = file.size || 1;
  const reader = file.stream().getReader();
  const dec = new TextDecoder();
  const chunks: string[] = [];
  let got = 0;
  let last = 0;
  let chunkN = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(dec.decode(value, { stream: true }));
    got += value.byteLength;
    chunkN++;
    if (got / total - last > 0.03 || got >= total) {
      last = got / total;
      onRatio(Math.min(1, last));
    }
    if (chunkN % (total > LARGE_HTML_BYTES ? 2 : 6) === 0) await yieldThread();
  }
  chunks.push(dec.decode());
  return chunks.join("");
}

function splitHtmlDocuments(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const all = [
    ...doc.querySelectorAll(".page, .pdf-page, .pdfPage, .slide, section.page, [data-page]"),
  ];
  const leaves = all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
  const useful = leaves.filter((el) => {
    const words = (el.textContent || "").replace(/\s+/g, "");
    if (words.length > 8) return true;
    if (el.querySelector("img,video,canvas,svg,iframe,object,picture")) return true;
    if (el instanceof HTMLElement && /url\(/i.test(el.style.backgroundImage)) return true;
    return false;
  });
  if (useful.length < 2) return [html];

  const headBits: string[] = [];
  for (const node of doc.head?.children ?? []) {
    const tag = node.tagName;
    if (tag === "STYLE" || tag === "LINK" || tag === "META" || tag === "TITLE") {
      if (tag === "STYLE" && (node.textContent?.length ?? 0) > 400_000) continue;
      headBits.push(node.outerHTML);
    } else if (tag === "SCRIPT") {
      const src = node.getAttribute("src");
      const text = node.textContent || "";
      if (src || text.length < 80_000) headBits.push(node.outerHTML);
    }
  }
  const lightHead = headBits.join("\n");

  return useful.map((el) => {
    const markup = el.outerHTML;
    return `<!doctype html>\n<html><head>${lightHead}</head><body>${markup}</body></html>`;
  });
}

function waitForFrame(iframe: HTMLIFrameElement, maxMs = 1800) {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const afterLoad = () => {
      const doc = iframe.contentDocument;
      const pending: Promise<void>[] = [];
      if (doc) {
        let imgWait = 0;
        for (const img of [...doc.images]) {
          if (img.complete || imgWait >= 8) continue;
          imgWait++;
          pending.push(
            new Promise((done) => {
              img.addEventListener("load", () => done(), { once: true });
              img.addEventListener("error", () => done(), { once: true });
            }),
          );
        }
        for (const video of [...doc.querySelectorAll("video")]) {
          const src = video.currentSrc || video.src || "";
          if (src.startsWith("data:")) continue;
          if (video.readyState >= 1) continue;
          pending.push(
            new Promise((done) => {
              video.addEventListener("loadedmetadata", () => done(), { once: true });
              video.addEventListener("error", () => done(), { once: true });
            }),
          );
        }
      }
      void Promise.race([
        Promise.all(pending),
        new Promise((done) => setTimeout(done, Math.min(1200, maxMs))),
      ]).then(() => setTimeout(finish, 20));
    };
    if (iframe.contentDocument?.readyState === "complete") afterLoad();
    else iframe.addEventListener("load", afterLoad, { once: true });
    setTimeout(finish, maxMs);
  });
}

function injectFix(html: string) {
  if (html.includes("teachpdf-media-fix")) return html;
  const match = /<head[^>]*>/i.exec(html);
  if (match) {
    const at = match.index + match[0].length;
    return html.slice(0, at) + MOBILE_FIX + html.slice(at);
  }
  return `<!doctype html><html><head>${MOBILE_FIX}</head><body>${html}</body></html>`;
}

function rewriteAssets(html: string, map: Map<string, string>) {
  const find = (raw: string) => {
    const clean = raw.trim();
    if (/^(https?:|data:|blob:|mailto:|#|\/\/)/i.test(clean)) return null;
    const noHash = clean.split("#")[0]?.split("?")[0] ?? clean;
    const base = decodeURIComponent(noHash.split("/").pop() || "");
    return map.get(clean) || map.get(noHash) || map.get(noHash.replace(/^\.\//, "")) || map.get(base) || null;
  };
  return html
    .replace(/(\s(?:src|href|poster|data-src)\s*=\s*)(["'])([^"']+)\2/gi, (full, pre: string, q: string, url: string) => {
      const hit = find(url);
      return hit ? `${pre}${q}${hit}${q}` : full;
    })
    .replace(/(\ssrcset\s*=\s*)(["'])([^"']+)\2/gi, (full, pre: string, q: string, value: string) => {
      const next = value
        .split(",")
        .map((part) => {
          const bits = part.trim().split(/\s+/);
          const hit = bits[0] ? find(bits[0]) : null;
          if (!hit || !bits[0]) return part;
          bits[0] = hit;
          return bits.join(" ");
        })
        .join(", ");
      return `${pre}${q}${next}${q}`;
    })
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, q: string, url: string) => {
      const hit = find(url);
      return hit ? `url(${q}${hit}${q})` : full;
    });
}

let pdfjsLoad: Promise<typeof import("pdfjs-dist")> | null = null;

function loadPdfjs() {
  pdfjsLoad ??= import("pdfjs-dist").then(async (pdfjs) => {
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return pdfjsLoad;
}

export class Engine {
  private alive = true;
  private doc: Doc | null = null;
  private pdf: PdfDocProxy | null = null;
  private pdfBlob: Blob | null = null;
  private htmlSource = "";
  private docName = "";
  private docGen = 0;
  private pageByEl = new Map<Element, Page>();
  private current = 1;
  private userZoom = 1;
  private committedZoom = 1;
  private visualRatio = 1;
  private ownedUrls: string[] = [];
  private urlFiles = new Map<string, Blob>();
  private htmlObserver: ResizeObserver | null = null;
  private resizeObserver: ResizeObserver;
  private lastAvail = 0;
  private resizeT = 0;
  private mode: "none" | "draw" | "pan" | "pinch" | "media" | "laser" = "none";
  private pointers = new Map<number, Pt>();
  private blockUntilUp = false;
  private holdPanTimer = 0;
  private holdPanAt: { x: number; y: number } | null = null;
  private htmlHandPending: {
    x: number;
    y: number;
    pointerId: number;
    page: Page;
  } | null = null;
  private pinchDist = 1;
  private pinchStartZoom = 1;
  private lastMid = { x: 0, y: 0 };
  private panX = 0;
  private panY = 0;
  private panT = 0;
  private panMoved = 0;
  private panVx = 0;
  private panVy = 0;
  private momentum = 0;
  private lastTap = 0;
  private lastTapX = 0;
  private lastTapY = 0;
  private draft: Draft | null = null;
  private selectedMediaId: string | null = null;
  private mediaDrag: {
    hit: MediaHit;
    mode: MediaMode;
    anchorX: number;
    anchorY: number;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    startRot: number;
    startAngle: number;
    moved: boolean;
    snap: boolean;
  } | null = null;
  private laser: HTMLDivElement;
  private videoFocus = false;
  private paintRaf = 0;
  private scrollRaf = 0;
  private statusN = 0;
  private thumbToken = 0;
  private wheelT = 0;
  private progLast = 0;
  private lastInvert = false;
  private pinchRerenderTimer = 0;

  constructor(
    private els: StageEls,
    private hooks: TeachHooks,
  ) {
    this.laser = document.createElement("div");
    this.laser.className = "laser-dot";
    document.body.appendChild(this.laser);
    this.ensureGapStyle();
    const scroll = els.scroll;
    scroll.addEventListener("pointerdown", this.onPointerDown, { capture: true });
    scroll.addEventListener("pointermove", this.onPointerMove, { capture: true });
    scroll.addEventListener("pointerup", this.onPointerUp, { capture: true });
    scroll.addEventListener("pointercancel", this.onPointerUp, { capture: true });
    scroll.addEventListener("touchmove", this.onTouchMove, { passive: false });
    scroll.addEventListener("wheel", this.onWheel, { passive: false });
    scroll.addEventListener("scroll", this.onScroll, { passive: true });
    scroll.addEventListener("contextmenu", this.onContext);
    scroll.addEventListener("pointerleave", this.onPointerLeave);
    scroll.addEventListener("gesturestart", this.blockGesture);
    scroll.addEventListener("gesturechange", this.blockGesture);
    window.addEventListener("keydown", this.onKey);
    this.resizeObserver = new ResizeObserver(() => {
      const w = this.availableWidth();
      if (Math.abs(w - this.lastAvail) < 2) return;
      window.clearTimeout(this.resizeT);
      this.resizeT = window.setTimeout(() => this.relayoutKeepCenter(), 140);
    });
    this.resizeObserver.observe(scroll);
  }

  /** Injects CSS to force gap to strictly 0 or 1 line between pages. */
  private ensureGapStyle() {
    let styleEl = document.getElementById("teach-zero-gap-style") as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "teach-zero-gap-style";
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `
      .page-shell, [data-page], .page {
        margin-top: 0px !important;
        margin-bottom: 1px !important;
        padding: 0px !important;
      }
    `;
  }

  destroy() {
    this.alive = false;
    this.docGen++;
    this.stopMomentum();
    window.clearTimeout(this.pinchRerenderTimer);
    this.clearHoldPan();
    this.clearDoc();
    const scroll = this.els.scroll;
    scroll.removeEventListener("pointerdown", this.onPointerDown, { capture: true });
    scroll.removeEventListener("pointermove", this.onPointerMove, { capture: true });
    scroll.removeEventListener("pointerup", this.onPointerUp, { capture: true });
    scroll.removeEventListener("pointercancel", this.onPointerUp, { capture: true });
    scroll.removeEventListener("touchmove", this.onTouchMove);
    scroll.removeEventListener("wheel", this.onWheel);
    scroll.removeEventListener("scroll", this.onScroll);
    scroll.removeEventListener("contextmenu", this.onContext);
    scroll.removeEventListener("pointerleave", this.onPointerLeave);
    scroll.removeEventListener("gesturestart", this.blockGesture);
    scroll.removeEventListener("gesturechange", this.blockGesture);
    window.removeEventListener("keydown", this.onKey);
    this.resizeObserver.disconnect();
    this.laser.remove();
  }

  private onPointerDown = (e: PointerEvent) => {};
  private onPointerMove = (e: PointerEvent) => {};
  private onPointerUp = (e: PointerEvent) => {};
  private onTouchMove = (e: TouchEvent) => {};
  private onWheel = (e: WheelEvent) => {};
  private onScroll = () => {};
  private onContext = (e: Event) => { e.preventDefault(); };
  private onPointerLeave = () => {};
  private blockGesture = (e: Event) => { e.preventDefault(); };
  private onKey = (e: KeyboardEvent) => {};

  private availableWidth(): number {
    return this.els.scroll.clientWidth || window.innerWidth || 800;
  }

  private say(msg: string, ms = 2000) {
    this.patch({ status: msg });
  }

  private patch(p: TeachPatch) {
    this.hooks.patch(p);
  }

  private progress(label: string, ratio: number, show = true) {
    this.patch({ progress: show ? { label, ratio } : null });
  }

  private clearDoc() {
    if (this.pdf) {
      void this.pdf.destroy();
      this.pdf = null;
    }
    for (const url of this.ownedUrls) {
      URL.revokeObjectURL(url);
    }
    this.ownedUrls = [];
    this.doc = null;
    this.els.stage.innerHTML = "";
    this.pageByEl.clear();
  }

  private makePage(index: number, baseW: number, baseH: number): Page {
    const shell = document.createElement("div");
    shell.className = "page-shell";
    shell.style.margin = "0 0 1px 0";
    shell.style.padding = "0";

    const inner = document.createElement("div");
    inner.className = "page-inner";

    const fill = document.createElement("div");
    fill.className = "page-fill";

    const mediaLayer = document.createElement("div");
    mediaLayer.className = "media-layer";

    const tilesHost = document.createElement("div");
    tilesHost.className = "tiles-host";

    inner.appendChild(fill);
    inner.appendChild(tilesHost);
    inner.appendChild(mediaLayer);
    shell.appendChild(inner);

    const page: Page = {
      index,
      baseW,
      baseH,
      shell,
      inner,
      mediaLayer,
      tilesHost,
      tiles: [],
      objects: [],
      media: [],
      past: [],
      future: [],
      renderGen: 0,
      mounted: false,
      pdfNumber: index,
      paper: null,
    };
    this.pageByEl.set(shell, page);
    return page;
  }

  private packAssets(assets: File[]) {
    const map = new Map<string, string>();
    for (const f of assets) {
      const url = URL.createObjectURL(f);
      this.ownedUrls.push(url);
      map.set(f.name, url);
    }
    return { map };
  }

  private layout() {}
  private mountVisible(force = false) {}
  private emitDoc() {}
  private syncHistory() {}
  private clearVideoFocus() {}
  private clearSelection() {}
  private hideLaser() {}
  private stopMomentum() {}
  private clearHoldPan() {}
  private relayoutKeepCenter() {}
  private zoomAround(z: number) {}
  private currentPage(): Page | null {
    return this.doc?.pages[this.current - 1] ?? null;
  }
  private serialize(p: Page): string { return ""; }
  private restore(p: Page, raw: string) {}
  private syncMedia(p: Page) {}
  private paintPage(p: Page) {}
  private measureHtml(p: Page, w: number) {}
  private ensureTiles(p: Page) {}
  private watchHtml() {}
}
