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

const MOBILE_FIX = `<meta name="viewport" content="width=device-width, initial-scale=1">
<style id="teachpdf-view-fix">
html,body{margin:0;height:auto!important;min-height:0!important;overflow:visible!important;touch-action:auto!important;}
body{display:flow-root!important;}
/* Images/video fluid — but NOT canvas (interactive sims need crisp pixel sizing) */
img,video,svg{max-width:100%;height:auto;}
canvas{max-width:none;image-rendering:auto;}
video{
  background:#000;
  touch-action:manipulation!important;
  pointer-events:auto!important;
  -webkit-playsinline:true;
}
.page,.pdf-page,.pdfPage,.slide,section.page,[data-page]{
  display:block!important;visibility:visible!important;opacity:1!important;
  position:relative!important;inset:auto!important;transform:none!important;
  overflow:visible!important;height:auto!important;min-height:0;
  margin-top:0!important;margin-bottom:0!important;
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
/* Mobile-only layout helpers — do not blunt desktop HD canvas lessons */
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
    padding:10px!important;
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
        // Do not override apps that already size via their own resize();
        // only set CSS so the bitmap can fill crisply.
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
    // Yield more often on large files so the UI stays responsive
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
  // For very large HTML (embedded base64 video), avoid cloning the full <head>
  // into every page — only keep styles/scripts that are needed.
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

  // Prefer lightweight head: charset + viewport + style/link/script tags only
  const headBits: string[] = [];
  for (const node of doc.head?.children ?? []) {
    const tag = node.tagName;
    if (tag === "STYLE" || tag === "LINK" || tag === "META" || tag === "TITLE") {
      // Skip huge inline blobs accidentally placed in head
      if (tag === "STYLE" && (node.textContent?.length ?? 0) > 400_000) continue;
      headBits.push(node.outerHTML);
    } else if (tag === "SCRIPT") {
      const src = node.getAttribute("src");
      const text = node.textContent || "";
      // Keep small helper scripts; drop giant ones
      if (src || text.length < 80_000) headBits.push(node.outerHTML);
    }
  }
  const lightHead = headBits.join("\n");

  return useful.map((el) => {
    // Move the node (not clone) when possible to cut peak memory on 30MB files
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
        // Cap how many assets we wait for — huge base64 videos must not block UI
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
        // Do not wait on video metadata for data: URLs (can hang on mobile)
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
  /** Desktop: click-hold converts draw/laser into pan */
  private holdPanTimer = 0;
  private holdPanAt: { x: number; y: number } | null = null;
  /** Hand tool on HTML: wait to see if user clicks (video) or drags (pan) */
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

  flash(text: string) {
    this.say(text);
  }

  notePrefs() {
    const invert = this.hooks.getPrefs().invert;
    if (invert !== this.lastInvert) {
      this.lastInvert = invert;
      if (this.doc?.kind === "pdf") this.mountVisible(true);
    }
    const tool = this.hooks.getPrefs().tool;
    if (tool !== "hand") {
      this.clearVideoFocus();
      this.clearSelection();
      // Drawing / text tools must receive touches — HTML iframes would steal them
      this.setHtmlPointerPass(false);
    } else {
      // Hand tool: allow taps into video / interactive HTML
      this.setHtmlPointerPass(true);
    }
    // Desktop laser: hide system cursor; only the red laser dot is visible
    this.applyToolCursor(tool);
    if (tool !== "laser") this.hideLaser();
    this.syncHistory();
  }

  private applyToolCursor(tool: Tool) {
    const scroll = this.els.scroll;
    const fine = window.matchMedia("(pointer: fine)").matches;
    if (tool === "laser" && fine) {
      scroll.style.cursor = "none";
      scroll.dataset.toolCursor = "laser";
    } else if (tool === "pen" || tool === "highlighter") {
      scroll.style.cursor = fine ? "crosshair" : "";
      scroll.dataset.toolCursor = tool;
    } else if (tool === "eraser" || tool === "scrub") {
      scroll.style.cursor = fine ? "cell" : "";
      scroll.dataset.toolCursor = tool;
    } else if (tool === "text") {
      scroll.style.cursor = fine ? "text" : "";
      scroll.dataset.toolCursor = tool;
    } else {
      scroll.style.cursor = "";
      delete scroll.dataset.toolCursor;
    }
  }

  /** When false, HTML iframes ignore pointers so pen/text/shapes can draw on top. */
  private setHtmlPointerPass(pass: boolean) {
    if (!this.doc) return;
    for (const page of this.doc.pages) {
      const iframe = page.iframe;
      if (!iframe) continue;
      if (pass) {
        iframe.style.pointerEvents = "auto";
        iframe.style.touchAction = "auto";
      } else {
        iframe.style.pointerEvents = "none";
        iframe.style.touchAction = "none";
      }
    }
  }

  async openFiles(files: File[]) {
    const list = [...files];
    if (!list.length) return;
    const htmls = list.filter(isHtml);
    const pdfs = list.filter(isPdf);
    const media = list.filter(isMedia);
    try {
      if (htmls.length) {
        const main =
          htmls.find((f) => /(^|\/)index\.html?$/i.test(f.webkitRelativePath || f.name)) ?? htmls[0];
        await this.openHtmlFile(
          main,
          list.filter((f) => f !== main),
        );
        return;
      }
      if (pdfs.length && media.length === 0) {
        await this.openPdfFile(pdfs[0]);
        return;
      }
      if (media.length) {
        await this.openGallery(media);
        return;
      }
      this.say("Use a PDF, an HTML file, or a picture / GIF / video.");
    } catch (err) {
      console.error(err);
      this.patch({ progress: null });
      this.say(err instanceof Error ? err.message : "Could not open that file", 3600);
    }
  }

  async openPdfFile(file: File) {
    const gen = ++this.docGen;
    const mb = file.size / (1024 * 1024);
    if (file.size > HUGE_PDF_BYTES) {
      this.say(`Very large PDF (${mb.toFixed(0)} MB) — this may take a while`, 3200);
    } else if (file.size > LARGE_PDF_BYTES) {
      this.say(`Loading ${mb.toFixed(0)} MB PDF…`, 2400);
    }
    this.progress("Reading PDF…", 0, true);
    const bytes = await readBytes(file, (n) => {
      if (gen === this.docGen) this.progress("Reading PDF…", n, false);
    });
    if (gen !== this.docGen || !this.alive) return;
    this.progress("Opening PDF…", 1, false);
    const pdfjs = await loadPdfjs();
    if (gen !== this.docGen || !this.alive) return;
    const task = pdfjs.getDocument({
      data: bytes,
      isEvalSupported: false,
      disableAutoFetch: true,
      disableStream: false,
      verbosity: 0,
    });
    const pdf = (await task.promise) as unknown as PdfDocProxy;
    if (gen !== this.docGen || !this.alive) {
      await pdf.destroy();
      return;
    }
    this.clearDoc();
    this.pdf = pdf;
    this.pdfBlob = file;
    this.docName = file.name.replace(/\.pdf$/i, "") || "lesson";
    this.doc = { kind: "pdf", pages: [] };
    this.userZoom = 1;
    this.committedZoom = 1;
    this.visualRatio = 1;
    const yieldEvery = pdf.numPages > 40 || file.size > LARGE_PDF_BYTES ? 2 : 4;
    for (let i = 1; i <= pdf.numPages; i++) {
      if (gen !== this.docGen) return;
      const proxy = await pdf.getPage(i);
      const vp = proxy.getViewport({ scale: 1 });
      const made = this.makePage(i, vp.width, vp.height);
      made.pdfNumber = i;
      this.doc.pages.push(made);
      proxy.cleanup();
      if (i === 1 || i % yieldEvery === 0) {
        this.progress("Preparing pages…", i / pdf.numPages, false);
        this.layout();
        await yieldThread();
      }
    }
    this.current = 1;
    this.layout();
    this.mountVisible(true);
    this.emitDoc();
    this.patch({ progress: null });
    this.say(`${pdf.numPages} page${pdf.numPages === 1 ? "" : "s"} ready`);
    this.els.scroll.scrollTop = 0;
    this.els.scroll.scrollLeft = 0;
  }

  async openHtmlText(name: string, html: string, assets: File[] = []) {
    const gen = ++this.docGen;
    this.progress("Opening HTML…", 0.15, true);
    if (!this.alive) return;
    this.clearDoc();
    if (gen !== this.docGen || !this.alive) return;
    const packed = this.packAssets(assets);
    const source = injectFix(rewriteAssets(html, packed.map));
    if (gen !== this.docGen || !this.alive) return;
    this.htmlSource = source;
    this.docName = name.replace(/\.html?$/i, "") || "lesson";
    this.userZoom = 1;
    this.committedZoom = 1;
    this.visualRatio = 1;
    const docs = splitHtmlDocuments(source);
    // Free the giant source string from the open path ASAP after split
    // Desktop: match page width to the viewport so CSS scale stays ~1 (sharp canvas).
    // Mobile: keep a sensible min width.
    const avail = this.availableWidth();
    const fine = typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
    const layoutW = fine
      ? Math.max(480, Math.min(1600, avail))
      : Math.max(280, Math.min(960, avail));
    const pages: Page[] = [];
    for (let i = 0; i < docs.length; i++) {
      const page = this.makePage(i + 1, layoutW, Math.round(layoutW * 1.25));
      pages.push(page);
      const blob = new Blob([docs[i]], { type: "text/html" });
      // Drop page HTML string from array to help GC on 30MB lessons
      docs[i] = "";
      const url = URL.createObjectURL(blob);
      this.ownedUrls.push(url);
      const iframe = document.createElement("iframe");
      iframe.className = "html-frame";
      iframe.style.zIndex = "1";
      iframe.setAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-forms allow-popups allow-presentation",
      );
      iframe.setAttribute("allow", "autoplay; fullscreen; picture-in-picture");
      iframe.setAttribute("scrolling", "no");
      iframe.referrerPolicy = "no-referrer";
      // Lazy: only the first page (and later visible ones) get src immediately
      iframe.dataset.src = url;
      if (i === 0) iframe.src = url;
      page.iframe = iframe;
      const fill = page.inner.querySelector(".page-fill");
      if (fill instanceof HTMLElement) fill.style.display = "none";
      page.inner.appendChild(iframe);
      if (i === 0 || i % 2 === 1) {
        this.progress("Opening HTML…", 0.2 + (0.3 * (i + 1)) / docs.length, false);
        await yieldThread();
      }
    }
    this.doc = { kind: "html", pages };
    this.setHtmlPointerPass(this.hooks.getPrefs().tool === "hand");
    this.current = 1;
    this.layout();
    this.emitDoc();
    // Measure page 0 fully; others get a quick measure after lazy load
    for (let i = 0; i < pages.length; i++) {
      if (gen !== this.docGen || !this.alive) return;
      const frame = pages[i].iframe;
      if (frame?.src) {
        await waitForFrame(frame, i === 0 ? 2000 : 1200);
        this.measureHtml(pages[i], layoutW);
      } else {
        // Placeholder height until the page is scrolled into view
        pages[i].baseH = Math.round(layoutW * 1.15);
        this.ensureTiles(pages[i]);
      }
      this.progress("Laying out HTML…", 0.55 + (0.4 * (i + 1)) / pages.length, false);
      if (i % 2 === 1) await yieldThread();
    }
    if (gen !== this.docGen || !this.alive) return;
    this.watchHtml();
    this.layout();
    this.mountVisible(true);
    this.patch({ progress: null });
    this.say(
      pages.length > 1
        ? `HTML ready — ${pages.length} pages (large pages load as you scroll)`
        : "HTML ready — GIFs and video stay live",
    );
    this.els.scroll.scrollTop = 0;
    this.els.scroll.scrollLeft = 0;
    window.setTimeout(() => {
      if (gen !== this.docGen || this.doc?.kind !== "html") return;
      // Only remeasure pages that already have content loaded
      for (const page of this.doc.pages) {
        if (page.iframe?.src) this.measureHtml(page, layoutW);
      }
      this.layout();
      this.mountVisible(false);
    }, 500);
  }

  undo() {
    const page = this.currentPage();
    if (!page?.past.length) {
      this.say("Nothing to undo");
      return;
    }
    page.future.push(this.serialize(page));
    const raw = page.past.pop();
    if (raw) this.restore(page, raw);
    this.syncHistory();
  }

  redo() {
    const page = this.currentPage();
    if (!page?.future.length) {
      this.say("Nothing to redo");
      return;
    }
    page.past.push(this.serialize(page));
    const raw = page.future.pop();
    if (raw) this.restore(page, raw);
    this.syncHistory();
  }

  clearPage() {
    const page = this.currentPage();
    if (!page) return;
    if (!page.objects.length && !page.media.length) {
      this.say("This page is already clear");
      return;
    }
    this.snapshot(page);
    page.objects = [];
    page.media = [];
    this.syncMedia(page);
    this.paintPage(page);
    this.say("Page cleared");
  }

  addBlank(tone: "white" | "black") {
    const paper = tone === "black" ? "#111111" : "#ffffff";
    if (!this.doc) {
      this.docName = "blank";
      this.userZoom = 1;
      this.committedZoom = 1;
      this.visualRatio = 1;
      this.doc = { kind: "pdf", pages: [] };
      this.current = 0;
    }
    const ref = this.currentPage();
    const page = this.makePage(this.doc.pages.length + 1, ref?.baseW || 612, ref?.baseH || 792);
    page.paper = paper;
    page.pdfNumber = null;
    const fill = page.inner.querySelector(".page-fill");
    if (fill instanceof HTMLElement) {
      fill.style.display = "grid";
      fill.style.background = paper;
      fill.style.color = tone === "black" ? "#9ca3af" : "#8a8175";
      fill.textContent = "Blank";
    }
    const at = this.doc.pages.length ? Math.min(this.doc.pages.length, Math.max(0, this.current)) : 0;
    this.doc.pages.splice(at, 0, page);
    this.orderPages();
    this.current = at + 1;
    this.layout();
    this.mountVisible(true);
    this.emitDoc();
    this.syncHistory();
    this.goTo(this.current);
    this.say(tone === "black" ? "Black page added" : "White page added");
  }

  private orderPages() {
    if (!this.doc) return;
    for (let index = 0; index < this.doc.pages.length; index++) {
      const page = this.doc.pages[index];
      page.index = index + 1;
      page.shell.dataset.page = String(page.index);
      this.els.stage.appendChild(page.shell);
    }
  }

  zoomIn() {
    this.zoomAround(this.userZoom * 1.2);
  }

  zoomOut() {
    this.zoomAround(this.userZoom / 1.2);
  }

  fit() {
    this.zoomAround(1);
  }

  prev() {
    this.goTo(this.current - 1);
  }

  next() {
    this.goTo(this.current + 1);
  }

  goTo(n: number) {
    const page = this.doc?.pages[n - 1];
    if (!page) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    page.shell.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  async askPage() {
    if (!this.doc) return;
    const n = await this.hooks.requestPage(this.current, this.doc.pages.length);
    if (n && n >= 1 && n <= this.doc.pages.length) this.goTo(n);
  }

  async insertMedia(file: File) {
    const page = this.currentPage();
    if (!page) {
      this.say("Open a lesson first");
      return;
    }
    if (!isMedia(file)) {
      this.say("Choose an image, GIF, or video");
      return;
    }
    if (file.size > LARGE_MEDIA_BYTES) {
      const mb = (file.size / (1024 * 1024)).toFixed(0);
      this.say(`Large media (${mb} MB) — may use more memory`, 2600);
    }
    const url = URL.createObjectURL(file);
    this.ownedUrls.push(url);
    this.urlFiles.set(url, file);
    const kind = mediaKind(file);
    const dims = await measureBox(url, kind);
    const maxW = page.baseW * 0.46;
    const maxH = Math.min(page.baseH * 0.34, 420);
    const k = Math.min(1, maxW / dims.w, maxH / dims.h);
    const w = Math.max(48, dims.w * k);
    const h = Math.max(48, dims.h * k);
    this.snapshot(page);
    const media: MediaObj = {
      id: uid(),
      kind,
      src: url,
      x: page.baseW * 0.08,
      y: this.visibleY(page),
      w,
      h,
      rotation: 0,
    };
    page.media.push(media);
    this.syncMedia(page);
    this.selectMedia(media.id);
    this.say(
      kind === "video"
        ? "Video added — drag / rotate / resize"
        : /gif$/i.test(file.type) || /\.gif$/i.test(file.name)
          ? "GIF added — drag / rotate / resize"
          : "Image added — drag / rotate / resize",
    );
  }

  deleteSelectedMedia() {
    if (!this.selectedMediaId) return false;
    for (const page of this.doc?.pages ?? []) {
      const idx = page.media.findIndex((m) => m.id === this.selectedMediaId);
      if (idx < 0) continue;
      this.snapshot(page);
      page.media.splice(idx, 1);
      this.syncMedia(page);
      this.clearSelection();
      this.say("Removed");
      return true;
    }
    return false;
  }

  clearSelection() {
    if (!this.selectedMediaId) return;
    this.selectedMediaId = null;
    this.doc?.pages.forEach((p) => {
      p.mediaLayer.querySelectorAll(".media-item.is-on").forEach((el) => el.classList.remove("is-on"));
      p.mediaLayer.querySelectorAll(".media-handle, .media-rotate").forEach((el) => {
        (el as HTMLElement).style.display = "none";
      });
    });
    this.patch({ selectedMedia: false });
  }

  private selectMedia(id: string | null) {
    this.selectedMediaId = id;
    this.doc?.pages.forEach((p) => {
      p.mediaLayer.querySelectorAll<HTMLElement>(".media-item").forEach((el) => {
        const on = el.dataset.id === id;
        el.classList.toggle("is-on", on);
        el.querySelectorAll<HTMLElement>(".media-handle, .media-rotate").forEach((h) => {
          h.style.display = on ? "" : "none";
        });
      });
    });
    this.patch({ selectedMedia: !!id });
  }

  async save() {
    if (!this.doc) {
      this.say("Open a lesson first");
      return;
    }
    try {
      if (this.doc.kind === "pdf") await this.savePdf();
      else await this.saveHtml();
    } catch (err) {
      console.error(err);
      this.patch({ progress: null });
      this.say(err instanceof Error ? err.message : "Could not save", 3600);
    }
  }

  clearVideoFocus() {
    this.videoFocus = false;
    this.doc?.pages.forEach((p) => {
      if (!p.iframe) return;
      p.iframe.classList.remove("is-live");
      // Keep pointer-events auto so interactive pages remain usable
      const hand = this.hooks.getPrefs().tool === "hand";
      p.iframe.style.pointerEvents = hand ? "auto" : "none";
    });
    this.patch({ video: false });
  }

  /** Freeze heavy GIF / video animation so page scrolling stays smooth. */
  freezeAnimations() {
    if (!this.doc) {
      this.say("Open a lesson first");
      return;
    }
    let n = 0;
    for (const page of this.doc.pages) {
      // Annotated media layer
      for (const media of page.media) {
        if (media.kind === "video") {
          const el = page.mediaLayer.querySelector(`[data-id="${media.id}"] video`) as HTMLVideoElement | null;
          if (el && !el.paused) {
            el.pause();
            n++;
          }
        } else if (/\.gif($|\?)/i.test(media.src) || media.src.startsWith("data:image/gif")) {
          const img = page.mediaLayer.querySelector(`[data-id="${media.id}"] img`) as HTMLImageElement | null;
          if (img && !img.dataset.frozen) {
            try {
              const c = document.createElement("canvas");
              c.width = img.naturalWidth || img.width || 1;
              c.height = img.naturalHeight || img.height || 1;
              c.getContext("2d")?.drawImage(img, 0, 0);
              img.dataset.liveSrc = img.src;
              img.src = c.toDataURL("image/png");
              img.dataset.frozen = "1";
              n++;
            } catch {
              /* ignore */
            }
          }
        }
      }
      // HTML document iframes (lesson GIFs / videos inside the page)
      const doc = page.iframe?.contentDocument;
      if (!doc) continue;
      for (const img of [...doc.querySelectorAll("img")]) {
        const src = img.currentSrc || img.src || "";
        if (!/\.gif($|\?)/i.test(src) && !src.startsWith("data:image/gif")) continue;
        if (img.dataset.frozen) continue;
        try {
          const c = document.createElement("canvas");
          c.width = img.naturalWidth || img.width || 1;
          c.height = img.naturalHeight || img.height || 1;
          c.getContext("2d")?.drawImage(img, 0, 0);
          img.dataset.liveSrc = img.src;
          img.src = c.toDataURL("image/png");
          img.dataset.frozen = "1";
          n++;
        } catch {
          /* ignore */
        }
      }
      for (const video of [...doc.querySelectorAll("video")]) {
        if (!video.paused) {
          video.pause();
          n++;
        }
      }
    }
    this.say(n ? `Paused ${n} animation${n === 1 ? "" : "s"}` : "Nothing to pause");
  }

  /** Restore GIFs that were frozen (videos stay paused until user plays). */
  unfreezeAnimations() {
    if (!this.doc) return;
    let n = 0;
    for (const page of this.doc.pages) {
      for (const media of page.media) {
        const img = page.mediaLayer.querySelector(`[data-id="${media.id}"] img`) as HTMLImageElement | null;
        if (img?.dataset.frozen && img.dataset.liveSrc) {
          img.src = img.dataset.liveSrc;
          delete img.dataset.frozen;
          delete img.dataset.liveSrc;
          n++;
        }
      }
      const doc = page.iframe?.contentDocument;
      if (!doc) continue;
      for (const img of [...doc.querySelectorAll("img")]) {
        if (img.dataset.frozen && img.dataset.liveSrc) {
          img.src = img.dataset.liveSrc;
          delete img.dataset.frozen;
          delete img.dataset.liveSrc;
          n++;
        }
      }
    }
    this.say(n ? `Restored ${n} GIF${n === 1 ? "" : "s"}` : "Nothing to restore");
  }

  async fillThumbs(host: HTMLElement) {
    const token = ++this.thumbToken;
    host.replaceChildren();
    if (!this.doc) return;
    for (const page of this.doc.pages) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "thumb" + (page.index === this.current ? " is-on" : "");
      const canvas = document.createElement("canvas");
      canvas.width = 72;
      canvas.height = 96;
      const label = document.createElement("span");
      label.textContent = `Page ${page.index}`;
      btn.append(canvas, label);
      btn.addEventListener("click", () => {
        this.goTo(page.index);
        this.hooks.onJump();
      });
      host.append(btn);
      page.thumbBtn = btn;
    }
    for (const page of this.doc.pages) {
      if (token !== this.thumbToken) return;
      if (page.paper) {
        const canvas = page.thumbBtn?.querySelector("canvas");
        const ctx = canvas?.getContext("2d");
        if (canvas && ctx) {
          ctx.fillStyle = page.paper;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        continue;
      }
      if (this.doc.kind !== "pdf" || !this.pdf || !page.pdfNumber) continue;
      try {
        const proxy = await this.pdf.getPage(page.pdfNumber);
        if (token !== this.thumbToken) {
          proxy.cleanup();
          return;
        }
        const base = proxy.getViewport({ scale: 1 });
        const viewport = proxy.getViewport({ scale: 68 / base.width });
        const canvas = page.thumbBtn?.querySelector("canvas");
        if (canvas) {
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext("2d");
          if (ctx) await proxy.render({ canvasContext: ctx, viewport }).promise;
        }
        proxy.cleanup();
      } catch {
        /* thumbnail is optional */
      }
      await yieldThread();
    }
  }

  private async openHtmlFile(file: File, assets: File[]) {
    const gen = ++this.docGen;
    const mb = file.size / (1024 * 1024);
    if (file.size > HUGE_HTML_BYTES) {
      this.say(`Large file (${mb.toFixed(0)} MB) — loading with low memory mode…`, 3200);
    } else if (file.size > LARGE_HTML_BYTES) {
      this.say(`Loading ${mb.toFixed(0)} MB HTML — pages open as you scroll`, 2800);
    }
    this.progress("Reading HTML…", 0, true);
    const text = await readText(file, (n) => {
      if (gen === this.docGen) this.progress("Reading HTML…", n, false);
    });
    if (gen !== this.docGen || !this.alive) return;
    await this.openHtmlText(file.name, text, assets);
  }

  private async openGallery(files: File[]) {
    const assets: File[] = [];
    const bits = files.map((file, index) => {
      const key = `teach-media-${index}-${file.name.replace(/[^\w.]+/g, "_")}`;
      assets.push(new File([file], key, { type: file.type }));
      const tag =
        mediaKind(file) === "video"
          ? `<video src="${key}" controls playsinline webkit-playsinline preload="metadata"></video>`
          : `<img src="${key}" alt="${esc(file.name)}">`;
      return `<figure>${tag}<figcaption>${esc(file.name)}</figcaption></figure>`;
    });
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;font-family:sans-serif;background:#111;color:#eee}
      figure{margin:0;padding:16px}
      img,video{max-width:100%;height:auto;display:block;margin:0 auto;background:#000}
      figcaption{font-size:13px;opacity:.75;margin-top:6px}
    </style></head><body>${bits.join("")}</body></html>`;
    await this.openHtmlText("media-lesson.html", html, assets);
  }

  private packAssets(files: File[]) {
    const map = new Map<string, string>();
    for (const file of files) {
      const url = URL.createObjectURL(file);
      this.ownedUrls.push(url);
      this.urlFiles.set(url, file);
      map.set(file.name, url);
      const rel = file.webkitRelativePath;
      if (rel) {
        map.set(rel, url);
        map.set(rel.replace(/^\.\//, ""), url);
        const base = rel.split("/").pop();
        if (base) map.set(base, url);
      }
    }
    return { map };
  }

  private measureHtml(page: Page, layoutW: number) {
    const doc = page.iframe?.contentDocument;
    if (!doc?.body) {
      page.baseH = Math.round(layoutW * 1.25);
      this.ensureTiles(page);
      return;
    }
    const body = doc.body;
    const root = doc.documentElement;
    const fine =
      typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
    const narrow = layoutW < 760;

    const contentW = Math.max(260, layoutW - 24);
    const interactH = Math.round(
      Math.min(720, Math.max(contentW * 1.05, Math.min(contentW * 1.2, 560))),
    );

    // Only force interactive wrapper sizes on small / touch layouts.
    // Desktop HD lessons (canvas sims) keep their own CSS.
    if (!fine || narrow) {
      for (const wrap of body.querySelectorAll(".iframe-wrap")) {
        if (!(wrap instanceof HTMLElement)) continue;
        wrap.style.boxSizing = "border-box";
        wrap.style.width = "100%";
        wrap.style.maxWidth = "100%";
        wrap.style.height = `${interactH}px`;
        wrap.style.minHeight = `${interactH}px`;
        wrap.style.maxHeight = "none";
        wrap.style.margin = "0 auto";
        wrap.style.overflow = "hidden";
        for (const frame of wrap.querySelectorAll("iframe, .live-frame")) {
          if (!(frame instanceof HTMLElement)) continue;
          frame.style.width = "100%";
          frame.style.height = "100%";
          frame.style.minHeight = `${interactH}px`;
          frame.style.border = "0";
          frame.style.display = "block";
        }
      }

      for (const pageEl of body.querySelectorAll(".page, section.page")) {
        if (!(pageEl instanceof HTMLElement)) continue;
        pageEl.style.minHeight = "auto";
        pageEl.style.padding = "10px";
      }
    }

    for (const vid of body.querySelectorAll("video")) {
      if (!(vid instanceof HTMLVideoElement)) continue;
      vid.style.boxSizing = "border-box";
      vid.style.maxWidth = "100%";
      vid.style.width = "100%";
      vid.style.height = "auto";
      vid.style.maxHeight = "none";
      vid.style.display = "block";
      vid.style.margin = "0 auto";
      vid.controls = true;
      vid.setAttribute("playsinline", "");
      vid.setAttribute("webkit-playsinline", "");
      if (vid.videoWidth > 0 && vid.videoHeight > 0) {
        const ratio = vid.videoHeight / vid.videoWidth;
        vid.style.aspectRatio = `${vid.videoWidth} / ${vid.videoHeight}`;
        const ideal = Math.round(contentW * ratio);
        if (ideal > 120) vid.style.minHeight = `${Math.min(ideal, 720)}px`;
      } else if (!fine || narrow) {
        vid.style.minHeight = `${Math.round(contentW * 0.56)}px`;
      }
    }

    for (const img of body.querySelectorAll("img")) {
      if (!(img instanceof HTMLImageElement)) continue;
      img.style.maxWidth = "100%";
      img.style.height = "auto";
      img.style.maxHeight = "none";
    }

    // Canvas scenes: ensure they fill their container crisply on desktop
    for (const canvas of body.querySelectorAll("canvas")) {
      if (!(canvas instanceof HTMLCanvasElement)) continue;
      const parent = canvas.parentElement;
      if (parent instanceof HTMLElement) {
        // Prefer container-driven size (solar system .scene)
        if (!canvas.style.width) canvas.style.width = "100%";
        if (!canvas.style.height) canvas.style.height = "100%";
      }
    }

    // Shrink the frame while measuring. Otherwise scrollHeight is never smaller
    // than the frame's own (placeholder) height, which caused the huge page gaps.
    if (page.iframe) {
      page.iframe.style.position = "absolute";
      page.iframe.style.height = "8px";
    }
    void body.offsetHeight;

    const sw = Math.max(root.scrollWidth, body.scrollWidth, layoutW);
    let sh = Math.max(root.scrollHeight, body.scrollHeight, 8);

    let stack = 0;
    for (const el of body.querySelectorAll("img,video,canvas,svg,iframe,.iframe-wrap,.page")) {
      if (!(el instanceof HTMLElement)) continue;
      const rect = el.getBoundingClientRect();
      stack = Math.max(stack, rect.bottom);
      const natural =
        el instanceof HTMLImageElement
          ? el.naturalHeight
          : el instanceof HTMLVideoElement
            ? el.videoHeight
            : 0;
      if (rect.height < 8 && natural > 8) stack = Math.max(stack, rect.top + natural);
    }

    // Also account for fixed/absolute labels (page-number, gif-label) that
    // sit outside the main flow on some interactive pages.
    for (const el of body.querySelectorAll(".page-number,.gif-label,.tap-to-play")) {
      if (!(el instanceof HTMLElement)) continue;
      const rect = el.getBoundingClientRect();
      stack = Math.max(stack, rect.bottom + 12);
    }

    // rect values are already in the iframe's own CSS pixels — no rescaling.
    if (stack > 8) sh = Math.max(sh, stack);

    // Prefer content width when the HTML is wider than the phone, but keep
    // a sensible minimum so text does not crush the interactive area.
    if (sw > layoutW + 48) page.baseW = Math.min(sw, 2400);
    else page.baseW = layoutW;

    // Use real content height — do not pad hundreds of empty pixels between pages
    const hasInteract = !!body.querySelector(".iframe-wrap, .live-frame, video, canvas");
    const minH = hasInteract ? 120 : 24;
    page.baseH = Math.min(80000, Math.max(minH, Math.ceil(sh + 16)));
    this.ensureTiles(page);

    // Size the iframe itself to fill the page so touches hit the content
    if (page.iframe) {
      page.iframe.style.position = "absolute";
      page.iframe.style.left = "0";
      page.iframe.style.top = "0";
      page.iframe.style.width = "100%";
      page.iframe.style.height = "100%";
      page.iframe.style.border = "0";
      page.iframe.style.touchAction = "auto";
      // Ask the lesson to re-measure (canvas resize / HD redraw)
      try {
        page.iframe.contentWindow?.dispatchEvent(new Event("resize"));
      } catch {
        /* ignore */
      }
    }
  }

  private watchHtml() {
    this.htmlObserver?.disconnect();
    if (this.doc?.kind !== "html") return;
    this.htmlObserver = new ResizeObserver(() => {
      if (this.doc?.kind !== "html") return;
      // Never reflow while pinching — this was freezing zoom on large HTML
      if (this.mode === "pinch") return;
      let grew = false;
      for (const page of this.doc.pages) {
        const doc = page.iframe?.contentDocument;
        if (!doc) continue;
        const sh = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0);
        const next = Math.min(80000, Math.max(page.baseH, sh));
        if (next > page.baseH + 24) {
          page.baseH = next;
          this.ensureTiles(page);
          grew = true;
        }
      }
      if (grew) {
        this.layout();
        this.mountVisible(false);
      }
    });
    for (const page of this.doc.pages) {
      const body = page.iframe?.contentDocument?.body;
      if (body) this.htmlObserver.observe(body);
    }
  }

  private makePage(index: number, baseW: number, baseH: number) {
    const shell = document.createElement("div");
    shell.className = "page-shell";
    shell.dataset.page = String(index);
    const inner = document.createElement("div");
    inner.className = "page-inner";
    const fill = document.createElement("div");
    fill.className = "page-fill";
    fill.textContent = `Page ${index}`;
    const mediaLayer = document.createElement("div");
    mediaLayer.className = "media-layer";
    const tilesHost = document.createElement("div");
    tilesHost.className = "tiles-host";
    // Ink must not block video controls / HTML hits underneath
    tilesHost.style.pointerEvents = "none";
    mediaLayer.style.pointerEvents = "none";
    mediaLayer.style.position = "absolute";
    mediaLayer.style.inset = "0";
    mediaLayer.style.zIndex = "2";
    tilesHost.style.position = "absolute";
    tilesHost.style.inset = "0";
    tilesHost.style.zIndex = "3";
    inner.append(fill, mediaLayer, tilesHost);
    shell.appendChild(inner);
    this.els.stage.appendChild(shell);
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
      pdfNumber: null,
      paper: null,
    };
    this.pageByEl.set(shell, page);
    this.ensureTiles(page);
    return page;
  }

  private ensureTiles(page: Page) {
    const count = Math.max(1, Math.ceil(page.baseH / TILE));
    while (page.tiles.length < count) {
      const i = page.tiles.length;
      const y0 = i * TILE;
      const h = Math.min(TILE, Math.max(1, page.baseH - y0));
      const el = document.createElement("div");
      el.className = "ink-tile";
      el.style.top = `${y0}px`;
      el.style.height = `${h}px`;
      page.tilesHost.appendChild(el);
      page.tiles.push({ y0, baseH: h, el, canvas: null, ctx: null });
    }
    const last = page.tiles[page.tiles.length - 1];
    const h = Math.min(TILE, Math.max(1, page.baseH - last.y0));
    if (Math.abs(h - last.baseH) > 1) {
      last.baseH = h;
      last.el.style.height = `${h}px`;
    }
  }

  private clearDoc() {
    this.thumbToken++;
    this.htmlObserver?.disconnect();
    this.htmlObserver = null;
    this.clearVideoFocus();
    this.selectedMediaId = null;
    try {
      this.pdf?.destroy();
    } catch {
      /* already gone */
    }
    this.pdf = null;
    this.pdfBlob = null;
    this.htmlSource = "";
    for (const url of this.ownedUrls) URL.revokeObjectURL(url);
    this.ownedUrls = [];
    this.urlFiles.clear();
    this.pageByEl.clear();
    this.doc = null;
    this.draft = null;
    this.els.stage.replaceChildren();
    this.els.stage.style.transform = "";
    this.els.stage.classList.remove("is-pinching");
    this.els.sizer.style.width = "";
    this.els.sizer.style.height = "";
  }

  private availableWidth() {
    return Math.max(220, this.els.scroll.clientWidth - 24);
  }

  private displayScale() {
    const base = this.doc?.pages[0]?.baseW || 1;
    return (this.availableWidth() / base) * this.committedZoom;
  }

  private layout() {
    if (!this.doc) return;
    this.lastAvail = this.availableWidth();
    let S = this.displayScale();
    // Snap tiny floating error so 100% stays crystal-sharp (no CSS scale)
    if (Math.abs(S - 1) < 0.02) S = 1;
    this.applyChromeSpace();
    for (const page of this.doc.pages) {
      const w = page.baseW * S;
      const h = page.baseH * S;
      page.shell.style.width = `${w}px`;
      page.shell.style.height = `${h}px`;
      page.shell.style.marginLeft = "auto";
      page.shell.style.marginRight = "auto";
      // Always keep inner at base pixel size; scale with transform when zoom ≠ 100%.
      // At 100% transform is none → HTML canvas stays sharp.
      page.inner.style.width = `${page.baseW}px`;
      page.inner.style.height = `${page.baseH}px`;
      page.inner.style.transformOrigin = "0 0";
      page.inner.style.transform = S === 1 ? "none" : `scale(${S})`;
      page.inner.style.setProperty("--page-scale", String(S));
      if (page.iframe) {
        page.iframe.style.width = "100%";
        page.iframe.style.height = "100%";
        page.iframe.style.transform = "none";
      }
      // Reset any one-off ink/media transforms from older builds
      if (page.tilesHost) {
        page.tilesHost.style.transform = "";
        page.tilesHost.style.width = "";
        page.tilesHost.style.height = "";
        page.tilesHost.style.pointerEvents = "none";
      }
      if (page.mediaLayer) {
        page.mediaLayer.style.transform = "";
        page.mediaLayer.style.width = "";
        page.mediaLayer.style.height = "";
        page.mediaLayer.style.pointerEvents = "none";
      }
    }
    if (Math.abs(this.visualRatio - 1) < 0.001) {
      this.els.stage.style.transform = "";
      this.els.sizer.style.width = "";
      this.els.sizer.style.height = "";
      this.els.sizer.style.minWidth = "";
    }
  }

  private applyChromeSpace() {
    // Simple block stack: no flex gap (flex + CSS-scaled pages created huge empty bands).
    // Only a small margin under each page shell (~one text line).
    const stage = this.els.stage;
    stage.style.setProperty("display", "block", "important");
    stage.style.setProperty("padding", "4px", "important");
    stage.style.setProperty("gap", "0", "important");
    stage.style.setProperty("row-gap", "0", "important");
    stage.style.setProperty("column-gap", "0", "important");
    for (const page of this.doc?.pages ?? []) {
      page.shell.style.setProperty("display", "block", "important");
      page.shell.style.setProperty("margin", "0 auto 4px auto", "important");
      page.shell.style.setProperty("padding", "0", "important");
    }
  }

  private ensureGapStyle() {
    const old = document.getElementById("teachpdf-gap-fix");
    if (old) old.remove();
    const prev = document.getElementById("teachpdf-gap-fix-v2");
    if (prev) prev.remove();
    const s = document.createElement("style");
    s.id = "teachpdf-gap-fix-v2";
    s.textContent = `
      .teach-stage {
        display: block !important;
        gap: 0 !important;
        row-gap: 0 !important;
        column-gap: 0 !important;
        padding: 4px !important;
      }
      .page-shell {
        display: block !important;
        margin: 0 auto 4px auto !important;
        padding: 0 !important;
      }
      .page-inner {
        margin: 0 !important;
        padding: 0 !important;
      }
      .tiles-host { pointer-events: none !important; }
      .media-item video, .html-frame video {
        pointer-events: auto !important;
        touch-action: manipulation !important;
      }
    `;
    document.head.appendChild(s);
  }

  private applyTransform() {
    const R = this.visualRatio;
    this.applyChromeSpace();
    const idle = Math.abs(R - 1) < 0.001;
    if (idle) {
      this.els.stage.style.transform = "";
      this.els.stage.classList.remove("is-pinching");
      return;
    }
    this.els.stage.style.transform = `scale(${R})`;
    this.els.stage.style.transformOrigin = "0 0";
    this.els.stage.classList.add("is-pinching");
  }

  private relayoutKeepCenter() {
    if (!this.doc || this.mode === "pinch") return;
    if (Math.abs(this.visualRatio - 1) > 0.001) this.commitZoom();
    const el = this.els.scroll;
    const fx = (el.scrollLeft + el.clientWidth / 2) / Math.max(1, this.els.sizer.scrollWidth);
    const fy = (el.scrollTop + el.clientHeight / 2) / Math.max(1, this.els.sizer.scrollHeight);
    this.layout();
    this.mountVisible(true);
    el.scrollLeft = fx * this.els.sizer.scrollWidth - el.clientWidth / 2;
    el.scrollTop = fy * this.els.sizer.scrollHeight - el.clientHeight / 2;
  }

  private zoomAround(next: number) {
    if (!this.doc) return;
    if (Math.abs(this.visualRatio - 1) > 0.001) this.commitZoom();
    const rect = this.els.scroll.getBoundingClientRect();
    this.zoomAt(next, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  private zoomAt(next: number, clientX: number, clientY: number) {
    if (!this.doc) return;
    next = clamp(next, MIN_Z, MAX_Z);
    const old = Math.max(0.05, this.committedZoom);
    if (Math.abs(next - old) < 0.001) {
      this.hooks.onZoom(this.userZoom);
      return;
    }
    const scroll = this.els.scroll;
    const rect = scroll.getBoundingClientRect();
    const ox = clientX - rect.left;
    const oy = clientY - rect.top;
    const layoutX = scroll.scrollLeft + ox;
    const layoutY = scroll.scrollTop + oy;
    const applied = next / old;
    this.userZoom = next;
    this.committedZoom = next;
    this.visualRatio = 1;
    this.els.stage.style.transform = "";
    this.els.stage.classList.remove("is-pinching");
    try {
      this.layout();
      scroll.scrollLeft = Math.max(0, layoutX * applied - ox);
      scroll.scrollTop = Math.max(0, layoutY * applied - oy);
    } catch {
      /* ignore layout errors */
    }
    this.mountVisible(true);
    this.hooks.onZoom(next);
    this.patch({ zoom: next });
    this.schedulePdfRerender();
  }

  private commitZoom() {
    if (!this.doc) return;
    const R = this.visualRatio || 1;
    if (Math.abs(this.userZoom - this.committedZoom) < 0.001 && Math.abs(R - 1) < 0.001) return;
    const scroll = this.els.scroll;
    const rect = scroll.getBoundingClientRect();
    const ox = rect.width / 2;
    const oy = rect.height / 2;
    const safeR = Math.max(0.05, R);
    const layoutX = (scroll.scrollLeft + ox) / safeR;
    const layoutY = (scroll.scrollTop + oy) / safeR;
    const applied = this.userZoom / Math.max(0.05, this.committedZoom);
    this.committedZoom = this.userZoom;
    this.visualRatio = 1;
    this.els.stage.classList.remove("is-pinching");
    this.els.stage.style.transform = "";
    try {
      this.layout();
      scroll.scrollLeft = Math.max(0, layoutX * applied - ox);
      scroll.scrollTop = Math.max(0, layoutY * applied - oy);
    } catch {
      /* keep UI alive if a page layout throws */
    }
    this.mountVisible(true);
    this.hooks.onZoom(this.userZoom);
    this.patch({ zoom: this.userZoom });
    this.schedulePdfRerender();
  }

  private near(el: HTMLElement, margin: number) {
    const r = el.getBoundingClientRect();
    const v = this.els.scroll.getBoundingClientRect();
    return r.bottom > v.top - margin && r.top < v.bottom + margin;
  }

  private mountVisible(force: boolean) {
    if (!this.doc) return;
    const keep = this.draft?.page;
    const margin = this.doc.kind === "html" ? 700 : 900;
    for (const page of this.doc.pages) {
      if (page !== keep && !this.near(page.shell, margin)) {
        if (page.mounted) this.unmountPage(page);
        continue;
      }
      this.mountPage(page, force);
    }
  }

  private mountPage(page: Page, force: boolean) {
    // Lazy-load HTML iframe when the page is near the viewport
    const iframe = page.iframe;
    if (iframe && !iframe.src) {
      const dataSrc = iframe.dataset.src;
      if (dataSrc) {
        iframe.src = dataSrc;
        void waitForFrame(iframe, 1500).then(() => {
          if (!this.alive || !page.shell.isConnected) return;
          if (this.mode === "pinch") return;
          this.measureHtml(page, page.baseW || this.availableWidth());
          this.layout();
        });
      }
    }
    const showPdf = !!page.paper || (this.doc?.kind === "pdf" && !!page.pdfNumber);
    if (!page.mounted) {
      page.mounted = true;
      if (showPdf) {
        const canvas = document.createElement("canvas");
        canvas.className = "pdf-layer";
        canvas.width = 8;
        canvas.height = 8;
        const seed = canvas.getContext("2d", { alpha: false });
        if (seed) {
          seed.fillStyle = page.paper || "#ffffff";
          seed.fillRect(0, 0, 8, 8);
        }
        page.inner.insertBefore(canvas, page.mediaLayer);
        page.pdfCanvas = canvas;
        void this.renderPdf(page);
      }
    } else if (force && showPdf && page.pdfCanvas) {
      void this.renderPdf(page);
    }
    this.syncTiles(page, force);
  }

  private unmountPage(page: Page) {
    page.mounted = false;
    page.renderGen++;
    try {
      page.renderTask?.cancel();
    } catch {
      /* ignore */
    }
    page.renderTask = null;
    if (page.pdfCanvas) {
      page.pdfCanvas.remove();
      page.pdfCanvas = undefined;
    }
    page.pdfPage?.cleanup();
    page.pdfPage = undefined;
    for (const tile of page.tiles) this.dropTile(tile);
    // Keep HTML iframe src loaded. Unloading it (about:blank) broke
    // "Tap to interact" and pinch when the user scrolled back.
    // Ink tiles / PDF canvases above are enough to free GPU memory.
  }

  private dropTile(tile: Tile) {
    if (!tile.canvas) return;
    tile.canvas.width = 0;
    tile.canvas.height = 0;
    tile.canvas.remove();
    tile.canvas = null;
    tile.ctx = null;
  }

  private syncTiles(page: Page, force: boolean) {
    for (const tile of page.tiles) {
      if (!this.near(tile.el, 700) && page !== this.draft?.page) {
        this.dropTile(tile);
        continue;
      }
      if (!tile.canvas) {
        const canvas = document.createElement("canvas");
        tile.el.appendChild(canvas);
        tile.canvas = canvas;
        tile.ctx = canvas.getContext("2d");
      }
      // Do not resize the ink canvas while a pinch is active. Resizing
      // clears the bitmap for one frame, which is the visible flicker.
      if (this.mode === "pinch") continue;
      const changed = this.resizeInk(page, tile);
      if (changed || force) this.paintTile(page, tile);
    }
  }

  private resizeInk(page: Page, tile: Tile) {
    const canvas = tile.canvas;
    if (!canvas) return false;
    const S = this.displayScale();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let bw = page.baseW * S * dpr;
    let bh = tile.baseH * S * dpr;
    const edge = Math.max(bw, bh);
    if (edge > MAX_EDGE) {
      const k = MAX_EDGE / edge;
      bw *= k;
      bh *= k;
    }
    if (bw > MAX_CANVAS_EDGE || bh > MAX_CANVAS_EDGE) {
      const k = MAX_CANVAS_EDGE / Math.max(bw, bh);
      bw *= k;
      bh *= k;
    }
    const w = Math.max(1, Math.round(bw));
    const h = Math.max(1, Math.round(bh));
    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w;
    canvas.height = h;
    return true;
  }

  private async renderPdf(page: Page) {
    if (!page.pdfCanvas) return;
    const gen = ++page.renderGen;
    const docGen = this.docGen;
    if (page.paper || !page.pdfNumber || !this.pdf) {
      const off = document.createElement("canvas");
      off.width = 16;
      off.height = 16;
      const ctx = off.getContext("2d", { alpha: false });
      if (!ctx) return;
      ctx.fillStyle = page.paper || "#ffffff";
      ctx.fillRect(0, 0, 16, 16);
      if (gen === page.renderGen && docGen === this.docGen) this.commitBitmap(page, off);
      return;
    }
    try {
      page.pdfPage ??= await this.pdf.getPage(page.pdfNumber);
      if (gen !== page.renderGen || docGen !== this.docGen || !page.pdfCanvas) return;
      const S = this.displayScale();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      let targetW = page.baseW * S * dpr;
      let targetH = page.baseH * S * dpr;
      const edge = Math.max(targetW, targetH);
      if (edge > MAX_EDGE) {
        const k = MAX_EDGE / edge;
        targetW *= k;
        targetH *= k;
      }
      if (targetW > MAX_CANVAS_EDGE || targetH > MAX_CANVAS_EDGE) {
        const k = MAX_CANVAS_EDGE / Math.max(targetW, targetH);
        targetW *= k;
        targetH *= k;
      }
      const viewport = page.pdfPage.getViewport({ scale: Math.max(0.05, targetW / page.baseW) });
      const off = document.createElement("canvas");
      off.width = Math.max(1, Math.ceil(viewport.width));
      off.height = Math.max(1, Math.ceil(viewport.height));
      const ctx = off.getContext("2d", { alpha: false });
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, off.width, off.height);
      if (this.hooks.getPrefs().invert) ctx.filter = "invert(1) hue-rotate(180deg)";
      try {
        page.renderTask?.cancel();
      } catch {
        /* ignore */
      }
      const task = page.pdfPage.render({ canvasContext: ctx, viewport });
      page.renderTask = task;
      await task.promise;
      if (gen !== page.renderGen || docGen !== this.docGen || !page.pdfCanvas) return;
      this.commitBitmap(page, off);
    } catch {
      /* cancelled render */
    }
  }

  private commitBitmap(page: Page, off: HTMLCanvasElement) {
    const next = document.createElement("canvas");
    next.className = "pdf-layer";
    next.width = off.width;
    next.height = off.height;
    const ctx = next.getContext("2d", { alpha: false });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0);
    const prev = page.pdfCanvas;
    if (prev?.parentElement) prev.parentElement.insertBefore(next, prev);
    else page.inner.insertBefore(next, page.mediaLayer);
    page.pdfCanvas = next;
    if (prev && prev !== next) prev.remove();
  }

  private rasterInk(page: Page) {
    const maxEdge = 1800;
    const scale = Math.min(2, maxEdge / Math.max(page.baseW, page.baseH, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(page.baseW * scale));
    canvas.height = Math.max(1, Math.round(page.baseH * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    for (const obj of page.objects) drawObj(ctx, obj);
    return canvas;
  }

  private paintPage(page: Page | null) {
    if (!page) return;
    for (const tile of page.tiles) {
      if (tile.canvas) this.paintTile(page, tile);
    }
  }

  private paintTile(page: Page, tile: Tile) {
    const ctx = tile.ctx;
    const canvas = tile.canvas;
    if (!ctx || !canvas) return;
    const sx = canvas.width / page.baseW;
    const sy = canvas.height / tile.baseH;
    ctx.setTransform(sx, 0, 0, sy, 0, -tile.y0 * sy);
    ctx.clearRect(0, tile.y0 - 4, page.baseW, tile.baseH + 8);
    const y0 = tile.y0 - 30;
    const y1 = tile.y0 + tile.baseH + 30;
    const drawIf = (obj: DrawObj) => {
      const b = boundsOf(obj);
      if (b.y1 < y0 || b.y0 > y1) return;
      drawObj(ctx, obj);
    };
    for (const obj of page.objects) drawIf(obj);
    if (this.draft?.page === page) drawIf(this.draft.obj);
  }

  private schedulePaint(page: Page) {
    if (this.paintRaf) return;
    this.paintRaf = requestAnimationFrame(() => {
      this.paintRaf = 0;
      this.paintPage(page);
    });
  }

  private currentPage() {
    return this.doc?.pages[this.current - 1] ?? null;
  }

  private emitDoc() {
    this.patch({
      docName: this.docName,
      kind: this.doc?.kind ?? null,
      page: this.current,
      pageCount: this.doc?.pages.length ?? 0,
      zoom: this.userZoom,
      ready: !!this.doc,
      canUndo: false,
      canRedo: false,
      progress: null,
      selectedMedia: false,
    });
    this.hooks.onZoom(this.userZoom);
  }

  private syncHistory() {
    const page = this.currentPage();
    this.patch({
      canUndo: !!page?.past.length,
      canRedo: !!page?.future.length,
      page: this.current,
      pageCount: this.doc?.pages.length ?? 0,
    });
    this.doc?.pages.forEach((p) => p.thumbBtn?.classList.toggle("is-on", p.index === this.current));
  }

  private serialize(page: Page) {
    return JSON.stringify({ objects: page.objects, media: page.media });
  }

  private snapshot(page: Page) {
    page.past.push(this.serialize(page));
    if (page.past.length > HISTORY) page.past.shift();
    page.future.length = 0;
    this.syncHistory();
  }

  private restore(page: Page, raw: string) {
    const data = JSON.parse(raw) as { objects?: DrawObj[]; media?: MediaObj[] };
    page.objects = data.objects ?? [];
    page.media = data.media ?? [];
    this.syncMedia(page);
    this.paintPage(page);
  }

  private syncMedia(page: Page) {
    page.mediaLayer.replaceChildren();
    for (const media of page.media) page.mediaLayer.appendChild(this.mediaNode(media));
    if (this.selectedMediaId) {
      const present = page.media.some((m) => m.id === this.selectedMediaId);
      this.selectMedia(present ? this.selectedMediaId : null);
    }
  }

  private mediaNode(media: MediaObj) {
    const el = document.createElement("div");
    el.className = "media-item";
    el.style.pointerEvents = "auto";
    el.dataset.id = media.id;
    el.style.left = `${media.x}px`;
    el.style.top = `${media.y}px`;
    el.style.width = `${media.w}px`;
    el.style.height = `${media.h}px`;
    el.style.setProperty("--rot", `${media.rotation ?? 0}deg`);
    if (media.kind === "video") {
      const video = document.createElement("video");
      video.src = media.src;
      video.controls = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.setAttribute("controls", "true");
      video.preload = "metadata";
      video.style.width = "100%";
      video.style.height = "100%";
      video.style.objectFit = "contain";
      video.style.pointerEvents = "auto";
      video.style.touchAction = "manipulation";
      el.appendChild(video);
    } else {
      const img = document.createElement("img");
      img.src = media.src;
      img.alt = "";
      img.draggable = false;
      el.appendChild(img);
    }
    const handle = document.createElement("span");
    handle.className = "media-handle";
    handle.dataset.role = "handle";
    el.appendChild(handle);
    const rotate = document.createElement("span");
    rotate.className = "media-rotate";
    rotate.dataset.role = "rotate";
    el.appendChild(rotate);
    const selected = this.selectedMediaId === media.id;
    el.classList.toggle("is-on", selected);
    handle.style.display = selected ? "" : "none";
    rotate.style.display = selected ? "" : "none";
    return el;
  }

  private placeMedia(el: HTMLElement, media: MediaObj) {
    el.style.left = `${media.x}px`;
    el.style.top = `${media.y}px`;
    el.style.width = `${media.w}px`;
    el.style.height = `${media.h}px`;
    el.style.setProperty("--rot", `${media.rotation ?? 0}deg`);
  }

  private visibleY(page: Page) {
    const r = page.inner.getBoundingClientRect();
    const v = this.els.scroll.getBoundingClientRect();
    const y = ((Math.max(v.top, r.top) - r.top) / Math.max(1, r.height)) * page.baseH;
    return clamp(y + 12, 0, Math.max(0, page.baseH - 80));
  }

  private styleFor(tool: Tool) {
    const prefs = this.hooks.getPrefs();
    const scale = Math.max(0.05, this.displayScale() * this.visualRatio);
    const width = (tool === "highlighter" ? Math.max(16, prefs.size * 3.3) : prefs.size) / scale;
    const opacity = tool === "highlighter" ? Math.min(0.42, prefs.opacity) : prefs.opacity;
    return { color: prefs.color, width, opacity };
  }

  private toBase(page: Page, x: number, y: number): Pt {
    const r = page.inner.getBoundingClientRect();
    return {
      x: ((x - r.left) / Math.max(1, r.width)) * page.baseW,
      y: ((y - r.top) / Math.max(1, r.height)) * page.baseH,
    };
  }

  private pageAt(x: number, y: number) {
    for (const el of document.elementsFromPoint(x, y)) {
      const shell = el.closest(".page-shell");
      if (!shell) continue;
      const page = this.pageByEl.get(shell);
      if (page) return page;
    }
    return null;
  }

  private mediaAt(x: number, y: number): MediaHit | null {
    for (const el of document.elementsFromPoint(x, y)) {
      const item = el.closest(".media-item");
      if (!item) continue;
      const shell = item.closest(".page-shell");
      const page = shell ? this.pageByEl.get(shell) : undefined;
      const media = page?.media.find((m) => m.id === (item as HTMLElement).dataset.id);
      if (!page || !media) continue;
      const inRotate =
        el instanceof HTMLElement && (el.dataset.role === "rotate" || !!el.closest(".media-rotate"));
      const inHandle =
        el instanceof HTMLElement && (el.dataset.role === "handle" || !!el.closest(".media-handle"));
      const mode: MediaMode | null = inRotate ? "rotate" : inHandle ? "resize" : "move";
      return { page, media, el: item as HTMLElement, mode, isHandle: inHandle || inRotate };
    }
    return null;
  }

  private onPointerDown = (event: PointerEvent) => {
    const toolNow = this.hooks.getPrefs().tool;
    // Desktop laser: left OR right button (right-click points without OS menu)
    if (event.pointerType === "mouse" && event.button !== 0) {
      if (!(toolNow === "laser" && event.button === 2)) return;
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const capture = () => {
      try {
        this.els.scroll.setPointerCapture(event.pointerId);
      } catch {
        /* pointer may belong to the iframe */
      }
    };
    if (this.blockUntilUp && this.pointers.size < 2) return;
    if (this.pointers.size >= 2) {
      this.cancelDraft();
      this.mediaDrag = null;
      this.stopMomentum();
      this.hideLaser();
      const pts = [...this.pointers.values()];
      this.mode = "pinch";
      this.els.stage.classList.add("is-pinching");
      // Interactive HTML iframes steal the second finger — disable them during pinch
      this.setHtmlPointerPass(false);
      this.pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      this.pinchStartZoom = this.userZoom;
      this.lastMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      event.preventDefault();
      capture();
      return;
    }
    this.stopMomentum();
    if (!this.doc) return;
    const prefs = this.hooks.getPrefs();

    const hit = this.mediaAt(event.clientX, event.clientY);
    if (hit && this.selectedMediaId === hit.media.id && hit.mode && hit.isHandle) {
      this.beginMedia(hit, event, hit.mode);
      event.preventDefault();
      capture();
      return;
    }

    if (this.selectedMediaId && (!hit || hit.media.id !== this.selectedMediaId)) {
      if (prefs.tool === "eraser" && hit) {
        this.snapshot(hit.page);
        hit.page.media = hit.page.media.filter((m) => m.id !== hit.media.id);
        this.syncMedia(hit.page);
        this.clearSelection();
        this.say("Removed");
        event.preventDefault();
        capture();
        return;
      }
      this.clearSelection();
    }

    if (prefs.tool === "eraser" && hit) {
      this.snapshot(hit.page);
      hit.page.media = hit.page.media.filter((m) => m.id !== hit.media.id);
      this.syncMedia(hit.page);
      this.say("Removed");
      event.preventDefault();
      capture();
      return;
    }
    // Selected media handles (resize/rotate) always drag
    if (hit && hit.mode && hit.isHandle && this.selectedMediaId === hit.media.id) {
      this.beginMedia(hit, event, hit.mode);
      event.preventDefault();
      capture();
      return;
    }

    // Hand + video media: unlock native controls (don't start drag)
    if (hit && prefs.tool === "hand" && hit.media.kind === "video") {
      const video = hit.el.querySelector("video");
      if (video instanceof HTMLVideoElement) {
        video.controls = true;
        video.setAttribute("playsinline", "");
        video.setAttribute("webkit-playsinline", "");
        video.style.pointerEvents = "auto";
        video.style.touchAction = "manipulation";
        this.videoFocus = true;
        this.patch({ video: true });
        try {
          video.focus({ preventScroll: true });
        } catch {
          try {
            video.focus();
          } catch {
            /* ignore */
          }
        }
        // Native controls / click toggle playback. Toggling here as well
        // cancelled the native toggle, so the video never played or stopped.
        this.pointers.delete(event.pointerId);
        return;
      }
    }

    if (hit && hit.mode === "move" && (prefs.tool === "hand" || this.selectedMediaId === hit.media.id)) {
      this.selectMedia(hit.media.id);
      this.beginMedia(hit, event, "move");
      event.preventDefault();
      capture();
      return;
    }
    if (hit && prefs.tool === "hand" && hit.media.kind === "image") {
      this.selectMedia(hit.media.id);
      this.beginMedia(hit, event, "move");
      event.preventDefault();
      capture();
      return;
    }

    if (prefs.tool === "hand") {
      // Always try video / tap-to-interact first (no capture)
      const interacted = this.tryInteractHtml(event.clientX, event.clientY);
      if (interacted) {
        this.pointers.delete(event.pointerId);
        return;
      }

      const page = this.pageAt(event.clientX, event.clientY);
      // Over an HTML iframe: do NOT capture yet — a click must reach the video.
      // If the pointer moves, we start pan in pointermove.
      if (page?.iframe) {
        const ir = page.iframe.getBoundingClientRect();
        if (
          event.clientX >= ir.left &&
          event.clientX <= ir.right &&
          event.clientY >= ir.top &&
          event.clientY <= ir.bottom
        ) {
          this.htmlHandPending = {
            x: event.clientX,
            y: event.clientY,
            pointerId: event.pointerId,
            page,
          };
          // Do not preventDefault / setPointerCapture — allow the iframe click
          return;
        }
      }

      this.htmlHandPending = null;
      this.beginPan(event);
      event.preventDefault();
      capture();
      return;
    }
    if (prefs.tool === "laser") {
      this.mode = "laser";
      this.moveLaser(event.clientX, event.clientY);
      this.armHoldPan(event);
      event.preventDefault();
      capture();
      return;
    }
    const page = this.pageAt(event.clientX, event.clientY);
    if (!page) {
      this.beginPan(event);
      event.preventDefault();
      capture();
      return;
    }
    if (prefs.tool === "text") {
      event.preventDefault();
      // Desktop hold → pan; short click → place text on pointer up via armed flag
      if (event.pointerType === "mouse") {
        this.armHoldPan(event);
        // Defer text placement: if hold becomes pan, skip text
        const x = event.clientX;
        const y = event.clientY;
        const p = page;
        window.setTimeout(() => {
          if (!this.alive || this.mode === "pan") return;
          if (this.hooks.getPrefs().tool !== "text") return;
          // Only place if still a simple click (no pan started)
          if (this.mode !== "none" && this.mode !== "laser") return;
          const point = this.toBase(p, x, y);
          void this.addText(p, point);
        }, 300);
        capture();
        return;
      }
      const point = this.toBase(page, event.clientX, event.clientY);
      void this.addText(page, point);
      return;
    }
    if (prefs.tool === "scrub") {
      const point = this.toBase(page, event.clientX, event.clientY);
      const width =
        Math.max(8, prefs.eraserSize * 1.6) / Math.max(0.05, this.displayScale() * this.visualRatio);
      this.snapshot(page);
      this.draft = {
        page,
        origin: point,
        moved: false,
        obj: { type: "erase", points: [point], width },
      };
      this.mode = "draw";
      this.armHoldPan(event);
      event.preventDefault();
      capture();
      return;
    }
    if (prefs.tool === "eraser") {
      this.mode = "draw";
      this.draft = {
        page,
        origin: this.toBase(page, event.clientX, event.clientY),
        moved: false,
        obj: { type: "stroke", points: [], color: "#000", width: 1, opacity: 1 },
      };
      this.eraseAt(page, event.clientX, event.clientY);
      this.armHoldPan(event);
      event.preventDefault();
      capture();
      return;
    }
    // Ensure HTML content cannot steal this stroke
    this.setHtmlPointerPass(false);
    this.beginShape(page, prefs.tool, event);
    // Desktop: quick drag draws; click-and-hold pans the page
    this.armHoldPan(event);
    event.preventDefault();
    capture();
  };

  private onPointerMove = (event: PointerEvent) => {
    const tracked = this.pointers.get(event.pointerId);
    if (tracked) {
      tracked.x = event.clientX;
      tracked.y = event.clientY;
    }
    // Hand on HTML: convert to pan once the user actually drags
    if (this.htmlHandPending && this.htmlHandPending.pointerId === event.pointerId) {
      const dx = event.clientX - this.htmlHandPending.x;
      const dy = event.clientY - this.htmlHandPending.y;
      if (Math.hypot(dx, dy) > 8) {
        const startX = this.htmlHandPending.x;
        const startY = this.htmlHandPending.y;
        this.htmlHandPending = null;
        this.mode = "pan";
        this.panX = startX;
        this.panY = startY;
        this.panT = performance.now();
        this.panMoved = 0;
        this.panVx = 0;
        this.panVy = 0;
        try {
          this.els.scroll.setPointerCapture(event.pointerId);
        } catch {
          /* ignore */
        }
        event.preventDefault();
        this.movePan(event);
        return;
      }
    }
    if (this.mode === "pinch" && this.pointers.size >= 2) {
      event.preventDefault();
      this.movePinch();
      return;
    }
    if (this.mode === "pan") {
      event.preventDefault();
      this.movePan(event);
      return;
    }
    if (this.mode === "draw") {
      event.preventDefault();
      this.moveDraw(event);
      return;
    }
    if (this.mode === "media") {
      event.preventDefault();
      this.moveMedia(event);
      return;
    }
    if (this.mode === "laser") {
      this.moveLaser(event.clientX, event.clientY);
      return;
    }
    // Desktop: laser follows mouse while the tool is selected (no need to hold click)
    if (
      event.pointerType === "mouse" &&
      this.hooks.getPrefs().tool === "laser" &&
      this.mode === "none"
    ) {
      this.moveLaser(event.clientX, event.clientY);
    }
  };

  private onPointerUp = (event: PointerEvent) => {
    this.pointers.delete(event.pointerId);
    try {
      this.els.scroll.releasePointerCapture(event.pointerId);
    } catch {
      /* not captured */
    }
    if (this.mode === "pinch") {
      if (this.pointers.size < 2) {
        this.mode = "none";
        this.blockUntilUp = this.pointers.size > 0;
        this.els.stage.classList.remove("is-pinching");
        // Restore HTML hit-testing if Hand tool is active
        if (this.hooks.getPrefs().tool === "hand") this.setHtmlPointerPass(true);
        window.clearTimeout(this.pinchRerenderTimer);
        this.pinchRerenderTimer = window.setTimeout(() => {
          if (this.mode === "pinch") return;
          this.commitZoom();
        }, 40);
      }
      return;
    }
    if (this.pointers.size > 0) return;
    this.blockUntilUp = false;
    this.htmlHandPending = null;
    this.clearHoldPan();
    if (this.mode === "pan") this.finishPan(event);
    else if (this.mode === "draw") this.finishDraw();
    else if (this.mode === "media") this.finishMedia();
    else if (this.mode === "laser") {
      // Desktop: keep the laser visible after click; mobile: hide when finger lifts
      if (event.pointerType !== "mouse") this.hideLaser();
    }
    this.mode = "none";
  };

  private onTouchMove = (event: TouchEvent) => {
    // Allow native video controls to receive moves only when idle (not drawing/panning).
    if (this.videoFocus && this.mode === "none") return;
    if (
      this.mode === "pan" ||
      this.mode === "pinch" ||
      this.mode === "draw" ||
      this.mode === "media" ||
      this.mode === "laser"
    ) {
      event.preventDefault();
    }
  };

  private onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    if (!this.doc) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.06 : 1 / 1.06;
    const next = clamp(this.userZoom * factor, MIN_Z, MAX_Z);
    const scroll = this.els.scroll;
    const rect = scroll.getBoundingClientRect();
    const ox = event.clientX - rect.left;
    const oy = event.clientY - rect.top;
    const oldR = this.visualRatio;
    const layoutX = (scroll.scrollLeft + ox) / oldR;
    const layoutY = (scroll.scrollTop + oy) / oldR;
    this.userZoom = next;
    this.visualRatio = next / this.committedZoom;
    this.applyTransform();
    scroll.scrollLeft = layoutX * this.visualRatio - ox;
    scroll.scrollTop = layoutY * this.visualRatio - oy;
    this.hooks.onZoom(next);
    window.clearTimeout(this.wheelT);
    this.wheelT = window.setTimeout(() => this.commitZoom(), 160);
  };

  private onScroll = () => {
    if (this.scrollRaf) return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0;
      this.updateCurrentPage();
      if (this.mode !== "pinch") this.mountVisible(false);
    });
  };

  private onContext = (event: Event) => {
    // Hand: allow browser menu. Laser/pen: block menu so right-click can point.
    if (this.hooks.getPrefs().tool !== "hand") event.preventDefault();
  };

  private onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && this.hooks.getPrefs().tool === "laser") {
      this.hideLaser();
    }
  };

  private blockGesture = (event: Event) => {
    event.preventDefault();
  };

  private onKey = (event: KeyboardEvent) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    const meta = event.ctrlKey || event.metaKey;
    if (meta && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
    } else if (meta && event.key.toLowerCase() === "y") {
      event.preventDefault();
      this.redo();
    } else if (event.key === "Backspace" || event.key === "Delete") {
      if (this.deleteSelectedMedia()) event.preventDefault();
    } else if (event.key === "Escape") {
      if (this.selectedMediaId) {
        this.clearSelection();
      } else {
        this.clearVideoFocus();
        this.hooks.onEscape();
      }
    }
  };

  private clearHoldPan() {
    window.clearTimeout(this.holdPanTimer);
    this.holdPanTimer = 0;
    this.holdPanAt = null;
  }

  /** Desktop only: holding still ~280ms with a tool converts the gesture to pan. */
  private armHoldPan(event: PointerEvent) {
    if (event.pointerType !== "mouse") return;
    this.clearHoldPan();
    this.holdPanAt = { x: event.clientX, y: event.clientY };
    this.holdPanTimer = window.setTimeout(() => {
      const at = this.holdPanAt;
      this.clearHoldPan();
      if (!at || !this.alive) return;
      const tool = this.hooks.getPrefs().tool;
      if (tool === "hand") return;
      // Only switch if the user has not started drawing / dragging
      if (this.mode === "draw" && this.draft && !this.draft.moved) {
        this.cancelDraft();
        this.mode = "pan";
        this.panX = at.x;
        this.panY = at.y;
        this.panT = performance.now();
        this.panMoved = 0;
        this.panVx = 0;
        this.panVy = 0;
        return;
      }
      if (this.mode === "laser") {
        this.hideLaser();
        this.mode = "pan";
        this.panX = at.x;
        this.panY = at.y;
        this.panT = performance.now();
        this.panMoved = 0;
        this.panVx = 0;
        this.panVy = 0;
        return;
      }
      if (this.mode === "none" && tool !== "hand") {
        this.mode = "pan";
        this.panX = at.x;
        this.panY = at.y;
        this.panT = performance.now();
        this.panMoved = 0;
        this.panVx = 0;
        this.panVy = 0;
      }
    }, 280);
  }

  private beginPan(event: PointerEvent) {
    this.clearHoldPan();
    this.mode = "pan";
    this.panX = event.clientX;
    this.panY = event.clientY;
    this.panT = performance.now();
    this.panMoved = 0;
    this.panVx = 0;
    this.panVy = 0;
  }

  private movePan(event: PointerEvent) {
    const now = performance.now();
    const dt = Math.max(8, now - this.panT);
    const dx = event.clientX - this.panX;
    const dy = event.clientY - this.panY;
    this.els.scroll.scrollLeft -= dx;
    this.els.scroll.scrollTop -= dy;
    const svx = (-dx / dt) * 16;
    const svy = (-dy / dt) * 16;
    this.panVx = this.panVx * 0.35 + svx * 0.65;
    this.panVy = this.panVy * 0.35 + svy * 0.65;
    this.panX = event.clientX;
    this.panY = event.clientY;
    this.panT = now;
    this.panMoved += Math.hypot(dx, dy);
  }

  private finishPan(event: PointerEvent) {
    if (this.panMoved < 8) {
      const now = performance.now();
      if (now - this.lastTap < 280 && Math.hypot(event.clientX - this.lastTapX, event.clientY - this.lastTapY) < 28) {
        this.lastTap = 0;
        this.zoomAt(this.userZoom < 1.45 ? 2.2 : 1, event.clientX, event.clientY);
        return;
      }
      this.lastTap = now;
      this.lastTapX = event.clientX;
      this.lastTapY = event.clientY;
      this.tapHtml(event.clientX, event.clientY);
      return;
    }
    if (event.pointerType === "mouse") return;
    let vx = this.panVx;
    let vy = this.panVy;
    const step = () => {
      vx *= 0.92;
      vy *= 0.92;
      if (Math.hypot(vx, vy) < 0.35) {
        this.momentum = 0;
        return;
      }
      this.els.scroll.scrollLeft += vx;
      this.els.scroll.scrollTop += vy;
      this.momentum = requestAnimationFrame(step);
    };
    this.momentum = requestAnimationFrame(step);
  }

  private stopMomentum() {
    if (this.momentum) cancelAnimationFrame(this.momentum);
    this.momentum = 0;
  }

  private movePinch() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    this.els.stage.classList.add("is-pinching");
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const next = clamp(this.pinchStartZoom * (dist / this.pinchDist), MIN_Z, MAX_Z);
    const scroll = this.els.scroll;
    const rect = scroll.getBoundingClientRect();
    const oldR = this.visualRatio || 1;
    const ox = this.lastMid.x - rect.left;
    const oy = this.lastMid.y - rect.top;
    const layoutX = (scroll.scrollLeft + ox) / oldR;
    const layoutY = (scroll.scrollTop + oy) / oldR;
    this.userZoom = next;
    this.visualRatio = next / this.committedZoom;
    this.applyTransform();
    const nox = mid.x - rect.left;
    const noy = mid.y - rect.top;
    scroll.scrollLeft = layoutX * this.visualRatio - nox;
    scroll.scrollTop = layoutY * this.visualRatio - noy;
    this.lastMid = mid;
    this.hooks.onZoom(next);
  }

  private schedulePdfRerender() {
    if (!this.doc || this.doc.kind !== "pdf") return;
    window.clearTimeout(this.pinchRerenderTimer);
    this.pinchRerenderTimer = window.setTimeout(() => {
      if (!this.doc || this.doc.kind !== "pdf") return;
      if (this.mode === "pinch") return;
      for (const page of this.doc.pages) {
        if (page.mounted && page.pdfCanvas) void this.renderPdf(page);
      }
    }, 180);
  }

  private beginShape(page: Page, tool: Tool, event: PointerEvent) {
    const origin = this.toBase(page, event.clientX, event.clientY);
    const style = this.styleFor(tool);
    let obj: DrawObj;
    if (tool === "pen" || tool === "highlighter") {
      obj = { type: "stroke", points: [origin], ...style, highlight: tool === "highlighter" };
    } else if (tool === "line" || tool === "arrow") {
      obj = { type: tool, x1: origin.x, y1: origin.y, x2: origin.x, y2: origin.y, ...style };
    } else if (tool === "rect" || tool === "circle" || tool === "triangle") {
      obj = { type: tool, x: origin.x, y: origin.y, w: 0, h: 0, ...style };
    } else {
      return;
    }
    this.draft = { page, obj, origin, moved: false };
    this.mode = "draw";
  }

  private moveDraw(event: PointerEvent) {
    const page = this.draft?.page;
    if (!page) return;
    if (this.hooks.getPrefs().tool === "eraser") {
      const events = event.getCoalescedEvents?.() ?? [event];
      for (const ev of events) this.eraseAt(page, ev.clientX, ev.clientY);
      return;
    }
    if (!this.draft) return;
    const events = event.getCoalescedEvents?.() ?? [event];
    const obj = this.draft.obj;
    if (obj.type === "stroke" || obj.type === "erase") {
      const min = 0.4 / Math.max(0.05, this.displayScale() * this.visualRatio);
      for (const ev of events) {
        const q = this.toBase(page, ev.clientX, ev.clientY);
        const prev = obj.points[obj.points.length - 1];
        if (!prev || Math.hypot(q.x - prev.x, q.y - prev.y) >= min) obj.points.push(q);
      }
      this.draft.moved = obj.points.length > 1;
    } else {
      const q = this.toBase(page, event.clientX, event.clientY);
      if (obj.type === "line" || obj.type === "arrow") {
        obj.x2 = q.x;
        obj.y2 = q.y;
        this.draft.moved = Math.hypot(obj.x2 - obj.x1, obj.y2 - obj.y1) > 1.5;
      } else if (obj.type === "rect" || obj.type === "circle" || obj.type === "triangle") {
        obj.x = this.draft.origin.x;
        obj.y = this.draft.origin.y;
        obj.w = q.x - this.draft.origin.x;
        obj.h = q.y - this.draft.origin.y;
        this.draft.moved = Math.hypot(obj.w, obj.h) > 1.5;
      }
    }
    if (this.draft.moved) this.clearHoldPan();
    this.schedulePaint(page);
  }

  private finishDraw() {
    const prefs = this.hooks.getPrefs();
    if (prefs.tool === "eraser") {
      this.draft = null;
      return;
    }
    const draft = this.draft;
    this.draft = null;
    if (!draft) return;
    let obj = draft.obj;
    if (prefs.shapeDetect && prefs.tool === "pen" && obj.type === "stroke" && !obj.highlight) {
      const snapped = snapShape(obj.points, { color: obj.color, width: obj.width, opacity: obj.opacity });
      if (snapped) obj = snapped;
    }
    const tooSmall =
      !draft.moved ||
      ((obj.type === "stroke" || obj.type === "erase") && obj.points.length < 2);
    if (tooSmall) {
      if (obj.type === "erase") draft.page.past.pop();
      this.syncHistory();
      this.paintPage(draft.page);
      return;
    }
    if (obj.type !== "erase") this.snapshot(draft.page);
    draft.page.objects.push(obj);
    this.paintPage(draft.page);
    this.syncHistory();
  }

  private cancelDraft() {
    const page = this.draft?.page ?? null;
    this.draft = null;
    if (page) this.paintPage(page);
    this.hideLaser();
  }

  private eraseAt(page: Page, x: number, y: number) {
    const p = this.toBase(page, x, y);
    const radius =
      Math.max(12, (this.hooks.getPrefs().eraserSize || 14) * 1.25) / Math.max(0.05, this.displayScale());
    for (let i = page.media.length - 1; i >= 0; i--) {
      const media = page.media[i];
      if (
        p.x < media.x - radius ||
        p.x > media.x + media.w + radius ||
        p.y < media.y - radius ||
        p.y > media.y + media.h + radius
      ) {
        continue;
      }
      this.snapshot(page);
      page.media.splice(i, 1);
      this.syncMedia(page);
      this.clearSelection();
      return;
    }
    for (let i = page.objects.length - 1; i >= 0; i--) {
      if (!hitObj(page.objects[i], p.x, p.y, radius)) continue;
      this.snapshot(page);
      page.objects.splice(i, 1);
      this.schedulePaint(page);
      return;
    }
  }

  private async addText(page: Page, point: Pt) {
    const text = await this.hooks.requestText({
      title: "Write on the page",
      placeholder: "Lesson note",
    });
    if (!text?.trim() || this.docGen === 0 || !page.shell.isConnected) return;
    const scale = Math.max(0.05, this.displayScale());
    const fontSize = Math.max(16, this.hooks.getPrefs().size * 3.1) / scale;
    this.snapshot(page);
    page.objects.push({
      type: "text",
      text: text.trim(),
      x: point.x,
      y: point.y,
      fontSize,
      color: this.hooks.getPrefs().color,
      opacity: this.hooks.getPrefs().opacity,
    });
    this.paintPage(page);
  }

  private beginMedia(hit: MediaHit, event: PointerEvent, mode: MediaMode) {
    const p = this.toBase(hit.page, event.clientX, event.clientY);
    const centerBase = {
      x: hit.media.x + hit.media.w / 2,
      y: hit.media.y + hit.media.h / 2,
    };
    const startAngle = Math.atan2(p.y - centerBase.y, p.x - centerBase.x) * (180 / Math.PI);
    this.mode = "media";
    this.mediaDrag = {
      hit,
      mode,
      anchorX: p.x,
      anchorY: p.y,
      startX: hit.media.x,
      startY: hit.media.y,
      startW: hit.media.w,
      startH: hit.media.h,
      startRot: hit.media.rotation ?? 0,
      startAngle,
      moved: false,
      snap: false,
    };
    hit.el.classList.add("is-on");
  }

  private moveMedia(event: PointerEvent) {
    const drag = this.mediaDrag;
    if (!drag) return;
    const p = this.toBase(drag.hit.page, event.clientX, event.clientY);
    if (!drag.snap && Math.hypot(p.x - drag.anchorX, p.y - drag.anchorY) > 1) {
      this.snapshot(drag.hit.page);
      drag.snap = true;
    }
    drag.moved = true;
    const media = drag.hit.media;
    if (drag.mode === "move") {
      media.x = clamp(drag.startX + (p.x - drag.anchorX), -20, drag.hit.page.baseW - 20);
      media.y = clamp(drag.startY + (p.y - drag.anchorY), -20, drag.hit.page.baseH - 20);
    } else if (drag.mode === "resize") {
      const scale = Math.max(0.05, this.displayScale());
      media.w = Math.max(28 / scale, drag.startW + (p.x - drag.anchorX));
      media.h = Math.max(28 / scale, drag.startH + (p.y - drag.anchorY));
    } else {
      const centerBase = {
        x: media.x + media.w / 2,
        y: media.y + media.h / 2,
      };
      const ang = Math.atan2(p.y - centerBase.y, p.x - centerBase.x) * (180 / Math.PI);
      let next = drag.startRot + (ang - drag.startAngle);
      if (event.shiftKey) next = Math.round(next / 15) * 15;
      media.rotation = ((next % 360) + 360) % 360;
    }
    this.placeMedia(drag.hit.el, media);
  }

  private finishMedia() {
    this.mediaDrag?.hit.el.classList.remove("is-on");
    if (this.mediaDrag) {
      const { hit } = this.mediaDrag;
      this.selectMedia(hit.media.id);
    }
    this.mediaDrag = null;
  }

  private moveLaser(x: number, y: number) {
    const size = this.hooks.getPrefs().laserSize || 18;
    this.laser.style.display = "block";
    this.laser.style.left = `${x}px`;
    this.laser.style.top = `${y}px`;
    this.laser.style.width = `${size}px`;
    this.laser.style.height = `${size}px`;
    this.laser.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`;
  }

  private hideLaser() {
    this.laser.style.display = "none";
  }

  /** Hit-test videos by viewport box (works with native control bar on desktop). */
  private videoAtPoint(doc: Document, x: number, y: number): HTMLVideoElement | null {
    for (const node of doc.querySelectorAll("video")) {
      if (!(node instanceof HTMLVideoElement)) continue;
      const r = node.getBoundingClientRect();
      // Include a few px under the box for the control bar on some browsers
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom + 6) return node;
    }
    return null;
  }

  private unlockVideo(video: HTMLVideoElement, iframe?: HTMLIFrameElement | null) {
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("controls", "true");
    video.controls = true;
    video.style.pointerEvents = "auto";
    video.style.touchAction = "manipulation";
    if (iframe) {
      iframe.style.pointerEvents = "auto";
      iframe.style.touchAction = "auto";
      iframe.classList.add("is-live");
    }
    this.videoFocus = true;
    this.patch({ video: true });
    try {
      video.focus({ preventScroll: true });
    } catch {
      try {
        video.focus();
      } catch {
        /* ignore */
      }
    }
    if (video.paused) {
      void video.play().catch(() => {
        /* controls still available */
      });
      this.say("Playing – click controls to pause");
    } else {
      video.pause();
      this.say("Paused");
    }
  }

  /** Returns true if the touch should be left for the HTML content (no pan/capture). */
  private tryInteractHtml(x: number, y: number): boolean {
    const page = this.pageAt(x, y);
    const iframe = page?.iframe;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) return false;

    const rect = iframe.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return false;

    // Prefer geometry hit-test so native video control bar clicks work on desktop
    const byBox = this.videoAtPoint(doc, x, y);
    if (byBox) {
      this.unlockVideo(byBox, iframe);
      return true;
    }

    const ix = ((x - rect.left) / rect.width) * iframe.clientWidth;
    const iy = ((y - rect.top) / rect.height) * iframe.clientHeight;

    let el: Element | null = null;
    try {
      el = doc.elementFromPoint(ix, iy);
    } catch {
      return false;
    }
    if (!el) {
      // Over iframe but no element — still don't steal if video focus
      return this.videoFocus;
    }

    if (this.videoFocus) {
      if (el.closest("video") || this.videoAtPoint(doc, x, y)) return true;
      this.clearVideoFocus();
      return false;
    }

    // 1. Real <video> via DOM walk
    const video = el.closest("video");
    if (video instanceof HTMLVideoElement) {
      this.unlockVideo(video, iframe);
      return true;
    }

    // 2. "Tap to interact" button (works again after scrolling away and back)
    const tapBtn = el.closest(".tap-to-play") as HTMLElement | null;
    if (tapBtn) {
      const wrap = tapBtn.closest(".iframe-wrap");
      const live = wrap?.querySelector(".live-frame") as HTMLIFrameElement | null;
      if (live) {
        const src = live.getAttribute("data-src") || live.getAttribute("src") || live.dataset.src || "";
        if (src && (live.getAttribute("src") !== src || !live.dataset.loaded)) {
          live.src = src;
          live.dataset.loaded = "1";
        }
        tapBtn.classList.add("hidden");
        try {
          live.focus();
        } catch {
          /* ignore */
        }
      }
      try {
        tapBtn.click();
      } catch {
        /* ignore */
      }
      iframe.classList.add("is-live");
      iframe.style.pointerEvents = "auto";
      iframe.style.touchAction = "auto";
      this.say("Interactive page unlocked");
      window.setTimeout(() => {
        if (!this.alive || !page.shell.isConnected) return;
        this.measureHtml(page, page.baseW);
        this.layout();
      }, 400);
      return true;
    }

    // 3. Buttons / links
    const button = el.closest("a,button,summary");
    if (button instanceof HTMLElement) {
      button.click();
      return true;
    }

    // 4. Nested interactive content only if already unlocked
    if (iframe.classList.contains("is-live")) {
      if (
        el.closest("iframe") ||
        el.closest("canvas") ||
        el.closest("input") ||
        el.closest("button") ||
        el.closest("select") ||
        el.closest(".iframe-wrap")
      ) {
        // Ensure outer frame still accepts touches after scroll-back
        iframe.style.pointerEvents = "auto";
        iframe.style.touchAction = "auto";
        return true;
      }
    }

    return false;
  }

  private tapHtml(x: number, y: number) {
    // Keep for the short-tap path in finishPan
    this.tryInteractHtml(x, y);
  }

  private updateCurrentPage() {
    const pages = this.doc?.pages;
    if (!pages?.length) return;
    const view = this.els.scroll.getBoundingClientRect();
    const mid = (view.top + view.bottom) / 2;
    let lo = 0;
    let hi = pages.length - 1;
    while (lo < hi) {
      const m = Math.floor((lo + hi) / 2);
      const rect = pages[m].shell.getBoundingClientRect();
      if (rect.bottom < mid) lo = m + 1;
      else hi = m;
    }
    const next = lo + 1;
    if (next !== this.current) {
      this.current = next;
      this.syncHistory();
    }
  }

  private async savePdf() {
    if (!this.doc) return;
    this.progress("Saving PDF…", 0.02, true);
    const { PDFDocument, rgb } = await import("pdf-lib");
    const original = this.pdfBlob ? await PDFDocument.load(await this.pdfBlob.arrayBuffer()) : null;
    const src = await PDFDocument.create();
    const total = this.doc.pages.length;
    for (let i = 0; i < total; i++) {
      const page = this.doc.pages[i];
      let pg;
      if (original && page.pdfNumber) {
        const [copied] = await src.copyPages(original, [page.pdfNumber - 1]);
        pg = src.addPage(copied);
      } else {
        pg = src.addPage([page.baseW, page.baseH]);
        const [pr, pgC, pb] = hexRgb(page.paper || "#ffffff");
        pg.drawRectangle({
          x: 0,
          y: 0,
          width: page.baseW,
          height: page.baseH,
          color: rgb(pr, pgC, pb),
        });
      }
      this.progress(`Saving page ${i + 1} of ${total}…`, (i + 1) / total, false);
      const W = pg.getWidth();
      const H = pg.getHeight();
      const sx = W / page.baseW;
      const sy = H / page.baseH;
      const overlay = page.objects.some((obj) => obj.type === "erase") ? this.rasterInk(page) : null;
      if (overlay) {
        const png = await src.embedPng(overlay.toDataURL("image/png"));
        pg.drawImage(png, { x: 0, y: 0, width: W, height: H });
      } else {
        for (const obj of page.objects) {
          const [r, g, b] = hexRgb(objColor(obj));
          const color = rgb(r, g, b);
          const opacity = "opacity" in obj ? obj.opacity : 1;
          if (obj.type === "stroke") {
            for (let j = 1; j < obj.points.length; j++) {
              const a = obj.points[j - 1];
              const c = obj.points[j];
              pg.drawLine({
                start: { x: a.x * sx, y: H - a.y * sy },
                end: { x: c.x * sx, y: H - c.y * sy },
                thickness: obj.width * sx,
                color,
                opacity,
              });
            }
          } else if (obj.type === "line" || obj.type === "arrow") {
            pg.drawLine({
              start: { x: obj.x1 * sx, y: H - obj.y1 * sy },
              end: { x: obj.x2 * sx, y: H - obj.y2 * sy },
              thickness: obj.width * sx,
              color,
              opacity,
            });
            if (obj.type === "arrow") {
              const ang = Math.atan2(obj.y2 - obj.y1, obj.x2 - obj.x1);
              const len = Math.max(14, obj.width * 4);
              const ax = obj.x2 - len * Math.cos(ang - 0.42);
              const ay = obj.y2 - len * Math.sin(ang - 0.42);
              const bx = obj.x2 - len * Math.cos(ang + 0.42);
              const by = obj.y2 - len * Math.sin(ang + 0.42);
              pg.drawLine({
                start: { x: obj.x2 * sx, y: H - obj.y2 * sy },
                end: { x: ax * sx, y: H - ay * sy },
                thickness: obj.width * sx,
                color,
                opacity,
              });
              pg.drawLine({
                start: { x: obj.x2 * sx, y: H - obj.y2 * sy },
                end: { x: bx * sx, y: H - by * sy },
                thickness: obj.width * sx,
                color,
                opacity,
              });
            }
          } else if (obj.type === "rect") {
            const x = Math.min(obj.x, obj.x + obj.w);
            const y = Math.min(obj.y, obj.y + obj.h);
            pg.drawRectangle({
              x: x * sx,
              y: H - (y + Math.abs(obj.h)) * sy,
              width: Math.abs(obj.w) * sx,
              height: Math.abs(obj.h) * sy,
              borderColor: color,
              borderWidth: obj.width * sx,
              opacity,
            });
          } else if (obj.type === "circle") {
            pg.drawEllipse({
              x: (obj.x + obj.w / 2) * sx,
              y: H - (obj.y + obj.h / 2) * sy,
              xScale: Math.abs(obj.w / 2) * sx,
              yScale: Math.abs(obj.h / 2) * sy,
              borderColor: color,
              borderWidth: obj.width * sx,
              opacity,
            });
          } else if (obj.type === "triangle") {
            const tri = (() => {
              const x0 = Math.min(obj.x, obj.x + obj.w);
              const y0 = Math.min(obj.y, obj.y + obj.h);
              const x1 = Math.max(obj.x, obj.x + obj.w);
              const y1 = Math.max(obj.y, obj.y + obj.h);
              return [
                { x: (x0 + x1) / 2, y: y0 },
                { x: x1, y: y1 },
                { x: x0, y: y1 },
              ];
            })();
            const pts: [number, number][] = [
              [tri[0].x * sx, H - tri[0].y * sy],
              [tri[1].x * sx, H - tri[1].y * sy],
              [tri[2].x * sx, H - tri[2].y * sy],
            ];
            for (let k = 0; k < 3; k++) {
              const p1 = pts[k];
              const p2 = pts[(k + 1) % 3];
              pg.drawLine({
                start: { x: p1[0], y: p1[1] },
                end: { x: p2[0], y: p2[1] },
                thickness: obj.width * sx,
                color,
                opacity,
              });
            }
          } else if (obj.type === "text") {
            const safe = obj.text.replace(/[^\x20-\x7E]/g, "?");
            try {
              pg.drawText(safe, {
                x: obj.x * sx,
                y: H - obj.y * sy,
                size: Math.max(8, obj.fontSize * sx),
                color,
                opacity,
              });
            } catch {
              /* skip text the standard font cannot encode */
            }
          }
        }
      }
      for (const media of page.media) {
        try {
          const blob = await fetch(media.src).then((res) => res.blob());
          let image;
          if (blob.type === "image/png") image = await src.embedPng(await blob.arrayBuffer());
          else if (blob.type === "image/jpeg") image = await src.embedJpg(await blob.arrayBuffer());
          else {
            const bmp = await createImageBitmap(blob);
            const c = document.createElement("canvas");
            c.width = bmp.width;
            c.height = bmp.height;
            c.getContext("2d")?.drawImage(bmp, 0, 0);
            image = await src.embedPng(c.toDataURL("image/png"));
          }
          pg.drawImage(image, {
            x: media.x * sx,
            y: H - (media.y + media.h) * sy,
            width: media.w * sx,
            height: media.h * sy,
          });
        } catch (err) {
          console.warn(err);
        }
      }
      if (i % 2 === 1) await yieldThread();
    }
    const out = await src.save();
    downloadBlob(new Blob([out.slice()], { type: "application/pdf" }), `${this.docName}_annotated.pdf`);
    this.patch({ progress: null });
    this.say("PDF saved");
  }

  private async saveHtml() {
    const page = this.doc?.pages[0];
    if (!page) return;
    this.progress("Saving HTML…", 0.3, true);
    let html = this.htmlSource.replace(
      /<style id="teachpdf-annot-style">[\s\S]*?<\/style>|<div id="teachpdf-annot">[\s\S]*?<!--teachpdf-annot-end-->/g,
      "",
    );
    html = await this.inlineBlobs(html);
    const svg = page.objects.map((obj) => objSvg(obj)).join("");
    const clips: string[] = [];
    for (const media of page.media) {
      let src = media.src;
      const file = this.urlFiles.get(media.src);
      if (file && file.size <= 12 * 1024 * 1024) src = await blobToData(file);
      else if (src.startsWith("blob:")) continue;
      const tag = media.kind === "video" ? "video" : "img";
      const extra = media.kind === "video" ? " controls playsinline" : "";
      const rot = media.rotation ?? 0;
      const tx = media.x + media.w / 2;
      const ty = media.y + media.h / 2;
      clips.push(
        `<${tag} src="${src}"${extra} style="position:absolute;left:0;top:0;width:${media.w}px;height:${media.h}px;transform:translate(${tx - media.w / 2}px, ${ty - media.h / 2}px) rotate(${rot}deg);transform-origin:${media.w / 2}px ${media.h / 2}px"></${tag}>`,
      );
    }
    const block = `<style id="teachpdf-annot-style">#teachpdf-annot{position:absolute;left:0;top:0;width:${page.baseW}px;height:${page.baseH}px;pointer-events:none;z-index:2147483000}</style><div id="teachpdf-annot"><svg width="${page.baseW}" height="${page.baseH}" viewBox="0 0 ${page.baseW} ${page.baseH}">${svg}</svg>${clips.join("")}</div><!--teachpdf-annot-end-->`;
    if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, `${block}</body>`);
    else html += block;
    downloadBlob(new Blob([html], { type: "text/html" }), `${this.docName}_annotated.html`);
    this.patch({ progress: null });
    this.say(
      clips.length < page.media.length
        ? "HTML saved. A very large clip was left out so the phone stays stable."
        : "HTML saved — animation kept",
    );
  }

  private async inlineBlobs(html: string) {
    const found = html.match(/blob:[^"' )\s]+/g) ?? [];
    let out = html;
    let skipped = false;
    for (const url of [...new Set(found)]) {
      const file = this.urlFiles.get(url);
      if (!file) continue;
      if (file.size > 12 * 1024 * 1024) {
        skipped = true;
        continue;
      }
      const data = await blobToData(file);
      out = out.split(url).join(data);
    }
    if (skipped) this.say("A very large attachment was left out of the download");
    return out;
  }

  private progress(label: string, ratio: number, force: boolean) {
    if (!force && ratio < 1 && ratio - this.progLast < 0.05) return;
    this.progLast = ratio;
    this.patch({ progress: { label, ratio } });
  }

  private patch(p: TeachPatch) {
    if (this.alive) this.hooks.patch(p);
  }

  private say(text: string, ms = 1700) {
    const n = ++this.statusN;
    this.patch({ status: text });
    window.setTimeout(() => {
      if (this.statusN === n) this.patch({ status: "" });
    }, ms);
  }
}

function objColor(obj: DrawObj) {
  return obj.type === "erase" ? "#000000" : obj.color;
}

function hexRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function blobToData(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function measureBox(url: string, kind: "image" | "video") {
  return new Promise<{ w: number; h: number }>((resolve) => {
    if (kind === "video") {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => resolve({ w: video.videoWidth || 320, h: video.videoHeight || 180 });
      video.onerror = () => resolve({ w: 320, h: 180 });
      video.src = url;
      return;
    }
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 240, h: img.naturalHeight || 180 });
    img.onerror = () => resolve({ w: 240, h: 180 });
    img.src = url;
  });
}
