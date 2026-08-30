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

fn is_dsl(source: &str) -> bool {
    for raw_line in source.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let keyword = line.split_whitespace().next().unwrap_or_default();
        if matches!(
            keyword,
            "timing" | "title" | "unit" | "clock" | "signal" | "bus" | "mark"
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

    for (line, signal) in diagram.signals.iter().enumerate() {
        if signal.name.trim().is_empty() {
            return Err(TimingError::InvalidSignal {
                line: line + 1,
                message: "名称不能为空".into(),
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
    Ok(())
}

pub fn render_svg(diagram: &Diagram, options: &RenderOptions) -> Result<String, TimingError> {
    validate(diagram)?;
    let max_time = diagram
        .signals
        .iter()
        .map(signal_end)
        .chain(diagram.markers.iter().map(|m| m.at))
        .fold(1.0, f64::max);
    let label_width = 154.0;
    let chart_width = 920.0;
    let row_height = 64.0;
    let top = if diagram.title.is_some() { 82.0 } else { 48.0 };
    let bottom = 50.0;
    let width = label_width + chart_width + 30.0;
    let height = top + diagram.signals.len() as f64 * row_height + bottom;
    let x = |time: f64| label_width + (time / max_time) * chart_width;
    let (bg, panel, grid, text, muted, signal, bus, marker) = if options.dark {
        (
            "#101517", "#151c1f", "#314044", "#e9f1f2", "#849397", "#52d6c9", "#81aef4", "#f0b65b",
        )
    } else {
        (
            "#f1f3f2", "#ffffff", "#d5dcda", "#172124", "#667477", "#087f78", "#326fbe", "#b66714",
        )
    };

    let mut svg = String::new();
    write!(svg, r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0} {height:.0}" role="img" aria-label="{}"><rect width="100%" height="100%" fill="{bg}"/><rect x="18" y="18" width="{:.0}" height="{:.0}" rx="6" fill="{panel}"/>"#,
        escape(diagram.title.as_deref().unwrap_or("时序图")), width - 36.0, height - 36.0).unwrap();

    if let Some(title) = &diagram.title {
        write!(svg, r#"<text x="34" y="50" fill="{text}" font-family="system-ui,sans-serif" font-size="20" font-weight="650">{}</text>"#, escape(title)).unwrap();
    }

    let tick_count = max_time.ceil().min(40.0) as usize;
    for tick in 0..=tick_count {
        let time = max_time * tick as f64 / tick_count.max(1) as f64;
        let tx = x(time);
        write!(svg, r#"<line x1="{tx:.2}" y1="{:.2}" x2="{tx:.2}" y2="{:.2}" stroke="{grid}" stroke-width="1"/><text x="{tx:.2}" y="{:.2}" fill="{muted}" font-family="ui-monospace,monospace" font-size="11" text-anchor="middle">{time:.1}</text>"#,
            top - 12.0, height - bottom + 4.0, top - 20.0).unwrap();
    }

    for (index, item) in diagram.signals.iter().enumerate() {
        let y = top + index as f64 * row_height;
        if index > 0 {
            write!(svg, r#"<line x1="34" y1="{:.2}" x2="{:.2}" y2="{:.2}" stroke="{grid}" stroke-width="1"/>"#, y, width - 34.0, y).unwrap();
        }
        write!(svg, r#"<text x="136" y="{:.2}" fill="{text}" font-family="ui-monospace,monospace" font-size="13" font-weight="600" text-anchor="end">{}</text>"#, y + 35.0, escape(&item.name)).unwrap();
        if let Some(group) = &item.group {
            write!(svg, r#"<text x="34" y="{:.2}" fill="{muted}" font-family="system-ui,sans-serif" font-size="10">{}</text>"#, y + 16.0, escape(group)).unwrap();
        }
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
                write!(svg, r#"<path d="{path}" fill="none" stroke="{signal}" stroke-width="2.2" stroke-linejoin="round"/>"#).unwrap();
            }
            SignalKind::Digital { points } => {
                render_digital(&mut svg, points, y, &x, signal, muted)
            }
            SignalKind::Bus { segments } => render_bus(&mut svg, segments, y, &x, bus, panel, text),
        }
    }

    for mark in &diagram.markers {
        let mx = x(mark.at);
        write!(svg, r#"<line x1="{mx:.2}" y1="{:.2}" x2="{mx:.2}" y2="{:.2}" stroke="{marker}" stroke-width="1.5" stroke-dasharray="4 4"/>"#, top - 12.0, height - bottom).unwrap();
        if let Some(label) = &mark.label {
            write!(svg, r##"<rect x="{:.2}" y="{:.2}" width="{}" height="20" rx="3" fill="{marker}"/><text x="{:.2}" y="{:.2}" fill="#111718" font-family="system-ui,sans-serif" font-size="10" font-weight="700">{}</text>"##,
                mx + 5.0, top - 8.0, label.chars().count() * 7 + 12, mx + 11.0, top + 6.0, escape(label)).unwrap();
        }
    }
    write!(svg, r#"<text x="{:.2}" y="{:.2}" fill="{muted}" font-family="ui-monospace,monospace" font-size="11" text-anchor="end">{}</text></svg>"#, width - 34.0, height - 26.0, escape(&diagram.unit)).unwrap();
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
        write!(svg, r#"<text x="{:.2}" y="{:.2}" fill="{muted}" font-family="ui-monospace,monospace" font-size="11">{label}</text>"#, x(point.at) + 5.0, y + 27.0).unwrap();
    }
}

fn render_bus(
    svg: &mut String,
    segments: &[BusSegment],
    y: f64,
    x: &impl Fn(f64) -> f64,
    bus: &str,
    panel: &str,
    text: &str,
) {
    for segment in segments {
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
        write!(svg, r#"<path d="{path}" fill="{panel}" stroke="{bus}" stroke-width="2"/><text x="{:.2}" y="{:.2}" fill="{text}" font-family="ui-monospace,monospace" font-size="12" text-anchor="middle">{}</text>"#, (left + right) / 2.0, y + 35.0, escape(&segment.value)).unwrap();
    }
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
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
}
