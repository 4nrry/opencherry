describe("OpenCherry desktop", () => {
  it("renders the main shell", async () => {
    const header = await $("h1");
    await expect(header).toHaveText("OpenCherry");

    const sidebarTitle = await $("aside h2");
    await expect(sidebarTitle).toHaveText(expect.stringMatching(/^repositories$/i));

    const agentsTitle = await $("main .agents h2");
    await expect(agentsTitle).toHaveText(expect.stringMatching(/^detected agents$/i));
  });

  it("shows the empty-state placeholder before a selection", async () => {
    const hint = await $(".placeholder__hint");
    await expect(hint).toHaveText(
      "Select a repository on the left, or add a new one with the + button.",
    );
  });
});
