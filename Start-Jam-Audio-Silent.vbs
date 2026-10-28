Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "d:\Project\spicetify-jam"
WshShell.Run "node jam-bridge.cjs", 0, False
