import {
  Blocks, Bus, Check, ChevronDown, Clock3, Download, FileUp, Highlighter,
  ImageDown, Maximize2, Plus, Radio, RotateCcw, Trash2, Zap, ZoomIn, ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import initWasm, { convert, inspect, render } from "./wasm/timing_wasm";
import { examples } from "./examples";

type SourceFormat = "dsl" | "yaml";
type Signal = {
  name: string;
  group?: string;
  clock?: { period: number; cycles: number; start: number };
  digital?: { points: { at: number; value: string }[] };
  bus?: { segments: { from: number; to: number; value: string }[] };
};
type Diagram = {
  title?: string;
  unit: string;
  signals: Signal[];
  markers: { at: number; label?: string }[];
  spans: { from: number; to: number; label: string }[];
};

const defaultSource = examples["固定闸门计数"];
const initialSource = localStorage.getItem("timing-source") ?? defaultSource;
const detectFormat = (source: string): SourceFormat => source.trimStart().startsWith("timing") ? "dsl" : "yaml";

function App() {
  const [source, setSource] = useState(initialSource);
  const [format, setFormat] = useState<SourceFormat>(() => detectFormat(initialSource));
  const [svg, setSvg] = useState("");
  const [diagram, setDiagram] = useState<Diagram | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(true);
  const [ready, setReady] = useState(false);
  const [exampleOpen, setExampleOpen] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [exportingPng, setExportingPng] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

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

  const applySource = (nextSource: string, nextFormat = format) => {
    setError(null);
    setValidating(true);
    setSource(nextSource);
    setFormat(nextFormat);
  };

  const changeFormat = (nextFormat: SourceFormat) => {
    if (!ready || nextFormat === format) return;
    try {
      applySource(convert(source, nextFormat), nextFormat);
    } catch (reason) {
      setError(String(reason));
    }
  };

  const mutateDiagram = (mutate: (draft: Diagram) => void) => {
    if (!diagram) return;
    const draft = structuredClone(diagram);
    mutate(draft);
    try {
      applySource(convert(JSON.stringify(draft), format));
    } catch (reason) {
      setError(String(reason));
    }
  };

  const uniqueName = (base: string) => {
    const names = new Set(diagram?.signals.map((signal) => signal.name));
    if (!names.has(base)) return base;
    let suffix = 2;
    while (names.has(`${base}_${suffix}`)) suffix += 1;
    return `${base}_${suffix}`;
  };

  const addSignal = (kind: "clock" | "digital" | "bus") => mutateDiagram((draft) => {
    const name = uniqueName(kind === "clock" ? "CLK" : kind === "bus" ? "DATA" : "SIGNAL");
    const signal: Signal = kind === "clock"
      ? { name, clock: { period: 2, cycles: 4, start: 0 } }
      : kind === "bus"
        ? { name, bus: { segments: [{ from: 0, to: 4, value: "VALUE" }] } }
        : { name, digital: { points: [{ at: 0, value: "low" }, { at: 1, value: "high" }] } };
    draft.signals.push(signal);
    setSelectedSignal(name);
  });

  const addSpan = () => mutateDiagram((draft) => draft.spans.push({ from: 1, to: 4, label: "时间区间" }));
  const removeSignal = (name: string) => mutateDiagram((draft) => {
    draft.signals = draft.signals.filter((signal) => signal.name !== name);
    setSelectedSignal(null);
  });

  const downloadSvg = useCallback(() => {
    if (svg) downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), "timing-diagram.svg");
  }, [svg]);

  const downloadPng = useCallback(async () => {
    if (!svg || exportingPng) return;
    setExportingPng(true);
    const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const image = new Image();
      image.src = svgUrl;
      await image.decode();
      const viewBox = svg.match(/viewBox="[\d.\-]+ [\d.\-]+ ([\d.]+) ([\d.]+)"/);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(Number(viewBox?.[1] ?? image.naturalWidth) * 2);
      canvas.height = Math.round(Number(viewBox?.[2] ?? image.naturalHeight) * 2);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("当前浏览器不支持 Canvas 导出");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error("PNG 编码失败")), "image/png",
      ));
      downloadBlob(blob, "timing-diagram@2x.png");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      URL.revokeObjectURL(svgUrl);
      setExportingPng(false);
    }
  }, [svg, exportingPng]);

  const jumpToError = () => {
    if (!errorLine || !editorRef.current) return;
    const lines = source.split("\n");
    const start = lines.slice(0, errorLine - 1).reduce((length, line) => length + line.length + 1, 0);
    editorRef.current.focus();
    editorRef.current.setSelectionRange(start, start + (lines[errorLine - 1]?.length ?? 0));
    editorRef.current.scrollTop = Math.max(0, (errorLine - 3) * 21);
  };

  const loadExample = (value: string) => {
    applySource(value, detectFormat(value));
    setExampleOpen(false);
  };

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Zap size={17} /></span><div><strong>Timing Studio</strong><small>论文级数字时序绘图</small></div></div>
      <div className="topbar-actions">
        <div className="example-picker">
          <button className="text-control" onClick={() => setExampleOpen(!exampleOpen)}>示例 <ChevronDown size={14} /></button>
          {exampleOpen && <div className="example-menu">{Object.entries(examples).map(([name, value]) => <button key={name} onClick={() => loadExample(value)}>{name}</button>)}</div>}
        </div>
        <button className="icon-control" title="导入 DSL 或 YAML" onClick={() => fileRef.current?.click()}><FileUp size={17} /></button>
        <input ref={fileRef} hidden type="file" accept=".timing,.txt,.yaml,.yml,text/plain,text/yaml" onChange={async (event) => {
          const file = event.target.files?.[0];
          if (file) loadExample(await file.text());
        }} />
        <button className="icon-control" title="导出 2 倍 PNG" disabled={!svg || Boolean(error) || validating} onClick={downloadPng}><ImageDown size={17} /></button>
        <button className="primary-control" disabled={!svg || Boolean(error) || validating} onClick={downloadSvg}><Download size={16} />导出 SVG</button>
      </div>
    </header>

    <nav className="command-shelf" aria-label="快捷积木栏">
      <span><Blocks size={14} />插入积木</span>
      <button onClick={() => addSignal("clock")}><Clock3 size={15} />时钟</button>
      <button onClick={() => addSignal("digital")}><Radio size={15} />数字信号</button>
      <button onClick={() => addSignal("bus")}><Bus size={15} />总线</button>
      <button onClick={addSpan}><Highlighter size={15} />区间标注</button>
    </nav>

    <section className="workspace">
      <section className="editor-pane">
        <div className="pane-heading">
          <div><span className="pane-kicker">SOURCE</span><h1>时序描述</h1></div>
          <div className="source-actions">
            <div className="format-switch" aria-label="编辑格式">
              <button className={format === "dsl" ? "active" : ""} onClick={() => changeFormat("dsl")}>DSL</button>
              <button className={format === "yaml" ? "active" : ""} onClick={() => changeFormat("yaml")}>YAML</button>
            </div>
            <button className="icon-control subtle" title="恢复闸门示例" onClick={() => loadExample(defaultSource)}><RotateCcw size={15} /></button>
          </div>
        </div>
        <div className="editor-wrap">
          <div ref={lineNumbersRef} className="line-numbers" aria-hidden="true">{source.split("\n").map((_, index) => <span className={errorLine === index + 1 ? "line-error" : ""} key={index}>{index + 1}</span>)}</div>
          <textarea ref={editorRef} value={source} onChange={(event) => applySource(event.target.value)} onScroll={(event) => {
            if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop;
          }} spellCheck={false} aria-label={`${format.toUpperCase()} 时序描述`} />
        </div>
        {error ? <button className="statusbar has-error" onClick={jumpToError}><span className="error-dot" />{error}</button> : <footer className="statusbar"><Check size={13} />{format.toUpperCase()} 有效 · 积木与波形已同步</footer>}
        <div className="block-rack-heading"><span><Blocks size={14} />当前信号</span><small>{diagram?.signals.length ?? 0} 条</small></div>
        <div className="block-rack">
          {diagram?.signals.map((signal) => <SignalBlock key={signal.name} signal={signal} selected={selectedSignal === signal.name} onSelect={() => setSelectedSignal(signal.name)} onRemove={() => removeSignal(signal.name)} />)}
          <button className="rack-add" title="添加数字信号" onClick={() => addSignal("digital")}><Plus size={17} /></button>
        </div>
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
          {ready && validating && <div className="validation-state">正在校验</div>}
        </div>
      </section>
    </section>
  </main>;
}

function SignalBlock({ signal, selected, onSelect, onRemove }: { signal: Signal; selected: boolean; onSelect: () => void; onRemove: () => void }) {
  const kind = signal.clock ? "时钟" : signal.bus ? "总线" : "数字";
  const Icon = signal.clock ? Clock3 : signal.bus ? Bus : Radio;
  const summary = signal.clock ? `${signal.clock.cycles} 周期` : signal.bus ? `${signal.bus.segments.length} 段数据` : `${signal.digital?.points.length ?? 0} 次变化`;
  return <article className={`signal-chip ${selected ? "active" : ""}`} onClick={onSelect}>
    <span className="chip-icon"><Icon size={15} /></span>
    <span><strong>{signal.name}</strong><small>{kind} · {summary}</small></span>
    <button title={`删除 ${signal.name}`} onClick={(event) => { event.stopPropagation(); onRemove(); }}><Trash2 size={14} /></button>
  </article>;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default App;
