function repoListItem(repoName: string) {
  return $(`.repo-list__item[data-repo-path$="/${repoName}"]`);
}

function removeRepoButton(repoName: string) {
  return $(`.repo-list__remove[data-remove-repo-path$="/${repoName}"]`);
}

function groupChildCard(repoName: string) {
  return $(`.diff-file[data-repo-path$="/${repoName}"]`);
}

function groupChildCheckbox(repoName: string) {
  return groupChildCard(repoName).$('input[type="checkbox"]');
}

function groupFilterButton(filterName: "all" | "untracked" | "tracked" | "dirty") {
  return $(`button=${filterName}`);
}

// Helper to robustly click an element: wait for existence, scroll into view and retry if click is intercepted.
async function clickWhenReady(el: WebdriverIO.Element) {
  if (!el) throw new Error('clickWhenReady: element is undefined');
  // wait for element to exist
  await el.waitForExist({ timeout: 5000 });
  // try several times in case of intermittent overlay or animation
  for (let i = 0; i < 5; i++) {
    try {
      // ensure it's in view
      await el.scrollIntoView();
      // small pause to let layout settle
      await browser.pause(120);
      await el.click();
      return;
    } catch (err) {
      // If click intercepted, retry after a short delay
      await browser.pause(200 + i * 50);
      if (i === 4) throw err;
    }
  }
}

async function removeRepoIfTracked(repoName: string) {
  const item = await repoListItem(repoName);
  if (await item.isExisting()) {
    await (await removeRepoButton(repoName)).click();
  }
}

function diffFile(groupName: string, fileName: string) {
  return $(`.diff-group[data-diff-group="${groupName}"] .diff-file[data-file-path="${fileName}"]`);
}

describe("OpenCherry desktop fixture flows", () => {
  it("loads seeded repo and group entries", async () => {
    await expect(await repoListItem("tracked-repo")).toBeExisting();
    await expect(await repoListItem("commit-all-repo")).toBeExisting();
    await expect(await repoListItem("publish-repo")).toBeExisting();
    await expect(await repoListItem("sync-repo")).toBeExisting();
    await expect(await repoListItem("workspace-group")).toBeExisting();
  });

  it("opens an untracked child repo directly from the group view", async () => {
    await clickWhenReady(await repoListItem("workspace-group"));

    const childRepo = await groupChildCard("child-repo");
    await childRepo.click();

    await expect($(".repo-view__header h1")).toHaveText("child-repo");
    await expect(await repoListItem("child-repo")).not.toBeExisting();
  });

  it("shows child repos for a tracked group and can track one", async () => {
    await (await repoListItem("workspace-group")).click();

    await expect($(".repo-view__header h1")).toHaveText("workspace-group");
    await expect($(".status-grid")).toHaveText(expect.stringMatching(/dirty repos/i));

    const childRepo = await groupChildCard("child-repo");
    await expect(childRepo).toBeExisting();
    await expect(childRepo).toHaveText(expect.stringMatching(/child-repo/));

    const trackButton = await childRepo.$('button=Track');
    await clickWhenReady(trackButton);

    await expect($(".repo-view__header h1")).toHaveText("child-repo");
    await expect(await repoListItem("child-repo")).toBeExisting();

    await (await repoListItem("workspace-group")).click();
    await expect(await groupChildCard("child-repo")).not.toBeExisting();
    await expect(await groupChildCard("tools-repo")).toBeExisting();
  });

  it("tracks all visible child repos from the group view", async () => {
    await (await removeRepoButton("child-repo")).click();
    await (await repoListItem("workspace-group")).click();

    await expect(await groupChildCard("child-repo")).toBeExisting();
    await expect(await groupChildCard("tools-repo")).toBeExisting();
    await expect($('button=Track all')).toBeExisting();

    await clickWhenReady(await $('button=Track all'));

    await expect($(".repo-view__header h1")).toHaveText("tools-repo");
    await expect(await repoListItem("child-repo")).toBeExisting();
    await expect(await repoListItem("tools-repo")).toBeExisting();

    await clickWhenReady(await repoListItem("workspace-group"));
    await expect(await groupChildCard("child-repo")).not.toBeExisting();
    await expect(await groupChildCard("tools-repo")).not.toBeExisting();
    await expect($(".diff-panel .empty")).toHaveText("No child repositories match this filter.");
  });

  it("tracks only selected child repos from the group view", async () => {
    await (await removeRepoButton("child-repo")).click();
    await (await removeRepoButton("tools-repo")).click();
    await (await repoListItem("workspace-group")).click();

    await expect(await groupChildCard("child-repo")).toBeExisting();
    await expect(await groupChildCard("tools-repo")).toBeExisting();

    await clickWhenReady(await groupChildCheckbox("child-repo"));
    await expect($('button=Track selected (1)')).toBeExisting();
    await clickWhenReady(await $('button=Track selected (1)'));

    await expect($(".repo-view__header h1")).toHaveText("child-repo");
    await expect(await repoListItem("child-repo")).toBeExisting();
    await expect(await repoListItem("tools-repo")).not.toBeExisting();

    await clickWhenReady(await repoListItem("workspace-group"));
    await expect(await groupChildCard("child-repo")).not.toBeExisting();
    await expect(await groupChildCard("tools-repo")).toBeExisting();
  });

  it("filters child repositories by all, untracked, tracked, and dirty", async () => {
    await removeRepoIfTracked("child-repo");
    await removeRepoIfTracked("tools-repo");

    await (await repoListItem("workspace-group")).click();
    await expect(await groupChildCard("child-repo")).toBeExisting();
    await expect(await groupChildCard("tools-repo")).toBeExisting();

    await clickWhenReady(await (await groupChildCard("child-repo")).$('button=Track'));
    await expect($(".repo-view__header h1")).toHaveText("child-repo");

    const message = await $(".commit-box__message");
    await message.setValue("clean tracked child");
    await (await $('button=Stage all + commit')).click();
    await expect($(".commit-box__result")).toHaveText(expect.stringMatching(/clean tracked child/));

    await clickWhenReady(await repoListItem("workspace-group"));
    await expect($(".diff-panel")).toHaveText(expect.stringMatching(/1 already tracked/i));

    await expect(await groupChildCard("child-repo")).not.toBeExisting();
    await expect(await groupChildCard("tools-repo")).toBeExisting();

    await (await groupFilterButton("all")).click();
    await expect(await groupChildCard("child-repo")).toBeExisting();
    await expect(await groupChildCard("tools-repo")).toBeExisting();
    await expect(await groupChildCard("child-repo")).toHaveText(expect.stringMatching(/tracked/i));

    await (await groupFilterButton("tracked")).click();
    await expect(await groupChildCard("child-repo")).toBeExisting();
    await expect(await groupChildCard("tools-repo")).not.toBeExisting();
    await expect(await groupChildCard("child-repo")).toHaveText(expect.not.stringMatching(/track\s*$/i));

    await (await groupFilterButton("dirty")).click();
    await expect(await groupChildCard("child-repo")).not.toBeExisting();
    await expect(await groupChildCard("tools-repo")).toBeExisting();

    await (await groupFilterButton("untracked")).click();
    await expect(await groupChildCard("child-repo")).not.toBeExisting();
    await expect(await groupChildCard("tools-repo")).toBeExisting();
  });

  it("supports stage, unstage, discard and commit on a real repo", async () => {
    await (await repoListItem("tracked-repo")).click();

    await expect($(".repo-view__header h1")).toHaveText("tracked-repo");
    await expect(await diffFile("unstaged", "tracked.txt")).toBeExisting();
    await expect(await diffFile("untracked", "scratch.txt")).toBeExisting();

    await clickWhenReady(await (await diffFile("unstaged", "tracked.txt")).$('button=Stage'));
    await expect(await diffFile("staged", "tracked.txt")).toBeExisting();

    await clickWhenReady(await (await diffFile("staged", "tracked.txt")).$('button=Unstage'));
    await expect(await diffFile("unstaged", "tracked.txt")).toBeExisting();

    await clickWhenReady(await (await diffFile("untracked", "scratch.txt")).$('button=Discard'));
    await clickWhenReady(await $('button=Discard changes'));
    await expect(await diffFile("untracked", "scratch.txt")).not.toBeExisting();

    await clickWhenReady(await (await diffFile("unstaged", "tracked.txt")).$('button=Stage'));
    const message = await $(".commit-box__message");
    await message.setValue("real e2e commit");

    const commitButton = await $('button=Commit staged');
    await clickWhenReady(commitButton);

    await expect($(".commit-box__result")).toHaveText(expect.stringMatching(/real e2e commit/));
    await expect($(".diff-panel .empty")).toHaveText("No working tree changes.");
  });

  it("supports stage all plus commit on a real repo", async () => {
    await clickWhenReady(await repoListItem("commit-all-repo"));

    await expect($(".repo-view__header h1")).toHaveText("commit-all-repo");
    await expect(await diffFile("unstaged", "all.txt")).toBeExisting();
    await expect(await diffFile("untracked", "extra.txt")).toBeExisting();

    const message = await $(".commit-box__message");
    await message.setValue("commit all flow");

    await clickWhenReady(await $('button=Stage all + commit'));

    await expect($(".commit-box__result")).toHaveText(expect.stringMatching(/commit all flow/));
    await expect($(".diff-panel .empty")).toHaveText("No working tree changes.");
  });

  it("publishes a branch to its first remote", async () => {
    await clickWhenReady(await repoListItem("publish-repo"));

    await expect($(".repo-view__header h1")).toHaveText("publish-repo");

    // Clear unstaged files first since AdaptiveActionBar prioritizes commits
    const message = await $(".commit-box__message");
    await message.setValue("clean for publish");
    await clickWhenReady(await $('button=Stage all & commit'));
    await expect($(".commit-box__result")).toHaveText(expect.stringMatching(/clean for publish/));

    await expect($(".primary-action-bar .btn")).toHaveText("Publish branch");

    await clickWhenReady(await $(".primary-action-bar .btn"));

    await expect($(".commit-box__result")).toHaveText("Published main to origin");
    await expect($(".primary-action-bar .btn")).not.toBeExisting();
  });

  it("syncs incoming remote changes", async () => {
    await clickWhenReady(await repoListItem("sync-repo"));

    await expect($(".repo-view__header h1")).toHaveText("sync-repo");
    await expect($(".primary-action-bar .btn")).toHaveText(expect.stringMatching(/^(sync changes|pull)/i));

    await clickWhenReady(await $(".primary-action-bar .btn"));

    await expect($(".commit-box__result")).toHaveText("Synced main with origin");
    await expect($(".diff-panel .empty")).toHaveText("No working tree changes.");
  });

  it("removes a tracked repo from the sidebar without touching others", async () => {
    await expect(await repoListItem("publish-repo")).toBeExisting();
    await clickWhenReady(await removeRepoButton("publish-repo"));

    await expect(await repoListItem("publish-repo")).not.toBeExisting();
    await expect(await repoListItem("tracked-repo")).toBeExisting();
    await expect(await repoListItem("workspace-group")).toBeExisting();
  });
});
