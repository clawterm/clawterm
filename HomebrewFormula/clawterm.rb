cask "clawterm" do
  version :latest
  sha256 :no_check

  url "https://github.com/clawterm/clawterm/releases/latest/download/Clawterm_universal.dmg"
  name "Clawterm"
  desc "Terminal emulator for AI agents"
  homepage "https://github.com/clawterm/clawterm"

  app "Clawterm.app"

  zap trash: [
    "~/.config/clawterm",
  ]
end
