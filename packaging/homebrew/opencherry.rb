cask "opencherry" do
  version "0.0.1"

  on_arm do
    sha256 "REPLACE_WITH_SHA256_ARM"
    url "https://github.com/4nrry/opencherry/releases/download/v#{version}/opencherry_#{version}_aarch64.dmg"
  end
  on_intel do
    sha256 "REPLACE_WITH_SHA256_INTEL"
    url "https://github.com/4nrry/opencherry/releases/download/v#{version}/opencherry_#{version}_x64.dmg"
  end

  name "OpenCherry"
  desc "Multi-repo x multi-agent control tower for AI coding agents"
  homepage "https://github.com/4nrry/opencherry"

  app "opencherry.app"

  caveats <<~EOS
    OpenCherry is not signed or notarized. On first launch, macOS Gatekeeper may
    block it. If that happens, clear the quarantine attribute and reopen:

      xattr -dr com.apple.quarantine "#{appdir}/opencherry.app"

    or right-click the app in Finder and choose "Open".
  EOS
end
