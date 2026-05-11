function repoListItem(repoName: string) {
  return $(`.repo-list__item[data-repo-path$="/${repoName}"]`);
}

function removeRepoButton(repoName: string) {
  return $(`.repo-list__remove[data-remove-repo-path$="/${repoName}"]`);
}

function groupChildCard(repoName: string) {
  return $(`.diff-file[data-repo-path$="/${repoName}"]`);
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
    await (await repoListItem("workspace-group")).click();

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
    await trackButton.click();

    await expect($(".repo-view__header h1")).toHaveText("child-repo");
    await expect(await repoListItem("child-repo")).toBeExisting();

    await (await repoListItem("workspace-group")).click();
    await expect(await groupChildCard("child-repo")).not.toBeExisting();
    await expect($(".diff-panel .empty")).toHaveText(
      "No untracked child repositories to show for this folder.",
    );
  });

  it("supports stage, unstage, discard and commit on a real repo", async () => {
    await (await repoListItem("tracked-repo")).click();

    await expect($(".repo-view__header h1")).toHaveText("tracked-repo");
    await expect(await diffFile("unstaged", "tracked.txt")).toBeExisting();
    await expect(await diffFile("untracked", "scratch.txt")).toBeExisting();

    await (await diffFile("unstaged", "tracked.txt")).$('button=Stage').click();
    await expect(await diffFile("staged", "tracked.txt")).toBeExisting();

    await (await diffFile("staged", "tracked.txt")).$('button=Unstage').click();
    await expect(await diffFile("unstaged", "tracked.txt")).toBeExisting();

    await (await diffFile("untracked", "scratch.txt")).$('button=Discard').click();
    await expect(await diffFile("untracked", "scratch.txt")).not.toBeExisting();

    await (await diffFile("unstaged", "tracked.txt")).$('button=Stage').click();
    const message = await $(".commit-box__message");
    await message.setValue("real e2e commit");

    const commitButton = await $('button=Commit staged');
    await commitButton.click();

    await expect($(".commit-box__result")).toHaveText(expect.stringMatching(/real e2e commit/));
    await expect($(".diff-panel .empty")).toHaveText("No working tree changes.");
  });

  it("supports stage all plus commit on a real repo", async () => {
    await (await repoListItem("commit-all-repo")).click();

    await expect($(".repo-view__header h1")).toHaveText("commit-all-repo");
    await expect(await diffFile("unstaged", "all.txt")).toBeExisting();
    await expect(await diffFile("untracked", "extra.txt")).toBeExisting();

    const message = await $(".commit-box__message");
    await message.setValue("commit all flow");

    await (await $('button=Stage all + commit')).click();

    await expect($(".commit-box__result")).toHaveText(expect.stringMatching(/commit all flow/));
    await expect($(".diff-panel .empty")).toHaveText("No working tree changes.");
  });

  it("publishes a branch to its first remote", async () => {
    await (await repoListItem("publish-repo")).click();

    await expect($(".repo-view__header h1")).toHaveText("publish-repo");
    await expect($(".primary-action-bar .btn")).toHaveText("Publish branch");

    await (await $(".primary-action-bar .btn")).click();

    await expect($(".commit-box__result")).toHaveText("Published main to origin");
    await expect($(".primary-action-bar .btn")).not.toBeExisting();
  });

  it("syncs incoming remote changes", async () => {
    await (await repoListItem("sync-repo")).click();

    await expect($(".repo-view__header h1")).toHaveText("sync-repo");
    await expect($(".primary-action-bar .btn")).toHaveText(expect.stringMatching(/^sync changes/i));

    await (await $(".primary-action-bar .btn")).click();

    await expect($(".commit-box__result")).toHaveText("Synced main with origin");
    await expect($(".diff-panel .empty")).toHaveText("No working tree changes.");
  });

  it("removes a tracked repo from the sidebar without touching others", async () => {
    await expect(await repoListItem("publish-repo")).toBeExisting();
    await (await removeRepoButton("publish-repo")).click();

    await expect(await repoListItem("publish-repo")).not.toBeExisting();
    await expect(await repoListItem("tracked-repo")).toBeExisting();
    await expect(await repoListItem("workspace-group")).toBeExisting();
  });
});
