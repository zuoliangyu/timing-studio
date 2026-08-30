use timing_core::{RenderOptions, parse, render_svg};

const VALID: &[(&str, &str)] = &[
    (
        "用户手册快速入门",
        include_str!("../../../docs/examples/quick-start.timing"),
    ),
    ("完整 SPI", include_str!("fixtures/valid/full.timing")),
    ("最小时钟", include_str!("fixtures/valid/minimal.timing")),
    ("注释", include_str!("fixtures/valid/comments.timing")),
    ("小数时间", include_str!("fixtures/valid/fractional.timing")),
    (
        "文本转义",
        include_str!("fixtures/valid/escaped-text.timing"),
    ),
];

const INVALID: &[(&str, &str, &str)] = &[
    (
        "未知命令",
        include_str!("fixtures/invalid/unknown-command.timing"),
        "未知语句 `clok`",
    ),
    (
        "未知参数",
        include_str!("fixtures/invalid/unknown-clock-parameter.timing"),
        "未知时钟参数 `peroid`",
    ),
    (
        "重复标题",
        include_str!("fixtures/invalid/duplicate-title.timing"),
        "title 只能声明一次",
    ),
    (
        "总线重叠",
        include_str!("fixtures/invalid/overlapping-bus.timing"),
        "总线片段不能重叠",
    ),
    (
        "时间倒序",
        include_str!("fixtures/invalid/out-of-order-signal.timing"),
        "时间必须严格递增",
    ),
    (
        "分组缺值",
        include_str!("fixtures/invalid/missing-group.timing"),
        "参数 `group` 缺少值",
    ),
    (
        "未知版本",
        include_str!("fixtures/invalid/unsupported-version.timing"),
        "不支持 DSL 版本 `2`",
    ),
];

#[test]
fn documented_valid_fixtures_parse_and_render() {
    for (name, source) in VALID {
        let diagram = parse(source).unwrap_or_else(|error| panic!("{name} 解析失败：{error}"));
        let svg = render_svg(&diagram, &RenderOptions::default())
            .unwrap_or_else(|error| panic!("{name} 渲染失败：{error}"));
        assert!(svg.starts_with("<svg"), "{name} 未生成 SVG");
    }
}

#[test]
fn documented_invalid_fixtures_report_the_expected_problem() {
    for (name, source, expected) in INVALID {
        let error = parse(source).unwrap_err();
        assert!(
            error.to_string().contains(expected),
            "{name} 的错误 `{error}` 未包含 `{expected}`"
        );
    }
}
