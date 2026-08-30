import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

test("应用通过本地地址启动并完成 WASM 渲染", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "实时波形" })).toBeVisible();
  await expect(page.getByText("DSL 有效 · 积木与波形已同步")).toBeVisible();
  await expect(page.getByRole("img", { name: "固定闸门硬件边沿计数逻辑时序" })).toBeVisible();
});

test("积木、YAML 与 DSL 围绕同一张图转换", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("DSL 有效 · 积木与波形已同步")).toBeVisible();

  await page.getByRole("tab", { name: "积木", exact: true }).click();
  await expect(page.getByRole("heading", { name: "积木编辑" })).toBeVisible();
  const title = page.getByRole("textbox", { name: "图表标题" });
  await title.fill("自动化回归时序图");
  await title.press("Enter");

  await page.getByRole("tab", { name: "YAML", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "YAML 时序描述" })).toContainText("title: 自动化回归时序图");
  await expect(page.getByText("YAML 有效 · 积木与波形已同步")).toBeVisible();

  await page.getByRole("tab", { name: "DSL", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "DSL 时序描述" })).toContainText('title "自动化回归时序图"');
  await expect(page.getByRole("img", { name: "自动化回归时序图" })).toBeVisible();
});

test("大量信号可以筛选并切换紧凑视图", async ({ page }) => {
  await page.goto("/");
  const signals = Array.from({ length: 60 }, (_, index) => `signal SIG_${index} low@0 high@${index + 1}`);
  await page.getByRole("textbox", { name: "DSL 时序描述" }).fill([
    "timing 1",
    'title "大量信号"',
    "unit cycle",
    ...signals,
  ].join("\n"));
  await expect(page.getByText("DSL 有效 · 积木与波形已同步")).toBeVisible();

  await page.getByRole("tab", { name: "积木", exact: true }).click();
  const filter = page.getByRole("searchbox", { name: "筛选信号" });
  await filter.fill("SIG_59");
  await expect(page.getByText("显示 1 / 60 条信号")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "名称" })).toHaveValue("SIG_59");

  const compact = page.getByRole("button", { name: "紧凑视图" });
  await compact.click();
  await expect(compact).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "状态点" })).toBeHidden();
});

test("可以追加信号模板和自动分组的常用片段", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("DSL 有效 · 积木与波形已同步")).toBeVisible();
  await page.getByRole("tab", { name: "积木", exact: true }).click();

  await page.getByRole("button", { name: "插入信号" }).click();
  await page.getByRole("menuitem", { name: "正脉冲" }).click();
  await expect(page.getByText("显示 6 / 6 条信号")).toBeVisible();
  await expect(page.getByRole("article", { name: "信号 SIGNAL" })).toBeVisible();

  await page.getByRole("button", { name: "插入常用片段" }).click();
  await page.getByRole("menuitem", { name: "Ready / Valid 握手" }).click();
  await expect(page.getByText("显示 9 / 9 条信号")).toBeVisible();
  await expect(page.getByRole("group", { name: "信号组 握手" })).toContainText("3 条信号");
  await expect(page.locator('svg [data-signal-group="握手"]')).toHaveCount(1);
});

test("可以多选信号并管理单层分组", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("DSL 有效 · 积木与波形已同步")).toBeVisible();
  await page.getByRole("tab", { name: "积木", exact: true }).click();

  await page.getByRole("checkbox", { name: "选择信号 输入脉冲" }).check();
  await page.getByRole("checkbox", { name: "选择信号 100 ms 闸门" }).check();
  await page.getByRole("button", { name: "分组操作" }).click();
  await page.getByRole("textbox", { name: "组名" }).fill("控制");
  await page.getByRole("button", { name: "应用分组" }).click();

  const group = page.getByRole("group", { name: "信号组 控制" });
  await expect(group).toContainText("2 条信号");
  await expect(page.locator('svg [data-signal-group="控制"]')).toHaveCount(1);

  await group.getByRole("button", { name: "整组下移" }).click();
  await page.getByRole("tab", { name: "DSL", exact: true }).click();
  const source = page.getByRole("textbox", { name: "DSL 时序描述" });
  await expect(source).toHaveValue(/signal "计数使能"[\s\S]*clock "输入脉冲"/);

  await page.getByRole("tab", { name: "积木", exact: true }).click();
  const movedGroup = page.getByRole("group", { name: "信号组 控制" });
  await movedGroup.getByRole("button", { name: "折叠组" }).click();
  await expect(page.getByRole("article", { name: "信号 输入脉冲" })).toBeHidden();

  const groupName = movedGroup.getByRole("textbox", { name: "组名 控制" });
  await groupName.fill("采集");
  await groupName.press("Enter");
  const renamedGroup = page.getByRole("group", { name: "信号组 采集" });
  await expect(page.locator('svg [data-signal-group="采集"]')).toHaveCount(1);
  await renamedGroup.getByRole("button", { name: "取消分组" }).click();
  await expect(page.getByRole("group", { name: "信号组 采集" })).toHaveCount(0);
});

test("区间标注可以放在信号或分组下方", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "DSL 时序描述" }).fill([
    "timing 1",
    "signal REQ low@0 high@2 group CTRL",
    "signal ACK low@0 high@4 group CTRL",
    'hold 1..2 "保持时间"',
  ].join("\n"));
  await expect(page.getByText("DSL 有效 · 积木与波形已同步")).toBeVisible();
  await page.getByRole("tab", { name: "积木", exact: true }).click();

  const placement = page.getByRole("combobox", { name: "标注位置" });
  await placement.selectOption("signal:REQ");
  await expect(page.locator('svg [data-span-under="signal:REQ"]')).toHaveCount(1);

  const requestName = page.getByRole("article", { name: "信号 REQ" }).getByRole("textbox", { name: "名称" });
  await requestName.fill("REQUEST");
  await requestName.press("Enter");
  await expect(page.locator('svg [data-span-under="signal:REQUEST"]')).toHaveCount(1);

  await placement.selectOption("group:CTRL");
  await expect(page.locator('svg [data-span-under="group:CTRL"]')).toHaveCount(1);
  const groupName = page.getByRole("group", { name: "信号组 CTRL" }).getByRole("textbox", { name: "组名 CTRL" });
  await groupName.fill("CONTROL");
  await groupName.press("Enter");
  await expect(page.locator('svg [data-span-under="group:CONTROL"]')).toHaveCount(1);
  await page.getByRole("tab", { name: "DSL", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "DSL 时序描述" })).toContainText('hold 1..2 "保持时间" under group "CONTROL"');
});

test("数字状态可以在固定时间槽之间重排", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("DSL 有效 · 积木与波形已同步")).toBeVisible();
  await page.getByRole("tab", { name: "积木", exact: true }).click();

  const lane = page.getByRole("article", { name: "信号 100 ms 闸门" });
  await lane.getByRole("button", { name: "状态右移" }).first().click();
  await page.getByRole("tab", { name: "DSL", exact: true }).click();

  await expect(page.getByRole("textbox", { name: "DSL 时序描述" })).toContainText('signal "100 ms 闸门" high@0 low@2 low@14');
});

test("总线数据可以拖拽到固定区间槽", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "DSL 时序描述" }).fill([
    "timing 1",
    "unit cycle",
    'bus DATA A@0..2 B@2..4 C@4..6',
  ].join("\n"));
  await expect(page.getByText("DSL 有效 · 积木与波形已同步")).toBeVisible();
  await page.getByRole("tab", { name: "积木", exact: true }).click();

  const lane = page.getByRole("article", { name: "信号 DATA" });
  const handles = lane.getByRole("button", { name: /拖动第 \d+ 个数据段排序/ });
  await handles.nth(0).dragTo(handles.nth(1));
  await page.getByRole("tab", { name: "DSL", exact: true }).click();

  await expect(page.getByRole("textbox", { name: "DSL 时序描述" })).toContainText('bus "DATA" "B"@0..2 "A"@2..4 "C"@4..6');
});

test("标记与区间可以排序和复制", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "DSL 时序描述" }).fill([
    "timing 1",
    "unit cycle",
    "signal CLK low@0 high@1",
    'mark "晚标记" @4',
    'mark "早标记" @1',
    'span 1..2 "第一区间"',
    'span 3..4 "第二区间"',
  ].join("\n"));
  await expect(page.getByText("DSL 有效 · 积木与波形已同步")).toBeVisible();
  await page.getByRole("tab", { name: "积木", exact: true }).click();

  await page.getByRole("button", { name: "复制标记" }).first().click();
  await page.getByRole("button", { name: "下移区间" }).first().click();
  await page.getByRole("button", { name: "按时间排序标注" }).click();
  await page.getByRole("tab", { name: "DSL", exact: true }).click();

  const source = page.getByRole("textbox", { name: "DSL 时序描述" });
  await expect(source).toContainText('mark "早标记" @1');
  await expect(source).toContainText('mark "晚标记 副本" @4');
  await expect(source).toContainText('span 1..2 "第一区间"');
});

test("论文标注贯通 DSL、积木与波形", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "DSL 时序描述" }).fill([
    "timing 1",
    'title "握手约束"',
    "unit ns",
    "signal REQ low@0 high@2",
    "signal ACK low@0 high@4",
    'setup 1..2 "建立时间 T_setup"',
    'hold 2..3 "保持时间 T_hold"',
    'arrow REQ@2 -> ACK@4 "响应"',
  ].join("\n"));
  await expect(page.getByText("DSL 有效 · 积木与波形已同步")).toBeVisible();
  await expect(page.getByRole("img", { name: "握手约束" })).toBeVisible();

  await page.getByRole("tab", { name: "积木", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "区间类型" }).nth(0)).toHaveValue("setup");
  await expect(page.getByRole("combobox", { name: "区间类型" }).nth(1)).toHaveValue("hold");
  await expect(page.getByRole("group", { name: "因果箭头 REQ 到 ACK" })).toBeVisible();

  await page.getByRole("button", { name: "插入区间" }).click();
  await page.getByRole("menuitem", { name: "建立时间" }).click();
  await expect(page.getByRole("combobox", { name: "区间类型" })).toHaveCount(3);

  const request = page.getByRole("article", { name: "信号 REQ" });
  await request.getByRole("textbox", { name: "名称" }).fill("REQUEST");
  await request.getByRole("textbox", { name: "名称" }).press("Enter");
  await expect(page.getByRole("group", { name: "因果箭头 REQUEST 到 ACK" })).toBeVisible();

  await page.getByRole("article", { name: "信号 REQUEST" }).getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("group", { name: /因果箭头/ })).toHaveCount(0);
});

test("可以下载 TikZ 与 PDF", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("DSL 有效 · 积木与波形已同步")).toBeVisible();

  const tikzDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 TikZ" }).click();
  const tikzFile = await tikzDownload;
  expect(tikzFile.suggestedFilename()).toBe("timing-diagram.tex");
  expect((await readFile(await tikzFile.path(), "utf8")).startsWith("% Timing Studio TikZ export")).toBe(true);

  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PDF" }).click();
  const pdfFile = await pdfDownload;
  expect(pdfFile.suggestedFilename()).toBe("timing-diagram.pdf");
  expect((await readFile(await pdfFile.path())).subarray(0, 4).toString()).toBe("%PDF");
});

test("键盘快捷键和模式标签可以无障碍操作", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("DSL 有效 · 积木与波形已同步")).toBeVisible();

  const tabs = page.getByRole("tablist", { name: "编辑格式" });
  await expect(tabs.getByRole("tab")).toHaveCount(3);
  await page.keyboard.press("Control+1");
  await page.keyboard.up("Control");
  await expect(tabs.getByRole("tab", { name: "积木" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "插入信号" }).click();
  await page.getByRole("menuitem", { name: "正脉冲" }).click();
  await expect(page.getByText("显示 6 / 6 条信号")).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(page.getByText("显示 5 / 5 条信号")).toBeVisible();
  await page.keyboard.press("Control+y");
  await expect(page.getByText("显示 6 / 6 条信号")).toBeVisible();

  await page.keyboard.press("Control+2");
  await expect(tabs.getByRole("tab", { name: "DSL" })).toHaveAttribute("aria-selected", "true");
  const sourceDownload = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  await expect((await sourceDownload).suggestedFilename()).toBe("timing-diagram.timing");
});
