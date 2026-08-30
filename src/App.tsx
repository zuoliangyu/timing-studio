import {
  AlignLeft, ArrowDown, ArrowDownUp, ArrowLeft, ArrowRight, ArrowUp, Blocks, Bus, Check, ChevronDown,
  CircleHelp, Clock3, Copy, Download, FileCode2, FileDown, FileText, FileUp, GripVertical,
  Highlighter, ImageDown, Layers3, Maximize2, MoveRight, Plus, Radio, Redo2, RotateCcw,
  Rows3, Search, Timer, Trash2, Undo2, Zap, ZoomIn, ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import initWasm, { convert, inspect, render, tikz } from "./wasm/timing_wasm";
import { examples } from "./examples";

type SourceFormat = "dsl" | "yaml";
type EditorMode = "blocks" | SourceFormat;
type HistoryEntry = { source: string; format: SourceFormat; mode: EditorMode };
type Signal = {
  name: string;
  group?: string;
  clock?: { period: number; cycles: number; start: number };
  digital?: { points: { at: number; value: string }[] };
  bus?: { segments: { from: number; to: number; value: string }[] };
};
type SpanTarget = { signal: string } | { group: string };
type Diagram = {
  title?: string;
  unit: string;
  signals: Signal[];
  markers: { at: number; label?: string }[];
  spans: { from: number; to: number; label: string; kind?: "interval" | "setup" | "hold"; under?: SpanTarget }[];
  arrows: { from: { signal: string; at: number }; to: { signal: string; at: number }; label?: string }[];
};

const defaultSource = examples["固定闸门计数"];
const initialSource = localStorage.getItem("timing-source") ?? defaultSource;
const detectFormat = (source: string): SourceFormat => source.trimStart().startsWith("timing") ? "dsl" : "yaml";

function App() {
  const [source, setSource] = useState(initialSource);
  const [format, setFormat] = useState<SourceFormat>(() => detectFormat(initialSource));
  const [editorMode, setEditorMode] = useState<EditorMode>(() => detectFormat(initialSource));
  const [svg, setSvg] = useState("");
  const [diagram, setDiagram] = useState<Diagram | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [validating, setValidating] = useState(true);
  const [ready, setReady] = useState(false);
  const [exampleOpen, setExampleOpen] = useState(false);
  const [signalMenuOpen, setSignalMenuOpen] = useState(false);
  const [snippetMenuOpen, setSnippetMenuOpen] = useState(false);
  const [spanMenuOpen, setSpanMenuOpen] = useState(false);
  const [groupPanelOpen, setGroupPanelOpen] = useState(false);
  const [sourceHelpOpen, setSourceHelpOpen] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [exportingPng, setExportingPng] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [past, setPast] = useState<HistoryEntry[]>([]);
  const [future, setFuture] = useState<HistoryEntry[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const textEditStartRef = useRef<HistoryEntry | null>(null);

  const errorLine = useMemo(() => {
    if (!error) return null;
    const match = error.match(/第\s*(\d+)\s*行|\bline\s+(\d+)\b/i);
    const line = Number(match?.[1] ?? match?.[2]);
    return Number.isInteger(line) && line > 0 ? line : null;
  }, [error]);

  useEffect(() => {
    initWasm().then(() => setReady(true)).catch((reason) => {
      setError(String(reason));
      setValidating(false);
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    setError(null);
    setValidating(true);
    const timeout = window.setTimeout(() => {
      try {
        setSvg(render(source, false));
        setDiagram(JSON.parse(inspect(source)) as Diagram);
        localStorage.setItem("timing-source", source);
      } catch (reason) {
        setError(String(reason));
      } finally {
        setValidating(false);
      }
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [source, ready]);

  const remember = (entry: HistoryEntry) => {
    setPast((items) => [...items.slice(-49), entry]);
    setFuture([]);
  };

  const applySource = (nextSource: string, nextFormat = format, record = true) => {
    if (nextSource === source && nextFormat === format) return;
    if (record) remember({ source, format, mode: editorMode });
    setError(null);
    setValidating(true);
    setSource(nextSource);
    setFormat(nextFormat);
  };

  const restoreHistory = (entry: HistoryEntry) => {
    setError(null);
    setEditError(null);
    setSource(entry.source);
    setFormat(entry.format);
    setEditorMode(entry.mode);
  };

  const undo = () => {
    const entry = past.at(-1);
    if (!entry) return;
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [{ source, format, mode: editorMode }, ...items].slice(0, 50));
    restoreHistory(entry);
  };

  const redo = () => {
    const [entry, ...rest] = future;
    if (!entry) return;
    setFuture(rest);
    setPast((items) => [...items.slice(-49), { source, format, mode: editorMode }]);
    restoreHistory(entry);
  };

  const changeFormat = (nextFormat: SourceFormat) => {
    if (!ready) return;
    setSourceHelpOpen(false);
    if (nextFormat === format) {
      setEditorMode(nextFormat);
      return;
    }
    try {
      applySource(convert(source, nextFormat), nextFormat);
      setEditorMode(nextFormat);
    } catch (reason) {
      setError(String(reason));
    }
  };

  const formatSource = () => {
    if (!ready || error || validating) return;
    try {
      applySource(convert(source, format), format);
    } catch (reason) {
      setError(String(reason));
    }
  };

  const mutateDiagram = (mutate: (draft: Diagram) => void) => {
    if (!diagram) return false;
    const draft = structuredClone(diagram);
    mutate(draft);
    try {
      const nextSource = convert(JSON.stringify(draft), format);
      setEditError(null);
      setDiagram(draft);
      applySource(nextSource);
      return true;
    } catch (reason) {
      setEditError(String(reason));
      return false;
    }
  };

  const uniqueName = (base: string, signals = diagram?.signals ?? []) => {
    const names = new Set(signals.map((signal) => signal.name));
    if (!names.has(base)) return base;
    let suffix = 2;
    while (names.has(`${base}_${suffix}`)) suffix += 1;
    return `${base}_${suffix}`;
  };

  const uniqueGroupName = (base: string, signals: Signal[]) => {
    const groups = new Set(signals.flatMap((signal) => signal.group ? [signal.group] : []));
    if (!groups.has(base)) return base;
    let suffix = 2;
    while (groups.has(`${base}_${suffix}`)) suffix += 1;
    return `${base}_${suffix}`;
  };

  const addSignalTemplate = (template: "clock" | "low" | "high" | "pulse" | "negative-pulse" | "bus") => mutateDiagram((draft) => {
    const name = uniqueName(template === "clock" ? "CLK" : template === "bus" ? "DATA" : "SIGNAL", draft.signals);
    const signal: Signal = template === "clock"
      ? { name, clock: { period: 2, cycles: 4, start: 0 } }
      : template === "bus"
        ? { name, bus: { segments: [{ from: 0, to: 4, value: "VALUE" }] } }
        : {
          name,
          digital: {
            points: template === "low" ? [{ at: 0, value: "low" }]
              : template === "high" ? [{ at: 0, value: "high" }]
                : template === "negative-pulse"
                  ? [{ at: 0, value: "high" }, { at: 1, value: "low" }, { at: 3, value: "high" }]
                  : [{ at: 0, value: "low" }, { at: 1, value: "high" }, { at: 3, value: "low" }],
          },
        };
    draft.signals.push(signal);
    setSelectedSignal(name);
  });

  const addSnippet = (kind: "clock-reset" | "handshake" | "spi") => mutateDiagram((draft) => {
    const group = uniqueGroupName(kind === "clock-reset" ? "时序" : kind === "handshake" ? "握手" : "SPI", draft.signals);
    const append = (base: string, definition: Omit<Signal, "name" | "group">) => {
      const name = uniqueName(base, draft.signals);
      draft.signals.push({ name, group, ...definition });
      return name;
    };
    if (kind === "clock-reset") {
      append("CLK", { clock: { period: 2, cycles: 6, start: 0 } });
      append("RESET_N", { digital: { points: [{ at: 0, value: "low" }, { at: 2, value: "high" }] } });
    } else if (kind === "handshake") {
      append("VALID", { digital: { points: [{ at: 0, value: "low" }, { at: 2, value: "high" }, { at: 8, value: "low" }] } });
      append("READY", { digital: { points: [{ at: 0, value: "low" }, { at: 4, value: "high" }, { at: 8, value: "low" }] } });
      append("DATA", { bus: { segments: [{ from: 2, to: 5, value: "A5" }, { from: 5, to: 8, value: "3C" }] } });
    } else {
      append("SCLK", { clock: { period: 2, cycles: 8, start: 1 } });
      append("CS_N", { digital: { points: [{ at: 0, value: "high" }, { at: 1, value: "low" }, { at: 17, value: "high" }] } });
      append("MOSI", { bus: { segments: [{ from: 1, to: 9, value: "0x9F" }, { from: 9, to: 17, value: "ADDR" }] } });
      append("MISO", { bus: { segments: [{ from: 1, to: 9, value: "Z" }, { from: 9, to: 17, value: "0xEF" }] } });
    }
  });

  const addSpan = (kind: "interval" | "setup" | "hold" = "interval") => mutateDiagram((draft) => draft.spans.push({
    from: 1,
    to: 4,
    label: kind === "setup" ? "建立时间 T_setup" : kind === "hold" ? "保持时间 T_hold" : "时间区间",
    ...(kind === "interval" ? {} : { kind }),
    ...(selectedSignal && draft.signals.some((signal) => signal.name === selectedSignal)
      ? { under: { signal: selectedSignal } }
      : {}),
  }));
  const addArrow = () => mutateDiagram((draft) => {
    const from = draft.signals[0]?.name;
    const to = draft.signals[1]?.name ?? from;
    if (!from || !to) return;
    draft.arrows.push({ from: { signal: from, at: 1 }, to: { signal: to, at: 2 }, label: "因果关系" });
  });
  const removeSignal = (name: string) => mutateDiagram((draft) => {
    const removedGroup = draft.signals.find((signal) => signal.name === name)?.group;
    draft.signals = draft.signals.filter((signal) => signal.name !== name);
    draft.arrows = draft.arrows.filter((arrow) => arrow.from.signal !== name && arrow.to.signal !== name);
    for (const span of draft.spans) {
      if (span.under && "signal" in span.under && span.under.signal === name) delete span.under;
      if (removedGroup && span.under && "group" in span.under && span.under.group === removedGroup
        && !draft.signals.some((signal) => signal.group === removedGroup)) delete span.under;
    }
    setSelectedSignal(null);
  });

  const duplicateSignal = (index: number) => mutateDiagram((draft) => {
    const copy = structuredClone(draft.signals[index]);
    copy.name = uniqueName(`${copy.name}_副本`, draft.signals);
    draft.signals.splice(index + 1, 0, copy);
  });

  const moveSignal = (index: number, direction: number) => mutateDiagram((draft) => {
    const target = index + direction;
    if (target < 0 || target >= draft.signals.length) return;
    [draft.signals[index], draft.signals[target]] = [draft.signals[target], draft.signals[index]];
  });

  const downloadSvg = useCallback(() => {
    if (svg) downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), "timing-diagram.svg");
  }, [svg]);

  const downloadSource = () => downloadBlob(
    new Blob([source], { type: format === "dsl" ? "text/plain;charset=utf-8" : "text/yaml;charset=utf-8" }),
    `timing-diagram.${format === "dsl" ? "timing" : "yaml"}`,
  );

  const downloadPng = useCallback(async () => {
    if (!svg || exportingPng) return;
    setExportingPng(true);
    try {
      const canvas = await renderSvgToCanvas(svg, 2);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error("PNG 编码失败")), "image/png",
      ));
      downloadBlob(blob, "timing-diagram@2x.png");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExportingPng(false);
    }
  }, [svg, exportingPng]);

  const downloadTikz = () => {
    try {
      downloadBlob(new Blob([tikz(source)], { type: "text/plain;charset=utf-8" }), "timing-diagram.tex");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const downloadPdf = useCallback(async () => {
    if (!svg || exportingPdf) return;
    setExportingPdf(true);
    try {
      const canvas = await renderSvgToCanvas(svg, 2);
      const pageWidth = canvas.width / 2;
      const pageHeight = canvas.height / 2;
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({
        orientation: pageWidth >= pageHeight ? "landscape" : "portrait",
        unit: "pt",
        format: [pageWidth, pageHeight],
        compress: true,
      });
      pdf.addImage(canvas, "PNG", 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight(), undefined, "FAST");
      downloadBlob(pdf.output("blob"), "timing-diagram.pdf");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExportingPdf(false);
    }
  }, [svg, exportingPdf]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const target = event.target;
      const editing = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable);
      const key = event.key.toLocaleLowerCase();
      if (editing && (key === "z" || key === "y")) return;

      if (key === "1") {
        event.preventDefault();
        setEditorMode("blocks");
      } else if (key === "2") {
        event.preventDefault();
        changeFormat("dsl");
      } else if (key === "3") {
        event.preventDefault();
        changeFormat("yaml");
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        redo();
      } else if (key === "z") {
        event.preventDefault();
        undo();
      } else if (key === "s") {
        event.preventDefault();
        downloadSource();
      } else if (key === "e" && event.shiftKey && svg && !error && !validating) {
        event.preventDefault();
        downloadSvg();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [source, format, editorMode, past, future, ready, svg, error, validating]);

  const jumpToError = () => {
    if (!errorLine || !editorRef.current) return;
    const lines = source.split("\n");
    const start = lines.slice(0, errorLine - 1).reduce((length, line) => length + line.length + 1, 0);
    editorRef.current.focus();
    editorRef.current.setSelectionRange(start, start + (lines[errorLine - 1]?.length ?? 0));
    editorRef.current.scrollTop = Math.max(0, (errorLine - 3) * 21);
  };

  const loadExample = (value: string) => {
    const nextFormat = detectFormat(value);
    applySource(value, nextFormat);
    setEditorMode(nextFormat);
    setExampleOpen(false);
  };

  const canInsert = ready && !error && !validating && Boolean(diagram);

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Zap size={17} /></span><div><strong>Timing Studio</strong><small>论文级数字时序绘图</small></div></div>
      <div className="topbar-actions">
        <div className="example-picker">
          <button className="text-control" aria-expanded={exampleOpen} aria-haspopup="menu" onClick={() => setExampleOpen(!exampleOpen)}>示例 <ChevronDown size={14} /></button>
          {exampleOpen && <div className="example-menu" role="menu">{Object.entries(examples).map(([name, value]) => <button role="menuitem" key={name} onClick={() => loadExample(value)}>{name}</button>)}</div>}
        </div>
        <button className="icon-control" title="导入 DSL 或 YAML" onClick={() => fileRef.current?.click()}><FileUp size={17} /></button>
        <input ref={fileRef} hidden type="file" accept=".timing,.txt,.yaml,.yml,text/plain,text/yaml" onChange={async (event) => {
          const file = event.target.files?.[0];
          if (file) loadExample(await file.text());
        }} />
        <button className="icon-control" title={`下载当前 ${format.toUpperCase()} 源文件`} onClick={downloadSource}><FileDown size={17} /></button>
        <button className="icon-control" title="撤销" disabled={past.length === 0} onClick={undo}><Undo2 size={17} /></button>
        <button className="icon-control" title="重做" disabled={future.length === 0} onClick={redo}><Redo2 size={17} /></button>
        <button className="icon-control" title="导出 2 倍 PNG" disabled={!svg || Boolean(error) || validating} onClick={downloadPng}><ImageDown size={17} /></button>
        <button className="icon-control" title="导出 PDF" disabled={!svg || Boolean(error) || validating || exportingPdf} onClick={downloadPdf}><FileText size={17} /></button>
        <button className="icon-control" title="导出 TikZ" disabled={!svg || Boolean(error) || validating} onClick={downloadTikz}><FileCode2 size={17} /></button>
        <button className="primary-control" disabled={!svg || Boolean(error) || validating} onClick={downloadSvg}><Download size={16} />导出 SVG</button>
      </div>
    </header>

    <section className="workspace">
      <section className={`editor-pane mode-${editorMode}`} role="tabpanel" aria-labelledby={`mode-${editorMode}-tab`}>
        <div className="pane-heading">
          <div><span className="pane-kicker">EDITOR</span><h1>{editorMode === "blocks" ? "积木编辑" : "时序描述"}</h1></div>
          <div className="source-actions">
            <div className="format-switch" role="tablist" aria-label="编辑格式">
              <button id="mode-blocks-tab" role="tab" aria-selected={editorMode === "blocks"} tabIndex={editorMode === "blocks" ? 0 : -1} className={editorMode === "blocks" ? "active" : ""} onClick={() => { setEditorMode("blocks"); setSourceHelpOpen(false); }}><Blocks size={12} />积木</button>
              <button id="mode-dsl-tab" role="tab" aria-selected={editorMode === "dsl"} tabIndex={editorMode === "dsl" ? 0 : -1} className={editorMode === "dsl" ? "active" : ""} onClick={() => changeFormat("dsl")}>DSL</button>
              <button id="mode-yaml-tab" role="tab" aria-selected={editorMode === "yaml"} tabIndex={editorMode === "yaml" ? 0 : -1} className={editorMode === "yaml" ? "active" : ""} onClick={() => changeFormat("yaml")}>YAML</button>
            </div>
            {editorMode !== "blocks" && <button className="icon-control subtle" title={`格式化当前 ${format.toUpperCase()}`} disabled={!canInsert} onClick={formatSource}><AlignLeft size={15} /></button>}
            {editorMode !== "blocks" && <button className="icon-control subtle" aria-controls="source-guide" aria-expanded={sourceHelpOpen} aria-label={`查看 ${format.toUpperCase()} 使用说明`} onClick={() => setSourceHelpOpen((value) => !value)}><CircleHelp size={15} /></button>}
            <button className="icon-control subtle" title="恢复闸门示例" onClick={() => loadExample(defaultSource)}><RotateCcw size={15} /></button>
          </div>
        </div>
        <nav className="command-shelf" aria-label="添加内容">
          <span><Plus size={14} />添加内容</span>
          <div className="insert-picker">
            <button disabled={!canInsert} aria-expanded={signalMenuOpen} aria-haspopup="menu" onClick={() => { setSignalMenuOpen((value) => !value); setSnippetMenuOpen(false); setSpanMenuOpen(false); }}><Plus size={15} />插入信号<ChevronDown size={13} /></button>
            {signalMenuOpen && <div className="insert-menu signal-template-menu" role="menu">
              <button role="menuitem" onClick={() => { addSignalTemplate("clock"); setSignalMenuOpen(false); }}><MiniWave kind="clock" /><span><strong>时钟</strong><small>连续周期翻转</small></span></button>
              <button role="menuitem" onClick={() => { addSignalTemplate("pulse"); setSignalMenuOpen(false); }}><MiniWave kind="pulse" /><span><strong>正脉冲</strong><small>低电平中出现高脉冲</small></span></button>
              <button role="menuitem" onClick={() => { addSignalTemplate("negative-pulse"); setSignalMenuOpen(false); }}><MiniWave kind="negative-pulse" /><span><strong>负脉冲</strong><small>高电平中出现低脉冲</small></span></button>
              <button role="menuitem" onClick={() => { addSignalTemplate("low"); setSignalMenuOpen(false); }}><MiniWave kind="low" /><span><strong>恒定低电平</strong><small>初始值为 LOW</small></span></button>
              <button role="menuitem" onClick={() => { addSignalTemplate("high"); setSignalMenuOpen(false); }}><MiniWave kind="high" /><span><strong>恒定高电平</strong><small>初始值为 HIGH</small></span></button>
              <button role="menuitem" onClick={() => { addSignalTemplate("bus"); setSignalMenuOpen(false); }}><MiniWave kind="bus" /><span><strong>总线</strong><small>带一个数据片段</small></span></button>
            </div>}
          </div>
          <div className="insert-picker">
            <button disabled={!canInsert} aria-expanded={snippetMenuOpen} aria-haspopup="menu" onClick={() => { setSnippetMenuOpen((value) => !value); setSignalMenuOpen(false); setSpanMenuOpen(false); }}><Layers3 size={15} />插入常用片段<ChevronDown size={13} /></button>
            {snippetMenuOpen && <div className="insert-menu snippet-menu" role="menu">
              <button role="menuitem" onClick={() => { addSnippet("clock-reset"); setSnippetMenuOpen(false); }}><Clock3 size={18} /><span><strong>时钟 + 复位</strong><small>CLK 与低有效复位</small></span></button>
              <button role="menuitem" onClick={() => { addSnippet("handshake"); setSnippetMenuOpen(false); }}><MoveRight size={18} /><span><strong>Ready / Valid 握手</strong><small>VALID、READY 与 DATA</small></span></button>
              <button role="menuitem" onClick={() => { addSnippet("spi"); setSnippetMenuOpen(false); }}><Bus size={18} /><span><strong>SPI 读取</strong><small>SCLK、片选与双向数据</small></span></button>
            </div>}
          </div>
          {editorMode === "blocks" && <button disabled={!canInsert} aria-expanded={groupPanelOpen} onClick={() => setGroupPanelOpen((value) => !value)}><Layers3 size={15} />分组操作</button>}
          <i aria-hidden="true" />
          <button disabled={!canInsert} onClick={() => { mutateDiagram((draft) => draft.markers.push({ at: 1, label: "标记" })); }}><Highlighter size={15} />时间标记</button>
          <div className="insert-picker">
            <button disabled={!canInsert} aria-expanded={spanMenuOpen} aria-haspopup="menu" onClick={() => { setSpanMenuOpen((value) => !value); setSignalMenuOpen(false); setSnippetMenuOpen(false); }}><Timer size={15} />插入区间<ChevronDown size={13} /></button>
            {spanMenuOpen && <div className="insert-menu compact-menu" role="menu">
              <button role="menuitem" onClick={() => { addSpan(); setSpanMenuOpen(false); }}>区间箭头</button>
              <button role="menuitem" onClick={() => { addSpan("setup"); setSpanMenuOpen(false); }}>建立时间</button>
              <button role="menuitem" onClick={() => { addSpan("hold"); setSpanMenuOpen(false); }}>保持时间</button>
            </div>}
          </div>
          <button disabled={!canInsert} onClick={() => { addArrow(); }}><MoveRight size={15} />因果箭头</button>
        </nav>
        {editorMode === "blocks" && diagram ? <BlockEditor diagram={diagram} selected={selectedSignal} onSelect={setSelectedSignal} mutate={mutateDiagram} removeSignal={removeSignal} duplicateSignal={duplicateSignal} moveSignal={moveSignal} editError={editError} groupPanelOpen={groupPanelOpen} onCloseGroupPanel={() => setGroupPanelOpen(false)} /> : <>
          <div className="editor-wrap">
            {sourceHelpOpen && <SourceGuide format={format} />}
            <div ref={lineNumbersRef} className="line-numbers" aria-hidden="true">{source.split("\n").map((_, index) => <span className={errorLine === index + 1 ? "line-error" : ""} key={index}>{index + 1}</span>)}</div>
            <textarea ref={editorRef} value={source} onFocus={() => { textEditStartRef.current = { source, format, mode: editorMode }; }} onBlur={() => {
              const start = textEditStartRef.current;
              if (start && (start.source !== source || start.format !== format)) remember(start);
              textEditStartRef.current = null;
            }} onChange={(event) => applySource(event.target.value, format, false)} onScroll={(event) => {
              if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop;
            }} spellCheck={false} aria-label={`${format.toUpperCase()} 时序描述`} />
          </div>
          {!ready ? <footer className="statusbar" role="status" aria-live="polite">正在加载渲染核心</footer>
            : validating ? <footer className="statusbar" role="status" aria-live="polite">正在校验</footer>
              : error ? <button className="statusbar has-error" aria-live="assertive" onClick={jumpToError}><span className="error-dot" />{error}</button>
                : diagram && <footer className="statusbar" role="status" aria-live="polite"><Check size={13} />{format.toUpperCase()} 有效 · 积木与波形已同步</footer>}
        </>}
      </section>

      <section className="preview-pane">
        <div className="pane-heading preview-heading">
          <div><span className="pane-kicker">PAPER OUTPUT</span><h2>实时波形</h2></div>
          <div className="preview-tools">
            <button className="preview-tool" title="缩小" onClick={() => setZoom((value) => Math.max(40, value - 20))}><ZoomOut size={14} /></button>
            <button className="zoom-value" title="恢复 100%" onClick={() => setZoom(100)}>{zoom}%</button>
            <button className="preview-tool" title="放大" onClick={() => setZoom((value) => Math.min(200, value + 20))}><ZoomIn size={14} /></button>
            <button className="preview-tool" title="适应窗口" onClick={() => setZoom(100)}><Maximize2 size={14} /></button>
            <span className="render-mode">Rust · WASM</span>
          </div>
        </div>
        <div className="paper-stage">
          {!ready && <div className="empty-state">正在加载渲染核心</div>}
          {ready && error && !validating && <div className="empty-state error-state">修正左侧描述后，这里会立即更新。</div>}
          {ready && !error && svg && <div className={`paper-sheet ${validating ? "is-validating" : ""}`} style={{ width: `${zoom}%` }} dangerouslySetInnerHTML={{ __html: svg }} />}
          {ready && validating && <div className="validation-state" role="status" aria-live="polite">正在校验</div>}
        </div>
      </section>
    </section>
  </main>;
}

type MutateDiagram = (mutate: (draft: Diagram) => void) => boolean;

function MiniWave({ kind }: { kind: "clock" | "pulse" | "negative-pulse" | "low" | "high" | "bus" }) {
  return <span className={`mini-wave ${kind}`} aria-hidden="true"><i /><i /><i /><i /></span>;
}

function SourceGuide({ format }: { format: SourceFormat }) {
  const docsUrl = format === "dsl"
    ? "https://github.com/zuoliangyu/timing-studio/blob/main/docs/dsl.md"
    : "https://github.com/zuoliangyu/timing-studio/blob/main/docs/user-guide.md";

  return <aside id="source-guide" className="source-guide" role="region" aria-label={`${format.toUpperCase()} 使用说明`}>
    <header><strong>{format === "dsl" ? "DSL 语法速查" : "YAML 结构说明"}</strong><span>修改后会自动校验并更新波形</span></header>
    {format === "dsl" ? <>
      <p>每行一条语句；名称或标签含空格时用双引号；<code>#</code> 开始注释。</p>
      <dl>
        <div><dt>时钟</dt><dd><code>clock CLK cycles 8 period 2</code></dd></div>
        <div><dt>数字</dt><dd><code>signal READY low@0 high@2</code></dd></div>
        <div><dt>总线</dt><dd><code>bus DATA A@0..4 B@4..8</code></dd></div>
        <div><dt>标注</dt><dd><code>span 2..4 "窗口" under signal READY</code></dd></div>
        <div><dt>因果</dt><dd><code>arrow READY@2 -&gt; ACK@4 "响应"</code></dd></div>
      </dl>
    </> : <>
      <p>顶层描述图表；<code>signals</code> 是信号列表，每条信号选择 <code>clock</code>、<code>digital</code> 或 <code>bus</code> 之一。</p>
      <pre>{`title: 示例
unit: ns
signals:
  - name: CLK
    clock: { period: 2, cycles: 4 }
markers: []
spans: []
arrows: []`}</pre>
    </>}
    <a href={docsUrl} target="_blank" rel="noreferrer">查看完整{format === "dsl" ? " DSL 规范" : "用户手册"}</a>
  </aside>;
}

function BlockEditor({ diagram, selected, onSelect, mutate, removeSignal, duplicateSignal, moveSignal, editError, groupPanelOpen, onCloseGroupPanel }: {
  diagram: Diagram;
  selected: string | null;
  onSelect: (name: string) => void;
  mutate: MutateDiagram;
  removeSignal: (name: string) => boolean;
  duplicateSignal: (index: number) => boolean;
  moveSignal: (index: number, direction: number) => boolean;
  editError: string | null;
  groupPanelOpen: boolean;
  onCloseGroupPanel: () => void;
}) {
  const invalidSignal = editError?.match(/第\s*(\d+)\s*个信号/)?.[1];
  const invalidIndex = invalidSignal ? Number(invalidSignal) - 1 : -1;
  const [dragging, setDragging] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [compact, setCompact] = useState(false);
  const [selectedNames, setSelectedNames] = useState<Set<string>>(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [groupDraft, setGroupDraft] = useState("");
  useEffect(() => {
    const names = new Set(diagram.signals.map((signal) => signal.name));
    setSelectedNames((current) => new Set([...current].filter((name) => names.has(name))));
    const groups = new Set(diagram.signals.flatMap((signal) => signal.group ? [signal.group] : []));
    setCollapsedGroups((current) => new Set([...current].filter((name) => groups.has(name))));
  }, [diagram.signals]);
  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const visibleSignals = diagram.signals
    .map((signal, index) => ({ signal, index }))
    .filter(({ signal }) => !normalizedFilter || `${signal.name} ${signal.group ?? ""}`.toLocaleLowerCase().includes(normalizedFilter));
  const dropSignal = (target: number) => {
    if (dragging === null || dragging === target) return;
    mutate((draft) => {
      const [signal] = draft.signals.splice(dragging, 1);
      draft.signals.splice(target, 0, signal);
    });
    setDragging(null);
  };
  const toggleSelected = (name: string, checked: boolean) => setSelectedNames((current) => {
    const next = new Set(current);
    if (checked) next.add(name); else next.delete(name);
    return next;
  });
  const applyGroup = () => {
    const group = groupDraft.trim();
    if (!group || selectedNames.size === 0) return;
    if (mutate((draft) => {
      for (const signal of draft.signals) {
        if (selectedNames.has(signal.name)) signal.group = group;
      }
    })) {
      setSelectedNames(new Set());
      setGroupDraft("");
      onCloseGroupPanel();
    }
  };
  const renameGroup = (previous: string, nextValue: string) => {
    const next = nextValue.trim();
    if (!next) return false;
    if (next === previous) return true;
    const changed = mutate((draft) => {
      for (const signal of draft.signals) if (signal.group === previous) signal.group = next;
      for (const span of draft.spans) {
        if (span.under && "group" in span.under && span.under.group === previous) span.under.group = next;
      }
    });
    if (changed) setCollapsedGroups((current) => {
      const updated = new Set(current);
      if (updated.delete(previous)) updated.add(next);
      return updated;
    });
    return changed;
  };
  const ungroup = (group: string) => mutate((draft) => {
    for (const signal of draft.signals) if (signal.group === group) delete signal.group;
    for (const span of draft.spans) {
      if (span.under && "group" in span.under && span.under.group === group) delete span.under;
    }
  });
  const moveGroup = (group: string, direction: number) => mutate((draft) => {
    const members = draft.signals.filter((signal) => signal.group === group);
    if (members.length === 0) return;
    const memberNames = new Set(members.map((signal) => signal.name));
    const first = draft.signals.findIndex((signal) => memberNames.has(signal.name));
    const last = draft.signals.map((signal) => memberNames.has(signal.name)).lastIndexOf(true);
    const remaining = draft.signals.filter((signal) => !memberNames.has(signal.name));
    if (direction < 0) {
      if (first === 0) return;
      const previous = draft.signals[first - 1];
      let insertAt = remaining.findIndex((signal) => signal.name === previous.name);
      if (previous.group) {
        const firstPrevious = remaining.findIndex((signal) => signal.group === previous.group);
        if (firstPrevious >= 0) insertAt = firstPrevious;
      }
      remaining.splice(Math.max(0, insertAt), 0, ...members);
    } else {
      if (last === draft.signals.length - 1) return;
      const nextSignal = draft.signals[last + 1];
      let insertAfter = remaining.findIndex((signal) => signal.name === nextSignal.name);
      if (nextSignal.group) {
        const groupIndices = remaining.map((signal, index) => signal.group === nextSignal.group ? index : -1).filter((index) => index >= 0);
        insertAfter = groupIndices.at(-1) ?? insertAfter;
      }
      remaining.splice(insertAfter + 1, 0, ...members);
    }
    draft.signals = remaining;
  });
  const toggleGroup = (group: string) => setCollapsedGroups((current) => {
    const next = new Set(current);
    if (next.has(group)) next.delete(group); else next.add(group);
    return next;
  });
  return <div className={`block-editor ${compact ? "is-compact" : ""}`}>
    <section className="diagram-fields">
      <label><span>图表标题</span><EditInput value={diagram.title ?? ""} onCommit={(value) => mutate((draft) => { draft.title = value || undefined; })} /></label>
      <label className="unit-field"><span>时间单位</span><EditInput value={diagram.unit} onCommit={(value) => mutate((draft) => { draft.unit = value; })} /></label>
      <span className="model-state"><Check size={13} />Rust Diagram 已同步</span>
    </section>

    <section className="block-tools" aria-label="信号视图工具">
      <label className="signal-filter"><Search size={14} /><input type="search" aria-label="筛选信号" placeholder="筛选名称或分组" value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
      <button className={compact ? "active" : ""} aria-pressed={compact} onClick={() => setCompact((value) => !value)}><Rows3 size={14} />紧凑视图</button>
      <span>{selectedNames.size > 0 ? `已选 ${selectedNames.size} 条 · ` : ""}显示 {visibleSignals.length} / {diagram.signals.length} 条信号</span>
    </section>

    {groupPanelOpen && <section className="group-panel" aria-label="批量分组">
      <strong>将已选信号加入分组</strong>
      <input aria-label="组名" value={groupDraft} placeholder="输入新组名或已有组名" onChange={(event) => setGroupDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyGroup(); }} />
      <button className="apply-group" disabled={selectedNames.size === 0 || !groupDraft.trim()} onClick={applyGroup}>应用分组</button>
      <button className="icon-control" title="关闭分组操作" onClick={onCloseGroupPanel}>×</button>
    </section>}

    <div className="lane-list">
      {visibleSignals.flatMap(({ signal, index }, visibleIndex) => {
        const previousGroup = visibleSignals[visibleIndex - 1]?.signal.group;
        const showGroup = Boolean(signal.group && signal.group !== previousGroup);
        const collapsed = Boolean(signal.group && collapsedGroups.has(signal.group));
        const groupCount = signal.group ? diagram.signals.filter((item) => item.group === signal.group).length : 0;
        return [
          showGroup && signal.group ? <SignalGroupHeader key={`group-${signal.group}-${index}`} group={signal.group} count={groupCount} collapsed={collapsed} onToggle={() => toggleGroup(signal.group!)} onRename={(next) => renameGroup(signal.group!, next)} onUngroup={() => ungroup(signal.group!)} onMove={(direction) => moveGroup(signal.group!, direction)} canMoveUp={index > 0} canMoveDown={diagram.signals.map((item) => item.group === signal.group).lastIndexOf(true) < diagram.signals.length - 1} /> : null,
          collapsed ? null : <SignalLane
            key={signal.name}
            signal={signal}
            index={index}
            active={selected === signal.name}
            checked={selectedNames.has(signal.name)}
            onCheck={(checked) => toggleSelected(signal.name, checked)}
            onSelect={() => onSelect(signal.name)}
            mutate={mutate}
            onRemove={() => removeSignal(signal.name)}
            onDuplicate={() => duplicateSignal(index)}
            onMove={(direction) => moveSignal(index, direction)}
            canMoveUp={index > 0}
            canMoveDown={index < diagram.signals.length - 1}
            validationError={invalidIndex === index ? editError : null}
            dragging={dragging === index}
            onDragStart={() => setDragging(index)}
            onDragEnd={() => setDragging(null)}
            onDrop={() => dropSignal(index)}
          />,
        ];
      })}
    </div>

    <AnnotationEditor diagram={diagram} mutate={mutate} />
    {editError && <div className="block-error" role="alert"><span className="error-dot" />{editError}</div>}
  </div>;
}

function SignalGroupHeader({ group, count, collapsed, onToggle, onRename, onUngroup, onMove, canMoveUp, canMoveDown }: {
  group: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onRename: (value: string) => boolean;
  onUngroup: () => boolean;
  onMove: (direction: number) => boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  return <section className="signal-group-header" role="group" aria-label={`信号组 ${group}`}>
    <button className="group-collapse" title={collapsed ? "展开组" : "折叠组"} onClick={onToggle}><ChevronDown className={collapsed ? "collapsed" : ""} size={15} /></button>
    <EditInput ariaLabel={`组名 ${group}`} value={group} onCommit={onRename} />
    <small>{count} 条信号</small>
    <div className="group-actions">
      <button title="整组上移" disabled={!canMoveUp} onClick={() => onMove(-1)}><ArrowUp size={13} /></button>
      <button title="整组下移" disabled={!canMoveDown} onClick={() => onMove(1)}><ArrowDown size={13} /></button>
      <button title="取消分组" onClick={onUngroup}><Layers3 size={13} /></button>
    </div>
  </section>;
}

function SignalLane({ signal, index, active, checked, onCheck, onSelect, mutate, onRemove, onDuplicate, onMove, canMoveUp, canMoveDown, validationError, dragging, onDragStart, onDragEnd, onDrop }: {
  signal: Signal;
  index: number;
  active: boolean;
  checked: boolean;
  onCheck: (checked: boolean) => void;
  onSelect: () => void;
  mutate: MutateDiagram;
  onRemove: () => boolean;
  onDuplicate: () => boolean;
  onMove: (direction: number) => boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  validationError: string | null;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const kind = signal.clock ? "clock" : signal.bus ? "bus" : "digital";
  const Icon = signal.clock ? Clock3 : signal.bus ? Bus : Radio;
  const update = (change: (draft: Signal) => void) => mutate((draft) => {
    const current = draft.signals[index];
    const previousName = current.name;
    const previousGroup = current.group;
    change(current);
    if (current.name !== previousName) {
      for (const arrow of draft.arrows) {
        if (arrow.from.signal === previousName) arrow.from.signal = current.name;
        if (arrow.to.signal === previousName) arrow.to.signal = current.name;
      }
      for (const span of draft.spans) {
        if (span.under && "signal" in span.under && span.under.signal === previousName) span.under.signal = current.name;
      }
    }
    if (previousGroup && previousGroup !== current.group
      && !draft.signals.some((item) => item.group === previousGroup)) {
      for (const span of draft.spans) {
        if (span.under && "group" in span.under && span.under.group === previousGroup) delete span.under;
      }
    }
  });
  const changeKind = (next: string) => update((draft) => {
    delete draft.clock;
    delete draft.digital;
    delete draft.bus;
    if (next === "clock") draft.clock = { period: 2, cycles: 4, start: 0 };
    if (next === "digital") draft.digital = { points: [{ at: 0, value: "low" }, { at: 1, value: "high" }] };
    if (next === "bus") draft.bus = { segments: [{ from: 0, to: 4, value: "VALUE" }] };
  });

  const errorArea = validationError?.includes("名称") ? "identity"
    : validationError?.includes("时钟") ? "values"
      : validationError?.includes("时间") || validationError?.includes("总线") ? "values" : null;
  return <article aria-label={`信号 ${signal.name}`} aria-current={active ? "true" : undefined} className={`signal-lane ${active ? "active" : ""} ${validationError ? "invalid" : ""} ${dragging ? "dragging" : ""}`} onClick={onSelect} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop(); }}>
    <div className={`lane-kind ${kind}`} draggable title="拖动排序" onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; onDragStart(); }} onDragEnd={onDragEnd}>
      <input type="checkbox" aria-label={`选择信号 ${signal.name}`} checked={checked} onClick={(event) => event.stopPropagation()} onChange={(event) => onCheck(event.target.checked)} />
      <Icon size={17} /><span>{index + 1}</span>
    </div>
    <div className={`lane-identity ${errorArea === "identity" ? "field-invalid" : ""}`}>
      <label><span>名称</span><EditInput value={signal.name} onCommit={(value) => update((draft) => { draft.name = value; })} /></label>
      <label><span>分组</span><EditInput value={signal.group ?? ""} placeholder="无分组" onCommit={(value) => update((draft) => { draft.group = value || undefined; })} /></label>
      <label><span>类型</span><select value={kind} onChange={(event) => changeKind(event.target.value)}><option value="clock">时钟</option><option value="digital">数字信号</option><option value="bus">总线</option></select></label>
    </div>
    <div className={`lane-values ${errorArea === "values" ? "field-invalid" : ""}`}>
      {signal.clock && <ClockFields signal={signal} update={update} />}
      {signal.digital && <DigitalFields signal={signal} update={update} />}
      {signal.bus && <BusFields signal={signal} update={update} />}
      {validationError && <small className="lane-error">{validationError.replace(/^.*?：/, "")}</small>}
    </div>
    <div className="lane-actions">
      <button title="上移" disabled={!canMoveUp} onClick={(event) => { event.stopPropagation(); onMove(-1); }}><ArrowUp size={14} /></button>
      <button title="下移" disabled={!canMoveDown} onClick={(event) => { event.stopPropagation(); onMove(1); }}><ArrowDown size={14} /></button>
      <button title="复制" onClick={(event) => { event.stopPropagation(); onDuplicate(); }}><Copy size={14} /></button>
      <button title="删除" onClick={(event) => { event.stopPropagation(); onRemove(); }}><Trash2 size={14} /></button>
    </div>
  </article>;
}

function ClockFields({ signal, update }: { signal: Signal; update: (change: (draft: Signal) => void) => boolean }) {
  const clock = signal.clock!;
  return <div className="parameter-row">
    <NumberField label="周期" value={clock.period} onCommit={(value) => update((draft) => { draft.clock!.period = value; })} />
    <NumberField label="循环" value={clock.cycles} integer onCommit={(value) => update((draft) => { draft.clock!.cycles = value; })} />
    <NumberField label="开始" value={clock.start} onCommit={(value) => update((draft) => { draft.clock!.start = value; })} />
  </div>;
}

function DigitalFields({ signal, update }: { signal: Signal; update: (change: (draft: Signal) => void) => boolean }) {
  const points = signal.digital!.points;
  const [dragging, setDragging] = useState<number | null>(null);
  const moveValue = (from: number, to: number) => {
    if (to < 0 || to >= points.length || from === to) return;
    update((draft) => {
      const values = draft.digital!.points;
      [values[from].value, values[to].value] = [values[to].value, values[from].value];
    });
  };
  return <div className="piece-row">
    {points.map((point, pointIndex) => <div className={`value-piece digital-piece ${dragging === pointIndex ? "dragging" : ""}`} key={pointIndex} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (dragging !== null) moveValue(dragging, pointIndex); setDragging(null); }}>
      <span className="piece-grip" role="button" tabIndex={0} draggable aria-label={`拖动第 ${pointIndex + 1} 个状态排序`} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; setDragging(pointIndex); }} onDragEnd={() => setDragging(null)} onKeyDown={(event) => {
        if (event.key === "ArrowLeft") moveValue(pointIndex, pointIndex - 1);
        if (event.key === "ArrowRight") moveValue(pointIndex, pointIndex + 1);
      }}><GripVertical size={12} /></span>
      <select aria-label={`第 ${pointIndex + 1} 个逻辑值`} value={point.value} onChange={(event) => update((draft) => { draft.digital!.points[pointIndex].value = event.target.value; })}><option value="low">LOW</option><option value="high">HIGH</option><option value="x">X</option><option value="z">Z</option></select>
      <span>@</span>
      <EditInput compact numeric value={String(point.at)} onCommit={(value) => update((draft) => { draft.digital!.points[pointIndex].at = Number(value); })} />
      <button title="状态左移" disabled={pointIndex === 0} onClick={() => moveValue(pointIndex, pointIndex - 1)}><ArrowLeft size={12} /></button>
      <button title="状态右移" disabled={pointIndex === points.length - 1} onClick={() => moveValue(pointIndex, pointIndex + 1)}><ArrowRight size={12} /></button>
      <button title="删除状态点" disabled={points.length <= 1} onClick={() => update((draft) => { draft.digital!.points.splice(pointIndex, 1); })}><Trash2 size={12} /></button>
    </div>)}
    <button className="add-piece" onClick={() => update((draft) => {
      const current = draft.digital!.points;
      current.push({ at: (current.at(-1)?.at ?? -1) + 1, value: "low" });
    })}><Plus size={13} />状态点</button>
  </div>;
}

function BusFields({ signal, update }: { signal: Signal; update: (change: (draft: Signal) => void) => boolean }) {
  const segments = signal.bus!.segments;
  const [dragging, setDragging] = useState<number | null>(null);
  const moveValue = (from: number, to: number) => {
    if (to < 0 || to >= segments.length || from === to) return;
    update((draft) => {
      const values = draft.bus!.segments;
      [values[from].value, values[to].value] = [values[to].value, values[from].value];
    });
  };
  return <div className="piece-row">
    {segments.map((segment, segmentIndex) => <div className={`value-piece bus-piece ${dragging === segmentIndex ? "dragging" : ""}`} key={segmentIndex} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (dragging !== null) moveValue(dragging, segmentIndex); setDragging(null); }}>
      <span className="piece-grip" role="button" tabIndex={0} draggable aria-label={`拖动第 ${segmentIndex + 1} 个数据段排序`} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; setDragging(segmentIndex); }} onDragEnd={() => setDragging(null)} onKeyDown={(event) => {
        if (event.key === "ArrowLeft") moveValue(segmentIndex, segmentIndex - 1);
        if (event.key === "ArrowRight") moveValue(segmentIndex, segmentIndex + 1);
      }}><GripVertical size={12} /></span>
      <EditInput compact value={segment.value} onCommit={(value) => update((draft) => { draft.bus!.segments[segmentIndex].value = value; })} />
      <EditInput compact numeric value={String(segment.from)} onCommit={(value) => update((draft) => { draft.bus!.segments[segmentIndex].from = Number(value); })} />
      <span>..</span>
      <EditInput compact numeric value={String(segment.to)} onCommit={(value) => update((draft) => { draft.bus!.segments[segmentIndex].to = Number(value); })} />
      <button title="数据左移" disabled={segmentIndex === 0} onClick={() => moveValue(segmentIndex, segmentIndex - 1)}><ArrowLeft size={12} /></button>
      <button title="数据右移" disabled={segmentIndex === segments.length - 1} onClick={() => moveValue(segmentIndex, segmentIndex + 1)}><ArrowRight size={12} /></button>
      <button title="删除总线片段" disabled={segments.length <= 1} onClick={() => update((draft) => { draft.bus!.segments.splice(segmentIndex, 1); })}><Trash2 size={12} /></button>
    </div>)}
    <button className="add-piece" onClick={() => update((draft) => {
      const current = draft.bus!.segments;
      const from = current.at(-1)?.to ?? 0;
      current.push({ from, to: from + 4, value: "VALUE" });
    })}><Plus size={13} />数据段</button>
  </div>;
}

function AnnotationEditor({ diagram, mutate }: { diagram: Diagram; mutate: MutateDiagram }) {
  const groups = [...new Set(diagram.signals.flatMap((signal) => signal.group ? [signal.group] : []))];
  const moveMarker = (index: number, direction: number) => mutate((draft) => {
    const target = index + direction;
    if (target < 0 || target >= draft.markers.length) return;
    [draft.markers[index], draft.markers[target]] = [draft.markers[target], draft.markers[index]];
  });
  const moveSpan = (index: number, direction: number) => mutate((draft) => {
    const target = index + direction;
    if (target < 0 || target >= draft.spans.length) return;
    [draft.spans[index], draft.spans[target]] = [draft.spans[target], draft.spans[index]];
  });
  const sortByTime = () => mutate((draft) => {
    draft.markers.sort((left, right) => left.at - right.at);
    draft.spans.sort((left, right) => left.from - right.from || left.to - right.to);
    draft.arrows.sort((left, right) => Math.min(left.from.at, left.to.at) - Math.min(right.from.at, right.to.at));
  });
  return <section className="annotation-editor">
    <header><span><Highlighter size={14} />论文标注</span><div className="annotation-summary"><small>{diagram.markers.length + diagram.spans.length + diagram.arrows.length} 项</small><button title="按时间排序标注" onClick={sortByTime}><ArrowDownUp size={13} /></button></div></header>
    <div className="annotation-list">
      {diagram.markers.map((marker, index) => <div className="annotation-row" aria-label={`时间标记 ${marker.label ?? "标记"}`} key={`marker-${index}`}>
        <strong>时间标记</strong>
        <EditInput value={marker.label ?? ""} placeholder="标签" onCommit={(value) => mutate((draft) => { draft.markers[index].label = value || undefined; })} />
        <NumberField label="时间" value={marker.at} onCommit={(value) => mutate((draft) => { draft.markers[index].at = value; })} />
        <div className="annotation-actions">
          <button title="上移标记" disabled={index === 0} onClick={() => moveMarker(index, -1)}><ArrowUp size={13} /></button>
          <button title="下移标记" disabled={index === diagram.markers.length - 1} onClick={() => moveMarker(index, 1)}><ArrowDown size={13} /></button>
          <button title="复制标记" onClick={() => mutate((draft) => { const copy = structuredClone(draft.markers[index]); copy.label = `${copy.label ?? "标记"} 副本`; draft.markers.splice(index + 1, 0, copy); })}><Copy size={13} /></button>
          <button title="删除时间标记" onClick={() => mutate((draft) => { draft.markers.splice(index, 1); })}><Trash2 size={13} /></button>
        </div>
      </div>)}
      {diagram.spans.map((span, index) => <div className="annotation-row span-row" aria-label={`区间 ${span.label}`} key={`span-${index}`}>
        <select aria-label="区间类型" value={span.kind ?? "interval"} onChange={(event) => mutate((draft) => {
          const kind = event.target.value as "interval" | "setup" | "hold";
          draft.spans[index].kind = kind === "interval" ? undefined : kind;
        })}><option value="interval">区间箭头</option><option value="setup">建立时间</option><option value="hold">保持时间</option></select>
        <EditInput value={span.label} placeholder="标签" onCommit={(value) => mutate((draft) => { draft.spans[index].label = value; })} />
        <NumberField label="开始" value={span.from} onCommit={(value) => mutate((draft) => { draft.spans[index].from = value; })} />
        <NumberField label="结束" value={span.to} onCommit={(value) => mutate((draft) => { draft.spans[index].to = value; })} />
        <label className="placement-field"><span>位置</span><select aria-label="标注位置" value={span.under ? "signal" in span.under ? `signal:${span.under.signal}` : `group:${span.under.group}` : "diagram"} onChange={(event) => mutate((draft) => {
          const separator = event.target.value.indexOf(":");
          const kind = separator < 0 ? event.target.value : event.target.value.slice(0, separator);
          const name = separator < 0 ? "" : event.target.value.slice(separator + 1);
          if (kind === "signal") draft.spans[index].under = { signal: name };
          else if (kind === "group") draft.spans[index].under = { group: name };
          else delete draft.spans[index].under;
        })}>
          <option value="diagram">整张图底部</option>
          <optgroup label="信号下方">{diagram.signals.map((signal) => <option value={`signal:${signal.name}`} key={`signal:${signal.name}`}>{signal.name}</option>)}</optgroup>
          {groups.length > 0 && <optgroup label="分组下方">{groups.map((group) => <option value={`group:${group}`} key={`group:${group}`}>{group}</option>)}</optgroup>}
        </select></label>
        <div className="annotation-actions">
          <button title="上移区间" disabled={index === 0} onClick={() => moveSpan(index, -1)}><ArrowUp size={13} /></button>
          <button title="下移区间" disabled={index === diagram.spans.length - 1} onClick={() => moveSpan(index, 1)}><ArrowDown size={13} /></button>
          <button title="复制区间" onClick={() => mutate((draft) => { const copy = structuredClone(draft.spans[index]); copy.label = `${copy.label} 副本`; draft.spans.splice(index + 1, 0, copy); })}><Copy size={13} /></button>
          <button title="删除区间" onClick={() => mutate((draft) => { draft.spans.splice(index, 1); })}><Trash2 size={13} /></button>
        </div>
      </div>)}
      {diagram.arrows.map((arrow, index) => <div className="annotation-row arrow-row" role="group" aria-label={`因果箭头 ${arrow.from.signal} 到 ${arrow.to.signal}`} key={`arrow-${index}`}>
        <strong>因果箭头</strong>
        <EditInput value={arrow.label ?? ""} placeholder="标签" onCommit={(value) => mutate((draft) => { draft.arrows[index].label = value || undefined; })} />
        <label><span>源信号</span><select aria-label="源信号" value={arrow.from.signal} onChange={(event) => mutate((draft) => { draft.arrows[index].from.signal = event.target.value; })}>{diagram.signals.map((signal) => <option key={signal.name}>{signal.name}</option>)}</select></label>
        <NumberField label="源时间" value={arrow.from.at} onCommit={(value) => mutate((draft) => { draft.arrows[index].from.at = value; })} />
        <label><span>目标信号</span><select aria-label="目标信号" value={arrow.to.signal} onChange={(event) => mutate((draft) => { draft.arrows[index].to.signal = event.target.value; })}>{diagram.signals.map((signal) => <option key={signal.name}>{signal.name}</option>)}</select></label>
        <NumberField label="目标时间" value={arrow.to.at} onCommit={(value) => mutate((draft) => { draft.arrows[index].to.at = value; })} />
        <div className="annotation-actions">
          <button title="上移箭头" disabled={index === 0} onClick={() => mutate((draft) => { [draft.arrows[index - 1], draft.arrows[index]] = [draft.arrows[index], draft.arrows[index - 1]]; })}><ArrowUp size={13} /></button>
          <button title="下移箭头" disabled={index === diagram.arrows.length - 1} onClick={() => mutate((draft) => { [draft.arrows[index], draft.arrows[index + 1]] = [draft.arrows[index + 1], draft.arrows[index]]; })}><ArrowDown size={13} /></button>
          <button title="复制箭头" onClick={() => mutate((draft) => { const copy = structuredClone(draft.arrows[index]); copy.label = `${copy.label ?? "因果关系"} 副本`; draft.arrows.splice(index + 1, 0, copy); })}><Copy size={13} /></button>
          <button title="删除箭头" onClick={() => mutate((draft) => { draft.arrows.splice(index, 1); })}><Trash2 size={13} /></button>
        </div>
      </div>)}
    </div>
  </section>;
}

function NumberField({ label, value, integer = false, onCommit }: { label: string; value: number; integer?: boolean; onCommit: (value: number) => boolean }) {
  return <label className="number-field"><span>{label}</span><EditInput numeric compact value={String(value)} onCommit={(next) => {
    const parsed = integer ? Number.parseInt(next, 10) : Number(next);
    return Number.isFinite(parsed) && onCommit(parsed);
  }} /></label>;
}

function EditInput({ value, placeholder, ariaLabel, compact = false, numeric = false, onCommit }: { value: string; placeholder?: string; ariaLabel?: string; compact?: boolean; numeric?: boolean; onCommit: (value: string) => boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <input aria-label={ariaLabel} className={compact ? "compact-input" : ""} type={numeric ? "number" : "text"} step="any" value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} onBlur={() => {
    if (draft === value) return;
    if (!onCommit(draft)) setDraft(value);
  }} onKeyDown={(event) => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") { setDraft(value); event.currentTarget.blur(); }
  }} />;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function renderSvgToCanvas(svg: string, scale: number) {
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.src = svgUrl;
    await image.decode();
    const viewBox = svg.match(/viewBox="[\d.\-]+ [\d.\-]+ ([\d.]+) ([\d.]+)"/);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(Number(viewBox?.[1] ?? image.naturalWidth) * scale);
    canvas.height = Math.round(Number(viewBox?.[2] ?? image.naturalHeight) * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器不支持 Canvas 导出");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export default App;
