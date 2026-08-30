import {
  ArrowDown, ArrowUp, Blocks, Bus, Check, ChevronDown, Clock3, Copy, Download,
  FileUp, Highlighter, ImageDown, Maximize2, Plus, Radio, RotateCcw, Trash2,
  Zap, ZoomIn, ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import initWasm, { convert, inspect, render } from "./wasm/timing_wasm";
import { examples } from "./examples";

type SourceFormat = "dsl" | "yaml";
type EditorMode = "blocks" | SourceFormat;
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
  const [editorMode, setEditorMode] = useState<EditorMode>(() => detectFormat(initialSource));
  const [svg, setSvg] = useState("");
  const [diagram, setDiagram] = useState<Diagram | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
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
    if (!ready) return;
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

  const duplicateSignal = (index: number) => mutateDiagram((draft) => {
    const copy = structuredClone(draft.signals[index]);
    copy.name = uniqueName(`${copy.name}_副本`);
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
    const nextFormat = detectFormat(value);
    applySource(value, nextFormat);
    setEditorMode(nextFormat);
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

    <nav className={`command-shelf ${editorMode === "blocks" ? "is-active" : ""}`} aria-label="快捷积木栏">
      <span><Blocks size={14} />插入积木</span>
      <button onClick={() => { setEditorMode("blocks"); addSignal("clock"); }}><Clock3 size={15} />时钟</button>
      <button onClick={() => { setEditorMode("blocks"); addSignal("digital"); }}><Radio size={15} />数字信号</button>
      <button onClick={() => { setEditorMode("blocks"); addSignal("bus"); }}><Bus size={15} />总线</button>
      <button onClick={() => { setEditorMode("blocks"); mutateDiagram((draft) => draft.markers.push({ at: 1, label: "标记" })); }}><Highlighter size={15} />时间标记</button>
      <button onClick={() => { setEditorMode("blocks"); addSpan(); }}><Highlighter size={15} />区间标注</button>
    </nav>

    <section className="workspace">
      <section className={`editor-pane mode-${editorMode}`}>
        <div className="pane-heading">
          <div><span className="pane-kicker">EDITOR</span><h1>{editorMode === "blocks" ? "积木编辑" : "时序描述"}</h1></div>
          <div className="source-actions">
            <div className="format-switch" aria-label="编辑格式">
              <button className={editorMode === "blocks" ? "active" : ""} onClick={() => setEditorMode("blocks")}><Blocks size={12} />积木</button>
              <button className={editorMode === "dsl" ? "active" : ""} onClick={() => changeFormat("dsl")}>DSL</button>
              <button className={editorMode === "yaml" ? "active" : ""} onClick={() => changeFormat("yaml")}>YAML</button>
            </div>
            <button className="icon-control subtle" title="恢复闸门示例" onClick={() => loadExample(defaultSource)}><RotateCcw size={15} /></button>
          </div>
        </div>
        {editorMode === "blocks" && diagram ? <BlockEditor diagram={diagram} selected={selectedSignal} onSelect={setSelectedSignal} mutate={mutateDiagram} removeSignal={removeSignal} duplicateSignal={duplicateSignal} moveSignal={moveSignal} editError={editError} /> : <>
          <div className="editor-wrap">
            <div ref={lineNumbersRef} className="line-numbers" aria-hidden="true">{source.split("\n").map((_, index) => <span className={errorLine === index + 1 ? "line-error" : ""} key={index}>{index + 1}</span>)}</div>
            <textarea ref={editorRef} value={source} onChange={(event) => applySource(event.target.value)} onScroll={(event) => {
              if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop;
            }} spellCheck={false} aria-label={`${format.toUpperCase()} 时序描述`} />
          </div>
          {error ? <button className="statusbar has-error" onClick={jumpToError}><span className="error-dot" />{error}</button> : <footer className="statusbar"><Check size={13} />{format.toUpperCase()} 有效 · 积木与波形已同步</footer>}
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
          {ready && validating && <div className="validation-state">正在校验</div>}
        </div>
      </section>
    </section>
  </main>;
}

type MutateDiagram = (mutate: (draft: Diagram) => void) => boolean;

function BlockEditor({ diagram, selected, onSelect, mutate, removeSignal, duplicateSignal, moveSignal, editError }: {
  diagram: Diagram;
  selected: string | null;
  onSelect: (name: string) => void;
  mutate: MutateDiagram;
  removeSignal: (name: string) => boolean;
  duplicateSignal: (index: number) => boolean;
  moveSignal: (index: number, direction: number) => boolean;
  editError: string | null;
}) {
  return <div className="block-editor">
    <section className="diagram-fields">
      <label><span>图表标题</span><EditInput value={diagram.title ?? ""} onCommit={(value) => mutate((draft) => { draft.title = value || undefined; })} /></label>
      <label className="unit-field"><span>时间单位</span><EditInput value={diagram.unit} onCommit={(value) => mutate((draft) => { draft.unit = value; })} /></label>
      <span className="model-state"><Check size={13} />Rust Diagram 已同步</span>
    </section>

    <div className="lane-list">
      {diagram.signals.map((signal, index) => <SignalLane
        key={`${index}-${signal.name}`}
        signal={signal}
        index={index}
        active={selected === signal.name}
        onSelect={() => onSelect(signal.name)}
        mutate={mutate}
        onRemove={() => removeSignal(signal.name)}
        onDuplicate={() => duplicateSignal(index)}
        onMove={(direction) => moveSignal(index, direction)}
        canMoveUp={index > 0}
        canMoveDown={index < diagram.signals.length - 1}
      />)}
    </div>

    <AnnotationEditor diagram={diagram} mutate={mutate} />
    {editError && <div className="block-error"><span className="error-dot" />{editError}</div>}
  </div>;
}

function SignalLane({ signal, index, active, onSelect, mutate, onRemove, onDuplicate, onMove, canMoveUp, canMoveDown }: {
  signal: Signal;
  index: number;
  active: boolean;
  onSelect: () => void;
  mutate: MutateDiagram;
  onRemove: () => boolean;
  onDuplicate: () => boolean;
  onMove: (direction: number) => boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const kind = signal.clock ? "clock" : signal.bus ? "bus" : "digital";
  const Icon = signal.clock ? Clock3 : signal.bus ? Bus : Radio;
  const update = (change: (draft: Signal) => void) => mutate((draft) => change(draft.signals[index]));
  const changeKind = (next: string) => update((draft) => {
    delete draft.clock;
    delete draft.digital;
    delete draft.bus;
    if (next === "clock") draft.clock = { period: 2, cycles: 4, start: 0 };
    if (next === "digital") draft.digital = { points: [{ at: 0, value: "low" }, { at: 1, value: "high" }] };
    if (next === "bus") draft.bus = { segments: [{ from: 0, to: 4, value: "VALUE" }] };
  });

  return <article className={`signal-lane ${active ? "active" : ""}`} onClick={onSelect}>
    <div className={`lane-kind ${kind}`}><Icon size={17} /><span>{index + 1}</span></div>
    <div className="lane-identity">
      <label><span>名称</span><EditInput value={signal.name} onCommit={(value) => update((draft) => { draft.name = value; })} /></label>
      <label><span>分组</span><EditInput value={signal.group ?? ""} placeholder="无分组" onCommit={(value) => update((draft) => { draft.group = value || undefined; })} /></label>
      <label><span>类型</span><select value={kind} onChange={(event) => changeKind(event.target.value)}><option value="clock">时钟</option><option value="digital">数字信号</option><option value="bus">总线</option></select></label>
    </div>
    <div className="lane-values">
      {signal.clock && <ClockFields signal={signal} update={update} />}
      {signal.digital && <DigitalFields signal={signal} update={update} />}
      {signal.bus && <BusFields signal={signal} update={update} />}
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
  return <div className="piece-row">
    {points.map((point, pointIndex) => <div className="value-piece digital-piece" key={pointIndex}>
      <select aria-label={`第 ${pointIndex + 1} 个逻辑值`} value={point.value} onChange={(event) => update((draft) => { draft.digital!.points[pointIndex].value = event.target.value; })}><option value="low">LOW</option><option value="high">HIGH</option><option value="x">X</option><option value="z">Z</option></select>
      <span>@</span>
      <EditInput compact numeric value={String(point.at)} onCommit={(value) => update((draft) => { draft.digital!.points[pointIndex].at = Number(value); })} />
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
  return <div className="piece-row">
    {segments.map((segment, segmentIndex) => <div className="value-piece bus-piece" key={segmentIndex}>
      <EditInput compact value={segment.value} onCommit={(value) => update((draft) => { draft.bus!.segments[segmentIndex].value = value; })} />
      <EditInput compact numeric value={String(segment.from)} onCommit={(value) => update((draft) => { draft.bus!.segments[segmentIndex].from = Number(value); })} />
      <span>..</span>
      <EditInput compact numeric value={String(segment.to)} onCommit={(value) => update((draft) => { draft.bus!.segments[segmentIndex].to = Number(value); })} />
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
  return <section className="annotation-editor">
    <header><span><Highlighter size={14} />标记与区间</span><small>{diagram.markers.length + diagram.spans.length} 项</small></header>
    <div className="annotation-list">
      {diagram.markers.map((marker, index) => <div className="annotation-row" key={`marker-${index}`}>
        <strong>时间标记</strong>
        <EditInput value={marker.label ?? ""} placeholder="标签" onCommit={(value) => mutate((draft) => { draft.markers[index].label = value || undefined; })} />
        <NumberField label="时间" value={marker.at} onCommit={(value) => mutate((draft) => { draft.markers[index].at = value; })} />
        <button title="删除时间标记" onClick={() => mutate((draft) => { draft.markers.splice(index, 1); })}><Trash2 size={14} /></button>
      </div>)}
      {diagram.spans.map((span, index) => <div className="annotation-row" key={`span-${index}`}>
        <strong>区间箭头</strong>
        <EditInput value={span.label} placeholder="标签" onCommit={(value) => mutate((draft) => { draft.spans[index].label = value; })} />
        <NumberField label="开始" value={span.from} onCommit={(value) => mutate((draft) => { draft.spans[index].from = value; })} />
        <NumberField label="结束" value={span.to} onCommit={(value) => mutate((draft) => { draft.spans[index].to = value; })} />
        <button title="删除区间" onClick={() => mutate((draft) => { draft.spans.splice(index, 1); })}><Trash2 size={14} /></button>
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

function EditInput({ value, placeholder, compact = false, numeric = false, onCommit }: { value: string; placeholder?: string; compact?: boolean; numeric?: boolean; onCommit: (value: string) => boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <input className={compact ? "compact-input" : ""} type={numeric ? "number" : "text"} step="any" value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} onBlur={() => {
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

export default App;
