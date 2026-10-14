import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Circle,
  Crosshair,
  Download,
  Eraser,
  FilePlus,
  FolderOpen,
  Hand,
  Highlighter,
  ImagePlus,
  Maximize2,
  Minimize2,
  Minus,
  Pencil,
  Plus,
  Redo2,
  Slash,
  Square,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { COLORS, colorName } from "@/components/teach/ink";
import { Engine, type Prefs, type StageEls, type TeachHooks, type TeachPatch, type Tool } from "@/components/teach/engine";
import { sampleHtml } from "@/components/teach/sample";

type Ask =
  | { kind: "text"; title: string; placeholder?: string }
  | { kind: "page"; current: number; total: number };

const Stage = memo(function Stage({
  hooksRef,
  onReady,
}: {
  hooksRef: RefObject<TeachHooks | null>;
  onReady: (engine: Engine | null) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const els: StageEls = {
      scroll: scrollRef.current!,
      sizer: sizerRef.current!,
      stage: stageRef.current!,
    };
    const engine = new Engine(els, {
      getPrefs: () => hooksRef.current!.getPrefs(),
      patch: (p) => hooksRef.current!.patch(p),
      onZoom: (z) => hooksRef.current!.onZoom(z),
      requestText: (opts) => hooksRef.current!.requestText(opts),
      requestPage: (current, total) => hooksRef.current!.requestPage(current, total),
      onEscape: () => hooksRef.current!.onEscape(),
      onJump: () => hooksRef.current!.onJump(),
    });
    onReady(engine);
    return () => {
      engine.destroy();
      onReady(null);
    };
  }, [hooksRef, onReady]);

  return (
    <div ref={scrollRef} className="teach-scroll">
      <div ref={sizerRef} className="teach-sizer">
        <div ref={stageRef} className="teach-stage" />
        <div className="dock-spacer" />
      </div>
    </div>
  );
});

export function TeachApp() {
  const engineRef = useRef<Engine | null>(null);
  const zoomRef = useRef<HTMLSpanElement>(null);
  const zoomLive = useRef(1);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<HTMLInputElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const askRef = useRef<((value: string | null) => void) | null>(null);
  const [tool, setTool] = useState<Tool>("hand");
  const [color, setColor] = useState<string>(COLORS[0]);
  const [size, setSize] = useState(5);
  const [eraserSize, setEraserSize] = useState(18);
  const [opacity, setOpacity] = useState(100);
  const [invert, setInvert] = useState(false);
  const [shapeDetect, setShapeDetect] = useState(false);
  const [padsHidden, setPadsHidden] = useState(false);
  const [blankOpen, setBlankOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [thumbsOpen, setThumbsOpen] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [draft, setDraft] = useState("");
  const [ui, setUi] = useState({
    docName: "",
    kind: null as "pdf" | "html" | null,
    page: 1,
    pageCount: 0,
    canUndo: false,
    canRedo: false,
    status: "",
    progress: null as { label: string; ratio: number } | null,
    video: false,
    ready: false,
  });

  const prefsRef = useRef<Prefs>({
    tool: "hand",
    color: COLORS[0],
    size: 5,
    eraserSize: 18,
    opacity: 1,
    invert: false,
    shapeDetect: false,
  });
  prefsRef.current = {
    tool,
    color,
    size,
    eraserSize,
    opacity: opacity / 100,
    invert,
    shapeDetect,
  };

  const hooksRef = useRef<TeachHooks>(null!);
  hooksRef.current = {
    getPrefs: () => prefsRef.current,
    patch: (p: TeachPatch) => {
      setUi((prev) => ({
        docName: p.docName ?? prev.docName,
        kind: p.kind === undefined ? prev.kind : p.kind,
        page: p.page ?? prev.page,
        pageCount: p.pageCount ?? prev.pageCount,
        canUndo: p.canUndo ?? prev.canUndo,
        canRedo: p.canRedo ?? prev.canRedo,
        status: p.status ?? prev.status,
        progress: p.progress === undefined ? prev.progress : p.progress,
        video: p.video ?? prev.video,
        ready: p.ready ?? prev.ready,
      }));
    },
    onZoom: (z: number) => {
      zoomLive.current = z;
      if (zoomRef.current) zoomRef.current.textContent = `${Math.round(z * 100)}%`;
    },
    requestText: (opts) =>
      new Promise((resolve) => {
        askRef.current = resolve;
        setDraft("");
        setAsk({ kind: "text", title: opts.title, placeholder: opts.placeholder });
      }),
    requestPage: (current, total) =>
      new Promise((resolve) => {
        askRef.current = (value) => {
          if (!value) {
            resolve(null);
            return;
          }
          const n = Number.parseInt(value, 10);
          resolve(Number.isFinite(n) ? n : null);
        };
        setDraft(String(current));
        setAsk({ kind: "page", current, total });
      }),
    onEscape: () => {
      setBlankOpen(false);
      setSettingsOpen(false);
      setThumbsOpen(false);
    },
    onJump: () => setThumbsOpen(false),
  };

  const onReady = useCallback((engine: Engine | null) => {
    engineRef.current = engine;
  }, []);

  useLayoutEffect(() => {
    if (zoomRef.current) zoomRef.current.textContent = `${Math.round(zoomLive.current * 100)}%`;
  });

  useEffect(() => {
    engineRef.current?.notePrefs();
  }, [tool, invert]);

  useEffect(() => {
    if (thumbsOpen && thumbRef.current) void engineRef.current?.fillThumbs(thumbRef.current);
  }, [thumbsOpen, ui.docName, ui.pageCount]);

  useEffect(() => {
    const node = dirRef.current;
    if (!node) return;
    node.setAttribute("webkitdirectory", "");
    node.setAttribute("directory", "");
  }, []);

  function closeAsk(value: string | null) {
    const resolve = askRef.current;
    askRef.current = null;
    setAsk(null);
    resolve?.(value);
  }

  function chooseFiles(list: FileList | null) {
    const files = list ? [...list] : [];
    if (files.length) void engineRef.current?.openFiles(files);
  }

  return (
    <div className={`teach-app${padsHidden ? " is-focus" : ""}`}>
      <header className="teach-top">
        <div className="teach-brand">
          <img src="/favicon.svg" alt="" />
          <strong>TeachPDF</strong>
        </div>
        <div className="teach-actions">
          <button type="button" className="teach-btn is-primary" onClick={() => fileRef.current?.click()}>
            <FolderOpen size={18} />
            <span className="label">Open</span>
          </button>
          <button type="button" className="teach-btn" aria-label="Previous page" onClick={() => engineRef.current?.prev()}>
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="teach-btn"
            onClick={() => void engineRef.current?.askPage()}
            aria-label="Go to page"
          >
            {ui.ready ? `${ui.page} / ${ui.pageCount}` : "—"}
          </button>
          <button type="button" className="teach-btn" aria-label="Next page" onClick={() => engineRef.current?.next()}>
            <ChevronRight size={18} />
          </button>
          <button type="button" className="teach-btn" aria-label="Zoom out" onClick={() => engineRef.current?.zoomOut()}>
            <Minus size={18} />
          </button>
          <button type="button" className="teach-btn" aria-label="Fit width" onClick={() => engineRef.current?.fit()}>
            <span ref={zoomRef}>100%</span>
          </button>
          <button type="button" className="teach-btn" aria-label="Zoom in" onClick={() => engineRef.current?.zoomIn()}>
            <Plus size={18} />
          </button>
          <button type="button" className="teach-btn" aria-label="Fit page" onClick={() => engineRef.current?.fit()}>
            <Maximize2 size={18} />
          </button>
          <button type="button" className="teach-btn" aria-label="Undo" onClick={() => engineRef.current?.undo()}>
            <Undo2 size={18} />
          </button>
          <button type="button" className="teach-btn" aria-label="Redo" onClick={() => engineRef.current?.redo()}>
            <Redo2 size={18} />
          </button>
          <button type="button" className="teach-btn" aria-label="Save" onClick={() => void engineRef.current?.save()}>
            <Download size={18} />
          </button>
        </div>
      </header>

      <div
        className="teach-main"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          chooseFiles(event.dataTransfer.files);
        }}
      >
        <Stage hooksRef={hooksRef} onReady={onReady} />

        {!ui.ready && (
          <div className="teach-empty">
            <div className="teach-card">
              <p className="teach-kicker">Classroom viewer</p>
              <h1>Teach on the document</h1>
              <p>
                Open a PDF, or an HTML lesson with pictures, GIFs, and video. Animation stays alive — the page
                is not flattened to a screenshot.
              </p>
              <div className="gesture-list">
                <div>
                  <strong>Pinch</strong>
                  <span>Zoom, like a PDF reader</span>
                </div>
                <div>
                  <strong>Hand</strong>
                  <span>One finger scrolls. Double-tap zooms.</span>
                </div>
                <div>
                  <strong>Pen</strong>
                  <span>One finger writes. Two fingers still move the page.</span>
                </div>
                <div>
                  <strong>Video</strong>
                  <span>Hand, then tap the video to use its controls.</span>
                </div>
              </div>
              <div className="teach-card-actions">
                <button type="button" className="teach-btn is-primary" onClick={() => fileRef.current?.click()}>
                  <FolderOpen size={18} />
                  <span className="label">Open file</span>
                </button>
                <button type="button" className="teach-btn" onClick={() => dirRef.current?.click()}>
                  <span className="label">Folder</span>
                </button>
                <button
                  type="button"
                  className="teach-btn"
                  onClick={() => void engineRef.current?.openHtmlText("fractions.html", sampleHtml())}
                >
                  <span className="label">Sample HTML</span>
                </button>
                <button
                  type="button"
                  className="teach-btn"
                  onClick={() => {
                    void (async () => {
                      const res = await fetch("/sample-lesson.pdf");
                      const file = new File([await res.arrayBuffer()], "sample-lesson.pdf", {
                        type: "application/pdf",
                      });
                      await engineRef.current?.openPdfFile(file);
                    })();
                  }}
                >
                  <span className="label">Sample PDF</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {ui.status && <div className="teach-toast">{ui.status}</div>}

        {ui.video && (
          <div className="teach-chip">
            Video controls
            <button type="button" className="teach-btn" onClick={() => engineRef.current?.clearVideoFocus()}>
              Done
            </button>
          </div>
        )}

        {blankOpen && (
          <div className="teach-pop" role="group" aria-label="Blank page color">
            <button
              type="button"
              className="teach-btn"
              onClick={() => {
                engineRef.current?.addBlank("white");
                setBlankOpen(false);
              }}
            >
              White
            </button>
            <button
              type="button"
              className="teach-btn"
              onClick={() => {
                engineRef.current?.addBlank("black");
                setBlankOpen(false);
              }}
            >
              Black
            </button>
          </div>
        )}

        <div className="teach-dock" role="toolbar" aria-label="Teaching tools">
          <button
            type="button"
            className={`teach-tool${tool === "hand" ? " is-on" : ""}`}
            aria-label="Pan"
            aria-pressed={tool === "hand"}
            onClick={() => setTool("hand")}
          >
            <Hand size={18} />
          </button>
          <button
            type="button"
            className={`teach-tool${tool === "pen" ? " is-on" : ""}`}
            aria-label="Pen"
            aria-pressed={tool === "pen"}
            onClick={() => setTool("pen")}
          >
            <Pencil size={18} />
          </button>
          <div className="ink-colors" role="listbox" aria-label="Pen colors">
            {COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                role="option"
                aria-selected={color === swatch}
                aria-label={colorName(swatch)}
                className={`swatch${color === swatch ? " is-on" : ""}${swatch === "#ffffff" ? " swatch-light" : ""}`}
                style={{ background: swatch }}
                onClick={() => {
                  setColor(swatch);
                  if (tool !== "highlighter" && tool !== "text") setTool("pen");
                }}
              />
            ))}
          </div>
          <button
            type="button"
            className={`teach-tool${tool === "eraser" ? " is-on" : ""}`}
            aria-label="Object eraser"
            aria-pressed={tool === "eraser"}
            onClick={() => setTool("eraser")}
          >
            <Eraser size={18} />
          </button>
          <button
            type="button"
            className={`teach-tool${tool === "scrub" ? " is-on" : ""}`}
            aria-label="Pixel eraser"
            aria-pressed={tool === "scrub"}
            onClick={() => setTool("scrub")}
          >
            <PixelIcon />
          </button>
          {(tool === "eraser" || tool === "scrub") && (
            <label className="eraser-size">
              <span className="sr-only">{tool === "scrub" ? "Pixel eraser size" : "Object eraser size"}</span>
              <input
                type="range"
                min={4}
                max={48}
                value={eraserSize}
                onChange={(event) => setEraserSize(Number(event.target.value))}
              />
            </label>
          )}
          <button
            type="button"
            className={`teach-tool${tool === "laser" ? " is-on" : ""}`}
            aria-label="Laser"
            aria-pressed={tool === "laser"}
            onClick={() => setTool("laser")}
          >
            <Crosshair size={18} />
          </button>
          <button
            type="button"
            className={`teach-tool${shapeDetect ? " is-on" : ""}`}
            aria-label={shapeDetect ? "Shape detection on" : "Shape detection off"}
            aria-pressed={shapeDetect}
            onClick={() => {
              setShapeDetect((on) => !on);
              setTool("pen");
            }}
          >
            <DetectIcon />
          </button>
          <button
            type="button"
            className={`teach-tool${tool === "line" ? " is-on" : ""}`}
            aria-label="Line"
            aria-pressed={tool === "line"}
            onClick={() => setTool("line")}
          >
            <Slash size={18} />
          </button>
          <button
            type="button"
            className={`teach-tool${tool === "rect" ? " is-on" : ""}`}
            aria-label="Rectangle"
            aria-pressed={tool === "rect"}
            onClick={() => setTool("rect")}
          >
            <Square size={18} />
          </button>
          <button
            type="button"
            className={`teach-tool${tool === "circle" ? " is-on" : ""}`}
            aria-label="Circle"
            aria-pressed={tool === "circle"}
            onClick={() => setTool("circle")}
          >
            <Circle size={18} />
          </button>
          <button
            type="button"
            className={`teach-tool${tool === "arrow" ? " is-on" : ""}`}
            aria-label="Arrow"
            aria-pressed={tool === "arrow"}
            onClick={() => setTool("arrow")}
          >
            <ArrowUpRight size={18} />
          </button>
          <button
            type="button"
            className={`teach-tool${tool === "text" ? " is-on" : ""}`}
            aria-label="Text"
            aria-pressed={tool === "text"}
            onClick={() => setTool("text")}
          >
            <Type size={18} />
          </button>
          <button
            type="button"
            className={`teach-tool${tool === "highlighter" ? " is-on" : ""}`}
            aria-label="Highlighter"
            aria-pressed={tool === "highlighter"}
            onClick={() => setTool("highlighter")}
          >
            <Highlighter size={18} />
          </button>
          <button
            type="button"
            className={`teach-tool${blankOpen ? " is-on" : ""}`}
            aria-label="Add a blank page"
            aria-pressed={blankOpen}
            onClick={() => {
              setBlankOpen((open) => !open);
              setSettingsOpen(false);
            }}
          >
            <FilePlus size={18} />
          </button>
          <button
            type="button"
            className="teach-tool"
            aria-label="Add image, GIF, or video"
            onClick={() => mediaRef.current?.click()}
          >
            <ImagePlus size={18} />
          </button>
          <button
            type="button"
            className={`teach-tool${settingsOpen ? " is-on" : ""}`}
            aria-label="Thickness and page options"
            onClick={() => {
              setSettingsOpen((open) => !open);
              setBlankOpen(false);
            }}
          >
            <SlidersIcon />
          </button>
          <button
            type="button"
            className={`teach-tool${thumbsOpen ? " is-on" : ""}`}
            aria-label="Pages"
            onClick={() => setThumbsOpen((open) => !open)}
          >
            <PagesIcon />
          </button>
          <button
            type="button"
            className={`teach-tool${padsHidden ? " is-on" : ""}`}
            aria-label={padsHidden ? "Show header and tool pads" : "Hide header and tool pads"}
            aria-pressed={padsHidden}
            onClick={() => setPadsHidden((hidden) => !hidden)}
          >
            <Minimize2 size={18} />
          </button>
        </div>

        {settingsOpen && (
          <div className="teach-sheet">
            <h2>Stroke and page</h2>
            <div className="setting-row">
              <label htmlFor="thickness">Thickness</label>
              <input
                id="thickness"
                type="range"
                min={1}
                max={32}
                value={size}
                onChange={(event) => setSize(Number(event.target.value))}
              />
            </div>
            <div className="setting-row">
              <label htmlFor="opacity">Opacity</label>
              <input
                id="opacity"
                type="range"
                min={15}
                max={100}
                value={opacity}
                onChange={(event) => setOpacity(Number(event.target.value))}
              />
            </div>
            <div className="setting-row">
              <span>PDF invert</span>
              <button
                type="button"
                className={`teach-btn${invert ? " is-on" : ""}`}
                onClick={() => {
                  if (ui.kind !== "pdf") {
                    engineRef.current?.flash("Invert is for PDF pages");
                    return;
                  }
                  setInvert((value) => !value);
                }}
              >
                {invert ? "On" : "Off"}
              </button>
            </div>
            <div className="setting-row">
              <span>Clear page</span>
              <button type="button" className="teach-btn" onClick={() => engineRef.current?.clearPage()}>
                Clear
              </button>
            </div>
            <div className="setting-row">
              <span>Close</span>
              <button type="button" className="teach-btn" onClick={() => setSettingsOpen(false)} aria-label="Close settings">
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {thumbsOpen && (
          <div className="teach-drawer">
            <div className="setting-row" style={{ marginTop: 0 }}>
              <h2>Pages</h2>
              <button type="button" className="teach-btn" onClick={() => setThumbsOpen(false)} aria-label="Close pages">
                <X size={16} />
              </button>
            </div>
            <div ref={thumbRef} className="thumb-list" />
          </div>
        )}

        {ui.progress && (
          <div className="teach-modal" role="status">
            <div className="panel">
              <h2>{ui.progress.label}</h2>
              <div className="progress-track">
                <i style={{ width: `${Math.round(ui.progress.ratio * 100)}%` }} />
              </div>
            </div>
          </div>
        )}

        {ask && (
          <div className="teach-modal">
            <form
              className="panel"
              onSubmit={(event) => {
                event.preventDefault();
                closeAsk(draft);
              }}
            >
              <h2>{ask.kind === "text" ? ask.title : `Go to page (1–${ask.total})`}</h2>
              {ask.kind === "text" ? (
                <textarea
                  autoFocus
                  rows={3}
                  placeholder={ask.placeholder}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
              ) : (
                <input
                  autoFocus
                  inputMode="numeric"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
              )}
              <div className="modal-actions">
                <button type="button" className="teach-btn" onClick={() => closeAsk(null)}>
                  Cancel
                </button>
                <button type="submit" className="teach-btn is-primary">
                  Place
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        accept=".pdf,.html,.htm,application/pdf,text/html"
        multiple
        onChange={(event) => {
          chooseFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={dirRef}
        className="sr-only"
        type="file"
        multiple
        onChange={(event) => {
          chooseFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={mediaRef}
        className="sr-only"
        type="file"
        accept="image/*,video/*,.gif"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void engineRef.current?.insertMedia(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}

function SlidersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 7h10M4 17h6M14 17h6M18 7h2" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="12" cy="17" r="2" />
    </svg>
  );
}

function PagesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="4" y="3" width="12" height="16" rx="1.5" />
      <path d="M8 7h6M8 11h6M10 19h10v2" />
    </svg>
  );
}
