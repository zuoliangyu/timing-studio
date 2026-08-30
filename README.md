# Timing Studio

Timing Studio 是一个运行在浏览器中的数字时序图编辑器。Rust 核心负责解析、校验、布局和 SVG 生成，通过 WebAssembly 在本地浏览器执行；输入数据不会上传到服务器。

使用说明：[用户手册](docs/user-guide.md) · [DSL v1 规范](docs/dsl.md)

## 当前功能

- `积木`、`DSL`、`YAML` 三种并列编辑模式
- 可编辑的时钟、数字信号、总线、时间标记和区间箭头积木
- 信号积木拖拽排序，以及区间标签数学下标
- DSL 与 YAML 通过同一个 Rust `Diagram` 双向转换
- 论文风格的白底黑线实时 SVG 预览
- 跨编辑模式撤销与重做
- 40%～200% 波形预览缩放与适应窗口
- 导入并下载 `.timing`、YAML，导出 SVG 和 2 倍分辨率 PNG
- 浏览器本地保存最近一次编辑
- 时间顺序、区间重叠、重复信号名称和非有限数值校验
- 错误行高亮与点击跳转
- PWA 离线缓存和 GitHub Pages 发布

## 本地开发

需要 Node.js 22+、Rust、`wasm32-unknown-unknown` target 和 `wasm-pack`：

```powershell
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
npm install
npm run dev
```

开发服务器默认运行在 `http://localhost:1420`。

## 输入示例

人工编写推荐使用简洁 DSL：

```text
timing 1
title "SPI Flash 读取"
unit cycle
clock SCLK period 2 cycles 8 start 1 group SPI
signal CS_N high@0 low@1 high@17 group SPI
bus DATA "0x9F"@1..9 "ADDR"@9..17 group SPI
mark "采样" @9
span 1..9 "命令阶段"
```

程序生成或需要结构化交换时可继续使用 YAML：

```yaml
title: SPI Flash 读取
unit: cycle
signals:
  - name: SCLK
    clock: { period: 2, cycles: 8, start: 1 }
  - name: CS_N
    digital:
      points:
        - { at: 0, value: high }
        - { at: 1, value: low }
        - { at: 17, value: high }
  - name: DATA
    bus:
      segments:
        - { from: 1, to: 9, value: "0x9F" }
markers:
  - { at: 9, label: "采样" }
```

简洁 DSL 的完整语法、默认值和错误规则见 [DSL v1 规范](docs/dsl.md)。

## 架构

```text
积木 / DSL / YAML -> React 工作台 -> timing-wasm -> timing-core Diagram -> SVG
```

`timing-core` 不依赖浏览器环境，可以在未来复用于 CLI 或 Tauri，但当前版本只交付 Web/PWA。
