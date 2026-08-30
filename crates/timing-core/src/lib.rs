use serde::{Deserialize, Serialize};
use std::fmt::Write;
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagram {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default = "default_unit")]
    pub unit: String,
    #[serde(default)]
    pub signals: Vec<Signal>,
    #[serde(default)]
    pub markers: Vec<Marker>,
    #[serde(default)]
    pub spans: Vec<Span>,
    #[serde(default)]
    pub arrows: Vec<CausalArrow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Signal {
    pub name: String,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(flatten)]
    pub kind: SignalKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SignalKind {
    Clock {
        period: f64,
        cycles: u32,
        #[serde(default)]
        start: f64,
    },
    Digital {
        points: Vec<DigitalPoint>,
    },
    Bus {
        segments: Vec<BusSegment>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DigitalPoint {
    pub at: f64,
    pub value: LogicValue,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LogicValue {
    Low,
    High,
    X,
    Z,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BusSegment {
    pub from: f64,
    pub to: f64,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Marker {
    pub at: f64,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Span {
    pub from: f64,
    pub to: f64,
    pub label: String,
    #[serde(default, skip_serializing_if = "SpanKind::is_interval")]
    pub kind: SpanKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub under: Option<SpanTarget>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SpanKind {
    #[default]
    Interval,
    Setup,
    Hold,
}

impl SpanKind {
    fn is_interval(&self) -> bool {
        *self == Self::Interval
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum SpanTarget {
    Signal { signal: String },
    Group { group: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CausalArrow {
    pub from: ArrowAnchor,
    pub to: ArrowAnchor,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArrowAnchor {
    pub signal: String,
    pub at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RenderOptions {
    #[serde(default)]
    pub dark: bool,
}

#[derive(Debug, Error)]
pub enum TimingError {
    #[error("无法解析输入：{0}")]
    Parse(String),
    #[error("第 {line} 个信号无效：{message}")]
    InvalidSignal { line: usize, message: String },
    #[error("时序图无效：{0}")]
    Invalid(String),
    #[error("时序图至少需要一个信号")]
    Empty,
}

fn default_unit() -> String {
    "cycle".to_owned()
}

pub fn parse(source: &str) -> Result<Diagram, TimingError> {
    let diagram = if is_dsl(source) {
        parse_dsl(source)?
    } else {
        serde_yaml::from_str::<Diagram>(source)
            .map_err(|error| TimingError::Parse(error.to_string()))?
    };
    validate(&diagram)?;
    Ok(diagram)
}

pub fn to_yaml(diagram: &Diagram) -> Result<String, TimingError> {
    validate(diagram)?;
    serde_yaml::to_string(diagram).map_err(|error| TimingError::Parse(error.to_string()))
}

pub fn to_dsl(diagram: &Diagram) -> Result<String, TimingError> {
    validate(diagram)?;
    let mut output = String::from("timing 1\n");
    if let Some(title) = &diagram.title {
        writeln!(output, "title {}", quote_dsl(title)).unwrap();
    }
    writeln!(output, "unit {}", quote_dsl(&diagram.unit)).unwrap();
    if diagram.title.is_some() {
        output.push('\n');
    }
    for signal in &diagram.signals {
        match &signal.kind {
            SignalKind::Clock {
                period,
                cycles,
                start,
            } => {
                write!(
                    output,
                    "clock {} period {} cycles {} start {}",
                    quote_dsl(&signal.name),
                    format_number(*period),
                    cycles,
                    format_number(*start)
                )
                .unwrap();
            }
            SignalKind::Digital { points } => {
                write!(output, "signal {}", quote_dsl(&signal.name)).unwrap();
                for point in points {
                    let value = match point.value {
                        LogicValue::Low => "low",
                        LogicValue::High => "high",
                        LogicValue::X => "x",
                        LogicValue::Z => "z",
                    };
                    write!(output, " {value}@{}", format_number(point.at)).unwrap();
                }
            }
            SignalKind::Bus { segments } => {
                write!(output, "bus {}", quote_dsl(&signal.name)).unwrap();
                for segment in segments {
                    write!(
                        output,
                        " {}@{}..{}",
                        quote_dsl(&segment.value),
                        format_number(segment.from),
                        format_number(segment.to)
                    )
                    .unwrap();
                }
            }
        }
        if let Some(group) = &signal.group {
            write!(output, " group {}", quote_dsl(group)).unwrap();
        }
        output.push('\n');
    }
    for marker in &diagram.markers {
        writeln!(
            output,
            "mark {} @{}",
            quote_dsl(marker.label.as_deref().unwrap_or("标记")),
            format_number(marker.at)
        )
        .unwrap();
    }
    for span in &diagram.spans {
        let keyword = match span.kind {
            SpanKind::Interval => "span",
            SpanKind::Setup => "setup",
            SpanKind::Hold => "hold",
        };
        write!(
            output,
            "{keyword} {}..{} {}",
            format_number(span.from),
            format_number(span.to),
            quote_dsl(&span.label)
        )
        .unwrap();
        if let Some(target) = &span.under {
            let (kind, name) = match target {
                SpanTarget::Signal { signal } => ("signal", signal),
                SpanTarget::Group { group } => ("group", group),
            };
            write!(output, " under {kind} {}", quote_dsl(name)).unwrap();
        }
        output.push('\n');
    }
    for arrow in &diagram.arrows {
        write!(
            output,
            "arrow {}@{} -> {}@{}",
            quote_dsl(&arrow.from.signal),
            format_number(arrow.from.at),
            quote_dsl(&arrow.to.signal),
            format_number(arrow.to.at)
        )
        .unwrap();
        if let Some(label) = &arrow.label {
            write!(output, " {}", quote_dsl(label)).unwrap();
        }
        output.push('\n');
    }
    Ok(output)
}

fn quote_dsl(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn format_number(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        value.to_string()
    }
}

fn is_dsl(source: &str) -> bool {
    for raw_line in source.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let keyword = line.split_whitespace().next().unwrap_or_default();
        if matches!(
            keyword,
            "timing"
                | "title"
                | "unit"
                | "clock"
                | "signal"
                | "bus"
                | "mark"
                | "span"
                | "setup"
                | "hold"
                | "arrow"
        ) {
            return true;
        }
        if line.starts_with('{') || line.starts_with('[') {
            return false;
        }
        return !has_unquoted_colon(line);
    }
    false
}

fn has_unquoted_colon(line: &str) -> bool {
    let mut quoted = false;
    let mut escaped = false;
    for ch in line.chars() {
        if escaped {
            escaped = false;
            continue;
        }
        match ch {
            '\\' if quoted => escaped = true,
            '"' => quoted = !quoted,
            ':' if !quoted => return true,
            _ => {}
        }
    }
    false
}

fn parse_dsl(source: &str) -> Result<Diagram, TimingError> {
    let mut diagram = Diagram {
        title: None,
        unit: default_unit(),
        signals: Vec::new(),
        markers: Vec::new(),
        spans: Vec::new(),
        arrows: Vec::new(),
    };
    let mut version_declared = false;
    let mut unit_declared = false;

    for (index, raw_line) in source.lines().enumerate() {
        let line_number = index + 1;
        let tokens = tokenize(raw_line).map_err(|message| dsl_error(line_number, &message))?;
        if tokens.is_empty() {
            continue;
        }

        match tokens[0].as_str() {
            "timing" => {
                if version_declared {
                    return Err(dsl_error(line_number, "timing 只能声明一次"));
                }
                reject_extra(&tokens, 2, line_number, "timing")?;
                let version = required(&tokens, 1, line_number, "DSL 版本")?;
                if version != "1" {
                    return Err(dsl_error(
                        line_number,
                        &format!("不支持 DSL 版本 `{version}`"),
                    ));
                }
                version_declared = true;
            }
            "title" => {
                if diagram.title.is_some() {
                    return Err(dsl_error(line_number, "title 只能声明一次"));
                }
                if tokens.len() > 2 {
                    return Err(dsl_error(line_number, "带空格的标题必须使用双引号"));
                }
                diagram.title = Some(required(&tokens, 1, line_number, "标题")?.to_owned());
            }
            "unit" => {
                if unit_declared {
                    return Err(dsl_error(line_number, "unit 只能声明一次"));
                }
                reject_extra(&tokens, 2, line_number, "unit")?;
                diagram.unit = required(&tokens, 1, line_number, "时间单位")?.to_owned();
                unit_declared = true;
            }
            "clock" => diagram.signals.push(parse_clock(&tokens, line_number)?),
            "signal" => diagram.signals.push(parse_digital(&tokens, line_number)?),
            "bus" => diagram.signals.push(parse_bus(&tokens, line_number)?),
            "mark" => diagram.markers.push(parse_marker(&tokens, line_number)?),
            "span" => diagram
                .spans
                .push(parse_span(&tokens, line_number, SpanKind::Interval)?),
            "setup" => diagram
                .spans
                .push(parse_span(&tokens, line_number, SpanKind::Setup)?),
            "hold" => diagram
                .spans
                .push(parse_span(&tokens, line_number, SpanKind::Hold)?),
            "arrow" => diagram.arrows.push(parse_arrow(&tokens, line_number)?),
            keyword => return Err(dsl_error(line_number, &format!("未知语句 `{keyword}`"))),
        }
    }
    Ok(diagram)
}

fn tokenize(line: &str) -> Result<Vec<String>, String> {
    let mut tokens = Vec::new();
    let mut token = String::new();
    let mut quoted = false;
    let mut escaped = false;

    for ch in line.chars() {
        if escaped {
            match ch {
                '"' | '\\' => token.push(ch),
                _ => return Err(format!("不支持转义 `\\{ch}`，仅支持 `\\\"` 和 `\\\\`")),
            }
            escaped = false;
            continue;
        }
        match ch {
            '\\' if quoted => escaped = true,
            '"' => quoted = !quoted,
            '#' if !quoted => break,
            ch if ch.is_whitespace() && !quoted => {
                if !token.is_empty() {
                    tokens.push(std::mem::take(&mut token));
                }
            }
            _ => token.push(ch),
        }
    }
    if escaped {
        return Err("引号内的反斜杠后缺少转义字符".into());
    }
    if quoted {
        return Err("引号未闭合".into());
    }
    if !token.is_empty() {
        tokens.push(token);
    }
    Ok(tokens)
}

fn parse_clock(tokens: &[String], line: usize) -> Result<Signal, TimingError> {
    let name = required(tokens, 1, line, "时钟名称")?.to_owned();
    let mut index = 2;
    let mut seen = Vec::new();
    while index < tokens.len() {
        let key = &tokens[index];
        if !matches!(key.as_str(), "period" | "cycles" | "start" | "group") {
            return Err(dsl_error(line, &format!("未知时钟参数 `{key}`")));
        }
        if tokens.get(index + 1).is_none() {
            return Err(dsl_error(line, &format!("时钟参数 `{key}` 缺少值")));
        }
        if seen.contains(&key.as_str()) {
            return Err(dsl_error(line, &format!("时钟参数 `{key}` 不能重复")));
        }
        seen.push(key.as_str());
        index += 2;
    }
    if !seen.contains(&"cycles") {
        return Err(dsl_error(line, "时钟缺少必填参数 `cycles`"));
    }
    let period = option_number(tokens, "period", line)?.unwrap_or(2.0);
    let cycles = option_number(tokens, "cycles", line)?.expect("cycles presence checked above");
    if cycles.fract() != 0.0 || cycles < 0.0 || cycles > u32::MAX as f64 {
        return Err(dsl_error(line, "cycles 必须是正整数"));
    }
    Ok(Signal {
        name,
        group: option_text(tokens, "group").map(str::to_owned),
        kind: SignalKind::Clock {
            period,
            cycles: cycles as u32,
            start: option_number(tokens, "start", line)?.unwrap_or(0.0),
        },
    })
}

fn parse_digital(tokens: &[String], line: usize) -> Result<Signal, TimingError> {
    let name = required(tokens, 1, line, "信号名称")?.to_owned();
    let (end, group) = trailing_group(tokens, line)?;
    let points = tokens[2..end]
        .iter()
        .map(|token| {
            let (value, at) = token
                .split_once('@')
                .ok_or_else(|| dsl_error(line, "数字采样点应写成 high@0"))?;
            let value = match value.to_ascii_lowercase().as_str() {
                "0" | "low" => LogicValue::Low,
                "1" | "high" => LogicValue::High,
                "x" => LogicValue::X,
                "z" => LogicValue::Z,
                _ => return Err(dsl_error(line, &format!("未知逻辑值 `{value}`"))),
            };
            Ok(DigitalPoint {
                at: parse_number(at, line, "时间")?,
                value,
            })
        })
        .collect::<Result<Vec<_>, TimingError>>()?;
    if points
        .iter()
        .any(|point| !point.at.is_finite() || point.at < 0.0)
    {
        return Err(dsl_error(line, "数字信号时间必须是有限的非负数"));
    }
    if points.windows(2).any(|pair| pair[0].at >= pair[1].at) {
        return Err(dsl_error(line, "数字信号时间必须严格递增"));
    }
    Ok(Signal {
        name,
        group,
        kind: SignalKind::Digital { points },
    })
}

fn parse_bus(tokens: &[String], line: usize) -> Result<Signal, TimingError> {
    let name = required(tokens, 1, line, "总线名称")?.to_owned();
    let (end, group) = trailing_group(tokens, line)?;
    let segments = tokens[2..end]
        .iter()
        .map(|token| {
            let (value, range) = token
                .rsplit_once('@')
                .ok_or_else(|| dsl_error(line, "总线片段应写成 value@0..4"))?;
            let (from, to) = range
                .split_once("..")
                .ok_or_else(|| dsl_error(line, "总线时间范围应写成 0..4"))?;
            Ok(BusSegment {
                from: parse_number(from, line, "起始时间")?,
                to: parse_number(to, line, "结束时间")?,
                value: value.to_owned(),
            })
        })
        .collect::<Result<Vec<_>, TimingError>>()?;
    if segments.iter().any(|segment| {
        !segment.from.is_finite()
            || !segment.to.is_finite()
            || segment.from < 0.0
            || segment.to < 0.0
    }) {
        return Err(dsl_error(line, "总线时间必须是有限的非负数"));
    }
    if segments.iter().any(|segment| segment.to <= segment.from) {
        return Err(dsl_error(line, "总线结束时间必须大于开始时间"));
    }
    if segments.windows(2).any(|pair| pair[1].from < pair[0].to) {
        return Err(dsl_error(line, "总线片段不能重叠，且必须按时间排列"));
    }
    Ok(Signal {
        name,
        group,
        kind: SignalKind::Bus { segments },
    })
}

fn trailing_group(tokens: &[String], line: usize) -> Result<(usize, Option<String>), TimingError> {
    let Some(index) = tokens.iter().position(|token| token == "group") else {
        return Ok((tokens.len(), None));
    };
    let Some(value) = tokens.get(index + 1) else {
        return Err(dsl_error(line, "参数 `group` 缺少值"));
    };
    if index + 2 != tokens.len() {
        return Err(dsl_error(line, "参数 `group` 必须位于行尾且不能重复"));
    }
    Ok((index, Some(value.to_owned())))
}

fn parse_marker(tokens: &[String], line: usize) -> Result<Marker, TimingError> {
    reject_extra(tokens, 3, line, "mark")?;
    let label = required(tokens, 1, line, "标记名称")?.to_owned();
    let at = required(tokens, 2, line, "标记时间")?
        .strip_prefix('@')
        .ok_or_else(|| dsl_error(line, "标记时间应写成 @9"))?;
    Ok(Marker {
        at: parse_number(at, line, "标记时间")?,
        label: Some(label),
    })
}

fn parse_span(tokens: &[String], line: usize, kind: SpanKind) -> Result<Span, TimingError> {
    let statement = tokens.first().map(String::as_str).unwrap_or("span");
    if !matches!(tokens.len(), 3 | 6) {
        return Err(dsl_error(
            line,
            &format!("`{statement}` 语句应写成范围、标签，以及可选的 under signal/group"),
        ));
    }
    let range = required(tokens, 1, line, "区间范围")?;
    let (from, to) = range
        .split_once("..")
        .ok_or_else(|| dsl_error(line, "区间范围应写成 2..14"))?;
    let under = if tokens.len() == 6 {
        if required(tokens, 3, line, "标注位置")? != "under" {
            return Err(dsl_error(line, "区间标注位置应使用 `under`"));
        }
        let name = required(tokens, 5, line, "标注位置名称")?.to_owned();
        Some(match required(tokens, 4, line, "标注位置类型")? {
            "signal" => SpanTarget::Signal { signal: name },
            "group" => SpanTarget::Group { group: name },
            value => {
                return Err(dsl_error(
                    line,
                    &format!("未知标注位置类型 `{value}`，应为 signal 或 group"),
                ));
            }
        })
    } else {
        None
    };
    Ok(Span {
        from: parse_number(from, line, "区间开始时间")?,
        to: parse_number(to, line, "区间结束时间")?,
        label: required(tokens, 2, line, "区间标签")?.to_owned(),
        kind,
        under,
    })
}

fn parse_arrow(tokens: &[String], line: usize) -> Result<CausalArrow, TimingError> {
    reject_extra(tokens, 5, line, "arrow")?;
    if required(tokens, 2, line, "箭头方向")? != "->" {
        return Err(dsl_error(line, "因果箭头应使用 `->` 连接两个锚点"));
    }
    Ok(CausalArrow {
        from: parse_arrow_anchor(required(tokens, 1, line, "源锚点")?, line)?,
        to: parse_arrow_anchor(required(tokens, 3, line, "目标锚点")?, line)?,
        label: tokens.get(4).cloned(),
    })
}

fn parse_arrow_anchor(value: &str, line: usize) -> Result<ArrowAnchor, TimingError> {
    let (signal, at) = value
        .rsplit_once('@')
        .ok_or_else(|| dsl_error(line, "箭头锚点应写成 SIGNAL@2"))?;
    if signal.trim().is_empty() {
        return Err(dsl_error(line, "箭头锚点缺少信号名称"));
    }
    Ok(ArrowAnchor {
        signal: signal.to_owned(),
        at: parse_number(at, line, "箭头时间")?,
    })
}

fn reject_extra(
    tokens: &[String],
    expected: usize,
    line: usize,
    statement: &str,
) -> Result<(), TimingError> {
    if tokens.len() > expected {
        return Err(dsl_error(line, &format!("`{statement}` 语句包含多余内容")));
    }
    Ok(())
}

fn required<'a>(
    tokens: &'a [String],
    index: usize,
    line: usize,
    name: &str,
) -> Result<&'a str, TimingError> {
    tokens
        .get(index)
        .map(String::as_str)
        .ok_or_else(|| dsl_error(line, &format!("缺少{name}")))
}

fn option_text<'a>(tokens: &'a [String], key: &str) -> Option<&'a str> {
    tokens
        .iter()
        .position(|token| token == key)
        .and_then(|index| tokens.get(index + 1))
        .map(String::as_str)
}

fn option_number(tokens: &[String], key: &str, line: usize) -> Result<Option<f64>, TimingError> {
    option_text(tokens, key)
        .map(|value| parse_number(value, line, key))
        .transpose()
}

fn parse_number(value: &str, line: usize, name: &str) -> Result<f64, TimingError> {
    value
        .parse::<f64>()
        .map_err(|_| dsl_error(line, &format!("{name} `{value}` 不是有效数字")))
}

fn dsl_error(line: usize, message: &str) -> TimingError {
    TimingError::Parse(format!("第 {line} 行：{message}"))
}

fn validate(diagram: &Diagram) -> Result<(), TimingError> {
    if diagram.signals.is_empty() {
        return Err(TimingError::Empty);
    }

    let mut names = std::collections::HashSet::new();
    for (line, signal) in diagram.signals.iter().enumerate() {
        if signal.name.trim().is_empty() {
            return Err(TimingError::InvalidSignal {
                line: line + 1,
                message: "名称不能为空".into(),
            });
        }
        if !names.insert(signal.name.as_str()) {
            return Err(TimingError::InvalidSignal {
                line: line + 1,
                message: format!("名称 `{}` 与已有信号重复", signal.name),
            });
        }
        let invalid = |message: &str| TimingError::InvalidSignal {
            line: line + 1,
            message: message.into(),
        };
        match &signal.kind {
            SignalKind::Clock {
                period,
                cycles,
                start,
            } => {
                if !period.is_finite() || *period <= 0.0 || *cycles == 0 {
                    return Err(invalid("时钟周期和循环数必须是有限的正数"));
                }
                if !start.is_finite() || *start < 0.0 {
                    return Err(invalid("时钟开始时间必须是有限的非负数"));
                }
            }
            SignalKind::Digital { points } => {
                if points.is_empty() {
                    return Err(invalid("数字信号至少需要一个采样点"));
                }
                if points
                    .iter()
                    .any(|point| !point.at.is_finite() || point.at < 0.0)
                {
                    return Err(invalid("数字信号时间必须是有限的非负数"));
                }
                if points.windows(2).any(|pair| pair[0].at >= pair[1].at) {
                    return Err(invalid("数字信号时间必须严格递增"));
                }
            }
            SignalKind::Bus { segments } => {
                if segments.is_empty() {
                    return Err(invalid("总线至少需要一个片段"));
                }
                if segments.iter().any(|item| {
                    !item.from.is_finite()
                        || !item.to.is_finite()
                        || item.from < 0.0
                        || item.to <= item.from
                }) {
                    return Err(invalid("总线时间必须有限、非负，且 to 必须大于 from"));
                }
                if segments.windows(2).any(|pair| pair[1].from < pair[0].to) {
                    return Err(invalid("总线片段不能重叠，且必须按时间排列"));
                }
            }
        }
    }
    if diagram
        .markers
        .iter()
        .any(|marker| !marker.at.is_finite() || marker.at < 0.0)
    {
        return Err(TimingError::Invalid("标记时间必须是有限的非负数".into()));
    }
    if diagram.spans.iter().any(|span| {
        !span.from.is_finite()
            || !span.to.is_finite()
            || span.from < 0.0
            || span.to <= span.from
            || span.label.trim().is_empty()
    }) {
        return Err(TimingError::Invalid(
            "区间标注必须有标签，且结束时间必须大于非负的开始时间".into(),
        ));
    }
    for span in &diagram.spans {
        match &span.under {
            Some(SpanTarget::Signal { signal }) if !names.contains(signal.as_str()) => {
                return Err(TimingError::Invalid(format!(
                    "区间标注引用的信号 `{signal}` 不存在"
                )));
            }
            Some(SpanTarget::Group { group })
                if !diagram
                    .signals
                    .iter()
                    .any(|signal| signal.group.as_deref() == Some(group.as_str())) =>
            {
                return Err(TimingError::Invalid(format!(
                    "区间标注引用的分组 `{group}` 不存在"
                )));
            }
            _ => {}
        }
    }
    for arrow in &diagram.arrows {
        if !names.contains(arrow.from.signal.as_str()) || !names.contains(arrow.to.signal.as_str())
        {
            return Err(TimingError::Invalid(
                "因果箭头引用的源信号和目标信号必须存在".into(),
            ));
        }
        if !arrow.from.at.is_finite()
            || !arrow.to.at.is_finite()
            || arrow.from.at < 0.0
            || arrow.to.at < 0.0
        {
            return Err(TimingError::Invalid(
                "因果箭头时间必须是有限的非负数".into(),
            ));
        }
    }
    Ok(())
}

pub fn render_tikz(diagram: &Diagram) -> Result<String, TimingError> {
    validate(diagram)?;
    let max_time = diagram
        .signals
        .iter()
        .map(signal_end)
        .chain(diagram.markers.iter().map(|marker| marker.at))
        .chain(diagram.spans.iter().map(|span| span.to))
        .chain(
            diagram
                .arrows
                .iter()
                .flat_map(|arrow| [arrow.from.at, arrow.to.at]),
        )
        .fold(1.0, f64::max);
    let mut spans_after = vec![Vec::new(); diagram.signals.len()];
    let mut bottom_spans = Vec::new();
    for (index, span) in diagram.spans.iter().enumerate() {
        if let Some(signal_index) = span_anchor_index(diagram, span) {
            spans_after[signal_index].push(index);
        } else {
            bottom_spans.push(index);
        }
    }
    let mut signal_y = Vec::with_capacity(diagram.signals.len());
    let mut cursor = 0.0;
    for local_spans in &spans_after {
        signal_y.push(-cursor);
        cursor += 1.2 + local_spans.len() as f64 * 0.65;
    }
    let row_y = |index: usize| signal_y[index];
    let level_y = |index: usize, value: LogicValue| {
        row_y(index)
            + match value {
                LogicValue::High => 0.28,
                LogicValue::Low => -0.28,
                LogicValue::X | LogicValue::Z => 0.0,
            }
    };

    let mut output = String::from(
        "% Timing Studio TikZ export\n\\begin{tikzpicture}[x=0.65cm,y=0.8cm,>=stealth,line cap=rect,line join=miter]\n",
    );
    if let Some(title) = &diagram.title {
        writeln!(
            output,
            "  \\node[anchor=west,font=\\bfseries] at (0,0.9) {{{}}};",
            escape_latex(title)
        )
        .unwrap();
    }

    for (group, start, end) in signal_group_runs(diagram) {
        let top = row_y(start) + 0.45;
        let bottom = row_y(end) - 0.45;
        writeln!(output, "  \\draw (-1.05,{top:.3}) -- (-1.25,{top:.3}) -- (-1.25,{bottom:.3}) -- (-1.05,{bottom:.3}) node[midway,left,rotate=90] {{{}}};",
            escape_latex(group)).unwrap();
    }

    for (index, signal) in diagram.signals.iter().enumerate() {
        let y = row_y(index);
        writeln!(
            output,
            "  \\node[anchor=east] at (-0.25,{y:.3}) {{{}}};",
            escape_latex(&signal.name)
        )
        .unwrap();
        match &signal.kind {
            SignalKind::Clock {
                period,
                cycles,
                start,
            } => {
                let half = period / 2.0;
                let mut path = format!("({start:.3},{:.3})", y - 0.28);
                for step in 0..(*cycles * 2) {
                    let next_x = start + (step + 1) as f64 * half;
                    let next_y = if step % 2 == 0 { y + 0.28 } else { y - 0.28 };
                    write!(
                        path,
                        " -- ({:.3},{next_y:.3}) -- ({next_x:.3},{next_y:.3})",
                        start + step as f64 * half
                    )
                    .unwrap();
                }
                writeln!(output, "  \\draw[thick] {path};").unwrap();
            }
            SignalKind::Digital { points } => {
                let mut path = format!(
                    "({:.3},{:.3})",
                    points[0].at,
                    level_y(index, points[0].value)
                );
                for pair in points.windows(2) {
                    write!(
                        path,
                        " -- ({:.3},{:.3}) -- ({:.3},{:.3})",
                        pair[1].at,
                        level_y(index, pair[0].value),
                        pair[1].at,
                        level_y(index, pair[1].value)
                    )
                    .unwrap();
                }
                write!(
                    path,
                    " -- ({max_time:.3},{:.3})",
                    level_y(index, points.last().expect("validated points").value)
                )
                .unwrap();
                writeln!(output, "  \\draw[thick] {path};").unwrap();
            }
            SignalKind::Bus { segments } => {
                for segment in segments {
                    writeln!(output, "  \\draw[thick] ({:.3},{:.3}) rectangle ({:.3},{:.3}) node[midway,fill=white,inner sep=1pt] {{{}}};",
                        segment.from, y - 0.3, segment.to, y + 0.3, escape_latex(&segment.value)).unwrap();
                }
            }
        }
    }

    let chart_top = 0.48;
    let chart_bottom = -cursor + 0.72;
    for marker in &diagram.markers {
        writeln!(output, "  \\draw[dashed,gray] ({:.3},{chart_top:.3}) -- ({:.3},{chart_bottom:.3}) node[above] {{{}}};",
            marker.at, marker.at, escape_latex(marker.label.as_deref().unwrap_or("标记"))).unwrap();
    }
    for arrow in &diagram.arrows {
        let from_index = diagram
            .signals
            .iter()
            .position(|signal| signal.name == arrow.from.signal)
            .expect("validated arrow source");
        let to_index = diagram
            .signals
            .iter()
            .position(|signal| signal.name == arrow.to.signal)
            .expect("validated arrow target");
        let label = arrow.label.as_deref().map(escape_latex).unwrap_or_default();
        writeln!(output, "  \\draw[->] ({:.3},{:.3}) -- ({:.3},{:.3}) node[midway,above,fill=white,inner sep=1pt] {{{label}}};",
            arrow.from.at, row_y(from_index), arrow.to.at, row_y(to_index)).unwrap();
    }
    for (signal_index, span_indices) in spans_after.iter().enumerate() {
        for (local_index, span_index) in span_indices.iter().enumerate() {
            let span = &diagram.spans[*span_index];
            let y = row_y(signal_index) - 0.68 - local_index as f64 * 0.55;
            let style = match span.kind {
                SpanKind::Interval => "<->",
                SpanKind::Setup => "<->,densely dashed",
                SpanKind::Hold => "<->,dotted",
            };
            writeln!(
                output,
                "  \\draw[{style}] ({:.3},{y:.3}) -- ({:.3},{y:.3}) node[midway,below] {{{}}};",
                span.from,
                span.to,
                escape_latex(&span.label)
            )
            .unwrap();
        }
    }
    for (index, span_index) in bottom_spans.iter().enumerate() {
        let span = &diagram.spans[*span_index];
        let y = chart_bottom - 0.65 - index as f64 * 0.55;
        let style = match span.kind {
            SpanKind::Interval => "<->",
            SpanKind::Setup => "<->,densely dashed",
            SpanKind::Hold => "<->,dotted",
        };
        writeln!(
            output,
            "  \\draw[{style}] ({:.3},{y:.3}) -- ({:.3},{y:.3}) node[midway,below] {{{}}};",
            span.from,
            span.to,
            escape_latex(&span.label)
        )
        .unwrap();
    }
    let unit_y = if bottom_spans.is_empty() {
        chart_bottom - 0.2
    } else {
        chart_bottom - 0.95 - (bottom_spans.len() - 1) as f64 * 0.55
    };
    writeln!(
        output,
        "  \\node[anchor=east,font=\\scriptsize] at ({max_time:.3},{unit_y:.3}) {{{}}};",
        escape_latex(&diagram.unit)
    )
    .unwrap();
    output.push_str("\\end{tikzpicture}\n");
    Ok(output)
}

fn escape_latex(value: &str) -> String {
    let mut escaped = String::new();
    for ch in value.chars() {
        match ch {
            '\\' => escaped.push_str("\\textbackslash{}"),
            '&' => escaped.push_str("\\&"),
            '%' => escaped.push_str("\\%"),
            '$' => escaped.push_str("\\$"),
            '#' => escaped.push_str("\\#"),
            '_' => escaped.push_str("\\_"),
            '{' => escaped.push_str("\\{"),
            '}' => escaped.push_str("\\}"),
            '~' => escaped.push_str("\\~{}"),
            '^' => escaped.push_str("\\^{}"),
            _ => escaped.push(ch),
        }
    }
    escaped
}

fn span_anchor_index(diagram: &Diagram, span: &Span) -> Option<usize> {
    match &span.under {
        Some(SpanTarget::Signal { signal: name }) => diagram
            .signals
            .iter()
            .position(|signal| signal.name == *name),
        Some(SpanTarget::Group { group: name }) => diagram
            .signals
            .iter()
            .rposition(|signal| signal.group.as_deref() == Some(name.as_str())),
        None => None,
    }
}

fn signal_group_runs(diagram: &Diagram) -> Vec<(&str, usize, usize)> {
    let mut runs = Vec::new();
    let mut index = 0;
    while index < diagram.signals.len() {
        let Some(group) = diagram.signals[index].group.as_deref() else {
            index += 1;
            continue;
        };
        let start = index;
        while index + 1 < diagram.signals.len()
            && diagram.signals[index + 1].group.as_deref() == Some(group)
        {
            index += 1;
        }
        runs.push((group, start, index));
        index += 1;
    }
    runs
}

pub fn render_svg(diagram: &Diagram, _options: &RenderOptions) -> Result<String, TimingError> {
    validate(diagram)?;
    let max_time = diagram
        .signals
        .iter()
        .map(signal_end)
        .chain(diagram.markers.iter().map(|m| m.at))
        .chain(diagram.spans.iter().map(|span| span.to))
        .chain(
            diagram
                .arrows
                .iter()
                .flat_map(|arrow| [arrow.from.at, arrow.to.at]),
        )
        .fold(1.0, f64::max);
    let group_runs = signal_group_runs(diagram);
    let label_width = if group_runs.is_empty() { 190.0 } else { 230.0 };
    let chart_width = 900.0;
    let row_height = 58.0;
    let local_span_height = 38.0;
    let top = if diagram.title.is_some() { 78.0 } else { 42.0 };
    let mut spans_after = vec![Vec::new(); diagram.signals.len()];
    let mut bottom_spans = Vec::new();
    for (index, span) in diagram.spans.iter().enumerate() {
        if let Some(signal_index) = span_anchor_index(diagram, span) {
            spans_after[signal_index].push(index);
        } else {
            bottom_spans.push(index);
        }
    }
    let mut signal_y = Vec::with_capacity(diagram.signals.len());
    let mut cursor = top;
    for local_spans in &spans_after {
        signal_y.push(cursor);
        cursor += row_height + local_spans.len() as f64 * local_span_height;
    }
    let wave_bottom = cursor;
    let bottom = if bottom_spans.is_empty() {
        40.0
    } else {
        68.0 + bottom_spans.len() as f64 * 24.0
    };
    let width = label_width + chart_width + 24.0;
    let height = wave_bottom + bottom;
    let x = |time: f64| label_width + (time / max_time) * chart_width;

    let mut svg = String::new();
    write!(svg, r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0} {height:.0}" role="img" aria-label="{}" data-chart-left="{label_width:.2}" data-chart-width="{chart_width:.2}" data-max-time="{max_time:.6}" shape-rendering="geometricPrecision" text-rendering="geometricPrecision"><defs><marker id="span-arrow" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto-start-reverse"><path d="M 0 0 L 7 3.5 L 0 7" fill="none" stroke="#111" stroke-width="1"/></marker><marker id="cause-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 Z" fill="#111"/></marker></defs><rect width="100%" height="100%" fill="#fff"/>"##,
        escape(diagram.title.as_deref().unwrap_or("时序图"))).unwrap();

    if let Some(title) = &diagram.title {
        write!(svg, r##"<text data-edit-kind="title" x="{:.0}" y="40" fill="#111" font-family="'Times New Roman','Noto Serif CJK SC','Source Han Serif SC',SimSun,serif" font-size="19" font-weight="600">{}</text>"##, label_width, escape(title)).unwrap();
    }

    let tick_count = max_time.ceil().clamp(1.0, 40.0) as usize;
    for tick in 0..=tick_count {
        let time = max_time * tick as f64 / tick_count.max(1) as f64;
        let tx = x(time);
        write!(svg, r##"<line x1="{tx:.2}" y1="{top:.2}" x2="{tx:.2}" y2="{wave_bottom:.2}" stroke="#dedede" stroke-width="0.8"/>"##).unwrap();
    }
    for y in &signal_y {
        let gy = *y;
        write!(svg, r##"<line x1="{label_width:.2}" y1="{gy:.2}" x2="{:.2}" y2="{gy:.2}" stroke="#e3e3e3" stroke-width="0.8"/>"##, label_width + chart_width).unwrap();
    }
    write!(svg, r##"<line x1="{label_width:.2}" y1="{wave_bottom:.2}" x2="{:.2}" y2="{wave_bottom:.2}" stroke="#e3e3e3" stroke-width="0.8"/>"##, label_width + chart_width).unwrap();

    for (group, start, end) in group_runs {
        let y1 = signal_y[start] + 8.0;
        let y2 = signal_y[end] + row_height - 8.0;
        let center = (y1 + y2) / 2.0;
        write!(svg, r##"<g data-signal-group="{}"><path d="M 72 {y1:.2} H 62 V {y2:.2} H 72" fill="none" stroke="#111" stroke-width="1.2"/><text data-edit-kind="group" data-edit-key="{}" x="26" y="{center:.2}" transform="rotate(-90 26 {center:.2})" fill="#111" font-family="'Times New Roman','Noto Serif CJK SC','Source Han Serif SC',SimSun,serif" font-size="13" text-anchor="middle">{}</text></g>"##, escape(group), escape(group), escape(group)).unwrap();
    }

    for (index, item) in diagram.signals.iter().enumerate() {
        let y = signal_y[index];
        write!(svg, r##"<text data-edit-kind="signal" data-edit-index="{index}" x="{:.2}" y="{:.2}" fill="#111" font-family="'Times New Roman','Noto Serif CJK SC','Source Han Serif SC',SimSun,serif" font-size="17" text-anchor="end">{}</text>"##, label_width - 18.0, y + 36.0, escape(&item.name)).unwrap();
        match &item.kind {
            SignalKind::Clock {
                period,
                cycles,
                start,
            } => {
                let half = period / 2.0;
                let mut path = format!("M {:.2} {:.2}", x(*start), y + 43.0);
                for step in 0..(*cycles * 2) {
                    let nx = x(*start + (step + 1) as f64 * half);
                    let level = if step % 2 == 0 { y + 19.0 } else { y + 43.0 };
                    write!(path, " V {level:.2} H {nx:.2}").unwrap();
                }
                write!(svg, r##"<path d="{path}" fill="none" stroke="#111" stroke-width="2" stroke-linejoin="miter"/>"##).unwrap();
            }
            SignalKind::Digital { points } => {
                render_digital(&mut svg, points, y, max_time, &x, "#111", "#555")
            }
            SignalKind::Bus { segments } => {
                render_bus(&mut svg, segments, index, y, &x, "#111", "#fff", "#111")
            }
        }
    }

    for (index, mark) in diagram.markers.iter().enumerate() {
        let mx = x(mark.at);
        write!(svg, r##"<g class="preview-marker" data-drag-kind="marker" data-marker-index="{index}"><line class="preview-marker-line" x1="{mx:.2}" y1="{:.2}" x2="{mx:.2}" y2="{wave_bottom:.2}" stroke="#555" stroke-width="1.2" stroke-dasharray="4 4"/><line class="preview-hit" x1="{mx:.2}" y1="{:.2}" x2="{mx:.2}" y2="{wave_bottom:.2}" stroke="transparent" stroke-width="20"/>"##, top - 8.0, top - 8.0).unwrap();
        if let Some(label) = &mark.label {
            write!(svg, r##"<text data-edit-kind="marker" data-edit-index="{index}" x="{:.2}" y="{:.2}" fill="#333" font-family="'Times New Roman','Noto Serif CJK SC','Source Han Serif SC',SimSun,serif" font-size="12">{}</text>"##,
                mx + 5.0, top - 10.0, escape(label)).unwrap();
        }
        svg.push_str("</g>");
    }
    for (index, arrow) in diagram.arrows.iter().enumerate() {
        let from_index = diagram
            .signals
            .iter()
            .position(|signal| signal.name == arrow.from.signal)
            .expect("causal arrow source was validated");
        let to_index = diagram
            .signals
            .iter()
            .position(|signal| signal.name == arrow.to.signal)
            .expect("causal arrow target was validated");
        let from_x = x(arrow.from.at);
        let to_x = x(arrow.to.at);
        let from_y = signal_y[from_index] + 31.0;
        let to_y = signal_y[to_index] + 31.0;
        write!(svg, r##"<path data-annotation="causal-arrow" data-arrow-index="{index}" d="M {from_x:.2} {from_y:.2} L {to_x:.2} {to_y:.2}" fill="none" stroke="#111" stroke-width="1.4" marker-end="url(#cause-arrow)"/><path class="preview-arrow-hit" data-arrow-index="{index}" d="M {from_x:.2} {from_y:.2} L {to_x:.2} {to_y:.2}" fill="none" stroke="transparent" stroke-width="20"/>"##).unwrap();
        if let Some(label) = &arrow.label {
            write!(svg, r##"<text data-edit-kind="arrow" data-edit-index="{index}" x="{:.2}" y="{:.2}" fill="#111" font-family="'Times New Roman','Noto Serif CJK SC','Source Han Serif SC',SimSun,serif" font-size="12" text-anchor="middle">{}</text>"##,
                (from_x + to_x) / 2.0, (from_y + to_y) / 2.0 - 7.0, render_math_label(label)).unwrap();
        }
    }
    let mut draw_span = |span_index: usize, span: &Span, sy: f64, placement: &str| {
        let (annotation, dash) = match span.kind {
            SpanKind::Interval => ("span", ""),
            SpanKind::Setup => ("setup", r#" stroke-dasharray="5 3""#),
            SpanKind::Hold => ("hold", r#" stroke-dasharray="2 3""#),
        };
        let from_x = x(span.from);
        let to_x = x(span.to);
        write!(svg, r##"<g class="preview-span" data-span-index="{span_index}"><line class="preview-span-line" data-annotation="{annotation}" data-span-under="{}" x1="{from_x:.2}" y1="{sy:.2}" x2="{to_x:.2}" y2="{sy:.2}" stroke="#111" stroke-width="1.2"{dash} marker-start="url(#span-arrow)" marker-end="url(#span-arrow)"/><line class="preview-hit" data-drag-kind="span-move" x1="{from_x:.2}" y1="{sy:.2}" x2="{to_x:.2}" y2="{sy:.2}" stroke="transparent" stroke-width="20"/><circle class="preview-endpoint-hit preview-span-start" data-drag-kind="span-start" cx="{from_x:.2}" cy="{sy:.2}" r="12" fill="transparent"/><circle class="preview-endpoint-hit preview-span-end" data-drag-kind="span-end" cx="{to_x:.2}" cy="{sy:.2}" r="12" fill="transparent"/><circle class="preview-handle preview-span-start" cx="{from_x:.2}" cy="{sy:.2}" r="5.5" fill="#fff" stroke="#087f78" stroke-width="1.5" opacity="0" pointer-events="none"/><circle class="preview-handle preview-span-end" cx="{to_x:.2}" cy="{sy:.2}" r="5.5" fill="#fff" stroke="#087f78" stroke-width="1.5" opacity="0" pointer-events="none"/><text data-edit-kind="span" data-edit-index="{span_index}" x="{:.2}" y="{:.2}" fill="#111" font-family="'Times New Roman','Noto Serif CJK SC','Source Han Serif SC',SimSun,serif" font-size="16" text-anchor="middle">{}</text></g>"##,
            escape(placement), (from_x + to_x) / 2.0, sy + 20.0, render_math_label(&span.label)).unwrap();
    };
    for (signal_index, span_indices) in spans_after.iter().enumerate() {
        for (local_index, span_index) in span_indices.iter().enumerate() {
            let span = &diagram.spans[*span_index];
            let placement = match span.under.as_ref().expect("anchored span") {
                SpanTarget::Signal { signal } => format!("signal:{signal}"),
                SpanTarget::Group { group } => format!("group:{group}"),
            };
            let sy =
                signal_y[signal_index] + row_height + 8.0 + local_index as f64 * local_span_height;
            draw_span(*span_index, span, sy, &placement);
        }
    }
    for (index, span_index) in bottom_spans.iter().enumerate() {
        let sy = wave_bottom + 30.0 + index as f64 * 24.0;
        draw_span(*span_index, &diagram.spans[*span_index], sy, "diagram");
    }
    write!(svg, r##"<text data-edit-kind="unit" x="{:.2}" y="{:.2}" fill="#555" font-family="'Times New Roman','Noto Serif CJK SC','Source Han Serif SC',SimSun,serif" font-size="11" text-anchor="end">{}</text></svg>"##, width - 24.0, height - 12.0, escape(&diagram.unit)).unwrap();
    Ok(svg)
}

fn signal_end(signal: &Signal) -> f64 {
    match &signal.kind {
        SignalKind::Clock {
            period,
            cycles,
            start,
        } => start + period * *cycles as f64,
        SignalKind::Digital { points } => points.last().map(|p| p.at).unwrap_or(1.0),
        SignalKind::Bus { segments } => segments.iter().map(|s| s.to).fold(1.0, f64::max),
    }
}

fn render_digital(
    svg: &mut String,
    points: &[DigitalPoint],
    y: f64,
    max_time: f64,
    x: &impl Fn(f64) -> f64,
    signal: &str,
    muted: &str,
) {
    let level = |value| match value {
        LogicValue::High => y + 19.0,
        LogicValue::Low => y + 43.0,
        LogicValue::X | LogicValue::Z => y + 31.0,
    };
    let mut path = format!("M {:.2} {:.2}", x(points[0].at), level(points[0].value));
    for pair in points.windows(2) {
        let nx = x(pair[1].at);
        write!(path, " H {nx:.2} V {:.2}", level(pair[1].value)).unwrap();
    }
    if points.last().is_some() {
        write!(path, " H {:.2}", x(max_time)).unwrap();
    }
    write!(svg, r#"<path d="{path}" fill="none" stroke="{signal}" stroke-width="2.2" stroke-linejoin="round"/>"#).unwrap();
    for point in points
        .iter()
        .filter(|p| matches!(p.value, LogicValue::X | LogicValue::Z))
    {
        let label = if point.value == LogicValue::X {
            "X"
        } else {
            "Z"
        };
        write!(svg, r#"<text x="{:.2}" y="{:.2}" fill="{muted}" font-family="'Cascadia Mono',Consolas,'Courier New',SimSun,monospace" font-size="11">{label}</text>"#, x(point.at) + 5.0, y + 27.0).unwrap();
    }
}

fn render_bus(
    svg: &mut String,
    segments: &[BusSegment],
    signal_index: usize,
    y: f64,
    x: &impl Fn(f64) -> f64,
    bus: &str,
    panel: &str,
    text: &str,
) {
    for (segment_index, segment) in segments.iter().enumerate() {
        let left = x(segment.from);
        let right = x(segment.to);
        let path = format!(
            "M {left:.2} {:.2} L {:.2} {:.2} H {:.2} L {right:.2} {:.2} L {:.2} {:.2} H {:.2} Z",
            y + 31.0,
            left + 7.0,
            y + 20.0,
            right - 7.0,
            y + 31.0,
            right - 7.0,
            y + 42.0,
            left + 7.0,
        );
        write!(svg, r#"<path d="{path}" fill="{panel}" stroke="{bus}" stroke-width="2"/><text data-edit-kind="bus" data-signal-index="{signal_index}" data-segment-index="{segment_index}" x="{:.2}" y="{:.2}" fill="{text}" font-family="'Cascadia Mono',Consolas,'Courier New',SimSun,monospace" font-size="12" text-anchor="middle">{}</text>"#, (left + right) / 2.0, y + 35.0, escape(&segment.value)).unwrap();
    }
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn render_math_label(value: &str) -> String {
    let mut output = String::new();
    let chars: Vec<char> = value.chars().collect();
    let mut index = 0;
    let mut plain = String::new();
    while index < chars.len() {
        if chars[index] != '_' || index + 1 >= chars.len() {
            plain.push(chars[index]);
            index += 1;
            continue;
        }
        output.push_str(&escape(&plain));
        plain.clear();
        index += 1;
        let subscript = if chars[index] == '{' {
            let start = index + 1;
            let Some(end_offset) = chars[start..].iter().position(|ch| *ch == '}') else {
                plain.push('_');
                plain.push('{');
                index += 1;
                continue;
            };
            let end = start + end_offset;
            index = end + 1;
            chars[start..end].iter().collect::<String>()
        } else {
            let value = chars[index].to_string();
            index += 1;
            value
        };
        write!(
            output,
            r#"<tspan font-size="11" baseline-shift="sub">{}</tspan>"#,
            escape(&subscript)
        )
        .unwrap();
    }
    output.push_str(&escape(&plain));
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
title: SPI read
unit: cycle
signals:
  - name: CLK
    clock: { period: 2, cycles: 4 }
  - name: CS
    digital:
      points:
        - { at: 0, value: high }
        - { at: 1, value: low }
        - { at: 8, value: high }
"#;

    #[test]
    fn parses_and_renders_svg() {
        let diagram = parse(SAMPLE).expect("sample should parse");
        let svg = render_svg(&diagram, &RenderOptions::default()).expect("sample should render");
        assert!(svg.starts_with("<svg"));
        assert!(svg.contains("SPI read"));
        assert!(svg.contains("CLK"));
    }

    #[test]
    fn escapes_user_text() {
        let mut diagram = parse(SAMPLE).unwrap();
        diagram.title = Some("<script>alert(1)</script>".into());
        let svg = render_svg(&diagram, &RenderOptions::default()).unwrap();
        assert!(!svg.contains("<script>"));
        assert!(svg.contains("&lt;script&gt;"));
    }

    #[test]
    fn parses_compact_dsl_into_the_shared_model() {
        let source = r#"
title "SPI Flash 读取"
unit cycle
clock SCLK period 2 cycles 8 start 1 group SPI
signal CS_N high@0 low@1 high@17 group SPI
bus MOSI "0x9F"@1..9 "ADDR"@9..17 group SPI
mark "采样" @9
"#;

        let diagram = parse(source).expect("compact DSL should parse");

        assert_eq!(diagram.title.as_deref(), Some("SPI Flash 读取"));
        assert_eq!(diagram.unit, "cycle");
        assert_eq!(diagram.signals.len(), 3);
        assert_eq!(diagram.signals[0].name, "SCLK");
        assert_eq!(diagram.signals[0].group.as_deref(), Some("SPI"));
        assert_eq!(diagram.markers[0].label.as_deref(), Some("采样"));
        assert_eq!(diagram.markers[0].at, 9.0);
    }

    #[test]
    fn rejects_out_of_order_digital_points_on_the_source_line() {
        let source = "title Demo\nsignal READY high@4 low@2\n";

        let error = parse(source).expect_err("out-of-order points must be rejected");

        assert!(error.to_string().contains("第 2 行"));
        assert!(error.to_string().contains("严格递增"));
    }

    #[test]
    fn rejects_overlapping_bus_segments_on_the_source_line() {
        let source = "title Demo\nbus DATA A@0..4 B@3..8\n";

        let error = parse(source).expect_err("overlapping bus segments must be rejected");

        assert!(error.to_string().contains("第 2 行"));
        assert!(error.to_string().contains("不能重叠"));
    }

    #[test]
    fn yaml_uses_the_same_time_validation_as_dsl() {
        let source = r#"
signals:
  - name: READY
    digital:
      points:
        - { at: 4, value: high }
        - { at: 2, value: low }
"#;

        let error = parse(source).expect_err("YAML must not bypass model validation");

        assert!(error.to_string().contains("严格递增"));
    }

    #[test]
    fn accepts_dsl_version_one_and_rejects_unknown_versions() {
        let valid = "timing 1\nsignal READY low@0 high@1\n";
        let unsupported = "timing 2\nsignal READY low@0 high@1\n";

        assert!(parse(valid).is_ok());
        let error = parse(unsupported).expect_err("unknown DSL versions must be rejected");
        assert!(error.to_string().contains("第 1 行"));
        assert!(error.to_string().contains("不支持 DSL 版本 `2`"));
    }

    #[test]
    fn rejects_unknown_clock_parameters_instead_of_using_defaults() {
        let source = "clock CLK peroid 4 cycles 8\n";

        let error = parse(source).expect_err("misspelled parameters must be rejected");

        assert!(error.to_string().contains("第 1 行"));
        assert!(error.to_string().contains("未知时钟参数 `peroid`"));
    }

    #[test]
    fn rejects_repeated_document_declarations() {
        let source = "title First\ntitle Second\nsignal READY low@0 high@1\n";

        let error = parse(source).expect_err("repeated titles must be rejected");

        assert!(error.to_string().contains("第 2 行"));
        assert!(error.to_string().contains("title 只能声明一次"));
    }

    #[test]
    fn rejects_repeated_clock_parameters() {
        let source = "clock CLK cycles 4 cycles 8\n";

        let error = parse(source).expect_err("repeated parameters must be rejected");

        assert!(error.to_string().contains("时钟参数 `cycles` 不能重复"));
    }

    #[test]
    fn requires_clock_cycles_but_keeps_period_and_start_defaults() {
        let missing = parse("clock CLK period 4\n").expect_err("cycles is required");
        assert!(missing.to_string().contains("缺少必填参数 `cycles`"));

        let diagram = parse("clock CLK cycles 3\n").expect("other clock options have defaults");
        assert!(matches!(
            diagram.signals[0].kind,
            SignalKind::Clock {
                period: 2.0,
                cycles: 3,
                start: 0.0
            }
        ));
    }

    #[test]
    fn supports_quotes_and_backslashes_inside_quoted_text() {
        let source = r#"title "SPI \"Read\" \\ Path"
signal READY low@0 high@1
"#;

        let diagram = parse(source).expect("escaped text should parse");

        assert_eq!(diagram.title.as_deref(), Some("SPI \"Read\" \\ Path"));
    }

    #[test]
    fn reports_misspelled_first_statements_as_dsl_errors() {
        let error = parse("clok CLK cycles 8\n").expect_err("misspelled DSL must fail");

        assert!(error.to_string().contains("第 1 行"));
        assert!(error.to_string().contains("未知语句 `clok`"));
    }

    #[test]
    fn rejects_group_without_a_value() {
        let error = parse("signal READY low@0 group\n").expect_err("group needs a value");

        assert!(error.to_string().contains("参数 `group` 缺少值"));
    }

    #[test]
    fn requires_spaces_in_titles_to_be_quoted() {
        let error = parse("title Demo Board\nsignal READY low@0\n")
            .expect_err("unquoted title words must not be discarded");

        assert!(error.to_string().contains("带空格的标题必须使用双引号"));
    }

    #[test]
    fn rejects_extra_content_in_fixed_length_statements() {
        for (source, statement) in [
            ("timing 1 extra\nsignal A low@0\n", "timing"),
            ("unit ns extra\nsignal A low@0\n", "unit"),
            ("mark sample @1 extra\nsignal A low@0\n", "mark"),
        ] {
            let error = parse(source).expect_err("extra content must not be ignored");
            assert!(
                error
                    .to_string()
                    .contains(&format!("`{statement}` 语句包含多余内容"))
            );
        }
    }

    #[test]
    fn converts_dsl_and_yaml_without_changing_the_diagram() {
        let source = r#"timing 1
title "固定闸门硬件边沿计数逻辑时序"
unit ms
clock "输入脉冲" period 2 cycles 8 start 0
signal "100 ms 闸门" low@0 high@2 low@14
signal "计数使能" low@0 high@2 low@14
signal "锁存事件" low@0 high@14 low@15
signal "结果有效" low@0 high@15
span 2..14 "固定闸门时间 T_g"
"#;
        let original = parse(source).expect("gate example should parse");
        let yaml = to_yaml(&original).expect("diagram should serialize to YAML");
        let from_yaml = parse(&yaml).expect("serialized YAML should parse");
        let dsl = to_dsl(&from_yaml).expect("diagram should serialize to DSL");
        let round_trip = parse(&dsl).expect("serialized DSL should parse");

        assert_eq!(
            serde_json::to_value(original).unwrap(),
            serde_json::to_value(round_trip).unwrap()
        );
        assert!(dsl.contains("span 2..14 \"固定闸门时间 T_g\""));
    }

    #[test]
    fn renders_paper_style_grid_and_span_annotation() {
        let diagram = parse("signal A low@0 high@2 low@4\nspan 1..3 \"有效窗口\"\n").unwrap();
        let svg = render_svg(&diagram, &RenderOptions::default()).unwrap();

        assert!(svg.contains("fill=\"#fff\""));
        assert!(svg.contains("stroke=\"#111\""));
        assert!(svg.contains("marker-start=\"url(#span-arrow)\""));
        assert!(svg.contains("有效窗口"));
    }

    #[test]
    fn renders_preview_editing_metadata_without_changing_paper_output() {
        let source = r#"title "交互预览"
unit ns
signal REQ low@0 high@2 group CTRL
bus DATA A@0..2 B@2..4 group CTRL
mark "采样" @1
hold 1..3 "保持时间"
arrow REQ@2 -> DATA@3 "响应"
"#;
        let diagram = parse(source).unwrap();
        let svg = render_svg(&diagram, &RenderOptions::default()).unwrap();

        assert!(svg.contains("data-chart-left="));
        assert!(svg.contains("data-max-time="));
        assert!(svg.contains("data-edit-kind=\"title\""));
        assert!(svg.contains("data-edit-kind=\"signal\" data-edit-index=\"0\""));
        assert!(svg.contains("data-edit-kind=\"group\" data-edit-key=\"CTRL\""));
        assert!(svg.contains("data-edit-kind=\"bus\" data-signal-index=\"1\""));
        assert!(svg.contains("data-drag-kind=\"marker\" data-marker-index=\"0\""));
        assert!(svg.contains("data-drag-kind=\"span-start\""));
        assert!(svg.contains("data-drag-kind=\"span-end\""));
        assert!(svg.contains("data-edit-kind=\"span\" data-edit-index=\"0\""));
        assert!(svg.contains("data-edit-kind=\"arrow\" data-edit-index=\"0\""));
        assert!(svg.contains("class=\"preview-arrow-hit\" data-arrow-index=\"0\""));
    }

    #[test]
    fn rejects_duplicate_signal_names_for_every_input_format() {
        let dsl = "signal READY low@0\nsignal READY high@0\n";
        let yaml = r#"
signals:
  - name: READY
    digital: { points: [{ at: 0, value: low }] }
  - name: READY
    digital: { points: [{ at: 0, value: high }] }
"#;

        for source in [dsl, yaml] {
            let error = parse(source).expect_err("duplicate names must be rejected");
            assert!(error.to_string().contains("名称 `READY` 与已有信号重复"));
        }
    }

    #[test]
    fn renders_safe_math_subscripts_in_span_labels() {
        let diagram = parse("signal A low@0 high@1\nspan 0..1 \"窗口 T_{gate} & T_h\"\n").unwrap();
        let svg = render_svg(&diagram, &RenderOptions::default()).unwrap();

        assert!(svg.contains("baseline-shift=\"sub\">gate</tspan>"));
        assert!(svg.contains("baseline-shift=\"sub\">h</tspan>"));
        assert!(svg.contains("&amp;"));
    }

    #[test]
    fn round_trips_setup_hold_and_causal_arrows() {
        let source = r#"timing 1
signal REQ low@0 high@2
signal ACK low@0 high@4
setup 1..2 "建立时间 T_setup"
hold 2..3 "保持时间 T_hold"
arrow REQ@2 -> ACK@4 "响应"
"#;

        let diagram = parse(source).expect("paper annotations should parse");
        assert_eq!(diagram.spans[0].kind, SpanKind::Setup);
        assert_eq!(diagram.spans[1].kind, SpanKind::Hold);
        assert_eq!(diagram.arrows[0].from.signal, "REQ");
        assert_eq!(diagram.arrows[0].to.signal, "ACK");

        let yaml = to_yaml(&diagram).expect("annotations should serialize to YAML");
        let round_trip = parse(&yaml).expect("annotation YAML should parse");
        let dsl = to_dsl(&round_trip).expect("annotations should serialize to DSL");
        assert!(dsl.contains("setup 1..2 \"建立时间 T_setup\""));
        assert!(dsl.contains("hold 2..3 \"保持时间 T_hold\""));
        assert!(dsl.contains("arrow \"REQ\"@2 -> \"ACK\"@4 \"响应\""));

        let svg = render_svg(&round_trip, &RenderOptions::default()).unwrap();
        assert!(svg.contains("data-annotation=\"setup\""));
        assert!(svg.contains("data-annotation=\"hold\""));
        assert!(svg.contains("data-annotation=\"causal-arrow\""));
        assert!(svg.contains("响应"));
    }

    #[test]
    fn exports_tikz_with_paper_annotations() {
        let diagram = parse(
            "signal REQ low@0 high@2\nsignal ACK low@0 high@4\nsetup 1..2 \"T_setup\"\narrow REQ@2 -> ACK@4 \"cause_1\"\n",
        )
        .unwrap();

        let tikz = render_tikz(&diagram).expect("valid diagrams should export TikZ");

        assert!(tikz.contains("\\begin{tikzpicture}"));
        assert!(tikz.contains("\\draw[->]"));
        assert!(tikz.contains("T\\_setup"));
        assert!(tikz.contains("cause\\_1"));
        assert!(tikz.contains("REQ"));
        assert!(tikz.contains("ACK"));
    }

    #[test]
    fn rejects_causal_arrows_that_reference_missing_signals() {
        let error = parse("signal REQ low@0 high@2\narrow REQ@2 -> ACK@4 \"响应\"\n")
            .expect_err("arrows must reference existing signals");

        assert!(error.to_string().contains("源信号和目标信号必须存在"));
    }

    #[test]
    fn keeps_old_yaml_without_annotation_fields_compatible() {
        let diagram = parse(SAMPLE).expect("old YAML should keep parsing");

        assert!(diagram.spans.is_empty());
        assert!(diagram.arrows.is_empty());

        let old_span = parse(
            "signals:\n  - name: A\n    digital: { points: [{ at: 0, value: low }] }\nspans:\n  - { from: 0, to: 1, label: window }\n",
        )
        .expect("span kind must remain optional");
        assert_eq!(old_span.spans[0].kind, SpanKind::Interval);
    }

    #[test]
    fn expands_svg_height_for_multiple_span_annotations() {
        let one_span = parse("signal A low@0 high@2\nspan 0..1 \"窗口一\"\n").unwrap();
        let three_spans = parse(
            "signal A low@0 high@2\nspan 0..1 \"窗口一\"\nsetup 1..2 \"建立时间\"\nhold 2..3 \"保持时间\"\n",
        )
        .unwrap();
        let one_svg = render_svg(&one_span, &RenderOptions::default()).unwrap();
        let three_svg = render_svg(&three_spans, &RenderOptions::default()).unwrap();

        assert!(one_svg.contains("viewBox=\"0 0 1114 192\""));
        assert!(three_svg.contains("viewBox=\"0 0 1114 240\""));
        assert_eq!(three_svg.matches("data-annotation=").count(), 3);
    }

    #[test]
    fn renders_each_contiguous_signal_group_with_a_bracket() {
        let diagram = parse(
            "clock SCLK cycles 4 group SPI\nsignal CS_N high@0 low@1 group SPI\nsignal READY low@0 high@2\nbus DATA A@0..2 group SPI\n",
        )
        .unwrap();
        let svg = render_svg(&diagram, &RenderOptions::default()).unwrap();

        assert!(svg.contains("viewBox=\"0 0 1154"));
        assert_eq!(svg.matches("data-signal-group=\"SPI\"").count(), 2);
        assert_eq!(svg.matches(">SPI</text>").count(), 2);
    }

    #[test]
    fn places_span_annotations_under_a_signal_or_group() {
        let source = "signal REQ low@0 high@2 group CTRL\nsignal ACK low@0 high@4 group CTRL\nhold 1..2 \"信号保持\" under signal REQ\nsetup 2..3 \"组建立\" under group CTRL\nspan 3..4 \"图底区间\"\n";
        let diagram = parse(source).expect("anchored spans should parse");

        let dsl = to_dsl(&diagram).unwrap();
        assert!(dsl.contains("hold 1..2 \"信号保持\" under signal \"REQ\""));
        assert!(dsl.contains("setup 2..3 \"组建立\" under group \"CTRL\""));

        let yaml = to_yaml(&diagram).unwrap();
        assert!(yaml.contains("signal: REQ"));
        assert!(yaml.contains("group: CTRL"));
        assert!(!yaml.contains("!signal"));
        let yaml_diagram = parse(&yaml).expect("YAML span targets should round trip");
        assert_eq!(yaml_diagram.spans[0].under, diagram.spans[0].under);
        assert_eq!(yaml_diagram.spans[1].under, diagram.spans[1].under);

        let svg = render_svg(&diagram, &RenderOptions::default()).unwrap();
        assert!(svg.contains("data-span-under=\"signal:REQ\""));
        assert!(svg.contains("data-span-under=\"group:CTRL\""));
        assert!(svg.contains("data-span-under=\"diagram\""));
    }
}
