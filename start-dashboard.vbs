' Starts the Weekly Hours dashboard server hidden on port 5173.
' Safe to run twice: a second instance exits when the port is taken.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
Set env = sh.Environment("PROCESS")
env("PORT") = "5173"
sh.Run "node server.js", 0, False
