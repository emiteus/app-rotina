' App Rotina - Launcher Otimizado (Instância Única)
' Inicia o servidor Node e o Electron sem mostrar NENHUMA janela de terminal

Set WshShell = CreateObject("WScript.Shell")
Dim fso, objHTTP, tentativas, sucesso
Set fso = CreateObject("Scripting.FileSystemObject")

' Define diretório de trabalho
appDir = "C:\Users\mateu\app-rotina"
WshShell.CurrentDirectory = appDir

' Verifica se o servidor já está rodando
Function verificarServidor()
  On Error Resume Next
  Set objHTTP = CreateObject("MSXML2.XMLHTTP")
  objHTTP.Open "GET", "http://localhost:3000/", False
  objHTTP.Send
  verificarServidor = (objHTTP.Status = 200)
  On Error GoTo 0
End Function

' Se servidor não estiver rodando, inicia
If Not verificarServidor() Then
  ' Inicia servidor Node em background COMPLETAMENTE INVISÍVEL
  WshShell.Run "cmd /c npm start > nul 2>&1", 0, False

  ' Aguarda servidor ficar pronto (máximo 10 segundos)
  tentativas = 0
  sucesso = False
  Do While tentativas < 10 And Not sucesso
    WScript.Sleep 1000
    sucesso = verificarServidor()
    tentativas = tentativas + 1
  Loop
End If

' Aguarda um pouco mais por segurança
WScript.Sleep 500

' Inicia ou foca Electron
WshShell.Run "cmd /c npm run electron-dev > nul 2>&1", 0, False

' Limpa objetos
Set WshShell = Nothing
Set fso = Nothing
Set objHTTP = Nothing
