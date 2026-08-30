# Timing Studio DSL v1 规范

本文定义 `.timing` 文本格式的第一版稳定语法。DSL 最终转换为与 YAML/JSON 相同的 Rust `Diagram` 模型。

## 文档结构

- UTF-8 纯文本；
- 一行一条语句；
- 空行会被忽略；
- 语句和参数区分大小写；
- 推荐扩展名为 `.timing`；
- 可选首行 `timing 1`，省略时仍按 v1 解析。

```text
timing 1
title "图表标题"
unit cycle

clock CLK cycles 8
signal READY low@0 high@2
```

`timing`、`title` 和 `unit` 在一份文件中最多声明一次。

## 词法规则

普通值以空白分隔。包含空格、`#` 或双引号的文本使用双引号：

```text
title "SPI #1 读取"
mark "第一次采样" @4
```

引号内支持两种转义：

| 写法 | 结果 |
|---|---|
| `\"` | `"` |
| `\\` | `\` |

其他转义会报错。引号外的 `#` 开始注释，引号内的 `#` 属于文本。

```text
# 整行注释
signal READY low@0 high@1 # 行尾注释
title "Hash # stays"
```

时间使用有限的非负十进制数，整数和小数均可：`0`、`1.5`、`0.25`。不接受负数、`NaN` 或无穷大。

## `timing`

```text
timing 1
```

声明 DSL 版本。当前只支持版本 `1`。该语句可省略，但推荐新文件显式写出。

## `title`

```text
title Demo
title "SPI Flash 读取"
```

设置图表标题。只能声明一次；包含空格时必须加双引号。

## `unit`

```text
unit cycle
unit ns
```

设置右下角显示的时间单位。默认值为 `cycle`。单位是显示文本，不会自动换算时间值。

## `clock`

```text
clock <名称> cycles <正整数> [period <正数>] [start <非负数>] [group <名称>]
```

参数顺序可以调整，但每个参数最多出现一次。

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `cycles` | 是 | 无 | 完整时钟周期数，必须是正整数 |
| `period` | 否 | `2` | 一个完整周期的时间长度 |
| `start` | 否 | `0` | 时钟开始时间 |
| `group` | 否 | 无 | 信号分组名称 |

未知、重复或缺值参数都会报错。

## `signal`

```text
signal <名称> <逻辑值>@<时间>... [group <名称>]
```

逻辑值：

| 写法 | 含义 |
|---|---|
| `low` 或 `0` | 低电平 |
| `high` 或 `1` | 高电平 |
| `x` | 未知 |
| `z` | 高阻 |

至少需要一个采样点。时间必须严格递增，不能相等或倒序。`group` 如果存在，必须位于行尾。

```text
signal RESET_N low@0 high@2
signal DATA_VALID 0@0 1@1.5 0@4 group AXI
signal TRI_STATE z@0 x@2 high@3
```

每个采样点表示信号从该时间开始切换到指定值。

## `bus`

```text
bus <名称> <值>@<开始>..<结束>... [group <名称>]
```

至少需要一个片段。每个片段必须满足：

- 开始和结束是有限的非负数；
- 结束严格大于开始；
- 片段按开始时间排列；
- 相邻片段可以首尾相接或留空档，但不能重叠。

```text
bus DATA A@0..4 B@4..8
bus RESPONSE "OK READY"@1.5..3.5 group API
```

## `mark`

```text
mark <标签> @<时间>
```

在指定时间绘制垂直标记。标签包含空格时使用双引号。

```text
mark sample @4
mark "第一次传输" @6.5
```

## 语法摘要

```text
document  := statement*
statement := timing | title | unit | clock | signal | bus | mark
timing    := "timing" "1"
title     := "title" text
unit      := "unit" token
clock     := "clock" name clock-option+
signal    := "signal" name point+ ["group" name]
bus       := "bus" name segment+ ["group" name]
mark      := "mark" text marker-time
point     := logic-at-time
segment   := text-at-range
marker-time  := "@" time
logic-at-time := logic "@" time
text-at-range := text "@" time ".." time
```

这里的 `text` 或 `name` 如果包含空白，必须使用双引号。

## 格式识别

编辑器同时接受 DSL、YAML 和 JSON：

- 以已知 DSL 命令开头时按 DSL 解析；
- 以 `{` 或 `[` 开头时按 JSON/YAML 解析；
- 第一条有效行含未加引号的 `:` 时按 YAML 解析；
- 其他纯文本按 DSL 解析，因此拼错首条命令也能得到“未知语句”诊断。

## 错误行为

DSL 错误包含源文件行号。以下情况会拒绝整份文档：

- 未知语句、未知参数或不支持的版本；
- 固定长度语句存在多余内容；
- 必填参数缺失；
- 参数或文档声明重复；
- 引号未闭合或使用未知转义；
- 时间为负数、非有限数或顺序错误；
- 总线区间无效或重叠；
- 没有任何信号。
