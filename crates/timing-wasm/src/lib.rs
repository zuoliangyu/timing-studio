use timing_core::{parse, render_svg, RenderOptions};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn render(source: &str, dark: bool) -> Result<String, JsValue> {
    let diagram = parse(source).map_err(|error| JsValue::from_str(&error.to_string()))?;
    render_svg(&diagram, &RenderOptions { dark })
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

