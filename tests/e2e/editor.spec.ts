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

test("窄桌面视口可以打开示例菜单", async ({ page }) => {
  await page.setViewportSize({ width: 920, height: 550 });
  await page.goto("/");
  await expect(page.getByText("DSL 有效 · 积木与波形已同步")).toBeVisible();

  await page.getByRole("button", { name: "示例", exact: true }).click();
  await page.getByRole("menuitem", { name: "简洁 DSL" }).click();
  await expect(page.getByRole("img", { name: "SPI Flash 读取" })).toBeVisible();
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

test("DSL 与 YAML 可以保持当前模式插入并格式化", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("DSL 有效 · 积木与波形已同步")).toBeVisible();
  await expect(page.getByRole("tabpanel").getByRole("navigation", { name: "添加内容" })).toBeVisible();
  await expect(page.getByRole("button", { name: "分组操作" })).toHaveCount(0);

  const dslTab = page.getByRole("tab", { name: "DSL", exact: true });
  const dslSource = page.getByRole("textbox", { name: "DSL 时序描述" });
  await page.getByRole("button", { name: "查看 DSL 使用说明" }).click();
  await expect(page.getByRole("region", { name: "DSL 使用说明" })).toContainText("每行一条语句");
  await dslSource.fill("timing 1\nunit    ns\nsignal   A   low@0   high@1");
  await expect(page.getByText("DSL 有效 · 积木与波形已同步")).toBeVisible();
  await page.getByRole("button", { name: "格式化当前 DSL" }).click();
  await expect(dslSource).toHaveValue('timing 1\nunit "ns"\nsignal "A" low@0 high@1\n');

  await page.getByRole("button", { name: "插入信号" }).click();
  await page.getByRole("menuitem", { name: "时钟" }).click();
  await expect(dslTab).toHaveAttribute("aria-selected", "true");
  await expect(dslSource).toContainText('clock "CLK"');

  const yamlTab = page.getByRole("tab", { name: "YAML", exact: true });
  await yamlTab.click();
  await page.getByRole("button", { name: "查看 YAML 使用说明" }).click();
  await expect(page.getByRole("region", { name: "YAML 使用说明" })).toContainText("signals 是信号列表");
  await page.getByRole("button", { name: "插入常用片段" }).click();
  await page.getByRole("menuitem", { name: "Ready / Valid 握手" }).click();
  await expect(yamlTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: "YAML 时序描述" })).toContainText("name: VALID");

  await page.getByRole("tab", { name: "积木", exact: true }).click();
  await expect(page.getByRole("button", { name: "分组操作" })).toBeVisible();
});

test("预览区可以双击编辑文字并拖动标记与区间", async ({ page }) => {
  await page.goto("/");
  const source = page.getByRole("textbox", { name: "DSL 时序描述" });
  await source.fill([
    "timing 1",
    'title "直接编辑"',
    "unit ns",
    "signal REQ low@0 high@2 group CTRL",
    "signal ACK low@0 high@4 group CTRL",
    "bus DATA A@0..2 B@2..4",
    'mark "采样" @1',
    'hold 1..2 "保持时间"',
    'arrow REQ@2 -> ACK@3 "响应"',
  ].join("\n"));
  await expect(page.getByText("DSL 有效 · 积木与波形已同步")).toBeVisible();

  await page.locator('svg [data-edit-kind="title"]').dblclick({ force: true });
  const titleEditor = page.getByRole("textbox", { name: "编辑图表标题" });
  await titleEditor.fill("直接编辑后的图");
  await titleEditor.press("Enter");
  await expect(page.getByRole("img", { name: "直接编辑后的图" })).toBeVisible();

  await page.locator('svg [data-edit-kind="signal"][data-edit-index="0"]').dblclick({ force: true });
  const signalEditor = page.getByRole("textbox", { name: "编辑信号名称" });
  await signalEditor.fill("REQUEST");
  await signalEditor.press("Enter");
  await expect(source).toContainText('arrow "REQUEST"@2 -> "ACK"@3 "响应"');

  await page.locator('svg [data-edit-kind="bus"][data-segment-index="0"]').dblclick({ force: true });
  const busEditor = page.getByRole("textbox", { name: "编辑总线数据" });
  await busEditor.fill("ADDR");
  await busEditor.press("Enter");
  await expect(source).toContainText('bus "DATA" "ADDR"@0..2');

  await page.locator('svg [data-edit-kind="span"]').dblclick({ force: true });
  const spanEditor = page.getByRole("textbox", { name: "编辑区间标签" });
  await spanEditor.fill("保持窗口 T_hold");
  await spanEditor.press("Enter");
  await expect(source).toContainText('hold 1..2 "保持窗口 T_hold"');

  const dragToTime = async (selector: string, targetTime: number) => {
    await expect(page.locator(".paper-sheet")).not.toHaveClass(/is-validating/);
    const part = page.locator(selector);
    const point = await part.evaluate((element, time) => {
      const root = element.ownerSVGElement!;
      const partBounds = element.getBoundingClientRect();
      const chartLeft = Number(root.dataset.chartLeft);
      const chartWidth = Number(root.dataset.chartWidth);
      const maxTime = Number(root.dataset.maxTime);
      const targetSvgX = chartLeft + time / maxTime * chartWidth;
      const matrix = root.getScreenCTM()!;
      const target = new DOMPoint(targetSvgX, 0).matrixTransform(matrix);
      return {
        startX: partBounds.left + partBounds.width / 2,
        startY: partBounds.top + partBounds.height / 2,
        targetX: target.x,
      };
    }, targetTime);
    await page.mouse.move(point.startX, point.startY);
    await page.mouse.down();
    await page.mouse.move(point.targetX, point.startY, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByText("DSL 有效 · 积木与波形已同步")).toBeVisible();
  };

  await dragToTime('svg [data-marker-index="0"] .preview-hit', 3);
  await expect(source).toContainText('mark "采样" @3');

  await dragToTime('svg [data-span-index="0"] [data-drag-kind="span-end"]', 3);
  await expect(source).toContainText('hold 1..3 "保持窗口 T_hold"');

  await dragToTime('svg [data-span-index="0"] .preview-hit', 3);
  await expect(source).toContainText('hold 2..4 "保持窗口 T_hold"');
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(source).toContainText('hold 1..3 "保持窗口 T_hold"');

  await dragToTime('svg [data-span-index="0"] .preview-hit', 1);
  await expect(source).toContainText('hold 0..2 "保持窗口 T_hold"');
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
