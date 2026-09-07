import { expect, test } from "@playwright/test";
import {
  captureScreenshot,
  completeOnboarding,
  createBotFromPicker,
  openNewBot,
  rpc,
  signup,
} from "./helpers";

test("create opens form, then empty chat; picker lists bots; sidebar collapses", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `new-bot-ux-${stamp}@rakazo.test`, "password12", "New Bot UX");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  await page.getByTestId("create-menu-trigger").click();
  const picker = page.getByTestId("bot-create-picker");
  await expect(picker).toBeVisible();
  await expect(picker.getByTestId("create-new-bot")).toBeVisible();
  await expect(picker.getByText("Chief", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "plus-picker-bots");

  await picker.getByTestId("create-new-bot").click();
  const form = page.getByTestId("create-bot-form");
  await expect(page.getByTestId("side-panel")).toHaveAttribute("data-panel", "create");
  await expect(form).toBeVisible();
  await expect(form.locator("label:has-text('Name') input")).toBeVisible();
  await expect(form.locator("label:has-text('Title') input")).toBeVisible();
  await expect(form.locator("label:has-text('Description') textarea")).toBeVisible();
  await expect(form.getByTestId("create-bot-computer")).toBeVisible();
  await expect(form.getByTestId("create-bot-team")).toBeVisible();
  await expect(form.getByTestId("create-bot-private")).toBeVisible();
  await captureScreenshot(page, testInfo, "create-bot-form");

  await form.locator("label:has-text('Name') input").fill("New Bot");
  await form.getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForURL(/\/app\/[^/]+$/);
  await expect(page.getByPlaceholder("Message New Bot")).toBeVisible();
  await expect(page.getByTestId("side-panel")).toHaveAttribute("data-panel", "closed");
  await expect(page.getByText("What do you want me on first?", { exact: true })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "create-chat-sidepanel-closed");

  await page.getByTestId("minimize-bots-sidebar").click();
  await expect(page.getByTestId("bots-sidebar")).toHaveAttribute("data-collapsed", "true");
  const edge = page.getByTestId("bots-sidebar-edge");
  await expect(edge).toBeVisible();
  await captureScreenshot(page, testInfo, "bots-sidebar-collapsed");

  const box = await edge.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 80, box!.y + box!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("bots-sidebar")).toHaveAttribute("data-collapsed", "false");
  await captureScreenshot(page, testInfo, "bots-sidebar-expanded");
});

test("later bot waits before showing the focus card; sending cancels it", async ({ page }) => {
  const stamp = Date.now();
  await signup(page, `focus-delay-${stamp}@rakazo.test`, "password12", "Focus Delay");
  await completeOnboarding(page);
  // First bot from onboarding shows the focus card immediately.
  await expect(page.getByText("What do you want me on first?", { exact: true })).toBeVisible();

  await page.clock.install();
  await createBotFromPicker(page);
  await expect(page.getByPlaceholder("Message New Bot")).toBeVisible();
  await expect(page.getByText("What do you want me on first?", { exact: true })).toHaveCount(0);

  await page.clock.fastForward(9_000);
  await expect(page.getByText("What do you want me on first?", { exact: true })).toHaveCount(0);
  await page.clock.fastForward(1_500);
  await expect(page.getByText("What do you want me on first?", { exact: true })).toBeVisible();

  await createBotFromPicker(page, { name: "Later Bot" });
  await expect(page.getByText("What do you want me on first?", { exact: true })).toHaveCount(0);
  const composer = page.getByPlaceholder(/Message/);
  await composer.fill("I'll set this up myself");
  await page.keyboard.press("Enter");
  await page.clock.fastForward(12_000);
  await expect(page.getByText("What do you want me on first?", { exact: true })).toHaveCount(0);
});

test("plus picker can create a Private computer bot", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `new-bot-private-${stamp}@rakazo.test`, "password12", "New Bot Private");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  await createBotFromPicker(page, { computerMode: "dedicated" });
  await expect(page.getByPlaceholder("Message New Bot")).toBeVisible();
  await captureScreenshot(page, testInfo, "create-private-computer-bot");

  const botId = page.url().split("/").pop()!;
  const bots = await rpc<Array<{ id: string; computerMode: string }>>(page, "bots/list", {});
  expect(bots.find((bot) => bot.id === botId)?.computerMode).toBe("dedicated");
});

test("second bot from plus opens create form before persist", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `second-bot-form-${stamp}@rakazo.test`, "password12", "Second Bot Form");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  await openNewBot(page);
  const form = page.getByTestId("create-bot-form");
  await expect(form).toBeVisible();
  await form.locator("label:has-text('Name') input").fill("Researcher");
  await form.locator("label:has-text('Title') input").fill("Finds sources");
  await form.locator("label:has-text('Description') textarea").fill("Briefs from the web.");
  await captureScreenshot(page, testInfo, "second-bot-create-form");

  const create = page.waitForResponse(
    (response) => response.url().includes("/rpc/bots/create") && response.ok(),
  );
  await form.getByRole("button", { name: "Create", exact: true }).click();
  await create;
  await page.waitForURL(/\/app\/[^/]+$/);
  await expect(page.getByPlaceholder("Message Researcher")).toBeVisible();
  await expect(page.getByTestId("side-panel")).toHaveAttribute("data-panel", "closed");
  await captureScreenshot(page, testInfo, "second-bot-created");
});

test("selects a model when creating a bot and changes it in settings", async ({
  page,
}, testInfo) => {
  await signup(page, `bot-model-${Date.now()}@rakazo.test`, "password12", "Bot Models");
  await completeOnboarding(page);
  // Fixture credentials are stored locally; no provider request is sent.
  await rpc(page, "models/connect", {
    provider: "openai",
    apiKey: "fixture-openai-key",
    modelId: "gpt-6-astra",
    label: "OpenAI",
  });
  await openNewBot(page);
  const form = page.getByTestId("create-bot-form");
  const model = form.getByRole("combobox", { name: "Model", exact: true });
  await expect(model).toContainText("GPT-6 Astra");
  await model.selectOption("openai::gpt-6-astra");
  await form.locator("label:has-text('Name') input").fill("Model Bot");
  await captureScreenshot(page, testInfo, "create-bot-model");
  const created = page.waitForResponse(
    (response) => response.url().includes("/rpc/bots/create") && response.ok(),
  );
  await form.getByRole("button", { name: "Create", exact: true }).click();
  const body = await (await created).json();
  const botId = body.json.id;
  expect(body.json).toMatchObject({ modelProvider: "openai", modelId: "gpt-6-astra" });
  await page.getByPlaceholder("Message Model Bot").waitFor();
  await page.locator("main").getByRole("button", { name: "Model Bot", exact: true }).click();
  const settings = page.getByTestId("bot-settings");
  const selection = settings.getByRole("combobox", { name: "Model", exact: true });
  await expect(selection).toBeVisible();
  await expect(selection).toHaveValue("openai::gpt-6-astra");
  await selection.selectOption("openai::gpt-5.6-terra");
  await captureScreenshot(page, testInfo, "edit-bot-model");
  const saved = page.waitForResponse(
    (response) => response.url().includes("/rpc/bots/update") && response.ok(),
  );
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await saved;
  expect(await rpc(page, "bots/get", { botId })).toMatchObject({
    modelProvider: "openai",
    modelId: "gpt-5.6-terra",
  });
  await page.reload();
  await page.locator("main").getByRole("button", { name: "Model Bot", exact: true }).click();
  await expect(selection).toHaveValue("openai::gpt-5.6-terra");
  await selection.selectOption("");
  const cleared = page.waitForResponse(
    (response) => response.url().includes("/rpc/bots/update") && response.ok(),
  );
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await cleared;
  expect(await rpc(page, "bots/get", { botId })).toMatchObject({
    modelProvider: null,
    modelId: null,
  });
});
