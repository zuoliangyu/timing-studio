import {
  Check,
  ChevronDown,
  Download,
  FileUp,
  ImageDown,
  Maximize2,
  Moon,
  RotateCcw,
  Sun,
  Zap,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import initWasm, { render } from "./wasm/timing_wasm";
import { examples } from "./examples";

const initialSource = localStorage.getItem("timing-source") ?? examples["SPI 读取"];

function App() {
  const [source, setSource] = useState(initialSource);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(() => localStorage.getItem("timing-theme") === "dark");
  const [ready, setReady] = useState(false);
  const [exampleOpen, setExampleOpen] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [exportingPng, setExportingPng] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    initWasm().then(() => setReady(true)).catch((reason) => setError(String(reason)));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("timing-theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    if (!ready) return;
    const timeout = window.setTimeout(() => {
      try {
        setSvg(render(source, dark));
        setError(null);
        localStorage.setItem("timing-source", source);
      } catch (reason) {
        setError(String(reason));
      }
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [source, dark, ready]);

  const downloadSvg = useCallback(() => {
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "timing-diagram.svg";
    link.click();
    URL.revokeObjectURL(url);
  }, [svg]);

  const downloadPng = useCallback(async () => {
    if (!svg || exportingPng) return;
    setExportingPng(true);
    const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);

    try {
      const image = new Image();
      image.decoding = "async";
      image.src = svgUrl;
      await image.decode();

      const viewBox = svg.match(/viewBox="[\d.\-]+ [\d.\-]+ ([\d.]+) ([\d.]+)"/);
      const width = Math.max(1, Number(viewBox?.[1] ?? image.naturalWidth));
      const height = Math.max(1, Number(viewBox?.[2] ?? image.naturalHeight));
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("当前浏览器不支持 Canvas 导出");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      const pngBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG 编码失败")), "image/png");
      });
      const pngUrl = URL.createObjectURL(pngBlob);
      const link = document.createElement("a");
      link.href = pngUrl;
      link.download = "timing-diagram@2x.png";
      link.click();
      URL.revokeObjectURL(pngUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      URL.revokeObjectURL(svgUrl);
      setExportingPng(false);
    }
  }, [svg, exportingPng]);

  const changeZoom = (delta: number) => {
    setZoom((value) => Math.min(200, Math.max(40, value + delta)));
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    setSource(await file.text());
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="Timing Studio">
          <span className="brand-mark"><Zap size={17} strokeWidth={2.4} /></span>
          <div><strong>Timing Studio</strong><small>数字时序绘图台</small></div>
        </div>

        <div className="topbar-actions">
          <div className="example-picker">
            <button className="text-control" onClick={() => setExampleOpen(!exampleOpen)} aria-expanded={exampleOpen}>
              示例 <ChevronDown size={14} />
            </button>
            {exampleOpen && (
              <div className="example-menu">
                {Object.entries(examples).map(([name, value]) => (
                  <button key={name} onClick={() => { setSource(value); setExampleOpen(false); }}>{name}</button>
                ))}
              </div>
            )}
          </div>
          <button className="icon-control" title="导入 YAML" onClick={() => fileRef.current?.click()}><FileUp size={17} /></button>
          <input ref={fileRef} hidden type="file" accept=".yaml,.yml,.json,text/yaml,application/json" onChange={(event) => importFile(event.target.files?.[0])} />
          <button className="icon-control" title={dark ? "切换浅色" : "切换深色"} onClick={() => setDark(!dark)}>
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button className="icon-control" title="导出 2 倍 PNG" disabled={!svg || Boolean(error) || exportingPng} onClick={downloadPng}>
            <ImageDown size={17} />
          </button>
          <button className="primary-control" disabled={!svg || Boolean(error)} onClick={downloadSvg}><Download size={16} />导出 SVG</button>
        </div>
      </header>

      <section className="workspace">
        <section className="editor-pane" aria-label="时序描述编辑器">
          <div className="pane-heading">
            <div><span className="pane-kicker">SOURCE</span><h1>时序描述</h1></div>
            <button className="icon-control subtle" title="恢复示例" onClick={() => setSource(examples["SPI 读取"])}><RotateCcw size={15} /></button>
          </div>
          <div className="editor-wrap">
            <div className="line-numbers" aria-hidden="true">
              {source.split("\n").map((_, index) => <span key={index}>{index + 1}</span>)}
            </div>
            <textarea
              value={source}
              onChange={(event) => setSource(event.target.value)}
              spellCheck={false}
              aria-label="YAML 时序描述"
            />
          </div>
          <footer className={`statusbar ${error ? "has-error" : ""}`}>
            {error ? <><span className="error-dot" />{error}</> : <><Check size={13} />描述有效</>}
          </footer>
        </section>

        <section className="preview-pane" aria-label="时序图预览">
          <div className="pane-heading preview-heading">
            <div><span className="pane-kicker">OUTPUT</span><h2>波形预览</h2></div>
            <div className="preview-tools">
              <button className="preview-tool" title="缩小" disabled={zoom <= 40} onClick={() => changeZoom(-20)}><ZoomOut size={14} /></button>
              <button className="zoom-value" title="恢复 100%" onClick={() => setZoom(100)}>{zoom}%</button>
              <button className="preview-tool" title="放大" disabled={zoom >= 200} onClick={() => changeZoom(20)}><ZoomIn size={14} /></button>
              <button className="preview-tool" title="适应窗口" onClick={() => setZoom(100)}><Maximize2 size={14} /></button>
              <span className="render-mode">Rust · WASM</span>
            </div>
          </div>
          <div className="scope-ruler" aria-hidden="true">
            {Array.from({ length: 21 }, (_, index) => <i key={index} className={index % 5 === 0 ? "major" : ""} />)}
          </div>
          <div className="preview-stage">
            {!ready && <div className="empty-state">正在加载渲染核心</div>}
            {ready && error && <div className="empty-state error-state">修正左侧描述后，这里会立即更新。</div>}
            {ready && !error && <div className="svg-frame" style={{ width: `${zoom}%` }} dangerouslySetInnerHTML={{ __html: svg }} />}
          </div>
        </section>
      </section>
    </main>
  );
}

export default App;
