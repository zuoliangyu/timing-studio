import {
  Check,
  ChevronDown,
  Download,
  FileUp,
  Moon,
  RotateCcw,
  Sun,
  Zap,
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
            <span className="render-mode">Rust · WASM</span>
          </div>
          <div className="scope-ruler" aria-hidden="true">
            {Array.from({ length: 21 }, (_, index) => <i key={index} className={index % 5 === 0 ? "major" : ""} />)}
          </div>
          <div className="preview-stage">
            {!ready && <div className="empty-state">正在加载渲染核心</div>}
            {ready && error && <div className="empty-state error-state">修正左侧描述后，这里会立即更新。</div>}
            {ready && !error && <div className="svg-frame" dangerouslySetInnerHTML={{ __html: svg }} />}
          </div>
        </section>
      </section>
    </main>
  );
}

export default App;

