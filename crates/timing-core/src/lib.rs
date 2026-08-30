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
    Clock { period: f64, cycles: u32, #[serde(default)] start: f64 },
    Digital { points: Vec<DigitalPoint> },
    Bus { segments: Vec<BusSegment> },
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
    #[error("第 {line} 行信号无效：{message}")]
    InvalidSignal { line: usize, message: String },
    #[error("时序图至少需要一个信号")]
    Empty,
}

fn default_unit() -> String {
    "cycle".to_owned()
}

pub fn parse(source: &str) -> Result<Diagram, TimingError> {
    let diagram = serde_yaml::from_str::<Diagram>(source)
        .map_err(|error| TimingError::Parse(error.to_string()))?;
    validate(&diagram)?;
    Ok(diagram)
}

fn validate(diagram: &Diagram) -> Result<(), TimingError> {
    if diagram.signals.is_empty() {
        return Err(TimingError::Empty);
    }

    for (line, signal) in diagram.signals.iter().enumerate() {
        if signal.name.trim().is_empty() {
            return Err(TimingError::InvalidSignal { line: line + 1, message: "名称不能为空".into() });
        }
        match &signal.kind {
            SignalKind::Clock { period, cycles, .. } if *period <= 0.0 || *cycles == 0 => {
                return Err(TimingError::InvalidSignal { line: line + 1, message: "时钟周期和循环数必须大于 0".into() });
            }
            SignalKind::Digital { points } if points.is_empty() => {
                return Err(TimingError::InvalidSignal { line: line + 1, message: "数字信号至少需要一个采样点".into() });
            }
            SignalKind::Bus { segments } if segments.iter().any(|item| item.to <= item.from) => {
                return Err(TimingError::InvalidSignal { line: line + 1, message: "总线片段的 to 必须大于 from".into() });
            }
            _ => {}
        }
    }
    Ok(())
}

pub fn render_svg(diagram: &Diagram, options: &RenderOptions) -> Result<String, TimingError> {
    validate(diagram)?;
    let max_time = diagram.signals.iter().map(signal_end).chain(diagram.markers.iter().map(|m| m.at)).fold(1.0, f64::max);
    let label_width = 154.0;
    let chart_width = 920.0;
    let row_height = 64.0;
    let top = if diagram.title.is_some() { 82.0 } else { 48.0 };
    let bottom = 50.0;
    let width = label_width + chart_width + 30.0;
    let height = top + diagram.signals.len() as f64 * row_height + bottom;
    let x = |time: f64| label_width + (time / max_time) * chart_width;
    let (bg, panel, grid, text, muted, signal, bus, marker) = if options.dark {
        ("#101517", "#151c1f", "#314044", "#e9f1f2", "#849397", "#52d6c9", "#81aef4", "#f0b65b")
    } else {
        ("#f1f3f2", "#ffffff", "#d5dcda", "#172124", "#667477", "#087f78", "#326fbe", "#b66714")
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
            SignalKind::Clock { period, cycles, start } => {
                let half = period / 2.0;
                let mut path = format!("M {:.2} {:.2}", x(*start), y + 43.0);
                for step in 0..(*cycles * 2) {
                    let nx = x(*start + (step + 1) as f64 * half);
                    let level = if step % 2 == 0 { y + 19.0 } else { y + 43.0 };
                    write!(path, " V {level:.2} H {nx:.2}").unwrap();
                }
                write!(svg, r#"<path d="{path}" fill="none" stroke="{signal}" stroke-width="2.2" stroke-linejoin="round"/>"#).unwrap();
            }
            SignalKind::Digital { points } => render_digital(&mut svg, points, y, &x, signal, muted),
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
        SignalKind::Clock { period, cycles, start } => start + period * *cycles as f64,
        SignalKind::Digital { points } => points.last().map(|p| p.at).unwrap_or(1.0),
        SignalKind::Bus { segments } => segments.iter().map(|s| s.to).fold(1.0, f64::max),
    }
}

fn render_digital(svg: &mut String, points: &[DigitalPoint], y: f64, x: &impl Fn(f64) -> f64, signal: &str, muted: &str) {
    let level = |value| match value { LogicValue::High => y + 19.0, LogicValue::Low => y + 43.0, LogicValue::X | LogicValue::Z => y + 31.0 };
    let mut path = format!("M {:.2} {:.2}", x(points[0].at), level(points[0].value));
    for pair in points.windows(2) {
        let nx = x(pair[1].at);
        write!(path, " H {nx:.2} V {:.2}", level(pair[1].value)).unwrap();
    }
    write!(svg, r#"<path d="{path}" fill="none" stroke="{signal}" stroke-width="2.2" stroke-linejoin="round"/>"#).unwrap();
    for point in points.iter().filter(|p| matches!(p.value, LogicValue::X | LogicValue::Z)) {
        let label = if point.value == LogicValue::X { "X" } else { "Z" };
        write!(svg, r#"<text x="{:.2}" y="{:.2}" fill="{muted}" font-family="ui-monospace,monospace" font-size="11">{label}</text>"#, x(point.at) + 5.0, y + 27.0).unwrap();
    }
}

fn render_bus(svg: &mut String, segments: &[BusSegment], y: f64, x: &impl Fn(f64) -> f64, bus: &str, panel: &str, text: &str) {
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
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
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
}
