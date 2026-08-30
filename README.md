# Timing Studio

Timing Studio 是一个运行在浏览器中的数字时序图编辑器。Rust 核心负责解析、校验、布局和 SVG 生成，通过 WebAssembly 在本地浏览器执行；输入数据不会上传到服务器。

使用说明：[用户手册](docs/user-guide.md) · [DSL v1 规范](docs/dsl.md)

在线使用：https://zuoliangyu.github.io/timing-studio/

## 当前功能

- `积木`、`DSL`、`YAML` 三种并列编辑模式
- 编辑器内统一的“添加内容”栏支持 DSL/YAML 原地插入模板与片段，并支持一键规范化格式
- DSL 语法速查与 YAML 结构说明可在对应编辑模式中随时打开
- 可编辑的时钟、数字信号、总线、时间标记、区间和因果箭头积木
- 带迷你波形的信号模板，以及时钟复位、Ready/Valid、SPI 常用片段追加
- 信号多选分组、组重命名/折叠/整组移动，以及 SVG/TikZ 分组括号
- 信号筛选、紧凑视图，以及信号、状态点、总线片段和论文标注排序
- 可定位到整图、指定信号或指定分组下方的区间/建立/保持时间标注
- 建立时间、保持时间、因果箭头，以及区间标签数学下标
- DSL 与 YAML 通过同一个 Rust `Diagram` 双向转换
- 论文风格的白底黑线实时 SVG 预览
- 跨编辑模式撤销与重做
- 40%～200% 波形预览缩放与适应窗口
- 导入并下载 `.timing`、YAML，导出 SVG、2 倍分辨率 PNG、PDF 和 TikZ
- 浏览器本地保存最近一次编辑
- 时间顺序、区间重叠、重复信号名称和非有限数值校验
- 错误行高亮与点击跳转
- 键盘快捷键和面向键盘操作的焦点、标签及状态提示
- PWA 离线缓存和 GitHub Pages 发布

## 本地开发

需要 Node.js 22+、Rust、`wasm32-unknown-unknown` target 和 `wasm-pack`：

```powershell
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
npm install
npm run dev
```

开发服务器默认运行在 `http://127.0.0.1:1420`。

提交前可以运行聚焦验证：

```powershell
cargo fmt --check
cargo test -p timing-core
npx tsc -b
npm run test:e2e
npm run build
```

首次运行浏览器测试前需要安装 Chromium：

```powershell
npx playwright install chromium
```

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
span 1..9 "命令阶段" under group SPI
setup 8..9 "建立时间 T_setup" under signal MOSI
hold 9..10 "保持时间 T_hold" under signal MISO
arrow CS_N@1 -> DATA@9 "命令完成"
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
积木 / DSL / YAML -> React 工作台 -> timing-wasm -> timing-core Diagram -> SVG / TikZ
```

`timing-core` 不依赖浏览器环境，可以在未来复用于 CLI 或桌面应用；当前交付本地 Web 版本和 GitHub Pages 静态站点。

## 持续集成与发布

- [持续集成](.github/workflows/ci.yml) 在推送到 `main` 或创建 Pull Request 时运行 Rust 格式检查与单元测试、WASM/TypeScript/前端构建和 Chromium 端到端测试。
- [GitHub Pages 发布](.github/workflows/pages.yml) 在 `main` 更新后构建静态资源并部署到 GitHub Pages，也支持在 Actions 页面手动触发。
- 两个 workflow 分离运行：CI 负责质量门禁，Pages workflow 只负责构建和发布，失败时可以分别定位。
