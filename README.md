# Timing Studio

Timing Studio 是一个运行在浏览器中的数字时序图编辑器。Rust 核心负责解析、校验、布局和 SVG 生成，通过 WebAssembly 在本地浏览器执行；输入数据不会上传到服务器。

## 当前功能

- YAML 描述高低电平、时钟和总线
- 实时 SVG 预览
- 时间标记和信号分组
- 浅色、深色主题
- 40%～200% 波形预览缩放与适应窗口
- 导入 YAML/JSON，导出 SVG 和 2 倍分辨率 PNG
- 浏览器本地保存最近一次编辑
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

## 架构

```text
React 工作台 -> timing-wasm -> timing-core -> SVG
```

`timing-core` 不依赖浏览器环境，可以在未来复用于 CLI 或 Tauri，但当前版本只交付 Web/PWA。
