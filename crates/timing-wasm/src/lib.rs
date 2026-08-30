use timing_core::{RenderOptions, parse, render_svg, render_tikz, to_dsl, to_yaml};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn render(source: &str, dark: bool) -> Result<String, JsValue> {
    let diagram = parse(source).map_err(|error| JsValue::from_str(&error.to_string()))?;
    render_svg(&diagram, &RenderOptions { dark })
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen]
pub fn inspect(source: &str) -> Result<String, JsValue> {
    let diagram = parse(source).map_err(js_error)?;
    serde_json::to_string(&diagram).map_err(js_error)
}

#[wasm_bindgen]
pub fn tikz(source: &str) -> Result<String, JsValue> {
    let diagram = parse(source).map_err(js_error)?;
    render_tikz(&diagram).map_err(js_error)
}

#[wasm_bindgen]
pub fn convert(source: &str, format: &str) -> Result<String, JsValue> {
    let diagram = parse(source).map_err(js_error)?;
    match format {
        "dsl" => to_dsl(&diagram).map_err(js_error),
        "yaml" => to_yaml(&diagram).map_err(js_error),
        _ => Err(JsValue::from_str("未知目标格式，仅支持 dsl 或 yaml")),
    }
}

fn js_error(error: impl ToString) -> JsValue {
    JsValue::from_str(&error.to_string())
}
